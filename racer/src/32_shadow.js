'use strict';
/* ===== soft sun shadows around the car (tiered) ===== */
/* One orthographic depth map from the sun's direction, centred on the car and snapped to a world grid (so the shadows do not shimmer as the car moves).
   Medium: 512 x 512 over 68 m, casters = the player's car and the traffic. High: 1024 x 1024 over 92 m, plus the buildings, trees and lamp posts near the car.
   The depth is packed into the 4 bytes of an RGBA texture (works on every WebGL1 phone, no depth-texture extension needed). Receivers are the terrain and the road
   (their shaders are compiled with SHADOW = 1 or 2 only on the tiers that have it); the sun is behind cloud, so the shadows are weak and blurred (strength 0.5, a 2 x 2 or 3 x 3 filter). */
const SHD={res:0,fbo:null,tex:null,dep:null,LP:new Float32Array(16),LV:new Float32Array(16),PM:new Float32Array(16),half:34,ok:true,bias:.0011,strength:.5,cx:0,cz:0,n:0,
  _mb:new Float32Array(16),_mw:new Float32Array(16),_mf:new Float32Array(16)};
const SHPK='vec4 pk(float d){vec4 e=fract(d*vec4(1.,255.,65025.,16581375.));e-=e.yzww*vec4(1./255.,1./255.,1./255.,0.);return e;}\n';
const SHD_F=PRE+SHPK+'void main(){gl_FragColor=pk(gl_FragCoord.z);}';
/* props: foliage is cut out by the leaf atlas, so a tree's shadow has leaves in it and not rectangles */
const SHD_FP=PRE+SHPK+'varying vec2 vU;varying float vF;uniform sampler2D uFol;void main(){if(vF>.5&&texture2D(uFol,vU).a<.5)discard;gl_FragColor=pk(gl_FragCoord.z);}';
const SHD_V={
 car:'attribute vec4 aP;uniform mat4 uLP,uM;void main(){gl_Position=uLP*(uM*vec4(aP.xyz,1.));}',
 prop:'attribute vec3 aP;attribute vec4 aN;attribute vec2 aU;uniform mat4 uLP;varying vec2 vU;varying float vF;void main(){vU=aU;vF=step(.3,aN.w)*step(aN.w,.7);gl_Position=uLP*vec4(aP,1.);}',
 tr:'attribute vec3 aP;attribute vec4 aN;attribute vec4 aI0;attribute vec4 aI1;uniform mat4 uLP;\n'+
  'vec3 rt(vec3 p,float cy,float sy,float cp,float sp,float cr,float sr){float x=p.x*cr-p.y*sr,y=p.x*sr+p.y*cr,z=p.z;float y2=y*cp+z*sp,z2=z*cp-y*sp;return vec3(cy*x+sy*z2,y2,sy*x-cy*z2);}\n'+
  'void main(){float cy=cos(aI0.w),sy=sin(aI0.w),cp=cos(aI1.x),sp=sin(aI1.x),cr=cos(aI1.y),sr=sin(aI1.y);vec3 w=rt(aP,cy,sy,cp,sp,cr,sr)+aI0.xyz;gl_Position=uLP*vec4(w,1.)+vec4(aN.x*0.,0.,0.,0.)+vec4(aI1.w*0.,0.,0.,0.);}'};
function shdFree(){const gl=G.gl;if(SHD.fbo)gl.deleteFramebuffer(SHD.fbo);if(SHD.tex)gl.deleteTexture(SHD.tex);if(SHD.dep)gl.deleteRenderbuffer(SHD.dep);SHD.fbo=SHD.tex=SHD.dep=null;SHD.res=0}
function shdTarget(res){
  if(SHD.fbo&&SHD.res==res)return true;const gl=G.gl;shdFree();
  try{SHD.tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,SHD.tex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,res,res,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    for(const[k,v]of[[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);
    SHD.dep=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,SHD.dep);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,res,res);
    SHD.fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,SHD.fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,SHD.tex,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,SHD.dep);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!=gl.FRAMEBUFFER_COMPLETE)throw new Error('shadow fbo incomplete');SHD.res=res;gl.bindFramebuffer(gl.FRAMEBUFFER,null);return true}
  catch(e){gl.bindFramebuffer(gl.FRAMEBUFFER,null);shdFree();SHD.ok=false;console.warn('shadows off: '+e.message);return false}}
/* the sun's view of the area round (cx, cy, cz) */
function shdMatrices(cx,cy,cz){
  const L=ENV.sun,h=SHD.half,tex=2*h/SHD.res,LV=SHD.LV;
  M4.look(LV,cx+L[0]*110,cy+L[1]*110,cz+L[2]*110,cx,cy,cz);
  /* snap the centre to the texel grid along the light's right and up axes (measured in the world, so the grid does not move with the car) */
  const sx=LV[0],sy=LV[4],sz=LV[8],ux=LV[1],uy=LV[5],uz=LV[9],ca=sx*cx+sy*cy+sz*cz,cb=ux*cx+uy*cy+uz*cz,da=Math.round(ca/tex)*tex-ca,db=Math.round(cb/tex)*tex-cb;
  cx+=sx*da+ux*db;cy+=sy*da+uy*db;cz+=sz*da+uz*db;
  M4.look(LV,cx+L[0]*110,cy+L[1]*110,cz+L[2]*110,cx,cy,cz);
  const P=SHD.PM,n=.5,f=240;P.fill(0);P[0]=1/h;P[5]=1/h;P[10]=-2/(f-n);P[14]=-(f+n)/(f-n);P[15]=1;M4.mul(SHD.LP,P,LV)}
/* draw the shadow map; returns true if it is ready */
function shdPass(){
  const T=GFX.cur,gl=G.gl;GFX.shadowOn=false;if(!T.shadow||!GFX.ok||!SHD.ok)return false;
  const res=QS.has('shres')?Math.max(512,Math.min(4096,parseInt(QS.get('shres'))||1024)):(T.shadow>1?1024:512);SHD.half=T.shadow>1?56:34;   /* (batch 45) High covers 112 m instead of 100; a 2048 map (?shres=2048, 6 cm a texel) cost +36 % in the software-GL timing, so it is a switch and not the default */if(!shdTarget(res))return false;
  if(!G.P.shc){G.P.shc=mkProg('shc',SHD_V.car,SHD_F,['aP']);G.P.shp=mkProg('shp',SHD_V.prop,SHD_FP,['aP','aN','aU']);G.P.sht=mkProg('sht',SHD_V.tr,SHD_F,['aP','aN','aI0','aI1'])}
  const a=R.alpha,x=lerp(C.px,C.x,a),y=lerp(C.py,C.y,a),z=lerp(C.pz,C.z,a);SHD.cx=x;SHD.cz=z;shdMatrices(x,y,z);
  gl.bindFramebuffer(gl.FRAMEBUFFER,SHD.fbo);gl.viewport(0,0,res,res);gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);
  /* the player's car */
  let P=G.P.shc;gl.useProgram(P.p);gl.uniformMatrix4fv(P.u.uLP,false,SHD.LP);attrs(1);
  const yaw=C.pyaw+angd(C.yaw,C.pyaw)*a,pit=lerp(C.ppitch,C.pitch,a),rol=lerp(C.proll,C.roll,a),S=1/8192,mb=SHD._mb,mw=SHD._mw,mf=SHD._mf;
  const mesh=(m,M)=>{gl.uniformMatrix4fv(P.u.uM,false,M);gl.bindBuffer(gl.ARRAY_BUFFER,m.vb);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.ib);gl.vertexAttribPointer(0,4,gl.SHORT,false,16,0);gl.drawElements(gl.TRIANGLES,m.n,gl.UNSIGNED_SHORT,0);R.draws++;R.tris+=m.n/3};
  if(CARM.body&&!crashBlink()){carPose(mb,a,S);mesh(CARM.body,mb);
    for(let w=0;w<CARM.wheels.length;w++){const wh=CARM.wheels[w];for(const sd of[-1,1]){const st=w==0?C.steerVis:0;M4.trs(mw,sd*wh.lat,wh.R,wh.x,st,-C.spin,0,sd*S,S,S);carPose(mf,a,1);M4.mul(mb,mf,mw);mesh(wh,mb)}}}
  /* traffic */
  if(TRM.nv){P=G.P.sht;gl.useProgram(P.p);gl.uniformMatrix4fv(P.u.uLP,false,SHD.LP);trIssue()}
  /* buildings, trees and lamp posts near the car (High only) */
  if(T.shadow>1){P=G.P.shp;gl.useProgram(P.p);gl.uniformMatrix4fv(P.u.uLP,false,SHD.LP);attrs(3);bindTex(0,R.tex.fol);gl.uniform1i(P.u.uFol,0);const r0=SHD.half*1.45;
    for(let i=0;i<R.props.length;i++){const p=R.props[i];if(p.cat==4||Math.abs(p.cx-x)>r0+p.rad||Math.abs(p.cz-z)>r0+p.rad)continue;   /* (fine detail casts no shadow) */
      gl.bindBuffer(gl.ARRAY_BUFFER,p.vb);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,p.ib);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);gl.vertexAttribPointer(1,4,gl.BYTE,true,28,12);gl.vertexAttribPointer(2,2,gl.FLOAT,false,28,20);gl.drawElements(gl.TRIANGLES,p.n,gl.UNSIGNED_SHORT,0);R.draws++;R.tris+=p.n/3}}
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);GFX.shadowOn=true;return true}
/* give a receiving program (terrain, road) the map */
function shdSetU(P){if(!P.u.uSh)return;const gl=G.gl;bindTex(4,SHD.tex||R.tex.nz);gl.uniform1i(P.u.uSh,4);gl.uniformMatrix4fv(P.u.uLS,false,SHD.LP);gl.uniform4f(P.u.uShP,1/Math.max(1,SHD.res),GFX.shadowOn?SHD.strength:0,SHD.bias,0)}
