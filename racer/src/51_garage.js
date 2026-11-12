'use strict';
/* ===== the car menu: a showroom (the world stands still, the camera circles the car), the 30 cars, what each is like, and which are yours ===== */
/* HOW CARS ARE EARNED IS NOT DECIDED (like the money system): CAROWN says which cars you own, carUnlock(id) is the hook the game will call, ECON.carPrice(id) is null (not set), and the menu says so
   plainly. "UNLOCK ALL (testing)" in the menu lets you try every car now. Only the first car is owned. */
/* the paints of the car menu: the car's own, then colours that each come with a finish (fin: 0 solid, 1 metallic, 2 pearl with a second colour p2, 3 matte) */
const _PT=(c,fin,p2)=>Object.assign(c,{fin:fin|0,p2:p2||null});
const CAR_PAINTS=[null,_PT([240,240,236],0),_PT([14,14,18],1),_PT([168,172,180],1),_PT([24,52,150],1),_PT([250,196,8],0),_PT([240,104,16],2,[255,40,90]),_PT([22,96,58],1),_PT([196,22,32],0),_PT([236,238,244],2,[130,180,255]),_PT([64,66,70],3)];
/* FOR NOW EVERY CAR IS UNLOCKED (CAR_ALL_DEFAULT): the game starts with all 30 open. The earning system will switch this off and call carUnlock(id) as cars are earned. */
const CAR_ALL_DEFAULT=false;   /* batch 10: cars are bought with money; the switch in the menu still opens them all, for testing */
const CAROWN={owned:{k1:true},all:CAR_ALL_DEFAULT,color:{},key:'racer.cars'};
const MENU={open:0,i:0,t:0,btns:[],pi:0};
function carLoad(){try{const j=JSON.parse(localStorage.getItem(CAROWN.key)||'null');if(j){if(j.owned)Object.assign(CAROWN.owned,j.owned);CAROWN.all=('allv2' in j)?!!j.allv2:CAR_ALL_DEFAULT;if(j.color)Object.assign(CAROWN.color,j.color);if(j.curId&&CAR_ROSTER.some(d=>d.id===j.curId))CARSEL.cur=carIndex(j.curId)}}catch(e){}CAROWN.owned.k1=true}
function carSave(){try{localStorage.setItem(CAROWN.key,JSON.stringify({owned:CAROWN.owned,all:CAROWN.all,color:CAROWN.color,allv2:CAROWN.all,curId:(CAR_ROSTER[CARSEL.cur]||{}).id}))}catch(e){}}
const carOwned=i=>CAROWN.all||!!CAROWN.owned[CAR_ROSTER[i].id];
/* the hook for the earning system: call this when a car has been earned or bought */
function carUnlock(id){if(CAR_ROSTER.some(d=>d.id==id)){CAROWN.owned[id]=true;carSave();if(ECON.onCarUnlock)ECON.onCarUnlock(id);return true}return false}
const carPaintOf=i=>{const k=CAROWN.color[CAR_ROSTER[i].id]|0;return k>0?CAR_PAINTS[k]:null};
/* the figures a car is described by, as 0..1 bars */
function carStats(d){const r=d.real;return[['TOP SPEED',_cl((r.top-240)/200,.05,1),Math.round(r.top)+' km/h'],['ACCEL',_cl((4.9-r.t100)/2.8,.05,1),r.t100.toFixed(1)+' s to 100'],['GRIP',_cl((r.lat-.9)/.65,.05,1),r.lat.toFixed(2)+' g'],['BRAKES',_cl((41-r.brk)/18,.05,1),r.brk+' m from 100'],['LIGHTNESS',_cl((2000-r.kg)/1500,.05,1),r.kg+' kg']]}
const DRV={RR:'rear-engine RWD',MR:'mid-engine RWD',FR:'front-engine RWD',AWD:'AWD',RWD:'RWD'};
function menuOpen(){if(MENU.open)return;MENU.open=1;MENU.prevEnv=ENV.name;envApply('studio');MENU.i=CARSEL.cur;MENU.t=0;MENU.pi=CARSEL.cur;UI.stickT=null;IN.thr=IN.brk=IN.hand=IN.nitro=0}
function menuPreview(i){MENU.i=_cl(i,0,CAR_ROSTER.length-1);if(MENU.i!=CARM.idx){carInstall(CAR_ROSTER[MENU.i],carPaintOf(MENU.i));CARM.idx=MENU.i}}
function menuClose(){if(!MENU.open)return;MENU.open=0;if(MENU.prevEnv)envApply(MENU.prevEnv);if(CARM.idx!=CARSEL.cur){carInstall(CAR_ROSTER[CARSEL.cur],carPaintOf(CARSEL.cur));CARM.idx=CARSEL.cur}}
function menuChoose(){const i=MENU.i;if(!carOwned(i)){const id=CAR_ROSTER[i].id,p=ECON.carPrice(id);if(ECON.buyCar(id))safeToast('BOUGHT  -'+evMoney(p),2.6);else{safeToast('NEED '+evMoney(p)+'  (you have '+evMoney(ECON.money)+')',2.6);return}}carSelect(i);CARM.idx=i;carInstall(CAR_ROSTER[i],carPaintOf(i));carSave();safeToast(CAR_ROSTER[i].name+' selected',2);menuClose()}
function menuPaint(k){const id=CAR_ROSTER[MENU.i].id;CAROWN.color[id]=k;carInstall(CAR_ROSTER[MENU.i],carPaintOf(MENU.i));CARM.idx=MENU.i;carSave()}
function menuUnlockAll(){CAROWN.all=!CAROWN.all;carSave()}
/* the camera: round the car, a little above */
function menuCam(dt){MENU.t+=dt;const a=MENU.t*.42+.7,d=8.4,x=C.x+Math.sin(a)*d,z=C.z+Math.cos(a)*d;CAM.x=x;CAM.z=z;CAM.y=C.y+1.25;CAM.tx=C.x+Math.cos(a)*2.5;CAM.tz=C.z-Math.sin(a)*2.5;CAM.ty=C.y+.5;CAM.fov=.62}
/* layout and drawing share one function: it returns the buttons. Everything is placed top to bottom in units of u (the button size), so it fits a 375 px high phone. */
function menuLayout(W_,H_,u){
  const b=[],m=u*.3,pw=Math.min(W_*.47,u*8.4),px=W_-pw-m,py=m,ph=H_-m*2,add=(id,x,y,w,h,act)=>b.push({id,x,y,w,h,act});
  add('prev',m,H_*.5-u*.45,u*.9,u*.9,()=>menuPreview(MENU.i-1));add('next',W_-pw-m*2-u*.9,H_*.5-u*.45,u*.9,u*.9,()=>menuPreview(MENU.i+1));
  const x0=px+m,iw=pw-m*2;let y=py+u*1.2;const L={px,py,pw,ph,m,x0,iw};
  L.stats=y;y+=u*.3*5+u*.34;L.dotsLabel=y;y+=u*.1;const gs=u*.3,gap=(iw-15*gs)/14;L.gy=y;for(let k=0;k<CAR_ROSTER.length;k++)add('dot'+k,x0+(k%15)*(gs+gap),y+((k/15)|0)*(gs+u*.06),gs,gs,()=>menuPreview(k));L.gs=gs;y+=Math.ceil(CAR_ROSTER.length/15)*(gs+u*.06)+u*.2;
  L.paintLabel=y;y+=u*.08;L.sy=y;for(let k=0;k<CAR_PAINTS.length;k++)add('paint'+k,x0+k*(u*.385),y,u*.34,u*.34,()=>menuPaint(k));y+=u*.5;
  {const hw2=(iw-m)/2;add('all',x0,y,hw2,u*.34,()=>menuUnlockAll());add('hnd',x0+hw2+m,y,hw2,u*.34,()=>{physSetClassic(!PHYS.classic);safeToast('Handling: '+(PHYS.classic?'CLASSIC (the old one)':'NEW'),2.5)})}y+=u*.42;L.by=y;const bw=(iw-m)/2;add('select',x0,y,bw,u*.5,()=>menuChoose());add('close',x0+bw+m,y,bw,u*.5,()=>menuClose());
  L.b=b;return L}
function menuDraw(c,W_,H_,u){
  const L=menuLayout(W_,H_,u),d=CAR_ROSTER[MENU.i],own=carOwned(MENU.i),cur=MENU.i==CARSEL.cur;MENU.btns=L.b;
  c.save();c.fillStyle='rgba(8,10,16,.86)';rr(c,L.px,L.py,L.pw,L.ph,u*.2);c.fill();c.textAlign='left';
  const x0=L.x0,fs=(f,w)=>(w||700)+' '+Math.round(u*f)+'px -apple-system,Roboto,sans-serif';
  c.fillStyle='#fff';c.font=fs(.5,800);{const wmax=L.iw-u*1.5,wn=c.measureText(d.name).width;if(wn>wmax)c.font=fs(.5*wmax/wn,800)}c.fillText(d.name,x0,L.py+u*.62);   /* a long name shrinks so it never runs into the OWNED label */c.fillStyle='rgba(255,255,255,.65)';c.font=fs(.21);c.fillText(d.cls,x0,L.py+u*.9);c.fillText((MENU.i+1)+' / '+CAR_ROSTER.length+'   ·   '+Math.round(d.real.hp)+' hp  ·  '+DRV[d.real.drive],x0,L.py+u*1.16);
  c.textAlign='right';c.fillStyle=own?(cur?'#7dffb0':'#9cc8ff'):'#ff9a4a';c.font=fs(.26,800);c.fillText(own?(cur?'YOUR CAR':'OWNED'):evMoney(ECON.carPrice(d.id)),L.px+L.pw-L.m,L.py+u*.62);c.textAlign='left';
  /* the figures */
  const st=carStats(d),bx=x0+L.iw*.3,bw=L.iw*.3,tx=x0+L.iw*.64;let y=L.stats+u*.14;
  for(const[n,v,t]of st){c.fillStyle='rgba(255,255,255,.7)';c.font=fs(.19);c.fillText(n,x0,y);c.fillStyle='rgba(255,255,255,.12)';rr(c,bx,y-u*.16,bw,u*.15,u*.05);c.fill();c.fillStyle='#ffa43a';rr(c,bx,y-u*.16,Math.max(u*.1,bw*v),u*.15,u*.05);c.fill();c.fillStyle='rgba(255,255,255,.85)';c.font=fs(.18);c.fillText(t,tx,y);y+=u*.3}
  c.fillStyle='rgba(255,255,255,.5)';c.font=fs(.18);c.fillText('CARS  (green = yours)',x0,L.dotsLabel);
  for(let k=0;k<CAR_ROSTER.length;k++){const bt=L.b.find(q=>q.id=='dot'+k),o=carOwned(k);c.fillStyle=k==MENU.i?'#fff':o?'#4be07a':'rgba(255,255,255,.25)';c.beginPath();c.arc(bt.x+bt.w/2,bt.y+bt.h/2,k==MENU.i?bt.w*.55:bt.w*.38,0,TAU);c.fill()}
  c.fillStyle='rgba(255,255,255,.5)';c.font=fs(.18);{const kk=CAROWN.color[d.id]|0,fn=CAR_FIN_NAME[kk>0?(CAR_PAINTS[kk].fin|0):(d.fin|0)]||'SOLID';c.fillText('PAINT  \u00b7  '+fn,x0,L.paintLabel)}
  for(let k=0;k<CAR_PAINTS.length;k++){const bt=L.b.find(q=>q.id=='paint'+k),pc=CAR_PAINTS[k]||d.paint,sel=(CAROWN.color[d.id]|0)==k;c.fillStyle='rgb('+pc[0]+','+pc[1]+','+pc[2]+')';c.beginPath();c.arc(bt.x+bt.w/2,bt.y+bt.h/2,bt.w/2,0,TAU);c.fill();c.strokeStyle=sel?'#fff':'rgba(255,255,255,.35)';c.lineWidth=sel?2.5:1;c.stroke()}
  const sb=L.b.find(q=>q.id=='all');c.fillStyle=CAROWN.all?'#4be07a':'rgba(255,255,255,.18)';rr(c,sb.x,sb.y,sb.w,sb.h,u*.1);c.fill();c.fillStyle=CAROWN.all?'#102016':'rgba(255,255,255,.85)';c.font=fs(.19,700);c.textAlign='center';c.fillText(CAROWN.all?'ALL CARS UNLOCKED':'UNLOCK ALL CARS',sb.x+sb.w/2,sb.y+sb.h*.68);
  {const hb=L.b.find(q=>q.id=='hnd');c.fillStyle=PHYS.classic?'#ffa43a':'rgba(255,255,255,.18)';rr(c,hb.x,hb.y,hb.w,hb.h,u*.1);c.fill();c.fillStyle=PHYS.classic?'#201408':'rgba(255,255,255,.85)';c.fillText('HANDLING: '+(PHYS.classic?'CLASSIC':'NEW'),hb.x+hb.w/2,hb.y+hb.h*.68)}
  for(const id of['select','close']){const bt=L.b.find(q=>q.id==id),sel=id=='select';c.fillStyle=sel&&(own||ECON.money>=ECON.carPrice(d.id))?'#ff7a1a':'rgba(255,255,255,.18)';rr(c,bt.x,bt.y,bt.w,bt.h,u*.14);c.fill();c.fillStyle=sel&&(own||ECON.money>=ECON.carPrice(d.id))?'#111':'#fff';c.font=fs(.26,800);c.fillText(sel?(own?(cur?'DRIVE IT':'DRIVE THIS'):(ECON.money>=ECON.carPrice(d.id)?'BUY':'LOCKED')):'BACK',bt.x+bt.w/2,bt.y+bt.h*.66)}
  if(!own){c.fillStyle='#ff9a4a';c.font=fs(.18);c.fillText('You have '+evMoney(ECON.money)+'  -  win events to earn more',L.px+L.pw/2,L.by+u*.66)}
  /* the arrows next to the car */
  c.textAlign='center';for(const id of['prev','next']){const bt=L.b.find(q=>q.id==id);c.fillStyle='rgba(8,10,16,.55)';c.beginPath();c.arc(bt.x+bt.w/2,bt.y+bt.h/2,bt.w/2,0,TAU);c.fill();c.fillStyle='#fff';c.font=fs(.55,800);c.fillText(id=='prev'?'‹':'›',bt.x+bt.w/2,bt.y+bt.h*.72)}
  c.restore()}
function menuTap(x,y){for(let k=MENU.btns.length-1;k>=0;k--){const b=MENU.btns[k];if(x>=b.x-4&&x<=b.x+b.w+4&&y>=b.y-4&&y<=b.y+b.h+4){b.act();return true}}return false}
function menuKey(code){if(code=='Escape'||code=='KeyC')menuClose();else if(code=='ArrowLeft')menuPreview(MENU.i-1);else if(code=='ArrowRight')menuPreview(MENU.i+1);else if(code=='Enter'||code=='Space')menuChoose()}
