// Cops: patrols, heat, chase, boxing in and BUSTED, escape by losing them, roadblocks, ramming, garage clears heat, difficulty table. Uses the real traffic and real collisions.
// usage: node racer/tests/rcops.js
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:240,h:160,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
  /* a bot that drives the ring with pure pursuit at a set speed; helpers live in the page */
  await T.ev(()=>{const {C,IN,UI,TR}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;
    window.T3={ring:ROADS.find(q=>q.id=='ring'),reset(frac,spd){const r=T3.ring,n=r.n,i=Math.round(n*frac),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;TR.seedBase=20240601;trInit();copClear(true);dmgReset();GAME.state=0;GAME.lock=0;
        RACER.carPlace(r.X[i]+Math.cos(a)*5.5,r.Z[i]+Math.sin(a)*5.5,a,r.Y[i]+.5);C.vx=Math.sin(a)*spd;C.vz=-Math.cos(a)*spd;T3.idx=i;T3.spd=spd;T3.travelled=0},
      drive(){const r=T3.ring,n=r.n;let bi=T3.idx,bd=1e18;for(let k=-6;k<=30;k++){const i=((T3.idx+k)%n+n)%n,d=(r.X[i]-C.x)**2+(r.Z[i]-C.z)**2;if(d<bd){bd=d;bi=i}}T3.travelled+=((bi-T3.idx+n)%n)*r.ds;T3.idx=bi;
        const look=Math.max(6,C.speed*.7),ti=((bi+Math.round(look/r.ds))%n+n)%n,tj=(ti+1)%n,ta=Math.atan2(r.X[tj]-r.X[ti],-(r.Z[tj]-r.Z[ti])),tx=r.X[ti]+Math.cos(ta)*5.5,tz=r.Z[ti]+Math.sin(ta)*5.5;
        C.steer=Math.max(-1,Math.min(1,angd(Math.atan2(tx-C.x,-(tz-C.z)),C.yaw)*2.2));IN.thr=C.speed<T3.spd?1:0;IN.brk=C.speed>T3.spd+4?1:0}}});
  /* 1. heat levels */
  const H=await T.ev(()=>{COP.on=true;copSetDiff('forgiving');copClear(true);const out={};out.start=COP.heat;heatAdd(10);out.a=COP.heat;heatAdd(30);out.b=COP.heat;heatAdd(100);out.c=COP.heat;heatAdd(300);out.d=COP.heat;heatAdd(300);out.e=COP.heat;out.w=Math.round(COP.w);copClear(true);out.cleared=COP.heat;out.thr=COP.D.thr.join(',');return out});
  ok(H.start===0&&H.a===0&&H.b===1&&H.c===2&&H.d===4&&H.e===5&&H.cleared===0,'1 heat as crimes add up: 0 -> '+H.a+' -> '+H.b+' -> '+H.c+' -> '+H.d+' -> '+H.e+' (Forgiving thresholds '+H.thr+', events count 70 %), cleared '+H.cleared);
  /* 2. patrols at heat 0 */
  const P=await T.ev(()=>{T3.reset(.3,0);const x0=C.x,z0=C.z;let first=-1;const seenSpawn=[];
    let present=0,samples=0,maxN=0,bad=0;for(let s=0;s<120*90;s++){RACER.worldStep(1/120);C.x=C.px=x0;C.z=C.pz=z0;C.vx=C.vz=0;if(first<0&&COP.nP>0)first=TR.t;if(s%120==0&&s>120*10){samples++;if(COP.nP>0)present++;maxN=Math.max(maxN,COP.nP);for(const c of TR.cars)if(c.alive&&c.kind==1&&(c.cm!=0||c.siren||c.state!=0))bad++}}
    return{nP:maxN,first:+first.toFixed(1),frac:present/samples,bad,heat:COP.heat,want:COP.D.patrol}});
  ok(P.nP>=2&&P.frac>.5&&P.bad===0&&P.heat===0,'2 patrols at heat 0: a cop is around '+Math.round(P.frac*100)+' % of the time (up to '+P.nP+' at once, Forgiving wants '+P.want+'), first after '+P.first+' s, every one is a lights-off lane follower');
  /* 3. a chase on the ring */
  const C3=await T.ev(()=>{T3.reset(.3,30);heatAdd(200);const lvl=COP.heat;let minD=1e9,tFree=-1,tNear=-1,maxC=0,freeSeen=0,nan=0,sirenOn=0;const imp0=IMP.n;let ramHit=0;
    for(let s=0;s<120*80;s++){T3.drive();RACER.worldStep(1/120);if(!isFinite(C.x+C.z))nan++;if(s%60==0){const ch=TR.cars.filter(c=>c.alive&&c.kind==1&&c.cm>=1);maxC=Math.max(maxC,ch.length);for(const c of ch){const d=Math.hypot(c.x-C.x,c.z-C.z);if(d<minD)minD=d;if(c.state==3)freeSeen++;if(c.siren)sirenOn=1;if(!isFinite(c.x+c.z+c.y))nan++}if(tNear<0&&minD<25)tNear=TR.t;if(tFree<0&&freeSeen)tFree=TR.t}}
    return{lvl,maxC,minD:+minD.toFixed(1),tNear:+tNear.toFixed(1),tFree:+tFree.toFixed(1),want:COP.D.chaseN[lvl],nan,sirenOn,dist:Math.round(T3.travelled),heatNow:COP.heat,impacts:IMP.n-imp0,hp:+DMG.hp.toFixed(2)}});
  ok(C3.maxC>=C3.want&&C3.sirenOn,'3 chase at heat '+C3.lvl+': '+C3.maxC+' chasing cops (wanted '+C3.want+'), lights and siren on');
  ok(C3.minD<25&&C3.tFree>0,'3 they catch up with a player doing 30 m/s: closest '+C3.minD+' m after '+C3.tNear+' s, free pursuit began after '+C3.tFree+' s; player drove '+C3.dist+' m, took '+C3.impacts+' impacts, health '+C3.hp);
  ok(C3.nan===0,'3 no NaN in 80 s of chase');
  /* 4. boxed in: the player stops, cops come, BUSTED, back at the garage */
  const B=await T.ev(()=>{T3.reset(.3,0);const x0=C.x,z0=C.z;heatAdd(200);IN.thr=0;IN.brk=0;let bustAt=-1,maxBust=0,near=0;const t0=TR.t;
    for(let s=0;s<120*90&&GAME.state==0;s++){IN.thr=0;IN.brk=0;RACER.worldStep(1/120);C.x=C.px=x0;C.z=C.pz=z0;C.vx=C.vz=0;maxBust=Math.max(maxBust,COP.bust);if(COP.bust>0&&bustAt<0)bustAt=TR.t-t0}
    const st=GAME.state;const msg=GAME.msg;for(let s=0;s<120*5;s++)RACER.worldStep(1/120);
    const home=SAFE.pads.find(q=>q.id=='home');return{st,msg,bustStart:+bustAt.toFixed(1),maxBust:+maxBust.toFixed(1),after:GAME.state,heat:COP.heat,chasers:TR.cars.filter(c=>c.alive&&c.kind==1&&c.cm>=1).length,dist:+Math.hypot(C.x-home.pad.x,C.z-home.pad.z).toFixed(1),need:COP.D.bustT}});
  ok(B.st===2,'4 parked with the heat on: cops box you in (bust meter began after '+B.bustStart+' s, reached '+B.maxBust+' of '+B.need+' s) -> '+B.msg);
  ok(B.after===0&&B.heat===0&&B.chasers===0&&B.dist<8,'4 afterwards: playing again, heat '+B.heat+', chasers '+B.chasers+', car on the Home Garage pad ('+B.dist+' m from its centre)');
  /* 5. escape: with no chaser within reach and none in sight, the heat cools down after loseT seconds (the rule: more than loseD from every chaser, out of sight for loseT) */
  const E=await T.ev(()=>{T3.reset(.3,62);heatAdd(95);const l0=COP.heat;let tZero=-1,heatAt5=-1;const t0=TR.t;
    for(let s=0;s<120*45;s++){COP.spawnT=999;for(const c of TR.cars)if(c.alive&&c.kind==1)trKill(c,0);T3.drive();RACER.worldStep(1/120);if(s==120*5)heatAt5=COP.heat;if(tZero<0&&COP.heat===0)tZero=TR.t-t0}
    COP.spawnT=1;return{l0,heatAt5,tZero:+tZero.toFixed(1),loseT:COP.D.loseT}});
  ok(E.heatAt5>=E.l0&&E.tZero>E.loseT-1&&E.tZero<E.loseT+16,'5 escape: from heat '+E.l0+' with no chaser in reach or in sight the heat holds for the first seconds ('+E.heatAt5+' after 5 s) and is gone after '+E.tZero+' s (loseT is '+E.loseT+' s)');
  /* 6. roadblock at heat 5 and a ram */
  const R=await T.ev(()=>{T3.reset(.3,34);heatAdd(900);let blocks=0,tBlock=-1,rams=0,maxHeat=COP.heat;const imp0=IMP.n;let ramImp=0;const t0=TR.t;
    for(let s=0;s<120*100;s++){T3.drive();RACER.worldStep(1/120);if(s%120==0){const nb=TR.cars.filter(c=>c.alive&&c.cm==3).length;if(nb>blocks){blocks=nb;if(tBlock<0)tBlock=TR.t-t0}}
      if(GAME.state)break}
    const bl=TR.cars.filter(c=>c.alive&&c.cm==3);const imp=IMP.q.filter(r=>r.src==3).length;return{blocks,tBlock:+tBlock.toFixed(1),heat:maxHeat,gap:COP.D.rbGap,state:GAME.state,hits:TR.stat.hits,t:+(TR.t-t0).toFixed(0)}});
  ok(R.blocks>=2,'6 roadblock at heat '+R.heat+': '+R.blocks+' cop cars across the road after '+R.tBlock+' s (gap '+R.gap+' m on Forgiving)');
  /* 7. ramming: at the ramLevel a cop rams the player's rear quarter */
  const M=await T.ev(()=>{copSetDiff('medium');T3.reset(.3,22);heatAdd(300);let hits=0,first=-1,eMax=0,zone=null;const imp0=IMP.n,dmg0=DMG.total;const t0=TR.t;
    for(let s=0;s<120*60&&!GAME.state;s++){T3.drive();RACER.worldStep(1/120);if(IMP.n>imp0){for(const r of IMP.q)if(r.src==3&&r.E>eMax){eMax=r.E;zone=r.zone;if(first<0)first=TR.t-t0}}}
    const out={eMax:Math.round(eMax/1000),zone,first:+first.toFixed(1),dmg:Math.round((DMG.total-dmg0)/1000),hits:TR.stat.hits,heat:COP.heat,state:GAME.state,ramLevel:COP.D.ramLevel};copSetDiff('forgiving');return out});
  ok(M.eMax>5&&M.hits>0,'7 Medium (ram from heat '+M.ramLevel+'): cops hit the player '+M.hits+' times, biggest '+M.eMax+' kJ on zone '+M.zone+', total damage '+M.dmg+' kJ, first after '+M.first+' s');
  /* 8. a garage clears the heat */
  const G=await T.ev(()=>{const s=SAFE.pads.find(q=>q.id=='home');T3.reset(.3,0);RACER.carPlace(s.pad.x,s.pad.z,s.yaw,s.y+.4);heatAdd(150);const h0=COP.heat;DMG.z[1]=.4;dmgEffects();SAFE.visit=null;SAFE.svc=0;
    for(let k=0;k<120*5;k++){IN.thr=0;IN.brk=1;RACER.worldStep(1/120)}return{h0,h:COP.heat,rear:DMG.z[1],msg:SAFE.msg,chasers:TR.cars.filter(c=>c.alive&&c.kind==1&&c.cm>=1).length}});
  ok(G.h0>=2&&G.h===0&&G.rear===0&&G.chasers===0,'8 parking on a garage pad at heat '+G.h0+': heat '+G.h+', car repaired, chasers '+G.chasers+' ("'+G.msg+'")');
  /* 9. difficulty table */
  const D=await T.ev(()=>{const o={};for(const k of Object.keys(COPD)){copSetDiff(k);o[k]=[COP.D.name,COP.D.top,COP.D.chaseN.join(','),COP.D.ramLevel,COP.D.blockLevel,COP.D.bustT].join('|')}copSetDiff('forgiving');o.cur=COP.diff;return o});
  ok(D.cur=='forgiving'&&Object.keys(D).length==4,'9 difficulty table: '+JSON.stringify({forgiving:D.forgiving,medium:D.medium,hard:D.hard}));
  const perf=await T.ev(()=>({ms:+TR.ms.toFixed(3),alive:TR.nAlive}));console.log('traffic+cops tick '+perf.ms+' ms with '+perf.alive+' cars');
  console.log('errs',T.errs);ok(T.errs.length==0,'no page errors');await T.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
