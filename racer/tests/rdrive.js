const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const res=await T.ev(()=>{
    const {C,IN,UI,ROADS,carStep,carPlace}=RACER;UI.paused=true;const log=[];const rd=(id,f)=>{const r=ROADS.find(q=>q.id==id);const i=Math.round(f*r.n);const a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));return{r,i,a,x:r.X[i]+Math.cos(a)*r.hw*.5,z:r.Z[i]+Math.sin(a)*r.hw*.5}};
    const place=(id,f,v)=>{const p=rd(id,f);carPlace(p.x,p.z,p.a,p.r.Y[p.i]+.5);C.vx=Math.sin(p.a)*v;C.vz=-Math.cos(p.a)*v;C.steer=0;C.wyaw=0;C.nos=.6;C.drift=0;C.driftScore=0;C.driftTime=0;IN.hand=0;IN.nitro=0;IN.brk=0;IN.thr=0;IN.auto=true;return p};
    const run=(sec,fn)=>{for(let i=0;i<sec*120;i++){fn&&fn(i/120);carStep(1/120)}};
    // (a) steering sign + response on the flat southern straight at 100 km/h
    let p=place('sh',.62,28);const y0=C.yaw;run(1,()=>{C.steer=1});log.push('A: steer RIGHT 1s @100km/h -> yaw change '+((C.yaw-y0)*57.3).toFixed(1)+' deg (should be positive); lateral '+C.lat.toFixed(1)+' m/s, speed '+C.kmh.toFixed(0)+' kmh');
    p=place('sh',.62,28);const y1=C.yaw;run(1,()=>{C.steer=-1});log.push('A2: steer LEFT -> yaw change '+((C.yaw-y1)*57.3).toFixed(1)+' deg (should be negative)');
    // (b) top speed + 0-100
    p=place('sh',.7,0);let t100=0;for(let i=0;i<120*30;i++){carStep(1/120);if(!t100&&C.kmh>=100)t100=i/120}log.push('B: 0-100 km/h in '+t100.toFixed(2)+' s; speed after 30 s '+C.kmh.toFixed(0)+' kmh');
    p=place('sh',.7,0);IN.nitro=1;run(8,()=>{C.nos=1});log.push('B2: with nitro 8s -> '+C.kmh.toFixed(0)+' kmh');
    // (c) drift: 120 km/h, steer + handbrake for 1.2 s
    p=place('sh',.6,33);run(.3);run(1.2,()=>{C.steer=.8;IN.hand=1});log.push('C: drift 1.2s -> slip '+C.slip.toFixed(2)+' drift '+C.drift.toFixed(2)+' score '+C.driftScore.toFixed(0)+' nos '+C.nos.toFixed(2)+' speed '+C.kmh.toFixed(0)+' yawrate '+C.wyaw.toFixed(2));
    IN.hand=0;C.steer=0;run(1.5);log.push('C2: recovered after release: slip '+C.slip.toFixed(2)+' speed '+C.kmh.toFixed(0));
    // (d) crash into a building: drive head-on at a rotated city building from 40 m away
    {let j=0,bh=0;for(let q=0;q<QH.CO.length/7;q++){const h=QH.CO[q*7+6]-RACER.terrainH(QH.CO[q*7],QH.CO[q*7+1]);if(QH.CO[q*7+2]>8&&h>bh&&QH.CO[q*7]>-1300&&QH.CO[q*7]<-500){bh=h;j=q}}
     const ox=QH.CO[j*7],oz=QH.CO[j*7+1],hz=QH.CO[j*7+3],cs=QH.CO[j*7+4],sn=QH.CO[j*7+5];const lz=-(hz+40),sx=ox-lz*sn*-1*-1+0,sz=oz+lz*cs;
     const px=ox+0*cs-lz*sn,pz=oz+0*sn+lz*cs,yaw=Math.atan2(-sn,-cs);carPlace(px,pz,yaw,RACER.terrainH(px,pz)+1);C.vx=Math.sin(yaw)*30;C.vz=-Math.cos(yaw)*30;IN.thr=1;IN.assist=false;
     for(let k=0;k<120*3;k++){C.steer=0;IN.thr=1;carStep(1/120)}
     const dx=C.x-ox,dz=C.z-oz,lx=dx*cs+dz*sn,lzz=-dx*sn+dz*cs;log.push('D: head-on into a '+(bh|0)+' m building at 108 km/h: speed after 3 s '+C.kmh.toFixed(0)+' km/h, car outside the building: '+(Math.abs(lzz)>hz*.95||Math.abs(lx)>QH.CO[j*7+2]*.95))}
    // (g) cut bank wall: drive straight off the ring into the hill
    p=place('mp',.1,30);C.yaw=C.pyaw=p.a+1.2;C.vx=Math.sin(C.yaw)*30;C.vz=-Math.cos(C.yaw)*30;run(2);log.push('G: off the pass into the slope: speed '+C.kmh.toFixed(0)+' y '+C.y.toFixed(1)+' grounded '+C.grounded);
    // (h) water respawn
    carPlace(-2700,300,0,0);C.vx=0;C.vz=0;C.y=-5;run(3);log.push('H: dropped in the sea -> after 3 s at x '+C.x.toFixed(0)+' z '+C.z.toFixed(0)+' y '+C.y.toFixed(1));
    return log});
  console.log(res.join('\n'));await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
