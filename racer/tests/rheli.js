// (batch 79) the helicopter alone at four stars: a car at 89 mph is followed until its fuel runs out; one at 157 mph gets out of its sight and loses the heat.  usage: RFILE=<built file> node racer/tests/rheli.js
const L=require('./rlib.js');
(async()=>{const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:300,h:200,mobile:false,traffic:true});
await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});
for(const v of [40,70]){const o=await T.ev((v)=>{const r=ROADS.find(q=>q.id=='ring'),n=r.n;let idx=Math.round(n*.3);const a=Math.atan2(r.X[idx+1]-r.X[idx],-(r.Z[idx+1]-r.Z[idx]));
  TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;copClear(true);HELI.nextT=0;RACER.carPlace(r.X[idx]+Math.cos(a)*5.5,r.Z[idx]+Math.sin(a)*5.5,a,r.Y[idx]+.5);C.vx=Math.sin(a)*v;C.vz=-Math.cos(a)*v;
  const t=COP.D.thr;copCall();COP.heat=4;COP.w=t[4]+20;COP.sightT=0;COP.callT=30;heliSpawn(0);HELI.list[0].x=C.x+30;HELI.list[0].z=C.z;
  let lost=-1,heatDrop=-1,maxD=0;for(let s=0;s<120*90;s++){let bi=idx,bd=1e18;for(let k=-6;k<=30;k++){const i=((idx+k)%n+n)%n,d=(r.X[i]-C.x)**2+(r.Z[i]-C.z)**2;if(d<bd){bd=d;bi=i}}idx=bi;
    const look=Math.max(6,C.speed*.7),ti=((bi+Math.round(look/r.ds))%n+n)%n,tj=(ti+1)%n,ta=Math.atan2(r.X[tj]-r.X[ti],-(r.Z[tj]-r.Z[ti]));C.steer=Math.max(-1,Math.min(1,angd(Math.atan2(r.X[ti]+Math.cos(ta)*5.5-C.x,-(r.Z[ti]+Math.sin(ta)*5.5-C.z)),C.yaw)*2.2));
    IN.thr=C.speed<v?1:0;IN.brk=0;C.flatT=0;C.shield=1;COP.bust=0;COP.spawnT=99;for(const c of TR.cars)if(c.alive&&c.kind==1)trKill(c,0);SPIKE.list.length=0;
    RACER.worldStep(1/120);const h=HELI.list.find(q=>!q.leave);if(h){maxD=Math.max(maxD,Math.hypot(h.x-C.x,h.z-C.z));if(!h.lock&&lost<0)lost=s/120}if(COP.heat<4&&heatDrop<0)heatDrop=s/120;if(COP.heat==0)break}
  return{mph:Math.round(v*2.237),lostSight:+lost.toFixed(1),heatFading:+heatDrop.toFixed(1),heatNow:COP.heat,maxD:Math.round(maxD)}},v);console.log(JSON.stringify(o))}
await T.close()})();
