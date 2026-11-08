'use strict';
/* ===== renderer: uploads the static world once, then each frame = sky/terrain clipmap/roads/props/car/effects/water ===== */
const R={lv:6,N:64,tex:{},terVB:null,terIB:null,terRing:null,ringN:0,fullN:0,skyB:null,watB:null,roads:[],props:[],car:null,fx:null,fxIx:null,
  fw:new Float32Array(3),rt:new Float32Array(3),up:new Float32Array(3),VP:new Float32Array(16),V:new Float32Array(16),Pm:new Float32Array(16),PL:new Float32Array(24),M:new Float32Array(16),M2:new Float32Array(16),time:0,
  tris:0,draws:0,scale:1,w:1,h:1,fov:1.05,env:null};
const ENV={sun:[-.5,.4,-.77],sunC:[2.8,2.0,1.3],ambT:[.30,.40,.60],ambB:[.20,.15,.10],hor:[.80,.60,.46],zen:[.09,.24,.56],fog:1/2700,fogY:.0006,fogSun:.9};
{const l=Math.hypot(ENV.sun[0],ENV.sun[1],ENV.sun[2]);ENV.sun=new Float32Array(ENV.sun.map(v=>v/l));for(const k of['sunC','ambT','ambB','hor','zen'])ENV[k]=new Float32Array(ENV[k])}
function makeNoiseTex(){/* tileable value noise, 3 octaves in R/G/B, 128x128 */const S=128,o=new Uint8Array(S*S*4);
  const tn=(x,y,per,s)=>{const fx=x*per/S,fy=y*per/S,ix=Math.floor(fx),iy=Math.floor(fy),u=fx-ix,v=fy-iy,su=u*u*(3-2*u),sv=v*v*(3-2*v),w=k=>((k%per)+per)%per;
    const a=h2(w(ix),w(iy),s),b=h2(w(ix+1),w(iy),s),c=h2(w(ix),w(iy+1),s),d=h2(w(ix+1),w(iy+1),s);return a+(b-a)*su+(c-a)*sv+(a-b-c+d)*su*sv};
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){const k=(y*S+x)*4,a=tn(x,y,4,1)*.55+tn(x,y,8,2)*.3+tn(x,y,16,3)*.15,b=tn(x,y,8,4)*.55+tn(x,y,16,5)*.3+tn(x,y,32,6)*.15,c=tn(x,y,16,7)*.5+tn(x,y,32,8)*.3+tn(x,y,64,9)*.2;
    o[k]=Math.min(255,Math.max(0,(a-.5)*1.8*255+128));o[k+1]=Math.min(255,Math.max(0,(b-.5)*1.8*255+128));o[k+2]=Math.min(255,Math.max(0,(c-.5)*1.8*255+128));o[k+3]=255}return o}
function makeWinTex(){/* 64x64 building tile: pale wall with a dark glass window; alpha = lit-window mask (night) */const S=64,o=new Uint8Array(S*S*4);
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){const k=(y*S+x)*4;const wx=x/S,wy=y/S;const inW=wx>.17&&wx<.83&&wy>.2&&wy<.78;
    let r=235,g=235,b=232,a=0;if(inW){const sh=.8+.2*(1-wy);r=70*sh;g=88*sh;b=106*sh;a=255;if(wy<.3){r+=40;g+=40;b+=40}}else if(wy>.78&&wy<.86){r=200;g=200;b=198}
    o[k]=r;o[k+1]=g;o[k+2]=b;o[k+3]=a}return o}
function renderInit(){
  const gl=G.gl,N=R.N;
  R.tex.h=mkTex(W.N,W.N,heightTexData(),{near:1});R.tex.col=mkTex(W.CN,W.CN,W.col,{});R.tex.nz=mkTex(128,128,makeNoiseTex(),{repeat:1,mip:1});R.tex.win=mkTex(64,64,makeWinTex(),{repeat:1,mip:1,aniso:1});
  /* terrain grid: (N+1)^2 vertices (i,j); full index list + a "ring" list that leaves out the middle (it is always covered by the finer level) */
  const vb=new Float32Array((N+1)*(N+1)*2);for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){vb[(j*(N+1)+i)*2]=i;vb[(j*(N+1)+i)*2+1]=j}
  const full=[],ring=[];for(let j=0;j<N;j++)for(let i=0;i<N;i++){const a=j*(N+1)+i,b=a+1,c=a+N+1,d=c+1;full.push(a,c,b,b,c,d);if(!(i>=17&&i<47&&j>=17&&j<47))ring.push(a,c,b,b,c,d)}
  R.terVB=mkBuf(gl.ARRAY_BUFFER,vb);R.terIB=mkBuf(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(full));R.terRing=mkBuf(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(ring));R.fullN=full.length;R.ringN=ring.length;
  R.skyB=mkBuf(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]));R.watB=mkBuf(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,1,1,-1,-1,1,1,-1,1]));
  /* roads */
  for(const p of buildRoadMeshes())R.roads.push({vb:mkBuf(gl.ARRAY_BUFFER,p.V),ib:mkBuf(gl.ELEMENT_ARRAY_BUFFER,p.I),n:p.I.length,cx:p.cx,cy:p.cy,cz:p.cz,rad:p.rad});
  buildRoadHash();buildFurniture();R.stats=buildCity();R.props=finishProps().map(p=>({cat:p.cat,vb:mkBuf(gl.ARRAY_BUFFER,p.V),ib:mkBuf(gl.ELEMENT_ARRAY_BUFFER,p.I),n:p.I.length,cx:p.cx,cy:p.cy,cz:p.cz,rad:p.rad}));
  buildQueries();
  /* dynamic effects buffer: quads of 9 floats/vertex */
  R.fxMax=900;R.fxF=new Float32Array(R.fxMax*4*9);R.fx=mkBuf(gl.ARRAY_BUFFER,R.fxF.byteLength,gl.DYNAMIC_DRAW);
  const ix=new Uint16Array(R.fxMax*6);for(let q=0;q<R.fxMax;q++){const b=q*4;ix.set([b,b+1,b+2,b,b+2,b+3],q*6)}R.fxIx=mkBuf(gl.ELEMENT_ARRAY_BUFFER,ix);
  R.fxN=0;
  carGLInit();
}
function setEnvU(P){const gl=G.gl,u=P.u,E=ENV;gl.uniform3f(u.uCam,R.cx,R.cy,R.cz);if(u.uSun!=null){gl.uniform3fv(u.uSun,E.sun);gl.uniform3fv(u.uSunC,E.sunC);gl.uniform3fv(u.uAmbT,E.ambT);gl.uniform3fv(u.uAmbB,E.ambB);gl.uniform3fv(u.uHor,E.hor);gl.uniform3fv(u.uZen,E.zen);gl.uniform4f(u.uFogP,E.fog,E.fogY,E.fogSun,R.time)}}
function setMapU(P){const gl=G.gl,u=P.u;gl.uniform4f(u.uMap,W.half,.5/W.N,W.hrange,W.hmin)}
/* camera + frame */
function viewSet(cx,cy,cz,tx,ty,tz,fov,w,h){R.cx=cx;R.cy=cy;R.cz=cz;R.fov=fov;M4.look(R.V,cx,cy,cz,tx,ty,tz);M4.persp(R.Pm,fov,w/h,.8,12000);M4.mul(R.VP,R.Pm,R.V);M4.planes(R.PL,R.VP);
  /* camera basis for the sky: forward, right = f x worldUp, up = right x f */
  let fx=tx-cx,fy=ty-cy,fz=tz-cz;const l=Math.hypot(fx,fy,fz)||1;fx/=l;fy/=l;fz/=l;let rx=-fz,rz=fx;const rl=Math.hypot(rx,rz)||1;rx/=rl;rz/=rl;
  R.fw[0]=fx;R.fw[1]=fy;R.fw[2]=fz;R.rt[0]=rx;R.rt[1]=0;R.rt[2]=rz;R.up[0]=-rz*fy;R.up[1]=rz*fx-rx*fz;R.up[2]=rx*fy}
function renderFrame(w,h,sky){
  const gl=G.gl;R.draws=0;R.tris=0;
  gl.viewport(0,0,w,h);gl.clearColor(ENV.hor[0]**.45,ENV.hor[1]**.45,ENV.hor[2]**.45,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.BLEND);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);
  const cx=R.cx,cz=R.cz;
  /* terrain clipmap, finest level first */
  let P=G.P.ter;gl.useProgram(P.p);setEnvU(P);setMapU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);gl.uniform1f(P.u.uHalf,W.half);
  bindTex(0,R.tex.h);gl.uniform1i(P.u.uH,0);bindTex(1,R.tex.col);gl.uniform1i(P.u.uCol,1);bindTex(2,R.tex.nz);gl.uniform1i(P.u.uNz,2);
  gl.bindBuffer(gl.ARRAY_BUFFER,R.terVB);attrs(1);gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);
  let phx=0,phz=0,phh=0;
  for(let l=0;l<R.lv;l++){const c=W.T*(1<<l),sn=c*2,lx=Math.round(cx/sn)*sn,lz=Math.round(cz/sn)*sn;
    gl.uniform4f(P.u.uLv,lx,lz,c,l);gl.uniform3f(P.u.uHole,phx,phz,l?phh-.02:0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,l?R.terRing:R.terIB);gl.drawElements(gl.TRIANGLES,l?R.ringN:R.fullN,gl.UNSIGNED_SHORT,0);R.draws++;R.tris+=(l?R.ringN:R.fullN)/3;
    phx=lx;phz=lz;phh=R.N*.5*c}
  /* roads */
  P=G.P.rd;gl.useProgram(P.p);setEnvU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);bindTex(0,R.tex.nz);gl.uniform1i(P.u.uNz,0);attrs(2);gl.disable(gl.CULL_FACE);
  for(let i=0;i<R.roads.length;i++){const p=R.roads[i],dx=p.cx-cx,dz=p.cz-cz,d=Math.hypot(dx,dz);if(d>R.drawRoad+p.rad||!M4.sphereIn(R.PL,p.cx,p.cy,p.cz,p.rad))continue;
    gl.bindBuffer(gl.ARRAY_BUFFER,p.vb);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,p.ib);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);gl.vertexAttribPointer(1,4,gl.FLOAT,false,28,12);gl.drawElements(gl.TRIANGLES,p.n,gl.UNSIGNED_SHORT,0);R.draws++;R.tris+=p.n/3}
  /* props */
  P=G.P.pr;gl.useProgram(P.p);setEnvU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);bindTex(0,R.tex.win);gl.uniform1i(P.u.uWin,0);gl.uniform1f(P.u.uNight,R.night||0);attrs(4);gl.enable(gl.CULL_FACE);
  for(let i=0;i<R.props.length;i++){const p=R.props[i],dist=R.drawProp[p.cat];const dx=p.cx-cx,dz=p.cz-cz;if(dx*dx+dz*dz>(dist+p.rad)*(dist+p.rad)||!M4.sphereIn(R.PL,p.cx,p.cy,p.cz,p.rad))continue;
    gl.bindBuffer(gl.ARRAY_BUFFER,p.vb);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,p.ib);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);gl.vertexAttribPointer(1,4,gl.BYTE,true,28,12);gl.vertexAttribPointer(2,4,gl.UNSIGNED_BYTE,true,28,16);gl.vertexAttribPointer(3,2,gl.FLOAT,false,28,20);gl.drawElements(gl.TRIANGLES,p.n,gl.UNSIGNED_SHORT,0);R.draws++;R.tris+=p.n/3}
  /* the player's car (+ rivals later) */
  if(R.carDraw)R.carDraw();
  /* sky: only where nothing else was drawn */
  P=G.P.sky;gl.useProgram(P.p);setEnvU(P);gl.disable(gl.CULL_FACE);bindTex(0,R.tex.nz);gl.uniform1i(P.u.uNz,0);
  const th=Math.tan(R.fov/2);gl.uniform3fv(P.u.uFw,R.fw);gl.uniform3fv(P.u.uRt,R.rt);gl.uniform3fv(P.u.uUp,R.up);gl.uniform2f(P.u.uTan,th*w/h,th);gl.bindBuffer(gl.ARRAY_BUFFER,R.skyB);attrs(1);gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);gl.drawArrays(gl.TRIANGLES,0,3);R.draws++;
  /* water + effects (blended, no depth writes) */
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
  P=G.P.wat;gl.useProgram(P.p);setEnvU(P);setMapU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);bindTex(0,R.tex.h);gl.uniform1i(P.u.uH,0);bindTex(2,R.tex.nz);gl.uniform1i(P.u.uNz,2);gl.bindBuffer(gl.ARRAY_BUFFER,R.watB);attrs(1);gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);gl.drawArrays(gl.TRIANGLES,0,6);R.draws++;
  if(R.fxDraw)R.fxDraw();
  gl.depthMask(true);gl.disable(gl.BLEND)}
