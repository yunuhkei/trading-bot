#!/usr/bin/env python3
"""Builds the single self-contained racer file: racer/src/template.html + the numbered src/*.js modules (+ baked car data).
Usage: python3 racer/build.py [out.html]   (default: ../Racer_Prototype.html)"""
import sys,os,glob,re
here=os.path.dirname(os.path.abspath(__file__))
out=sys.argv[1] if len(sys.argv)>1 else os.path.join(here,'..','Racer_Prototype.html')
tpl=open(os.path.join(here,'src','template.html'),encoding='utf-8').read()
files=sorted(glob.glob(os.path.join(here,'src','[0-9][0-9]_*.js')))
js='\n'.join(open(f,encoding='utf-8').read() for f in files)
assert '</script' not in js
import base64
# (batch 27) the UI fonts, embedded so the file stays self-contained: Barlow Condensed (SIL OFL) as "RUI", Share Tech Mono (SIL OFL) as "RLCD"
fd=os.path.join(here,'assets','fonts');faces=[]
for fn in sorted(os.listdir(fd)):
  m=re.match(r'(rui|rlcd)-(\d+)(i?)\.woff2$',fn)
  if not m:continue
  b=base64.b64encode(open(os.path.join(fd,fn),'rb').read()).decode()
  faces.append('@font-face{font-family:"%s";font-weight:%s;font-style:%s;font-display:swap;src:url(data:font/woff2;base64,%s) format("woff2")}'%(m.group(1).upper(),m.group(2),'italic' if m.group(3) else 'normal',b))
# (batch 47) photo textures (CC0, Poly Haven): assets/tex/*.jpg become data URLs in TEXB64
td=os.path.join(here,'assets','tex');tex=[]
if os.path.isdir(td):
  for fn in sorted(os.listdir(td)):
    if fn.endswith('.jpg'):tex.append("%s:'data:image/jpeg;base64,%s'"%(fn[:-4],base64.b64encode(open(os.path.join(td,fn),'rb').read()).decode()))
# (batch 56) the recorded sounds and the music are parked for now (the user wants the synthesised sounds back): set REC_AUDIO=True to embed them again
REC_AUDIO=False
# (batch 54) sounds (CC0 / CC-BY, OpenGameArt; see assets/sfx/CREDITS.md): assets/sfx/*.wav|mp3 become base64 strings in SFXB64
sd=os.path.join(here,'assets','sfx');sfx=[]
if REC_AUDIO and os.path.isdir(sd):
  for fn in sorted(os.listdir(sd)):
    if fn.endswith('.wav') or fn.endswith('.mp3'):sfx.append("%s:'%s'"%(fn.rsplit('.',1)[0],base64.b64encode(open(os.path.join(sd,fn),'rb').read()).decode()))
if '/*SFXB64*/' in js:js=js.replace('/*SFXB64*/',','.join(sfx))
# (batch 55) music (CC0, OpenGameArt; see assets/music/CREDITS.md): assets/music/*.mp3 become base64 strings in MUSB64 (played as streamed <audio>, not decoded)
md=os.path.join(here,'assets','music');mus=[]
if REC_AUDIO and os.path.isdir(md):
  for fn in sorted(os.listdir(md)):
    if fn.endswith('.mp3'):mus.append("'%s'"%base64.b64encode(open(os.path.join(md,fn),'rb').read()).decode())
if '/*MUSB64*/' in js:js=js.replace('/*MUSB64*/',','.join(mus))
assert '/*TEXB64*/' in js
js=js.replace('/*TEXB64*/',','.join(tex))
# (batch 57) the loading screens: assets/load/ls1-4.jpg (in-engine action shots) go into the template as data URIs
for k in range(1,5):
  f=os.path.join(here,'assets','load','ls%d.jpg'%k)
  if os.path.exists(f):tpl=tpl.replace('url(LS%d)'%k,"url('data:image/jpeg;base64,%s')"%base64.b64encode(open(f,'rb').read()).decode())
assert '/*FONTS*/' in tpl
html=tpl.replace('/*FONTS*/','\n'.join(faces)).replace('/*SRC*/',js)
open(out,'w',encoding='utf-8').write(html)
print('wrote',os.path.normpath(out),len(html),'bytes from',len(files),'modules')
