// Lane assist (batch 22): thumb off the stick, the car keeps to the middle of the nearest lane on its own side; it lets go when you steer.
// usage: node racer/tests/rlane.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:300,h:200,mobile:false,traffic:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const r=await T.ev(()=>{const {C,IN,UI}=RACER;UI.paused=true;IN.assist=true;IN.auto=false;const o={};
    /* drive with the thumb off the stick from a spot (lateral offset off, along or against the road), at about v m/s; returns how far the car ends from the nearest lane centre on its side */
    const run=(id,f,off,dir,v,secs,steerFn)=>{const r=ROADS.find(q=>q.id==id),i=Math.round(f*(r.n-1)),t=_tan(r,i),a=Math.atan2(t[0]*dir,-t[1]*dir),nx=-t[1],nz=t[0];
      RACER.carPlace(r.X[i]+nx*off,r.Z[i]+nz*off,a,r.Y[i]+.5);C.vx=Math.sin(a)*v;C.vz=-Math.cos(a)*v;let maxDev=0,on=0,n=0,off2=0;
      for(let s=0;s<secs*120;s++){C.steer=steerFn?steerFn(s/120):0;IN.thr=C.speed<v?1:0;IN.brk=0;RACER.worldStep(1/120);
        if(s>secs*60&&roadAt(C.x,C.z,C.y)&&ROADS[RQ.ri]){const rr=ROADS[RQ.ri],li=laneInfo(rr.hw,rr.style),sg=Math.abs(angd(Math.atan2(RQ.tx,-RQ.tz),C.yaw))<Math.PI/2?1:-1,lat=RQ.lat*sg;let bd=1e9;for(let k=0;k<li.nl;k++)bd=Math.min(bd,Math.abs(li.x0+li.lw*(k+.5)-lat));maxDev=Math.max(maxDev,bd);n++;if(C.laneOn)on++;if(lat<0)off2++}}
      return{dev:+maxDev.toFixed(2),on:+(on/Math.max(1,n)).toFixed(2),wrongSide:off2,onRoad:C.onRoad?1:0,tum:TUM.on?1:0}};
    IN.lane=true;
    o.ring=run('ring',.2,1.2,1,28,8);          /* divided highway, started between lanes */
    o.ringRev=run('ring',.45,-6,-1,28,8);      /* the other carriageway, going the other way */
    o.mp=run('mp',.35,1.5,1,18,14);            /* the twisty mountain pass */
    o.street=run('sfnu3',.4,-1,1,12,8);        /* a city street, started on the wrong side: back to its own lane */
    o.steer=run('ring',.2,1.2,1,28,6,t=>t>1&&t<5?.12:0);   /* holding a little steering: it lets go */
    IN.lane=false;o.off=run('ring',.2,1.2,1,28,8);
    return o});
  console.log(JSON.stringify(r));
  ok(r.ring.dev<.7&&r.ring.on>.8&&r.ring.onRoad&&!r.ring.tum,'1 the ring at 63 mph, started between two lanes: settles to within '+r.ring.dev+' m of a lane centre (assisting '+Math.round(r.ring.on*100)+' % of the time)');
  ok(r.ringRev.dev<.7&&r.ringRev.onRoad,'2 the other carriageway, the other way: within '+r.ringRev.dev+' m');
  ok(r.mp.dev<1.1&&r.mp.onRoad&&!r.mp.tum,'3 the twisty mountain pass at 40 mph for 14 s: stays within '+r.mp.dev+' m of its lane');
  ok(r.street.dev<.7&&r.street.wrongSide==0,'4 a city street, started on the wrong side: back in its own lane (within '+r.street.dev+' m, never on the wrong side in the second half)');
  ok(r.steer.on<.5,'5 holding the steering: it lets go (assisting only '+Math.round(r.steer.on*100)+' % of the time)');
  ok(r.off.on==0,'6 switched off: it does nothing');
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
