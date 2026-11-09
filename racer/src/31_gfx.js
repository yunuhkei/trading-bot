'use strict';
/* ===== graphics tiers, the post pass (FXAA, speed blur, bloom, vignette), the lights near the car, and the automatic quality choice ===== */
/* The scene is drawn into an off-screen target at the render scale, then one pass puts it on the canvas: FXAA always, speed blur and bloom on the higher tiers.
   Tiers are picked from MEASURED frame cost (not from the phone model): see gfxGovern. Every number in the tier table is a budget, not a promise. */
const GFXT=[
 {name:'Low',   scMin:.55,scMax:.85,blur:0,bloom:0,shadow:0,NL:4,hi:0,glow:26,pool:5, fxq:.6, traf:1,   draw:.8, cost:1},
 {name:'Medium',scMin:.60,scMax:.95,blur:1,bloom:0,shadow:1,NL:6,hi:1,glow:48,pool:10,fxq:1,  traf:1,   draw:.95,cost:1.35},
 {name:'High',  scMin:.70,scMax:1.0,blur:1,bloom:1,shadow:2,NL:8,hi:1,glow:80,pool:16,fxq:1.4,traf:1.25,draw:1,  cost:1.9}];
const GFX={tier:1,mode:'auto',T:GFXT,cur:GFXT[1],fixed:false,ok:false,w:0,h:0,fbo:null,col:null,dep:null,bw:0,bh:0,bl:[null,null],blT:[null,null],
  wet:.85,night:.27,shadowOn:false,blurAmt:0,lt:new Float32Array(32),lc:new Float32Array(24),nlt:0,
  /* governor */ probeOn:0,probeN:0,probeT:[],work:0,workLast:0,late:0,okRuns:0,upLock:[0,0,0],since:0,lastIv:0,ivAvg:16.7,ivN:0,hist:[],log:[]};
const _gp={};
const GATTR={sky:['aP'],ter:['aIJ'],rd:['aP','aA'],pr:['aP','aN','aC','aU'],car:['aP','aN','aC'],tr:['aP','aN','aI0','aI1'],fx:['aP','aC','aU'],wat:['aP']};
function gfxProg(name,defs){const k=name+JSON.stringify(defs||{});if(!_gp[k])_gp[k]=mkProg(name,SH[name+'V'],SH[name+'F'],GATTR[name],defs);return _gp[k]}
/* ---------------- the post pass ---------------- */
const POSTV='attribute vec2 aP;varying vec2 vU;void main(){vU=aP*.5+.5;gl_Position=vec4(aP,0.,1.);}';
const POSTF=PRE+'varying vec2 vU;uniform sampler2D uS,uB;uniform vec2 uPx;uniform vec4 uP;/* x speed blur, y bloom, z vignette, w time */\n'+
 'float lum(vec3 c){return dot(c,vec3(.299,.587,.114));}\n'+
 'vec3 T(vec2 u){return texture2D(uS,u).rgb;}\n'+
 /* FXAA (the console version of Lottes): finds the edge direction from the luma of the four neighbours and blurs along it */
 'vec3 fxaa(vec2 uv){vec3 M=T(uv);float lM=lum(M),lNW=lum(T(uv+vec2(-1.,-1.)*uPx)),lNE=lum(T(uv+vec2(1.,-1.)*uPx)),lSW=lum(T(uv+vec2(-1.,1.)*uPx)),lSE=lum(T(uv+vec2(1.,1.)*uPx));'+
  'float lo=min(lM,min(min(lNW,lNE),min(lSW,lSE))),hi=max(lM,max(max(lNW,lNE),max(lSW,lSE)));if(hi-lo<max(.0312,hi*.125))return M;'+
  'vec2 d=vec2(-((lNW+lNE)-(lSW+lSE)),(lNW+lSW)-(lNE+lSE));float dr=max((lNW+lNE+lSW+lSE)*.03125,.0078125);float rc=1./(min(abs(d.x),abs(d.y))+dr);d=clamp(d*rc,-8.,8.)*uPx;'+
  'vec3 A=.5*(T(uv+d*(1./3.-.5))+T(uv+d*(2./3.-.5)));vec3 B=A*.5+.25*(T(uv+d*-.5)+T(uv+d*.5));float lB=lum(B);return (lB<lo||lB>hi)?A:B;}\n'+
 'void main(){vec2 uv=vU;vec3 c=fxaa(uv);'+
  '\n#ifdef BLUR\nvec2 q=uv-vec2(.5,.46);float r=length(q*vec2(1.6,1.));float k=uP.x*smoothstep(.20,.62,r);if(k>.002){vec3 s=c;for(int i=1;i<=BLUR;i++){s+=T(uv-q*k*float(i)/float(BLUR)*.28);}c=s/float(BLUR+1);}\n#endif\n'+
  '\n#ifdef BLOOM\nc+=texture2D(uB,uv).rgb*uP.y;\n#endif\n'+
  'vec2 v=uv-.5;c*=1.-uP.z*dot(v,v)*1.5;'+
  'gl_FragColor=vec4(c+(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233))+uP.w)*43758.5453)-.5)/255.,1.);}';
/* bloom: the bright parts of the picture, shrunk to a quarter, blurred, added back */
const BRF=PRE+'varying vec2 vU;uniform sampler2D uS;uniform vec2 uPx;\n'+
 'void main(){vec3 s=(texture2D(uS,vU+uPx*vec2(-1.,-1.)).rgb+texture2D(uS,vU+uPx*vec2(1.,-1.)).rgb+texture2D(uS,vU+uPx*vec2(-1.,1.)).rgb+texture2D(uS,vU+uPx*vec2(1.,1.)).rgb)*.25;'+
  'float l=dot(s,vec3(.3,.55,.15));float k=smoothstep(.62,.95,l);gl_FragColor=vec4(s*k,1.);}';
const BLF=PRE+'varying vec2 vU;uniform sampler2D uS;uniform vec2 uPx;/* the step: (1/w,0) or (0,1/h) */\n'+
 'void main(){vec3 c=texture2D(uS,vU).rgb*.2270270270;c+=texture2D(uS,vU+uPx*1.3846153846).rgb*.3162162162+texture2D(uS,vU-uPx*1.3846153846).rgb*.3162162162;c+=texture2D(uS,vU+uPx*3.2307692308).rgb*.0702702703+texture2D(uS,vU-uPx*3.2307692308).rgb*.0702702703;gl_FragColor=vec4(c,1.);}';
function gfxMakeTex(w,h){const gl=G.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t}
function gfxFree(){const gl=G.gl;for(const o of[GFX.fbo,GFX.bl[0],GFX.bl[1]])if(o)gl.deleteFramebuffer(o);for(const t of[GFX.col,GFX.blT[0],GFX.blT[1]])if(t)gl.deleteTexture(t);if(GFX.dep)gl.deleteRenderbuffer(GFX.dep);
  GFX.fbo=GFX.col=GFX.dep=null;GFX.bl=[null,null];GFX.blT=[null,null];GFX.w=GFX.h=GFX.bw=GFX.bh=0}
/* make (or resize) the off-screen target; false = this GPU cannot do it and the scene goes straight to the canvas */
function gfxTarget(w,h){
  const gl=G.gl,wantBloom=!!GFX.cur.bloom,bw=Math.max(8,w>>2),bh=Math.max(8,h>>2);
  if(GFX.fbo&&GFX.w==w&&GFX.h==h&&(!wantBloom||GFX.bl[0]))return true;
  gfxFree();
  try{GFX.col=gfxMakeTex(w,h);GFX.dep=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,GFX.dep);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_STENCIL,w,h);
    GFX.fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,GFX.fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,GFX.col,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.RENDERBUFFER,GFX.dep);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!=gl.FRAMEBUFFER_COMPLETE)throw new Error('fbo incomplete');
    if(wantBloom){for(let i=0;i<2;i++){GFX.blT[i]=gfxMakeTex(bw,bh);GFX.bl[i]=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,GFX.bl[i]);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,GFX.blT[i],0);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!=gl.FRAMEBUFFER_COMPLETE)throw new Error('bloom fbo incomplete')}}
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);GFX.w=w;GFX.h=h;GFX.bw=bw;GFX.bh=bh;return true}
  catch(e){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gfxFree();GFX.ok=false;console.warn('post pass off: '+e.message);return false}}
/* ---------------- tiers ---------------- */
function gfxInit(){
  GFX.ok=true;gfxLampIndex();
  let m=QS.get('q');try{if(!m)m=localStorage.getItem('racer.gfx')||'auto'}catch(e){m=m||'auto'}if(m!='high'&&m!='low')m='auto';GFX.mode=m;
  const t=QS.has('tier')?Math.max(0,Math.min(2,parseInt(QS.get('tier'))||0)):(QS.has('fixed')?0:(m=='high'?2:m=='low'?0:1));
  GFX.fixed=QS.has('tier')||QS.has('fixed');gfxSetTier(t,true);if(UI.bn&&UI.bn.qual)UI.bn.qual.label='GFX '+GFX.mode.toUpperCase()}
function gfxProg2(name,vs,fs,attrs,defs){const k=name+JSON.stringify(defs||{});if(!_gp[k])_gp[k]=mkProg(name,vs,fs,attrs,defs);return _gp[k]}
function gfxSetTier(t,force){
  t=Math.max(0,Math.min(2,t|0));if(!force&&t==GFX.tier)return;const T=GFXT[t];GFX.tier=t;GFX.cur=T;
  /* shader variants for this tier */
  const sd=T.shadow?{SHADOW:T.shadow}:{};G.P.rd=gfxProg('rd',Object.assign({NL:T.NL},sd));G.P.ter=gfxProg('ter',sd);G.P.sky=gfxProg('sky',T.hi?{HI:1}:{});
  const pd={};if(T.blur)pd.BLUR=T.bloom?6:4;if(T.bloom)pd.BLOOM=1;G.P.postv=gfxProg2('post',POSTV,POSTF,['aP'],pd);
  if(T.bloom&&!G.P.bright){G.P.bright=gfxProg2('bright',POSTV,BRF,['aP']);G.P.blur=gfxProg2('blur',POSTV,BLF,['aP'])}
  const lo=t==0;R.drawProp=[Math.round((lo?380:560)*T.draw),Math.round((lo?800:1250)*T.draw),Math.round((lo?260:420)*T.draw)];R.drawRoad=Math.round(1900*T.draw);
  if(!GFX.fixed){Q.min=T.scMin;Q.max=T.scMax;Q.scale=Math.max(Q.min,Math.min(Q.max,Q.scale))}
  if(typeof trSetMul=='function')trSetMul(T.traf);
  GFX.since=0;Q.apply()}
function gfxSetMode(m){GFX.mode=m;try{localStorage.setItem('racer.gfx',m)}catch(e){}
  if(m=='high'){GFX.fixed=false;gfxSetTier(2)}else if(m=='low'){GFX.fixed=false;gfxSetTier(0)}else{GFX.fixed=false;gfxSetTier(1)}GFX.upLock=[0,0,0];GFX.okRuns=0}
/* ---------------- lamps: a grid so the renderer finds the ones near the car without a scan of every lamp ---------------- */
const LGRIDM=new Map(),LGC=64;
function gfxLampIndex(){LGRIDM.clear();for(let i=0;i<LAMPS.length;i+=3){const k=Math.floor(LAMPS[i]/LGC)*8192+Math.floor(LAMPS[i+2]/LGC);let a=LGRIDM.get(k);if(!a){a=[];LGRIDM.set(k,a)}a.push(i)}}
const _lampPick=new Int32Array(128),_lampScore=new Float32Array(128);
/* the k lamps nearest to (x,z) within r metres, nearest first (indexes into LAMPS, step 3) */
function gfxNearLamps(x,z,r,k,ahx,ahz){let n=0;k=Math.min(k,128);if(k<1)return 0;const c0=Math.floor((x-r)/LGC),c1=Math.floor((x+r)/LGC),d0=Math.floor((z-r)/LGC),d1=Math.floor((z+r)/LGC),r2=r*r;
  for(let cx=c0;cx<=c1;cx++)for(let cz=d0;cz<=d1;cz++){const a=LGRIDM.get(cx*8192+cz);if(!a)continue;
    for(let q=0;q<a.length;q++){const i=a[q],dx=LAMPS[i]-x,dz=LAMPS[i+2]-z,d2=dx*dx+dz*dz;if(d2>r2)continue;const sc=d2-(dx*ahx+dz*ahz)*6;   /* lamps ahead of the car count as nearer */
      let p=n<k?n++:k;if(p==k&&sc>=_lampScore[k-1])continue;if(p==k)p=k-1;while(p>0&&_lampScore[p-1]>sc){_lampScore[p]=_lampScore[p-1];_lampPick[p]=_lampPick[p-1];p--}_lampScore[p]=sc;_lampPick[p]=i}}
  return n}
/* ---------------- lights near the car (used by the wet road) ---------------- */
function gfxLights(){
  const T=GFX.cur,NL=T.NL,lt=GFX.lt,lc=GFX.lc;let n=0;const sy=Math.sin(C.yaw),cy=Math.cos(C.yaw),fx=sy,fz=-cy;
  const put=(x,y,z,rad,r,g,b)=>{if(n>=NL)return;const o=n*4;lt[o]=x;lt[o+1]=y;lt[o+2]=z;lt[o+3]=rad;lc[n*3]=r;lc[n*3+1]=g;lc[n*3+2]=b;n++};
  /* the car's headlights (a pool on the road ahead) and tail lights (red, stronger on the brakes) */
  put(C.x+fx*7,C.y+.9,C.z+fz*7,30,.95,.88,.62);put(C.x-fx*2.6,C.y+.5,C.z-fz*2.6,10,C.braking?1.5:.55,.06,.03);
  const nl=Math.min(NL-n-(NL>=6?2:0),6),k=gfxNearLamps(C.x,C.z,110,Math.max(0,nl),fx,fz);for(let i=0;i<k;i++){const j=_lampPick[i];put(LAMPS[j],LAMPS[j+1],LAMPS[j+2],26,.82,.62,.38)}
  /* traffic: the lights of the nearest cars */
  if(NL>=6&&TR.on){let b1=-1,b2=-1,d1=1e9,d2=1e9;for(let i=0;i<TR.cars.length;i++){const c=TR.cars[i];if(!c.alive||c.state>2)continue;const dx=c.x-C.x,dz=c.z-C.z,d=dx*dx+dz*dz;if(d>6400)continue;if(d<d1){b2=b1;d2=d1;b1=i;d1=d}else if(d<d2){b2=i;d2=d}}
    for(const bi of[b1,b2]){if(bi<0)continue;const c=TR.cars[bi],cs=Math.sin(c.yaw),cc=Math.cos(c.yaw),toward=((C.x-c.x)*cs+(C.z-c.z)*-cc)>0;
      /* a car coming at us shows its headlights, one going away its tail lights */
      if(toward)put(c.x+cs*3,c.y+.7,c.z-cc*3,24,.9,.86,.7);else put(c.x-cs*2.4,c.y+.6,c.z+cc*2.4,9,c.brake?1.4:.5,.05,.03)}}
  GFX.nlt=n;for(let i=n;i<NL;i++){lt[i*4+3]=.001;lc[i*3]=lc[i*3+1]=lc[i*3+2]=0;lt[i*4]=lt[i*4+1]=lt[i*4+2]=0}}
function gfxSetRoadU(P){const gl=G.gl,u=P.u,NL=GFX.cur.NL;gl.uniform1f(u.uWet,GFX.wet);gl.uniform4fv(u.uLt,GFX.lt.subarray(0,NL*4));gl.uniform3fv(u.uLc,GFX.lc.subarray(0,NL*3))}
/* ---------------- the pass that puts the picture on the screen ---------------- */
function gfxComposite(w,h){
  const gl=G.gl,T=GFX.cur;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);
  gl.bindBuffer(gl.ARRAY_BUFFER,R.skyB);attrs(1);gl.vertexAttribPointer(0,2,gl.FLOAT,false,8,0);
  if(T.bloom&&GFX.bl[0]){
    let P=G.P.bright;gl.useProgram(P.p);gl.bindFramebuffer(gl.FRAMEBUFFER,GFX.bl[0]);gl.viewport(0,0,GFX.bw,GFX.bh);bindTex(0,GFX.col);gl.uniform1i(P.u.uS,0);gl.uniform2f(P.u.uPx,1/w,1/h);gl.drawArrays(gl.TRIANGLES,0,3);
    P=G.P.blur;gl.useProgram(P.p);gl.bindFramebuffer(gl.FRAMEBUFFER,GFX.bl[1]);bindTex(0,GFX.blT[0]);gl.uniform1i(P.u.uS,0);gl.uniform2f(P.u.uPx,1/GFX.bw,0);gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindFramebuffer(gl.FRAMEBUFFER,GFX.bl[0]);bindTex(0,GFX.blT[1]);gl.uniform2f(P.u.uPx,0,1/GFX.bh);gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);R.draws+=3}
  const P=G.P.postv;gl.useProgram(P.p);bindTex(0,GFX.col);gl.uniform1i(P.u.uS,0);if(P.u.uB){bindTex(1,GFX.blT[0]||GFX.col);gl.uniform1i(P.u.uB,1)}gl.uniform2f(P.u.uPx,1/w,1/h);
  gl.uniform4f(P.u.uP,GFX.blurAmt,.6,.5,R.time%100);gl.drawArrays(gl.TRIANGLES,0,3);R.draws++}
/* speed blur: from about 45 m/s, more with nitro */
function gfxUpdate(dt){const sp=(C.speed||0)+(C.boosting?14:0),t=Math.max(0,Math.min(1,(sp-38)/60));GFX.blurAmt+=(t*.9-GFX.blurAmt)*Math.min(1,dt*3)}
/* ---------------- the automatic quality choice ----------------
   The frame rate on a phone is capped at the screen rate, so "frames are on time" says nothing about how much room is left. So every few seconds a short probe times a few frames
   WITH a forced wait for the GPU (a 1-pixel readback), which gives the real cost of a frame (CPU + GPU, not overlapped, so a bit pessimistic). The rules are made so the phone is never run flat out:
   step UP only if the next tier's estimated cost stays under 9.5 ms (57 % of a 60 fps frame) twice in a row; step DOWN at 13.5 ms or when frames are late; resolution moves first, tier second. */
const GOV={budget:16.7,upMs:9.5,downMs:13.5,probeEvery:2.6,probeFrames:8,cool:9,lockT:70};
function gfxFrameStart(){GFX.t0=performance.now()}
/* called at the end of the frame, after the picture is complete */
function gfxFrameEnd(ms){
  GFX.ivN++;GFX.ivAvg+=(ms-GFX.ivAvg)*.06;GFX.since+=ms/1000;
  if(GFX.mode!='auto'&&!QS.has('govern'))return;if(GFX.fixed)return;
  if(!GFX.probeOn){if(GFX.since>GOV.cool&&((GFX.ivN%Math.round(GOV.probeEvery*50))==0)){GFX.probeOn=1;GFX.probeN=0;GFX.probeT.length=0}}
  else{const gl=G.gl;gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,_rp);const w=performance.now()-GFX.t0;GFX.probeT.push(w);
    if(++GFX.probeN>=GOV.probeFrames){GFX.probeOn=0;GFX.probeT.sort((a,b)=>a-b);const med=GFX.probeT[GFX.probeT.length>>1];gfxGovern(med,GFX.ivAvg)}}}
const _rp=new Uint8Array(4);
/* the decision (also called by the tests with made-up numbers). work = ms for a whole frame, iv = average time between frames */
function gfxGovern(work,iv){
  GFX.work=work;const T=GFX.cur,t=GFX.tier;GFX.late=iv>GOV.budget*1.14?1:0;const now=performance.now();let act='';
  const heavy=work>GOV.downMs||GFX.late;
  if(heavy){GFX.okRuns=0;
    if(Q.scale>T.scMin+.011){Q.scale=Math.max(T.scMin,Q.scale-(work>GOV.downMs*1.5?.1:.05));Q.apply();act='scale down'}
    else if(t>0){GFX.upLock[t]=now+GOV.lockT*1000;gfxSetTier(t-1);Q.scale=GFXT[t-1].scMax*.92;Q.apply();act='tier down'}}
  else{
    /* room to grow? estimate the cost at the next step and keep it under the up limit */
    const nextScale=Math.min(T.scMax,Q.scale+.05);const estScale=work*(nextScale*nextScale)/(Q.scale*Q.scale);
    if(Q.scale<T.scMax-.011){if(estScale<GOV.upMs){if(++GFX.okRuns>=2){Q.scale=nextScale;Q.apply();GFX.okRuns=0;act='scale up'}}else GFX.okRuns=0}
    else if(t<2&&now>GFX.upLock[t+1]){const est=work*GFXT[t+1].cost/T.cost;if(est<GOV.upMs){if(++GFX.okRuns>=2){gfxSetTier(t+1);Q.scale=GFXT[t+1].scMin+.05;Q.apply();GFX.okRuns=0;act='tier up'}}else GFX.okRuns=0}}
  if(act){GFX.since=0;GFX.log.push({work:+work.toFixed(1),iv:+iv.toFixed(1),act,tier:GFX.tier,scale:+Q.scale.toFixed(2)});if(GFX.log.length>40)GFX.log.shift()}
  return act}
