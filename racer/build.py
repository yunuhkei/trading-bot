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
assert '/*TEXB64*/' in js
js=js.replace('/*TEXB64*/',','.join(tex))
assert '/*FONTS*/' in tpl
html=tpl.replace('/*FONTS*/','\n'.join(faces)).replace('/*SRC*/',js)
open(out,'w',encoding='utf-8').write(html)
print('wrote',os.path.normpath(out),len(html),'bytes from',len(files),'modules')
