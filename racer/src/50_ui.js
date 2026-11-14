'use strict';
/* ===== controls (touch + keyboard), HUD, minimap, audio, adaptive quality ===== */
const UI={w:1,h:1,dpr:1,hud:null,ctx:null,touches:new Map(),stick:null,btn:[],showStats:false,fps:60,ms:16,mapCv:null,paused:false,keys:{},msg:'',msgT:0,tilt:0,lastTap:0,locName:'',locT:0};
function uiInit(){
  UI.hud=$('hud');UI.ctx=UI.hud.getContext('2d');
  const cv=$('gl');
  /* touch: the left half steers like a thumb-stick that appears where you touch; buttons on the right */
  const tp=(e)=>{e.preventDefault();const r=cv.getBoundingClientRect();for(const t of e.changedTouches){t.cx=t.clientX-r.left;t.cy=t.clientY-r.top}};
  const down=(id,x,y)=>{
    if(CC.on){crashSkip();UI.touches.set(id,{type:'none'});return}   /* (batch 25: the crash movie takes the taps: skip after 1.5 s) */
    if(UI.paused){pauseTap(x,y);UI.touches.set(id,{type:'none'});return}
    if(UI.mapOpen){mapDown(id,x,y);UI.touches.set(id,{type:'map'});return}
    if(MENU.open){if(!menuTap(x,y))UI.touches.set(id,{type:'gcam',lx:x,ly:y});else UI.touches.set(id,{type:'none'});return}   /* (batch 21: a drag off the buttons turns the garage camera) */
    if(evTap(x,y)){UI.touches.set(id,{type:'none'});return}
    for(const b of UI.btn){const hit=b.circle?Math.hypot(x-b.cx,y-b.cy)<=b.circle:(x>=b.x-8&&x<=b.x+b.w+8&&y>=b.y-8&&y<=b.y+b.h+8);if(hit){UI.touches.set(id,{type:'btn',b});b.on=1;b.act&&b.act(1);return}}
    if(WHL.on&&UI.wh&&x<UI.w*.62){const dx=x-UI.wh.cx,dy=y-UI.wh.cy;if(Math.hypot(dx,dy)<=UI.wh.R*1.5){const t={type:'wheel',la:Math.atan2(dy,dx)};UI.touches.set(id,t);WHL.grab=t;return}UI.touches.set(id,{type:'look',lx:x,ly:y});return}   /* (batch 48: with the wheel on, a touch on it grabs it; elsewhere on the left only looks around) */
    if(x<UI.w*.55){const t={type:'stick',x0:x,y0:y,x:x,y:y,lx:x,ly:y};UI.touches.set(id,t);UI.stickT=t;return}
    UI.touches.set(id,{type:'look',lx:x,ly:y})};   /* a drag on the free part of the right side looks around (when the car is stopped) */
  const move=(id,x,y)=>{const t=UI.touches.get(id);if(t&&t.type=='wheel'){const a=Math.atan2(y-UI.wh.cy,x-UI.wh.cx);let d=a-t.la;if(d>Math.PI)d-=TAU;else if(d<-Math.PI)d+=TAU;t.la=a;WHL.rot=clamp(WHL.rot+d,-WHL.MAX,WHL.MAX);return}if(t&&t.type=='gcam'){MENU.userCam=1;MENU.camA-=(x-t.lx)*.009;MENU.camP=clamp((MENU.camP||0)+(y-t.ly)*.005,-.05,.75);t.lx=x;t.ly=y;return}if(t&&(t.type=='stick'||t.type=='look')){UI.lookDX=(UI.lookDX||0)+x-t.lx;UI.lookDY=(UI.lookDY||0)+y-t.ly;t.lx=x;t.ly=y}if(t&&t.type=='stick'){t.x=x;t.y=y}else if(t&&t.type=='map')mapMove(id,x,y)};
  const up=(id)=>{const t=UI.touches.get(id);if(t&&t.type=='map')mapUp(id);if(t&&t.type=='btn'){t.b.on=0;t.b.act&&t.b.act(0)}if(t&&t===UI.stickT)UI.stickT=null;if(t&&t===WHL.grab)WHL.grab=null;UI.touches.delete(id)};
  const opt={passive:false};
  cv.addEventListener('wheel',e=>{if(UI.mapOpen){e.preventDefault();mapWheel(e.offsetX,e.offsetY,e.deltaY)}else if(MENU.open){e.preventDefault();MENU.userCam=1;MENU.camD=clamp((MENU.camD||8.4)*(e.deltaY>0?1.08:1/1.08),4.5,9)}},opt);
  cv.addEventListener('touchstart',e=>{tp(e);for(const t of e.changedTouches)down(t.identifier,t.cx,t.cy);audioStart()},opt);
  cv.addEventListener('touchmove',e=>{tp(e);for(const t of e.changedTouches)move(t.identifier,t.cx,t.cy)},opt);
  cv.addEventListener('touchend',e=>{tp(e);for(const t of e.changedTouches)up(t.identifier)},opt);cv.addEventListener('touchcancel',e=>{tp(e);for(const t of e.changedTouches)up(t.identifier)},opt);
  /* mouse (desktop testing): same as one finger */
  let md=false;cv.addEventListener('mousedown',e=>{md=true;down('m',e.offsetX,e.offsetY);audioStart()});window.addEventListener('mousemove',e=>{if(md){const r=cv.getBoundingClientRect();move('m',e.clientX-r.left,e.clientY-r.top)}});window.addEventListener('mouseup',()=>{if(md){md=false;up('m')}});
  const K=UI.keys;window.addEventListener('keydown',e=>{K[e.code]=1;if(CC.on&&!e.repeat)crashSkip();if((e.code=='ShiftLeft'||e.code=='ShiftRight'||e.code=='KeyN')&&!e.repeat)nitroTap();if(e.code=='KeyR')IN.respawn=1;if(e.code=='KeyF'){UI.showStats=!UI.showStats}if((e.code=='KeyP'||e.code=='Escape')&&!MENU.open){if(UI.paused)pauseClose();else pauseOpen()}if(e.code=='KeyG')IN.auto=!IN.auto;if(e.code=='KeyM'){if(UI.mapOpen)UI.mapOpen=false;else mapOpenNow()}if(MENU.open){menuKey(e.code);e.preventDefault()}else if(e.code=='KeyC')garageEnter();audioStart();if(/Arrow|Space/.test(e.code))e.preventDefault()});
  window.addEventListener('keyup',e=>{K[e.code]=0});
  window.addEventListener('blur',()=>{for(const k in K)K[k]=0;UI.touches.clear();UI.stickT=null;WHL.grab=null;UI.btn.forEach(b=>b.on=0)});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)UI.paused=true});
  uiLayout()}
/* tap = boost on (needs some nitro in the tank), tap again = off */
function nitroTap(){if(IN.nitro)IN.nitro=0;else if(C.nos>.1)IN.nitro=1;else UI.nosFlash=C.t+.6}
function uiLayout(){
  const b=UI.btn;b.length=0;const w=UI.w,h=UI.h,u=Math.min(w,h*1.5)/10,m=u*.35;
  const add=(id,label,x,y,rw,rh,act,col,extra)=>{const o={id,label,x,y,w:rw,h:rh,act,on:0,col};if(extra)Object.assign(o,extra);b.push(o);return o};
  /* the minimap lives top-left; tapping it opens the world map */
  const mr=Math.min(w,h)*.105;UI.mm={cx:m+mr,cy:m+mr,r:mr};
  add('map','MAP',UI.mm.cx-mr,UI.mm.cy-mr,mr*2,mr*2,v=>{if(v)mapOpenNow()},'#ffffff',{circle:mr+10,cx:UI.mm.cx,cy:UI.mm.cy});
  /* batch 19: the dashboard (52_dash.js): hazard-light pause, pedals, drift, nitro under its guard; everything else is in the pause console */
  dashLayout(add,w,h,u,m);
  UI.bn={};b.forEach(x=>UI.bn[x.id]=x);
  UI.btnU=u}
function uiResize(){
  const cv=$('gl'),dpr=Math.min(window.devicePixelRatio||1,2),cw=window.innerWidth,ch=window.innerHeight;UI.w=cw;UI.h=ch;UI.dpr=dpr;
  UI.hud.width=Math.round(cw*Math.min(dpr,2));UI.hud.height=Math.round(ch*Math.min(dpr,2));
  Q.apply();uiLayout()}
/* quality: the render scale and the tiers are decided in 31_gfx.js from measured frame cost; this keeps the screen-size bookkeeping and the smoothed frame time for the FPS readout */
const Q={scale:.8,min:.45,max:1,acc:0,n:0,cool:0,aa:false,
  apply(){const cv=$('gl'),dpr=Math.min(window.devicePixelRatio||1,2),w=Math.max(2,Math.round(UI.w*dpr*Q.scale)),h=Math.max(2,Math.round(UI.h*dpr*Q.scale));if(cv.width!=w||cv.height!=h){cv.width=w;cv.height=h}UI.cw=w;UI.ch=h},
  frame(ms){UI.ms+=(ms-UI.ms)*.08}};
/* read inputs into IN each frame */
function uiInputs(dt){
  const K=UI.keys;let st=0;
  if(K.ArrowLeft||K.KeyA)st-=1;if(K.ArrowRight||K.KeyD)st+=1;
  let gas=K.ArrowUp||K.KeyW?1:0,brk=K.ArrowDown||K.KeyS?1:0;
  let tstick=UI.stickT;
  if(tstick){const R2=Math.max(46,UI.w*.075);st+=clamp((tstick.x-tstick.x0)/R2,-1,1)}
  if(WHL.on){if(!WHL.grab)WHL.rot*=Math.exp(-dt*6);if(Math.abs(WHL.rot)<.002)WHL.rot=0;st+=WHL.rot/WHL.MAX}   /* (batch 48) the wheel: its turn is the steering, and it springs back to centre */
  /* steering response: eases in so small thumb movements are gentle */
  const target=clamp(st,-1,1),sh=Math.sign(target)*Math.pow(Math.abs(target),1.25);
  C.steer+=(sh-C.steer)*Math.min(1,dt*(Math.abs(sh)>Math.abs(C.steer)?20:26));
  if(K.Space)IN.hand=1;else if(!UI.bn.drift.on)IN.hand=0;
    if(brk)IN.brk=1;else if(!UI.bn.brake.on)IN.brk=0;
  IN.thr=(gas||UI.bn.gas.on)?1:0;
  /* LOOK AROUND (batch 5): with the car stopped, a drag (the steering thumb or anywhere free on the right) turns the camera round the car and up and down; it stays where you leave it and
     swings back behind the car once you drive off */
  const parked=C.speed<2.5&&!IN.thr,dx=UI.lookDX||0,dy=UI.lookDY||0;UI.lookDX=UI.lookDY=0;C.orbY=C.orbY||0;C.orbP=C.orbP||0;
  if(parked&&!MENU.open&&!UI.mapOpen){C.orbY+=dx*.009;C.orbP=clamp(C.orbP+dy*.005,-.3,1.05);if(K.KeyQ)C.orbY-=dt*1.6;if(K.KeyE)C.orbY+=dt*1.6}
  else if(C.speed>4||IN.thr){const k=Math.exp(-dt*2.2);C.orbY=angd(C.orbY,0)*k;C.orbP*=k}
}
/* ---------- minimap ---------- */
function mapInit(){
  const S=1600,cv=UI.mapCv=document.createElement('canvas');cv.width=cv.height=S;const x=cv.getContext('2d');const id=x.createImageData(S,S),c=W.col,CN=W.CN;
  for(let j=0;j<S;j++)for(let i=0;i<S;i++){const ci=Math.floor(i*CN/S),cj=Math.floor(j*CN/S),o=(cj*CN+ci)*4,k=(j*S+i)*4,wx=-W.half+(i+.5)*W.size/S,wz=-W.half+(j+.5)*W.size/S,h=terrainH(wx,wz);
    if(h<0){id.data[k]=26;id.data[k+1]=62;id.data[k+2]=96}else{id.data[k]=c[o]*.62+10;id.data[k+1]=c[o+1]*.62+12;id.data[k+2]=c[o+2]*.62+14}id.data[k+3]=255}
  x.putImageData(id,0,0);const sc=S/W.size;x.lineCap='round';x.lineJoin='round';
  const stroke=(r,w,col)=>{x.beginPath();for(let i=0;i<r.n;i++){const px=(r.X[i]+W.half)*sc,pz=(r.Z[i]+W.half)*sc;i?x.lineTo(px,pz):x.moveTo(px,pz)}if(r.closed)x.closePath();x.lineWidth=w;x.strokeStyle=col;x.stroke()};
  const K2=12*S/W.size;for(const r of ROADS){const big=r.style==1||r.id=='mp'||r.id=='cr';stroke(r,K2*(r.city?1.1:(big?2.6:2)),'rgba(0,0,0,.55)')}
  for(const r of ROADS){const big=r.style==1;stroke(r,K2*(r.city?.55:(big?1.5:1.1)),r.city?'#c9ced6':(big?'#ffd36a':'#ffffff'))}
  UI.mapSc=sc}
/* safe houses (green = yours, grey = locked) and cops, drawn on top of the baked map */
function mapOverlay(ctx,pxm,s){
  evMapIcons(ctx,v=>(v+W.half)*pxm,v=>(v+W.half)*pxm,5/s);spotMapIcons(ctx,v=>(v+W.half)*pxm,v=>(v+W.half)*pxm,5/s);racerMapIcons(ctx,v=>(v+W.half)*pxm,v=>(v+W.half)*pxm,5/s);for(const p of REPAIRS){const px=(p.x+W.half)*pxm,pz=(p.z+W.half)*pxm,r=6;ctx.fillStyle='#2a6be0';ctx.beginPath();ctx.arc(px,pz,r,0,TAU);ctx.fill();ctx.fillStyle='#fff';ctx.fillRect(px-r*.62,pz-r*.18,r*1.24,r*.36);ctx.fillRect(px-r*.18,pz-r*.62,r*.36,r*1.24)}   /* repair shops: a white cross on blue */
  const rs=6.8;ctx.lineWidth=1.7;for(const h of SAFEHOUSES){const px=(h.x+W.half)*pxm,pz=(h.z+W.half)*pxm,own=SAFE.owned[h.id];ctx.beginPath();ctx.arc(px,pz,rs,0,TAU);ctx.fillStyle=own?'#3cf08c':'#8d97a3';ctx.fill();ctx.strokeStyle=own?'#05301a':'#222a33';ctx.stroke()}
  if(TR.on){const r=4.2/s,f=((C.t*4)|0)%2;for(const c of TR.cars){if(!c.alive||c.kind!==1||(c.cm==0&&!c.siren))continue;ctx.fillStyle=f?'#ff4a3a':'#4a7aff';ctx.fillRect((c.x+W.half)*pxm-r,(c.z+W.half)*pxm-r,r*2,r*2)}}
  navMapOverlay(ctx,pxm,s)}
function drawMap(ctx,cx,cy,rad,zoomM,rot){
  /* zoomM = metres across the circle's radius */
  const S=UI.mapCv.width,pxm=S/W.size,s=rad/zoomM/pxm;ctx.save();ctx.beginPath();ctx.arc(cx,cy,rad,0,TAU);ctx.clip();ctx.fillStyle='#10202e';ctx.fillRect(cx-rad,cy-rad,rad*2,rad*2);
  ctx.translate(cx,cy);ctx.rotate(rot);ctx.scale(s,s);ctx.translate(-(C.x+W.half)*pxm,-(C.z+W.half)*pxm);ctx.imageSmoothingEnabled=true;ctx.drawImage(UI.mapCv,0,0);
  mapOverlay(ctx,pxm,s);
  /* only the police on the minimap (batch 3: the other traffic is left off): a patrol a blue dot, a chaser flashing red and blue, a helicopter a bigger ring */
  if(TR.on){const r=3.2/s,fl=((R.time*6)|0)&1;for(const c of TR.cars){if(!c.alive||c.kind!==1||c.state==1)continue;ctx.fillStyle=c.cm>0?(fl?'#ff3a3a':'#3a7aff'):'#5a8aff';ctx.fillRect((c.x+W.half)*pxm-r,(c.z+W.half)*pxm-r,r*2,r*2)}
    for(const h of HELI.list){ctx.strokeStyle=fl?'#ff3a3a':'#3a7aff';ctx.lineWidth=2/s;ctx.beginPath();ctx.arc((h.x+W.half)*pxm,(h.z+W.half)*pxm,6/s,0,TAU);ctx.stroke()}}
  ctx.restore();
  ctx.save();ctx.translate(cx,cy);ctx.fillStyle='#ff7a1a';ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-rad*.14);ctx.lineTo(rad*.09,rad*.1);ctx.lineTo(0,rad*.05);ctx.lineTo(-rad*.09,rad*.1);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  ctx.beginPath();ctx.arc(cx,cy,rad,0,TAU);ctx.lineWidth=3;ctx.strokeStyle='rgba(255,255,255,.85)';ctx.stroke()}
const REGIONS=[['Las Vegas',()=>inBox(C.x,C.z,CITY_VEG,40)],['Sacramento',()=>inBox(C.x,C.z,CITY_SAC,40)],['San Jose',()=>inBox(C.x,C.z,CITY_SJ,40)],['Pacifica',()=>inBox(C.x,C.z,TOWN_PAC,40)],['Fresno',()=>inBox(C.x,C.z,TOWN_FRE,40)],['Barstow',()=>inBox(C.x,C.z,TOWN_BAR,40)],['Big Pines',()=>inBox(C.x,C.z,TOWN_BIG,40)],['Harbor Industrial',()=>inBox(C.x,C.z,IND_HAR,40)],['Mojave Works',()=>inBox(C.x,C.z,IND_MOJ,40)],
  ['The Canyon',()=>C.x>2800&&C.z<420&&C.z>-2900&&canyonDist(C.x,C.z)<120],['Northern Range',()=>C.z<-3500],['Farmland',()=>inBox(C.x,C.z,{x0:-2000,z0:-2700,x1:-600,z1:-1600},0)],['Mojave Desert',()=>C.x>2800&&C.z>420],
  ['Jump hills',()=>JUMPZ.some(j=>Math.hypot(C.x-j[0],C.z-j[1])<j[2])],['Golden Gate Park',()=>inBox(C.x,C.z,PARK,10)],['Russian Hill',()=>Math.hypot(C.x+1100,C.z+70)<200],['Twin Peaks',()=>Math.hypot(C.x+620,C.z-760)<260],['Downtown',()=>inBox(C.x,C.z,CITY,20)],['The Valley',()=>inBox(C.x,C.z,VALLEY,20)],['Santa Cruz Pier',()=>inBox(C.x,C.z,{x0:BEACH.x0,z0:BEACH.z1,x1:BEACH.x1,z1:BEACH.z1+260},0)],['Santa Cruz',()=>inBox(C.x,C.z,BEACH,30)],['Palm Springs',()=>inBox(C.x,C.z,RESORT,30)],['Mulholland ridge',()=>C.x>450&&C.x<1650&&C.z>-420&&C.z<20&&terrainH(C.x,C.z)>40],['Mountain pass',()=>terrainH(C.x,C.z)>130&&C.x>600&&C.z<-700],['Pacific coast',()=>C.x<-1700],['North shore',()=>C.z<-2000],['Southern plains',()=>C.z>1700],['Highlands',()=>C.x>1300&&C.z<-300],['Orbital ring',()=>Math.hypot(C.x*.9,C.z-100)>1100],['Suburbs',()=>true]];
function regionName(){for(const r of REGIONS)if(r[1]())return r[0];return''}
/* ---------- HUD ---------- */
function hudDraw(){
  const c=UI.ctx,w=UI.hud.width,h=UI.hud.height,k=w/UI.w;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,w,h);c.scale(k,k);const W_=UI.w,H_=UI.h,u=UI.btnU;
  if(MENU.open){menuDraw(c,W_,H_,u);safeHud(c,W_,H_,u);dashFadeDraw(c,W_,H_);return}
  if(CC.on){crashHud(c,W_,H_,u);return}   /* (batch 17: the crash cinematic shows only its bars) */
  c.textBaseline='alphabetic';c.font='700 12px '+UIF;
  /* drift points and air time: small, they stay a while after the move is over, then float up and fade out */
  if(GFX.note){const k=performance.now()-GFX.note.t;if(k<3600){c.save();c.globalAlpha=k<3000?1:1-(k-3000)/600;c.textAlign='center';c.font='700 '+Math.round(u*.2)+'px '+UIF;c.fillStyle='#ffffff';c.shadowColor='rgba(0,0,0,.85)';c.shadowBlur=4;c.fillText(GFX.note.txt,W_*.5,H_*.08);c.restore()}}
  {const font='800 '+Math.round(u*.3)+'px '+UIF;
   const toast=(txt,col,y,age,hold)=>{   /* age: seconds since it appeared (or since it ended, for the hold) */
     let al=1,rise=0,sc=1;if(age<0){const k=Math.min(1,-age/.16);al=k;sc=.8+.2*k;rise=(1-k)*7}
     else if(age>hold){const k=(age-hold)/.6;if(k>=1)return;const e=1-(1-k)*(1-k);al=1-k;rise=e*22;sc=1-.15*k}
     c.save();c.globalAlpha=al;c.translate(W_*.5,y-rise);c.scale(sc,sc);c.textAlign='center';c.font=font;c.fillStyle=col;c.shadowColor='rgba(0,0,0,.7)';c.shadowBlur=4;c.fillText(txt,0,0);c.restore()};
   /* drift: counting up while sliding, then held and floated away */
   if(C.dActive&&C.dTime>.3)toast('DRIFT  '+Math.round(C.dCombo)+(C.tapN>0&&C.tapT>0?'   x'+(C.tapN+1):''),'#7fd4ff',H_*.31,-Math.min(.16,C.t-C.dStart-.3)-.0001,1);
   else if(C.dLast){const age=C.t-C.dLast.t;if(age<2.4)toast('DRIFT  '+C.dLast.pts,'#7fd4ff',H_*.31,age,1.8)}
   /* air: counting while flying, then the jump, held and floated away */
   if(!C.grounded&&C.air>.3)toast('AIR  '+C.air.toFixed(1)+' s','#ffd24a',H_*.31+u*.5,-Math.min(.16,C.air-.3)-.0001,1);
   else if(C.jump){const age=C.t-C.jump.t;if(age<2.8)toast('JUMP  '+fmtShort(C.jump.d)+'  ·  '+C.jump.air.toFixed(1)+' s','#ffd24a',H_*.31+u*.5,age,2.2)}}
  /* minimap */
  const mm=UI.mm;drawMap(c,mm.cx,mm.cy,mm.r,420,-C.yaw);c.save();c.textAlign='center';c.font='800 '+Math.round(u*.22)+'px '+UIF;c.fillStyle='rgba(255,255,255,.85)';c.shadowColor='rgba(0,0,0,.8)';c.shadowBlur=4;c.fillText('MAP',mm.cx,mm.cy+mm.r+u*.3);c.restore();
  /* location banner */
  if(C.t-UI.locT>1.5){const n=regionName();if(n!==UI.locName){UI.locName=n;UI.locT=C.t}}
  if(UI.locName&&C.t-UI.locT<3.5&&!UI.paused&&!EV.run){const a=Math.min(1,(3.5-(C.t-UI.locT)),(C.t-UI.locT)*3);c.save();c.globalAlpha=a;c.textAlign='center';c.font='800 '+Math.round(u*.55)+'px '+UIF;c.fillStyle='#fff';c.shadowColor='rgba(0,0,0,.7)';c.shadowBlur=6;c.fillText(UI.locName.toUpperCase(),W_*.5,H_*.2);c.restore()}
  /* the instruments and the controls (52_dash.js) */
  dashDraw(c,W_,H_,u);
  /* the thumb-stick ring where the left thumb is */
  {const t=UI.stickT;if(t){c.globalAlpha=.5;c.strokeStyle='#fff';c.lineWidth=3;c.beginPath();c.arc(t.x0,t.y0,Math.max(46,UI.w*.075),0,TAU);c.stroke();c.fillStyle='#fff';c.beginPath();c.arc(clamp(t.x,t.x0-Math.max(46,UI.w*.075),t.x0+Math.max(46,UI.w*.075)),t.y0,18,0,TAU);c.fill();c.globalAlpha=1}}
  /* stats */
  if(UI.showStats){const sx0=mm.cx+mm.r+10,sy0=u*.35;c.textAlign='left';c.font='600 11px '+LCDF;c.fillStyle='rgba(0,0,0,.6)';c.fillRect(sx0,sy0,230,92);c.fillStyle='#9dffb0';const l=[Math.round(1000/UI.ms)+' fps  '+UI.ms.toFixed(1)+' ms',R.draws+' draws  '+Math.round(R.tris/1000)+'k tris  cars '+TR.nAlive+(TR.ms?'  ai '+TR.ms.toFixed(2)+' ms':''),(UI.cw||0)+'x'+(UI.ch||0)+'  scale '+Q.scale.toFixed(2),'gfx '+GFX.cur.name+' ('+GFX.mode+')  work '+GFX.work.toFixed(1)+' ms  fxaa'+(GFX.cur.blur?' blur':'')+(GFX.cur.bloom?' bloom':'')+(GFX.shadowOn?' shadow'+GFX.cur.shadow:''),'x '+C.x.toFixed(0)+' z '+C.z.toFixed(0)+' y '+C.y.toFixed(1),'road '+(C.onRoad?'yes':'no')+'  air '+(C.grounded?'no':'yes')];l.forEach((t,i)=>c.fillText(t,sx0+6,sy0+14+i*14))}
  if(PHYS.classic&&!window.__shot){c.save();c.textAlign='center';c.font='700 '+Math.round(u*.2)+'px '+UIF;c.fillStyle='rgba(255,164,58,.9)';c.fillText('CLASSIC HANDLING',W_*.5,H_-u*.12);c.restore()}   /* the old handling is on (?hnd=classic or the switch in the car menu) */
  copHud(c,W_,H_,u);safeHud(c,W_,H_,u);navHud(c,W_,H_,u);evHud(c,W_,H_,u);boostHud(c,W_,H_,u);crashHud(c,W_,H_,u);
  if(UI.paused&&!window.__shot)pauseDraw(c,W_,H_,u);
  if(C.flash>.02){c.fillStyle='rgba(255,255,255,'+C.flash*.5+')';c.fillRect(0,0,W_,H_)}
  if(UI.mapOpen)drawWorldMap(c,W_,H_,u);
  dashFadeDraw(c,W_,H_)
}
const MAPLBL=[['DOWNTOWN',-860,330,1],['RUSSIAN HILL',-1090,-190,1],['TWIN PEAKS',-640,940,1],['GOLDEN GATE PARK',-1440,400,1,'r'],['THE VALLEY',640,880,1],['SANTA CRUZ',-325,2650,1],['PALM SPRINGS',1620,1660,1],['MULHOLLAND',1000,-330,1],['ORBITAL RING',-150,-1120,1],['MOUNTAIN PASS',1850,-1800,1],['NORTH COUNTRY',-350,-2610,1],['PACIFICA',-1640,1330,1],['FRESNO',-1500,-2330,1],['BARSTOW',3680,1190,1],['BIG PINES',-190,-3330,1],['HARBOR',1200,2520,1],['MOJAVE WORKS',3375,2090,1],['THE CANYON',3750,-1100,1],['NORTHERN RANGE',600,-4200,1],['MOJAVE DESERT',3900,1900,1],['FARMLAND',-1000,-1750,1],['PACIFIC COAST',-1850,1720,1],['SOUTHERN PLAINS',1200,2290,1],['EAST LINK',2200,1450,1],['OCEAN',-2640,-500,0]];
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath()}
/* ---------- audio: synthesised engine, wind, tyres ---------- */
const AU={ctx:null,eng:null,eng2:null,gain:null,wind:null,tire:null,ready:false};
function audioStart(){if(AU.ctx||window.__noAudio)return;try{const A=window.AudioContext||window.webkitAudioContext;if(!A)return;const x=AU.ctx=new A();
  const mkNoise=()=>{const b=x.createBuffer(1,x.sampleRate*2,x.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;const s=x.createBufferSource();s.buffer=b;s.loop=true;return s};
  const master=x.createGain();master.gain.value=.5;master.connect(x.destination);
  AU.eng=x.createOscillator();AU.eng.type='sawtooth';AU.eng2=x.createOscillator();AU.eng2.type='square';const lp=x.createBiquadFilter();lp.type='lowpass';lp.frequency.value=900;AU.lp=lp;
  AU.gain=x.createGain();AU.gain.gain.value=0;AU.eng.connect(lp);AU.eng2.connect(lp);lp.connect(AU.gain);AU.gain.connect(master);AU.eng.start();AU.eng2.start();
  const wn=mkNoise(),wf=x.createBiquadFilter();wf.type='lowpass';wf.frequency.value=700;AU.windG=x.createGain();AU.windG.gain.value=0;wn.connect(wf);wf.connect(AU.windG);AU.windG.connect(master);wn.start();
  const tn=mkNoise(),tf=x.createBiquadFilter();tf.type='bandpass';tf.frequency.value=1500;tf.Q.value=2.2;AU.tireG=x.createGain();AU.tireG.gain.value=0;tn.connect(tf);tf.connect(AU.tireG);AU.tireG.connect(master);tn.start();
  /* the scrape of metal on a guard rail: high, harsh noise */
  {const sn=mkNoise(),sf=x.createBiquadFilter();sf.type='bandpass';sf.frequency.value=3200;sf.Q.value=1.4;AU.scrF=sf;AU.scrG=x.createGain();AU.scrG.gain.value=0;sn.connect(sf);sf.connect(AU.scrG);AU.scrG.connect(master);sn.start()}
  /* the helicopter: low noise chopped by a 14 Hz wave (the rotor) */
  {const hn=mkNoise(),hf=x.createBiquadFilter();hf.type='lowpass';hf.frequency.value=260;const hg=x.createGain();hg.gain.value=0;const lfo=x.createOscillator();lfo.type='square';lfo.frequency.value=14;const lg=x.createGain();lg.gain.value=.5;lfo.connect(lg);lg.connect(hg.gain);hn.connect(hf);hf.connect(hg);AU.heliG=x.createGain();AU.heliG.gain.value=0;hg.connect(AU.heliG);AU.heliG.connect(master);hn.start();lfo.start();hg.gain.value=.5}
  AU.master=master;AU.mkNoise=mkNoise;
  AU.sir=x.createOscillator();AU.sir.type='triangle';AU.sir.frequency.value=800;AU.sirG=x.createGain();AU.sirG.gain.value=0;AU.sir.connect(AU.sirG);AU.sirG.connect(master);AU.sir.start();AU.ready=true}catch(e){}}
/* a bang (a tyre bursting): a short burst of noise */
function audioBang(){if(!AU.ready)return;const x=AU.ctx,t=x.currentTime,n=AU.mkNoise(),g=x.createGain();g.gain.setValueAtTime(.9,t);g.gain.exponentialRampToValueAtTime(.001,t+.35);n.connect(g);g.connect(AU.master);n.start(t);n.stop(t+.4)}
function audioUpdate(){if(!AU.ready)return;const x=AU.ctx,t=x.currentTime;if(x.state=='suspended')x.resume();
  const sp=Math.min(1,C.speed/80),gear=Math.min(5,Math.floor(C.speed/16)),gp=(C.speed-gear*16)/16,rpm=.22+(Math.min(1,gp*.9+.1)*.55)+(IN.thr||IN.auto?.12:0)+(C.boosting?.1:0)+(C.grounded?0:.16);
  const f=38+rpm*150;AU.eng.frequency.setTargetAtTime(f,t,.04);AU.eng2.frequency.setTargetAtTime(f*.503,t,.04);AU.lp.frequency.setTargetAtTime(500+rpm*1400,t,.05);
  AU.gain.gain.setTargetAtTime((UI.paused||UI.mapOpen)?0:.07+.07*rpm+(C.boosting?.05:0),t,.05);AU.windG.gain.setTargetAtTime((UI.paused||UI.mapOpen)?0:sp*sp*.22,t,.1);AU.tireG.gain.setTargetAtTime((UI.paused||UI.mapOpen)?0:(C.grounded&&(C.drift>.3||C.dActive)?.12*Math.max(C.drift,Math.min(1,C.slip*3)):0)+(C.hit>3?.05:0),t,.05);
  if(AU.heliG)AU.heliG.gain.setTargetAtTime((UI.paused||UI.mapOpen)?0:Math.max(0,1-HELI.near/350)*.9,t,.2);
  if(AU.scrG){const on=C.railT>0&&!UI.paused&&!UI.mapOpen;AU.scrG.gain.setTargetAtTime(on?.1+.14*Math.min(1,C.speed/45):0,t,on?.015:.06);AU.scrF.frequency.setTargetAtTime(2400+C.speed*30+Math.random()*600,t,.03)}
  /* the siren: a two-tone wail, louder the nearer the nearest chasing cop */
  if(AU.sir){const ph=Math.sin(t*5.2)>0;AU.sir.frequency.setTargetAtTime(ph?960:720,t,.04);AU.sirG.gain.setTargetAtTime((UI.paused||UI.mapOpen)?0:COP.sirenVol*.07,t,.1)}}
