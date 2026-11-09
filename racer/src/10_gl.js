'use strict';
/* ===== WebGL1 helpers + all shaders. One program per material class, no per-frame allocation. ===== */
const G={gl:null,cv:null,w:1,h:1,P:{},ext:{},maxAniso:1};
const PRE='#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
/* shared lighting / fog / tone chunk (fragment) */
const ENVSRC='uniform vec3 uCam,uSun,uSunC,uAmbT,uAmbB,uHor,uZen;uniform vec4 uFogP;\n'+
'vec3 tone(vec3 c){float l=dot(c,vec3(.2126,.7152,.0722));c=max(mix(vec3(l),c,1.12),0.);c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);return pow(clamp(c,0.,1.),vec3(.4545));}\n'+
'vec3 skyc(vec3 r){float y=max(r.y,0.);vec3 c=mix(uHor,uZen,pow(y,.42));float sd=max(dot(r,uSun),0.);return c+uSunC*(pow(sd,8.)*.10);}\n'+
'vec3 fogm(vec3 c,vec3 wp){vec3 d=wp-uCam;float L=length(d);vec3 v=d/max(L,1e-3);float k=uFogP.x;float f=1.-exp(-L*L*k*k);f*=exp(-max(wp.y-uCam.y,0.)*uFogP.y);'+
 'float sg=pow(max(dot(v,uSun),0.),5.);vec3 fc=mix(uHor,uHor*.6+uSunC*.32,sg*uFogP.z);return mix(c,fc,clamp(f,0.,1.));}\n';
/* heightmap fetch (RGBA8: R/G = 16-bit height). Hn: exact grid point; Hb: bilinear */
const HSRC='uniform sampler2D uH;uniform vec4 uMap;/* x=half size, y=0.5/N, z=height range, w=height offset */\n'+
'float hdec(vec4 t){return (t.r*255.*256.+t.g*255.)/65535.*uMap.z+uMap.w;}\n'+
'float Hn(vec2 p){return hdec(texture2D(uH,(p+uMap.x)/(2.*uMap.x)+uMap.y));}\n'+
'float Hb(vec2 p){float N=.5/uMap.y,T=2.*uMap.x/N;vec2 g=(p+uMap.x)/T,f=fract(g),b=(floor(g)+.5)/N;float d=1./N;'+
 'float a=hdec(texture2D(uH,b)),c=hdec(texture2D(uH,b+vec2(d,0.))),e=hdec(texture2D(uH,b+vec2(0.,d))),h=hdec(texture2D(uH,b+vec2(d,d)));return mix(mix(a,c,f.x),mix(e,h,f.x),f.y);}\n';
const SH={
 /* ---- sky: full-screen triangle ---- */
 skyV:'attribute vec2 aP;varying vec2 vU;void main(){vU=aP;gl_Position=vec4(aP,.99999,1.);}',
 skyF:PRE+'varying vec2 vU;uniform vec3 uFw,uRt,uUp;uniform vec2 uTan;uniform sampler2D uNz;\n'+ENVSRC+
 'void main(){vec3 rd=normalize(uFw+uRt*vU.x*uTan.x+uUp*vU.y*uTan.y);float y=rd.y;'+
 'vec3 col=mix(uHor,uZen,pow(clamp(y,0.,1.),.4));col=mix(col,uHor*.8,smoothstep(0.,-.12,y));float sd=max(dot(rd,uSun),0.);'+
 'col+=uSunC*(pow(sd,1500.)*6.+pow(sd,60.)*.16+pow(sd,7.)*.12);col+=uSunC*.05*exp(-y*9.)*pow(max(dot(normalize(rd.xz),normalize(uSun.xz)),0.),3.);'+
 'if(y>.01){float t=2200./y;vec2 p=(uCam.xz+rd.xz*t)*.00022+vec2(uFogP.w*.0035,uFogP.w*.0011);'+
  'float n=texture2D(uNz,p).r*.5+texture2D(uNz,p*2.6+.37).g*.32+texture2D(uNz,p*6.9+.11).b*.18;float cl=smoothstep(.5,.78,n)*smoothstep(.01,.2,y);'+
  'vec3 cc=mix(vec3(.96,.93,.9),uHor*1.25,.35)*(.62+.5*pow(sd,2.))+uSunC*.06*pow(sd,4.);col=mix(col,cc,cl*.9);}'+
 'gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}',
 /* ---- terrain clipmap: one static NxN grid drawn once per level, displaced by the height texture ---- */
 terV:'attribute vec2 aIJ;uniform mat4 uVP;uniform vec4 uLv;varying vec3 vW;varying vec3 vN;varying float vK;\n'+HSRC+
 'const float N=64.;void main(){vec2 ij=aIJ;float c=uLv.z;vec2 p=uLv.xy+(ij-N*.5)*c;vec2 q=abs(ij-N*.5)/(N*.5);float d=max(q.x,q.y);float k=clamp((d-.72)/.22,0.,1.);float h=Hn(p);'+
  'if(k>0.){vec2 par=mod(ij,2.);float hc=h;'+
   'if(par.x>.5&&par.y<.5)hc=.5*(Hn(p-vec2(c,0.))+Hn(p+vec2(c,0.)));else if(par.y>.5&&par.x<.5)hc=.5*(Hn(p-vec2(0.,c))+Hn(p+vec2(0.,c)));else if(par.x>.5&&par.y>.5)hc=.5*(Hn(p-vec2(c,c))+Hn(p+vec2(c,c)));'+
   'h=mix(h,hc,k);}'+
  'float cn=c*(1.+k);vec3 n=vec3(Hn(p-vec2(cn,0.))-Hn(p+vec2(cn,0.)),2.*cn,Hn(p-vec2(0.,cn))-Hn(p+vec2(0.,cn)));vN=n;vK=k;vW=vec3(p.x,h,p.y);gl_Position=uVP*vec4(vW,1.);}',
 terF:PRE+'varying vec3 vW;varying vec3 vN;varying float vK;uniform vec3 uHole;uniform sampler2D uCol,uNz;uniform float uHalf;\n'+ENVSRC+
 'void main(){if(abs(vW.x-uHole.x)<uHole.z&&abs(vW.z-uHole.y)<uHole.z)discard;vec3 n=normalize(vN);vec2 uv=(vW.xz+uHalf)/(2.*uHalf);vec3 a=texture2D(uCol,uv).rgb;a=a*a;'+
  'float dist=length(vW-uCam);float dt=exp(-dist*.0035);float n1=texture2D(uNz,vW.xz*.11).r,n2=texture2D(uNz,vW.xz*.0123).g,n3=texture2D(uNz,vW.xz*.7).b;'+
  'a*=1.+(((n1-.5)*.55+(n2-.5)*.5)*dt+(n3-.5)*.3*exp(-dist*.02));'+
  'float rk=smoothstep(.78,.52,n.y);a=mix(a,vec3(.2,.185,.17)*(.7+.7*n1),rk*.8);'+
  'float nl=max(dot(n,uSun),0.);vec3 irr=mix(uAmbB,uAmbT,n.y*.5+.5)+uSunC*nl;vec3 col=a*irr;col=fogm(col,vW);gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}',
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
 rdF:PRE+'varying vec3 vW;varying vec4 vA;uniform sampler2D uNz;\n'+ENVSRC+
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
  'vec3 n=vec3(0.,1.,0.);vec3 V=normalize(uCam-vW);float nl=max(dot(n,uSun),0.);vec3 irr=mix(uAmbB,uAmbT,1.)+uSunC*nl;vec3 col=alb*irr;'+
  'vec3 R=reflect(-V,n);float sp=pow(max(dot(R,uSun),0.),30.)*(1.-shd)*(1.-wh*.6);col+=uSunC*sp*.18+skyc(R)*(.02+.1*pow(1.-max(V.y,0.),4.))*(1.-shd);'+
  'col=fogm(col,vW);gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}',
 /* ---- generic lit props: vertex colour + optional window texture (buildings), baked ambient occlusion in colour ---- */
 prV:'attribute vec3 aP;attribute vec4 aN;attribute vec4 aC;attribute vec2 aU;uniform mat4 uVP;varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec2 vU;varying float vE;'+
  'void main(){vW=aP;vN=aN.xyz;vC=aC.rgb*aC.rgb;vU=aU;vE=aN.w;gl_Position=uVP*vec4(aP,1.);}',
 prF:PRE+'varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec2 vU;varying float vE;uniform sampler2D uWin;uniform float uNight;\n'+ENVSRC+
 'void main(){vec3 n=normalize(vN);vec4 w=texture2D(uWin,vU);float isw=step(.01,vE);vec3 alb=vC*mix(vec3(1.),w.rgb,isw);'+
  'float nl=max(dot(n,uSun),0.);vec3 irr=mix(uAmbB,uAmbT,n.y*.5+.5)+uSunC*nl;vec3 col=alb*irr;'+
  'float lit=isw*w.a*uNight;col+=vec3(1.,.8,.5)*lit*.9;'+
  'col=fogm(col,vW);gl_FragColor=vec4(tone(col)+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.,1.);}',
 /* ---- car: baked garage mesh, procedural environment reflections, per-vertex material classes ---- */
 carV:'attribute vec4 aP;attribute vec4 aN;attribute vec4 aC;uniform mat4 uVP;uniform mat4 uM;uniform vec4 uMat['+40+'];varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec4 vM;'+
  'void main(){vec4 w=uM*vec4(aP.xyz,1.);vW=w.xyz;vN=mat3(uM[0].xyz,uM[1].xyz,uM[2].xyz)*aN.xyz;vC=pow(aC.rgb,vec3(2.2));vM=uMat[int(aN.w*127.+.5)];gl_Position=uVP*w;}',
 carF:PRE+'varying vec3 vW;varying vec3 vN;varying vec3 vC;varying vec4 vM;uniform float uGl;uniform vec3 uBr;\n'+ENVSRC+
 'vec3 cenv(vec3 r,float rg){float h=r.y;vec3 c=mix(uAmbB*.7,uHor,smoothstep(-.1,.12,h));c=mix(c,uZen,smoothstep(.08,.9,h));float sd=max(dot(r,uSun),0.);c+=uSunC*pow(sd,mix(400.,12.,rg))*mix(3.,.15,rg);return c;}\n'+
 'void main(){vec3 n=normalize(vN),V=normalize(uCam-vW);if(dot(n,V)<0.)n=-n;float ndv=max(dot(n,V),0.);float metal=vM.x,rg=vM.y,emis=vM.z,coat=vM.w;vec3 alb=vC,R=reflect(-V,n);'+
  'float nl=max(dot(n,uSun),0.);vec3 irr=mix(uAmbB,uAmbT,n.y*.5+.5)+uSunC*nl*.9;float ao=.5+.5*smoothstep(0.,.5,vW.y-uBr.y);'+
  'vec3 F0=mix(vec3(.04),alb,metal);vec3 fr=F0+(1.-F0)*pow(1.-ndv,5.);vec3 col=alb*(1.-metal)*irr*ao;'+
  'col+=cenv(R,max(rg,.35))*fr*ao*mix(.35,1.,metal);col+=cenv(R,.2)*(.04+.96*pow(1.-ndv,5.))*coat*.7;'+
  'col+=alb*emis*(2.2+uGl*2.);col+=uBr.x*emis*vec3(1.,.1,.05)*step(0.,-n.z)*0.;'+
  'col=fogm(col,vW);gl_FragColor=vec4(tone(col),1.);}',
 /* ---- effects: ground decals (blob shadow, skid marks) and camera-facing smoke, one dynamic buffer ---- */
 fxV:'attribute vec3 aP;attribute vec4 aC;attribute vec2 aU;uniform mat4 uVP;varying vec4 vC;varying vec2 vU;void main(){vC=aC;vU=aU;gl_Position=uVP*vec4(aP,1.);}',
 fxF:PRE+'varying vec4 vC;varying vec2 vU;uniform float uMode;\n'+
 'void main(){float d=length(vU-.5)*2.;float a=uMode<.5?(1.-smoothstep(.3,1.,d)):(1.-smoothstep(.0,1.,d));a*=vC.a;if(uMode>1.5)a=vC.a*(1.-smoothstep(.6,1.,abs(vU.x-.5)*2.));gl_FragColor=vec4(vC.rgb,a);}'
};
function glCompile(gl,type,src,name){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const e=gl.getShaderInfoLog(s);throw new Error('shader '+name+(type==gl.VERTEX_SHADER?' VS':' FS')+': '+e)}return s}
function mkProg(name,vs,fs,attrs){const gl=G.gl,p=gl.createProgram();gl.attachShader(p,glCompile(gl,gl.VERTEX_SHADER,vs,name));gl.attachShader(p,glCompile(gl,gl.FRAGMENT_SHADER,fs,name));attrs.forEach((a,i)=>gl.bindAttribLocation(p,i,a));gl.linkProgram(p);
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
 G.P.car=mkProg('car',SH.carV,SH.carF,['aP','aN','aC']);G.P.fx=mkProg('fx',SH.fxV,SH.fxF,['aP','aC','aU']);
 return gl}
const mkBuf=(target,data,usage)=>{const gl=G.gl,b=gl.createBuffer();gl.bindBuffer(target,b);gl.bufferData(target,data,usage||gl.STATIC_DRAW);return b};
function mkTex(w,h,data,o){o=o||{};const gl=G.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
 const mip=!!o.mip;gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mip?gl.LINEAR_MIPMAP_LINEAR:(o.near?gl.NEAREST:gl.LINEAR));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,o.near?gl.NEAREST:gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,o.repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,o.repeat?gl.REPEAT:gl.CLAMP_TO_EDGE);
 if(mip){gl.generateMipmap(gl.TEXTURE_2D);if(G.anExt&&o.aniso)gl.texParameterf(gl.TEXTURE_2D,G.anExt.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(4,G.maxAniso))}return t}
function bindTex(unit,t){const gl=G.gl;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t)}
/* enable exactly the first n vertex attributes */
let _attrOn=0;function attrs(n){const gl=G.gl;for(let i=0;i<Math.max(n,_attrOn);i++){if(i<n)gl.enableVertexAttribArray(i);else gl.disableVertexAttribArray(i)}_attrOn=n}
