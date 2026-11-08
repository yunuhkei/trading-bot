'use strict';
/* ===== controls (touch + keyboard), HUD, minimap, audio, adaptive quality ===== */
const UI={w:1,h:1,dpr:1,hud:null,ctx:null,touches:new Map(),stick:null,btn:[],showStats:false,fps:60,ms:16,mapCv:null,paused:false,keys:{},msg:'',msgT:0,tilt:0,lastTap:0,locName:'',locT:0};
function uiInit(){
  UI.hud=$('hud');UI.ctx=UI.hud.getContext('2d');
  const cv=$('gl');
  /* touch: the left half steers like a thumb-stick that appears where you touch; buttons on the right */
  const tp=(e)=>{e.preventDefault();const r=cv.getBoundingClientRect();for(const t of e.changedTouches){t.cx=t.clientX-r.left;t.cy=t.clientY-r.top}};
  const down=(id,x,y)=>{
    if(UI.paused){UI.paused=false;UI.touches.set(id,{type:'none'});return}
    for(const b of UI.btn){if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h){UI.touches.set(id,{type:'btn',b});b.on=1;b.act&&b.act(1);return}}
    if(x<UI.w*.55){const t={type:'stick',x0:x,y0:y,x:x,y:y};UI.touches.set(id,t);UI.stickT=t;return}
    UI.touches.set(id,{type:'none'})};
  const move=(id,x,y)=>{const t=UI.touches.get(id);if(t&&t.type=='stick'){t.x=x;t.y=y}};
  const up=(id)=>{const t=UI.touches.get(id);if(t&&t.type=='btn'){t.b.on=0;t.b.act&&t.b.act(0)}if(t&&t===UI.stickT)UI.stickT=null;UI.touches.delete(id)};
  const opt={passive:false};
  cv.addEventListener('touchstart',e=>{tp(e);for(const t of e.changedTouches)down(t.identifier,t.cx,t.cy);audioStart()},opt);
  cv.addEventListener('touchmove',e=>{tp(e);for(const t of e.changedTouches)move(t.identifier,t.cx,t.cy)},opt);
  cv.addEventListener('touchend',e=>{tp(e);for(const t of e.changedTouches)up(t.identifier)},opt);cv.addEventListener('touchcancel',e=>{tp(e);for(const t of e.changedTouches)up(t.identifier)},opt);
  /* mouse (desktop testing): same as one finger */
  let md=false;cv.addEventListener('mousedown',e=>{md=true;down('m',e.offsetX,e.offsetY);audioStart()});window.addEventListener('mousemove',e=>{if(md){const r=cv.getBoundingClientRect();move('m',e.clientX-r.left,e.clientY-r.top)}});window.addEventListener('mouseup',()=>{if(md){md=false;up('m')}});
  const K=UI.keys;window.addEventListener('keydown',e=>{K[e.code]=1;if(e.code=='KeyR')IN.respawn=1;if(e.code=='KeyF'){UI.showStats=!UI.showStats}if(e.code=='KeyP'||e.code=='Escape')UI.paused=!UI.paused;if(e.code=='KeyG')IN.auto=!IN.auto;if(e.code=='KeyM')UI.bigMap=!UI.bigMap;audioStart();if(/Arrow|Space/.test(e.code))e.preventDefault()});
  window.addEventListener('keyup',e=>{K[e.code]=0});
  window.addEventListener('blur',()=>{for(const k in K)K[k]=0;UI.touches.clear();UI.stickT=null;UI.btn.forEach(b=>b.on=0)});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)UI.paused=true});
  uiLayout()}
function uiLayout(){
  const b=UI.btn;b.length=0;const w=UI.w,h=UI.h,u=Math.min(w,h*1.5)/10;
  const add=(id,label,x,y,rw,rh,act,col)=>b.push({id,label,x,y,w:rw,h:rh,act,on:0,col});
  add('nitro','NITRO',w-u*2.7,h-u*2.7,u*2.3,u*2.3,v=>{IN.nitro=v},'#ff7a1a');
  add('drift','DRIFT',w-u*5.2,h-u*1.9,u*2.1,u*1.7,v=>{IN.hand=v},'#2aa8ff');
  add('brake','BRAKE',w-u*5.2,h-u*3.9,u*2.1,u*1.7,v=>{IN.brk=v},'#ff3b3b');
  add('reset','RESET',w-u*1.55,u*.35,u*1.25,u*.7,v=>{if(v)IN.respawn=1},'#8a94a6');
  add('auto','AUTO',w-u*3,u*.35,u*1.3,u*.7,v=>{if(v)IN.auto=!IN.auto},'#8a94a6');
  add('stat','FPS',u*.3,u*.3,u*1,u*.7,v=>{if(v)UI.showStats=!UI.showStats},'#8a94a6');
  add('pause','II',u*1.45,u*.3,u*.8,u*.7,v=>{if(v)UI.paused=true},'#8a94a6');
  UI.bn={};b.forEach(x=>UI.bn[x.id]=x);
  UI.btnU=u}
function uiResize(){
  const cv=$('gl'),dpr=Math.min(window.devicePixelRatio||1,2),cw=window.innerWidth,ch=window.innerHeight;UI.w=cw;UI.h=ch;UI.dpr=dpr;
  UI.hud.width=Math.round(cw*Math.min(dpr,2));UI.hud.height=Math.round(ch*Math.min(dpr,2));
  Q.apply();uiLayout()}
/* quality governor: render scale only (cheap, effective); keeps frame time near 16 ms */
const Q={scale:.8,min:.45,max:1,acc:0,n:0,cool:0,aa:false,
  apply(){const cv=$('gl'),dpr=Math.min(window.devicePixelRatio||1,2),w=Math.max(2,Math.round(UI.w*dpr*Q.scale)),h=Math.max(2,Math.round(UI.h*dpr*Q.scale));if(cv.width!=w||cv.height!=h){cv.width=w;cv.height=h}UI.cw=w;UI.ch=h;
    const lo=Q.scale<.62;R.drawProp=[lo?380:560,lo?900:1500,lo?260:420];R.drawRoad=lo?1400:2200},
  frame(ms){UI.ms+=(ms-UI.ms)*.08;Q.acc+=ms;Q.n++;Q.cool-=ms;
    if(Q.n>=40){const avg=Q.acc/Q.n;Q.acc=0;Q.n=0;
      if(avg>19&&Q.scale>Q.min&&Q.cool<=0){Q.scale=Math.max(Q.min,Q.scale-(avg>28?.12:.06));Q.cool=1200;Q.apply()}
      else if(avg<12.5&&Q.scale<Q.max&&Q.cool<=-3000){Q.scale=Math.min(Q.max,Q.scale+.05);Q.cool=1200;Q.apply()}}}};
/* read inputs into IN each frame */
function uiInputs(dt){
  const K=UI.keys;let st=0;
  if(K.ArrowLeft||K.KeyA)st-=1;if(K.ArrowRight||K.KeyD)st+=1;
  let gas=K.ArrowUp||K.KeyW?1:0,brk=K.ArrowDown||K.KeyS?1:0;
  let tstick=UI.stickT;
  if(tstick){const R2=Math.max(46,UI.w*.075);st+=clamp((tstick.x-tstick.x0)/R2,-1,1)}
  /* steering response: eases in so small thumb movements are gentle */
  const target=clamp(st,-1,1),sh=Math.sign(target)*Math.pow(Math.abs(target),1.25);
  C.steer+=(sh-C.steer)*Math.min(1,dt*(Math.abs(sh)>Math.abs(C.steer)?9:14));
  if(K.Space)IN.hand=1;else if(!UI.bn.drift.on)IN.hand=0;
  if(K.ShiftLeft||K.ShiftRight||K.KeyN)IN.nitro=1;else if(!UI.bn.nitro.on)IN.nitro=0;
  if(brk)IN.brk=1;else if(!UI.bn.brake.on)IN.brk=0;
  IN.thr=gas?1:0;
  /* a held touch on the car's own button area does the rest */
}
/* ---------- minimap ---------- */
function mapInit(){
  const S=512,cv=UI.mapCv=document.createElement('canvas');cv.width=cv.height=S;const x=cv.getContext('2d');const id=x.createImageData(S,S),c=W.col,CN=W.CN;
  for(let j=0;j<S;j++)for(let i=0;i<S;i++){const ci=Math.floor(i*CN/S),cj=Math.floor(j*CN/S),o=(cj*CN+ci)*4,k=(j*S+i)*4,wx=-W.half+(i+.5)*W.size/S,wz=-W.half+(j+.5)*W.size/S,h=terrainH(wx,wz);
    if(h<0){id.data[k]=26;id.data[k+1]=62;id.data[k+2]=96}else{id.data[k]=c[o]*.62+10;id.data[k+1]=c[o+1]*.62+12;id.data[k+2]=c[o+2]*.62+14}id.data[k+3]=255}
  x.putImageData(id,0,0);const sc=S/W.size;x.lineCap='round';x.lineJoin='round';
  const stroke=(r,w,col)=>{x.beginPath();for(let i=0;i<r.n;i++){const px=(r.X[i]+W.half)*sc,pz=(r.Z[i]+W.half)*sc;i?x.lineTo(px,pz):x.moveTo(px,pz)}if(r.closed)x.closePath();x.lineWidth=w;x.strokeStyle=col;x.stroke()};
  for(const r of ROADS){const big=r.style==1||r.id=='mp'||r.id=='cr';stroke(r,r.city?1.1:(big?2.6:2),'rgba(0,0,0,.55)')}
  for(const r of ROADS){const big=r.style==1;stroke(r,r.city?.55:(big?1.5:1.1),r.city?'#c9ced6':(big?'#ffd36a':'#ffffff'))}
  UI.mapSc=sc}
function drawMap(ctx,cx,cy,rad,zoomM,rot){
  /* zoomM = metres across the circle's radius */
  const S=UI.mapCv.width,pxm=S/W.size,s=rad/zoomM/pxm;ctx.save();ctx.beginPath();ctx.arc(cx,cy,rad,0,TAU);ctx.clip();ctx.fillStyle='#10202e';ctx.fillRect(cx-rad,cy-rad,rad*2,rad*2);
  ctx.translate(cx,cy);ctx.rotate(rot);ctx.scale(s,s);ctx.translate(-(C.x+W.half)*pxm,-(C.z+W.half)*pxm);ctx.imageSmoothingEnabled=true;ctx.drawImage(UI.mapCv,0,0);ctx.restore();
  ctx.save();ctx.translate(cx,cy);ctx.fillStyle='#ff7a1a';ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-rad*.14);ctx.lineTo(rad*.09,rad*.1);ctx.lineTo(0,rad*.05);ctx.lineTo(-rad*.09,rad*.1);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  ctx.beginPath();ctx.arc(cx,cy,rad,0,TAU);ctx.lineWidth=3;ctx.strokeStyle='rgba(255,255,255,.85)';ctx.stroke()}
const REGIONS=[['Downtown',()=>C.x>CITY.x0-60&&C.x<CITY.x1+60&&C.z>CITY.z0-60&&C.z<CITY.z1+60],['Mountain pass',()=>terrainH(C.x,C.z)>130&&C.x>600&&C.z<-700],['Pacific coast',()=>C.x<-1700],['North shore',()=>C.z<-2000],['Southern plains',()=>C.z>1700],['Highlands',()=>C.x>1300&&C.z<-300],['Orbital ring',()=>Math.hypot(C.x*.9,C.z-100)>1100],['Suburbs',()=>true]];
function regionName(){for(const r of REGIONS)if(r[1]())return r[0];return''}
/* ---------- HUD ---------- */
function hudDraw(){
  const c=UI.ctx,w=UI.hud.width,h=UI.hud.height,k=w/UI.w;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,w,h);c.scale(k,k);const W_=UI.w,H_=UI.h,u=UI.btnU;
  c.textBaseline='alphabetic';c.font='700 12px -apple-system,Roboto,sans-serif';
  /* speed */
  const kmh=Math.round(C.kmh),bx=u*.45,by=H_-u*.45;
  c.save();c.shadowColor='rgba(0,0,0,.6)';c.shadowBlur=6;c.fillStyle='#fff';c.font='800 '+Math.round(u*1.35)+'px -apple-system,Roboto,sans-serif';c.textAlign='left';c.fillText(String(kmh),bx,by);
  const tw=c.measureText(String(kmh)).width;c.font='700 '+Math.round(u*.42)+'px -apple-system,Roboto,sans-serif';c.fillStyle='rgba(255,255,255,.8)';c.fillText('km/h',bx+tw+6,by);c.restore();
  /* nitro bar */
  const nw=u*4.2,nh=u*.2,nx=bx,ny=by-u*1.75;c.fillStyle='rgba(0,0,0,.45)';c.fillRect(nx-2,ny-2,nw+4,nh+4);c.fillStyle=C.boosting?'#ffffff':'#ff9a1f';c.fillRect(nx,ny,nw*C.nos,nh);
  c.fillStyle='rgba(255,255,255,.75)';c.font='700 '+Math.round(u*.3)+'px -apple-system,Roboto,sans-serif';c.fillText('NITRO',nx,ny-5);
  /* drift score */
  if(C.driftTime>.25){c.save();c.textAlign='center';c.font='800 '+Math.round(u*.55)+'px -apple-system,Roboto,sans-serif';c.fillStyle='#7fd4ff';c.shadowColor='rgba(0,0,0,.7)';c.shadowBlur=5;c.fillText('DRIFT  '+Math.round(C.driftScore),W_*.5,u*1.5);c.restore()}
  /* minimap */
  const mr=Math.min(W_,H_)*.17,mcx=W_-mr-u*.4,mcy=u*1.7+mr;drawMap(c,mcx,mcy,mr,UI.bigMap?1800:420,-C.yaw);
  /* location banner */
  if(C.t-UI.locT>1.5){const n=regionName();if(n!==UI.locName){UI.locName=n;UI.locT=C.t}}
  if(UI.locName&&C.t-UI.locT<3.5){const a=Math.min(1,(3.5-(C.t-UI.locT)),(C.t-UI.locT)*3);c.save();c.globalAlpha=a;c.textAlign='center';c.font='800 '+Math.round(u*.55)+'px -apple-system,Roboto,sans-serif';c.fillStyle='#fff';c.shadowColor='rgba(0,0,0,.7)';c.shadowBlur=6;c.fillText(UI.locName.toUpperCase(),W_*.5,H_*.2);c.restore()}
  /* buttons */
  for(const b of UI.btn){const on=b.on||(b.id=='auto'&&IN.auto)||(b.id=='stat'&&UI.showStats);c.globalAlpha=on?.95:.62;c.fillStyle=on?b.col:'rgba(20,24,32,.55)';c.strokeStyle=b.col;c.lineWidth=2;const r=Math.min(b.w,b.h)*.28;rr(c,b.x,b.y,b.w,b.h,r);c.fill();c.stroke();c.globalAlpha=1;c.fillStyle=on?'#111':'#fff';c.textAlign='center';c.font='800 '+Math.round(Math.min(b.h*.34,u*.5))+'px -apple-system,Roboto,sans-serif';c.fillText(b.label+(b.id=='auto'?(IN.auto?' ON':' OFF'):''),b.x+b.w/2,b.y+b.h/2+b.h*.12)}
  /* the thumb-stick ring where the left thumb is */
  {const t=UI.stickT;if(t){c.globalAlpha=.5;c.strokeStyle='#fff';c.lineWidth=3;c.beginPath();c.arc(t.x0,t.y0,Math.max(46,UI.w*.075),0,TAU);c.stroke();c.fillStyle='#fff';c.beginPath();c.arc(clamp(t.x,t.x0-Math.max(46,UI.w*.075),t.x0+Math.max(46,UI.w*.075)),t.y0,18,0,TAU);c.fill();c.globalAlpha=1}}
  /* stats */
  if(UI.showStats){c.textAlign='left';c.font='600 11px ui-monospace,Menlo,monospace';c.fillStyle='rgba(0,0,0,.6)';c.fillRect(u*.3,u*1.15,230,92);c.fillStyle='#9dffb0';const l=[Math.round(1000/UI.ms)+' fps  '+UI.ms.toFixed(1)+' ms',R.draws+' draws  '+Math.round(R.tris/1000)+'k tris',(UI.cw||0)+'x'+(UI.ch||0)+'  scale '+Q.scale.toFixed(2),'AA '+(G.aa?'on':'off')+'  dpr '+(window.devicePixelRatio||1),'x '+C.x.toFixed(0)+' z '+C.z.toFixed(0)+' y '+C.y.toFixed(1),'road '+(C.onRoad?'yes':'no')+'  air '+(C.grounded?'no':'yes')];l.forEach((t,i)=>c.fillText(t,u*.3+6,u*1.15+14+i*14))}
  if(UI.paused&&!window.__shot){c.fillStyle='rgba(0,0,0,.55)';c.fillRect(0,0,W_,H_);c.fillStyle='#fff';c.textAlign='center';c.font='800 28px sans-serif';c.fillText('PAUSED - tap to resume',W_/2,H_/2)}
  if(C.flash>.02){c.fillStyle='rgba(255,255,255,'+C.flash*.5+')';c.fillRect(0,0,W_,H_)}
}
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}
/* ---------- audio: synthesised engine, wind, tyres ---------- */
const AU={ctx:null,eng:null,eng2:null,gain:null,wind:null,tire:null,ready:false};
function audioStart(){if(AU.ctx||window.__noAudio)return;try{const A=window.AudioContext||window.webkitAudioContext;if(!A)return;const x=AU.ctx=new A();
  const mkNoise=()=>{const b=x.createBuffer(1,x.sampleRate*2,x.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;const s=x.createBufferSource();s.buffer=b;s.loop=true;return s};
  const master=x.createGain();master.gain.value=.5;master.connect(x.destination);
  AU.eng=x.createOscillator();AU.eng.type='sawtooth';AU.eng2=x.createOscillator();AU.eng2.type='square';const lp=x.createBiquadFilter();lp.type='lowpass';lp.frequency.value=900;AU.lp=lp;
  AU.gain=x.createGain();AU.gain.gain.value=0;AU.eng.connect(lp);AU.eng2.connect(lp);lp.connect(AU.gain);AU.gain.connect(master);AU.eng.start();AU.eng2.start();
  const wn=mkNoise(),wf=x.createBiquadFilter();wf.type='lowpass';wf.frequency.value=700;AU.windG=x.createGain();AU.windG.gain.value=0;wn.connect(wf);wf.connect(AU.windG);AU.windG.connect(master);wn.start();
  const tn=mkNoise(),tf=x.createBiquadFilter();tf.type='bandpass';tf.frequency.value=1500;tf.Q.value=2.2;AU.tireG=x.createGain();AU.tireG.gain.value=0;tn.connect(tf);tf.connect(AU.tireG);AU.tireG.connect(master);tn.start();AU.ready=true}catch(e){}}
function audioUpdate(){if(!AU.ready)return;const x=AU.ctx,t=x.currentTime;if(x.state=='suspended')x.resume();
  const sp=Math.min(1,C.speed/80),gear=Math.min(5,Math.floor(C.speed/16)),gp=(C.speed-gear*16)/16,rpm=.22+(Math.min(1,gp*.9+.1)*.55)+(IN.thr||IN.auto?.12:0)+(C.boosting?.1:0);
  const f=38+rpm*150;AU.eng.frequency.setTargetAtTime(f,t,.04);AU.eng2.frequency.setTargetAtTime(f*.503,t,.04);AU.lp.frequency.setTargetAtTime(500+rpm*1400,t,.05);
  AU.gain.gain.setTargetAtTime(UI.paused?0:.07+.07*rpm+(C.boosting?.05:0),t,.05);AU.windG.gain.setTargetAtTime(UI.paused?0:sp*sp*.22,t,.1);AU.tireG.gain.setTargetAtTime(UI.paused?0:(C.grounded&&C.drift>.3?.12*C.drift:0)+(C.hit>3?.05:0),t,.05)}
