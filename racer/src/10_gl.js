'use strict';
/* ===== WebGL1 helpers + all shaders. One program per material class, no per-frame allocation. ===== */
const G={gl:null,cv:null,w:1,h:1,P:{},ext:{},maxAniso:1};
const PRE='#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
/* shared lighting / fog / tone chunk (fragment) */
const ENVSRC='uniform vec3 uCam,uSun,uSunC,uAmbT,uAmbB,uHor,uZen;uniform vec4 uFogP;\n'+
/* grade: filmic curve, desaturated (the sky is overcast, the world is grey-green), cool shadows, a touch of contrast */
'vec3 tone(vec3 c){float l=dot(c,vec3(.2126,.7152,.0722));c=max(mix(vec3(l),c,.72),0.);c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);c=pow(clamp(c,0.,1.),vec3(.4545));'+
 'float g=dot(c,vec3(.3333));c*=mix(vec3(.90,.99,1.10),vec3(1.04,1.0,.95),smoothstep(.05,.8,g));return c*c*(3.-2.*c)*.30+c*.70;}\n'+
'vec3 skyc(vec3 r){float y=max(r.y,0.);vec3 c=mix(uHor,uZen,pow(y,.5));float sd=max(dot(r,uSun),0.);return c+uSunC*(pow(sd,6.)*.05);}\n'+
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
const SH={
 /* ---- sky: full-screen triangle ---- */
 skyV:'attribute vec2 aP;varying vec2 vU;void main(){vU=aP;gl_Position=vec4(aP,.99999,1.);}',
 skyF:PRE+'varying vec2 vU;uniform vec3 uFw,uRt,uUp;uniform vec2 uTan;uniform sampler2D uNz;\n'+ENVSRC+
 'void main(){vec3 rd=normalize(uFw+uRt*vU.x*uTan.x+uUp*vU.y*uTan.y);float y=rd.y;float sd=max(dot(rd,uSun),0.);'+
 /* the dome: pale grey-blue overhead, lighter towards the haze at the horizon; below the horizon it is the haze itself */
 'vec3 col=mix(uHor,uZen,pow(clamp(y,0.,1.),.5));col=mix(col,uHor,smoothstep(0.,-.1,y));'+
 'if(y>.004){float yy=max(y,.03);float t=1500./yy;vec2 w=vec2(uFogP.w*.0042,uFogP.w*.0013);vec2 p=(uCam.xz+rd.xz*t)*.00026+w;'+
  /* high layer: thick, broken, darker where thicker; gaps let the lighter dome through */
  'float n=texture2D(uNz,p).r*.55+texture2D(uNz,p*2.7+.37).g*.30;\n#ifdef HI\nn+=texture2D(uNz,p*7.3+.11).b*.15;\n#else\nn+=.075;\n#endif\n'+
  'float th=smoothstep(.34,.72,n);float lit=pow(sd,3.);vec3 hi=mix(vec3(.60,.63,.68),vec3(.27,.29,.34),th)*(.86+.5*lit);col=mix(col,hi,clamp(th*.92+.12,0.,1.)*smoothstep(.004,.16,y));'+
  /* low layer: darker, faster, ragged strips */
  'vec2 p2=(uCam.xz+rd.xz*(700./yy))*.00055+w*2.6+.5;float n2=texture2D(uNz,p2).g*.6+texture2D(uNz,p2*3.1).r*.4;float th2=smoothstep(.5,.82,n2)*.62*smoothstep(.02,.3,y);col=mix(col,vec3(.17,.19,.23)*(.9+.6*lit),th2);}'+
 'col+=uSunC*(pow(sd,5.)*.055+pow(sd,60.)*.05)*smoothstep(-.05,.3,y);'+
 'col=mix(col,uHor,exp(-max(y,0.)*7.)*.55);'+
 'gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}',
 /* ---- terrain clipmap: one static NxN grid drawn once per level, displaced by the height texture ---- */
 terV:'attribute vec2 aIJ;uniform mat4 uVP;uniform vec4 uLv;varying vec3 vW;varying vec3 vN;varying float vK;\n'+HSRC+
 'const float N=64.;void main(){vec2 ij=aIJ;float c=uLv.z;vec2 p=uLv.xy+(ij-N*.5)*c;vec2 q=abs(ij-N*.5)/(N*.5);float d=max(q.x,q.y);float k=clamp((d-.72)/.22,0.,1.);float h=Hn(p);'+
  'if(k>0.){vec2 par=mod(ij,2.);float hc=h;'+
   'if(par.x>.5&&par.y<.5)hc=.5*(Hn(p-vec2(c,0.))+Hn(p+vec2(c,0.)));else if(par.y>.5&&par.x<.5)hc=.5*(Hn(p-vec2(0.,c))+Hn(p+vec2(0.,c)));else if(par.x>.5&&par.y>.5)hc=.5*(Hn(p-vec2(c,c))+Hn(p+vec2(c,c)));'+
   'h=mix(h,hc,k);}'+
  'float cn=c*(1.+k);vec3 n=vec3(Hn(p-vec2(cn,0.))-Hn(p+vec2(cn,0.)),2.*cn,Hn(p-vec2(0.,cn))-Hn(p+vec2(0.,cn)));vN=n;vK=k;vW=vec3(p.x,h,p.y);gl_Position=uVP*vec4(vW,1.);}',
 terF:PRE+'varying vec3 vW;varying vec3 vN;varying float vK;uniform vec3 uHole;uniform sampler2D uCol,uNz;uniform float uHalf;\n'+ENVSRC+SHSRC+
 'void main(){if(abs(vW.x-uHole.x)<uHole.z&&abs(vW.z-uHole.y)<uHole.z)discard;vec3 n=normalize(vN);vec2 uv=(vW.xz+uHalf)/(2.*uHalf);vec3 a=texture2D(uCol,uv).rgb;a=a*a;'+
  'float dist=length(vW-uCam);float dt=exp(-dist*.0035);float n1=texture2D(uNz,vW.xz*.11).r,n2=texture2D(uNz,vW.xz*.0123).g,n3=texture2D(uNz,vW.xz*.7).b;'+
  'a*=1.+(((n1-.5)*.55+(n2-.5)*.5)*dt+(n3-.5)*.3*exp(-dist*.02));'+
  'float rk=smoothstep(.78,.52,n.y);a=mix(a,vec3(.2,.185,.17)*(.7+.7*n1),rk*.8);'+
  'a=mix(vec3(dot(a,vec3(.33))),a,.78)*vec3(.80,.83,.82);float nl=max(dot(n,uSun),0.);vec3 irr=mix(uAmbB,uAmbT,n.y*.5+.5)+uSunC*nl;vec3 col=a*irr;\n#ifdef SHADOW\ncol*=shadowAt(vW);\n#endif\ncol+=skyc(reflect(normalize(vW-uCam),n))*.035*(1.-n.y*.4);col=fogm(col,vW);gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}',
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
 rdF:PRE+'varying vec3 vW;varying vec4 vA;uniform sampler2D uNz;uniform float uWet;\n#ifndef NL\n#define NL 4\n#endif\nuniform vec4 uLt[NL];uniform vec3 uLc[NL];\n'+ENVSRC+SHSRC+
 'float ln(float x,float c,float w,float aa){return 1.-smoothstep(w,w+aa,abs(x-c));}\n'+
 'void main(){float x=vA.x,v=vA.y,hw=vA.z,fl=vA.w;float lanes=floor(fl/16.);float ax=abs(x);float dist=length(vW-uCam);float aa=.05+dist*.0009;'+
  'vec3 asph=vec3(.075,.075,.08);float nz=texture2D(uNz,vW.xz*.31).r*.6+texture2D(uNz,vW.xz*.045).g*.4;asph*=.78+.5*nz;'+
  /* style (0 two-way, 1 divided, 2 patch, 3 city street, 4 boulevard) and the junction fade mk travel in one number: style + .1 + .8 mk */
  'float sf=fl-lanes*16.;float style=floor(sf);float mkf=clamp((sf-style-.1)/.8,0.,1.);'+
  'bool dv=(style>.5&&style<1.5)||style>3.5;bool tw=style<.5||(style>2.5&&style<3.5);'+
  'float x0=dv?1.35:.2;float lw=(hw-.55-x0)/max(lanes,1.);float wh=0.;float ye=0.;'+
  /* edge lines (solid white) */
  'wh+=ln(ax,hw-.55,.11,aa);'+
  /* two-way: double yellow centre line; divided: median strip with a yellow line each side; patch: edge lines only */
  'if(tw){ye+=ln(ax,.2,.07,aa);}else if(dv){float md=1.-smoothstep(.95,1.1,ax);asph=mix(asph,vec3(.28,.27,.25),md);ye+=ln(ax,1.35,.08,aa);}'+
  /* dashed white lines between the lanes of each direction (same lane width as the traffic lane graph) */
  'if(tw||dv){float d=fract(v/12.);float on=step(d,dv?.26:.28);for(int i=1;i<5;i++){if(float(i)<lanes)wh+=ln(ax,x0+float(i)*lw,.07,aa)*on;}}'+
  /* markings fade out towards junctions */
  'wh*=mkf;ye*=mkf;'+
  'float shd=smoothstep(hw-.1,hw+.35,ax);/* shoulder: gravel */asph=mix(asph,(style>2.5&&style<4.5?vec3(.46,.45,.43):vec3(.30,.27,.22))*(.8+.4*nz),shd);wh*=1.-shd;ye*=1.-shd;'+
  'vec3 alb=asph+vec3(.85)*wh+vec3(.8,.58,.08)*ye;'+
  /* wet: darker, puddles that act like mirrors, ripples in the surface, a reflection of the sky and of every light near the car */
  'float pz=texture2D(uNz,vW.xz*.017).g*.55+texture2D(uNz,vW.xz*.071).b*.45;float pud=smoothstep(.5,.68,pz)*uWet*(1.-shd);'+
  'alb*=1.-uWet*.42*(1.-shd*.5);alb*=1.-pud*.3;'+
  'vec3 V=normalize(uCam-vW);vec2 rp=(texture2D(uNz,vW.xz*.83).rg-.5)*.09*uWet*(1.-pud*.85)*exp(-dist*.004);vec3 n=normalize(vec3(rp.x,1.,rp.y));'+
  'float ndv=max(dot(n,V),0.);float fr=(.03+.97*pow(1.-ndv,5.))*(.25+.75*uWet)*(1.-shd*.8)*(1.-wh*.55);'+
  'float nl=max(n.y,0.)*0.;vec3 irr=mix(uAmbB,uAmbT,1.)+uSunC*max(uSun.y,0.)*.5;vec3 col=alb*irr;\n#ifdef SHADOW\ncol*=shadowAt(vW);\n#endif\n'+
  'vec3 R=reflect(-V,n);col+=skyc(vec3(R.x,abs(R.y)+.015,R.z))*fr*(.55+.45*pud);'+
  /* lights: a pool of light on the road and a long, view-aligned streak of their reflection */
  'vec2 az=normalize(vW.xz-uCam.xz+1e-4);vec3 pool=vec3(0.),spec=vec3(0.);'+
  'for(int i=0;i<NL;i++){vec3 D=uLt[i].xyz-vW;float d2=dot(D,D);float d=sqrt(d2);vec3 L=D/max(d,.01);float att=clamp(1.-d/uLt[i].w,0.,1.);att*=att;pool+=uLc[i]*(max(L.y,0.)*att);'+
   'vec3 H=normalize(L+V);vec2 o=H.xz/max(H.y,.05);float op=dot(o,az);float oq=dot(o,vec2(-az.y,az.x));float k=mix(1.,.45,pud);'+
   'float st=exp(-(op*op/(.060*k)+oq*oq/(.0022*k)));spec+=uLc[i]*(st*(.8+1.6*pud)/(1.+d*.012));}'+
  'col+=alb*pool*1.1*(1.-shd*.6)+spec*uWet*(1.-shd*.85)*(1.-wh*.5);'+
  'col=fogm(col,vW);gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}',
 /* ---- generic lit props: vertex colour + optional window texture (buildings), baked ambient occlusion in colour ---- */
 prV:'attribute vec3 aP;attribute vec4 aN;attribute vec4 aC;attribute vec2 aU;uniform mat4 uVP;varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec2 vU;varying float vE;'+
  'void main(){vW=aP;vN=aN.xyz;vC=aC.rgb*aC.rgb;vU=aU;vE=aN.w;gl_Position=uVP*vec4(aP,1.);}',
 prF:PRE+'varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec2 vU;varying float vE;uniform sampler2D uWin;uniform float uNight;\n'+ENVSRC+
 'void main(){vec3 n=normalize(vN);vec4 w=texture2D(uWin,vU);float isw=step(.01,vE);float em=step(vE,-.5);vec3 alb=vC*mix(vec3(1.),w.rgb,isw);'+
  'float nl=max(dot(n,uSun),0.);vec3 irr=mix(uAmbB,uAmbT,n.y*.5+.5)+uSunC*nl;vec3 col=alb*irr;'+
  /* a window is lit if its hash says so (about uNight of them); warm or cool light */
  'vec2 wc=floor(vU)+floor(vW.xz*.5);float hs=fract(sin(dot(wc,vec2(12.9898,78.233))+floor(vW.y*.29)*7.31)*43758.5453);float lit=isw*w.a*step(hs,uNight);'+
  'col+=mix(vec3(1.,.70,.38),vec3(.60,.80,1.),step(.82,fract(hs*7.13)))*lit*(.42+.34*fract(hs*3.7));'+
  'col=mix(col,vC*3.2,em);'+
  'col=fogm(col,vW);gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}',
 /* ---- car: baked garage mesh, procedural environment reflections, per-vertex material classes ---- */
 carV:'attribute vec4 aP;attribute vec4 aN;attribute vec4 aC;uniform mat4 uVP;uniform mat4 uM;uniform vec4 uMat['+40+'];varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec4 vM;'+
  'void main(){vec4 w=uM*vec4(aP.xyz,1.);vW=w.xyz;vN=mat3(uM[0].xyz,uM[1].xyz,uM[2].xyz)*aN.xyz;vC=pow(aC.rgb,vec3(2.2));vM=uMat[int(aN.w*127.+.5)];gl_Position=uVP*w;}',
 carF:PRE+'varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec4 vM;uniform float uGl;uniform vec3 uBr,uPaint;\n'+ENVSRC+
 /* a fake environment to reflect: dark wet ground, bright hazy horizon, overcast dome, a soft bright patch where the sun is behind the cloud, and a long overhead softbox for the clear-coat highlight line */
 'vec3 cenv(vec3 r,float rg){float h=r.y;vec3 gr=uAmbB*.55+vec3(.015);vec3 sk=mix(uHor*1.2,uZen*1.15,smoothstep(.1,.9,h));vec3 c=mix(gr,sk,smoothstep(-.12,.08,h));c=mix(c,uHor*1.35,exp(-abs(h)*9.)*.55);'+
  'float sd=max(dot(r,uSun),0.);c+=uSunC*pow(sd,mix(160.,8.,rg))*mix(2.6,.14,rg);'+
  'c+=vec3(.95,.98,1.05)*smoothstep(.16,.02,abs(r.z*.6+r.x*.15))*smoothstep(.5,.85,h)*(1.-rg)*1.3;return c;}\n'+
 'float h3(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}\n'+
 'void main(){vec3 n=normalize(vN),V=normalize(uCam-vW);if(dot(n,V)<0.)n=-n;float metal=vM.x,rg=vM.y,emis=vM.z,coat=vM.w;vec3 alb=vC;if(coat>.99)alb*=uPaint;'+
  /* metallic flakes in the paint: a tiny, view-dependent sparkle from a hash of the position */
  'vec3 fq=floor(vW*140.);n=normalize(n+(vec3(h3(fq),h3(fq+3.1),h3(fq+7.7))-.5)*.016*coat);'+
  'float ndv=max(dot(n,V),0.);vec3 R=reflect(-V,n);'+
  'float nl=max(dot(n,uSun),0.);vec3 irr=mix(uAmbB,uAmbT,n.y*.5+.5)+uSunC*nl*.9;float ao=.5+.5*smoothstep(0.,.5,vW.y-uBr.y);'+
  /* road dirt and spray thrown up the lower body */
  'float dirt=smoothstep(.62,.12,vW.y-uBr.y);alb*=1.-dirt*.38*(1.-emis);'+
  'vec3 F0=mix(vec3(.04),alb,metal);vec3 fr=F0+(1.-F0)*pow(1.-ndv,5.);vec3 col=alb*(1.-metal)*irr*ao;'+
  'col+=cenv(R,max(rg,.35))*fr*ao*mix(.35,1.,metal);'+
  /* clear coat: a second, sharper reflection over the paint */
  'col+=cenv(R,.12)*(.045+.955*pow(1.-ndv,5.))*coat*.85*(1.-dirt*.6);'+
  /* lights: the emissive material is the head and tail lights (red ones glow harder on the brakes) */
  'float tail=step(.8,alb.r)*step(alb.g,.3);col+=alb*emis*(2.2+uGl*2.)+tail*emis*uBr.x*2.4*vec3(1.,.12,.06);'+
  'col=fogm(col,vW);gl_FragColor=vec4(tone(col),1.);}',
  /* ---- traffic cars: instanced low-poly bodies; per instance x,y,z,yaw | pitch,roll,colour,flags (1 brake lights, 2 siren) ---- */
 trV:'attribute vec3 aP;attribute vec4 aN;attribute vec4 aI0;attribute vec4 aI1;attribute vec4 aI2;attribute vec4 aI3;uniform mat4 uVP;uniform vec3 uPal[14];uniform vec4 uMat[12];uniform float uT;varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec2 vE;varying float vD;\n'+
  'vec3 rt(vec3 p,float cy,float sy,float cp,float sp,float cr,float sr){float x=p.x*cr-p.y*sr,y=p.x*sr+p.y*cr,z=p.z;float y2=y*cp+z*sp,z2=z*cp-y*sp;return vec3(cy*x+sy*z2,y2,sy*x-cy*z2);}\n'+
  /* dents: up to two per car (centre x,z on the body, depth, radius), the metal near them is pushed in towards the middle of the car and crumpled */
  'float dent(inout vec3 p,vec4 d){if(d.z<=0.)return 0.;vec3 dv=p-vec3(d.x,.62,d.y);float w=exp(-dot(dv,dv)/(d.w*d.w));vec2 dir=-normalize(d.xy+vec2(1e-4));float n=.7+.6*fract(sin(dot(floor(p*9.),vec3(12.9898,78.233,37.719)))*43758.5453);p.xz+=dir*d.z*w*n;p.y-=d.z*w*.22;return w*min(1.,d.z*4.);}\n'+
  'void main(){vec3 p=aP;float dm=max(dent(p,aI2),dent(p,aI3));float cy=cos(aI0.w),sy=sin(aI0.w),cp=cos(aI1.x),sp=sin(aI1.x),cr=cos(aI1.y),sr=sin(aI1.y);vec3 w=rt(p,cy,sy,cp,sp,cr,sr)+aI0.xyz;vW=w;vN=rt(aN.xyz,cy,sy,cp,sp,cr,sr);'+
  'int id=int(aN.w*127.+.5);vec4 mt=uMat[id];float fw=aI1.w,br=mod(fw,2.),sir=step(.5,mod(floor(fw*.5+.01),2.)),stb=step(3.5,fw);vec3 alb=mt.rgb;float em=max(mt.a,0.);if(mt.a<-.5){alb=uPal[int(aI1.z+.5)];}if(id==4)em+=br*2.4;if(id==7||id==8){float ph=step(0.,sin(uT*12.)),ps=step(0.,sin(uT*2.6));em+=sir*(id==7?ph*5.+.1:(1.-ph)*5.+.1)+stb*(id==7?ps*1.8:(1.-ps)*1.8);}'+
  'vC=alb*(1.-.55*dm);vD=dm;vE=vec2(em,(id==1?1.:(id==0?.5:.12))*(1.-.7*dm));gl_Position=uVP*vec4(w,1.);}',
 trF:PRE+'varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec2 vE;varying float vD;\n'+ENVSRC+
  'void main(){vec3 n=normalize(vN),V=normalize(uCam-vW);if(dot(n,V)<0.)n=-n;float ndv=max(dot(n,V),0.);vec3 R=reflect(-V,n);float nl=max(dot(n,uSun),0.);vec3 irr=mix(uAmbB,uAmbT,n.y*.5+.5)+uSunC*nl*.9;'+
  'vec3 col=vC*irr;float fr=.04+.96*pow(1.-ndv,5.);col+=skyc(R)*fr*vE.y*1.2;col+=vC*vE.x*1.3;col=fogm(col,vW);gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}',
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
 G.P.sky=mkProg('sky',SH.skyV,SH.skyF,['aP']);G.P.ter=mkProg('ter',SH.terV,SH.terF,['aIJ']);G.P.wat=mkProg('wat',SH.watV,SH.watF,['aP']);
 G.P.rd=mkProg('rd',SH.rdV,SH.rdF,['aP','aA']);G.P.pr=mkProg('pr',SH.prV,SH.prF,['aP','aN','aC','aU']);
 G.P.car=mkProg('car',SH.carV,SH.carF,['aP','aN','aC']);G.P.tr=mkProg('tr',SH.trV,SH.trF,['aP','aN','aI0','aI1','aI2','aI3']);G.P.fx=mkProg('fx',SH.fxV,SH.fxF,['aP','aC','aU']);
 return gl}
const mkBuf=(target,data,usage)=>{const gl=G.gl,b=gl.createBuffer();gl.bindBuffer(target,b);gl.bufferData(target,data,usage||gl.STATIC_DRAW);return b};
function mkTex(w,h,data,o){o=o||{};const gl=G.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
 const mip=!!o.mip;gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mip?gl.LINEAR_MIPMAP_LINEAR:(o.near?gl.NEAREST:gl.LINEAR));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,o.near?gl.NEAREST:gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,o.repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,o.repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);
 if(mip){gl.generateMipmap(gl.TEXTURE_2D);if(G.anExt&&o.aniso)gl.texParameterf(gl.TEXTURE_2D,G.anExt.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(4,G.maxAniso))}return t}
function bindTex(unit,t){const gl=G.gl;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t)}
/* enable exactly the first n vertex attributes */
let _attrOn=0;function attrs(n){const gl=G.gl;for(let i=0;i<Math.max(n,_attrOn);i++){if(i<n)gl.enableVertexAttribArray(i);else gl.disableVertexAttribArray(i)}_attrOn=n}
