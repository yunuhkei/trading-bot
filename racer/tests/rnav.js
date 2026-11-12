// Navigation: route finding on the lane graph, the touchable map (pan, pinch, tap, set a waypoint), the path on the road, and the cops' new rules and persistence.
// usage: node racer/tests/rnav.js
const L=require('./rlib.js');
let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.4&fixed=1',w:667,h:375,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  const ev=T.ev;
  await ev(()=>{RACER.UI.paused=true;window.placeOn=(id,f,spd)=>{const {C,ROADS}=RACER;const r=ROADS.find(q=>q.id==id),i=Math.max(2,Math.min(r.n-4,Math.round(f*r.n))),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));RACER.carPlace(r.X[i]+Math.cos(a)*(r.hw*.35),r.Z[i]+Math.sin(a)*(r.hw*.35),a,r.Y[i]+.5);C.vx=Math.sin(a)*(spd||0);C.vz=-Math.cos(a)*(spd||0);RACER.camStep(0,true);return[r.X[i],r.Z[i]]}});
  /* ---- 1 routes ---- */
  const pairs=[['ring',.3,'sfnu3',.45],['sfnu3',.4,'mp',.5],['mp',.2,'btp',.5],['ring',.8,'cyr',.5],['eh',.5,'bv',.3],['nh1',.4,'sh3',.4],['tp',.3,'ring',.1],['mh',.5,'ring',.6],['sh',.3,'mojp',.5],['cr',.3,'sfnv3',.5],['ring',.5,'ring',.55],['cyr',.9,'nh2',.5]];
  const rts=await ev(pairs=>{const {NAV,ROADS,C}=RACER;const out=[];for(const [a,fa,b,fb] of pairs){placeOn(a,fa,0);const rb=ROADS.find(q=>q.id==b);if(!rb){out.push({a,b,miss:1});continue}const gi=Math.round(fb*rb.n);const t0=performance.now();const res=navSet(rb.X[gi],rb.Z[gi]);const ms=performance.now()-t0;
      if(!res.ok){out.push({a,b,ok:0,msg:res.msg});continue}const R=NAV.route,p=R.pts;let maxGap=0,nan=0;for(let i=0;i<R.n;i++){if(!isFinite(p[i*3])||!isFinite(p[i*3+2]))nan++;if(i)maxGap=Math.max(maxGap,Math.hypot(p[i*3]-p[i*3-3],p[i*3+2]-p[i*3-1]))}
      const straight=Math.hypot(NAV.wp.x-C.x,NAV.wp.z-C.z);out.push({a,b,ok:1,len:R.len,straight,startD:Math.hypot(p[0]-C.x,p[2]-C.z),endD:Math.hypot(p[(R.n-1)*3]-NAV.wp.x,p[(R.n-1)*3+2]-NAV.wp.z),maxGap,nan,ms,n:R.n});navClear()}return out},pairs);
  const good=rts.filter(r=>r.ok);ok(good.length==rts.length,'routes found for all '+rts.length+' start/goal pairs across the whole map ('+good.length+' ok)');
  ok(good.every(r=>r.nan==0&&r.maxGap<14&&r.startD<20&&r.endD<14),'every route is continuous (largest gap '+Math.max(...good.map(r=>r.maxGap)).toFixed(1)+' m), starts at the car (<= '+Math.max(...good.map(r=>r.startD)).toFixed(1)+' m) and ends at the waypoint (<= '+Math.max(...good.map(r=>r.endD)).toFixed(1)+' m)');
  ok(good.every(r=>r.len>=r.straight-6&&r.len<r.straight*7+400),'route lengths are sane (never shorter than the straight line, at most 7x): '+good.map(r=>(r.len/1000).toFixed(1)+'/'+(r.straight/1000).toFixed(1)).join(' km, ')+' km');
  ok(Math.max(...good.map(r=>r.ms))<80,'finding a route takes '+Math.max(...good.map(r=>r.ms)).toFixed(0)+' ms at most ('+Math.round(good.reduce((s,r)=>s+r.ms,0)/good.length)+' ms on average)');
  /* ---- 2 following a route: progress, arriving, rerouting after a wrong turn ---- */
  const fol=await ev(()=>{const {NAV,C,ROADS}=RACER;placeOn('ring',.3,25);const rb=ROADS.find(q=>q.id=='sfnu3'),gi=Math.round(.45*rb.n);navSet(rb.X[gi],rb.Z[gi]);const R0=NAV.route,len0=R0.len;let prev=0,mono=true,steps=0,arrived=false;
    /* the car is carried along the route (a point every 12 m) */
    for(let s=0;s<R0.len&&steps<2000;s+=12,steps++){let k=0;while(k<R0.n-1&&R0.S[k]<s)k++;const x=R0.pts[k*3],z=R0.pts[k*3+2],y=R0.pts[k*3+1],nx=R0.pts[Math.min(R0.n-1,k+1)*3],nz=R0.pts[Math.min(R0.n-1,k+1)*3+2];
      C.x=C.px=x;C.z=C.pz=z;C.y=C.py=y+.3;C.yaw=C.pyaw=Math.atan2(nx-x,-(nz-z));C.vx=Math.sin(C.yaw)*25;C.vz=-Math.cos(C.yaw)*25;navUpdate(.25);if(NAV.wp&&NAV.route===R0){if(NAV.prog<prev-1)mono=false;prev=NAV.prog}if(!NAV.wp){arrived=true;break}}
    return{len0,mono,arrived,steps,prog:prev}});
  ok(fol.mono&&fol.prog>fol.len0/4/2,'while you drive along the route the progress only moves forward ('+fol.steps+' steps over '+(fol.len0/1000).toFixed(1)+' km)');
  ok(fol.arrived,'reaching the waypoint clears it ("You have arrived")');
  const rer=await ev(()=>{const {NAV,C,ROADS}=RACER;placeOn('ring',.3,25);const rb=ROADS.find(q=>q.id=='sfnu3'),gi=Math.round(.45*rb.n);navSet(rb.X[gi],rb.Z[gi]);const R0=NAV.route;
    /* a wrong turn: carried onto another road, well off the route */placeOn('eh',.5,25);for(let k=0;k<30;k++)navUpdate(.2);const R1=NAV.route;return{changed:R1!==R0&&!!NAV.wp,startD:R1?Math.hypot(R1.pts[0]-C.x,R1.pts[2]-C.z):-1,off:NAV.off}});
  ok(rer.changed&&rer.startD<25,'leaving the route (wrong turn) makes a new route from where you are (starts '+rer.startD.toFixed(1)+' m from the car)');
  /* ---- 3 the touchable map ---- */
  const mp=await ev(()=>{const {NAV,MAPV,UI,C,ROADS}=RACER;navClear();placeOn('ring',.3,0);UI.paused=false;mapOpenNow();hudDraw();const out={};const k0=MAPV.k,x0=MAPV.x,z0=MAPV.z;out.open=UI.mapOpen;
    /* drag */mapDown('a',300,200);mapMove('a',240,170);mapMove('a',180,140);mapUp('a');out.dragMoved=Math.hypot(MAPV.x-x0,MAPV.z-z0);
    /* pinch out (fingers move apart) */const k1=MAPV.k;mapDown('a',280,190);mapDown('b',380,190);mapMove('b',480,190);mapMove('a',180,190);mapUp('a');mapUp('b');out.pinch=MAPV.k/k1;
    /* limits */for(let i=0;i<60;i++)mapWheel(333,187,-1);out.maxK=MAPV.k<=MAPV.kMax+1e-9;for(let i=0;i<120;i++)mapWheel(333,187,1);out.minK=MAPV.k>=MAPV.k0-1e-9;
    /* tap on a road: take a road point, find where it is on screen, tap there */
    MAPV.k=MAPV.k0*2.4;MAPV.x=C.x;MAPV.z=C.z;const S=UI.mapCv.width,pxm=S/RACER.W.size,rb=ROADS.find(q=>q.id=='ring'),i=Math.round(.45*rb.n),sx=(rb.X[i]-MAPV.x)*pxm*MAPV.k+UI.w/2,sy=(rb.Z[i]-MAPV.z)*pxm*MAPV.k+UI.h/2;
    if(sx>0&&sx<UI.w&&sy>0&&sy<UI.h){mapDown('t',sx,sy);mapUp('t');out.pend=!!NAV.pend;out.pendNear=NAV.pend?Math.hypot(NAV.pend.x-rb.X[i],NAV.pend.z-rb.Z[i]):-1}else{out.offscreen=1}
    /* tap on empty ground far from any road: no pin, a hint */NAV.pend=null;mapDown('u',20,20);mapUp('u');out.pend2=!!NAV.pend;
    return out});
  ok(mp.open&&mp.dragMoved>0,'the world map opens and dragging moves it ('+mp.dragMoved.toFixed(0)+' m)');
  ok(mp.pinch>1.3,'pinching out zooms in ('+mp.pinch.toFixed(2)+'x), and the zoom stops at both ends ('+mp.maxK+', '+mp.minK+')');
  ok(mp.maxK&&mp.minK,'zoom limits hold (in and out)');
  if(!mp.offscreen){ok(mp.pend&&mp.pendNear<80,'tapping a road drops a pin on it ('+mp.pendNear.toFixed(0)+' m from where it was tapped)')}
  const set=await ev(()=>{const {NAV,MAPV,UI,C,ROADS}=RACER;const rb=ROADS.find(q=>q.id=='sfnu3'),i=Math.round(.45*rb.n);NAV.pend={x:rb.X[i],z:rb.Z[i]};hudDraw();const b=MAPV.btns.find(q=>q.label=='SET WAYPOINT');const r={hasBtn:!!b};if(b){mapDown('s',b.x+4,b.y+4);mapUp('s');r.wp=!!NAV.wp;r.closed=!UI.mapOpen;r.len=NAV.route?NAV.route.len:0}
    /* the path is drawn on the road and the HUD and minimap show it */
    const {R,G}=RACER;RACER.renderOnce(UI.cw,UI.ch);r.err=G.gl.getError();r.fxN=R.fxN;hudDraw();r.hud=1;
    mapOpenNow();hudDraw();const cb=MAPV.btns.find(q=>q.label=='CLEAR WAYPOINT');r.clearBtn=!!cb;if(cb){mapDown('c',cb.x+4,cb.y+4);mapUp('c');r.cleared=!NAV.wp}UI.mapOpen=false;return r});
  ok(set.hasBtn&&set.wp&&set.closed&&set.len>1000,'SET WAYPOINT makes the route ('+(set.len/1000).toFixed(1)+' km), closes the map and drives on');
  ok(set.err==0&&set.fxN>20,'the path is drawn on the road (no GL error, '+set.fxN+' quads in the effects pass)');
  ok(set.clearBtn&&set.cleared,'CLEAR WAYPOINT removes it');
  /* ---- 4 the cops: what gets you chased ---- */
  const cp=await ev(()=>{const {C,IN,TR,COP,GAME,LG,ROADS}=RACER;const out={};COP.on=true;copSetDiff('forgiving');UI.paused=true;
    const mkCop=(d)=>{const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw);let c=null;for(let k=0;k<TR.cars.length;k++){const q=TR.cars[k];if(!q.alive){c=q;break}}if(!c){return null}
      c.alive=1;TR.nAlive++;c.dmg=0;c.dn=null;c.type=4;c.kind=1;c.cm=0;c.siren=0;c.state=0;c.m=1600;c.I=1600*(2.25*2.25+.9*.9)/3;c.hl=2.25;c.hw=.9;c.px=c.x=C.x+fx*d+Math.cos(C.yaw)*-4;c.pz=c.z=C.z+fz*d+Math.sin(C.yaw)*-4;c.py=c.y=C.y;c.yaw=c.pyaw=C.yaw+Math.PI;c.v=15;c.clk=-99;c.los=true;return c};
    const clearCivs=(except)=>{for(const c of TR.cars)if(c.alive&&c.kind==0&&c!==except)trKill(c,0)};
    const reset=(spd)=>{GAME.state=0;GAME.lock=0;dmgReset();copClear(true);COP.spawnT=99;placeOn('ring',.3,spd);for(const c of TR.cars)if(c.alive&&c.kind==1)trKill(c,0);clearCivs()};
    const tick=(n)=>{for(let s=0;s<n;s++){C.vx=Math.sin(C.yaw)*C.speed0;C.vz=-Math.cos(C.yaw)*C.speed0;if(!(s%20))clearCivs(window.__keep);RACER.worldStep(1/120)}};
    /* a patrol car coming the other way on the other carriageway, 120 m ahead */
    const oncoming=(d)=>{const sn=navSnap(C.x,C.z,30),r=ROADS.find(q=>q.id=='ring'),ri=ROADS.indexOf(r),e=LG.ofRoad[ri][1][0],u=Math.max(4,Math.min(e.n-8,e.n-1-(sn.i+Math.round(d/r.ds))));const c=trPlace(e,u,4,12,12,12345);if(c){c.kind=1;c.cm=0;c.siren=0;c.clk=-99;c.los=true}return c};
    /* a: blowing past a cop at 110 mph (49 m/s) is nothing; at 125 mph (56 m/s) you are chased */
    reset(49);C.speed0=49;let cop=oncoming(120);out.placed=!!cop;tick(400);out.slow=COP.heat;
    reset(56);C.speed0=56;cop=oncoming(120);tick(400);out.fast=COP.heat;
    /* b: speeding far from any cop is no crime */
    reset(60);C.speed0=60;for(const c of TR.cars)if(c.alive&&c.kind==1)trKill(c,0);COP.spawnT=99;tick(600);out.alone=COP.heat;
    /* c: a crash into another car */
    reset(0);C.speed0=0;const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw);let npc=null;for(const q of TR.cars)if(!q.alive){npc=q;break}
    if(npc){npc.alive=1;TR.nAlive++;npc.kind=0;npc.cm=0;npc.type=0;npc.state=1;npc.dmg=0;npc.dn=null;npc.vx=npc.vz=npc.om=0;npc.v=0;npc.m=1300;npc.I=1300*(TTYPES[0].hl**2+TTYPES[0].hw**2)/3;npc.wt=0;npc.rec=0;npc.hl=TTYPES[0].hl;npc.hw=TTYPES[0].hw;npc.px=npc.x=C.x+fx*5.2;npc.pz=npc.z=C.z+fz*5.2;npc.py=npc.y=C.y;npc.yaw=npc.pyaw=C.yaw;C.vx=fx*20;C.vz=fz*20;COP.spawnT=99;for(let s=0;s<80;s++){RACER.worldStep(1/120)}}
    out.crash=COP.heat;out.crashDmg=npc?(npc.dmg||0):-1;
    /* d: hitting a cop car */
    reset(0);C.speed0=0;cop=mkCop(5.4);if(cop){cop.state=1;cop.v=0;cop.vx=cop.vz=cop.om=0;cop.yaw=cop.pyaw=C.yaw;cop.px=cop.x=C.x+fx*5.2;cop.pz=cop.z=C.z+fz*5.2;C.vx=fx*20;C.vz=fz*20;COP.spawnT=99;for(let s=0;s<80;s++){RACER.worldStep(1/120)}}
    out.copHit=COP.heat;
    copClear(true);return out});
  ok(cp.placed&&cp.slow===0&&cp.fast>=1,'passing a cop at 110 mph is nothing (heat '+cp.slow+'), at 125 mph you are wanted (heat '+cp.fast+': one star since batch 3)');
  ok(cp.alone===0,'speeding at 60 m/s with no cop near is no crime (heat '+cp.alone+')');
  ok(cp.crash>=1&&cp.crashDmg>0,'crashing into another car gets you chased (heat '+cp.crash+') and damages it (damage '+cp.crashDmg.toFixed(2)+')');
  ok(cp.copHit>=2,'hitting a cop car is a big crime (heat '+cp.copHit+': two stars at once)');
  /* ---- 5 the chase does not give up ---- */
  const ch=await ev(()=>{const {C,IN,TR,COP,ROADS}=RACER;copSetDiff('forgiving');GAME.state=0;GAME.lock=0;dmgReset();copClear(true);COP.spawnT=0;for(const c of TR.cars)if(c.alive&&c.kind==1)trKill(c,0);
    const ring=ROADS.find(q=>q.id=='ring'),n=ring.n;placeOn('ring',.3,60);let idx=Math.round(.3*n);
    copTrigger(3);const h0=COP.heat;let near=0,tot=0,minD=1e9,maxHeat=0,heat0=0,catchT=-1,lostChasers=0,heatDrops=0,t=0,endedAt=-1;const dt=1/120;
    /* a pure-pursuit bot drives the ring at 60 m/s for 60 s, then slows to 35 m/s */
    for(let s=0;s<120*100;s++){const spd=s<120*60?60:35;let bi=idx,bd=1e18;for(let k=-6;k<=30;k++){const i=((idx+k)%n+n)%n,d=(ring.X[i]-C.x)**2+(ring.Z[i]-C.z)**2;if(d<bd){bd=d;bi=i}}idx=bi;
      const look=Math.max(6,C.speed*.7),ti=((bi+Math.round(look/ring.ds))%n+n)%n,tj=(ti+1)%n,ta=Math.atan2(ring.X[tj]-ring.X[ti],-(ring.Z[tj]-ring.Z[ti])),tx=ring.X[ti]+Math.cos(ta)*5.5,tz=ring.Z[ti]+Math.sin(ta)*5.5;
      C.steer=Math.max(-1,Math.min(1,angd(Math.atan2(tx-C.x,-(tz-C.z)),C.yaw)*2.2));IN.thr=C.speed<spd?1:0;IN.brk=C.speed>spd+4?1:0;if(!(s%30))for(const c of TR.cars)if(c.alive&&c.kind==0)trKill(c,0);RACER.worldStep(1/120);   /* no civilians: this test is about the cops, and a crash at 60 m/s would end the run */
      if(GAME.state&&endedAt<0)endedAt=t;                   /* the cops can wreck or bust a bot that never swerves: from then on the run is over and the heat is cleared on purpose */
      if(s%60==0&&endedAt<0){let md=1e9,nc=0;for(const c of TR.cars)if(c.alive&&c.kind==1&&c.cm>0&&c.state!=1){nc++;md=Math.min(md,Math.hypot(c.x-C.x,c.z-C.z))}tot++;if(md<300)near++;minD=Math.min(minD,md);maxHeat=Math.max(maxHeat,COP.heat);if(COP.heat<h0)heatDrops++;
        if(s>=120*60&&catchT<0&&md<25)catchT=t;if(nc==0)lostChasers++}
      t+=dt}
    return{h0,near,tot,minD,lost:lostChasers,drops:heatDrops,catchT,heat:COP.heat,speed:C.speed,endedAt}});
  ok(ch.drops==0&&ch.lost<=4&&ch.near/ch.tot>.75,'a chase at 60 m/s for 100 s: the cops stay on you (within 300 m in '+Math.round(ch.near/ch.tot*100)+' % of the samples, never without a chaser for more than '+ch.lost+' s) and the heat never drops (stars '+ch.h0+' -> '+ch.heat+')'+(ch.endedAt>=0?'; the bot, which never swerves, was wrecked or busted by the cops after '+ch.endedAt.toFixed(0)+' s':''));
  ok(ch.catchT>=0||ch.minD<30||ch.endedAt>=0,'and when you slow down they catch you (closest '+ch.minD.toFixed(0)+' m'+(ch.catchT>=0?', within 25 m '+(ch.catchT-60).toFixed(0)+' s after slowing':'')+')');
  console.log('errs',T.errs.slice(0,4));ok(T.errs.length==0,'no page errors');
  await T.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
