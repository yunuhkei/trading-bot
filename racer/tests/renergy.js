// Energy logic tests on synthetic ground (the real groundAt/roadAt are replaced), plus drift tap/hold tests on the real map.
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const out=await T.ev(()=>{
    const {C,IN,UI,carStep,carPlace}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;const log=[];
    const G0=window.groundAt,R0=window.roadAt,TH0=window.terrainH;let H=(x,z)=>0;
    window.groundAt=(x,z,y)=>{RQ.on=1;RQ.lat=0;return H(x,z)};window.roadAt=()=>false;window.terrainH=(x,z)=>Math.min(H(x,z),50);
    const GR=24;const coast0=HND.coast;HND.coast=0;
    const reset=(x,v,y)=>{carPlace(0,0,0);C.x=C.px=x;C.z=C.pz=0;C.yaw=C.pyaw=Math.PI/2;C.vx=v;C.vz=0;C.vy=0;C.y=C.py=C.gs=C.gsp=C.gf=H(x,0)+.01;C.steer=0;C.wyaw=0;C.grounded=1;C.drift=0;C.airMax=0;C.air=0;IN.thr=0;IN.brk=0;IN.hand=0;IN.nitro=0;C.pitch=C.roll=0};
    const fwdOK=()=>Math.abs(C.vz)<.5;
    // ---- T1: coasting up and over a hill: kinetic + potential energy minus drag work stays constant ----
    {H=(x,z)=>x<100||x>500?0:30*Math.pow(Math.sin(Math.PI*(x-100)/400),2);reset(0,46,0);
      let E0=.5*46*46,work=0,maxd=0,minV=99,top=0;const dt=1/120;
      for(let i=0;i<120*40;i++){const f=C.fwd;const w=(.35+f*f*.0004)*Math.abs(f)*dt;carStep(dt);work+=w;const E=C.ke+GR*C.y+work;maxd=Math.max(maxd,Math.abs(E-E0)/E0);minV=Math.min(minV,C.speed);top=Math.max(top,C.y);if(C.x>560)break}
      log.push('T1 coast over a 30 m hill from 46 m/s: slowest '+minV.toFixed(1)+' m/s on the crest (energy alone says '+Math.sqrt(Math.max(0,46*46-2*GR*30)).toFixed(1)+', drag takes a bit more), exit speed '+C.speed.toFixed(1)+' m/s, max energy drift (E+drag work) '+(maxd*100).toFixed(1)+'%, airborne max '+C.airMax.toFixed(2)+' s')}
    // ---- T2: ballistic flight off a ramp: energy conserved in the air, landing flat loses exactly the vertical part ----
    {H=(x,z)=>x<60?0:x<80?(x-60)*.35:0;
      // ramp: slope 35% over 20 m (7 m high), then drops to the ground (a jump)
      reset(20,40,0);let launched=false,E_air0=0,E_air1=0,maxAir=0,landV=0,landVy=0,preLandF=0;const dt=1/120;let landed=false;
      for(let i=0;i<120*10;i++){const wasG=C.grounded;carStep(dt);
        if(wasG&&!C.grounded&&!launched){launched=true;E_air0=C.ke+GR*C.y;C.__f0=C.fwd}
        if(launched&&!C.grounded){E_air1=C.ke+GR*C.y;preLandF=Math.hypot(C.vx,C.vz);landVy=C.vy}
        if(launched&&C.grounded&&!landed){landed=true;landV=Math.hypot(C.vx,C.vz);break}}
      log.push('T2 ramp jump at 40 m/s: air time '+C.airMax.toFixed(2)+' s, energy at take-off '+E_air0.toFixed(0)+' -> just before landing '+E_air1.toFixed(0)+' (air drag only), speed before landing '+preLandF.toFixed(1)+' m/s, vertical '+landVy.toFixed(1)+' m/s down, after landing '+landV.toFixed(1)+' m/s (flat landing keeps its horizontal speed), KE lost in the landing '+(0.5*landVy*landVy).toFixed(0)+' J/kg')}
    // ---- T3: launch threshold over a crest of radius R: leaves the ground when v^2 / R > g ----
    for(const R of [80,150]){const thr=Math.sqrt(GR*R);H=(x,z)=>x<150?0:-(x-150)*(x-150)/(2*R);
      // flat approach, then falling parabola starting at x=150 with zero slope; crest of curvature 1/R
      const res=[];for(const k of [.6,.8,.9,1.0,1.1,1.25,1.5]){const v=thr*k;reset(140,v,0);let maxAir=0;let first=-1,ma=0;for(let i=0;i<120*6;i++){carStep(1/120);ma=Math.max(ma,C.air);if(first<0&&!C.grounded)first=C.x;if(C.x>150+R*1.5||C.y<-R*1.2)break}res.push((v*2.237).toFixed(0)+'mph:'+(first<0?'sticks':'leaves at x+'+(first-150).toFixed(0)+'m'))}
      log.push('T3 crest R='+R+' m: theory leaves above '+thr.toFixed(0)+' m/s ('+(thr*2.237).toFixed(0)+' mph) -> '+res.join(', '))}
    // ---- T4: a landing on a down slope turns the fall into speed, on an up slope it costs speed ----
    for(const m of [-.3,0,.3]){H=(x,z)=>x<200?-0.001*x*0+30:x>1e9?0:30+m*(x-200);reset(0,25,0);C.y=C.py=C.gs=C.gsp=C.gf=H(0,0)+6;C.grounded=0;C.vy=0;C.vx=25;// drop 6 m onto a slope starting under the car
      reset(300,25,0);C.y=C.py=C.gs=C.gsp=C.gf=H(300,0)+.4;C.grounded=0;C.vy=-6;const vs0=Math.hypot(25,6);let landedAt=-1;for(let i=0;i<120*3;i++){carStep(1/120);if(C.grounded&&landedAt<0){landedAt=i;break}}
      log.push('T4 landing on a '+(m*100).toFixed(0)+'% slope at 25 m/s with 6 m/s down: horizontal speed after '+C.speed.toFixed(1)+' m/s (flat gives 25.0)')}
    HND.coast=coast0;window.groundAt=G0;window.roadAt=R0;window.terrainH=TH0;
    return log});
  out.forEach(l=>console.log(l));
  console.log('errs',T.errs);await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
