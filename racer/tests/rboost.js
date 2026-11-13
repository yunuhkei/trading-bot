// Earning nitro (batch 27): repair shops fill it; wrong side of the road, near misses, takedowns, jumps and holding top speed add to it, gradually.
// usage: node racer/tests/rboost.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:300,h:200,mobile:false,traffic:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const r=await T.ev(()=>{const {C,IN,UI}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;IN.lane=false;COP.on=false;const o={};
    const put=(id,f,off,v)=>{const r=ROADS.find(q=>q.id==id),i=Math.round(f*(r.n-1)),t=_tan(r,i),a=Math.atan2(t[0],-t[1]),nx=-t[1],nz=t[0];RACER.carPlace(r.X[i]+nx*off,r.Z[i]+nz*off,a,r.Y[i]+.5);C.vx=Math.sin(a)*v;C.vz=-Math.cos(a)*v;BOOST.pend=0;C.nos=0;return{r,i,t,a,nx,nz}};
    const drive=(secs,v)=>{for(let s=0;s<secs*120;s++){C.steer=0;IN.thr=C.speed<v?1:0;IN.brk=0;IN.nitro=0;RACER.worldStep(1/120)}};
    /* 1 repair shop */
    const p=REPAIRS[0];RACER.carPlace(p.x,p.z,Math.atan2(p.cs,-p.sn),groundAt(p.x,p.z,999)+.4);C.nos=0;SAFE.rpIn=null;for(let s=0;s<10;s++){C.vx=C.vz=0;RACER.worldStep(1/120)}o.rep=C.nos;
    /* 2 the wrong side of a city street, and the right side */
    put('sfnu3',.3,-2,15);drive(5,15);o.opp=+C.nos.toFixed(3);o.oppN=BOOST.n.opp;
    put('sfnu3',.3,2,15);drive(5,15);o.own=+C.nos.toFixed(3);
    /* 3 a near miss: a parked car one lane over, passed at 25 m/s with a metre between */
    TR.on=true;const q=put('ring',.2,1.8,25);const sn=navSnap(C.x,C.z,30),la=navLane(sn,C.x,C.z,Math.sin(q.a),-Math.cos(q.a));const c=trPlace(la.e,la.u,0,1,0,77);
    c.x=c.px=C.x+Math.sin(q.a)*60+q.nx*(CD.hw+c.hw+.9);c.z=c.pz=C.z-Math.cos(q.a)*60+q.nz*(CD.hw+c.hw+.9);c.yaw=q.a;c.v=0;c.v0f=0;c.state=1;c.state=0;const n0=BOOST.n.near;
    for(let s=0;s<120*3.5;s++){c.v=0;c.x=c.px;c.z=c.pz;C.steer=0;IN.thr=C.speed<25?1:0;RACER.worldStep(1/120)}o.near=BOOST.n.near-n0;o.nearHit=c.hitT>0?1:0;o.nearNos=+(C.nos+BOOST.pend).toFixed(3);trKill(c,0);TR.on=false;
    /* 4 a jump of 40 m, 5 a takedown */
    BOOST.pend=0;C.jump={t:C.t+1,d:40,air:1.5};boostTick(0);o.jump=+BOOST.pend.toFixed(3);BOOST.pend=0;boostTakedown({kind:1});o.take=BOOST.pend;BOOST.pend=0;boostTakedown({kind:0});o.takeT=BOOST.pend;
    /* gradual: 0.3 a second into the tank */
    C.nos=0;BOOST.pend=.6;for(let s=0;s<120;s++)boostTick(1/120);o.flow=+C.nos.toFixed(2);BOOST.pend=0;
    /* 6 holding top speed down the ring for 25 s */
    put('ring',.2,1.8,50);const f0=BOOST.n.fast;let fastT=0;for(let s=0;s<120*25;s++){C.steer=0;IN.thr=1;RACER.worldStep(1/120);if(BOOST.fast>2)fastT+=1/120}o.fast=BOOST.n.fast-f0;o.fastNos=+C.nos.toFixed(3);o.fastT=+fastT.toFixed(1);o.vmax=+Math.min(53.65,HND.vmax*.88).toFixed(1);o.top=+C.speed.toFixed(1);
    return o});
  console.log(JSON.stringify(r));
  ok(r.rep==1,'1 a drive-through repair shop fills the nitro');
  ok(r.opp>r.own+.1&&r.oppN>=1,'2 the wrong side of a city street for 5 s: nitro '+r.opp+' (own side '+r.own+')');
  ok(r.near==1&&!r.nearHit&&r.nearNos>.06,'3 a near miss past a parked car at 56 mph: +'+r.nearNos);
  ok(Math.abs(r.jump-.22)<.01&&r.take==.25&&r.takeT==0,'4 a 40 m jump +'+r.jump+', a cop takedown +'+r.take+' (a traffic car +'+r.takeT+')');
  ok(Math.abs(r.flow-.3)<.02,'5 the tank fills gradually: 0.6 earned shows as '+r.flow+' after 1 s');
  ok(r.fast>=1&&r.fastNos>.2,'6 held above '+r.vmax+' m/s for '+r.fastT+' s (top '+r.top+'): nitro '+r.fastNos);
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
