const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({q:'go=1&scale=1&fixed=1',w:667,h:375,mobile:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const log=await T.ev(()=>{
    const {C,IN,UI,ROADS,carStep,carPlace}=RACER;UI.paused=true;UI.showStats=false;IN.assist=true;const out=[];
    const place=v=>{const r=ROADS.find(q=>q.id=='sh'),i=Math.round(.64*r.n),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));carPlace(r.X[i],r.Z[i],a,r.Y[i]+.5);C.vx=Math.sin(a)*v;C.vz=-Math.cos(a)*v;C.speed=v;C.steer=0;C.wyaw=0;C.drift=0;IN.hand=0;IN.thr=1;IN.nitro=0;C.nos=.3;return a};
    // (1) a slide with NO pedal: velocity 25 degrees off the heading
    {const a=place(30);const sl=25/57.3;C.vx=Math.sin(a+sl)*30;C.vz=-Math.cos(a+sl)*30;IN.hand=0;let first=-1,last=-1;for(let i=0;i<120*3;i++){carStep(1/120);if(C.dActive){if(first<0)first=i/120;last=i/120}}
      out.push('no pedal, 25 deg slide at 30 m/s: counted as a drift from '+first.toFixed(2)+' s until '+last.toFixed(2)+' s; last combo '+JSON.stringify(C.dLast))}
    // (2) a tap
    {place(30);C.steer=.6;let first=-1,last=-1;for(let i=0;i<120*3;i++){IN.hand=i<30?1:0;carStep(1/120);if(C.dActive){if(first<0)first=i/120;last=i/120}}C.steer=0;out.push('0.25 s tap with steer .6: drift counted from '+first.toFixed(2)+' to '+last.toFixed(2)+' s, points '+(C.dLast?C.dLast.pts:'(none, too short)'))}
    // (3) a long drift, then save frames for the HUD at several moments
    window.__snap=null;return out});
  log.forEach(l=>console.log(l));
  // HUD frames: live drift, held after the end, fading out, gone
  const frames=[['live',()=>{}],['held',null],['out',null],['gone',null]];
  await T.ev(()=>{const {C,IN,UI,ROADS,carStep,carPlace}=RACER;const r=ROADS.find(q=>q.id=='sh'),i=Math.round(.64*r.n),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));carPlace(r.X[i],r.Z[i],a,r.Y[i]+.5);C.vx=Math.sin(a)*34;C.vz=-Math.cos(a)*34;C.speed=34;C.steer=.7;IN.thr=1;IN.hand=0;window.__t0=0;
    for(let k=0;k<120*2;k++){IN.hand=1;C.steer=k<120?.7:-.7;carStep(1/120)}RACER.camStep(0,true);RACER.renderOnce(RACER.UI.cw,RACER.UI.ch);return 0});
  await L.sleep(200);await T.page.screenshot({path:L.SP+'/shots/dt0.png'});
  for(const [name,adv] of [['dt1',1.0],['dt2',1.95],['dt3',2.6]]){
    const info=await T.ev(([adv])=>{const {C,IN,carStep,camStep,renderOnce,UI}=RACER;IN.hand=0;C.steer=0;
      // release: run until the combo has ended, then to adv seconds after the end
      let guard=0;while(C.dActive&&guard++<120*5)carStep(1/120);const tEnd=C.dLast?C.dLast.t:C.t;while(C.t-tEnd<adv)carStep(1/120);camStep(0,true);renderOnce(UI.cw,UI.ch);return{active:C.dActive,last:C.dLast,sinceEnd:(C.t-tEnd).toFixed(2)}},[adv]);
    await L.sleep(200);await T.page.screenshot({path:L.SP+'/shots/'+name+'.png'});console.log(name,JSON.stringify(info));
  }
  console.log('errs',T.errs);await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
