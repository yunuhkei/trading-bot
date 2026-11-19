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
  const P=await T.ev(()=>{T3.reset(.3,0);{const r=ROADS.find(q=>q.id=='sfnu3'),i=Math.round(r.n*.5),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));RACER.carPlace(r.X[i]+Math.cos(a)*(r.hw+2),r.Z[i]+Math.sin(a)*(r.hw+2),a,r.Y[i]+.5)}const x0=C.x,z0=C.z;   /* downtown: since batch 9 there are no patrols on the country highways */let first=-1;const seenSpawn=[];
    let present=0,samples=0,maxN=0,bad=0;for(let s=0;s<120*150;s++){RACER.worldStep(1/120);C.x=C.px=x0;C.z=C.pz=z0;C.vx=C.vz=0;if(first<0&&COP.nP>0)first=TR.t;if(s%120==0&&s>120*10){samples++;if(COP.nP>0)present++;maxN=Math.max(maxN,COP.nP);for(const c of TR.cars)if(c.alive&&c.kind==1&&(c.cm!=0||c.siren||c.state!=0))bad++}}
    return{nP:maxN,first:+first.toFixed(1),frac:present/samples,bad,heat:COP.heat,want:COP.D.patrol}});
  ok(P.nP>=1&&P.nP<=P.want&&P.bad===0&&P.heat===0,'2 patrols at heat 0 are rare: never more than '+P.nP+' at once (Forgiving allows '+P.want+', a new one at most every 110 s, none on country highways), one is around '+Math.round(P.frac*100)+' % of the time, first after '+P.first+' s, every one is a lights-off lane follower');
  /* 3. a chase on the ring */
  const C3=await T.ev(()=>{T3.reset(.3,30);heatAdd(200);const lvl=COP.heat;let minD=1e9,tFree=-1,tNear=-1,maxC=0,freeSeen=0,nan=0,sirenOn=0;const imp0=IMP.n;let ramHit=0;const over=[];let maxLive=0;
    for(let s=0;s<120*80;s++){T3.drive();RACER.worldStep(1/120);if(!isFinite(C.x+C.z))nan++;if(s%60==0){const ch=TR.cars.filter(c=>c.alive&&c.kind==1&&c.cm>=1);maxC=Math.max(maxC,ch.length);const wN=COP.D.chaseN[COP.heat]+(COP_SWAT[COP.heat]||0);{const live=ch.filter(c=>c.cm!=3&&c.state!=1).length;maxLive=Math.max(maxLive,live);if(live>wN)over.push(COP.heat+':'+live+'/'+wN)}for(const c of ch){const d=Math.hypot(c.x-C.x,c.z-C.z);if(d<minD)minD=d;if(c.state==3)freeSeen++;if(c.siren)sirenOn=1;if(!isFinite(c.x+c.z+c.y))nan++}if(tNear<0&&minD<25)tNear=TR.t;if(tFree<0&&freeSeen)tFree=TR.t}}
    return{lvl,maxC,minD:+minD.toFixed(1),tNear:+tNear.toFixed(1),tFree:+tFree.toFixed(1),want:COP.D.chaseN[lvl],nan,sirenOn,dist:Math.round(T3.travelled),heatNow:COP.heat,impacts:IMP.n-imp0,hp:+DMG.hp.toFixed(2),over:over.slice(0,8),maxLive}});
  ok(C3.maxLive>=C3.want&&!C3.over.length&&C3.sirenOn,'3 chase at heat '+C3.lvl+': at most '+C3.maxLive+' working police cars chasing at once (wanted '+C3.want+'; never more than the stars allow'+(C3.over.length?', OVER: '+C3.over.join(' '):'')+'), lights and siren on');
  ok(C3.minD<25&&C3.tFree>0,'3 they catch up with a player doing 30 m/s: closest '+C3.minD+' m after '+C3.tNear+' s, free pursuit began after '+C3.tFree+' s; player drove '+C3.dist+' m, took '+C3.impacts+' impacts, health '+C3.hp);
  ok(C3.nan===0,'3 no NaN in 80 s of chase');
  /* 4. boxed in: the player stops, cops come, BUSTED, back at the garage */
  const B=await T.ev(()=>{T3.reset(.3,0);const x0=C.x,z0=C.z;heatAdd(200);IN.thr=0;IN.brk=0;let bustAt=-1,maxBust=0,near=0;const t0=TR.t;
    for(let s=0;s<120*90&&GAME.state==0;s++){IN.thr=0;IN.brk=0;RACER.worldStep(1/120);C.x=C.px=x0;C.z=C.pz=z0;C.vx=C.vz=0;maxBust=Math.max(maxBust,COP.bust);if(COP.bust>0&&bustAt<0)bustAt=TR.t-t0}
    const st=GAME.state;const msg=GAME.msg;for(let s=0;s<120*5;s++)RACER.worldStep(1/120);
    const home=SAFE.pads.find(q=>q.id=='home');return{st,msg,bustStart:+bustAt.toFixed(1),maxBust:+maxBust.toFixed(1),after:GAME.state,heat:COP.heat,chasers:TR.cars.filter(c=>c.alive&&c.kind==1&&c.cm>=1).length,dist:+Math.hypot(C.x-home.pad.x,C.z-home.pad.z).toFixed(1),need:COP.D.bustT}});
  ok(B.st===2,'4 parked with the heat on: cops box you in (bust meter began after '+B.bustStart+' s, reached '+B.maxBust+' of '+B.need+' s) -> '+B.msg);
  ok(B.after===0&&B.heat===0&&B.chasers===0&&B.dist<8,'4 afterwards: playing again, heat '+B.heat+', chasers '+B.chasers+', car on the Home Garage pad ('+B.dist+' m from its centre)');
  /* 5. escape (batch 67): they only know where you are while a police car can see you (or within 60 m of you); out of their sight the heat holds for 7-9 s, then fades */
  const E=await T.ev(()=>{T3.reset(.3,0);heatAdd(95);const l0=COP.heat;const c=trSpawnCop(true,false);let held=1;
    /* a chaser kept 40 m away (frozen there): it knows where you are */
    for(let s=0;s<120*12;s++){COP.spawnT=999;if(c&&c.alive){c.x=c.px=C.x+40;c.z=c.pz=C.z;c.v=0}C.vx=C.vz=0;RACER.worldStep(1/120);if(COP.heat<l0)held=0}
    const lockAt12=COP.sightT;
    /* now 1.2 km away, out of sight: lost */
    COP.callT=30;   /* the crime itself was long ago */
    let tZero=-1,tDrop=-1;for(let s=0;s<120*40;s++){COP.spawnT=999;if(c&&c.alive){c.x=c.px=C.x+1200;c.z=c.pz=C.z;c.v=0}C.vx=C.vz=0;RACER.worldStep(1/120);if(tDrop<0&&COP.heat<l0)tDrop=s/120;if(tZero<0&&COP.heat===0){tZero=s/120;break}}
    COP.spawnT=1;return{l0,held,lockAt12:+lockAt12.toFixed(2),tZero:+tZero.toFixed(1),tDrop:+tDrop.toFixed(1),c:!!c}});
  ok(E.c&&E.held&&E.lockAt12<.1,'5 heat '+E.l0+' with a chaser 40 m away: they know where you are after 12 s (heat held)');
  ok(E.tDrop>5&&E.tZero>E.tDrop&&E.tZero<25,'5 the only chaser 1.2 km away, out of sight: the heat starts to fade after '+E.tDrop+' s and is gone after '+E.tZero+' s');
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
  ok(D.cur=='forgiving'&&Object.keys(D).length==5,'9 difficulty table (batch 63: + brutal, the HARD setting\'s police): '+JSON.stringify({forgiving:D.forgiving,medium:D.medium,hard:D.hard,brutal:D.brutal}));
  /* 10. (batch 69) the cap: chasers you leave behind are not replaced; once they have lost you, nobody turns up outside the half-mile search area */
  const Z=await T.ev(()=>{copSetDiff('medium');T3.reset(.3,30);const t=COP.D.thr,pin=()=>{copCall();COP.heat=3;COP.w=t[3]+20;COP.sightT=0;COP.bust=0};pin();const want=COP.D.chaseN[3];let maxC=0;
    const chasers=()=>TR.cars.filter(c=>c.alive&&c.kind==1&&c.cm>=1&&c.cm!=3&&c.state!=1);
    for(let s=0;s<120*60&&maxC<want;s++){pin();T3.drive();RACER.worldStep(1/120);maxC=Math.max(maxC,chasers().length)}
    /* leave them all behind: a mile back */
    for(const c of chasers()){c.x=c.px=C.x+1500;c.z=c.pz=C.z;c.v=0;c.vx=c.vz=0}const seed0=new Set(TR.cars.filter(c=>c.alive).map(c=>c.seed));
    let fresh=0;for(let s=0;s<120*30;s++){pin();T3.drive();RACER.worldStep(1/120);fresh=Math.max(fresh,chasers().filter(c=>!seed0.has(c.seed)).length)}
    const gone=COP.gone;
    /* the search area: they last saw you here; you are 700 m away and unseen */
    copClear(true);T3.reset(.3,0);pin();COP.lkx=C.x;COP.lkz=C.z;for(const c of TR.cars)if(c.alive&&c.kind==1)trKill(c,0);
    const r=T3.ring,k=(T3.ring.n+Math.round(700/r.ds)+Math.round(r.n*.3))%r.n;RACER.carPlace(r.X[k],r.Z[k],0,r.Y[k]+.5);C.vx=C.vz=0;COP.callT=30;COP.sightT=1.5;
    let spawnedOut=0,tFade=-1;const h0=COP.heat;for(let s=0;s<120*25;s++){C.vx=C.vz=0;RACER.worldStep(1/120);spawnedOut=Math.max(spawnedOut,chasers().length);if(tFade<0&&COP.heat<h0)tFade=s/120}
    copSetDiff('forgiving');copClear(true);return{want,maxC,fresh,gone,spawnedOut,tFade:+tFade.toFixed(1),dz:Math.round(Math.hypot(C.x-COP.lkx,C.z-COP.lkz)),h0}});
  ok(Z.maxC>=3&&Z.fresh<=Z.want-Z.gone&&Z.gone>=2,'10 the chase filled up to '+Z.maxC+' of '+Z.want+'; all left a mile behind: at most '+Z.fresh+' new police cars on you at once in the next 30 s while still wanted (the left-behind ones are not replaced; '+Z.gone+' places stay used)');
  ok(Z.spawnedOut==0&&Z.tFade>0&&Z.tFade<8,'10 '+Z.dz+' m from where they last saw you (outside the half-mile search area): '+Z.spawnedOut+' police cars turned up, the heat started to fade after '+Z.tFade+' s');
  /* 11. (batch 70) wrecking police cars: the 3rd, 8th and 14th each raise the stars by one; a single wreck no longer jumps to four stars */
  const K=await T.ev(()=>{copSetDiff('medium');T3.reset(.3,0);copClear(true);const seq=[];GAME.state=0;copTrigger(1,'event');const h0=COP.heat;
    for(let k=1;k<=15;k++){copKill();seq.push(COP.heat)}
    /* through the real path: a chasing car wrecked by your hit at one star */
    copClear(true);copTrigger(1,'event');const c=trSpawnCop(true,false);let real=-1;if(c){c.state=3;copRammed(c,150000,true);real=COP.heat}
    const k1=COP.kills;copClear(true);copSetDiff('forgiving');return{h0,seq,real,k1}});
  ok(K.h0==1&&K.seq[0]==1&&K.seq[1]==1&&K.seq[2]==2&&K.seq[6]==2&&K.seq[7]==3&&K.seq[12]==3&&K.seq[13]==4,'11 wrecking police cars from one star: stars after each wreck '+K.seq.join(',')+' (up one at the 3rd, the 8th and the 14th)');
  ok(K.real==1&&K.k1==1,'11 one police car wrecked by your hit at one star: still '+K.real+' star (it used to be four), wrecks counted '+K.k1);
  /* 12. (batch 70) the world map no longer pauses the game: with it open your car brakes to a stop and never reverses */
  const MO=await T.ev(()=>{T3.reset(.3,30);UI.mapOpen=true;let minF=1e9,maxOm=0;for(let s=0;s<120*8;s++){RACER.worldStep(1/120);const f=C.vx*Math.sin(C.yaw)-C.vz*Math.cos(C.yaw);minF=Math.min(minF,f);maxOm=Math.max(maxOm,Math.abs(C.om||0))}const sp=C.speed;UI.mapOpen=false;return{sp:+sp.toFixed(2),minF:+minF.toFixed(2),maxOm:+maxOm.toFixed(2)}});console.log(JSON.stringify(MO));
  ok(MO.sp<1.6&&MO.minF>-.5,"12 map open at 67 mph: the car brakes to "+MO.sp+" m/s in 6 s and never rolls backwards (lowest forward speed "+MO.minF+")");
  const perf=await T.ev(()=>({ms:+TR.ms.toFixed(3),alive:TR.nAlive}));console.log('traffic+cops tick '+perf.ms+' ms with '+perf.alive+' cars');
  console.log('errs',T.errs);ok(T.errs.length==0,'no page errors');await T.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
