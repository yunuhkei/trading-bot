// Police overhaul (batch 3): who is at fault for a crash, what each star adds (cars, vehicle types, ramming, roadblocks, helicopters, spike strips), the helicopter (keeps you in sight, runs out of fuel),
// spike strips (tyres burst, about 4 s of half grip, then back to normal), the minimap (police only), cops that never end up inside a building and back out when they are stuck.
// usage: node racer/tests/rpolice.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1'+(process.env.Q||''),w:240,h:160,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  await T.ev(()=>{const {C,IN,UI,TR}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;COP.on=true;copSetDiff('forgiving');
    window.P3={ring:ROADS.find(q=>q.id=='ring'),
      clear(){TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;copClear(true);HELI.nextT=0;SPIKE.nextT=0;dmgReset();GAME.state=0;GAME.lock=0;C.flatT=0;COP.lastBlock=-99;COP.spawnT=0},
      reset(frac,spd,id){const r=id?ROADS.find(q=>q.id==id):P3.ring,n=r.n,i=Math.round(n*frac),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i])),o=id?r.hw*.4:5.5;P3.clear();P3.r=r;
        RACER.carPlace(r.X[i]+Math.cos(a)*o,r.Z[i]+Math.sin(a)*o,a,r.Y[i]+.5);C.vx=Math.sin(a)*spd;C.vz=-Math.cos(a)*spd;C.steer=0;C.wyaw=0;P3.idx=i;P3.spd=spd;NAV.pl=null;IN.thr=0;IN.brk=0;IN.hand=0},
      drive(){const r=P3.ring,n=r.n;let bi=P3.idx,bd=1e18;for(let k=-6;k<=30;k++){const i=((P3.idx+k)%n+n)%n,d=(r.X[i]-C.x)**2+(r.Z[i]-C.z)**2;if(d<bd){bd=d;bi=i}}P3.idx=bi;
        const look=Math.max(6,C.speed*.7),ti=((bi+Math.round(look/r.ds))%n+n)%n,tj=(ti+1)%n,ta=Math.atan2(r.X[tj]-r.X[ti],-(r.Z[tj]-r.Z[ti])),tx=r.X[ti]+Math.cos(ta)*5.5,tz=r.Z[ti]+Math.sin(ta)*5.5;
        C.steer=Math.max(-1,Math.min(1,angd(Math.atan2(tx-C.x,-(tz-C.z)),C.yaw)*2.2));IN.thr=C.speed<P3.spd?1:0;IN.brk=C.speed>P3.spd+4?1:0},
      pin(Lv){const t=COP.D.thr;COP.heat=Lv;COP.w=t[Lv]+(Lv<5?(t[Lv+1]-t[Lv])*.3:20);COP.sightT=0;COP.bust=0;if(GAME.state){GAME.state=0;GAME.lock=0}},
      noCivs(){for(const c of TR.cars)if(c.alive&&c.kind==0)trKill(c,0)},
      /* a car out of the pool, parked dist metres ahead (or behind) of the player in its lane; kind 0 civilian, 1 cop */
      mk(dist,kind,v){let c=null;for(const q of TR.cars)if(!q.alive){c=q;break}const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw),ty=kind?4:0,TT=TTYPES[ty];c.alive=1;TR.nAlive++;c.kind=kind;c.cm=0;c.siren=0;c.type=ty;c.state=1;c.dmg=0;c.dn=null;
        c.v=v||0;c.vx=fx*(v||0);c.vz=fz*(v||0);c.om=0;c.m=TT.m;c.I=TT.m*(TT.hl**2+TT.hw**2)/3;c.wt=0;c.rec=0;c.hl=TT.hl;c.hw=TT.hw;c.px=c.x=C.x+fx*dist;c.pz=c.z=C.z+fz*dist;c.py=c.y=C.y;c.yaw=c.pyaw=C.yaw;c.ramCd=0;c.block=0;c.clk=-99;c.los=true;c.stk=0;c.hitT=-9;return c}}});
  /* ---- 1 the star table ---- */
  const S=await T.ev(()=>({stars:STARS,chaseN:COPD.forgiving.chaseN,ram:COPD.forgiving.ramLevel,block:COPD.forgiving.blockLevel,names:TTYPES.map(t=>t.n),patrol:[COPD.forgiving.patrol,COPD.medium.patrol,COPD.hard.patrol]}));
  for(let i=1;i<=5;i++)console.log('     '+i+' star'+(i>1?'s':' ')+': '+S.chaseN[i]+' chasers ('+S.stars[i].types.map(t=>S.names[t]).join(', ')+')'+(i>=S.ram?', ram'+(S.stars[i].pit?' + PIT':''):'')+(i>=S.block?', roadblock of '+S.stars[i].block:'')+(S.stars[i].heli?', '+S.stars[i].heli+' helicopter'+(S.stars[i].heli>1?'s':''):'')+(S.stars[i].spikes?', spike strips':''));
  let rising=true;for(let i=2;i<=5;i++)if(!(S.chaseN[i]>S.chaseN[i-1]))rising=false;
  ok(rising&&S.chaseN[1]==2&&S.ram==2&&S.block==3,'1 every star brings more chasers ('+S.chaseN.slice(1).join(' < ')+'); 1 star is a couple of cars, ramming starts at 2, roadblocks at 3');
  ok(!S.stars[3].heli&&S.stars[4].heli==1&&S.stars[5].heli>=2&&!S.stars[3].spikes&&S.stars[4].spikes&&S.stars[5].types.includes(22)&&S.stars[5].block>S.stars[4].block&&S.stars[4].block>S.stars[3].block,'1 helicopter and spike strips from 4 stars, several helicopters and SWAT trucks at 5, roadblocks grow '+S.stars[3].block+' -> '+S.stars[4].block+' -> '+S.stars[5].block);
  ok(S.patrol[0]==1&&S.patrol[1]==1,'1 patrols are rare: one at a time on Forgiving and Medium ('+S.patrol.join('/')+')');
  /* ---- 2 whose fault: only a crash YOU cause is a crime ---- */
  const F=await T.ev(()=>{const o={};const run=(n)=>{for(let s=0;s<n;s++){COP.spawnT=99;RACER.worldStep(1/120)}};
    P3.reset(.3,0);let c=P3.mk(-7,1,14);c.cm=0;run(160);o.copHitsMe=COP.heat;o.copHitsMeImp=c.hitT>0;                         /* a patrol runs into the back of the parked player */
    P3.reset(.3,0);c=P3.mk(-7,0,14);run(160);o.civHitsMe=COP.heat;o.civHitsMeImp=c.hitT>0;                                     /* a civilian does */
    P3.reset(.3,22);c=P3.mk(7,0,0);run(160);o.iHitCiv=COP.heat;                                                               /* the player drives into a stopped car at 22 m/s */
    P3.reset(.3,22);c=P3.mk(7,1,0);run(160);o.iHitCop=COP.heat;o.crimes=COP.crimes.slice(-4).map(q=>q.why);P3.clear();return o});
  ok(F.copHitsMeImp&&F.copHitsMe===0,'2 a police car that runs into you is not your crime (heat '+F.copHitsMe+')');
  ok(F.civHitsMeImp&&F.civHitsMe===0,'2 a civilian that runs into you is not your crime (heat '+F.civHitsMe+')');
  ok(F.iHitCiv>=1&&F.iHitCop>=2&&F.iHitCop>=F.iHitCiv,'2 driving into a car is (heat '+F.iHitCiv+'), into a police car more so (heat '+F.iHitCop+'); logged: '+F.crimes.join(' | '));
  /* ---- 3 a 45 s chase on the ring at every star (the heat is held there) ---- */
  const CH=await T.ev(()=>{const out=[],trig=copTrigger;window.copTrigger=function(){};   /* crimes are switched off here, so the heat really stays at the star under test */
    for(let Lv=1;Lv<=5;Lv++){P3.reset(.3,34);P3.pin(Lv);const types=new Set();let maxC=0,maxH=0,strips=0,maxB=0,blockTypes=new Set(),rams=0,nan=0,pit=0;const imp0=IMP.n,seen=new Set();
      for(let s=0;s<120*45;s++){P3.pin(Lv);P3.drive();if(!(s%30))P3.noCivs();if(!(s%120))dmgReset();RACER.worldStep(1/120);if(!isFinite(C.x+C.z))nan++;
        for(const q of SPIKE.list)if(!seen.has(q)){seen.add(q);strips++}
        if(s%30==0){let n=0,b=0;for(const c of TR.cars){if(!c.alive||c.kind!==1)continue;if(c.cm==3){b++;blockTypes.add(c.type)}else if(c.cm>=1&&c.state!=1){n++;types.add(c.type)}}maxC=Math.max(maxC,n);maxB=Math.max(maxB,b);maxH=Math.max(maxH,HELI.list.filter(h=>!h.leave).length)}}
      for(const q of IMP.q)if(q.src==3)rams++;
      out.push({Lv,maxC,types:[...types].sort((a,b)=>a-b),maxH,strips,maxB,blockTypes:[...blockTypes].sort((a,b)=>a-b),rams,nan,want:COP.D.chaseN[Lv]});P3.clear()}
    window.copTrigger=trig;return out});
  for(const r of CH)console.log('     '+r.Lv+'*: '+r.maxC+' chasers (want '+r.want+'), vehicle types '+JSON.stringify(r.types)+', roadblock '+r.maxB+' cars '+JSON.stringify(r.blockTypes)+', helicopters '+r.maxH+', spike strips laid '+r.strips);
  ok(CH.every(r=>r.nan==0&&r.maxC>=Math.min(r.want,r.Lv<4?r.want:r.want-1)),'3 the chasers turn out at every star: '+CH.map(r=>r.maxC+'/'+r.want).join(', '));
  ok(CH[0].types.every(t=>t==4)&&CH[0].maxB==0&&CH[0].maxH==0&&CH[0].strips==0&&CH[1].maxB==0,'3 one star: patrol cars only, no roadblock, helicopter or spikes; two stars: still no roadblock');
  ok(CH[2].maxB>=3&&CH[3].maxB>=CH[2].maxB&&CH[4].maxB>=CH[3].maxB&&CH[4].maxB>=5,'3 roadblocks grow with the stars: '+CH[2].maxB+', '+CH[3].maxB+', '+CH[4].maxB+' cars across the road (Forgiving leaves one out for the gap)');
  ok(CH[2].maxH==0&&CH[3].maxH==1&&CH[4].maxH>=2,'3 helicopters: none at 3 stars, '+CH[3].maxH+' at 4, '+CH[4].maxH+' at 5');
  ok(CH[2].strips==0&&CH[3].strips>=1&&CH[4].strips>=1,'3 spike strips: none at 3 stars, '+CH[3].strips+' laid in 45 s at 4, '+CH[4].strips+' at 5');
  ok(CH[4].types.includes(22)||CH[4].blockTypes.includes(22),'3 five stars brings the SWAT trucks (chasing '+JSON.stringify(CH[4].types)+', blocking '+JSON.stringify(CH[4].blockTypes)+')');
  ok(CH[3].types.some(t=>t==20||t==21),'3 four stars: interceptors and SUVs chase ('+JSON.stringify(CH[3].types)+')');
  /* ---- 4 the helicopter ---- */
  const H=await T.ev(()=>{P3.reset(.3,34);P3.pin(4);let first=-1,near=0,tot=0,minAlt=1e9,maxD=0,left=-1,second=-1,nan=0;const t0=COP.t;
    for(let s=0;s<120*110;s++){P3.pin(4);COP.spawnT=99;P3.drive();if(!(s%30)){P3.noCivs();for(const c of TR.cars)if(c.alive&&c.kind==1)trKill(c,0);SPIKE.list.length=0}if(!(s%120))dmgReset();RACER.worldStep(1/120);const t=COP.t-t0;
      const act=HELI.list.filter(h=>!h.leave);if(act.length&&first<0)first=t;if(first>=0&&left<0&&HELI.list.some(h=>h.leave))left=t;if(left>=0&&second<0&&act.length)second=t;
      if(s%20==0&&act.length&&t>first+12){const h=act[0],d=Math.hypot(h.x-C.x,h.z-C.z);tot++;if(d<220)near++;maxD=Math.max(maxD,d);minAlt=Math.min(minAlt,h.y-terrainH(h.x,h.z));if(!isFinite(h.x+h.y+h.z))nan++}}
    /* with no police car anywhere, a helicopter overhead still keeps the heat on */
    P3.reset(.3,34);P3.pin(4);for(let s=0;s<120*10;s++){P3.pin(4);COP.spawnT=99;P3.drive();if(!(s%30)){P3.noCivs();for(const c of TR.cars)if(c.alive&&c.kind==1)trKill(c,0)}RACER.worldStep(1/120)}
    const h0=COP.heat;let hEnd=h0;for(let s=0;s<120*(COP.D.loseT+10);s++){COP.spawnT=99;P3.drive();if(!(s%30)){P3.noCivs();for(const c of TR.cars)if(c.alive&&c.kind==1)trKill(c,0);SPIKE.list.length=0}RACER.worldStep(1/120);if(HELI.list.some(h=>!h.leave))hEnd=COP.heat}
    P3.clear();return{first:+first.toFixed(1),near,tot,minAlt:+minAlt.toFixed(1),maxD:Math.round(maxD),left:+left.toFixed(1),second:+second.toFixed(1),nan,h0,hEnd,loseT:COP.D.loseT}});
  ok(H.first>=0&&H.first<8&&H.nan==0,'4 at four stars a helicopter arrives ('+H.first+' s after the chase begins)');
  ok(H.tot>50&&H.near/H.tot>.9&&H.minAlt>=17.5,'4 it stays with a car doing 34 m/s: within 220 m in '+Math.round(H.near/H.tot*100)+' % of the samples (furthest '+H.maxD+' m), never lower than '+H.minAlt+' m above the ground');
  ok(H.left>60&&H.left<95&&H.second>H.left+20&&H.second<H.left+40,'4 it runs out of fuel after '+(H.left-H.first).toFixed(0)+' s and the next one comes '+(H.second-H.left).toFixed(0)+' s later (your chance to get away)');
  ok(H.hEnd>=H.h0&&H.h0==4,'4 with no police car near, the helicopter alone keeps you wanted (heat '+H.h0+' -> '+H.hEnd+' while it was overhead, '+(H.loseT+10)+' s)');
  /* ---- 5 spike strips ---- */
  const K=await T.ev(()=>{const o={};
    const turn=(flat)=>{P3.reset(.3,30);C.flatT=flat;const a0=Math.atan2(C.vx,-C.vz),x0=C.x,z0=C.z;for(let s=0;s<120;s++){C.steer=-.7;IN.thr=.4;RACER.worldStep(1/120);if(flat)C.flatT=Math.max(C.flatT,3)}const a1=Math.atan2(C.vx,-C.vz);
      return{turn:Math.abs(angd(a1,a0)),lat:Math.abs((C.x-x0)*Math.cos(a0)+(C.z-z0)*Math.sin(a0))}};
    o.base=turn(0);o.flat=turn(4);
    /* drive over a strip laid 45 m ahead */
    P3.reset(.3,30);const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw);copAhead(45,fx,fz);const r=ROADS[TRP.ri],i=TRP.i,t=_tan(r,i);SPIKE.list.push({x:r.X[i],z:r.Z[i],y:r.Y[i],nx:-t[1],nz:t[0],hw:r.hw+.6,life:40});const hits0=SPIKE.hits;SAFE.msg='';
    let tHit=-1,tEnd=-1,f0=0,msg='',hp0=DMG.hp;for(let s=0;s<120*8;s++){P3.drive();RACER.worldStep(1/120);if(tHit<0&&C.flatT>0){tHit=s/120;f0=C.flatT;msg=SAFE.msg}if(tHit>=0&&tEnd<0&&!(C.flatT>0))tEnd=s/120}
    o.tHit=tHit;o.f0=f0;o.msg=msg;o.dur=+(tEnd-tHit).toFixed(2);o.hits=SPIKE.hits-hits0;o.heat=COP.heat;o.left=SPIKE.list.length;
    const a0=Math.atan2(C.vx,-C.vz);o.after=turn(0);
    /* a strip is laid ahead of you ON the road during a 4 star chase */
    P3.reset(.3,34);P3.pin(4);let laid=null;for(let s=0;s<120*30&&!laid;s++){P3.pin(4);P3.drive();if(!(s%30))P3.noCivs();RACER.worldStep(1/120);if(SPIKE.list.length){const q=SPIKE.list[0],dx=q.x-C.x,dz=q.z-C.z,d=Math.hypot(dx,dz);roadAt(q.x,q.z);laid={d:Math.round(d),ahead:(dx*C.vx+dz*C.vz)>0,on:RQ.on?1:0,warn:COP.spikeWarn>0}}}
    o.laid=laid;P3.clear();return o});
  ok(K.tHit>0&&K.tHit<2.5&&K.hits==1&&/BURST/.test(K.msg),'5 driving over a strip bursts the tyres ("'+K.msg+'", after '+K.tHit.toFixed(2)+' s)');
  ok(K.dur>3.6&&K.dur<4.4,'5 the loss of grip lasts '+K.dur+' s (about 4)');
  ok(K.flat.turn<K.base.turn*.8,'5 with burst tyres the car turns less: '+(K.flat.turn*57.3).toFixed(1)+' deg in 1 s at 30 m/s against '+(K.base.turn*57.3).toFixed(1)+' deg ('+Math.round(K.flat.turn/K.base.turn*100)+' %)');
  ok(Math.abs(K.after.turn-K.base.turn)<K.base.turn*.05,'5 afterwards the grip is back to normal ('+(K.after.turn*57.3).toFixed(1)+' deg against '+(K.base.turn*57.3).toFixed(1)+')');
  ok(K.laid&&K.laid.ahead&&K.laid.on&&K.laid.d>120&&K.laid.d<260&&K.laid.warn,'5 in a 4 star chase a strip is laid on the road '+(K.laid?K.laid.d:'?')+' m ahead, with a warning on the HUD');
  /* ---- 6 the minimap shows police only ---- */
  const M=await T.ev(()=>{P3.reset(.3,0);const rec=()=>{let n=0;const ctx=new Proxy({},{get:(t,k)=>k=='fillRect'?(x,y,w,h)=>{if(Math.abs(w)<40)n++}:k=='canvas'?UI.mapCv:(typeof k=='string'?()=>{}:undefined),set:()=>true});drawMap(ctx,60,60,50,180,0);return n};
    for(let k=1;k<=6;k++)P3.mk(10*k,0,0);const civOnly=rec();const p=P3.mk(-12,1,0);p.state=0;const withPatrol=rec();const q=P3.mk(-22,1,0);q.state=0;q.cm=1;q.siren=1;const withChaser=rec();
    const o={civOnly,withPatrol,withChaser,civs:TR.cars.filter(c=>c.alive&&c.kind==0).length};P3.clear();return o});
  ok(M.civs>=6&&M.civOnly==0&&M.withPatrol==1&&M.withChaser>=2,'6 minimap: '+M.civs+' civilian cars round you draw '+M.civOnly+' blips, a patrol 1, a patrol and a chaser '+M.withChaser);
  /* ---- 7 cops in a city: never inside a building, and they back out when stuck ---- */
  const B=await T.ev(()=>{const o={};const r=ROADS.find(q=>q.id=='sfnu3');
    /* a wall beside the street */
    let i,a,rx,rz,wd=-1,sd=1;for(const fr of[.5,.44,.56,.38,.62,.3,.7]){P3.reset(fr,0,'sfnu3');i=P3.idx;a=C.yaw;rx=Math.cos(a);rz=Math.sin(a);for(const s2 of[1,-1]){for(let d=r.hw+2;d<60&&wd<0;d+=.5)if(trStatic(r.X[i]+rx*d*s2,r.Z[i]+rz*d*s2,.3,r.Y[i]+.5)&&trStatic(r.X[i]+rx*(d+3)*s2,r.Z[i]+rz*(d+3)*s2,.3,r.Y[i]+.5)&&trStatic(r.X[i]+rx*(d+6)*s2,r.Z[i]+rz*(d+6)*s2,.3,r.Y[i]+.5)){wd=d;sd=s2}   /* 6 m deep: a building, not a lamp post */if(wd>=0)break}if(wd>=0)break}
    o.wall=wd;
    if(wd>0){const e=LG.ofRoad[ROADS.indexOf(r)][0][0],c=trPlace(e,Math.round(e.n*.5),4,12,0,4242);c.kind=1;c.block=0;c.pickJ=-1;c.ramCd=0;c.los=true;c.stk=0;c.rev=0;copAlert(c);copDetach(c);
      c.x=c.px=r.X[i]+rx*(wd-3.2)*sd;c.z=c.pz=r.Z[i]+rz*(wd-3.2)*sd;c.yaw=c.pyaw=Math.atan2(rx*sd,-rz*sd);c.v=0;
      RACER.carPlace(r.X[i]+rx*(wd+45)*sd,r.Z[i]+rz*(wd+45)*sd,a);P3.pin(3);const x0=c.x,z0=c.z;let rev=0,inside=0,maxMove=0,tRev=-1;
      for(let s=0;s<120*9;s++){P3.pin(3);COP.spawnT=99;C.vx=C.vz=0;RACER.worldStep(1/120);if(c.rev>0&&tRev<0)tRev=s/120;if(c.rev>0)rev++;if(c.alive&&trStatic(c.x,c.z,.25,c.y))inside++;maxMove=Math.max(maxMove,Math.hypot(c.x-x0,c.z-z0))}
      o.rev=rev;o.tRev=tRev;o.inside=inside;o.move=+maxMove.toFixed(1);o.state=c.state;o.alive=c.alive}
    /* a chase through the streets: the player loops round the block, every police car is sampled */
    P3.reset(.5,0,'sfnu3');P3.pin(3);let samples=0,ins=0,maxC=0,nan=0;
    for(let s=0;s<120*60;s++){P3.pin(3);C.vx=C.vz=0;if(!(s%120))dmgReset();RACER.worldStep(1/120);if(s%6==0){let n=0;for(const c of TR.cars){if(!c.alive||c.kind!==1||c.cm==3)continue;n++;samples++;if(!isFinite(c.x+c.z))nan++;if(trStatic(c.x,c.z,.25,c.y))ins++}maxC=Math.max(maxC,n)}}
    o.samples=samples;o.ins=ins;o.maxC=maxC;o.nan=nan;P3.clear();return o});
  ok(B.wall>0&&B.rev>0&&B.move>3&&B.inside==0,'7 a police car nose-on to a wall backs out (reversing began after '+(B.tRev>=0?B.tRev.toFixed(1):'?')+' s, it got '+B.move+' m away) and was never inside the building');
  ok(B.samples>2000&&B.ins==0&&B.nan==0&&B.maxC>=3,'7 a minute of police converging on a car parked downtown: '+B.maxC+' cars, '+B.samples+' position samples, '+B.ins+' inside a building');
  console.log('errs',T.errs.length?T.errs.slice(0,3):0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
