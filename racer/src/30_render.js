'use strict';
/* ===== renderer: uploads the static world once, then each frame = sky/terrain clipmap/roads/props/car/effects/water ===== */
const R={lv:6,N:64,tex:{},terVB:null,terIB:null,terRing:null,ringN:0,fullN:0,skyB:null,watB:null,roads:[],props:[],car:null,fx:null,fxIx:null,
  fw:new Float32Array(3),rt:new Float32Array(3),up:new Float32Array(3),VP:new Float32Array(16),V:new Float32Array(16),Pm:new Float32Array(16),PL:new Float32Array(24),M:new Float32Array(16),M2:new Float32Array(16),time:0,
  tris:0,draws:0,scale:1,w:1,h:1,fov:1.05,env:null};
/* the weather and time of day. Every look is a set of numbers: where the sun is and how strong, the sky colours, how thick the haze is, the grade of the picture (saturation, warm/cool split, contrast, exposure),
   the clouds (lit and shaded colour, how much sky they cover), how wet the road is and how many windows are lit. ENV holds the current ones; envApply copies a preset in. */
const ENVP={
 /* a clear, sunny day: high warm sun, blue sky with scattered cloud, clean air, dry road, hard shadows */
 day:{label:'DAY',sun:[-.52,.60,-.60],sunC:[3.0,2.7,2.25],ambT:[.40,.55,.82],ambB:[.20,.19,.16],hor:[.50,.66,.92],zen:[.09,.25,.64],fog:1/3400,fogY:.0008,fogSun:.5,gr:[1.2,.8,.4,.92],clA:[1.2,1.2,1.2],clB:[.50,.58,.74],sk:[.42,.72,.04,0],sd:[1,1.3,.40,.28],wet:0,night:0,shadow:.85},
 /* the showroom (the car menu): a dark void, big soft light boxes overhead and at the sides that show as long highlights in the paint, a glossy floor */
 studio:{label:'STUDIO',sun:[.38,.78,.5],sunC:[1.5,1.48,1.46],ambT:[.42,.46,.58],ambB:[.08,.08,.1],hor:[.03,.034,.05],zen:[.01,.012,.022],fog:1/13,fogY:.0,fogSun:0,gr:[1.12,.4,.4,.95],clA:[.2,.2,.2],clB:[.1,.1,.1],sk:[2,3,0,0],sd:[0,0,.5,0],wet:.95,night:0,shadow:.7,stu:1},
 /* a gloomy, overcast day: the sun is a pale patch behind cloud, the light comes from the whole sky, the horizon is thick grey haze, the road is wet */
 overcast:{label:'OVERCAST',sun:[-.42,.66,-.62],sunC:[.82,.84,.88],ambT:[.50,.55,.64],ambB:[.19,.19,.20],hor:[.46,.50,.55],zen:[.20,.24,.31],fog:1/1150,fogY:.0010,fogSun:.12,gr:[.72,1,.30,1],clA:[.60,.63,.68],clB:[.27,.29,.34],sk:[.34,.72,.12,.62],sd:[1,0,.5,.55],wet:.85,night:.27,shadow:.5},
 /* golden hour: the sun low and orange, long shadows, a glowing haze, a wet road that mirrors it */
 sunset:{label:'SUNSET',sun:[-.80,.16,-.58],sunC:[3.4,1.75,.72],ambT:[.34,.30,.44],ambB:[.15,.10,.08],hor:[1.0,.60,.34],zen:[.16,.19,.42],fog:1/1700,fogY:.0009,fogSun:1.0,gr:[1.1,1.4,.34,1],clA:[1.25,.72,.42],clB:[.34,.27,.40],sk:[.46,.76,0,.18],sd:[1.3,1.6,.45,.5],wet:.5,night:.45,shadow:.9}};
const ENV={sun:new Float32Array(3),sunC:new Float32Array(3),ambT:new Float32Array(3),ambB:new Float32Array(3),hor:new Float32Array(3),zen:new Float32Array(3),clA:new Float32Array(3),clB:new Float32Array(3),gr:new Float32Array(4),sk:new Float32Array(4),sd:new Float32Array(4),fog:0,fogY:0,fogSun:0,wet:0,night:0,shadow:.5,stu:0,name:''};
const ENV_NAMES=['day','overcast','sunset'];
function envApply(name){const p=ENVP[name]||ENVP.day;ENV.name=ENVP[name]?name:'day';
  const l=Math.hypot(p.sun[0],p.sun[1],p.sun[2]);for(let i=0;i<3;i++)ENV.sun[i]=p.sun[i]/l;
  for(const k of['sunC','ambT','ambB','hor','zen','clA','clB'])ENV[k].set(p[k]);ENV.gr.set(p.gr);ENV.sk.set(p.sk);ENV.sd.set(p.sd);
  ENV.fog=p.fog;ENV.fogY=p.fogY;ENV.fogSun=p.fogSun;ENV.wet=p.wet;ENV.night=p.night;ENV.shadow=p.shadow;ENV.stu=p.stu||0;
  if(typeof GFX!=='undefined'){GFX.wet=p.wet;GFX.night=p.night}if(typeof SHD!=='undefined')SHD.strength=p.shadow;
  R.envVer=(R.envVer||0)+1}
function envInit(){let m=QS.get('env');try{if(!m)m=localStorage.getItem('racer.env')}catch(e){}envApply(ENVP[m]?m:'day')}
/* ---- the sky cube map: six 128 x 128 faces of the sky shader (linear, stored as sqrt(c/4)), mip-mapped; redrawn when the weather changes and every few seconds for the drift of the clouds ---- */
const CUBE_DIR=[[[1,0,0],[0,0,-1],[0,-1,0]],[[-1,0,0],[0,0,1],[0,-1,0]],[[0,1,0],[1,0,0],[0,0,1]],[[0,-1,0],[1,0,0],[0,0,-1]],[[0,0,1],[1,0,0],[0,-1,0]],[[0,0,-1],[-1,0,0],[0,-1,0]]];
function skyCubeInit(){const gl=G.gl,S=256;const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_CUBE_MAP,t);
  for(let f=0;f<6;f++)gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+f,0,gl.RGBA,S,S,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_CUBE_MAP,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const fbo=gl.createFramebuffer();R.cube={tex:t,fbo,S,ver:-1,t:-99,ok:true,n:0}}
function skyCubeUpdate(){
  const gl=G.gl,C0=R.cube;if(!C0||!C0.ok)return;if(C0.ver===R.envVer&&R.time-C0.t<7)return;
  const P=G.P.skyc,S=C0.S;gl.bindFramebuffer(gl.FRAMEBUFFER,C0.fbo);gl.viewport(0,0,S,S);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.useProgram(P.p);
  /* the cube must not be bound as a texture while it is drawn into */gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_CUBE_MAP,null);
  const cx=R.cx,cy=R.cy,cz=R.cz;R.cx=cx||0;R.cy=cy||0;R.cz=cz||0;const save=R.cube;R.cube=null;setEnvU(P);R.cube=save;
  bindTex(0,R.tex.nz);gl.uniform1i(P.u.uNz,0);gl.uniform2f(P.u.uTan,1,1);gl.bindBuffer(gl.ARRAY_BUFFER,R.skyB);attrs(1);gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);
  for(let f=0;f<6;f++){gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_CUBE_MAP_POSITIVE_X+f,C0.tex,0);
    if(f==0&&gl.checkFramebufferStatus(gl.FRAMEBUFFER)!=gl.FRAMEBUFFER_COMPLETE){C0.ok=false;gl.bindFramebuffer(gl.FRAMEBUFFER,null);skyCubeFill();return}
    const d=CUBE_DIR[f];gl.uniform3f(P.u.uFw,d[0][0],d[0][1],d[0][2]);gl.uniform3f(P.u.uRt,d[1][0],d[1][1],d[1][2]);gl.uniform3f(P.u.uUp,d[2][0],d[2][1],d[2][2]);gl.drawArrays(gl.TRIANGLES,0,3)}
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_CUBE_MAP,C0.tex);gl.generateMipmap(gl.TEXTURE_CUBE_MAP);gl.enable(gl.DEPTH_TEST);
  C0.ver=R.envVer;C0.t=R.time;C0.n++}
/* a GPU that cannot render into a cube face gets a plain gradient sky instead (the same numbers, drawn on the CPU) */
function skyCubeFill(){const gl=G.gl,S=16,C0=R.cube;gl.bindTexture(gl.TEXTURE_CUBE_MAP,C0.tex);
  for(let f=0;f<6;f++){const d=CUBE_DIR[f],o=new Uint8Array(S*S*4);for(let y=0;y<S;y++)for(let x=0;x<S;x++){const a=(x+.5)/S*2-1,b=(y+.5)/S*2-1;let rx=d[0][0]+d[1][0]*a+d[2][0]*b,ry=d[0][1]+d[1][1]*a+d[2][1]*b,rz=d[0][2]+d[1][2]*a+d[2][2]*b;const l=Math.hypot(rx,ry,rz);ry/=l;
      const k=ry>0?Math.pow(ry,ENV.sd[2]):0,g=ry<0?Math.min(1,-ry*3):0,c=[0,1,2].map(i=>{let v=ENV.hor[i]+(ENV.zen[i]-ENV.hor[i])*k;v=v*(1-g)+(ENV.ambB[i]*.9)*g;return Math.round(Math.sqrt(Math.min(4,v)/4)*255)}),q=(y*S+x)*4;o[q]=c[0];o[q+1]=c[1];o[q+2]=c[2];o[q+3]=255}
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+f,0,gl.RGBA,S,S,0,gl.RGBA,gl.UNSIGNED_BYTE,o)}
  gl.generateMipmap(gl.TEXTURE_CUBE_MAP)}
function envCycle(){const i=ENV_NAMES.indexOf(ENV.name);const n=ENV_NAMES[(i+1)%ENV_NAMES.length];envApply(n);try{localStorage.setItem('racer.env',n)}catch(e){}return n}
function makeNoiseTex(){/* tileable value noise, 3 octaves in R/G/B, 128x128 */const S=128,o=new Uint8Array(S*S*4);
  const tn=(x,y,per,s)=>{const fx=x*per/S,fy=y*per/S,ix=Math.floor(fx),iy=Math.floor(fy),u=fx-ix,v=fy-iy,su=u*u*(3-2*u),sv=v*v*(3-2*v),w=k=>((k%per)+per)%per;
    const a=h2(w(ix),w(iy),s),b=h2(w(ix+1),w(iy),s),c=h2(w(ix),w(iy+1),s),d=h2(w(ix+1),w(iy+1),s);return a+(b-a)*su+(c-a)*sv+(a-b-c+d)*su*sv};
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){const k=(y*S+x)*4,a=tn(x,y,4,1)*.55+tn(x,y,8,2)*.3+tn(x,y,16,3)*.15,b=tn(x,y,8,4)*.55+tn(x,y,16,5)*.3+tn(x,y,32,6)*.15,c=tn(x,y,16,7)*.5+tn(x,y,32,8)*.3+tn(x,y,64,9)*.2;
    o[k]=Math.min(255,Math.max(0,(a-.5)*1.8*255+128));o[k+1]=Math.min(255,Math.max(0,(b-.5)*1.8*255+128));o[k+2]=Math.min(255,Math.max(0,(c-.5)*1.8*255+128));o[k+3]=255}return o}
function makeWinTex(){/* 64x64 building tile: a concrete wall with a framed window (a mullion, a transom, a sill); alpha = window mask (lit at night, and the part that reflects the sky) */const S=64,o=new Uint8Array(S*S*4);
  const hn=(a,b)=>{const s=Math.sin(a*127.1+b*311.7)*43758.5453;return s-Math.floor(s)};
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){const k=(y*S+x)*4;const wx=x/S,wy=y/S;const inW=wx>.15&&wx<.85&&wy>.18&&wy<.80,frame=inW&&(wx<.19||wx>.81||wy<.22||wy>.76||Math.abs(wx-.5)<.018||Math.abs(wy-.5)<.014);
    const grain=.93+.07*hn(x,y);let r=232*grain,g=231*grain,b=228*grain,a=0;
    if(inW&&!frame){const t=(wy-.2)/.58,sh=.55+.55*(1-t)*(1-t);r=58*sh+30*(1-t);g=78*sh+34*(1-t);b=100*sh+40*(1-t);a=255}
    else if(frame){r=g=b=196;a=0}
    else if(wy>=.80&&wy<.86){r=g=b=206}else if(wy>.94||wy<.02){r=g=b=214}
    o[k]=r;o[k+1]=g;o[k+2]=b;o[k+3]=a}return o}
/* the leaf atlas, painted on the CPU from a seeded generator (128 x 128, four 64 x 64 tiles; rgb is brightness with a green cast, the tree's own colour multiplies it; alpha is the cut-out): 0 a cluster of broadleaf leaves, 1 fir needles (ragged lower edge), 2 a denser bush cluster, 3 a tuft of grass blades. Row 0 of a tile is the BOTTOM of the card. */
function makeFoliageTex(){const S=128,T=64,o=new Uint8Array(S*S*4),rg=mulberry(2024);
  const put=(tx,ty,x,y,r,g,b,a)=>{if(x<0||y<0||x>=T||y>=T)return;const k=((ty*T+y)*S+tx*T+x)*4;o[k]=r;o[k+1]=g;o[k+2]=b;o[k+3]=a};
  const leaf=(tx,ty,cx,cy,len,wid,ang,lum)=>{const ca=Math.cos(ang),sa=Math.sin(ang),Rr=Math.ceil(len);for(let y=-Rr;y<=Rr;y++)for(let x=-Rr;x<=Rr;x++){const u=(x*ca+y*sa)/len,v=(-x*sa+y*ca)/wid;if(u*u+v*v<=1){const sh=lum*(1-.3*Math.abs(v))*(Math.abs(v)<.1?1.1:1)*(1-.12*Math.max(0,u)),g=Math.min(255,sh*255);put(tx,ty,Math.round(cx+x),Math.round(cy+y),g*.9,g,g*.72,255)}}};
  const cluster=(tx,ty,n,rad,l0,l1,w0,w1)=>{const L=[];for(let i=0;i<n;i++){const a=rg()*6.283,r=Math.sqrt(rg())*rad;L.push([32+Math.cos(a)*r,32+Math.sin(a)*r*.95,l0+rg()*(l1-l0),w0+rg()*(w1-w0),rg()*6.283,rg()])}
    L.sort((p,q)=>p[1]-q[1]);for(const p of L){const lum=Math.max(.3,Math.min(1.15,.42+.5*p[5]+.22*((p[1]-32)/rad)));leaf(tx,ty,p[0],p[1],p[2],p[3],p[4],lum)}};
  cluster(0,0,64,24,7,10.5,3.4,4.6);cluster(0,1,90,25,5.5,8.2,2.8,3.8);
  /* fir needles: streaks across the facet, gaps between branches, a ragged lower edge (the teeth are the drooping branch tips) */
  const hn=(a,b)=>{const s=Math.sin(a*127.1+b*311.7)*43758.5453;return s-Math.floor(s)};
  for(let y=0;y<T;y++)for(let x=0;x<T;x++){let l=.5+.38*hn(Math.floor(x/2),Math.floor(y/6))+.12*hn(x,y);l*=.9+.1*Math.sin(y*.85+hn(Math.floor(x/9),3)*6);const edge=.06+.17*hn(Math.floor(x/3),7);const a=(y/T>edge)?255:0,g=Math.min(255,l*255*(.8+.35*y/T));put(1,0,x,y,g*.82,g,g*.7,a)}
  /* grass tuft: tapering blades from the bottom edge, leaning, lighter at the tips */
  for(let b=0;b<40;b++){const x0=8+rg()*48,h=26+rg()*34,lean=(rg()-.5)*22,w0=1.6+rg()*1.6,lum=.55+rg()*.45;for(let y=0;y<h;y++){const t=y/h,cx=x0+lean*t*t,w=w0*(1-t);const g=Math.min(255,(lum*(.55+.55*t))*255);for(let x=Math.floor(cx-w);x<=Math.ceil(cx+w);x++)if(Math.abs(x-cx)<=w+.2)put(1,1,x,y,g*.85,g,g*.55,255)}}
  return o}
function renderInit(){
  const gl=G.gl,N=R.N;
  R.tex.h=mkTex(W.N,W.N,heightTexData(),{near:1});R.tex.col=mkTex(W.CN,W.CN,W.col,{});R.tex.nz=mkTex(128,128,makeNoiseTex(),{repeat:1,mip:1});R.tex.win=mkTex(64,64,makeWinTex(),{repeat:1,mip:1,aniso:1});R.tex.fol=mkTex(128,128,makeFoliageTex(),{mip:1,aniso:1});
  /* terrain grid: (N+1)^2 vertices (i,j); full index list + a "ring" list that leaves out the middle (it is always covered by the finer level) */
  const vb=new Float32Array((N+1)*(N+1)*2);for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){vb[(j*(N+1)+i)*2]=i;vb[(j*(N+1)+i)*2+1]=j}
  const full=[],ring=[];for(let j=0;j<N;j++)for(let i=0;i<N;i++){const a=j*(N+1)+i,b=a+1,c=a+N+1,d=c+1;full.push(a,c,b,b,c,d);if(!(i>=17&&i<47&&j>=17&&j<47))ring.push(a,c,b,b,c,d)}
  R.terVB=mkBuf(gl.ARRAY_BUFFER,vb);R.terIB=mkBuf(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(full));R.terRing=mkBuf(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(ring));R.fullN=full.length;R.ringN=ring.length;
  R.skyB=mkBuf(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]));R.watB=mkBuf(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,1,1,-1,-1,1,1,-1,1]));
  /* roads */
  buildRoadHash();for(const p of buildRoadMeshes())R.roads.push({vb:mkBuf(gl.ARRAY_BUFFER,p.V),ib:mkBuf(gl.ELEMENT_ARRAY_BUFFER,p.I),n:p.n1,n2:p.I.length-p.n1,cx:p.cx,cy:p.cy,cz:p.cz,rad:p.rad});
  buildFurniture();R.stats=buildCity();R.props=finishProps().map(p=>({cat:p.cat,vb:mkBuf(gl.ARRAY_BUFFER,p.V),ib:mkBuf(gl.ELEMENT_ARRAY_BUFFER,p.I),n:p.I.length,cx:p.cx,cy:p.cy,cz:p.cz,rad:p.rad}));
  buildQueries();
  /* dynamic effects buffer: quads of 9 floats/vertex */
  R.fxMax=2400;R.fxF=new Float32Array(R.fxMax*4*9);R.fx=mkBuf(gl.ARRAY_BUFFER,R.fxF.byteLength,gl.DYNAMIC_DRAW);
  const ix=new Uint16Array(R.fxMax*6);for(let q=0;q<R.fxMax;q++){const b=q*4;ix.set([b,b+1,b+2,b,b+2,b+3],q*6)}R.fxIx=mkBuf(gl.ELEMENT_ARRAY_BUFFER,ix);
  R.fxN=0;
  carGLInit();trGLInit();gfxInit();envInit();skyCubeInit();
}
function setEnvU(P){const gl=G.gl,u=P.u,E=ENV;gl.uniform3f(u.uCam,R.cx,R.cy,R.cz);if(u.uSun!=null){gl.uniform3fv(u.uSun,E.sun);gl.uniform3fv(u.uSunC,E.sunC);gl.uniform3fv(u.uAmbT,E.ambT);gl.uniform3fv(u.uAmbB,E.ambB);gl.uniform3fv(u.uHor,E.hor);gl.uniform3fv(u.uZen,E.zen);gl.uniform4f(u.uFogP,E.fog,E.fogY,E.fogSun,R.time);gl.uniform4fv(u.uGr,E.gr);if(u.uEnv!=null&&R.cube){gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_CUBE_MAP,R.cube.tex);gl.uniform1i(u.uEnv,5)}if(u.uSk!=null)gl.uniform4fv(u.uSk,E.sk);if(u.uStu!=null)gl.uniform1f(u.uStu,E.stu);if(u.uClA!=null){gl.uniform3fv(u.uClA,E.clA);gl.uniform3fv(u.uClB,E.clB);gl.uniform4fv(u.uSd,E.sd)}}}
function setMapU(P){const gl=G.gl,u=P.u;gl.uniform4f(u.uMap,W.half,.5/W.N,W.hrange,W.hmin)}
/* camera + frame */
function viewSet(cx,cy,cz,tx,ty,tz,fov,w,h){R.cx=cx;R.cy=cy;R.cz=cz;R.fov=fov;R.pxm=2*Math.tan(fov/2)/Math.max(1,h);   /* the size of a pixel, in metres per metre of distance (for lines that must stay a pixel wide) */M4.look(R.V,cx,cy,cz,tx,ty,tz);M4.persp(R.Pm,fov,w/h,.8,12000);M4.mul(R.VP,R.Pm,R.V);M4.planes(R.PL,R.VP);
  /* camera basis for the sky: forward, right = f x worldUp, up = right x f */
  let fx=tx-cx,fy=ty-cy,fz=tz-cz;const l=Math.hypot(fx,fy,fz)||1;fx/=l;fy/=l;fz/=l;let rx=-fz,rz=fx;const rl=Math.hypot(rx,rz)||1;rx/=rl;rz/=rl;
  R.fw[0]=fx;R.fw[1]=fy;R.fw[2]=fz;R.rt[0]=rx;R.rt[1]=0;R.rt[2]=rz;R.up[0]=-rz*fy;R.up[1]=rz*fx-rx*fz;R.up[2]=rx*fy}
function renderFrame(w,h,sky){
  const gl=G.gl;R.draws=0;R.tris=0;
  /* the scene goes into an off-screen target at the render scale (the post pass puts it on the canvas); if the GPU cannot, straight to the canvas */
  skyCubeUpdate();trPrep();shdPass();
  const post=GFX.ok&&gfxTarget(w,h);gl.bindFramebuffer(gl.FRAMEBUFFER,post?GFX.fbo:null);
  gl.viewport(0,0,w,h);gl.clearColor(ENV.hor[0]**.45,ENV.hor[1]**.45,ENV.hor[2]**.45,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gfxLights();
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.BLEND);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);
  const cx=R.cx,cz=R.cz;
  /* terrain clipmap, finest level first */
  let P=G.P.ter;gl.useProgram(P.p);setEnvU(P);setMapU(P);shdSetU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);gl.uniform1f(P.u.uHalf,W.half);
  bindTex(0,R.tex.h);gl.uniform1i(P.u.uH,0);bindTex(1,R.tex.col);gl.uniform1i(P.u.uCol,1);bindTex(2,R.tex.nz);gl.uniform1i(P.u.uNz,2);
  gl.bindBuffer(gl.ARRAY_BUFFER,R.terVB);attrs(1);gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);
  let phx=0,phz=0,phh=0;
  for(let l=0;l<R.lv;l++){const c=W.T*(1<<l),sn=c*2,lx=Math.round(cx/sn)*sn,lz=Math.round(cz/sn)*sn;
    gl.uniform4f(P.u.uLv,lx,lz,c,l);gl.uniform3f(P.u.uHole,phx,phz,l?phh-.02:0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,l?R.terRing:R.terIB);gl.drawElements(gl.TRIANGLES,l?R.ringN:R.fullN,gl.UNSIGNED_SHORT,0);R.draws++;R.tris+=(l?R.ringN:R.fullN)/3;
    phx=lx;phz=lz;phh=R.N*.5*c}
  /* roads */
  P=G.P.rd;gl.useProgram(P.p);setEnvU(P);gfxSetRoadU(P);shdSetU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);bindTex(0,R.tex.nz);gl.uniform1i(P.u.uNz,0);attrs(2);gl.disable(gl.CULL_FACE);
  for(let i=0;i<R.roads.length;i++){const p=R.roads[i],dx=p.cx-cx,dz=p.cz-cz,d=Math.hypot(dx,dz);if(d>R.drawRoad+p.rad||!M4.sphereIn(R.PL,p.cx,p.cy,p.cz,p.rad))continue;
    gl.bindBuffer(gl.ARRAY_BUFFER,p.vb);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,p.ib);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);gl.vertexAttribPointer(1,4,gl.FLOAT,false,28,12);
    /* a piece that is wholly further than R.roadLod is drawn from its lighter index list (stored after the full one) */
    const far=d-p.rad>R.roadLod,nn=far?p.n2:p.n;gl.drawElements(gl.TRIANGLES,nn,gl.UNSIGNED_SHORT,far?p.n*2:0);R.draws++;R.tris+=nn/3}
  /* props */
  P=G.P.pr;gl.useProgram(P.p);setEnvU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);gl.uniform4fv(P.u.uKO,KO.U1);gl.uniform4fv(P.u.uKO2,KO.U2);bindTex(0,R.tex.win);gl.uniform1i(P.u.uWin,0);bindTex(1,R.tex.fol);gl.uniform1i(P.u.uFol,1);gl.uniform1f(P.u.uT,R.time);gl.uniform1f(P.u.uNight,GFX.night);attrs(4);gl.enable(gl.CULL_FACE);
  for(let i=0;i<R.props.length;i++){const p=R.props[i],dist=R.drawProp[p.cat];const dx=p.cx-cx,dz=p.cz-cz;if(dx*dx+dz*dz>(dist+p.rad)*(dist+p.rad)||!M4.sphereIn(R.PL,p.cx,p.cy,p.cz,p.rad))continue;
    gl.bindBuffer(gl.ARRAY_BUFFER,p.vb);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,p.ib);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);gl.vertexAttribPointer(1,4,gl.BYTE,true,28,12);gl.vertexAttribPointer(2,4,gl.UNSIGNED_BYTE,true,28,16);gl.vertexAttribPointer(3,2,gl.FLOAT,false,28,20);gl.drawElements(gl.TRIANGLES,p.n,gl.UNSIGNED_SHORT,0);R.draws++;R.tris+=p.n/3}
  /* the player's car (+ rivals later) */
  if(R.carDraw)R.carDraw();if(R.trDraw)R.trDraw();heliDraw();
  /* sky: only where nothing else was drawn */
  P=G.P.sky;gl.useProgram(P.p);setEnvU(P);gl.disable(gl.CULL_FACE);bindTex(0,R.tex.nz);gl.uniform1i(P.u.uNz,0);
  const th=Math.tan(R.fov/2);gl.uniform3fv(P.u.uFw,R.fw);gl.uniform3fv(P.u.uRt,R.rt);gl.uniform3fv(P.u.uUp,R.up);gl.uniform2f(P.u.uTan,th*w/h,th);gl.bindBuffer(gl.ARRAY_BUFFER,R.skyB);attrs(1);gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);gl.drawArrays(gl.TRIANGLES,0,3);R.draws++;
  /* water + effects (blended, no depth writes) */
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
  if(R.carGlass)R.carGlass();
  P=G.P.wat;gl.useProgram(P.p);setEnvU(P);setMapU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);bindTex(0,R.tex.h);gl.uniform1i(P.u.uH,0);bindTex(2,R.tex.nz);gl.uniform1i(P.u.uNz,2);gl.bindBuffer(gl.ARRAY_BUFFER,R.watB);attrs(1);gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);gl.drawArrays(gl.TRIANGLES,0,6);R.draws++;
  if(R.fxDraw)R.fxDraw();
  gl.depthMask(true);gl.disable(gl.BLEND);
  if(post)gfxComposite(w,h)}
