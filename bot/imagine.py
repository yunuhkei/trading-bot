"""The "Imagine if you..." video machine: turns a script into a finished vertical video and sends it to your phone.

For the next episode in content/imagine/scripts.json that hasn't been made yet:
1. Voice: each scene's lines are read by a free neural voice (Microsoft Edge's, via edge-tts), with the exact time of
   every word, so the captions pop on as each word is spoken.
2. Pictures: one AI image per scene from Pollinations (free, no key: one image every 45 seconds; a POLLINATIONS_KEY
   secret lifts that), in the same 3D-animated style with the same main character every episode. If an image can't
   be made, that scene gets a clean colored title card instead, so the video is never lost.
3. Motion: each picture slowly zooms and pans for exactly as long as its lines take.
4. Captions: big, bold, 2-3 words at a time, timed to the voice, plus a small "AI animated" label.
5. The finished 1080x1920 MP4 goes to your phone (ntfy, the ALERT_TARGET secret) with a ready-to-paste caption.

Run: python -m bot imagine (the imagine workflow does it every morning). Post it yourself: TikTok, Reels, Shorts.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import random
import shutil
import subprocess
import tempfile
import time
import urllib.parse
from pathlib import Path

log = logging.getLogger("imagine")
SCRIPTS = Path("content/imagine/scripts.json")
STATE = Path("content/imagine/state.json")
OUT = Path("content/imagine/out")
W, H, FPS = 1080, 1920, 30
VOICE = "en-US-AndrewNeural"
FONT = "DejaVu Sans"
GAP = 0.25                                    # seconds of pause between scenes
IMAGE_URL = "https://image.pollinations.ai/prompt/{prompt}"
FREE_SPACING = 46                             # the free image tier: one image every 45 seconds per address


def load() -> dict:
    return json.loads(SCRIPTS.read_text())


def state() -> dict:
    return json.loads(STATE.read_text()) if STATE.exists() else {"done": []}


def next_episode(data: dict, st: dict) -> dict | None:
    return next((e for e in data["episodes"] if e["id"] not in st.get("done", [])), None)


def image_prompt(data: dict, scene: dict) -> str:
    return scene["image"].replace("{char}", data["character"]) + ", " + data["style"]


# ---- voice -----------------------------------------------------------------------------------------------------------

def _ssl_fix():
    """Behind a proxy with its own certificate (SSL_CERT_FILE), let edge-tts trust it too."""
    import ssl

    import edge_tts.communicate as ec

    cafile = os.environ.get("SSL_CERT_FILE")
    if cafile and Path(cafile).exists():
        ec._SSL_CTX = ssl.create_default_context(cafile=cafile)


async def _say(text: str, out: Path, voice: str) -> list[tuple[float, float, str]]:
    import edge_tts

    c = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    words = []
    with open(out, "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append((ch["offset"] / 1e7, ch["duration"] / 1e7, ch["text"]))
    return words


def say(text: str, out: Path, voice: str = VOICE) -> list[tuple[float, float, str]]:
    """Read `text` aloud into an MP3; returns (start, duration, word) for every word."""
    _ssl_fix()
    for attempt in range(3):
        try:
            return asyncio.run(_say(text, out, voice))
        except Exception as e:
            log.warning("voice try %d failed: %s", attempt + 1, e)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError("the voice service didn't answer")


def duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


# ---- pictures --------------------------------------------------------------------------------------------------------

_last_image = [0.0]


def ai_image(prompt: str, out: Path, seed: int) -> bool:
    """One AI picture (portrait) from Pollinations; False if it couldn't be made."""
    import requests

    key = os.environ.get("POLLINATIONS_KEY", "").strip()
    url = IMAGE_URL.format(prompt=urllib.parse.quote(prompt[:900]))
    params = {"width": 768, "height": 1344, "nologo": "true", "seed": seed, "model": "flux"}
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    for attempt in range(4):
        wait = _last_image[0] + (2 if key else FREE_SPACING) - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_image[0] = time.time()
        try:
            r = requests.get(url, params=params, headers=headers, timeout=180)
        except Exception as e:
            log.warning("image try %d: %s", attempt + 1, e)
            continue
        if r.ok and r.headers.get("content-type", "").startswith("image/") and len(r.content) > 10_000:
            out.write_bytes(r.content)
            return True
        log.warning("image try %d: HTTP %s %s", attempt + 1, r.status_code, r.text[:160])
    return False


def title_card(text: str, out: Path, seed: int):
    """A clean colored card with the episode's title near the top (when no AI picture could be made; the captions
    carry the words)."""
    from PIL import Image, ImageDraw, ImageFont

    rnd = random.Random(seed)
    top = tuple(rnd.randint(20, 90) for _ in range(3))
    bottom = tuple(min(255, c + rnd.randint(60, 140)) for c in top)
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 64)
    words, lines, line = text.split(), [], ""
    for w in words:
        if d.textlength(line + " " + w, font=font) > W - 160:
            lines.append(line)
            line = w
        else:
            line = (line + " " + w).strip()
    lines.append(line)
    y = int(H * 0.18)
    for ln in lines:
        d.text(((W - d.textlength(ln, font=font)) / 2, y), ln, font=font, fill=(255, 255, 255))
        y += 90
    img.save(out, quality=92)


# ---- video -----------------------------------------------------------------------------------------------------------

def motion_clip(img: Path, seconds: float, out: Path, k: int):
    """The picture filling a 1080x1920 frame, slowly zooming (in or out) and drifting, for `seconds`."""
    frames = max(1, int(round(seconds * FPS)))
    zin = k % 2 == 0
    z = f"min(1+0.10*on/{frames},1.10)" if zin else f"max(1.10-0.10*on/{frames},1.0)"
    drift = ["iw/2-(iw/zoom/2)", f"(iw-iw/zoom)*on/{frames}", f"(iw-iw/zoom)*(1-on/{frames})"][k % 3]
    vf = (f"scale={W * 2}:{H * 2}:force_original_aspect_ratio=increase,crop={W * 2}:{H * 2},"
          f"zoompan=z='{z}':x='{drift}':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={FPS},format=yuv420p")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-i", str(img), "-vf", vf, "-frames:v", str(frames),
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", str(out)], check=True)


def _ass_time(t: float) -> str:
    h, rem = divmod(max(0.0, t), 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def captions(words: list[tuple[float, float, str]], out: Path, label: str = "AI animated"):
    """ASS subtitles: big bold words, 2-3 at a time, timed to the voice, plus a small corner label."""
    head = ("[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\n"
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
            "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
            "MarginR, MarginV, Encoding\n"
            f"Style: Cap,{FONT},96,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,5,60,60,0,1\n"
            f"Style: Tag,{FONT},34,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,0,9,40,40,60,1\n\n"
            "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
    lines, i = [], 0
    while i < len(words):
        n = 2 if len(words[i][2]) > 6 else 3
        chunk = words[i:i + n]
        start = chunk[0][0]
        end = words[i + n][0] if i + n < len(words) else chunk[-1][0] + chunk[-1][1] + 0.3
        text = " ".join(w for _, _, w in chunk).upper().replace("{", "(").replace("}", ")")
        lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Cap,,0,0,0,,{{\\pos(540,1180)}}{text}")
        i += n
    total = (words[-1][0] + words[-1][1] + 1) if words else 1
    lines.append(f"Dialogue: 1,{_ass_time(0)},{_ass_time(total + 5)},Tag,,0,0,0,,{label}")
    out.write_text(head + "\n".join(lines) + "\n")


def render(data: dict, ep: dict, workdir: Path, images=ai_image) -> Path:
    """The finished MP4 for one episode (see the module notes)."""
    workdir.mkdir(parents=True, exist_ok=True)
    clips, audios, all_words, t, made = [], [], [], 0.0, 0
    seed = int(hashlib.md5(ep["id"].encode()).hexdigest(), 16) % 100000
    for k, sc in enumerate(ep["scenes"]):
        mp3 = workdir / f"a{k}.mp3"
        words = say(sc["say"], mp3)
        secs = duration(mp3) + GAP
        img = workdir / f"i{k}.jpg"
        if images(image_prompt(data, sc), img, seed + k):
            made += 1
        else:
            title_card(ep["title"], img, seed + k)
        clip = workdir / f"c{k}.mp4"
        motion_clip(img, secs, clip, k)
        clips.append(clip)
        audios.append((mp3, secs))
        all_words += [(t + s, d, w) for s, d, w in words]
        t += secs
    (workdir / "clips.txt").write_text("".join(f"file '{c.name}'\n" for c in clips))
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", "clips.txt", "-c", "copy",
                    "video.mp4"], check=True, cwd=workdir)
    # the voice: each scene's audio padded to its scene's length, joined
    padded = []
    for k, (mp3, secs) in enumerate(audios):
        p = workdir / f"p{k}.wav"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(mp3), "-af", f"apad,atrim=0:{secs:.3f}", "-ar", "44100",
                        "-ac", "2", str(p)], check=True)
        padded.append(p)
    (workdir / "audio.txt").write_text("".join(f"file '{p.name}'\n" for p in padded))
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", "audio.txt", "-c", "copy",
                    "voice.wav"], check=True, cwd=workdir)
    captions(all_words, workdir / "subs.ass")
    OUT.mkdir(parents=True, exist_ok=True)
    final = OUT / f"{ep['id']}.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", "video.mp4", "-i", "voice.wav", "-vf", "ass=subs.ass",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(final.resolve())], check=True, cwd=workdir)
    log.warning("%s: %.0f s, %d of %d scenes with AI pictures, %.1f MB", ep["id"], t, made, len(ep["scenes"]),
                final.stat().st_size / 1e6)
    return final


def post_caption(ep: dict) -> str:
    return f"{ep['title']}... {ep['scenes'][-1]['say'].split('?')[0]}? {ep.get('tags', '')} #aianimated"


def send(path: Path, ep: dict) -> bool:
    """The video to your phone (an ntfy attachment, with the caption to paste)."""
    import requests

    from .signals import alert_target

    target = alert_target() or ""
    kind, _, rest = target.partition(":") if target.split(":", 1)[0] in ("ntfy", "discord", "telegram") else ("ntfy", "", target)
    if not target or kind != "ntfy":
        log.warning("no ntfy target: video saved at %s only", path)
        return False
    r = requests.put(f"https://ntfy.sh/{rest}", data=path.read_bytes(), timeout=120, headers={
        "Filename": path.name, "Title": f"New video ready: {ep['title']}"[:200].encode("latin-1", "ignore").decode("latin-1"),
        "Message": ("Tap to download, then post to TikTok, Reels and Shorts. Caption: " + post_caption(ep))
        .encode("latin-1", "ignore").decode("latin-1"), "Tags": "clapper"})
    if not r.ok:
        log.warning("ntfy: HTTP %s %s", r.status_code, r.text[:200])
    return r.ok


def run(dry: bool = False):
    from .solbot import commit

    data, st = load(), state()
    ep = next_episode(data, st)
    if not ep:
        print("All scripts are made. Add more to content/imagine/scripts.json.", flush=True)
        return
    with tempfile.TemporaryDirectory() as tmp:
        final = render(data, ep, Path(tmp))
    sent = False if dry else send(final, ep)
    st.setdefault("done", []).append(ep["id"])
    st.setdefault("made", []).append({"id": ep["id"], "t": time.time(), "sent": sent})
    STATE.write_text(json.dumps(st, indent=1))
    commit([str(STATE)], f"Imagine: made {ep['id']}")
    print(f"Made {final} ({final.stat().st_size / 1e6:.1f} MB); sent to phone: {sent}. Caption: {post_caption(ep)}",
          flush=True)
