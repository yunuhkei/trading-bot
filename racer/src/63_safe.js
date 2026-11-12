'use strict';
/* ===== safe houses, the economy hooks (a stub), and what happens when you are wrecked or busted ===== */
/* THE MONEY SYSTEM IS NOT DECIDED. Nothing here invents a price or a payout: ECON is a set of hooks that do nothing yet, SAFE.price is null (unknown) for every house but the free first one, and
   repairs cost nothing. Once there are numbers, fill in SAFE.price[id], ECON.money, ECON.buy and ECON.repairCost; the game already calls them at the right moments. */
const ECON={money:0,
  price(id){const p=SAFE.price[id];return p==null?null:p},       /* null = not decided yet */
  canBuy(id){return false},                                       /* no economy yet: a locked garage cannot be bought */
  buy(id){return false},                                          /* hook: pay, then call safeUnlock(id) */
  repairCost(dmgTotal){return 0},                                 /* repairs are free for now */
  carPrice(id){return null},onCarUnlock(id){},                  /* cars: what a car costs / is earned by is not decided either */
  onBusted(){},onWrecked(){},onRepair(cost){},onUnlock(id){}};    /* hooks called by the game */
const SAFE={owned:{},price:{},pads:[],t:0,svc:0,at:null,msg:'',msgT:0,last:'home',visit:null,key:'racer.save'};
/* the pad in front of each garage door: centre, half sizes, and the heading that leaves the garage towards the road */
function safeInit(){
  SAFE.pads.length=0;
  for(const s of SAFEHOUSES){const sd=s.side||-1,nx=-s.sn,nz=s.cs,dx=-sd*nx,dz=-sd*nz,hl=4.6,hw=4.4,cx=s.x+dx*(6.7+hl),cz=s.z+dz*(6.7+hl);
    /* pad axes: along the door direction (dd) and along the wall (t) */
    s.dd=[dx,dz];s.t=[s.cs,s.sn];s.pad={x:cx,z:cz,hl,hw};s.yaw=Math.atan2(dx,-dz);
    s.y=terrainH(cx,cz);for(const[a,b]of[[1,1],[1,-1],[-1,1],[-1,-1]])s.y=Math.max(s.y,terrainH(cx+dx*hl*a+s.cs*hw*b,cz+dz*hl*a+s.sn*hw*b));s.y+=.08;
    SAFE.pads.push(s);if(!(s.id in SAFE.owned))SAFE.owned[s.id]=s.id=='home';if(!(s.id in SAFE.price))SAFE.price[s.id]=s.id=='home'?0:null}
  safeLoad()}
function safeLoad(){try{const j=JSON.parse(localStorage.getItem(SAFE.key)||'null');if(j&&j.owned)for(const k in j.owned)if(k in SAFE.owned)SAFE.owned[k]=!!j.owned[k];if(j&&j.last)SAFE.last=j.last}catch(e){}SAFE.owned.home=true}
function safeSave(){try{localStorage.setItem(SAFE.key,JSON.stringify({owned:SAFE.owned,last:SAFE.last}))}catch(e){}}
/* the hook for the money system: call this once a house has been paid for */
function safeUnlock(id){if(id in SAFE.owned){SAFE.owned[id]=true;safeSave();ECON.onUnlock(id);return true}return false}
function safeNear(x,z,ownedOnly){let b=null,bd=1e18;for(const s of SAFE.pads){if(ownedOnly&&!SAFE.owned[s.id])continue;const d=(s.x-x)**2+(s.z-z)**2;if(d<bd){bd=d;b=s}}return b}
function safeToast(t,sec){SAFE.msg=t;SAFE.msgT=sec||2.6}
/* is the car on the pad, and slow enough? */
function safeOnPad(s){const dx=C.x-s.pad.x,dz=C.z-s.pad.z,a=dx*s.dd[0]+dz*s.dd[1],b=dx*s.t[0]+dz*s.t[1];return Math.abs(a)<s.pad.hl-.4&&Math.abs(b)<s.pad.hw-.4&&Math.abs(C.y-s.y)<2.5}
/* called every fixed step: servicing while parked on a pad */
/* drive-through repair (batch 7): inside the bay of a repair shop the car is fixed at once (body, dents, parts, lamps, tyres), at any speed; once per pass */
function repairStep(dt){if(GAME.state||TUM.on)return;for(const p of REPAIRS){const dx=C.x-p.x,dz=C.z-p.z;if(dx*dx+dz*dz>400){if(SAFE.rpIn===p)SAFE.rpIn=null;continue}
    const a=dx*p.cs+dz*p.sn,b=-dx*p.sn+dz*p.cs,inside=Math.abs(a)<p.L/2-.8&&Math.abs(b)<p.W/2-.2;if(!inside){if(SAFE.rpIn===p&&Math.abs(a)>p.L/2+2)SAFE.rpIn=null;continue}
    if(SAFE.rpIn===p)continue;SAFE.rpIn=p;const hurt=DMG.total>0||DMG.z.some(v=>v>0)||C.flatT>0;dmgReset();C.flatT=0;SAFE.rpT=1.2;SAFE.repairs=(SAFE.repairs||0)+1;
    safeToast(hurt?'REPAIRED':'ALL GOOD',2);if(hurt&&typeof sparkAt==='function')for(let k=0;k<3;k++)sparkAt(C.x,C.y+1,C.z,0,0,8,3)}}
function safeStep(dt){
  SAFE.t+=dt;if(SAFE.msgT>0)SAFE.msgT-=dt;repairStep(dt);if(SAFE.rpT>0)SAFE.rpT-=dt;
  let on=null;const s0=safeNear(C.x,C.z,false);if(s0&&(s0.x-C.x)**2+(s0.z-C.z)**2<30*30&&safeOnPad(s0))on=s0;
  if(!on||GAME.state){if(SAFE.svc>0)SAFE.svc=Math.max(0,SAFE.svc-dt*2);if(!on)SAFE.visit=null;SAFE.at=on;return}
  SAFE.at=on;
  if(C.speed<9&&C.grounded){
    if(C.speed>1.2){const k=Math.max(0,1-dt*1.4);C.vx*=k;C.vz*=k}                       /* the pad slows you down */
    SAFE.svc+=dt;
    if(SAFE.svc>=1.5&&SAFE.visit!==on.id){SAFE.visit=on.id;SAFE.svc=0;
      if(SAFE.owned[on.id]){const dmg=DMG.total>0||DMG.z.some(v=>v>0),cost=ECON.repairCost(DMG.total);dmgReset();SAFE.last=on.id;safeSave();if(dmg)ECON.onRepair(cost);copClear(true);
        C.safeX=C.x;C.safeZ=C.z;C.safeY=C.y;C.safeYaw=C.yaw;safeToast(dmg?'REPAIRED & SAVED':'SAVED',2.6)}
      else{const p=ECON.price(on.id);safeToast('GARAGE LOCKED'+(p==null?'  (price not set yet)':'  ('+p+')'),3)}}}
  else SAFE.svc=Math.max(0,SAFE.svc-dt)}
/* ---------------- wrecked / busted ---------------- */
const GAME={state:0,t:0,msg:'',why:'',lock:0};      /* state 0 playing, 1 wrecked, 2 busted */
function gameEnd(state,msg){if(GAME.state)return;GAME.state=state;GAME.t=0;GAME.msg=msg;GAME.lock=1;if(state==1)ECON.onWrecked();else ECON.onBusted()}
function gameWrecked(){gameEnd(1,'WRECKED')}
function gameBusted(){gameEnd(2,'BUSTED')}
function gameStep(dt){
  if(!GAME.state){if(DMG.wrecked)gameWrecked();return}
  GAME.t+=dt;
  if(GAME.t>3.4){gameRespawn()}}
/* back to the nearest garage you own: repaired, no heat, no cops */
function gameRespawn(){
  const s=safeNear(C.x,C.z,true)||SAFE.pads[0];
  if(s){const x=s.pad.x,z=s.pad.z;carPlace(x,z,s.yaw,s.y+.4);C.camYaw=s.yaw;C.vx=C.vz=0;camStep(0,true)}
  dmgReset();copClear(true);GAME.state=0;GAME.lock=0;C.flash=1;SAFE.svc=0;SAFE.visit=s?s.id:null;if(s)SAFE.last=s.id;safeToast('Back at '+(s?s.name:'the garage'),3)}
/* inputs are taken away while the end screen runs */
function gameLockInputs(){IN.thr=0;IN.brk=1;IN.hand=0;IN.nitro=0;IN.auto=false}
/* ---- drawing: the pads on the ground (called from fxDraw with its quad function), the HUD parts ---- */
function safePads(quad){
  const t=SAFE.t;for(const s of SAFE.pads){const dx=s.x-C.x,dz=s.z-C.z;if(dx*dx+dz*dz>360000)continue;
    const own=SAFE.owned[s.id],p=s.pad,a=s.dd,b=s.t,y=s.y,pulse=.55+.2*Math.sin(t*3+s.x*.01),act=SAFE.at===s?SAFE.svc/1.5:0;
    const r=own?.2+act*.5:.9,g=own?1:.35,bl=own?.5:.3,al=pulse+act*.3;
    quad(p.x-a[0]*p.hl-b[0]*p.hw,y,p.z-a[1]*p.hl-b[1]*p.hw,p.x+a[0]*p.hl-b[0]*p.hw,y,p.z+a[1]*p.hl-b[1]*p.hw,p.x+a[0]*p.hl+b[0]*p.hw,y,p.z+a[1]*p.hl+b[1]*p.hw,p.x-a[0]*p.hl+b[0]*p.hw,y,p.z-a[1]*p.hl+b[1]*p.hw,r,g,bl,al)}}
function safeHud(c,W_,H_,u){
  /* servicing ring */
  if(SAFE.at&&SAFE.svc>0&&!GAME.state){const k=Math.min(1,SAFE.svc/1.5),cx=W_*.5,cy=H_*.62,rad=u*.5;c.save();c.lineWidth=u*.09;c.strokeStyle='rgba(255,255,255,.25)';c.beginPath();c.arc(cx,cy,rad,0,TAU);c.stroke();
    c.strokeStyle=SAFE.owned[SAFE.at.id]?'#4be07a':'#ff6a4a';c.beginPath();c.arc(cx,cy,rad,-PI/2,-PI/2+TAU*k);c.stroke();c.fillStyle='#fff';c.textAlign='center';c.font='800 '+Math.round(u*.28)+'px -apple-system,Roboto,sans-serif';c.fillText(SAFE.owned[SAFE.at.id]?'SERVICING':'LOCKED',cx,cy+rad+u*.4);c.restore()}
  else if(SAFE.at&&!GAME.state&&C.speed>=9&&SAFE.msgT<=0){c.save();c.textAlign='center';c.fillStyle='rgba(255,255,255,.85)';c.font='700 '+Math.round(u*.26)+'px -apple-system,Roboto,sans-serif';c.shadowColor='rgba(0,0,0,.7)';c.shadowBlur=4;c.fillText('slow down to use the garage',W_*.5,H_*.62);c.restore()}
  if(SAFE.msgT>0){c.save();c.globalAlpha=Math.min(1,SAFE.msgT*1.5);c.textAlign='center';c.font='800 '+Math.round(u*.5)+'px -apple-system,Roboto,sans-serif';c.fillStyle='#7dffb0';c.shadowColor='rgba(0,0,0,.75)';c.shadowBlur=6;c.fillText(SAFE.msg,W_*.5,H_*.44);c.restore()}
  /* wrecked / busted screen */
  if(GAME.state){const k=Math.min(1,GAME.t/1.2),f=GAME.t>2.6?Math.min(1,(GAME.t-2.6)/.7):0;c.save();c.fillStyle='rgba(0,0,0,'+(.35*k+.65*f)+')';c.fillRect(0,0,W_,H_);c.globalAlpha=k;c.textAlign='center';c.font='900 '+Math.round(u*1.1)+'px -apple-system,Roboto,sans-serif';
    c.fillStyle=GAME.state==2?'#7fb4ff':'#ff6a4a';c.shadowColor='rgba(0,0,0,.8)';c.shadowBlur=10;c.fillText(GAME.msg,W_*.5,H_*.5);
    c.font='700 '+Math.round(u*.3)+'px -apple-system,Roboto,sans-serif';c.fillStyle='rgba(255,255,255,.85)';c.fillText(GAME.state==2?'The cops got you.':'The car is finished.',W_*.5,H_*.5+u*.55);c.restore()}}
