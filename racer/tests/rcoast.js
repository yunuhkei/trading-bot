// Coasting (batch 28): off the gas (no brake) on a level road the car slows like a real car in gear: about 1 m/s2 at highway speed, less in town, and it keeps rolling.
// usage: node racer/tests/rcoast.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:300,h:200,mobile:false,traffic:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const r=await T.ev(()=>{const {C,IN,UI}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;IN.lane=true;COP.on=false;   /* lane assist keeps it on the road; it does not touch the pedals */
    /* the flattest straight stretch of the ring */
    const R=ROADS.find(q=>q.id=='ring');let bi=0,bs=1e9;for(let i=10;i<R.n-200;i+=5){let m=0;for(let k=0;k<160;k+=8)m=Math.max(m,Math.abs(R.Y[i+k]-R.Y[i])+Math.abs(angd(Math.atan2(R.X[i+k+1]-R.X[i+k],R.Z[i+k+1]-R.Z[i+k]),Math.atan2(R.X[i+1]-R.X[i],R.Z[i+1]-R.Z[i])))*20);if(m<bs){bs=m;bi=i}}
    const coast=(v,secs)=>{const t=_tan(R,bi),a=Math.atan2(t[0],-t[1]);RACER.carPlace(R.X[bi]+Math.cos(a)*5.5,R.Z[bi]+Math.sin(a)*5.5,a,R.Y[bi]+.5);C.vx=Math.sin(a)*v;C.vz=-Math.cos(a)*v;
      for(let s=0;s<30;s++){C.vx=Math.sin(a)*v;C.vz=-Math.cos(a)*v;IN.thr=0;RACER.worldStep(1/120)}const sp=[];for(let s=0;s<secs*120;s++){IN.thr=0;IN.brk=0;RACER.worldStep(1/120);if(s%120==119)sp.push(+C.speed.toFixed(2))}return sp};
    return{hw:coast(31.3,10),town:coast(13.4,10),flat:+bs.toFixed(2)}});
  console.log(JSON.stringify(r));const d1=(r.hw[0]>0?31.3-r.hw[0]:0),d10=31.3-r.hw[9];
  ok(d1>.6&&d1<1.8,'1 off the gas at 70 mph it slows '+d1.toFixed(2)+' m/s in the first second (a real car in gear about 1; it was about 5)');
  ok(r.hw[9]>18&&r.hw[9]<26,'2 after 10 s of coasting it is still doing '+(r.hw[9]*2.237).toFixed(0)+' mph');
  ok(r.town[9]>3&&r.town[9]<10,'3 from 30 mph it rolls on: '+(r.town[9]*2.237).toFixed(0)+' mph after 10 s');
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
