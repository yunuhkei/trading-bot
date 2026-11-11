#!/usr/bin/env python3
"""The artifact body fragment of the built game: from <title> to the last </script> (the artifact host adds its own html/head/body).
Usage: python3 racer/tools/fragment.py [built.html] [out.html]"""
import sys,os
here=os.path.dirname(os.path.abspath(__file__))
src=sys.argv[1] if len(sys.argv)>1 else os.path.join(here,'..','..','Racer_Prototype.html')
out=sys.argv[2] if len(sys.argv)>2 else os.path.join(here,'..','..','Racer_Prototype.fragment.html')
h=open(src,encoding='utf-8').read()
a=h.index('<title>');b=h.rindex('</script>')+len('</script>')
frag=h[a:b].replace('</head><body>','')
open(out,'w',encoding='utf-8').write(frag)
print('wrote',os.path.normpath(out),len(frag),'bytes')
