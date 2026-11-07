"""Analyze a song: speed, key, loudness, energy over time, the best 15-second snippet, possible screaming, and lyrics.
Usage: python -I analyze.py <song.wav> <out.json>"""
import json
import sys

import librosa
import numpy as np
import pyloudnorm as pyln
import soundfile as sf

path, out = sys.argv[1], sys.argv[2]
y, sr = librosa.load(path, sr=22050, mono=True)
dur = len(y) / sr

# speed and key
tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
tempo = float(np.atleast_1d(tempo)[0])
chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
prof_maj = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
prof_min = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
cm = chroma.mean(axis=1)
scores = []
for i in range(12):
    scores.append((np.corrcoef(cm, np.roll(prof_maj, i))[0, 1], f"{names[i]} major"))
    scores.append((np.corrcoef(cm, np.roll(prof_min, i))[0, 1], f"{names[i]} minor"))
scores.sort(reverse=True)

# loudness (on the real stereo file)
data, rate = sf.read(path)
lufs = float(pyln.Meter(rate).integrated_loudness(data))
peak = float(20 * np.log10(np.max(np.abs(data)) + 1e-12))

# energy over time (half-second steps)
hop = int(sr * 0.5)
rms = librosa.feature.rms(y=y, frame_length=hop * 2, hop_length=hop)[0]
flat = librosa.feature.spectral_flatness(y=y, n_fft=2048, hop_length=hop)[0]
cent = librosa.feature.spectral_centroid(y=y, sr=sr, n_fft=2048, hop_length=hop)[0]
n = min(len(rms), len(flat), len(cent))
rms, flat, cent = rms[:n], flat[:n], cent[:n]
t = np.arange(n) * 0.5
z = lambda a: (a - a.mean()) / (a.std() + 1e-9)

# the best 15 s: loud AND repeated elsewhere (a chorus/hook), using chroma+MFCC similarity
feat = np.vstack([librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)[:, :n],
                  librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=hop)[:, :n] / 50])
feat = feat / (np.linalg.norm(feat, axis=0, keepdims=True) + 1e-9)
W = 30                                               # 30 half-seconds = 15 s
cands = []
for s in range(0, n - W, 2):
    a = feat[:, s:s + W]
    best = 0.0
    for o in range(0, n - W, 4):
        if abs(o - s) < W:
            continue
        best = max(best, float(np.mean(np.sum(a * feat[:, o:o + W], axis=0))))
    cands.append((s, float(rms[s:s + W].mean()), best))
e = z(np.array([c[1] for c in cands]))
r = z(np.array([c[2] for c in cands]))
score = 0.6 * e + 0.4 * r
order = np.argsort(-score)
hooks = []
for i in order:
    s = cands[i][0] * 0.5
    if all(abs(s - h["start"]) >= 15 for h in hooks):
        hooks.append({"start": round(s, 1), "end": round(s + 15, 1), "energy_z": round(float(e[i]), 2),
                      "repeats_z": round(float(r[i]), 2)})
    if len(hooks) == 3:
        break

# possible screaming / distorted vocal: noisy (flat) + bright + loud at the same time
sc = z(flat) + z(cent)
loud = z(rms)
mask = (sc > 2.0) & (loud > 0.5)
spans, start = [], None
for i, m in enumerate(mask):
    if m and start is None:
        start = i
    if (not m or i == len(mask) - 1) and start is not None:
        if i - start >= 2:
            spans.append([round(start * 0.5, 1), round(i * 0.5, 1)])
        start = None

# sections by energy (8 s blocks)
blocks = [{"from": int(b * 8), "energy": round(float(rms[b * 16:(b + 1) * 16].mean() / rms.max()), 2)}
          for b in range(int(n // 16))]

# lyrics
from faster_whisper import WhisperModel
model = WhisperModel("small", device="cpu", compute_type="int8")
audio16 = librosa.load(path, sr=16000, mono=True)[0].astype(np.float32)
segs, info = model.transcribe(audio16, language="en", vad_filter=False, word_timestamps=True, beam_size=5)
lines = []
for sgm in segs:
    lines.append({"start": round(sgm.start, 1), "end": round(sgm.end, 1), "text": sgm.text.strip(),
                  "words": [[round(w.start, 2), round(w.end, 2), w.word] for w in (sgm.words or [])]})

res = {"file": path.split("/")[-1], "seconds": round(dur, 1), "bpm": round(tempo, 1), "key": scores[0][1],
       "key_runner_up": scores[1][1], "lufs": round(lufs, 1), "peak_db": round(peak, 1), "hooks": hooks,
       "possible_screams": spans, "energy_blocks": blocks, "lyrics": lines}
json.dump(res, open(out, "w"), indent=1)
print(json.dumps({k: v for k, v in res.items() if k not in ("lyrics", "energy_blocks")}))
print("energy by 8 s:", " ".join(f"{b['from']}s:{b['energy']}" for b in blocks))
for l in lines:
    print(f"[{l['start']:6.1f}] {l['text']}")
