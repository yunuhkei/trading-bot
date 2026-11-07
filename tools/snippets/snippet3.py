"""Snippet video maker v3 ("make it not look cheap"):
- sharp footage: 4K or vertical-native HD sources, cropped to 9:16 at full resolution (no blurry upscales)
- real-speed motion at 24 fps (no stuttering fake slow motion), a slow smooth push-in on each shot (no zoom jitter)
- a film look: a 3D LUT (make_lut.py), halation glow on highlights, fine monochrome grain, a soft vignette
- dissolves between shots for slow songs, hard cuts for trap, at most a flash on the drop
- lyric typography by phrase: a serif lowercase "lyric edit" look (soft glow, blur-in) or a bold condensed caps look
- a small hook line in the first seconds, no watermark-style tags
Usage: python -I snippet3.py spec.json"""
import json, os, subprocess, sys, tempfile

spec = json.load(open(sys.argv[1]))
S, L, fps = float(spec["start"]), float(spec["length"]), int(spec.get("fps", 24))
X = float(spec.get("xfade", 0.0))                       # dissolve length (0 = hard cuts)
push = float(spec.get("push", 0.04))
work = tempfile.mkdtemp(prefix="snip3_", dir=os.path.dirname(spec["out"]))


def run(cmd):
    subprocess.run(cmd, check=True)


def probe(src):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", src], capture_output=True, text=True, check=True).stdout.strip()
    w, h = (int(x) for x in out.split(",")[:2])
    return w, h


# ---- shots ----
cuts = sorted(spec["cuts"], key=lambda c: c[0])
starts = [max(c[0], S) - S for c in cuts]
segs, lens = [], []
for i, (t, src, off) in enumerate(cuts):
    d = (starts[i + 1] if i + 1 < len(cuts) else L) - starts[i]
    seg_len = d + (X if i + 1 < len(cuts) else 0.0)
    w, h = probe(src)
    crop = f"crop={int(h * 9 / 16) // 2 * 2}:{h}" if w / h > 9 / 16 else f"crop={w}:{int(w * 16 / 9) // 2 * 2}"
    vf = (f"{crop},scale=1080:1920:flags=lanczos,"
          f"scale=w='trunc(1080*(1+{push}*t/{seg_len:.3f})/2)*2':h=-2:eval=frame:flags=lanczos,crop=1080:1920,"
          f"fps={fps},setsar=1,format=yuv420p")
    seg = f"{work}/s{i:02d}.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(off), "-t", f"{seg_len + 0.2:.3f}", "-i", src, "-vf", vf,
         "-t", f"{seg_len:.3f}", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "14", seg])
    segs.append(seg); lens.append(seg_len)

# ---- join: dissolves or hard cuts ----
joined = f"{work}/joined.mp4"
if X > 0 and len(segs) > 1:
    inputs = sum((["-i", p] for p in segs), [])
    chain, last = [], "[0:v]"
    for i in range(1, len(segs)):
        out = f"[x{i}]"
        chain.append(f"{last}[{i}:v]xfade=transition=fade:duration={X}:offset={starts[i]:.3f}{out}")
        last = out
    run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(chain), "-map", last,
         "-c:v", "libx264", "-preset", "fast", "-crf", "14", joined])
else:
    open(f"{work}/list.txt", "w").write("".join(f"file '{p}'\n" for p in segs))
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", f"{work}/list.txt", "-c", "copy", joined])


# ---- lyrics by phrase ----
def ts(x):
    x = max(0.0, x); return f"{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}"


def col(hexrgb):
    h = hexrgb.lstrip("#"); return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}".upper()


style = spec.get("text_style", "serif")
keys = {k.lower() for k in spec.get("keywords", [])}
accent = col(spec.get("accent", "#ffffff"))
case = (lambda s: s.lower()) if spec.get("case", "lower") == "lower" else (lambda s: s.upper())
y = int(spec.get("text_y", 900))
if style == "serif":
    font, size, hook_font = spec.get("font_name", "Liberation Serif"), int(spec.get("size", 78)), "Liberation Serif"
    lyric = f"Style: Lyric,{font},{size},&H00F4F4F4,&H00FFFFFF,&H00000000,0,0,0,0,1,5,110,150,0"
    glow = f"Style: Glow,{font},{size},&H96FFFFFF,&HB4FFFFFF,&H00000000,0,0,0,7,0,5,110,150,0"
    hook = f"Style: Hook,{hook_font},46,&H00F0F0F0,&H00000000,&H80000000,0,1,0,0,2,8,110,150,250"
else:
    font, size = spec.get("font_name", "Anton"), int(spec.get("size", 112))
    lyric = f"Style: Lyric,{font},{size},&H00FFFFFF,&H00141414,&H8C000000,0,0,0,2.5,3,5,110,150,0"
    glow = None
    hook = f"Style: Hook,Montserrat ExtraBold,46,&H00FFFFFF,&H00000000,&H8C000000,0,0,0,3,1,8,110,150,250"
ass = ["[Script Info]", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
       "[V4+ Styles]", "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, "
       "Underline, Outline, Shadow, Alignment, MarginL, MarginR, MarginV", lyric, hook] + ([glow] if glow else []) + [
       "", "[Events]", "Format: Layer, Start, End, Style, Text"]
ph = [p for p in spec["phrases"] if S - 0.1 <= p[0] < S + L]
for i, (t, text) in enumerate(ph):
    a = t - S
    b = min((ph[i + 1][0] - S - 0.04) if i + 1 < len(ph) else L, a + float(spec.get("max_show", 3.2)))
    words = []
    for w in case(text).split():
        bare = w.lower().strip(",.!?'")
        words.append(f"{{\\c{accent}}}{w}{{\\c&H00F4F4F4&}}" if bare in keys else w)
    body = " ".join(words)
    if style == "serif":
        anim = f"{{\\an5\\move(540,{y + 14},540,{y},0,260)\\fad(200,180)\\blur7\\t(0,260,\\blur0.6)}}"
        ass.append(f"Dialogue: 0,{ts(a)},{ts(b)},Glow,{{\\an5\\move(540,{y + 14},540,{y},0,260)\\fad(200,180)\\bord7\\blur14\\3c&HFFFFFF&\\3a&HD2&}}{body}")
        ass.append(f"Dialogue: 1,{ts(a)},{ts(b)},Lyric,{anim}{body}")
    else:
        ass.append(f"Dialogue: 1,{ts(a)},{ts(b)},Lyric,{{\\an5\\move(540,{y + 18},540,{y},0,140)\\fad(70,90)\\fsp3}}{body}")
if spec.get("hook"):
    ass.append(f"Dialogue: 2,{ts(0)},{ts(min(2.8, L))},Hook,{{\\fad(0,300)}}{spec['hook']}")
open(f"{work}/caps.ass", "w").write("\n".join(ass) + "\n")

# ---- film look, then text, then the song ----
flash = "".join(f",drawbox=x=0:y=0:w=iw:h=ih:color=white@0.45:t=fill:enable='between(t,{t - S:.3f},{t - S + 2 / fps:.3f})'"
                for t in spec.get("flashes", []))
fc = (f"[0:v]lut3d=file={spec['lut']},split[b][h];"
      f"[h]curves=all='0/0 0.72/0 1/1',gblur=sigma=34,colorchannelmixer=rr=1:gg=0.38:bb=0.18[g];"
      f"[b][g]blend=all_mode=screen:all_opacity={spec.get('halation', 0.3)}[hal];"
      f"color=c=0x808080:s=1080x1920:r={fps},noise=alls={spec.get('grain', 34)}:allf=t,gblur=sigma=0.55,"
      f"format=yuv420p[gr];[hal][gr]blend=all_mode=overlay:all_opacity={spec.get('grain_mix', 0.14)}:shortest=1,"
      f"vignette=angle=PI/5{flash},ass={work}/caps.ass:fontsdir={spec['fontsdir']}[v]")
run(["ffmpeg", "-y", "-loglevel", "error", "-i", joined, "-ss", str(S), "-t", str(L), "-i", spec["song"],
     "-filter_complex", fc, "-map", "[v]", "-map", "1:a",
     "-af", f"afade=t=in:d=0.03,afade=t=out:st={L - 0.3:.2f}:d=0.3,alimiter=limit=0.891:level=false",
     "-t", str(L), "-r", str(fps), "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", "slow",
     "-crf", "17", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", spec["out"]])
print("made", spec["out"], len(segs), "shots,", len(ph), "phrases")
