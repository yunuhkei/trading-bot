// Drive-through repair shops (batch 7): where they are, that the way through is clear (no rail, tree, post or building in the bay or its approaches), and that driving through fixes the car.
// usage: node racer/tests/rrepair.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:240,h:160,mobile:false,traffic:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const R=await T.ev(()=>{const {C,UI,IN}=RACER;UI.paused=true;IN.assist=false;const out=[];
    for(const p of REPAIRS){const o={id:p.id,road:p.road};const r=ROADS.find(q=>q.id==p.road);
      /* the bay and both approaches are free of colliders (except its own walls) */let blk=0;for(let a=-p.L*.5-10;a<=p.L*.5+10;a+=1)for(const b of[-1.6,0,1.6]){const x=p.x+p.cs*a-p.sn*b,z=p.z+p.sn*a+p.cs*b;if(trStatic(x,z,.6,terrainH(x,z)+.5))blk++}o.blocked=blk;
      /* no guard rail on the road beside it */roadAt(p.x+p.sn*p.side*8,p.z-p.cs*p.side*8,p.y+1);let rail=0;const sg=p.side;for(let a=-35;a<=35;a+=2){const x=p.x+p.cs*a+p.sn*p.side*(r.hw+RSH+6.5),z=p.z+p.sn*a-p.cs*p.side*(r.hw+RSH+6.5);if(roadAt(x,z,p.y+1)&&RQ.rail&((RQ.nx*-p.sn+RQ.nz*p.cs)*p.side>0?2:1))rail++}o.rail=rail;
      /* drive in from the road: start on the road 25 m before, steer to the near opening, then through */
      dmgReset();const yaw=Math.atan2(p.cs,-p.sn),nx=-p.sn,nz=p.cs,off=r.hw+RSH+6.5;{const sx=p.x-p.cs*(p.L/2+40)-nx*p.side*(off-r.hw*.5),sz=p.z-p.sn*(p.L/2+40)-nz*p.side*(off-r.hw*.5);let bi=0,bd=1e18;for(let i=0;i<r.n;i++){const d=(r.X[i]-sx)**2+(r.Z[i]-sz)**2;if(d<bd){bd=d;bi=i}}const t=_tan(r,bi),sg=(t[0]*p.cs+t[1]*p.sn)>0?1:-1;RACER.carPlace(r.X[bi]-t[1]*p.side*r.hw*.5,r.Z[bi]+t[0]*p.side*r.hw*.5,Math.atan2(t[0]*sg,-t[1]*sg),r.Y[bi]+.5)}   /* start on the road, in its direction, 40 m before the shop */
      DMG.total=4e5;DMG.z[0]=.5;C.flatT=5;C.vx=p.cs*13;C.vz=p.sn*13;let fixed=-1;const imp0=IMP.n;
      for(let s=0;s<120*6;s++){const dx=C.x-p.x,dz=C.z-p.z,a=dx*p.cs+dz*p.sn,ta=a<-p.L/2-5?-p.L/2-2:Math.min(a+9,p.L),tx=p.x+p.cs*ta,tz=p.z+p.sn*ta;   /* line up on the opening first, then straight through */C.steer=clamp(angd(Math.atan2(tx-C.x,-(tz-C.z)),C.yaw)*1.8,-1,1);IN.thr=C.speed<13?1:0;RACER.worldStep(1/120);if(fixed<0&&DMG.total==0&&C.flatT==0)fixed=s/120;if(a>p.L/2+4)break}   /* through and out: the test ends (beyond the apron is just the countryside) */
      o.fixed=+fixed.toFixed(1);o.hits=IMP.q.slice(-(IMP.n-imp0)||IMP.q.length).filter(q=>IMP.n>imp0&&q.vn>3).length;o.src=IMP.q.slice(-(IMP.n-imp0)).map(q=>q.src+":"+(q.vn||0).toFixed(1)).join(" ");o.end=+(((C.x-p.x)*p.cs+(C.z-p.z)*p.sn)).toFixed(0);out.push(o)}
    return{out,n:REPAIRS.length,minD:Math.min(...REPAIRS.map((p,i)=>Math.min(...REPAIRS.filter((q,j)=>j!=i).map(q=>Math.hypot(p.x-q.x,p.z-q.z)))))}});
  for(const o of R.out)console.log('     '+JSON.stringify(o));
  ok(R.n>=10,R.n+' repair shops on the map (at least '+Math.round(R.minD)+' m apart)');
  ok(R.out.every(o=>o.blocked==0),'the bay and its approaches are clear of posts, trees and buildings');
  ok(R.out.every(o=>o.rail==0),'no guard rail between the road and any shop');
  ok(R.out.every(o=>o.fixed>0&&o.hits==0),'leaving the road and driving through fixes the car (health, dents, tyres) at every shop, without hitting anything (a scrape under 11 km/h on a wall is allowed)');
  console.log('errs',T.errs.length?T.errs.slice(0,3):0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
