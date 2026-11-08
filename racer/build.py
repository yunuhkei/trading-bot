#!/usr/bin/env python3
"""Builds the single self-contained racer file: racer/src/template.html + the numbered src/*.js modules (+ baked car data).
Usage: python3 racer/build.py [out.html]   (default: ../Racer_Prototype.html)"""
import sys,os,glob,re
here=os.path.dirname(os.path.abspath(__file__))
out=sys.argv[1] if len(sys.argv)>1 else os.path.join(here,'..','Racer_Prototype.html')
tpl=open(os.path.join(here,'src','template.html'),encoding='utf-8').read()
files=sorted(glob.glob(os.path.join(here,'src','[0-9][0-9]_*.js')))
car=open(os.path.join(here,'src','car_nitro.js'),encoding='utf-8').read()
js=car+'\n'+'\n'.join(open(f,encoding='utf-8').read() for f in files)
assert '</script' not in js
html=tpl.replace('/*SRC*/',js)
open(out,'w',encoding='utf-8').write(html)
print('wrote',os.path.normpath(out),len(html),'bytes from',len(files),'modules')
