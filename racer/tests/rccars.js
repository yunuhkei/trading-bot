// The Close Call cars (batch 2, 73_ccars.js): every design builds into a sane mesh, the drivable ones are in the roster, drive and brake like their kind, sit on their wheels; traffic bodies.
// Screenshots: node racer/tests/rcarshot.js <roster index ...> (the CC cars are at the end of the roster).
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const r=await T.ev(()=>{const out={designs:[],roster:[]};
    for(const k of Object.keys(CC_DES)){const t0=performance.now(),B=ccBuild(k),ms=performance.now()-t0,b=B.body;let fin=true,bad=0;for(let i=0;i<b.P.length;i++)if(!isFinite(b.P[i]))fin=false;for(const i of b.I)if(i<0||i>=b.nv)bad++;
      let y0=1e9,y1=-1e9;for(let v=0;v<b.nv;v++){y0=Math.min(y0,b.P[v*3+1]);y1=Math.max(y1,b.P[v*3+1])}
      out.designs.push({k,n:CC_DES[k].n,tris:(b.I.length/3+B.wheelF.I.length/3*2+B.wheelR.I.length/3*2)|0,fin,bad,ms:+ms.toFixed(1),L:+B.S.L.toFixed(2),W:+B.S.W.toFixed(2),H:+B.S.H.toFixed(2),low:+y0.toFixed(2),high:+y1.toFixed(2),wf:+B.S.rf.toFixed(2)})}
    const {C,IN,UI,ROADS,carStep,carPlace,CAR_ROSTER}=RACER;UI.paused=true;QH.cst.fill(0);ROADS.forEach(r=>r.rail.fill(0));const sh=ROADS.find(q=>q.id=='sh'),i0=Math.round(.64*sh.n),a=Math.atan2(sh.X[i0+1]-sh.X[i0],-(sh.Z[i0+1]-sh.Z[i0]));
    for(let i=0;i<CAR_ROSTER.length;i++){const d=CAR_ROSTER[i];if(!d.cc)continue;RACER.carSelect(i);carPlace(sh.X[i0]-Math.cos(a)*3,sh.Z[i0]-Math.sin(a)*3,a,sh.Y[i0]+.5);IN.assist=false;IN.brk=0;IN.hand=0;C.steer=0;
      let t=0;IN.thr=1;while(C.speed<27.78&&t<20){carStep(1/120);t+=1/120}IN.thr=0;IN.brk=1;const x0=C.x,z0=C.z;let k=0;while(C.speed>.3&&k<1200){carStep(1/120);k++}IN.brk=0;
      out.roster.push({i,n:d.name,t100:+t.toFixed(2),stop:+Math.hypot(C.x-x0,C.z-z0).toFixed(1),ok:CARM.body&&CARM.body.n>0})}
    RACER.carSelect(carIndex('k1'));return out});
  for(const d of r.designs)ok(d.fin&&!d.bad&&d.tris>500&&d.tris<9000&&d.L>3.5&&d.L<11.5&&d.H>.8&&d.H<3.2&&d.low>-.12,d.k.padEnd(11)+' '+d.n.padEnd(18)+' '+d.tris+' triangles (with wheels), '+d.L+' x '+d.W+' x '+d.H+' m, built in '+d.ms+' ms'+(d.fin&&!d.bad?'':' NOT FINITE / BAD INDEX '+d.bad)+', lowest point '+d.low+' m');
  ok(r.roster.length==24,r.roster.length+' Close Call cars you can drive (roster '+r.roster[0].i+'-'+r.roster[r.roster.length-1].i+')');
  for(const c of r.roster)ok(c.ok&&c.t100>1.5&&c.t100<7&&c.stop>10&&c.stop<26,'#'+c.i+' '+c.n.padEnd(22)+' 0-100 km/h '+c.t100+' s, 100-0 '+c.stop+' m');
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
