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
