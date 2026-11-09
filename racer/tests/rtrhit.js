// Player against traffic. Part A: the collision physics on synthetic bodies (momentum, energy, spin). Part B: a real hit in the game (energy, zone, wreck, despawn).
// Part C: a bot drives through busy traffic with real collisions (no exceptions, no NaN, it keeps going, wrecks go away).
// usage: node racer/tests/rtrhit.js
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:240,h:160,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
  /* ---- A: synthetic ---- */
  const A=await T.ev(()=>{const out={};const mk=(x,z,yaw,v,m,hl,hw)=>({x,z,yaw,vx:Math.sin(yaw)*v,vz:-Math.cos(yaw)*v,om:0,m,I:m*(hl*hl+hw*hw)/3,hl,hw});
    const e=.26;
    {/* head-on into a parked 1300 kg car at 20 m/s, centred */const a=mk(0,0,0,20,1400,2.2,.95),b=mk(0,-4.3,0,0,1300,2.25,.9);const ok1=trObb(a,b);const p0=a.m*a.vz+b.m*b.vz;const E=trResolve(a,b,e,0);const p1=a.m*a.vz+b.m*b.vz;
      const mu=1400*1300/2700,Ex=.5*mu*(1-e*e)*400;out.head={hit:ok1,dp:Math.abs(p1-p0)/Math.abs(p0),E,Ex,va:-a.vz,vb:-b.vz,vaX:(1400-e*1300)/2700*20,vbX:(1+e)*1400/2700*20}}
    {/* T-bone: 1300 kg car crossing at 10 m/s, hit on its side by the 1400 kg player at 20 m/s: it must spin */const a=mk(0,0,0,20,1400,2.2,.95),b=mk(-.9,-2.9,Math.PI/2,10,1300,2.25,.9);const ok2=trObb(a,b);const E=trResolve(a,b,e,.32);out.tbone={hit:ok2,E,omB:b.om,omA:a.om}}
    {/* a tap: 2 m/s into a car that is going 1 m/s the same way */const a=mk(0,0,0,3,1400,2.2,.95),b=mk(0,-4.3,0,1,1300,2.25,.9);const ok3=trObb(a,b);const E=trResolve(a,b,e,.3);out.tap={hit:ok3,E}}
    {/* no overlap */const a=mk(0,0,0,20,1400,2.2,.95),b=mk(0,-9,0,0,1300,2.25,.9);out.miss=trObb(a,b)}
    return out});
  ok(A.head.hit,'A1 head-on: overlap found');
  ok(A.head.dp<.01,'A1 momentum kept to '+(A.head.dp*100).toFixed(2)+' %');
  ok(Math.abs(A.head.E-A.head.Ex)/A.head.Ex<.03,'A1 energy lost '+(A.head.E/1000).toFixed(0)+' kJ, theory 1/2 mu (1-e^2) v^2 = '+(A.head.Ex/1000).toFixed(0)+' kJ');
  ok(Math.abs(A.head.va-A.head.vaX)<.3&&Math.abs(A.head.vb-A.head.vbX)<.3,'A1 speeds after: player '+A.head.va.toFixed(1)+' (theory '+A.head.vaX.toFixed(1)+'), car '+A.head.vb.toFixed(1)+' (theory '+A.head.vbX.toFixed(1)+') m/s');
  ok(A.tbone.hit&&Math.abs(A.tbone.omB)>.5,'A2 T-bone: the car spins out ('+A.tbone.omB.toFixed(2)+' rad/s), energy '+(A.tbone.E/1000).toFixed(0)+' kJ');
  ok(A.tap.hit&&A.tap.E<2500,'A3 a tap loses only '+A.tap.E.toFixed(0)+' J (below the 2500 J wreck threshold)');
  ok(!A.miss,'A4 no contact when the bodies are 9 m apart');
  /* ---- B: a real hit ---- */
  const B=await T.ev(()=>{const {C,TR,LG,IMP,UI}=RACER;UI.paused=true;TR.max=0;TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;trInit();const res=[];
    const e=LG.ofRoad[ROADS.findIndex(r=>r.id=='ring')][0][1];
    for(const [type,v0,label] of [[0,25,'sedan 25 m/s'],[3,25,'van 25 m/s'],[1,12,'hatch 12 m/s']]){
      TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;IMP.q.length=0;IMP.last=null;
      const u=Math.round(e.n*.69);const c=trPlace(e,u,type,3,0,7);c.state=1;c.vx=c.vz=0;c.wt=0;                       /* a parked car (a static wreck) */
      trPt(e,u);const fx=_pt.tx,fz=_pt.tz,yaw=Math.atan2(fx,-fz);
      RACER.carPlace(_pt.x-fx*45,_pt.z-fz*45,yaw,_pt.y+.5);C.vx=fx*v0;C.vz=fz*v0;C.wyaw=0;IN.assist=false;
      let hitT=-1,vAfter=0;for(let s=0;s<120*6;s++){if(hitT<0&&Math.hypot(c.x-C.x,c.z-C.z)>9){C.vx=fx*v0;C.vz=fz*v0}RACER.worldStep(1/120);if(IMP.last&&hitT<0){hitT=s;}if(hitT>=0&&s>hitT+30){vAfter=C.speed;break}}
      const im=IMP.q[0];res.push({label,hit:!!im,E:im&&im.E,vn:im&&im.vn,pn:IMP.q.length,zone:im&&im.zone,src:im&&im.src,carV:Math.hypot(c.vx,c.vz),playerAfter:vAfter,mass:TTYPES[type].m,v0,wreck:c.state==1})}
    return res});
  for(const r of B){const mu=1400*r.mass/(1400+r.mass),Ex=.5*mu*(1-.26*.26)*(r.vn||r.v0)*(r.vn||r.v0);
    ok(r.hit&&r.src==3,'B '+r.label+': impact recorded (source traffic)');
    ok(r.hit&&r.zone===0,'B '+r.label+': hit on the FRONT of the player (zone '+r.zone+')');
    ok(r.hit&&Math.abs(r.E-Ex)/Ex<.12,'B '+r.label+': impact energy '+(r.E/1000).toFixed(0)+' kJ at '+(r.vn||0).toFixed(1)+' m/s closing (physics says '+(Ex/1000).toFixed(0)+' kJ for that closing speed)');
    ok(r.carV>1&&r.playerAfter<r.v0,'B '+r.label+': the parked car is shoved to '+r.carV.toFixed(1)+' m/s and the player slows from '+r.v0+' to '+r.playerAfter.toFixed(1))}
  /* ---- C: a bot through busy traffic ---- */
  const Cc=await T.ev(()=>{const {C,IN,TR,IMP,UI,ROADS}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;TR.max=56;TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;trInit();IMP.q.length=0;IMP.n=0;IMP.total=0;
    const out=[];
    for(const [id,spd,secs] of [['sfnu3',14,70],['ring',32,90],['lau1',18,70]]){const r=ROADS.find(q=>q.id==id),n=r.n,start=Math.round(n*.3),a=Math.atan2(r.X[start+1]-r.X[start],-(r.Z[start+1]-r.Z[start])),off=r.hw*.35;
      TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;trInit();IMP.n=0;IMP.total=0;TR.stat.hits=0;
      RACER.carPlace(r.X[start]+Math.cos(a)*off,r.Z[start]+Math.sin(a)*off,a,r.Y[start]+.5);C.vx=Math.sin(a)*spd;C.vz=-Math.cos(a)*spd;
      let idx=start,travelled=0,nan=0,maxE=0,hitsMax=0,stuck=0,still=0;const n0=TR.stat.wrecks;
      for(let s=0;s<secs*120;s++){
        let bi=idx,bd=1e18;for(let k=-6;k<=30;k++){let i=idx+k;if(r.closed)i=((i%n)+n)%n;else if(i<0||i>=n)continue;const d=(r.X[i]-C.x)**2+(r.Z[i]-C.z)**2;if(d<bd){bd=d;bi=i}}
        const adv=r.closed?((bi-idx+n)%n):(bi-idx);if(adv>=0&&adv<40)travelled+=adv*r.ds;idx=bi;if(!r.closed&&idx>=n-8)break;
        const look=Math.max(6,C.speed*.7),k2=Math.round(look/r.ds);let ti=idx+k2;if(r.closed)ti%=n;else ti=Math.min(n-1,ti);const tj=r.closed?(ti+1)%n:Math.min(n-1,ti+1),ta=Math.atan2(r.X[tj]-r.X[ti],-(r.Z[tj]-r.Z[ti])),tx=r.X[ti]+Math.cos(ta)*off,tz=r.Z[ti]+Math.sin(ta)*off;
        C.steer=Math.max(-1,Math.min(1,angd(Math.atan2(tx-C.x,-(tz-C.z)),C.yaw)*2.2));IN.thr=C.speed<spd?1:0;IN.brk=C.speed>spd+4?1:0;
        RACER.worldStep(1/120);if(!isFinite(C.x+C.z+C.vx+C.vz+C.yaw))nan++;if(C.speed<1.5)still++;else still=0;if(still>120*6){stuck++;still=0;RACER.respawn()}
        if(IMP.last&&IMP.last.E>maxE)maxE=IMP.last.E}
      const wr=TR.cars.filter(c=>c.alive&&c.state==1).length;
      /* let the traffic run on without the player and see the wrecks go away */
      IN.thr=0;IN.brk=1;for(let s=0;s<120*60;s++){RACER.worldStep(1/120)}
      out.push({id,spd,travelled:Math.round(travelled),nan,hits:TR.stat.hits,impacts:IMP.n,maxE:Math.round(maxE/1000),wrecksMade:TR.stat.wrecks-n0,wrecksAfter:TR.cars.filter(c=>c.alive&&c.state==1).length,stuck,alive:TR.nAlive,aiCrash:TR.stat.aiCrash})}
    return out});
  for(const r of Cc){ok(r.nan==0&&r.travelled>150,'C '+r.id+' at '+r.spd+' m/s: drove '+r.travelled+' m, NaN '+r.nan+', hits on traffic '+r.hits+', impacts logged '+r.impacts+' (biggest '+r.maxE+' kJ), wrecks made '+r.wrecksMade+', still there a minute later '+r.wrecksAfter+', respawns because stuck '+r.stuck+', cars alive '+r.alive)}
  console.log('errs',T.errs);ok(T.errs.length==0,'no page errors');await T.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
