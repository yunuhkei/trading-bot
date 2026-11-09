// Handbrake turn-around metrics (colliders off, straight plains road, no road assist)
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({file:process.env.RFILE||L.DEFAULT_FILE,q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const res=await T.ev(()=>{
    const {C,IN,UI,ROADS,carStep,carPlace}=RACER;UI.paused=true;QH.cst.fill(0);ROADS.forEach(r=>r.rail.fill(0));const log=[];
    const r=ROADS.find(q=>q.id=='sh');const i0=Math.round(.64*r.n);const a=Math.atan2(r.X[i0+1]-r.X[i0],-(r.Z[i0+1]-r.Z[i0]));
    const place=v=>{carPlace(r.X[i0]+Math.cos(a)*3,r.Z[i0]+Math.sin(a)*3,a,r.Y[i0]+.5);C.vx=Math.sin(a)*v;C.vz=-Math.cos(a)*v;C.steer=0;C.wyaw=0;C.drift=0;C.nos=.5;IN.hand=0;IN.nitro=0;IN.brk=0;IN.assist=false;C.ax=0};
    const mph=()=>(C.speed*2.23694)|0;
    // straight handbrake pull (no steering): pure braking
    for(const m of [60,120]){place(m/2.23694);for(let k=0;k<30;k++){IN.thr=0;carStep(1/120)}const v0=C.speed;let t=0;IN.hand=1;for(let k=0;k<120*8;k++){IN.thr=0;C.steer=0;carStep(1/120);if(C.speed<1.5){t=k/120;break}}IN.hand=0;log.push('straight handbrake from '+m+' mph: stops in '+t.toFixed(2)+' s (decel '+(v0/Math.max(t,.01)).toFixed(1)+' m/s2)');}
    // turn-around: full stick + handbrake until the car has come round ~170 deg (or 3 s), then release and floor it
    for(const m of [30,45,60,80,100,140]){place(m/2.23694);for(let k=0;k<30;k++){IN.thr=1;carStep(1/120)}const y0=C.yaw,m0=mph();let tHalf=-1,k=0;
      for(k=0;k<120*3;k++){C.steer=1;IN.hand=1;IN.thr=1;carStep(1/120);if(Math.abs(angd(C.yaw,y0))>2.95){tHalf=k/120;break}}
      const turned=(Math.abs(angd(C.yaw,y0))*57.3)|0,sAt=mph(),tHold=k/120;
      IN.hand=0;C.steer=0;for(let q=0;q<120*2.5;q++){IN.thr=1;carStep(1/120)}
      // after release and 2.5 s of gas: which way is it heading/moving relative to the original direction?
      const vang=Math.atan2(C.vx,-C.vz),head=C.yaw;const moveRel=(Math.abs(angd(vang,y0))*57.3)|0,headRel=(Math.abs(angd(head,y0))*57.3)|0;
      log.push(m+' mph: '+(tHalf<0?'did NOT come round (turned '+turned+' deg in '+tHold.toFixed(1)+' s)':'came round '+turned+' deg in '+tHalf.toFixed(2)+' s')+', speed at that point '+sAt+' mph (from '+m0+'); 2.5 s after release+gas: heading '+headRel+' deg from start, moving '+moveRel+' deg from start at '+mph()+' mph')}
    // partial stick at 100 mph keeps it a controlled drift (does not spin)
    place(100/2.23694);for(let k=0;k<30;k++){IN.thr=1;carStep(1/120)}const y1=C.yaw;let pk=0;for(let k=0;k<120*2;k++){C.steer=.5;IN.hand=1;IN.thr=1;carStep(1/120);pk=Math.max(pk,Math.abs(angd(C.yaw,y1)))}log.push('half stick + handbrake 2 s at 100 mph: heading turned '+(Math.abs(angd(C.yaw,y1))*57.3|0)+' deg, speed '+mph()+' mph');
    return log});
  console.log(res.join('\n'));console.log('errs',T.errs);await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
