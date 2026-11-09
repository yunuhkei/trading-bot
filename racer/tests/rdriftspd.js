// How responsive is the handbrake drift at different speeds? (colliders off, straight plains road)
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({file:process.env.RFILE||L.DEFAULT_FILE,q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const res=await T.ev(()=>{
    const {C,IN,UI,ROADS,carStep,carPlace}=RACER;UI.paused=true;QH.cst.fill(0);ROADS.forEach(r=>r.rail.fill(0));const log=[];
    const r=ROADS.find(q=>q.id=='sh');const i0=Math.round(.64*r.n);const a=Math.atan2(r.X[i0+1]-r.X[i0],-(r.Z[i0+1]-r.Z[i0]));
    const place=v=>{carPlace(r.X[i0]+Math.cos(a)*3,r.Z[i0]+Math.sin(a)*3,a,r.Y[i0]+.5);C.vx=Math.sin(a)*v;C.vz=-Math.cos(a)*v;C.steer=0;C.wyaw=0;C.drift=0;C.nos=.5;IN.hand=0;IN.nitro=0;IN.brk=0;IN.assist=false;C.ax=0};
    const slip=()=>Math.atan2(Math.abs(C.lat),Math.max(Math.abs(C.fwd),1))*57.3;
    for(const mph of [40,70,100,140,175]){const v=mph/2.23694;place(v);for(let k=0;k<40;k++){IN.thr=1;carStep(1/120)}
      const y0=C.yaw,vang0=Math.atan2(C.vx,-C.vz);let t80=-1,peak=0;const rec=[];
      for(let k=0;k<144;k++){C.steer=1;IN.hand=1;IN.thr=1;carStep(1/120);const sl=slip();peak=Math.max(peak,sl);rec.push(sl)}
      const fin=rec[rec.length-1];for(let k=0;k<rec.length;k++){if(rec[k]>=.8*fin){t80=k/120;break}}
      const head=(C.yaw-y0)*57.3,path=((Math.atan2(C.vx,-C.vz)-vang0)*57.3);
      IN.hand=0;C.steer=0;let te=-1;for(let k=0;k<360;k++){IN.thr=1;carStep(1/120);if(slip()<3){te=k/120;break}}
      log.push(mph+' mph: slide reaches 80% in '+(t80*1000|0)+' ms, slip after 1.2 s '+fin.toFixed(0)+' deg (peak '+peak.toFixed(0)+'), heading turned '+head.toFixed(0)+' deg, path turned '+path.toFixed(0)+' deg, exit '+(te<0?'>3':te.toFixed(2))+' s, speed now '+(C.speed*2.23694|0)+' mph')}
    // braking and turn-in numbers
    for(const mph of [60,120,180]){place(mph/2.23694);for(let k=0;k<20;k++){IN.thr=1;carStep(1/120)}IN.brk=1;let t=0;for(let k=0;k<120*12;k++){IN.thr=0;carStep(1/120);if(C.speed<1.5){t=k/120;break}}IN.brk=0;log.push('brake '+mph+' mph -> 0: '+t.toFixed(2)+' s')}
    for(const mph of [60,120,180]){place(mph/2.23694);for(let k=0;k<20;k++){IN.thr=1;carStep(1/120)}const y0=C.yaw;let t50=-1;for(let k=0;k<120;k++){C.steer=1;IN.thr=1;carStep(1/120);if(t50<0&&Math.abs(C.wyaw)>.5*Math.abs(C.wyaw)){}}log.push('full lock '+mph+' mph: turned '+((C.yaw-y0)*57.3).toFixed(0)+' deg in 1 s, yaw rate '+C.wyaw.toFixed(2)+' rad/s, slip '+slip().toFixed(1)+' deg')}
    // time for yaw rate to reach 80% of its final value after a full-lock flick at 100 mph
    place(100/2.23694);for(let k=0;k<20;k++){IN.thr=1;carStep(1/120)}{const w=[];for(let k=0;k<120;k++){C.steer=1;IN.thr=1;carStep(1/120);w.push(Math.abs(C.wyaw))}const fin=w[w.length-1];let k80=w.findIndex(x=>x>=.8*fin);log.push('turn-in at 100 mph: yaw rate reaches 80% of final in '+(k80/120*1000|0)+' ms')}
    return log});
  console.log(res.join('\n'));console.log('errs',T.errs);await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
