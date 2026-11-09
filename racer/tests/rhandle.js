// Handling metrics. Runs scripted manoeuvres against the real physics and prints numbers.
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({file:process.env.RFILE||L.DEFAULT_FILE,q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const res=await T.ev(()=>{
    const {C,IN,UI,ROADS,carStep,carPlace}=RACER;UI.paused=true;const log=[];if(window.__nocol!==0)QH.cst.fill(0);ROADS.forEach(r=>r.rail.fill(0));
    const straight=(id,f)=>{const r=ROADS.find(q=>q.id==id);const i=Math.round(f*r.n);const a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));return{r,i,a,x:r.X[i]+Math.cos(a)*r.hw*.4,z:r.Z[i]+Math.sin(a)*r.hw*.4}};
    const place=(id,f,v,assist)=>{const p=straight(id,f);carPlace(p.x,p.z,p.a,p.r.Y[p.i]+.5);C.vx=Math.sin(p.a)*v;C.vz=-Math.cos(p.a)*v;C.steer=0;C.wyaw=0;C.nos=.5;C.drift=0;C.driftScore=0;C.driftTime=0;IN.hand=0;IN.nitro=0;IN.brk=0;IN.thr=1;IN.auto=false;IN.assist=assist!=null?assist:false;return p};
    const sim=(sec,fn)=>{const o={maxSlip:0,maxLat:0,air:0,n:0,minSpeed:1e9,maxWy:0};for(let i=0;i<sec*120;i++){fn&&fn(i/120);C.thr=1;carStep(1/120);o.n++;if(!C.grounded)o.air++;const sl=Math.atan2(Math.abs(C.lat),Math.max(Math.abs(C.fwd),1))*57.3;if(sl>o.maxSlip)o.maxSlip=sl;const al=Math.abs(C.wyaw)*C.speed;if(al>o.maxLat)o.maxLat=al;o.minSpeed=Math.min(o.minSpeed,C.speed);o.maxWy=Math.max(o.maxWy,Math.abs(C.wyaw))}return o};
    const fmt=o=>'maxSlip '+o.maxSlip.toFixed(1)+' deg, peak lateral accel '+(o.maxLat/9.81).toFixed(2)+' g, max yawrate '+o.maxWy.toFixed(2)+', airborne '+(100*o.air/o.n).toFixed(0)+'% of frames';
    // 1: full-lock steer for 1.5 s at various speeds on the straight highway (no assist)
    for(const kmh of [60,100,150,200]){place('sh',.64,kmh/3.6);sim(.4);const y0=C.yaw;const o=sim(1.5,()=>{C.steer=1});log.push('hard-right '+kmh+' km/h: '+fmt(o)+', turned '+((C.yaw-y0)*57.3).toFixed(0)+' deg, speed now '+C.kmh.toFixed(0))}
    // 2: half stick
    for(const kmh of [100,200]){place('sh',.64,kmh/3.6);sim(.4);const o=sim(1.5,()=>{C.steer=.4});log.push('half-right '+kmh+' km/h: '+fmt(o))}
    // 3: flick left-right at 150 (slalom)
    place('sh',.64,150/3.6);sim(.4);let o=sim(4,t=>{C.steer=Math.sin(t*2.5)>0?1:-1});log.push('slalom 150 km/h: '+fmt(o)+' speed now '+C.kmh.toFixed(0));
    // 4: drift: handbrake + steer at 120 for 1.5 s, then release and see how long to straighten
    place('sh',.64,120/3.6);sim(.4);o=sim(1.5,()=>{C.steer=.7;IN.hand=1});const dslip=C.slip;log.push('handbrake drift 120 km/h: '+fmt(o)+' slip at end '+(Math.atan(dslip)*57.3).toFixed(0)+' deg, speed '+C.kmh.toFixed(0));
    IN.hand=0;C.steer=0;let t=0;for(let i=0;i<360;i++){carStep(1/120);t=i/120;if(Math.atan(C.slip)*57.3<3)break}log.push('  after release: slip < 3 deg in '+t.toFixed(2)+' s');
    // 5: brake from 200 km/h
    place('sh',.64,200/3.6);sim(.2);IN.brk=1;let bt=0;for(let i=0;i<120*10;i++){IN.thr=0;carStep(1/120);if(C.kmh<5){bt=i/120;break}}IN.brk=0;log.push('brake 200->0: '+bt.toFixed(2)+' s');
    // 6: hands-off 40 s with assist on, ring road: airborne fraction and still on the road?
    place('ring',.1,110/3.6,true);o=sim(40,()=>{C.steer=0});log.push('hands-off 40s on ring with assist: '+fmt(o)+' on road '+C.onRoad+' speed '+C.kmh.toFixed(0));
    // 7: weave on the ring, normal driving feel
    place('ring',.3,120/3.6,true);o=sim(8,t=>{C.steer=.5*Math.sin(t*1.6)});log.push('gentle weave ring 120: '+fmt(o));
    return log});
  console.log(res.join('\n'));console.log('errs',T.errs);await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
