"""Snippet video maker v2: real footage cut to the lyrics and the beat, a film grade with grain, a punch-zoom on every
cut, lyrics popping on word by word in a bold font, a hook line in the first seconds, and a small artist tag.
Usage: python -I snippet2.py <spec.json>
spec: {"song": wav, "start": s, "length": s, "out": mp4, "grade": night|flex|noir|vhs, "slowmo": 0.75,
       "font": ttf path, "font_name": "Montserrat ExtraBold", "size": 84, "case": "lower"|"upper",
       "accent": "#ff3b3b", "keywords": [...], "hook": "pov: ...", "tag": "yunuhkeii · slow motion",
       "words": [[t, t_end, word], ...]  (song time),  "lines": [[t, text], ...] (alternative: line starts only),
       "cuts": [[song_time, clip_path, clip_offset], ...], "bpm": 112}"""
import json, math, os, subprocess, sys, tempfile

spec = json.load(open(sys.argv[1]))
S, L = float(spec["start"]), float(spec["length"])
work = tempfile.mkdtemp(prefix="snip_", dir=os.path.dirname(spec["out"]))
fps = 30

# ---- words (song time) -> groups of up to 3, broken at punctuation ----
if spec.get("words"):
    words = [w for w in spec["words"] if S - 0.05 <= w[0] < S + L]
else:                                                    # only line starts: spread each line's words until the next
    lines = spec["lines"]
    words = []
    for i, (t, text) in enumerate(lines):
        nxt = lines[i + 1][0] if i + 1 < len(lines) else min(t + 2.2, S + L)
        ws = text.split()
        step = (nxt - t) / max(len(ws), 1) * 0.85
        words += [[t + j * step, t + (j + 1) * step, w] for j, w in enumerate(ws)]
    words = [w for w in words if S - 0.05 <= w[0] < S + L]
groups, cur = [], []
for w in words:
    cur.append(w)
    if len(cur) == 3 or w[2].rstrip().endswith((",", ".", "?", "!")):
        groups.append(cur); cur = []
if cur:
    groups.append(cur)


def ass_color(hexrgb, alpha="00"):
    h = hexrgb.lstrip("#")
    return f"&H{alpha}{h[4:6]}{h[2:4]}{h[0:2]}".upper()


def ts(x):
    x = max(0.0, x); return f"{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}"


case = (lambda s: s.lower()) if spec.get("case", "lower") == "lower" else (lambda s: s.upper())
keys = {k.lower() for k in spec.get("keywords", [])}
accent = ass_color(spec.get("accent", "#ff3b3b"))
size = int(spec.get("size", 84))
font = spec.get("font_name", "Montserrat ExtraBold")
ass = ["[Script Info]", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 1", "", "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, BorderStyle, Alignment, MarginL, MarginR, MarginV",
       f"Style: Lyric,{font},{size},&H00FFFFFF,&H00101010,&H96000000,0,5,3,1,5,90,150,0",
       f"Style: Hook,{font},60,&H00FFFFFF,&H00000000,&H50000000,0,8,0,3,8,110,150,300",
       f"Style: Tag,{font},36,&H40FFFFFF,&H00000000,&H64000000,0,2,1,1,2,90,150,600",
       "", "[Events]", "Format: Layer, Start, End, Style, Text"]
for i, g in enumerate(groups):
    g_end = (groups[i + 1][0][0] if i + 1 < len(groups) else min(S + L, g[-1][1] + 0.8)) - S
    for k, w in enumerate(g):
        a = w[0] - S
        b = (g[k + 1][0] - S) if k + 1 < len(g) else g_end
        parts = []
        for j, x in enumerate(g[:k + 1]):
            word = case(x[2].strip().strip(",.!?"))
            col = f"{{\\c{accent}}}" if word.lower().strip("'") in keys else ""
            pop = "{\\fscx72\\fscy72\\t(0,110,\\fscx104\\fscy104)\\t(110,170,\\fscx100\\fscy100)}" if j == k else ""
            parts.append(f"{pop}{col}{word}{{\\r}}")
        ass.append(f"Dialogue: 1,{ts(a)},{ts(b)},Lyric,{{\\an5\\pos(540,930)}}" + " ".join(parts))
if spec.get("hook"):
    ass.append(f"Dialogue: 2,{ts(0)},{ts(min(3.0, L))},Hook,{{\\fad(0,250)}}{spec['hook']}")
if spec.get("stamp"):                                     # camcorder look: PLAY + date, top-left
    ass.insert(ass.index("[Events]") - 1, "Style: Stamp,DejaVu Sans Mono,46,&H00F0F0F0,&H00000000,&H64000000,1,2,2,1,7,0,0,0")
    ass.append(f"Dialogue: 3,{ts(0)},{ts(L)},Stamp,{{\\an7\\pos(120,170)}}{spec['stamp']}")
if spec.get("tag"):
    ass.append(f"Dialogue: 0,{ts(0)},{ts(L)},Tag,{spec['tag']}")
open(f"{work}/caps.ass", "w").write("\n".join(ass) + "\n")

# ---- footage segments: one per cut, slow-mo, cover-cropped, punch-zoom at the cut ----
cuts = sorted(spec["cuts"], key=lambda c: c[0])
speed = float(spec.get("slowmo", 1.0))
segs = []
for i, (t, clip, off) in enumerate(cuts):
    a = max(t, S) - S
    b = (cuts[i + 1][0] - S) if i + 1 < len(cuts) else L
    d = round(b - a, 3)
    if d <= 0.05:
        continue
    seg = f"{work}/seg_{i:02d}.mp4"
    vf = (f"setpts=PTS/{speed},fps={fps},scale=1188:2112:force_original_aspect_ratio=increase,crop=1188:2112,"
          f"zoompan=z='1.02+0.07*exp(-on/4)+0.0007*on':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps={fps}")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(off), "-t", str(d * speed + 0.3), "-i", clip,
                    "-vf", vf, "-t", str(d), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", seg], check=True)
    segs.append(seg)
open(f"{work}/list.txt", "w").write("".join(f"file '{p}'\n" for p in segs))

grades = {
    "night": "eq=saturation=0.6:contrast=1.15:brightness=-0.035:gamma=0.92,"
             "colorbalance=rs=-0.06:bs=0.07:rh=0.05:bh=-0.04,curves=all='0/0.03 0.5/0.44 1/0.95'",
    "flex": "eq=saturation=1.08:contrast=1.2:brightness=-0.025,colorbalance=rs=-0.03:bs=0.06:rh=0.05:bh=-0.02,"
            "curves=all='0/0.02 0.5/0.47 1/0.97'",
    "noir": "hue=s=0,eq=contrast=1.3:brightness=0.02:gamma=1.15,curves=all='0/0.02 0.4/0.33 1/0.96'",
    "vhs": "eq=saturation=0.7:contrast=1.18:brightness=0.01,scale=360:640,scale=1080:1920:flags=bilinear,"
           "rgbashift=rh=8:bh=-8:rv=2,gblur=sigma=0.8,drawgrid=w=iw:h=6:t=2:c=black@0.28,"
           "colorbalance=rs=0.04:bs=-0.03:rh=0.05",
}
flash = ""
for t in spec.get("flashes", []):                       # 2-frame white flash (song time)
    a = t - S
    flash += f",drawbox=x=0:y=0:w=iw:h=ih:color=white@0.55:t=fill:enable='between(t,{a:.3f},{a + 2 / fps:.3f})'"
vf = (f"{grades[spec.get('grade', 'night')]},noise=alls=12:allf=t+u,vignette=angle=PI/4.6{flash},"
      f"ass={work}/caps.ass:fontsdir={os.path.dirname(spec['font'])}")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", f"{work}/list.txt",
                "-ss", str(S), "-t", str(L), "-i", spec["song"], "-map", "0:v", "-map", "1:a", "-vf", vf,
                "-af", f"afade=t=in:d=0.04,afade=t=out:st={L - 0.35:.2f}:d=0.35,alimiter=limit=0.891:level=false", "-t", str(L),
                "-r", str(fps), "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", "slow",
                "-crf", "18", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", spec["out"]], check=True)
print("made", spec["out"], len(segs), "cuts,", len(groups), "caption groups")
