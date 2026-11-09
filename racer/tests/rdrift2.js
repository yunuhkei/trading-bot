// Drift pedal: tap = slide, hold = brake that builds up.
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({file:process.env.RFILE||L.DEFAULT_FILE,q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const log=await T.ev(()=>{
    const {C,IN,UI,ROADS,carStep,carPlace}=RACER;UI.paused=true;IN.assist=true;IN.auto=false;const out=[];
    const place=v=>{const r=ROADS.find(q=>q.id=='sh'),i=Math.round(.62*r.n),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));carPlace(r.X[i],r.Z[i],a,r.Y[i]+.5);C.vx=Math.sin(a)*v;C.vz=-Math.cos(a)*v;C.speed=v;C.fwd=v;C.lat=0;C.slip=0;C.slideT=0;C.steer=0;C.wyaw=0;C.drift=0;C.hk=0;C.handT=0;C.nos=.6;IN.hand=0;IN.thr=0;IN.brk=0;IN.nitro=0;return a};
    const slipDeg=()=>C.speed>5?Math.abs(Math.atan2(C.lat,C.fwd))*57.3:0;
    const run=(v,steer,hold,total)=>{place(v);let peak=0,rec=-1,v0=v;const w=[];let wprev=C.speed,tw=0;
      for(let i=0;i<total*120;i++){const t=i/120;IN.hand=t<hold?1:0;C.steer=steer;IN.thr=0;carStep(1/120);const sd=slipDeg();if(sd>peak)peak=sd;if(t>=hold&&rec<0&&sd<3)rec=t-hold;
        if(t>=.5*(w.length+1)-1e-9&&w.length<6){w.push((wprev-C.speed)/.5);wprev=C.speed}}
      return{peak,rec,v0,v1:C.speed,w}};
    for(const v of [28,42]){
      for(const steer of [0,.5]){for(const hold of [.12,.25,.4]){const r=run(v,steer,hold,3);out.push('TAP '+hold.toFixed(2)+'s steer '+steer+' @'+(v*2.237).toFixed(0)+'mph: peak slide '+r.peak.toFixed(0)+' deg, slide over (<3 deg) '+(r.rec<0?'not within 3 s':r.rec.toFixed(2)+' s after release')+', speed '+(r.v0*2.237).toFixed(0)+' -> '+(r.v1*2.237).toFixed(0)+' mph after 3 s')}}
      for(const hold of [.5,1,1.6,2.5]){const r=run(v,0,hold,hold+.4);out.push('HOLD '+hold.toFixed(1)+'s steer 0 @'+(v*2.237).toFixed(0)+'mph: peak slide '+r.peak.toFixed(0)+' deg, speed '+(r.v0*2.237).toFixed(0)+' -> '+(r.v1*2.237).toFixed(0)+' mph; decel per half second (m/s2): '+r.w.map(x=>x.toFixed(1)).join(' '))}
    }
    return out});
  log.forEach(l=>console.log(l));console.log('errs',T.errs);await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
