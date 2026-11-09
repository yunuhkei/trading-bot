// Drift taps that build up: one tap gives the old slide; tapping again while it is still going makes it bigger each time (up to five taps), then it fades.
const L=require('./rlib.js');
let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  const r=await T.ev(()=>{
    const {C,IN,UI,carStep,carPlace}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;
    const G0=window.groundAt;window.groundAt=(x,z,y)=>{RQ.on=1;RQ.lat=0;return 0};window.roadAt=()=>false;window.terrainH=()=>0;window.collide=function(){};
    const run=(taps)=>{carPlace(0,0,0);C.x=C.px=0;C.z=C.pz=0;C.yaw=C.pyaw=Math.PI/2;C.vx=40;C.vz=0;C.vy=0;C.y=C.py=C.gs=C.gsp=C.gf=.01;C.steer=.5;C.wyaw=0;C.grounded=1;C.drift=0;C.slip=0;C.tapN=0;C.tapT=0;C.dbK=0;C.dActive=0;IN.thr=1;IN.brk=0;IN.hand=0;IN.nitro=0;C.pitch=C.roll=0;C.slideT=0;C.handOn=0;
      let peak=0,t=0,maxK=0,tapAt=taps.slice(),score0=C.driftScore;const dt=1/120;const log=[];
      for(let s=0;s<120*8;s++){t=s*dt;let h=0;for(const a of tapAt)if(t>=a&&t<a+.12)h=1;IN.hand=h;IN.thr=C.speed<30?1:.3;carStep(dt);const ang=Math.abs(Math.atan2(C.lat,C.fwd))*57.3;if(C.speed>8&&ang>peak)peak=ang;maxK=Math.max(maxK,C.dbK);if(s%60==0)log.push([+t.toFixed(1),Math.round(ang),+C.dbK.toFixed(2),C.tapN])}
      return{peak:+peak.toFixed(1),maxK:+maxK.toFixed(2),pts:Math.round(C.driftScore-score0),end:+C.dbK.toFixed(3),tapN:C.tapN}};
    const one=run([.5]),three=run([.5,.9,1.3]),five=run([.5,.9,1.3,1.7,2.1,2.5]),slow=run([.5,3.2]);
    return{one,three,five,slow}});
  console.log(JSON.stringify(r));
  ok(r.one.maxK==0&&r.one.tapN==0,'one tap is the old drift (build-up '+r.one.maxK+', peak slide '+r.one.peak+' deg)');
  ok(r.three.peak>r.one.peak*1.25&&r.three.maxK>.35,'three quick taps slide harder: peak slide '+r.three.peak+' deg vs '+r.one.peak+' deg for one tap (build-up '+r.three.maxK+')');
  ok(r.five.peak>r.three.peak&&r.five.maxK>.8,'five taps harder still: '+r.five.peak+' deg (build-up '+r.five.maxK+')');
  ok(r.five.pts>r.one.pts*1.4,'and it scores more ('+r.five.pts+' vs '+r.one.pts+' points)');
  ok(r.slow.maxK==0,'two taps far apart (2.7 s) do not build up (build-up '+r.slow.maxK+')');
  ok(r.three.end<.1,'the build-up fades after the last tap (left over after the run: '+r.three.end+')');
  console.log('errs',T.errs.slice(0,3));ok(T.errs.length==0,'no page errors');await T.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
