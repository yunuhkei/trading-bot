'use strict';
/* ===== WebGL1 helpers + all shaders. One program per material class, no per-frame allocation. ===== */
const G={gl:null,cv:null,w:1,h:1,P:{},ext:{},maxAniso:1};
const PRE='#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
/* shared lighting / fog / tone chunk (fragment) */
const ENVSRC='uniform vec3 uCam,uSun,uSunC,uAmbT,uAmbB,uHor,uZen;uniform vec4 uFogP,uGr;/* uGr: x saturation, y warm/cool split, z contrast, w exposure */\n'+
/* grade (set by the weather preset): exposure, a filmic curve, saturation, cool shadows and warm highlights, an S-curve of contrast */
'vec3 tone(vec3 c){c*=uGr.w;float l=dot(c,vec3(.2126,.7152,.0722));c=max(mix(vec3(l),c,uGr.x),0.);c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);c=pow(clamp(c,0.,1.),vec3(.4545));'+
 'float g=dot(c,vec3(.3333));c*=mix(mix(vec3(1.),vec3(.90,.99,1.10),uGr.y),mix(vec3(1.),vec3(1.04,1.0,.95),uGr.y),smoothstep(.05,.8,g));return c*c*(3.-2.*c)*uGr.z+c*(1.-uGr.z);}\n'+
/* the sky as a mip-mapped cube map (rendered at start-up and when the weather changes, see skyCubeUpdate): reflections of the real sky, clouds and sun. Stored as sqrt(colour / 4). */
'uniform samplerCube uEnv;vec3 envl(vec3 r,float rough){vec3 d=textureCube(uEnv,r,rough*7.).rgb;return d*d*4.;}\n'+
'vec3 skyc(vec3 r){vec3 d=textureCube(uEnv,r,2.).rgb;return d*d*4.;}\n'+
/* thick haze: distance fog towards the horizon colour, thinning with height above the camera */
'vec3 fogm(vec3 c,vec3 wp){vec3 d=wp-uCam;float L=length(d);vec3 v=d/max(L,1e-3);float k=uFogP.x;float f=1.-exp(-L*L*k*k);f*=exp(-max(wp.y-uCam.y,0.)*uFogP.y);'+
 'float sg=pow(max(dot(v,uSun),0.),4.);vec3 fc=mix(uHor,uHor*.8+uSunC*.12,sg*uFogP.z);return mix(c,fc,clamp(f,0.,1.));}\n';
/* heightmap fetch (RGBA8: R/G = 16-bit height). Hn: exact grid point; Hb: bilinear */
const HSRC='uniform sampler2D uH;uniform vec4 uMap;/* x=half size, y=0.5/N, z=height range, w=height offset */\n'+
'float hdec(vec4 t){return (t.r*255.*256.+t.g*255.)/65535.*uMap.z+uMap.w;}\n'+
'float Hn(vec2 p){return hdec(texture2D(uH,(p+uMap.x)/(2.*uMap.x)+uMap.y));}\n'+
'float Hb(vec2 p){float N=.5/uMap.y,T=2.*uMap.x/N;vec2 g=(p+uMap.x)/T,f=fract(g),b=(floor(g)+.5)/N;float d=1./N;'+
 'float a=hdec(texture2D(uH,b)),c=hdec(texture2D(uH,b+vec2(d,0.))),e=hdec(texture2D(uH,b+vec2(0.,d))),h=hdec(texture2D(uH,b+vec2(d,d)));return mix(mix(a,c,f.x),mix(e,h,f.x),f.y);}\n';
/* sun shadow lookup (only compiled into the programs of the tiers that have shadows): the depth map holds the distance to the nearest caster (cars, and on the top tier buildings, trees, lamps), packed in 4 bytes */
const SHSRC='\n#ifdef SHADOW\nuniform sampler2D uSh;uniform mat4 uLS;uniform vec4 uShP;/* x texel, y strength, z bias */\n'+
 'float dcd(vec4 c){return dot(c,vec4(1.,1./255.,1./65025.,1./16581375.));}\n'+
 'float shadowAt(vec3 wp){vec4 s=uLS*vec4(wp,1.);vec3 p=s.xyz*.5+.5;float e=max(abs(s.x),abs(s.y));if(e>=1.||p.z>=1.||p.z<=0.)return 1.;float z=p.z-uShP.z;float v=0.;float k=uShP.x*1.7;\n'+
 '#if SHADOW>1\nfor(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++)v+=step(z,dcd(texture2D(uSh,p.xy+vec2(float(i),float(j))*k)));v/=9.;\n#else\n'+
 'v=(step(z,dcd(texture2D(uSh,p.xy+vec2(-.5,-.5)*k)))+step(z,dcd(texture2D(uSh,p.xy+vec2(.5,-.5)*k)))+step(z,dcd(texture2D(uSh,p.xy+vec2(-.5,.5)*k)))+step(z,dcd(texture2D(uSh,p.xy+vec2(.5,.5)*k))))*.25;\n#endif\n'+
 'return mix(1.,v,uShP.y*(1.-smoothstep(.72,1.,e)));}\n#endif\n';
/* cloud shadows: the same kind of cloud field as the sky, drifting over the ground; strong in sun, none under an overcast sky */
const CSHSRC='uniform vec4 uSk;float csh(vec2 p){float t=uFogP.w;vec2 q=p*.00021+vec2(t*.0042,t*.0013);float n=texture2D(uNz,q).r*.55+texture2D(uNz,q*2.7+.37).g*.30+.075;return 1.-smoothstep(uSk.x,uSk.y,n)*clamp(uSunC.r*.1-.05,0.,.3);}\n';
const SH={
 /* ---- sky: full-screen triangle ---- */
 skyV:'attribute vec2 aP;varying vec2 vU;void main(){vU=aP;gl_Position=vec4(aP,.99999,1.);}',
 skyF:PRE+'varying vec2 vU;uniform vec3 uFw,uRt,uUp,uClA,uClB;uniform vec2 uTan;uniform vec4 uSk,uSd;uniform float uStu;uniform sampler2D uNz;\n'+ENVSRC+
 'void main(){vec3 rd=normalize(uFw+uRt*vU.x*uTan.x+uUp*vU.y*uTan.y);float y=rd.y;float sd=max(dot(rd,uSun),0.);'+
 /* the dome: pale grey-blue overhead, lighter towards the haze at the horizon; below the horizon it is the haze itself */
 'vec3 col=mix(uHor,uZen,pow(clamp(y,0.,1.),uSd.z));\n#ifdef CUBE\ncol=mix(col,mix(uHor*vec3(.26,.28,.24),uAmbB*.9+uSunC*.03,smoothstep(0.,-.3,y)),smoothstep(.0,-.02,y));\n#else\ncol=mix(col,uHor,smoothstep(0.,-.1,y));\n#endif\nfloat occ=0.;'+
 'if(y>.004){float yy=max(y,.03);float t=1500./yy;vec2 w=vec2(uFogP.w*.0042,uFogP.w*.0013);vec2 p=(uCam.xz+rd.xz*t)*.00026+w;'+
  /* high layer: thick, broken, darker where thicker; gaps let the lighter dome through */
  'float n=texture2D(uNz,p).r*.55+texture2D(uNz,p*2.7+.37).g*.30;\n#ifdef HI\nn+=texture2D(uNz,p*7.3+.11).b*.15;\n#else\nn+=.075;\n#endif\n'+
  'float th=smoothstep(uSk.x,uSk.y,n);float lit=pow(sd,3.);vec3 hi=mix(uClA,uClB,th)*(.86+.5*lit+uSd.x*.5*pow(sd,10.)*(1.-th));col=mix(col,hi,clamp(th*.92+uSk.z,0.,1.)*smoothstep(.004,.16,y));occ=th*.92+uSk.z*.5;'+
  /* low layer: darker, faster, ragged strips */
  'vec2 p2=(uCam.xz+rd.xz*(700./yy))*.00055+w*2.6+.5;float n2=texture2D(uNz,p2).g*.6+texture2D(uNz,p2*3.1).r*.4;float th2=smoothstep(.5,.82,n2)*uSk.w*smoothstep(.02,.3,y);col=mix(col,uClB*.62*(.9+.6*lit),th2);occ=max(occ,th2);}'+
 'col+=uSunC*(pow(sd,5.)*.055+pow(sd,60.)*.05)*uSd.x*smoothstep(-.05,.3,y);col+=uSunC*smoothstep(.99985,.99996,sd)*uSd.y*smoothstep(-.01,.03,y)*clamp(1.-occ*1.3,0.,1.);'+
 'col=mix(col,uHor,exp(-max(y,0.)*7.)*uSd.w);\n'+
 /* the showroom: soft boxes overhead and at the sides (they become the long highlights in the paint) */
 '#ifdef CUBE\nif(uStu>.5){float a=smoothstep(.55,.62,rd.y)*(1.-smoothstep(.4,.46,abs(rd.x)))*(1.-smoothstep(.6,.68,abs(rd.z)));float b1=smoothstep(.66,.72,rd.x)*(1.-smoothstep(.32,.38,abs(rd.z)))*smoothstep(-.1,0.,rd.y)*(1.-smoothstep(.5,.6,rd.y));float b2=smoothstep(.66,.72,-rd.x)*(1.-smoothstep(.32,.38,abs(rd.z)))*smoothstep(-.1,0.,rd.y)*(1.-smoothstep(.5,.6,rd.y));float c=smoothstep(.72,.78,-rd.z)*(1.-smoothstep(.2,.26,abs(rd.x)))*smoothstep(.04,.1,rd.y)*(1.-smoothstep(.34,.4,rd.y));col+=vec3(3.2,3.2,3.4)*a+vec3(1.9,2.2,2.7)*b1+vec3(2.7,2.3,1.9)*b2+vec3(2.4)*c;}\n#endif\n#ifdef CUBE\ngl_FragColor=vec4(sqrt(min(col,vec3(4.))*.25),1.);\n#else\n'+
 'gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);\n#endif\n}',
 /* ---- terrain clipmap: one static NxN grid drawn once per level, displaced by the height texture ---- */
 terV:'attribute vec2 aIJ;uniform mat4 uVP;uniform vec4 uLv;varying vec3 vW;varying vec3 vN;varying float vK;\n'+HSRC+
 'const float N=64.;void main(){vec2 ij=aIJ;float c=uLv.z;vec2 p=uLv.xy+(ij-N*.5)*c;vec2 q=abs(ij-N*.5)/(N*.5);float d=max(q.x,q.y);float k=clamp((d-.72)/.22,0.,1.);float h=Hn(p);'+
  'if(k>0.){vec2 par=mod(ij,2.);float hc=h;'+
   'if(par.x>.5&&par.y<.5)hc=.5*(Hn(p-vec2(c,0.))+Hn(p+vec2(c,0.)));else if(par.y>.5&&par.x<.5)hc=.5*(Hn(p-vec2(0.,c))+Hn(p+vec2(0.,c)));else if(par.x>.5&&par.y>.5)hc=.5*(Hn(p-vec2(c,c))+Hn(p+vec2(c,c)));'+
   'h=mix(h,hc,k);}'+
  'float cn=c*(1.+k);vec3 n=vec3(Hn(p-vec2(cn,0.))-Hn(p+vec2(cn,0.)),2.*cn,Hn(p-vec2(0.,cn))-Hn(p+vec2(0.,cn)));vN=n;vK=k;vW=vec3(p.x,h,p.y);gl_Position=uVP*vec4(vW,1.);}',
 terF:PRE+'varying vec3 vW;varying vec3 vN;varying float vK;uniform vec3 uHole;uniform sampler2D uCol,uNz;uniform float uHalf;\n'+ENVSRC+SHSRC+CSHSRC+
 'void main(){if(abs(vW.x-uHole.x)<uHole.z&&abs(vW.z-uHole.y)<uHole.z)discard;vec3 n=normalize(vN);vec2 uv=(vW.xz+uHalf)/(2.*uHalf);vec3 a=texture2D(uCol,uv).rgb;a=a*a;'+
  'float dist=length(vW-uCam);float dt=exp(-dist*.0035);float n1=texture2D(uNz,vW.xz*.11).r,n2=texture2D(uNz,vW.xz*.0123).g,n3=texture2D(uNz,vW.xz*.7).b;'+
  'a*=1.+(((n1-.5)*.55+(n2-.5)*.5)*dt+(n3-.5)*.3*exp(-dist*.02));'+
  /* grass: patches of yellower and deeper green, blades and clumps close up, bumps that catch the sun */
  '\n#ifdef DET\nfloat gr=smoothstep(.0,.07,a.g-a.r*1.05);float hp=texture2D(uNz,vW.xz*.0043).b,hq=texture2D(uNz,vW.xz*.019).r;a=mix(a,a*mix(vec3(1.1,1.0,.76),vec3(.84,1.0,1.08),hp),gr*.7*(.5+.5*dt));a*=1.+(hq-.5)*.35*gr;\n'+
  'float bl=texture2D(uNz,vW.xz*2.3).g,bl2=texture2D(uNz,vW.xz*6.1).r;a*=1.+((bl-.5)*.55+(bl2-.5)*.4)*exp(-dist*.03)*(.35+.65*gr);\n'+
  'vec2 bp=vW.xz*1.35;float b0=texture2D(uNz,bp).r;n=normalize(n+vec3((b0-texture2D(uNz,bp+vec2(.03,0.)).r)*4.,0.,(b0-texture2D(uNz,bp+vec2(0.,.03)).r)*4.)*exp(-dist*.04)*.6);\n#endif\n'+
  'float rk=smoothstep(.78,.52,n.y);a=mix(a,vec3(.2,.185,.17)*(.7+.7*n1),rk*.8);'+
  'float ds=clamp((uGr.x-.72)/.4,0.,1.);a=mix(vec3(dot(a,vec3(.33))),a,mix(.78,1.,ds))*mix(vec3(.80,.83,.82),vec3(.95,.92,.86),ds);float nl=max(dot(n,uSun),0.);vec3 irr=mix(uAmbB,uAmbT,n.y*.5+.5)+uSunC*nl;vec3 col=a*irr;\n#ifdef SHADOW\ncol*=shadowAt(vW);\n#endif\ncol*=csh(vW.xz);col+=skyc(reflect(normalize(vW-uCam),n))*.035*(1.-n.y*.4);col=fogm(col,vW);gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}',
 /* ---- water: one big quad that follows the camera, depth from the height texture ---- */
 watV:'attribute vec2 aP;uniform mat4 uVP;uniform vec3 uCam;varying vec3 vW;void main(){vW=vec3(uCam.x+aP.x*16000.,0.,uCam.z+aP.y*16000.);gl_Position=uVP*vec4(vW,1.);}',
 watF:PRE+'varying vec3 vW;uniform sampler2D uNz;\n'+ENVSRC+HSRC+
 'void main(){float dp=max(-Hb(vW.xz),0.);float t=uFogP.w;vec2 p=vW.xz;'+
  'vec2 w1=vec2(sin(p.x*.045+t*.9)+sin(p.y*.031-t*.7),cos(p.y*.052+t*.8)+cos(p.x*.027+t*.6))*.13;'+
  'vec2 w2=(texture2D(uNz,p*.021+vec2(t*.01,t*.007)).rg+texture2D(uNz,p*.057-vec2(t*.013,t*.02)).gb-1.)*.5;'+
  'vec3 n=normalize(vec3(w1.x+w2.x,1.,w1.y+w2.y));vec3 V=normalize(uCam-vW);float ndv=max(dot(n,V),0.);float fr=.02+.98*pow(1.-ndv,5.);'+
  'vec3 R=reflect(-V,n);vec3 base=mix(vec3(.06,.30,.32),vec3(.008,.045,.11),1.-exp(-dp*.12));vec3 col=mix(base,skyc(vec3(R.x,abs(R.y),R.z)),fr);'+
  'col+=uSunC*pow(max(dot(R,uSun),0.),240.)*2.2;float fo=smoothstep(2.2,0.,dp)*(.55+.45*w2.x*4.);col=mix(col,vec3(.9,.92,.9),clamp(fo,0.,1.)*.7);'+
  'float al=clamp(.45+dp*.35,0.,1.)*smoothstep(0.,.25,dp+.05);col=fogm(col,vW);gl_FragColor=vec4(tone(col),al);}',
 /* ---- road ribbon: markings are analytic (no texture), a = (lateral m, along m, half width, lanes*16+style) ---- */
 rdV:'attribute vec3 aP;attribute vec4 aA;uniform mat4 uVP;varying vec3 vW;varying vec4 vA;void main(){vW=aP;vA=aA;gl_Position=uVP*vec4(aP,1.);}',
 rdF:PRE+'varying vec3 vW;varying vec4 vA;uniform sampler2D uNz;uniform float uWet;\n#ifndef NL\n#define NL 4\n#endif\nuniform vec4 uLt[NL];uniform vec3 uLc[NL];\n'+ENVSRC+SHSRC+CSHSRC+
 'float ln(float x,float c,float w,float aa){return 1.-smoothstep(w,w+aa,abs(x-c));}\n'+
 'void main(){float x=vA.x,v=vA.y,hw=vA.z,fl=vA.w;float lanes=floor(fl/16.);float ax=abs(x);float dist=length(vW-uCam);float aa=.05+dist*.0009;'+
  'vec3 asph=vec3(.075,.075,.08);float nz=texture2D(uNz,vW.xz*.31).r*.6+texture2D(uNz,vW.xz*.045).g*.4;asph*=.78+.5*nz;\n#ifdef DET\n'+
  /* aggregate grain, darker repair patches, hairline cracks, seams across the road */
  'float g1=texture2D(uNz,vW.xz*1.9).b,g2=texture2D(uNz,vW.xz*5.3).g;asph*=1.+((g1-.5)*.6+(g2-.5)*.5)*exp(-dist*.03);asph*=1.-smoothstep(.62,.7,texture2D(uNz,vW.xz*.021+.3).r)*.26;\n'+
  'float cr=abs(texture2D(uNz,vW.xz*.13).g-.5);asph*=1.-(1.-smoothstep(.0,.011,cr))*smoothstep(.46,.6,texture2D(uNz,vW.xz*.011).r)*exp(-dist*.05)*.55;\n'+
  'float sq=fract(vA.y/23.);asph*=1.-(1.-smoothstep(.0,.0035,min(sq,1.-sq)))*.3*(1.-smoothstep(12.,70.,dist));\n#endif\n'+
  /* style (0 two-way, 1 divided, 2 patch, 3 city street, 4 boulevard) and the junction fade mk travel in one number: style + .1 + .8 mk */
  'float sf=fl-lanes*16.;float style=floor(sf);float mkf=clamp((sf-style-.1)/.8,0.,1.);'+
  'bool dv=(style>.5&&style<1.5)||style>3.5;bool tw=style<.5||(style>2.5&&style<3.5);'+
  'float x0=dv?1.35:.2;float lw=(hw-.55-x0)/max(lanes,1.);float wh=0.;float ye=0.;'+
  /* edge lines (solid white) */
  'wh+=ln(ax,hw-.55,.11,aa);'+
  /* two-way: double yellow centre line; divided: median strip with a yellow line each side; patch: edge lines only */
  'if(tw){ye+=ln(ax,.2,.07,aa);}else if(dv){float md=(1.-smoothstep(.95,1.1,ax))*mkf;asph=mix(asph,vec3(.28,.27,.25),md);ye+=ln(ax,1.35,.08,aa);}'+
  /* dashed white lines between the lanes of each direction (same lane width as the traffic lane graph) */
  'if(tw||dv){float d=fract(v/12.);float on=step(d,dv?.26:.28);for(int i=1;i<5;i++){if(float(i)<lanes)wh+=ln(ax,x0+float(i)*lw,.07,aa)*on;}}'+
  /* markings fade out towards junctions */
  'wh*=mkf;ye*=mkf;'+
  /* beside the asphalt: a gravel shoulder, or in town a curb (its face in shadow, a pale curb stone) and a sidewalk of paving slabs */
  'bool cty=style>2.5&&style<4.5;float so=ax-hw;float shd=cty?smoothstep(0.,.1,so):smoothstep(-.1,.35,so);vec3 sdc=cty?vec3(.46,.45,.43):vec3(.30,.27,.22);'+
  'if(cty&&so>0.){float face=1.-smoothstep(.17,.2,so);float stone=smoothstep(.19,.2,so)*(1.-smoothstep(.5,.52,so));float jn=min(min(abs(fract(v/1.6)-.5)*1.6,abs(so-.52)),abs(so-2.06));'+
  'float jl=(1.-smoothstep(0.,.03+aa*.6,jn))*step(.5,so)*exp(-dist*.025);sdc*=(1.-.5*face)*(1.+.22*stone)*(1.-.3*jl);}'+
  'asph=mix(asph,sdc*(.8+.4*nz),shd);wh*=1.-shd;ye*=1.-shd;'+
  '\n#ifdef DET\nfloat lcn=(ax-x0)/lw;float fl2=abs(fract(lcn)-.5)*lw;float trk=exp(-pow((fl2-.82)/.34,2.))*step(0.,lcn)*step(lcn,lanes)*(1.-smoothstep(hw-.6,hw,ax))*(tw||dv?1.:0.);asph*=1.-trk*.2;asph*=1.+(1.-trk)*.04;\n#endif\n'+
  'vec3 alb=asph+vec3(.85)*wh+vec3(.8,.58,.08)*ye;'+
  /* wet: darker, puddles that act like mirrors, ripples in the surface, a reflection of the sky and of every light near the car */
  'float pz=texture2D(uNz,vW.xz*.017).g*.55+texture2D(uNz,vW.xz*.071).b*.45;float pud=smoothstep(.5,.68,pz)*uWet*(1.-shd);'+
  'alb*=1.-uWet*.42*(1.-shd*.5);alb*=1.-pud*.3;'+
  'vec3 V=normalize(uCam-vW);vec2 rp=(texture2D(uNz,vW.xz*.83).rg-.5)*.09*uWet*(1.-pud*.85)*exp(-dist*.004);vec3 n=normalize(vec3(rp.x,1.,rp.y));'+
  'float ndv=max(dot(n,V),0.);float fr=(.03+.97*pow(1.-ndv,5.))*(.25+.75*uWet)*(1.-shd*.8)*(1.-wh*.55);'+
  'float nl=max(n.y,0.)*0.;vec3 irr=mix(uAmbB,uAmbT,1.)+uSunC*max(uSun.y,0.)*.5;vec3 col=alb*irr;\n#ifdef SHADOW\ncol*=shadowAt(vW);\n#endif\ncol*=csh(vW.xz);\n'+
  'vec3 R=reflect(-V,n);col+=skyc(vec3(R.x,abs(R.y)+.015,R.z))*fr*(.55+.45*pud);'+
  /* lights: a pool of light on the road and a long, view-aligned streak of their reflection */
  'vec2 az=normalize(vW.xz-uCam.xz+1e-4);vec3 pool=vec3(0.),spec=vec3(0.);'+
  'for(int i=0;i<NL;i++){vec3 D=uLt[i].xyz-vW;float d2=dot(D,D);float d=sqrt(d2);vec3 L=D/max(d,.01);float att=clamp(1.-d/uLt[i].w,0.,1.);att*=att;pool+=uLc[i]*(max(L.y,0.)*att);'+
   'vec3 H=normalize(L+V);vec2 o=H.xz/max(H.y,.05);float op=dot(o,az);float oq=dot(o,vec2(-az.y,az.x));float k=mix(1.,.45,pud);'+
   'float st=exp(-(op*op/(.060*k)+oq*oq/(.0022*k)));spec+=uLc[i]*(st*(.8+1.6*pud)/(1.+d*.012));}'+
  'col+=alb*pool*1.1*(1.-shd*.6)+spec*uWet*(1.-shd*.85)*(1.-wh*.5);'+
  'col=fogm(col,vW);gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}',
 /* ---- generic lit props: vertex colour + optional window texture (buildings), baked ambient occlusion in colour ---- */
 prV:'attribute vec3 aP;attribute vec4 aN;attribute vec4 aC;attribute vec2 aU;uniform mat4 uVP;uniform float uT;varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec2 vU;varying float vE;'+
  /* wind: foliage (flag .5) sways by the weight kept in the colour alpha */
  'void main(){vec3 p=aP;float sw=aC.a*step(.3,aN.w)*step(aN.w,.7);p.x+=(sin(uT*1.9+aP.x*.31+aP.z*.17)*.11+sin(uT*3.7+aP.z*.9)*.03)*sw;p.z+=cos(uT*1.6+aP.z*.27+aP.x*.1)*.09*sw;p.y+=sin(uT*2.3+aP.x*.5)*.025*sw;vW=p;vN=aN.xyz;vC=aC.rgb*aC.rgb;vU=aU;vE=aN.w;gl_Position=uVP*vec4(p,1.);}',
 prF:PRE+'varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec2 vU;varying float vE;uniform sampler2D uWin,uFol;uniform float uNight;\n'+ENVSRC+
 'void main(){vec3 n=normalize(vN);float isw=step(.8,vE),em=step(vE,-.5),fol=step(.3,vE)*step(vE,.7);vec4 w=texture2D(uWin,vU);vec3 alb=vC*mix(vec3(1.),w.rgb,isw);\n'+
  /* foliage: the leaf atlas, cut out; lit like a ball (wrapped), glowing a little when the sun is behind it */
  'if(fol>.5){vec4 f=texture2D(uFol,vU);if(f.a<.5)discard;alb=vC*f.rgb*1.9;}\n'+
  'float nl=max(dot(n,uSun),0.);nl=mix(nl,clamp(dot(n,uSun)*.8+.3,0.,1.),fol);vec3 irr=mix(uAmbB,uAmbT,n.y*.5+.5)+uSunC*nl;vec3 col=alb*irr;col+=alb*uSunC*pow(max(dot(normalize(vW-uCam),uSun),0.),3.)*.3*fol;'+
  /* a window is lit if its hash says so (about uNight of them); warm or cool light */
  'vec2 wc=floor(vU)+floor(vW.xz*.5);float hs=fract(sin(dot(wc,vec2(12.9898,78.233))+floor(vW.y*.29)*7.31)*43758.5453);float lit=isw*w.a*step(hs,uNight);'+
  'col+=mix(vec3(1.,.70,.38),vec3(.60,.80,1.),step(.82,fract(hs*7.13)))*lit*(.42+.34*fract(hs*3.7));'+
  'col=mix(col,vC*3.2,em);'+
  /* glass reflects the sky (and a darker ground below the horizon) */
  'if(isw*w.a>.5){vec3 V=normalize(uCam-vW);float fr=pow(1.-max(dot(n,V),0.),3.);col+=envl(reflect(-V,n),.18)*(.1+.65*fr);}'+
  'col=fogm(col,vW);gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}',
 /* ---- car: baked garage mesh, procedural environment reflections, per-vertex material classes ---- */
 carV:'attribute vec4 aP;attribute vec4 aN;attribute vec4 aC;uniform mat4 uVP;uniform mat4 uM;uniform vec4 uMat['+40+'];varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec4 vM;varying vec3 vL;varying vec3 vMn;'+
  'void main(){vec4 w=uM*vec4(aP.xyz,1.);vMn=aN.xyz;vL=aP.xyz*(1./8192.);vW=w.xyz;vN=mat3(uM[0].xyz,uM[1].xyz,uM[2].xyz)*aN.xyz;vC=pow(aC.rgb,vec3(2.2));vM=uMat[int(aN.w*127.+.5)];gl_Position=uVP*w;}',
 carF:PRE+'varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec4 vM;varying vec3 vL;varying vec3 vMn;uniform float uGl,uAlpha,uZc;uniform vec3 uBr,uPaint,uWh;uniform vec4 uDm,uCr,uArch;\n'+ENVSRC+
 /* a fake environment to reflect: dark wet ground, bright hazy horizon, overcast dome, a soft bright patch where the sun is behind the cloud, and a long overhead softbox for the clear-coat highlight line */
 'vec3 cenv(vec3 r,float rg){vec3 c=envl(r,rg);float sd=max(dot(r,uSun),0.);c+=uSunC*pow(sd,mix(240.,12.,rg))*mix(2.4,.14,rg)*step(.0,uSun.y);c+=vec3(.95,.98,1.05)*smoothstep(.16,.02,abs(r.z*.6+r.x*.15))*smoothstep(.5,.85,r.y)*(1.-rg)*.35;return c;}\n'+
 'float h3(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}\n'+
 'void main(){vec3 n=normalize(vN),V=normalize(uCam-vW);if(dot(n,V)<0.)n=-n;float metal=vM.x,rg=vM.y,emis=vM.z,coat=vM.w;vec3 alb=vC;if(coat>.99){alb*=uPaint;alb=min(mix(vec3(dot(alb,vec3(.3,.59,.11))),alb,1.15)*.9,vec3(.44));}'+
  /* damage: a dead head or tail light goes dark (the side from the model x, the kind from the colour) */
  'float isG=step(.8,vM.x)*step(vM.y,.12),sdx=step(0.,vL.x),tl0=step(.8,alb.r)*step(alb.g,.3);float dead=mix(mix(uDm.x,uDm.y,sdx),mix(uDm.z,uDm.w,sdx),tl0)*step(.5,emis);emis*=1.-dead;alb=mix(alb,vec3(.02),dead*.85);'+
  /* grilles and vents: a diamond mesh of bright wires over darkness (the material with roughness 1), fading to its average at a distance so it does not shimmer */
  'if(uWh.x>.5){\n  /* wheels: lettering on the tyre wall, and the spokes smear into a dark disc as the car speeds up */\n  float rr=length(vL.yz)/uWh.y;if(abs(vM.y-.804)<.012){float an=atan(vL.z,vL.y),bd=1.-smoothstep(.015,.03,abs(rr-.835)),dsh=step(.42,fract(an*12.7))*step(.22,fract(an*2.9+.3)),rb2=1.-smoothstep(.008,.016,abs(rr-.74));alb=mix(alb,vec3(.20,.20,.21),clamp(bd*dsh*.85+rb2*.5,0.,1.));}\n  if(abs(vM.x-.588)<.03&&abs(vM.y-.235)<.02){alb=mix(alb,vec3(.08),uWh.z*.65);metal*=1.-uWh.z*.5;}}\n  /* carbon fibre: a twill weave (the material with roughness .31 and clear coat .63), laid out on the plane the panel lies in, fading out with distance */\n  if(abs(vM.y-.31)<.02&&abs(vM.w-.627)<.01){vec3 an=abs(normalize(vMn));vec2 q=an.y>.6?vL.xz:(an.x>.6?vL.zy:vL.xy);q*=105.;float tw=step(.5,fract(q.x+q.y))*step(.5,fract(q.x-q.y)*1.),wv=mix(.55+.9*step(.5,fract(q.x*.5))*step(.5,fract(q.y*.5))*.0+.9*abs(sin(q.x*3.14159))*abs(sin(q.y*3.14159)),.9,smoothstep(3.,10.,length(uCam-vW)));alb*=mix(.35,1.5,wv)*.9+.1;metal=.6;}\n  /* the wheel arches: a crisp black circle round each wheel on the flank (drawn per pixel, so the edge is a clean curve and not a row of mesh teeth) */\n  if(uWh.x<.5&&abs(vL.x)>.3&&vM.x<.7){vec2 d1=vec2(vL.z-uArch.x,vL.y-uArch.y),d2=vec2(vL.z-uArch.z,vL.y-uArch.w);float ar=1.-smoothstep(0.,.01,min(length(d1)-(uArch.y+.056),length(d2)-(uArch.w+.056)));alb=mix(alb,vec3(.008),ar*.98);metal*=1.-ar;coat*=1.-ar;emis*=1.-ar;}\n  float grl=step(.98,vM.y);if(grl>.5){float a1=fract((vL.x+vL.y)*44.),a2=fract((vL.x-vL.y)*44.);float mshw=mix(step(.2,a1)*step(.2,a2),.55,smoothstep(7.,18.,length(uCam-vW)));alb=mix(vec3(.34,.35,.37),vec3(.004),mshw);metal=.85*(1.-mshw);rg=mix(.25,1.,mshw);}'+
  /* metallic flakes in the paint: a tiny, view-dependent sparkle from a hash of the position */
  'vec3 fq=floor(vW*140.);n=normalize(n+(vec3(h3(fq),h3(fq+3.1),h3(fq+7.7))-.5)*.016*coat);'+
  'float ndv=max(dot(n,V),0.);vec3 R=reflect(-V,n);'+
  'float nl=max(dot(n,uSun),0.);vec3 irr=mix(uAmbB,uAmbT,n.y*.5+.5)+uSunC*nl*.42;float ao=.35+.65*smoothstep(0.,.45,vW.y-uBr.y);'+
  /* road dirt and spray thrown up the lower body */
  'float dirt=smoothstep(.62,.12,vW.y-uBr.y);alb*=1.-dirt*.38*(1.-emis);'+
  'vec3 F0=mix(vec3(.04),alb,metal);vec3 fr=F0+(1.-F0)*pow(1.-ndv,5.);vec3 col=alb*(1.-metal)*irr*ao;'+
  'col+=cenv(R,max(rg,.35))*fr*ao*mix(.35,1.,metal);'+
  /* clear coat: a second, sharper reflection over the paint */
  'col+=cenv(R,.05)*(.09+.91*pow(1.-ndv,5.))*coat*1.3*(1.-dirt*.5);'+
  /* glass: a clear reflection of the sky, strong at a glancing angle */
  'col+=isG*envl(R,.04)*(.09+.91*pow(1.-ndv,3.))*.95;'+
  /* lights: the emissive material is the head and tail lights (red ones glow harder on the brakes) */
  'float tail=step(.8,alb.r)*step(alb.g,.3);col+=alb*emis*(2.2+uGl*2.)+tail*emis*uBr.x*2.4*vec3(1.,.12,.06);'+
  'col=fogm(col,vW);'+
  /* cracked glass: lines of a cell pattern, spreading from a point as the zone next to the window takes damage */
  'float crk=0.;if(isG>.5){vec3 nn=normalize(vN);float fa=abs(nn.z),amt=fa>.45?(vL.z<uZc?uCr.x:uCr.y):mix(uCr.z,uCr.w,sdx);\n'+
  ' if(amt>.01){vec2 uv=fa>.45?vL.xy:vec2(vL.z,vL.y),cen=fa>.45?vec2(.2,1.):vec2(uZc,.95);float mk=1.-smoothstep(.7,1.,length(uv-cen)/(amt*1.6+.001));vec2 uu=uv*9.,ip=floor(uu),fp=fract(uu);float d1=9.,d2=9.;\n'+
  '  for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++){vec2 g=vec2(float(i),float(j));vec2 o=vec2(h3(vec3(ip+g,1.)),h3(vec3(ip+g,7.)));vec2 r=g+o-fp;float d=dot(r,r);if(d<d1){d2=d1;d1=d;}else if(d<d2){d2=d;}}\n'+
  '  crk=(1.-smoothstep(0.,.07+.1*(1.-amt),sqrt(d2)-sqrt(d1)))*mk;}}\n'+
  'col=mix(col,vec3(.86,.9,.95),crk*.8);float al=max(mix(uAlpha,1.,pow(1.-ndv,4.)*.7*step(uAlpha,.99)),crk*.93);gl_FragColor=vec4(tone(col),al);}',
  /* ---- traffic cars: instanced low-poly bodies; per instance x,y,z,yaw | pitch,roll,colour,flags (1 brake lights, 2 siren) ---- */
 trV:'attribute vec3 aP;attribute vec4 aN;attribute vec4 aI0;attribute vec4 aI1;attribute vec4 aI2;attribute vec4 aI3;attribute vec4 aI4;uniform mat4 uVP;uniform vec3 uPal[14];uniform vec4 uMat[14];uniform vec4 uHg[4];uniform float uT;varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec2 vE;varying float vD;\n'+
  'vec3 rt(vec3 p,float cy,float sy,float cp,float sp,float cr,float sr){float x=p.x*cr-p.y*sr,y=p.x*sr+p.y*cr,z=p.z;float y2=y*cp+z*sp,z2=z*cp-y*sp;return vec3(cy*x+sy*z2,y2,sy*x-cy*z2);}\n'+
  /* dents: up to two per car (centre x,z on the body, depth, radius), the metal near them is pushed in towards the middle of the car and crumpled */
  'float dent(inout vec3 p,vec4 d){if(d.z<=0.)return 0.;vec3 dv=p-vec3(d.x,.62,d.y);float w=exp(-dot(dv,dv)/(d.w*d.w));vec2 dir=-normalize(d.xy+vec2(1e-4));float n=.7+.6*fract(sin(dot(floor(p*9.),vec3(12.9898,78.233,37.719)))*43758.5453);p.xz+=dir*d.z*w*n;p.y-=d.z*w*.22;return w*min(1.,d.z*4.);}\n'+
  'void main(){vec3 p=aP;float dm=max(dent(p,aI2),max(dent(p,aI3),dent(p,aI4)));\n'+
  /* panels that spring open on a damaged car (flag bits 16 bonnet, 32 boot, 64 right door, 128 left door; the part number rides in the high bits of the material byte) */
  'int idr=int(aN.w*127.+.5);float pt=floor(float(idr)/16.+.01);\n'+
  'if(pt>.5){float bit=pt<1.5?16.:(pt<2.5?32.:(pt<3.5?64.:128.));if(mod(floor(aI1.w/bit+.01),2.)>.5){vec4 h=uHg[int(pt+.01)-1];float a=h.w+sin(uT*(pt<2.5?9.:3.)+aI0.x*.7)*(pt<2.5?.06:.09);float c0=cos(a),s0=sin(a);vec3 q=p;\n'+
  '  if(pt<2.5){float dy=q.y-h.y,dz=q.z-h.z;q.y=h.y+dy*c0+dz*s0;q.z=h.z-dy*s0+dz*c0;}else{float dx=q.x-h.x,dz=q.z-h.z;q.x=h.x+dx*c0+dz*s0;q.z=h.z-dx*s0+dz*c0;}p=q;}}\n'+
  'float cy=cos(aI0.w),sy=sin(aI0.w),cp=cos(aI1.x),sp=sin(aI1.x),cr=cos(aI1.y),sr=sin(aI1.y);vec3 w=rt(p,cy,sy,cp,sp,cr,sr)+aI0.xyz;vW=w;vN=rt(aN.xyz,cy,sy,cp,sp,cr,sr);'+
  'int id=idr-int(pt+.01)*16;vec4 mt=uMat[id];float fw=aI1.w,br=mod(fw,2.),sir=mod(floor(fw/2.+.01),2.),stb=mod(floor(fw/4.+.01),2.),brk=mod(floor(fw/8.+.01),2.);vec3 alb=mt.rgb;float em=max(mt.a,0.);if(mt.a<-.5){alb=uPal[int(aI1.z+.5)];}if(id==4)em+=br*2.4;if((id==3||id==4)&&brk>.5){em=0.;alb=vec3(.03,.03,.035);}if(id==7||id==8){float ph=step(0.,sin(uT*12.)),ps=step(0.,sin(uT*2.6));em+=sir*(id==7?ph*5.+.1:(1.-ph)*5.+.1)+stb*(id==7?ps*1.8:(1.-ps)*1.8);}'+
  'vC=alb*(1.-.55*dm);vD=dm;vE=vec2(em,(id==1?1.:(id==0?.5:.12))*(1.-.7*dm));gl_Position=uVP*vec4(w,1.);}',
 trF:PRE+'varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec2 vE;varying float vD;\n'+ENVSRC+
  'void main(){vec3 n=normalize(vN),V=normalize(uCam-vW);if(dot(n,V)<0.)n=-n;float ndv=max(dot(n,V),0.);vec3 R=reflect(-V,n);float nl=max(dot(n,uSun),0.);vec3 irr=mix(uAmbB,uAmbT,n.y*.5+.5)+uSunC*nl*.9;'+
  'vec3 col=vC*irr*.9;float fr=.04+.96*pow(1.-ndv,5.);col+=skyc(R)*fr*vE.y*1.1;col+=vC*vE.x*1.3;col=fogm(col,vW);gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}',
 /* ---- effects: ground decals (blob shadow, skid marks) and camera-facing smoke, one dynamic buffer ---- */
 fxV:'attribute vec3 aP;attribute vec4 aC;attribute vec2 aU;uniform mat4 uVP;varying vec4 vC;varying vec2 vU;void main(){vC=aC;vU=aU;gl_Position=uVP*vec4(aP,1.);}',
 fxF:PRE+'varying vec4 vC;varying vec2 vU;uniform float uMode,uQ;\n'+
 'float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n'+
 'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1.,0.)),f.x),mix(h2(i+vec2(0.,1.)),h2(i+vec2(1.,1.)),f.x),f.y);}\n'+
 /* modes: 0 blob shadow, 1 smoke/spray (a puff number rides in the whole part of u), 2 skid mark, 3 garage pad, 4 glow sprite (added), 5 light pool, 6 beam (v along), 7 spark streak, 8 glow sprite (plain blending: a saturated colour even on a bright sky) */
 'void main(){float sd=floor(vU.x);vec2 q=vec2(vU.x-sd,vU.y);float d=length(q-.5)*2.;float a;'+
  'if(uMode<.5)a=1.-smoothstep(.3,1.,d);'+
  'else if(uMode<1.5){a=1.-smoothstep(.0,1.,d);if(uQ>.5){vec2 c=(q-.5)*2.;float an=sd*1.7,cs=cos(an),sn=sin(an);c=vec2(cs*c.x-sn*c.y,sn*c.x+cs*c.y);float n=vn(c*2.2+sd*3.1)*.6+vn(c*5.3+sd)*.4;a*=smoothstep(.12,.72,n+.38-d*.45);}}'+
  'else if(uMode<2.5)a=1.-smoothstep(.6,1.,abs(q.x-.5)*2.);'+
  'else if(uMode<3.5){vec2 w=abs(q-.5)*2.;float e=max(w.x,w.y);a=(.2+smoothstep(.62,.9,e)*.8)*(1.-smoothstep(.94,1.,e));}'+
  'else if(uMode<4.5||uMode>7.5){vec2 c=(q-.5)*2.;float r2=dot(c,c);a=exp(-r2*5.5)*.8+exp(-sqrt(r2)*6.)*.3+.22*(exp(-abs(c.x)*16.)*exp(-abs(c.y)*1.8)+exp(-abs(c.y)*16.)*exp(-abs(c.x)*1.8));a*=1.-smoothstep(.85,1.,sqrt(r2));if(uMode>7.5)a=min(1.,a*1.5);}'+
  'else if(uMode<5.5){float t=1.-smoothstep(0.,1.,d);a=t*t;}'+
  'else if(uMode<6.5){float v=abs(q.x-.5)*2.;a=pow(max(1.-q.y,0.),1.5)*(1.-v*v)*(1.-v)*smoothstep(0.,.06,q.y);}'+
  'else{float v=abs(q.y-.5)*2.;a=(1.-v)*(1.-v)*(.3+.7*(1.-q.x));}'+
  'gl_FragColor=vec4(vC.rgb,a*vC.a);}'
};
function glCompile(gl,type,src,name){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const e=gl.getShaderInfoLog(s);throw new Error('shader '+name+(type==gl.VERTEX_SHADER?' VS':' FS')+': '+e)}return s}
function mkProg(name,vs,fs,attrs,defs){const gl=G.gl,p=gl.createProgram();if(defs){const d=Object.keys(defs).map(k=>'#define '+k+' '+defs[k]+'\n').join('');fs=fs.startsWith(PRE)?PRE+d+fs.slice(PRE.length):d+fs;vs=d+vs}
 gl.attachShader(p,glCompile(gl,gl.VERTEX_SHADER,vs,name));gl.attachShader(p,glCompile(gl,gl.FRAGMENT_SHADER,fs,name));attrs.forEach((a,i)=>gl.bindAttribLocation(p,i,a));gl.linkProgram(p);
 if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error('link '+name+': '+gl.getProgramInfoLog(p));
 const u={},n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);for(let i=0;i<n;i++){const a=gl.getActiveUniform(p,i),nm=a.name.replace(/\[0\]$/,'');u[nm]=gl.getUniformLocation(p,a.name)}
 return{p,u,n:attrs.length,name}}
function glInit(cv,aa){const at={antialias:!!aa,alpha:false,depth:true,stencil:false,powerPreference:'high-performance',preserveDrawingBuffer:!!window.__keepBuf};
 let gl=cv.getContext('webgl',at)||cv.getContext('experimental-webgl',at);if(!gl){at.antialias=false;gl=cv.getContext('webgl',at)||cv.getContext('experimental-webgl',at)}
 if(!gl)throw new Error('This browser has no WebGL.');G.gl=gl;G.cv=cv;
 if(gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)<1)throw new Error('This GPU cannot read textures in the vertex shader (needed for the terrain).');
 G.ext.inst=gl.getExtension('ANGLE_instanced_arrays');G.ext.u32=gl.getExtension('OES_element_index_uint');G.ext.vao=gl.getExtension('OES_vertex_array_object');
 const an=gl.getExtension('EXT_texture_filter_anisotropic');G.maxAniso=an?gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT):1;G.anExt=an;
 G.aa=!!gl.getContextAttributes().antialias;
 G.P.sky=mkProg('sky',SH.skyV,SH.skyF,['aP']);G.P.skyc=mkProg('skyc',SH.skyV,SH.skyF,['aP'],{CUBE:1});G.P.ter=mkProg('ter',SH.terV,SH.terF,['aIJ']);G.P.wat=mkProg('wat',SH.watV,SH.watF,['aP']);
 G.P.rd=mkProg('rd',SH.rdV,SH.rdF,['aP','aA']);G.P.pr=mkProg('pr',SH.prV,SH.prF,['aP','aN','aC','aU']);
 G.P.car=mkProg('car',SH.carV,SH.carF,['aP','aN','aC']);G.P.tr=mkProg('tr',SH.trV,SH.trF,['aP','aN','aI0','aI1','aI2','aI3','aI4']);G.P.fx=mkProg('fx',SH.fxV,SH.fxF,['aP','aC','aU']);
 return gl}
const mkBuf=(target,data,usage)=>{const gl=G.gl,b=gl.createBuffer();gl.bindBuffer(target,b);gl.bufferData(target,data,usage||gl.STATIC_DRAW);return b};
function mkTex(w,h,data,o){o=o||{};const gl=G.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
 const mip=!!o.mip;gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mip?gl.LINEAR_MIPMAP_LINEAR:(o.near?gl.NEAREST:gl.LINEAR));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,o.near?gl.NEAREST:gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,o.repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,o.repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);
 if(mip){gl.generateMipmap(gl.TEXTURE_2D);if(G.anExt&&o.aniso)gl.texParameterf(gl.TEXTURE_2D,G.anExt.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(4,G.maxAniso))}return t}
function bindTex(unit,t){const gl=G.gl;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t)}
/* enable exactly the first n vertex attributes */
let _attrOn=0;function attrs(n){const gl=G.gl;for(let i=0;i<Math.max(n,_attrOn);i++){if(i<n)gl.enableVertexAttribArray(i);else gl.disableVertexAttribArray(i)}_attrOn=n}
