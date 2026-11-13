'use strict';
/* ===== cops: heat 1-5, patrols on the lane graph, chases, boxing in, ramming, roadblocks, escape by losing them ===== */
/* A cop is a traffic car (60_traffic.js) with kind 1 and a mode cm: 0 patrol (an ordinary lane-following car, lights off), 1 chase on the lane graph (greedy turns towards you, faster than the limits, lights and siren),
   2 free chase (state 3: steers straight at its slot round you, over the grass if it must, stopped by buildings and trees), 3 roadblock (parked across the road, a wreck that never moves unless you hit it).
   Everything about how hard they are is in COPD (one table per difficulty); the default is Forgiving. */
const COPD={
  /* top: the slowest a chaser's top speed can be; follow: chasers match your speed times this (up to 105 m/s) and get a rubber-band boost when they fall behind; accel: how hard they accelerate;
     loseT / loseD: you only lose them by being more than loseD metres from every chaser AND out of sight for loseT seconds; passV: speed at which blowing past a cop gets you chased (120 mph) */
  forgiving:{name:'Forgiving',top:58,follow:1.1,accel:12,react:.9,chaseN:[0,2,4,5,6,8],patrol:1,ramLevel:2,ramCd:4.2,ramV:10,blockLevel:3,bustT:5,bustSpd:6,bustN:2,loseT:10,loseD:170,decay:10,ev:1,rbGap:6.5,chaseSpd:3.4,passV:53.64,thr:[0,28,80,160,280,450]},
  medium:{name:'Medium',top:66,follow:1.15,accel:14,react:.7,chaseN:[0,3,5,6,7,9],patrol:1,ramLevel:2,ramCd:3,ramV:12,blockLevel:3,bustT:3,bustSpd:7,bustN:2,loseT:12,loseD:200,decay:8,ev:1,rbGap:0,chaseSpd:3.6,passV:53.64,thr:[0,25,70,140,250,400]},
  hard:{name:'Hard',top:76,follow:1.2,accel:16,react:.5,chaseN:[0,3,5,7,8,10],patrol:2,ramLevel:2,ramCd:2.2,ramV:15,blockLevel:3,bustT:2,bustSpd:8,bustN:2,loseT:14,loseD:240,decay:6,ev:1,rbGap:0,chaseSpd:3.8,passV:53.64,thr:[0,22,60,120,220,350]}};
/* WHAT EACH STAR ADDS (batch 3; the difficulty presets above set the speeds, the number of chasers and how often they ram):
   1 a couple of patrol cars follow you, no contact; 2 more cars and they RAM you (interceptors join); 3 PIT manoeuvres (they aim at your rear quarter), bigger roadblocks (4 cars across, 5 at four stars, 6 at five; one fewer on Forgiving, which leaves a gap; fewer on a narrow road);
   4 a HELICOPTER with a spotlight follows you (it always knows where you are) and SPIKE STRIPS are laid on the road ahead; 5 SWAT trucks block, two or three helicopters, near-constant PIT
   attempts, roadblocks of 6 with heavy trucks. types: the police vehicles that chase at that level (4 patrol, 20 interceptor, 21 SUV, 22 SWAT truck). */
const STARS=[{types:[4]},{types:[4],pit:0,block:0,heli:0,spikes:0,ramMul:1},{types:[4,20],pit:0,block:0,heli:0,spikes:0,ramMul:1},{types:[4,20,21],pit:1,block:4,heli:0,spikes:0,ramMul:.85},
  {types:[20,21,4],pit:1,block:5,heli:1,spikes:1,ramMul:.7},{types:[20,21,22],pit:1,block:6,heli:3,spikes:1,ramMul:.4}];
/* (batch 27) LOCK-ON: cops have to be close to see you (a crime counts only with a cop within 60 m, or 120 m in clear sight; a patrol notices you the same way), but once they
   are after you they always know where you are while any police car (chasing, wrecked or in a roadblock) is within a mile (COP_LOCK); reinforcements come only while one is within
   600 m. Put a mile between you and the nearest one and within about 5 s the heat is gone. */
const COP_LOCK=1609,COP_SEE=120,COP_NEAR=60;
/* the call that goes out with a crime: when and where it happened (for 20 s they know you are near there; reinforcements are sent there for 15 s) */
function copCall(){COP.callT=0;COP.callX=C.x;COP.callZ=C.z}
const copCallD=()=>COP.callX===undefined?1e9:Math.hypot(C.x-COP.callX,C.z-COP.callZ);
function copWitness(){for(const c of TR.cars){if(!c.alive||c.kind!==1)continue;const d=Math.hypot(c.x-C.x,c.z-C.z);if(d<COP_NEAR||(d<COP_SEE&&c.state!==1&&copLos(c)))return true}
  for(const h of HELI.list)if(!h.leave&&Math.hypot(h.x-C.x,h.z-C.z)<220)return true;return false}
const COP={on:true,D:COPD.forgiving,diff:'forgiving',heat:0,w:0,t:0,sightT:99,minD:1e9,bust:0,spawnT:2,nC:0,nP:0,sirenVol:0,lastBlock:-99,warnT:0,heatT:0,seenNow:false,rbN:0};
function copSetDiff(n){if(COPD[n]){COP.D=COPD[n];COP.diff=n}}
/* ---- heat ---- */
function copLevelOf(){const t=COP.D.thr;let L=0;for(let i=1;i<6;i++)if(COP.w>=t[i]*(i<=COP.heat?.7:1))L=i;return L}
/* what gets you chased (and nothing else does): you hit a cop car, you blow past a cop at 120 mph or more, you crash into another car. level = the number of stars it is worth at least */
function copTrigger(level,why){
  if(!COP.on||GAME.state||!TR.on)return;if(why!=='hit a cop'&&why!=='event'&&!copWitness())return;(COP.crimes||(COP.crimes=[])).push({t:+C.t.toFixed(1),why:why||'?',level});if(COP.crimes.length>40)COP.crimes.shift();const t=COP.D.thr;
  if(COP.w<t[level]+1)COP.w=t[level]+1;else COP.w+=(t[Math.min(5,level+1)]-t[level])*.3;
  if(COP.w>t[5]*1.3)COP.w=t[5]*1.3;const L=copLevelOf();if(L>COP.heat){COP.heat=L;COP.heatT=0}COP.sightT=0;copCall()}
/* how fast a chaser may go: it matches you (a little more), never less than the difficulty's top, and gets a boost the further behind it falls, so it keeps coming */
/* how fast a police car can go (batch 5): its own top speed, the difficulty's top (Forgiving 58 m/s, 130 mph) times its type (interceptor 1.25, SUV 0.95, SWAT truck 0.8). They no longer match your speed: a fast car
   driven flat out pulls away, and out of sight you lose them. Within 45 m and in sight one may push a little past it to make a ram. */
function copTop(c){const D=COP.D;let t=D.top*(c?(TTYPES[c.type]&&TTYPES[c.type].vtop)||1:1);if(c&&COP.sightT<1.5&&Math.hypot(c.x-C.x,c.z-C.z)<45)t=Math.max(t,Math.min(C.speed+6,t*1.12));return Math.min(115,t)}
function heatAdd(p){if(!COP.on||GAME.state||!TR.on)return;COP.w+=p*COP.D.ev;if(COP.w>COP.D.thr[5]*1.3)COP.w=COP.D.thr[5]*1.3;const L=copLevelOf();if(L>COP.heat){COP.heat=L;COP.heatT=0}COP.sightT=Math.min(COP.sightT,.2);copCall()}
/* wipe the heat and send the chasers home (full: they disappear, as when you reach a garage) */
function copClear(full){COP.w=0;COP.heat=0;COP.bust=0;COP.sightT=99;SPIKE.list.length=0;if(full)HELI.list.length=0;
  for(const c of TR.cars){if(!c.alive||c.kind!==1)continue;if(c.cm==3||(full&&c.cm>0))trKill(c,0);else if(c.cm>0)copStandDown(c)}}
function copStandDown(c){c.cm=0;c.siren=0;c.v0f=1;c.A=2.2;if(c.state==3)copAttach(c)}
function copAlert(c){c.cm=1;c.siren=1;c.v0f=COP.D.chaseSpd;c.A=COP.D.accel*.85;c.T=.7;c.pickJ=-1;c.role=0;c.rt=null}
/* ---- line of sight: terrain and solid things (buildings, trees) between a cop and the player ---- */
function copLos(c){
  const x0=c.x,z0=c.z,y0=c.y+1.4,x1=C.x,z1=C.z,y1=C.y+1.2,d=Math.hypot(x1-x0,z1-z0);if(d>300)return false;const n=Math.max(2,Math.ceil(d/9));
  for(let k=1;k<n;k++){const t=k/n,x=x0+(x1-x0)*t,z=z0+(z1-z0)*t,y=y0+(y1-y0)*t;if(terrainH(x,z)>y-.25)return false;if(trStatic(x,z,.3,y))return false}
  return true}
/* ---- free chase: a cop that steers at its slot round the player ---- */
function copHorizon(c){const hs=c.hs=Math.min(10,Math.max(6,2+c.v*.33)),sx=Math.sin(c.yaw),sz=-Math.cos(c.yaw);for(let k=0;k<HN;k++){c.hx[k]=c.x+sx*k*hs;c.hz[k]=c.z+sz*k*hs;c.hv[k]=c.v}c.hn=HN;c.hend=0}
const _ct={x:0,z:0,v:0};
function copTarget(c){
  /* out of sight (no cop and no helicopter has seen you for 2.5 s) they drive to the LAST PLACE they saw you, not to where you are: that is how you lose them */
  const T=COP.sightT<2.5?{x:C.x,z:C.z,vx:C.vx,vz:C.vz,yaw:C.yaw}:{x:COP.lkx,z:COP.lkz,vx:0,vz:0,yaw:COP.lkyaw};
  const D=COP.D,ps=Math.hypot(T.vx,T.vz);let fx,fz;if(ps>3){fx=T.vx/ps;fz=T.vz/ps}else{fx=Math.sin(T.yaw);fz=-Math.cos(T.yaw)}const rx=-fz,rz=fx,slow=ps<14;let b=0,s=0;     /* b: metres behind the player, s: metres to the right */
  switch(c.role){case 0:b=slow?7:6+ps*.1;break;case 1:b=slow?0:5;s=slow?-4.1:-3.8;break;case 2:b=slow?0:5;s=slow?4.1:3.8;break;case 3:if(slow){b=-7}else b=18;break;case 4:b=slow?10:18;break;case 5:b=9;s=-3.6;break;default:b=9;s=3.6}
  let tx=T.x-fx*b+rx*s,tz=T.z-fz*b+rz*s,ram=false;
  /* ramming / PIT: aim at the player's rear quarter, faster than the player, then back off for a while */
  const dist=Math.hypot(T.x-c.x,T.z-c.z);
  const ST=STARS[COP.heat]||STARS[0];
  if(D.ramLevel<=COP.heat&&c.role<=3&&c.ramCd<=0&&dist<85&&COP.sightT<1){ram=true;const sd=c.role==1?-1:c.role==2?1:((c.i&1)?1:-1);
    /* a ram goes for your back bumper; a PIT (from 3 stars) for the rear corner, from the side, so your tail is pushed round */
    if(ST.pit){tx=C.x-fx*1.9+rx*sd*1.25;tz=C.z-fz*1.9+rz*sd*1.25}else{tx=C.x-fx*1.7+rx*sd*.6;tz=C.z-fz*1.7+rz*sd*.6}}
  else{/* lead the target: aim where you will be (up to 1.2 s ahead), so they cut corners instead of following your tail round them */const lt=Math.min(1.2,dist/60);tx+=T.vx*lt;tz+=T.vz*lt}
  const sy=Math.sin(c.yaw),cy=-Math.cos(c.yaw),dl=(tx-c.x)*sy+(tz-c.z)*cy,dd=Math.hypot(tx-c.x,tz-c.z);let tv=ps+Math.max(-12,Math.min(22,dl*.9));
  if(ram)tv=ps+D.ramV;else{const cl=Math.min(34,Math.sqrt(2*8*Math.max(0,dd-2)));tv=ps+(dl>=0?cl:-cl)}     /* come up to the slot at a speed it can still stop from */
  _ct.x=tx;_ct.z=tz;_ct.v=Math.max(0,Math.min(copTop(c),tv))}
function copFree(c,dt){
  c.px=c.x;c.pz=c.z;c.py=c.y;c.pyaw=c.yaw;c.age+=dt;const D=COP.D;if(c.ramCd>0)c.ramCd-=dt;
  copTarget(c);
  /* stuck against something: back off for a moment, turning away, then go again (it used to grind into the wall until it was replaced) */
  if(c.rev>0){c.rev-=dt;const sy=Math.sin(c.yaw),cy=Math.cos(c.yaw);c.yaw+=c.revS*1.2*dt;c.v=0;c.x-=sy*4.5*dt;c.z+=cy*4.5*dt;c.vx=-sy*4.5;c.vz=cy*4.5;if(trStatic(c.x,c.z,c.hw+.1,c.y)){c.x+=_sx;c.z+=_sz}const g=groundAt(c.x,c.z,c.y+.5);c.y+=(g-c.y)*Math.min(1,dt*18);return}
  if(c.stk>1.1&&c.v<2){c.rev=.9;c.revS=angd(Math.atan2(_ct.x-c.x,-(_ct.z-c.z)),c.yaw)>0?-1:1;c.stk=.4}
  const dx=_ct.x-c.x,dz=_ct.z-c.z,err=angd(Math.atan2(dx,-dz),c.yaw),v=c.v,maxYr=Math.min(2.6,13/Math.max(v,4));
  const yr=Math.max(-maxYr,Math.min(maxYr,err*3.2));c.om=yr;c.yaw+=yr*dt;
  const a=Math.max(-12,Math.min(D.accel,(_ct.v-v)*1.6)),top=copTop(c);c.v=Math.max(0,Math.min(top,v+a*dt));c.brake=a<-2.5?1:0;
  const sy=Math.sin(c.yaw),cy=Math.cos(c.yaw);c.vx=sy*c.v;c.vz=-cy*c.v;c.x+=c.vx*dt;c.z+=c.vz*dt;
  for(const o of[-1,1]){const px=c.x+sy*o*c.hl*.55,pz=c.z-cy*o*c.hl*.55;if(trStatic(px,pz,c.hw+.1,c.y)){c.x+=_sx;c.z+=_sz;c.v*=.55;c.vx=sy*c.v;c.vz=-cy*c.v;c.stk+=.3}}
  const g=groundAt(c.x,c.z,c.y+.5);{const gv=Math.max(26,(HND.vmaxG||40)*.9);if(!RQ.on&&c.v>gv)c.v=gv}   /* (batch 30) off the road nearly as fast as you are on grass (it was 26 m/s) */c.y+=(g-c.y)*Math.min(1,dt*18);if(c.y<g)c.y=g;
  const gf=groundAt(c.x+sy*1.6,c.z-cy*1.6,c.y+.5),gb=groundAt(c.x-sy*1.6,c.z+cy*1.6,c.y+.5);c.pitch+=(Math.atan2(gf-gb,3.2)-c.pitch)*Math.min(1,dt*10);c.roll*=.9;
  if(c.v<1.5&&Math.hypot(C.x-c.x,C.z-c.z)>14)c.stk+=dt;else if(c.stk>0)c.stk=Math.max(0,c.stk-dt*.5)}
/* between the two worlds: lane graph <-> free driving */
function copDetach(c){c.state=3;c.cm=2;c.L=null;c.vx=Math.sin(c.yaw)*c.v;c.vz=-Math.cos(c.yaw)*c.v;c.stk=0;c.hn=0}
function copAttach(c){
  if(!trProbe(c.x,c.z)){c.stk=0;return false}                         /* not on a road (it is cutting across the grass): keep chasing freely, never give up */
  const ri=TRP.ri,r=ROADS[ri],o=LG.ofRoad[ri],i=TRP.i,j=i+1<r.n?i+1:i,tx=r.X[j]-r.X[i],tz=r.Z[j]-r.Z[i],hx=Math.sin(c.yaw),hz=-Math.cos(c.yaw),dir=(tx*hx+tz*hz)>=0?0:1,lanes=o[dir];
  const u=Math.max(3,Math.min(r.n-6,dir==0?i:r.n-1-i));let bk=0,bd=1e18;
  for(let k=0;k<lanes.length;k++){const e=lanes[k],q=Math.min(Math.floor(u),e.n-2),d=(e.X[q]-c.x)**2+(e.Z[q]-c.z)**2;if(d<bd){bd=d;bk=k}}
  const e=lanes[bk];c.e=e;c.u=Math.min(Math.floor(u),e.n-2);c.L=null;c.lu=0;c.state=0;c.cm=1;c.pjid=-1;c.pickJ=-1;c.hn=0;c.stk=0;
  const t=lgTan(e,c.u|0);c.off=Math.max(-8,Math.min(8,(c.x-e.X[c.u|0])*(-t[1])+(c.z-e.Z[c.u|0])*t[0]));return true}
/* greedy turns towards the player (lane chase): at each junction take the exit that ends nearest to the player; the choice is kept until the junction is passed */
function copPick(c,g,e){
  if(c.pickJ===g.id)return c.pickL;
  const L=g.links;let own=false;if(!g.through)for(let q=0;q<L.length;q++)if(L[q].from===e){own=true;break}
  /* the way to you: a real route on the lane graph (A*), recomputed every couple of seconds; it names the exit to take at this junction (or says go straight on) */
  const goal=COP.sightT<2.5?NAV.pl:COP.lkPl;if(goal&&(!c.rt||COP.t-c.rtT>1.8)){const chain=navAStar(e,Math.min(e.n-1,c.u|0),{ri:goal.ri,i:goal.i,x:goal.x,z:goal.z},5000);c.rt=chain?navLinksOf(chain):null;c.rtT=COP.t}
  if(c.rt){let want=null;for(const l of c.rt)if(l.from.ri===e.ri&&l.from.dir===e.dir&&L.indexOf(l)>=0){want=l;break}
    if(want){let pick=null;for(const l of L)if(l.to.ri===want.to.ri&&l.to.dir===want.to.dir&&(!own||l.from===e)){pick=l;break}c.pickJ=g.id;c.pickL=pick||want;return c.pickL}
    if(g.through){c.pickJ=g.id;c.pickL=null;return null}}
  let best=null,bd=1e18;
  if(g.through){const ii=Math.min(e.n-1,Math.round(g.foot+10));const gx=COP.sightT<2.5?C.x:COP.lkx,gz=COP.sightT<2.5?C.z:COP.lkz;bd=((e.X[ii]-gx)**2+(e.Z[ii]-gz)**2)*.8}
  for(let q=0;q<L.length;q++){const l=L[q];if(own&&l.from!==e)continue;const k=l.n-1,tx=l.X[k]-l.X[k-1],tz=l.Z[k]-l.Z[k-1],ll=Math.hypot(tx,tz)||1,px=l.X[k]+tx/ll*45,pz=l.Z[k]+tz/ll*45;const gx=COP.sightT<2.5?C.x:COP.lkx,gz=COP.sightT<2.5?C.z:COP.lkz;let d=(px-gx)**2+(pz-gz)**2;if(l.kind==3)d*=3;if(d<bd){bd=d;best=l}}
  c.pickJ=g.id;c.pickL=best;return best}
/* which police vehicle: from the star table (patrols are patrol cars or SUVs) */
function copType(chase){const T=chase?(STARS[COP.heat]||STARS[1]).types:[4,4,21];return T[Math.floor(TR.rng()*T.length)]}
/* ---- spawning (out of sight, behind the player when chasing) ---- */
function trSpawnCop(chase,far){
  const rng=TR.rng,P=C;let ux=C.vx,uz=C.vz;const l=Math.hypot(ux,uz);if(l<2){ux=Math.sin(C.yaw);uz=-Math.cos(C.yaw)}else{ux/=l;uz/=l}
  /* a chaser: straight back along the road you are on (so it always finds a road and comes up behind you), 120-220 m behind (260-350 when it replaces one that fell behind) */
  /* (batch 30) a chaser only ever appears BEHIND you: more than 120 degrees off the way you are going, and on the road you are on only once you are lined up with it (just after a turn the
     snapped road can still be the one you left, and 'behind on it' was off to the side or ahead of you) */
  const behind=(sx,sz)=>{const dx=sx-P.x,dz=sz-P.z,d=Math.hypot(dx,dz)||1;return(dx*ux+dz*uz)<-.5*d};
  const pl0=chase?navSnap(C.x,C.z,40):null;
  if(chase&&pl0&&LG.ofRoad[pl0.ri]&&Math.abs(_tan(ROADS[pl0.ri],pl0.i)[0]*ux+_tan(ROADS[pl0.ri],pl0.i)[1]*uz)>.8){const pl=pl0;
    const r=ROADS[pl.ri],o=LG.ofRoad[pl.ri],t=_tan(r,pl.i),sg=(t[0]*ux+t[1]*uz)>=0?1:-1,di=sg>0?0:1;
    for(let tries=0;tries<4;tries++){const D=far?265+rng()*80:120+rng()*100;let idx=pl.i-sg*Math.round(D/r.ds);if(r.closed)idx=((idx%r.n)+r.n)%r.n;else if(idx<6||idx>r.n-8)continue;
      const k=Math.floor(rng()*o[di].length),e=o[di][k],u=e.dir>0?idx:r.n-1-idx;trPt(e,u);const sx=_pt.x,sz=_pt.z,d=Math.hypot(sx-P.x,sz-P.z);if(d<(TR.boot?90:TR.visMin*.7)||trSeen(sx,sz)||!behind(sx,sz))continue;
      let ok=true;for(const c of TR.cars)if(c.alive&&Math.hypot(c.x-sx,c.z-sz)<18){ok=false;break}if(!ok)continue;
      const c=trPlace(e,u,copType(true),12,Math.min(e.V[Math.min(u|0,e.n-1)],e.lim)*1.0,Math.floor(rng()*1e9));if(!c)return null;c.kind=1;c.cm=0;c.siren=0;c.block=0;c.pickJ=-1;c.ramCd=0;c.los=false;c.stk=0;copAlert(c);return c}}
  for(let tries=0;tries<16;tries++){
    const ahead=!chase&&rng()<.3,ang=chase?Math.atan2(-uz,-ux)+(rng()-.5)*2.2:(ahead?Math.atan2(uz,ux)+(rng()-.5)*1.3:rng()*TAU),r=chase?(far?265+rng()*80:120+rng()*100):(ahead?230+rng()*150:140+rng()*200),x=P.x+Math.cos(ang)*r,z=P.z+Math.sin(ang)*r;
    if(!trProbe(x,z))continue;
    const ri=TRP.ri,o=LG.ofRoad[ri],r0=ROADS[ri],i=TRP.i,j=i+1<r0.n?i+1:i,tx=r0.X[j]-r0.X[i],tz=r0.Z[j]-r0.Z[i];
    const toward=(P.x-x)*tx+(P.z-z)*tz,di=chase?(toward>0?0:1):(rng()<.5?0:1),k=Math.min(o[di].length-1,Math.floor(rng()*o[di].length)),e=o[di][k];
    let u=e.dir>0?i+(TRP.t>.5?1:0):r0.n-1-i-(TRP.t>.5?1:0);if(e.closed)u=((u%e.n)+e.n)%e.n;else if(u<6||u>e.n-8)continue;
    trPt(e,u);const sx=_pt.x,sz=_pt.z,d=Math.hypot(sx-P.x,sz-P.z);if(d<(TR.boot?90:TR.visMin*.7)||trSeen(sx,sz)||(chase&&!behind(sx,sz)))continue;   /* never pops up in view (batch 5: patrols used to appear 230 m ahead) */
    let ok=true;for(const c of TR.cars)if(c.alive&&Math.hypot(c.x-sx,c.z-sz)<18){ok=false;break}if(!ok)continue;
    if(!chase&&trLightAhead(e,u,Math.min(e.V[Math.min(u|0,e.n-1)],e.lim)*.85))continue;   /* (a patrol is not put where it could not stop for a red light) */
    const c=trPlace(e,u,copType(chase),12,Math.min(e.V[Math.min(u|0,e.n-1)],e.lim)*(chase?1.0:.85),Math.floor(rng()*1e9));if(!c)return null;
    c.kind=1;c.cm=0;c.siren=0;c.block=0;c.pickJ=-1;c.ramCd=0;c.los=false;c.stk=0;if(chase)copAlert(c);return c}
  return null}
/* a point on the road D metres ahead of you ALONG the road you are on (so it also works round a bend); where that road ends, a straight-line probe. Leaves the result in TRP */
function copAhead(D,ux,uz){let pl=NAV.pl;if(!pl||!ROADS[pl.ri]||Math.hypot(ROADS[pl.ri].X[pl.i]-C.x,ROADS[pl.ri].Z[pl.i]-C.z)>90)pl=navSnap(C.x,C.z,70);if(pl&&ROADS[pl.ri]){const r=ROADS[pl.ri],t=_tan(r,pl.i),sg=(t[0]*ux+t[1]*uz)>=0?1:-1;let i=pl.i+sg*Math.round(D/r.ds);if(r.closed)i=((i%r.n)+r.n)%r.n;if(i>=3&&i<=r.n-4){TRP.ri=pl.ri;TRP.i=i;TRP.t=0;return true}}
  return !!trProbe(C.x+ux*D,C.z+uz*D)}
/* ---- roadblock: two or three cars across the road ahead (with a gap on Forgiving) ---- */
function copRoadblock(){
  const rng=TR.rng;let ux=C.vx,uz=C.vz;const l=Math.hypot(ux,uz);if(l<8)return false;ux/=l;uz/=l;
  for(let tries=0;tries<4;tries++){const dist=250+rng()*80;if(!copAhead(dist,ux,uz))continue;
    const ri=TRP.ri,r=ROADS[ri],i=Math.max(2,Math.min(r.n-3,TRP.i)),t=_tan(r,i),nx=-t[1],nz=t[0],hw=r.hw,gap=COP.D.rbGap,cx=r.X[i],cz=r.Z[i],yaw0=Math.atan2(t[0],-t[1]);
    /* bigger with the stars (STARS.block cars across the road; on Forgiving a car-wide gap is left); from 4 stars SUVs, at 5 SWAT trucks in the middle */
    const nb=Math.max(2,Math.min((STARS[COP.heat]||{}).block||3,Math.floor(hw*1.64/2.6)+1)),offs=[];for(let q=0;q<nb;q++)offs.push(-hw*.82+hw*1.64*q/Math.max(1,nb-1));if(gap>0&&offs.length>2)offs.splice(Math.floor(offs.length/2),1);
    const e=LG.ofRoad[ri]&&LG.ofRoad[ri][0][0];if(!e)continue;let n=0;
    for(let q=0;q<offs.length;q++){const mid=Math.abs(offs[q])<hw*.45,ty=COP.heat>=5&&mid?22:COP.heat>=4?(q&1?21:20):4,c=trPlace(e,Math.max(3,Math.min(e.n-4,r.n>i?i:3)),ty,12,0,Math.floor(rng()*1e9));if(!c)break;
      c.x=cx+nx*offs[q];c.z=cz+nz*offs[q];c.yaw=yaw0+(q&1?1:-1)*(1.05+.12*rng());c.px=c.x;c.pz=c.z;c.pyaw=c.yaw;c.y=r.Y[i];c.py=c.y;c.state=1;c.kind=1;c.cm=3;c.block=1;c.siren=1;c.life=55;c.vx=c.vz=c.om=c.v=0;c.m=ty==22?9000:ty==21?2600:2100;c.wt=0;c.L=null;n++}
    if(n){COP.lastBlock=COP.t;COP.warnT=4;return true}}
  return false}
/* ---- the tick: sight, heat, who chases, spawns, boxing in ---- */
function copTick(dt){
  if(!COP.on||!TR.on||GAME.state)return;
  const D=COP.D,cars=TR.cars;COP.t+=dt;COP.heatT+=dt;COP.callT=(COP.callT||0)+dt;if(COP.warnT>0)COP.warnT-=dt;if(COP.spawnT>0)COP.spawnT-=dt;
  const ps=C.speed;let nC=0,nP=0,seen=false,minD=1e9,nNear=0,nFree=0,minChase=1e9,lockD=1e9;
  for(let i=0;i<TRN;i++){const c=cars[i];if(!c.alive||c.kind!==1)continue;
    {const d=Math.hypot(c.x-C.x,c.z-C.z);if(c.cm>=1&&d<lockD)lockD=d}   /* (batch 27) the nearest police car that is after you, of any kind */
    if(c.cm==3){if(c.life!==undefined&&Math.hypot(c.x-C.x,c.z-C.z)>330&&((c.x-C.x)*C.vx+(c.z-C.z)*C.vz)<0)trKill(c,0);continue}
    if(c.state==1)continue;                                 /* a wrecked cop is out of it */
    const d=Math.hypot(c.x-C.x,c.z-C.z);if(c.cm==0)nP++;else{nC++;if(d<minChase)minChase=d}
    if(d<minD)minD=d;
    if(((TR.tk|0)+i)%15==0||c.los===null)c.los=d<300&&copLos(c);
    if(c.cm>=1&&d>COP_LOCK+250){trKill(c,0);continue}  /* (batch 27) a chaser more than a mile behind has lost you for good (it is no longer replaced by a fresh one close behind you) */
    if(c.cm==0&&ps>=D.passV&&d<55&&COP.t-(c.clk||-99)>14){c.clk=COP.t;copTrigger(1,'speeding past a cop')}   /* you blow past a cop at 120 mph or more */
    if(c.cm>=1&&d<10)nNear++;
    if(c.state==3)nFree++;
    /* alert: a patrol within earshot joins the chase once the heat has been on for a moment */
    if(COP.heat>0&&c.cm==0&&COP.heatT>D.react&&(d<COP_NEAR||(c.los&&d<COP_SEE)))copAlert(c);   /* a patrol joins when it sees you (it used to join from anywhere within 520 m, so a patrol ahead of you always turned into a chaser) */
    if(c.cm>=1){
      if(COP.heat==0||COP.sightT>D.loseT+2){copStandDown(c);continue}
      if(c.state==0){if((d<115&&c.los)||d<40||(!C.onRoad&&d<350))copDetach(c)}   /* (batch 30) you left the road: it comes after you across the grass */
      else if(c.state==3){if((d>210&&C.onRoad)||c.stk>3.2)copAttach(c)}}}
  if(COP.heat>0&&(lockD<COP_LOCK||(COP.callT<20&&copCallD()<COP_LOCK)))seen=true;COP.lockD=lockD;   /* (for 20 s after a crime the call says where you are, before any car has arrived) */
  COP.nC=nC;COP.nP=nP;COP.minD=minD;COP.seenNow=seen;
  /* roles for the free chasers, nearest first */
  if(nFree){let k=0;const free=[];for(let i=0;i<TRN;i++){const c=cars[i];if(c.alive&&c.kind===1&&c.state==3)free.push(c)}free.sort((a,b)=>Math.hypot(a.x-C.x,a.z-C.z)-Math.hypot(b.x-C.x,b.z-C.z));for(const c of free)c.role=k++}
  COP.snapT=(COP.snapT||0)-dt;if(COP.snapT<=0){COP.snapT=.35;NAV.pl=navSnap(C.x,C.z,70);if(NAV.pl&&NAV.pl.ri!==COP.roadRi){COP.roadRi=NAV.pl.ri;COP.roadT=COP.t}}   /* (batch 30: when you last turned onto another road) */        /* where you are on the road network, for the chasers' routes and spawns */
  if(seen)COP.sightT=0;else COP.sightT+=dt;
  if(COP.sightT<1||COP.lkx===undefined){COP.lkx=C.x;COP.lkz=C.z;COP.lkyaw=C.yaw;COP.lkPl=NAV.pl}   /* the last place they saw you */
  if(COP.heat>0&&COP.sightT>3){COP.w=Math.max(0,COP.w-Math.max(D.decay,COP.w*.8)*dt);if(COP.w<1)COP.w=0;COP.heat=copLevelOf()}   /* (batch 27) a mile clear: gone within about 5 s */
  /* spawns */
  if(COP.spawnT<=0){
    if(COP.heat>0){const want=D.chaseN[COP.heat];if(nC<want&&(lockD<600||(COP.callT<15&&copCallD()<600))){   /* (batch 27) reinforcements while a police car is within 600 m of you, and for 15 s after a new crime (the call goes out) */if(trSpawnCop(true,false)){COP.spawnT=1.4}else COP.spawnT=.5}}
    else if(nP<D.patrol&&TR.nAlive<TRN-8&&COP.t-(COP.lastPatrol||-99)>110&&DISTRICT_BOXES.some(B=>inBox(C.x,C.z,B,350))){if(trSpawnCop(false)){COP.spawnT=1.6;COP.lastPatrol=COP.t}else COP.spawnT=1}}   /* patrols are rare (batch 9): one at a time (two on Hard), a new one at most every 110 s, and only in or near a town or city: none on the country highways */
  /* roadblock */
  if(COP.heat>=D.blockLevel&&COP.t-COP.lastBlock>75&&COP.t-(COP.roadT||-99)>12&&COP.sightT<1.5&&ps>16){let nb=0;for(const c of cars)if(c.alive&&c.cm==3)nb++;if(nb<6)copRoadblock()}
  copHeliTick(dt);copSpikeTick(dt);
  /* boxed in: slow, with cops all round, for long enough */
  if(COP.heat>0&&ps<D.bustSpd&&nNear>=D.bustN)COP.bust+=dt;else COP.bust=Math.max(0,COP.bust-dt*1.5);
  if(COP.bust>=D.bustT){gameBusted();COP.bust=0}
  COP.sirenVol=COP.heat>0&&minChase<260?Math.pow(1-minChase/260,1.4):0}
/* a ram or a collision with a cop: called from the player collision code */
function copRammed(c,e,fault){c.ramCd=COP.D.ramCd*((STARS[COP.heat]||STARS[1]).ramMul||1);if(fault)copTrigger(c.cm>0?Math.max(2,COP.heat):2,'hit a cop');if(c.state==3&&e>130000){c.state=1;c.cm=2;c.siren=0;c.wt=0;c.block=0;TR.stat.wrecks++;if(fault)copTrigger(4,'wrecked a cop')}}   /* (batch 15: only when it was your fault; a chaser that wrecks itself on you used to add two stars) */   /* a cop that runs into you is not your crime */
/* ---- HUD: stars, the bust meter, the losing-them bar ---- */
function copStar(c,x,y,r,fill,col){c.beginPath();for(let k=0;k<10;k++){const a=-PI/2+k*PI/5,rr=k&1?r*.45:r;k?c.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr):c.moveTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr)}c.closePath();if(fill){c.fillStyle=col;c.fill()}c.strokeStyle='rgba(255,255,255,.7)';c.lineWidth=1.4;c.stroke()}
function copHud(c,W_,H_,u){
  if(!COP.on||!TR.on)return;const L=COP.heat;
  if(L>0||COP.w>0){const r=u*.2,gap=r*2.3,x0=W_*.5-gap*2,y=u*.62,flash=COP.sightT<.4&&((C.t*5)|0)%2==0;c.save();c.shadowColor='rgba(0,0,0,.7)';c.shadowBlur=4;
    for(let i=0;i<5;i++)copStar(c,x0+i*gap,y,r,i<L,i<L?(COP.sightT<.4?(flash?'#ff4a3a':'#4a7aff'):'#ffd24a'):'rgba(0,0,0,0)');c.restore();
    /* (batch 27) the bar: how far you are from the nearest police car, out of the mile it takes */if(L>0){const ld=Math.min(COP.lockD||0,COP_LOCK),k=COP.sightT>3?1:ld/COP_LOCK,w=u*2.6,h=u*.12;c.save();c.fillStyle='rgba(0,0,0,.5)';c.fillRect(W_*.5-w/2,y+r*1.8,w,h);c.fillStyle='#7dffb0';c.fillRect(W_*.5-w/2,y+r*1.8,w*k,h);c.textAlign='center';c.font='800 '+Math.round(u*.2)+'px '+UIF;c.fillStyle='rgba(255,255,255,.85)';c.fillText(COP.sightT>3?'LOSING THEM':'GET A MILE AWAY  ·  '+fmtLen(ld),W_*.5,y+r*1.8+h+u*.2);c.restore()}}
  /* where the chasing cops are when you cannot see them: a flashing marker along the top edge, left or right of the middle for the side they are on, at the ends if they are behind, with the distance */
  if(L>0){const cy=C.camYaw;let n=0;c.save();c.textAlign='center';c.font='800 '+Math.round(u*.22)+'px '+UIF;c.shadowColor='rgba(0,0,0,.8)';c.shadowBlur=4;
    for(const k of TR.cars){if(!k.alive||k.kind!==1||k.cm<1||k.cm>2||k.state===1||n>=4)continue;const dx=k.x-C.x,dz=k.z-C.z,d=Math.hypot(dx,dz);if(d>320)continue;const rel=angd(Math.atan2(dx,-dz),cy);if(Math.abs(rel)<.62&&d<260)continue;   /* in front of you: you can see it */
      const x=W_*.5+Math.max(-1,Math.min(1,rel/1.6))*W_*.4,y=u*1.55,fl=((C.t*6+n)|0)%2==0;n++;
      c.fillStyle=fl?'#ff4a3a':'#4a7aff';c.beginPath();const s=u*.2,beh=Math.abs(rel)>1.9;if(beh){c.moveTo(x-s,y-s*.7);c.lineTo(x+s,y-s*.7);c.lineTo(x,y+s*.8)}else if(rel>0){c.moveTo(x-s*.7,y-s);c.lineTo(x-s*.7,y+s);c.lineTo(x+s*.9,y)}else{c.moveTo(x+s*.7,y-s);c.lineTo(x+s*.7,y+s);c.lineTo(x-s*.9,y)}c.closePath();c.fill();
      c.fillStyle='#fff';c.fillText(fmtShort(d),x,y+u*.5)}c.restore()}
  if(COP.bust>.05){const k=Math.min(1,COP.bust/COP.D.bustT),w=u*3,h=u*.2,y=H_*.74;c.save();c.fillStyle='rgba(0,0,0,.55)';c.fillRect(W_*.5-w/2,y,w,h);c.fillStyle=((C.t*8)|0)%2?'#ff4a3a':'#4a7aff';c.fillRect(W_*.5-w/2,y,w*k,h);c.textAlign='center';c.font='800 '+Math.round(u*.26)+'px '+UIF;c.fillStyle='#fff';c.fillText('BUSTED?  keep moving!',W_*.5,y-u*.12);c.restore()}
  if(COP.spikeWarn>0){c.save();c.textAlign='center';c.font='800 '+Math.round(u*.3)+'px '+UIF;c.fillStyle='#ff8a3a';c.shadowColor='rgba(0,0,0,.8)';c.shadowBlur=5;c.fillText('SPIKE STRIP AHEAD',W_*.5,H_*.36);c.restore()}
  if(COP.warnT>0){c.save();c.textAlign='center';c.font='800 '+Math.round(u*.3)+'px '+UIF;c.fillStyle='#ffd24a';c.shadowColor='rgba(0,0,0,.8)';c.shadowBlur=5;c.fillText('ROADBLOCK AHEAD',W_*.5,H_*.3);c.restore()}}
