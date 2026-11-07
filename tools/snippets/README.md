# Song snippet videos (faceless)

Code only: songs, footage and finished videos stay out of this public repo.

1. `python -I analyze.py song.wav song.json`: speed (BPM), key, loudness, energy over time, the best 15-second
   sections, possible screams, and the lyrics with each word's timing (faster-whisper "small").
   Needs: `pip install librosa faster-whisper pyloudnorm`.
2. `python -I footage.py <dir> mixkit|prelinger "<keyword>" <count>`: licensed clips only (Mixkit Free License, or
   public-domain Prelinger films from the Internet Archive), each with its source and license in `provenance.json`.
3. `python -I snippet2.py spec.json`: a 1080x1920 video. Each cut lands on a lyric line and the beat, with slow motion,
   a punch zoom on the cut, a film grade (`night`, `flex`, `noir`, `vhs`), grain and vignette, the lyrics popping on
   word by word (bold font, key words in an accent color), a hook line in the first 3 seconds, an artist tag, and
   optional flashes and a camcorder stamp. Text stays inside the safe area (clear of the top bar, the bottom
   captions and the right-side buttons).

Fonts used (free, SIL Open Font License): Montserrat ExtraBold, Anton, Bebas Neue.

## v3 (looks less cheap)

`python -I make_lut.py <dir>` writes three film-look color LUTs (`night`, `noir`, `flex`). `python -I snippet3.py spec.json`
uses 4K or vertical full-HD clips cropped at full resolution (no blurry upscales), real-speed 24 fps motion (no
stuttering fake slow motion), a slow smooth push-in per shot, the LUT plus a glow on highlights, fine film grain and a
soft vignette, dissolves for slow songs and hard cuts for trap, and phrase-by-phrase lyrics: a lowercase serif
"lyric edit" look (Liberation Serif, soft glow, blur-in) or bold condensed caps (Anton) with a thin dark edge.
Mixkit clips come in 1080p (`-1080.mp4`) and often 4K (`-2160.mp4`); vertical clips are already 1080x1920.
