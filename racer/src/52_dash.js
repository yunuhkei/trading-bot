'use strict';
/* ===== the DASHBOARD look (batch 19): the HUD, the pause console and the garage door, drawn on the HUD canvas =====
   The HUD is a car's instrument cluster: an analog speedometer (bottom left; its needle springs and settles, the scale fits the car's top speed, the face glows amber on nitro),
   two small gauges for health and nitro, a hazard-light button for pause (top right), the minimap in a chrome bezel, ribbed pedals for gas and brake that tilt down when pressed,
   a round metal DRIFT button, and nitro under a red flip-up guard.
   PAUSE opens a centre console that rises from the bottom: an amber trip-computer screen, a big round DRIVE button (resume), rocker switches with green lights (FPS, assist),
   two clicky knobs (graphics, sky) and push keys (garage, map, reset car). Everything that used to sit along the top right lives here now.
   GARAGE: cars are changed inside a garage. Park on the pad of a garage you own and ENTER GARAGE; the screen fades and you are inside (the car menu). The pause console's GARAGE key
   takes you in when you are on the pad, otherwise it sets the route to the nearest garage you own. */
const DASH={amber:'#ffad1f',ink:'#e9e6dc',red:'#ff4b2b',lab:UIF,lcd:LCDF,
  ndl:0,ndlV:0,last:0,cov:0,maxMph:180,press:{},pz:null,pT0:0,fade:0,fadeFn:null,fadeDir:0};
const dFont=(px,w)=>(w||700)+' '+Math.round(px)+'px '+DASH.lab,dLcd=px=>Math.round(px)+'px '+DASH.lcd;
/* the time since the last HUD frame (the HUD draws at 30-60 Hz) */
function dashDt(){const n=performance.now(),d=DASH.last?Math.min(.1,(n-DASH.last)/1000):1/60;DASH.last=n;return d}
/* ---------- the layout (called from uiLayout: adds the buttons) ---------- */
function dashLayout(add,w,h,u,m){
  const s=u*.92;add('pause','',w-m-s,m,s,s,v=>{if(v)pauseOpen()},'#ff3b2b',{haz:1});
  const gw=u*.86,gh=u*1.72,bw=u*1.22,bh=u*1.24,gx=w-m-gw,gy=h-m-gh,bx=gx-u*.24-bw,by=h-m-bh;
  add('gas','GAS',gx,gy,gw,gh,v=>{},'#e9e6dc',{pedal:1});
  add('brake','BRAKE',bx,by,bw,bh,v=>{IN.brk=v},'#e9e6dc',{pedal:1});
  const dr=u*.47;add('drift','DRIFT',bx+bw/2-dr,by-u*.3-dr*2,dr*2,dr*2,v=>{IN.hand=v},'#e9e6dc',{circle:dr+8,cx:bx+bw/2,cy:by-u*.3-dr});
  const nh=u*1.0;add('nitro','NOS',gx,gy-u*.24-nh,gw,nh,v=>{if(v)nitroTap()},'#ff3b2b',{guard:1});
  const R=u*1.2;UI.sp={cx:m+R+u*.06,cy:h-m-R,R};
  const ggw=u*1.18,ggh=u*.74;UI.gg={x:UI.sp.cx+R+u*.26,y1:h-m-ggh*2-u*.14,y2:h-m-ggh,w:ggw,h:ggh}}
/* ---------- small drawing helpers ---------- */
function dKey(c,x,y,w,h,r,down,top,bot){c.save();const d=down?h*.04:0;c.fillStyle='rgba(0,0,0,.55)';rr(c,x,y+h*.06,w,h,r);c.fill();
  const g=c.createLinearGradient(0,y+d,0,y+d+h);g.addColorStop(0,top||'#3a3c41');g.addColorStop(1,bot||'#202226');c.fillStyle=g;rr(c,x,y+d,w,h,r);c.fill();
  c.strokeStyle='rgba(255,255,255,.08)';c.lineWidth=1;rr(c,x+.5,y+d+.5,w-1,h-1,r);c.stroke();c.restore();return d}
function dLcdBox(c,x,y,w,h,r){c.save();c.fillStyle='#0b0b0a';rr(c,x,y,w,h,r);c.fill();c.strokeStyle='rgba(255,173,31,.18)';c.lineWidth=1;rr(c,x+.5,y+.5,w-1,h-1,r);c.stroke();c.restore()}
function dLcdText(c,t,x,y,px,al){c.save();c.font=dLcd(px);c.textAlign=al||'left';c.fillStyle=DASH.amber;c.shadowColor='rgba(255,173,31,.6)';c.shadowBlur=px*.5;c.fillText(t,x,y);c.restore()}
/* ---------- the speedometer ---------- */
function dashSpeedo(c,u,dt){const S=UI.sp,R=S.R,cx=S.cx,cy=S.cy,mph=C.speed*spdK();
  /* the scale fits the car: up to its top speed and a bit */
  const top=(CAR_ROSTER[CARSEL.cur]&&upgReal(CAR_ROSTER[CARSEL.cur]).top||300)/(UNITS.imp?1.609:1);DASH.maxMph=Math.max(UNITS.imp?160:260,Math.ceil((top+15)/20)*20);const MX=DASH.maxMph,maj=MX>(UNITS.imp?180:300)?(UNITS.imp?40:50):(UNITS.imp?20:25);
  /* the needle: a spring, so it overshoots a little and settles */
  const tgt=-2.094+Math.min(MX*1.04,mph)/MX*4.189;DASH.ndlV+=((tgt-DASH.ndl)*90-DASH.ndlV*13)*dt;DASH.ndl+=DASH.ndlV*dt;
  c.save();
  c.fillStyle='rgba(0,0,0,.45)';c.beginPath();c.arc(cx,cy+R*.06,R*1.06,0,TAU);c.fill();
  const bz=c.createLinearGradient(cx-R,cy-R,cx+R,cy+R);bz.addColorStop(0,'#9da1a7');bz.addColorStop(.5,'#4a4d52');bz.addColorStop(1,'#8d9196');c.fillStyle=bz;c.beginPath();c.arc(cx,cy,R*1.04,0,TAU);c.fill();
  const fc=c.createRadialGradient(cx,cy-R*.25,R*.1,cx,cy,R);fc.addColorStop(0,'#26272a');fc.addColorStop(1,'#101112');c.fillStyle=fc;c.beginPath();c.arc(cx,cy,R*.97,0,TAU);c.fill();
  if(C.boosting){c.strokeStyle='rgba(255,173,31,.55)';c.lineWidth=R*.05;c.shadowColor=DASH.amber;c.shadowBlur=R*.3;c.beginPath();c.arc(cx,cy,R*.9,2.62,.52+TAU);c.stroke();c.shadowBlur=0}
  for(let v=0;v<=MX;v+=UNITS.imp?5:maj/5){const a=-2.094+v/MX*4.189,mj=v%maj==0,mid=v%(UNITS.imp?10:maj/2)==0,r1=R*(mj?.74:mid?.79:.83),r2=R*.88;c.strokeStyle=v>=MX-maj*.75?DASH.red:DASH.ink;c.lineWidth=mj?R*.03:R*.013;
    c.beginPath();c.moveTo(cx+Math.sin(a)*r1,cy-Math.cos(a)*r1);c.lineTo(cx+Math.sin(a)*r2,cy-Math.cos(a)*r2);c.stroke();
    if(mj){c.fillStyle=DASH.ink;c.font=dFont(R*.125,600);c.textAlign='center';c.fillText(String(v),cx+Math.sin(a)*R*.6,cy-Math.cos(a)*R*.6+R*.045)}}
  c.fillStyle='#9b9ea4';c.font=dFont(R*.095,600);c.textAlign='center';c.fillText(spdU().toUpperCase(),cx,cy+R*.36);
  const lw=R*.56,lh=R*.2;dLcdBox(c,cx-lw/2,cy+R*.45,lw,lh,R*.03);dLcdText(c,String(Math.round(mph)),cx,cy+R*.45+lh*.78,lh*.8,'center');
  c.save();c.translate(cx,cy);c.rotate(DASH.ndl);c.fillStyle=DASH.red;c.shadowColor='rgba(0,0,0,.6)';c.shadowBlur=R*.05;c.beginPath();c.moveTo(-R*.025,R*.08);c.lineTo(0,-R*.8);c.lineTo(R*.025,R*.08);c.closePath();c.fill();c.restore();
  const hb=c.createRadialGradient(cx-R*.03,cy-R*.03,0,cx,cy,R*.1);hb.addColorStop(0,'#6a6d73');hb.addColorStop(1,'#2a2c30');c.fillStyle=hb;c.beginPath();c.arc(cx,cy,R*.09,0,TAU);c.fill();
  c.restore()}
/* a small gauge: E to F over 120 degrees */
function dashGauge(c,x,y,w,h,val,label,col,warn){c.save();c.fillStyle='rgba(0,0,0,.45)';rr(c,x,y+h*.05,w,h,h*.18);c.fill();
  const g=c.createLinearGradient(0,y,0,y+h);g.addColorStop(0,'#1b1c1e');g.addColorStop(1,'#111213');c.fillStyle=g;rr(c,x,y,w,h,h*.18);c.fill();c.strokeStyle='#33363a';c.lineWidth=Math.max(1,h*.05);rr(c,x,y,w,h,h*.18);c.stroke();
  const cx=x+w/2,cy=y+h*.7,R=h*.52;
  for(let k=0;k<=4;k++){const a=-1.047+k*.5236;c.strokeStyle=k==0?DASH.red:DASH.ink;c.lineWidth=Math.max(1,h*.035);c.beginPath();c.moveTo(cx+Math.sin(a)*R*.8,cy-Math.cos(a)*R*.8);c.lineTo(cx+Math.sin(a)*R,cy-Math.cos(a)*R);c.stroke()}
  c.font=dFont(h*.17,700);c.fillStyle='#9b9ea4';c.textAlign='left';c.fillText('E',x+w*.12,y+h*.62);c.textAlign='right';c.fillText('F',x+w*.88,y+h*.62);
  c.textAlign='center';c.fillStyle=warn&&((performance.now()/250)|0)%2?DASH.red:col;c.font=dFont(h*.16,700);c.fillText(label,cx,y+h*.93);
  const a=-1.047+clamp(val,0,1)*2.094;c.strokeStyle=col;c.lineWidth=Math.max(1.5,h*.06);c.lineCap='round';c.beginPath();c.moveTo(cx,cy);c.lineTo(cx+Math.sin(a)*R*.86,cy-Math.cos(a)*R*.86);c.stroke();
  c.fillStyle='#2f3134';c.beginPath();c.arc(cx,cy,h*.07,0,TAU);c.fill();c.restore()}
/* ---------- the controls ---------- */
function dashPedal(c,b,u){const on=!!b.on;c.save();const x=b.x,y=b.y,w=b.w,h=b.h;
  c.fillStyle='rgba(0,0,0,.5)';rr(c,x,y+h*.04,w,h,w*.16);c.fill();
  const t=on?h*.07:0,ins=on?w*.06:0;   /* pressed: the top tips away (narrower, lower) */
  c.beginPath();c.moveTo(x+ins+w*.16,y+t);c.lineTo(x+w-ins-w*.16,y+t);c.quadraticCurveTo(x+w-ins,y+t,x+w-ins*.5,y+t+w*.16);c.lineTo(x+w,y+h-w*.2);c.quadraticCurveTo(x+w,y+h,x+w-w*.2,y+h);c.lineTo(x+w*.2,y+h);c.quadraticCurveTo(x,y+h,x,y+h-w*.2);c.lineTo(x+ins*.5,y+t+w*.16);c.quadraticCurveTo(x+ins,y+t,x+ins+w*.16,y+t);c.closePath();
  const g=c.createLinearGradient(0,y,0,y+h);g.addColorStop(0,on?'#25272b':'#33353a');g.addColorStop(1,'#17181b');c.fillStyle=g;c.fill();c.save();c.clip();
  const rib=Math.max(3,u*.13);c.fillStyle='rgba(0,0,0,.55)';for(let yy=y+t+rib*.8;yy<y+h-rib*1.4;yy+=rib)c.fillRect(x+w*.12,yy,w*.76,rib*.42);c.restore();
  c.strokeStyle='rgba(255,255,255,.09)';c.lineWidth=1;c.stroke();
  c.fillStyle=on?DASH.amber:'rgba(233,230,220,.85)';c.font=dFont(u*.2,700);c.textAlign='center';c.fillText(b.label,x+w/2,y+h-u*.14);c.restore()}
function dashRound(c,b,u){const on=!!b.on,cx=b.cx,cy=b.cy+(on?b.w*.04:0),r=b.w/2;c.save();c.fillStyle='rgba(0,0,0,.55)';c.beginPath();c.arc(b.cx,b.cy+r*.1,r*1.04,0,TAU);c.fill();
  c.fillStyle='#121314';c.beginPath();c.arc(cx,cy,r*1.04,0,TAU);c.fill();const g=c.createRadialGradient(cx-r*.25,cy-r*.3,r*.1,cx,cy,r);g.addColorStop(0,on?'#45484e':'#5a5d63');g.addColorStop(1,'#202226');c.fillStyle=g;c.beginPath();c.arc(cx,cy,r*.94,0,TAU);c.fill();
  c.fillStyle=on?DASH.amber:DASH.ink;c.font=dFont(u*.18,700);c.textAlign='center';c.fillText(b.label,cx,cy+u*.065);c.restore()}
/* nitro under a red flip-up guard: the guard opens while the nitro is on */
function dashGuard(c,b,u,dt){const open=IN.nitro?1:0;DASH.cov+=(open-DASH.cov)*Math.min(1,dt*14);const x=b.x,y=b.y,w=b.w,h=b.h;c.save();
  dKey(c,x,y,w,h,w*.14,false,'#1d1e21','#121314');
  /* the toggle: a metal lever, up when on */
  const lw=w*.3,lh=h*.52,lx=x+w/2-lw/2,ly=y+h*.36;c.fillStyle='#0a0a0b';rr(c,lx-w*.06,ly+lh*.55,lw+w*.12,lh*.5,w*.05);c.fill();
  c.save();c.translate(x+w/2,ly+lh*.85);c.rotate(open?-.2:.2);const lg=c.createLinearGradient(-lw/2,0,lw/2,0);lg.addColorStop(0,'#8a8e94');lg.addColorStop(.5,'#dfe2e6');lg.addColorStop(1,'#8a8e94');c.fillStyle=lg;rr(c,-lw/2,-lh,lw,lh,lw*.3);c.fill();c.restore();
  if(IN.nitro){c.fillStyle='rgba(255,173,31,.9)';c.shadowColor=DASH.amber;c.shadowBlur=u*.25;c.beginPath();c.arc(x+w*.82,y+h*.18,w*.06,0,TAU);c.fill();c.shadowBlur=0}
  /* the guard, hinged at the top: closed it covers the lever, open it folds up into a thin strip */
  const k=Math.cos(DASH.cov*Math.PI*.62),gh=h*Math.max(.08,k);c.globalAlpha=.88;const gg=c.createLinearGradient(0,y,0,y+gh);gg.addColorStop(0,'#e8402c');gg.addColorStop(1,'#9a1d14');c.fillStyle=gg;rr(c,x+w*.04,y+h*.04,w*.92,gh*.92,w*.12);c.fill();c.globalAlpha=1;
  c.strokeStyle='rgba(255,255,255,.25)';c.lineWidth=1;rr(c,x+w*.04,y+h*.04,w*.92,gh*.92,w*.12);c.stroke();
  if(k>.5){c.fillStyle='rgba(255,255,255,.9)';c.font=dFont(u*.19,700);c.textAlign='center';c.fillText('NOS',x+w/2,y+h*.04+gh*.92-u*.12)}
  if(UI.nosFlash>C.t&&((C.t*10)|0)%2==0){c.strokeStyle=DASH.red;c.lineWidth=3;rr(c,x-3,y-3,w+6,h+6,w*.16);c.stroke()}
  c.restore()}
function dashHazard(c,b,u){const on=!!b.on;c.save();const d=dKey(c,b.x,b.y,b.w,b.h,b.w*.16,on,'#2b2c30','#151618'),cx=b.x+b.w/2,cy=b.y+b.h*.53+d,s=b.w*.3;
  c.strokeStyle='#ff3b2b';c.lineJoin='round';c.lineWidth=Math.max(2,b.w*.07);c.beginPath();c.moveTo(cx,cy-s);c.lineTo(cx+s*1.12,cy+s*.85);c.lineTo(cx-s*1.12,cy+s*.85);c.closePath();c.stroke();
  c.lineWidth=Math.max(1.5,b.w*.045);c.beginPath();c.moveTo(cx,cy-s*.35);c.lineTo(cx+s*.52,cy+s*.5);c.lineTo(cx-s*.52,cy+s*.5);c.closePath();c.stroke();
  c.fillStyle='rgba(255,255,255,.85)';c.font=dFont(u*.15,600);c.textAlign='center';c.shadowColor='rgba(0,0,0,.8)';c.shadowBlur=3;c.fillText('PAUSE',cx,b.y+b.h+u*.24);c.restore()}
function dashMapRing(c,mm){c.save();c.lineWidth=mm.r*.1;const g=c.createLinearGradient(mm.cx-mm.r,mm.cy-mm.r,mm.cx+mm.r,mm.cy+mm.r);g.addColorStop(0,'#a3a7ad');g.addColorStop(.5,'#4a4d52');g.addColorStop(1,'#8d9196');c.strokeStyle=g;c.beginPath();c.arc(mm.cx,mm.cy,mm.r+mm.r*.05,0,TAU);c.stroke();
  c.lineWidth=Math.max(1,mm.r*.04);c.strokeStyle='#18191b';c.beginPath();c.arc(mm.cx,mm.cy,mm.r+mm.r*.12,0,TAU);c.stroke();c.restore()}
/* ---------- the whole driving HUD's instruments and controls (from hudDraw) ---------- */
function dashDraw(c,W_,H_,u){const dt=dashDt();
  dashSpeedo(c,u,dt);const G=UI.gg,hp=typeof dmgHp=='function'?dmgHp():1;
  dashGauge(c,G.x,G.y1,G.w,G.h,hp,'HEALTH',hp>.25?DASH.ink:DASH.red,hp<.25);dashGauge(c,G.x,G.y2,G.w,G.h,C.nos,'NITRO',DASH.amber,UI.nosFlash>C.t);
  dashMapRing(c,UI.mm);
  if(IN.lane){const G2=UI.gg,lw=u*.78,lh=u*.32,lx=G2.x+G2.w-lw,ly=G2.y1-lh-u*.12;dLcdBox(c,lx,ly,lw,lh,u*.05);c.save();c.globalAlpha=C.laneOn?1:.35;dLcdText(c,'LANE',lx+lw/2,ly+lh*.74,lh*.62,'center');c.restore()}   /* (batch 22: bright while lane assist is steering) */
  for(const b of UI.btn){if(b.pedal)dashPedal(c,b,u);else if(b.circle&&b.id=='drift')dashRound(c,b,u);else if(b.guard)dashGuard(c,b,u,dt);else if(b.haz)dashHazard(c,b,u)}}
/* the toast (from safeHud): an amber trip-computer line */
function dashToast(c,W_,H_,u,msg,al){c.save();c.globalAlpha=al;c.font=dLcd(u*.36);const tw=c.measureText(msg).width,bw=tw+u*.7,bh=u*.62,bx=W_/2-bw/2,by=H_*.4-bh*.7;
  c.shadowColor='rgba(0,0,0,.6)';c.shadowBlur=10;dLcdBox(c,bx,by,bw,bh,u*.08);c.shadowBlur=0;dLcdText(c,msg,W_/2,by+bh*.7,u*.36,'center');c.restore()}

/* ================= the pause console ================= */
const PAUSE={btns:[],k:{gfx:0,sky:0},ka:{gfx:0,sky:0}};
const GFX_OPTS=['auto','low','high'],GFX_LBL=['AUTO','LOW','HIGH'];
function pauseOpen(){if(UI.paused||MENU.open||GAME.state)return;UI.paused=true;DASH.pT0=performance.now();UI.btn.forEach(b=>b.on=0);IN.thr=IN.brk=IN.hand=0}
function pauseClose(){UI.paused=false}
function pauseLayout(W_,H_,u){const m=u*.3,cw=Math.min(W_*.9,u*13.4),ch=Math.min(H_*.74,u*6.1),p=Math.min(1,(performance.now()-DASH.pT0)/520),e=1-Math.pow(1-p,3);
  const x=(W_-cw)/2,y=H_-m-ch+(1-e)*(ch+m*2),pad=u*.3,L={x,y,w:cw,h:ch,pad,p,b:[]};
  L.lcd={x:x+pad,y:y+pad,w:cw-pad*2,h:u*.72};const top=L.lcd.y+L.lcd.h+u*.32,bot=y+ch-pad,lw=(cw-pad*3)*.54;L.left={x:x+pad,y:top,w:lw,h:bot-top};L.right={x:x+pad*2+lw,y:top,w:cw-pad*3-lw,h:bot-top};
  const add=(id,x,y,w,h,act,ex)=>{const o=Object.assign({id,x,y,w,h,act},ex||{});L.b.push(o);return o};
  const dr=Math.min(L.left.h*.36,u*1.05);add('drive',L.left.x,L.left.y+u*.05,dr*2,dr*2,()=>pauseClose(),{round:dr});
  const rx0=L.left.x+dr*2+u*.2,rw=(L.left.x+L.left.w-rx0)/4;['fps','assist','lane','units'].forEach((id,i)=>add(id,rx0+i*rw+rw/2-u*.27,L.left.y+u*.1,u*.54,u*.86,()=>{if(id=='fps')UI.showStats=!UI.showStats;else if(id=='units')unitsSet(!UNITS.imp);else if(id=='lane')laneSet(!IN.lane);else IN.auto=!IN.auto},{rocker:1}));   /* (batch 22: 'assist' is the auto gas; LANE is lane assist) */
  const ky=L.left.y+L.left.h-u*.62,kw=(L.left.w-u*.3*2)/3;(EV.run?['quit','map','reset']:['garage','map','reset']).forEach((id,i)=>add(id,L.left.x+i*(kw+u*.3),ky,kw,u*.6,()=>pauseKey(id),{key:1}));
  const kr=Math.min(L.right.w*.2,L.right.h*.27,u*.75);[['gfx',GFX_LBL],['sky',['DAY','OVERCAST','SUNSET']]].forEach(([id,lb],i)=>{const cx=L.right.x+L.right.w*(i?.77:.23),cy=L.right.y+L.right.h*.5;
    const kb=add(id,cx-kr,cy-kr,kr*2,kr*2,()=>pauseKnob(id,(PAUSE.k[id]+1)%lb.length),{knob:kr,cx,cy,labels:lb});
    lb.forEach((t,j)=>{const a=pauseKnobAng(j,lb.length),lx=cx+Math.sin(a)*kr*1.5,ly=cy-Math.cos(a)*kr*1.5;add(id+'_'+j,lx-u*.45,ly-u*.2,u*.9,u*.4,()=>pauseKnob(id,j),{klabel:t,kid:id,kj:j})})});
  return L}
const pauseKnobAng=(j,n)=>n==3?[-.95,0,.95][j]:-1.1+j*2.2/(n-1);
function pauseKnob(id,j){PAUSE.k[id]=j;if(id=='gfx'){gfxSetMode(GFX_OPTS[j]);safeToast('GRAPHICS '+GFX_LBL[j]+(j==0?'  (NOW '+GFX.cur.name.toUpperCase()+')':''),1.8)}else{envApply(ENV_NAMES[j]);try{localStorage.setItem('racer.env',ENV_NAMES[j])}catch(e){}}}
function pauseKey(id){if(id=='quit'){pauseClose();evQuit()}else if(id=='reset'){pauseClose();IN.respawn=1}else if(id=='map'){pauseClose();mapOpenNow()}else if(id=='garage'){pauseClose();garageGo()}}
function pauseSync(){PAUSE.k.gfx=Math.max(0,GFX_OPTS.indexOf(GFX.mode));PAUSE.k.sky=Math.max(0,ENV_NAMES.indexOf(ENV.name))}
function pauseDraw(c,W_,H_,u){pauseSync();const L=pauseLayout(W_,H_,u),dt=dashDt();PAUSE.btns=L.b;c.save();
  c.fillStyle='rgba(5,5,6,'+(.55*L.p)+')';c.fillRect(0,0,W_,H_);
  c.shadowColor='rgba(0,0,0,.6)';c.shadowBlur=u*.6;const g=c.createLinearGradient(0,L.y,0,L.y+L.h);g.addColorStop(0,'#2a2b2e');g.addColorStop(1,'#18191b');c.fillStyle=g;rr(c,L.x,L.y,L.w,L.h,u*.32);c.fill();c.shadowBlur=0;
  c.strokeStyle='rgba(255,255,255,.07)';c.lineWidth=1;rr(c,L.x+.5,L.y+.5,L.w-1,L.h-1,u*.32);c.stroke();
  /* the trip computer: PAUSED types itself out */
  const Lc=L.lcd;dLcdBox(c,Lc.x,Lc.y,Lc.w,Lc.h,u*.12);const chars=Math.max(0,Math.min(6,Math.floor((performance.now()-DASH.pT0-300)/70)));
  dLcdText(c,'PAUSED'.slice(0,chars)+(chars<6&&((performance.now()/300)|0)%2?'_':''),Lc.x+u*.3,Lc.y+Lc.h*.7,u*.44);
  dLcdText(c,((regionName()||'COUNTY').toUpperCase())+'  ·  '+evMoney(ECON.money),Lc.x+Lc.w-u*.3,Lc.y+Lc.h*.68,u*.26,'right');
  const pr=id=>DASH.press[id]&&performance.now()-DASH.press[id]<160;
  for(const b of L.b){
    if(b.round){const cx=b.x+b.round,cy=b.y+b.round+(pr(b.id)?u*.04:0),r=b.round;c.fillStyle='#8d9196';c.beginPath();c.arc(cx,cy,r,0,TAU);c.fill();c.fillStyle='#2a2b2e';c.beginPath();c.arc(cx,cy,r*.93,0,TAU);c.fill();
      const rg=c.createRadialGradient(cx-r*.15,cy-r*.25,r*.1,cx,cy,r*.88);rg.addColorStop(0,'#3d3f44');rg.addColorStop(1,'#141517');c.fillStyle=rg;c.beginPath();c.arc(cx,cy,r*.88,0,TAU);c.fill();
      c.strokeStyle='rgba(255,173,31,'+(.25+.25*Math.sin(performance.now()/400))+')';c.lineWidth=r*.06;c.beginPath();c.arc(cx,cy,r*.88,0,TAU);c.stroke();
      c.textAlign='center';c.fillStyle='#9b9ea4';c.font=dFont(r*.16,600);c.fillText('PRESS TO',cx,cy-r*.08);dLcdText(c,'DRIVE',cx,cy+r*.26,r*.32,'center')}
    else if(b.rocker){const on=b.id=='fps'?UI.showStats:b.id=='units'?UNITS.imp:b.id=='lane'?IN.lane:IN.auto;c.fillStyle='#0d0e0f';rr(c,b.x,b.y,b.w,b.h,u*.1);c.fill();
      const ix=b.x+b.w*.12,iy=b.y+b.h*.08,iw=b.w*.76,ih=b.h*.84,hi=on?iy+ih*.5:iy,lo=on?iy:iy+ih*.5;c.fillStyle='#2a2c30';rr(c,ix,iy,iw,ih,u*.07);c.fill();c.fillStyle='#3d3f44';rr(c,ix,lo,iw,ih*.5,u*.07);c.fill();
      c.fillStyle=on?'#5dff7a':'#24342a';if(on){c.shadowColor='#5dff7a';c.shadowBlur=u*.25}c.beginPath();c.arc(b.x+b.w/2,b.y+b.h*.24,u*.06,0,TAU);c.fill();c.shadowBlur=0;
      c.fillStyle='#b5b2a8';c.font=dFont(u*.17,600);c.textAlign='center';c.fillText(b.id=='fps'?'FPS':b.id=='units'?(UNITS.imp?'MPH':'KM/H'):b.id=='lane'?'LANE':'AUTO',b.x+b.w/2,b.y+b.h+u*.24)}
    else if(b.key){const d=dKey(c,b.x,b.y,b.w,b.h,u*.1,pr(b.id));c.fillStyle=b.id=='reset'||b.id=='quit'?'#ff8a70':DASH.ink;c.font=dFont(u*.19,700);c.textAlign='center';c.fillText(b.id=='reset'?'RESET CAR':b.id=='quit'?'QUIT EVENT':b.id.toUpperCase(),b.x+b.w/2,b.y+b.h*.64+d)}
    else if(b.knob){const r=b.knob,j=PAUSE.k[b.id],tg=pauseKnobAng(j,b.labels.length);PAUSE.ka[b.id]+=(tg-PAUSE.ka[b.id])*Math.min(1,dt*16);
      c.fillStyle='rgba(0,0,0,.5)';c.beginPath();c.arc(b.cx,b.cy+r*.08,r*1.04,0,TAU);c.fill();c.fillStyle='#0e0f10';c.beginPath();c.arc(b.cx,b.cy,r*1.02,0,TAU);c.fill();
      c.save();c.translate(b.cx,b.cy);c.rotate(PAUSE.ka[b.id]);for(let k=0;k<30;k++){c.fillStyle=k%2?'#2a2c30':'#3b3d41';c.beginPath();c.moveTo(0,0);c.arc(0,0,r*.95,k*TAU/30,(k+1)*TAU/30);c.closePath();c.fill()}
      c.fillStyle='#2e3034';c.beginPath();c.arc(0,0,r*.7,0,TAU);c.fill();c.fillStyle=DASH.amber;c.shadowColor=DASH.amber;c.shadowBlur=u*.2;rr(c,-r*.06,-r*.9,r*.12,r*.42,r*.06);c.fill();c.restore();
      c.fillStyle='#b5b2a8';c.font=dFont(u*.17,600);c.textAlign='center';c.fillText(b.id=='gfx'?'GRAPHICS':'SKY',b.cx,b.cy+r*2.05)}
    else if(b.klabel){const on=PAUSE.k[b.kid]==b.kj;c.font=dFont(u*.145,700);c.textAlign='center';c.fillStyle=on?DASH.amber:'#7e7b72';if(on){c.shadowColor='rgba(255,173,31,.6)';c.shadowBlur=u*.12}c.fillText(b.klabel,b.x+b.w/2,b.y+b.h*.68);c.shadowBlur=0}}
  c.restore()}
function pauseTap(x,y){if(!PAUSE.btns.length)return false;let best=null;for(const b of PAUSE.btns){const hit=b.round?Math.hypot(x-b.x-b.round,y-b.y-b.round)<=b.round+6:b.knob?Math.hypot(x-b.cx,y-b.cy)<=b.knob+6:(x>=b.x-6&&x<=b.x+b.w+6&&y>=b.y-6&&y<=b.y+b.h+6);if(hit){best=b;if(!b.klabel)break}}
  if(best){DASH.press[best.id]=performance.now();best.act();return true}return false}

/* ================= the garage door ================= */
/* fade to black, do it, fade back */
function dashFade(fn){if(DASH.fadeFn)return;DASH.fadeFn=fn;DASH.fadeDir=1}
function dashFadeDraw(c,W_,H_){const n=performance.now(),dt=DASH.fT?Math.min(.1,(n-DASH.fT)/1000):1/60;DASH.fT=n;if(DASH.fadeDir==1){DASH.fade=Math.min(1,DASH.fade+dt*3.2);if(DASH.fade>=1){const f=DASH.fadeFn;DASH.fadeDir=-1;if(f)f()}}else if(DASH.fadeDir==-1){DASH.fade=Math.max(0,DASH.fade-dt*2.6);if(DASH.fade<=0){DASH.fadeDir=0;DASH.fadeFn=null}}
  if(DASH.fade>0){c.save();c.fillStyle='rgba(0,0,0,'+DASH.fade+')';c.fillRect(0,0,W_,H_);c.restore()}}
/* is the car parked on the pad of a garage it owns? */
const garageHere=()=>SAFE.at&&SAFE.owned[SAFE.at.id]&&C.speed<3&&!GAME.state;
function garageEnter(){if(!garageHere()){garageGo();return}const s=SAFE.at;EV.card=null;dashFade(()=>{garageInto();menuOpen();envApply('garage');MENU.garage=s.name})}
function garageLeave(){dashFade(()=>{const s=DASH.gFrom&&DASH.gFrom.s;menuCloseNow();garageOut();camStep(0,true);EV.dismiss=s||SAFE.at})}
/* not at a garage: the route to the nearest one you own */
function garageGo(){if(garageHere()){garageEnter();return}const s=safeNear(C.x,C.z,true);if(!s)return;navSet(s.pad.x,s.pad.z);safeToast('ROUTE SET  ·  '+s.name.toUpperCase(),2.6)}

/* ================= the garage interior (a real room the car is driven into) =================
   A workshop built far out over the western sea, where nothing else is (22 x 20 m, 5.2 m high): grey concrete floor with an epoxy bay and yellow lines, painted walls with a dark
   band, a roller door, light strips, a workbench with a pegboard, red tool chests, stacks of tyres, oil drums, shelves and an amber sign. Entering the garage moves the car (and the
   camera, which circles it) inside; leaving puts it back on the pad it came from. The world stands still meanwhile (MENU.open). */
const GROOM={x:-4650,z:-600,y:8,hx:11,hz:10,h:5.2};
function pceil(cx,cz,hx,hz,y,r,g,b){const m=pmb(cx,cz,1,4),k=[[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz]].map(c=>m.v(cx+c[0],y,cz+c[1],0,-1,0,r,g,b,.03,.03,0));m.q(k[0],k[1],k[2],k[3])}
function buildGarageRoom(){const G=GROOM,x=G.x,z=G.z,y=G.y,hx=G.hx,hz=G.hz,h=G.h,t=.18;
  pflat(1,x,z,hx+.4,hz+.4,1,0,y,92,94,98);pflat(1,x,z,4.2,6.2,1,0,y+.01,58,62,68);
  for(const[a,b,w,d]of[[0,-6.2,4.2,.07],[0,6.2,4.2,.07],[-4.2,0,.07,6.2],[4.2,0,.07,6.2]])pflat(1,x+a,z+b,w,d,1,0,y+.02,226,186,40);
  /* walls: painted, with a dark band below; the front wall has the roller door */
  const wall=(cx,cz,whx,whz)=>{pbox(1,cx,y-.2,cz,whx,y+h,whz,206,208,212,false,.85);};
  wall(x,z-hz-t,hx+t,t);wall(x-hx-t,z,t,hz+t);wall(x+hx+t,z,t,hz+t);
  const dw=3.6;wall(x-(hx+dw)/2-t/2,z+hz+t,(hx-dw)/2+t/2,t);wall(x+(hx+dw)/2+t/2,z+hz+t,(hx-dw)/2+t/2,t);pbox(1,x,y+3.9,z+hz+t,dw,y+h,t,206,208,212,false,.85);
  for(let k=0;k<13;k++){const yy=y+k*.3;pbox(1,x,yy,z+hz+t*.6,dw,yy+.27,.06,k%2?150:166,k%2?154:170,k%2?160:176,false,.9)}
  pbox(1,x,y-.1,z-hz+.03,hx,y+1.1,.04,62,66,74,false,.9);pbox(1,x-hx+.03,y-.1,z,.04,y+1.1,hz,62,66,74,false,.9);pbox(1,x+hx-.03,y-.1,z,.04,y+1.1,hz,62,66,74,false,.9);
  pceil(x,z,hx+.4,hz+.4,y+h,120,122,128);
  /* light strips */
  for(const a of[-5,0,5]){pbox(1,x+a,y+h-.16,z,.22,y+h-.02,hz*.72,255,255,248,false,1);for(const b of[-5,0,5])NEONS.push(x+a,y+h-.25,z+b,1,.98,.9,3.2)}
  /* back wall: workbench, pegboard, tool chests, the sign */
  pbox(1,x-5.5,y,z-hz+.75,2.4,y+.92,.55,124,92,62,false,.8);pbox(1,x-5.5,y+.92,z-hz+.75,2.5,y+.98,.6,150,112,76,false,.9);
  pbox(1,x-5.5,y+1.25,z-hz+.08,2.4,y+2.7,.04,168,146,112,false,.9);for(let k=0;k<6;k++)pbox(1,x-7.3+k*.75,y+1.7+(k%2)*.4,z-hz+.16,.12,y+2.0+(k%2)*.4,.05,70,72,78,false,.9);
  for(const a of[0,2.2]){pbox(1,x+a,y,z-hz+.55,.95,y+1.05,.42,192,32,30,false,.85);pbox(1,x+a,y+1.05,z-hz+.5,.95,y+1.55,.36,206,40,36,false,.85);for(let k=0;k<4;k++)pbox(1,x+a,y+.2+k*.22,z-hz+.98,.85,y+.23+k*.22,.01,30,30,32,false,1)}
  pbox(1,x+6.5,y+3.2,z-hz+.08,2.6,y+3.75,.05,255,173,31,false,1);NEONS.push(x+6.5,y+3.5,z-hz+.3,1,.68,.12,4.5);
  /* tyres and drums in the corners, shelves on the right */
  for(const[a,b]of[[-9.6,-8.4],[-8.7,-8.6],[9.4,7.6],[-9.6,7.8]])for(let k=0;k<4;k++)pfrus(1,x+a,y+k*.26,z+b,.36,.36,.25,28,28,30,12);
  for(const[a,b]of[[9.5,-8.8],[8.8,-8.9]])pfrus(1,x+a,y,z+b,.3,.3,.92,30,70,150,12);
  for(let k=0;k<3;k++){pbox(1,x+hx-.5,y+.6+k*1.1,z+1,.42,y+.66+k*1.1,2.4,90,94,100,false,.9);for(let q=0;q<4;q++)pbox(1,x+hx-.5,y+.66+k*1.1,z-.6+q*1.05,.3,y+1.05+k*1.1,.35,[176,140,96][q%3],[150,120,84][q%3],[110,90,66][q%3],false,.9)}
  for(const b of[-1.3,3.3])pbox(1,x+hx-.5,y,z+b,.05,y+3.4,.05,70,72,78,false,.9)}
/* into the room and back out */
function garageInto(){const s=SAFE.at;DASH.gFrom={x:C.x,z:C.z,y:C.y,yaw:C.yaw,s};const G=GROOM;
  C.x=C.px=G.x;C.z=C.pz=G.z+1;C.y=C.py=C.gs=C.gsp=C.gf=G.y;C.vx=C.vz=C.vy=0;C.speed=0;C.yaw=C.pyaw=2.4;C.pitch=C.roll=C.ppitch=C.proll=0;C.grounded=1}
function garageOut(){const f=DASH.gFrom;if(!f)return;DASH.gFrom=null;const yaw=f.s?f.s.yaw:f.yaw;C.x=C.px=f.x;C.z=C.pz=f.z;C.yaw=C.pyaw=C.camYaw=yaw;C.y=C.py=C.gs=C.gsp=C.gf=groundAt(f.x,f.z,f.y+1);C.vx=C.vz=C.vy=0;C.speed=0;C.pitch=C.roll=C.ppitch=C.proll=0;C.grounded=1}
