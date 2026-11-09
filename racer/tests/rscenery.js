// Scenery along the roads (poles + wires, gantry signs, billboards, signs, tree belts, bushes, cacti, turbines, gas stations, farms, HV lines) and the new trees.
// Checks: it exists in the numbers a map this size should have, it is deterministic, nothing stands on the road, the extra geometry stays affordable.   usage: node racer/tests/rscenery.js
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:240,h:160,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
  const S=await T.ev(()=>{const st=R.stats,sc=st.scenery;const props=R.props;let tris=[0,0,0];for(const p of props)tris[p.cat]+=p.n/3;
    /* colliders (circles x,z,r,y0,y1) that sit on the asphalt of an open road at their own height */
    let onRoad=0,n=0;const lim=[];for(let i=0;i<COLC.length;i+=5){n++;const x=COLC[i],z=COLC[i+1],y1=COLC[i+4];if(roadAt(x,z,COLC[i+3]+.6)&&Math.abs(RQ.lat)<RQ.hw*.98&&Math.abs(RQ.y-COLC[i+3]-.5)<2.5){onRoad++;if(lim.length<5)lim.push([x|0,z|0,RQ.lat.toFixed(1)])}}
    return{stats:{b:st.buildings,h:st.houses,t:st.trees},sc:{...sc,at:undefined},tris,colliders:n,onRoad,lim,boot:RACER.BOOT.genMs}});
  const c=S.sc;
  ok(c.poles>150&&c.delin>400&&c.gantry>10&&c.bill>20&&c.sign>50,'1 roadside furniture: '+c.poles+' telegraph poles, '+c.delin+' reflector posts, '+c.gantry+' gantry signs, '+c.bill+' billboards, '+c.sign+' speed signs, '+c.chev+' curve boards, '+c.fence+' fences');
  ok(c.groves>500&&c.trees>2000&&c.bush>1000,'2 vegetation: '+c.groves+' tree belts with '+c.trees+' trees, '+c.bush+' bushes, '+c.rock+' rocks, '+c.cactus+' cacti (plus '+S.stats.t+' forest trees)');
  ok(c.turb>20&&c.gas>=3&&c.hv>10,'3 landmarks: '+c.turb+' wind turbines, '+c.gas+' gas stations, '+c.farm+' farmsteads, '+c.hv+' high-voltage pylons');
  ok(S.onRoad<=21,'4 the new scenery puts nothing solid on the asphalt: '+S.onRoad+' of '+S.colliders+' colliders sit on a road (21 is the old count, lamp posts and palms at junctions, before any scenery was added)'+(S.onRoad>21?' e.g. '+JSON.stringify(S.lim):''));
  ok(S.tris[2]<1100000&&S.tris[0]<200000&&S.tris[1]<120000,'5 prop triangles (all of the map, only what is near is drawn): furniture '+(S.tris[0]/1000).toFixed(0)+'k, buildings '+(S.tris[1]/1000).toFixed(0)+'k, trees '+(S.tris[2]/1000).toFixed(0)+'k');
  ok(S.boot<9000,'6 the world builds in '+(S.boot/1000).toFixed(1)+' s (software GL box; it was 4.5 s before the scenery)');
  /* determinism: a second page load builds the identical numbers */
  await T.close();
  const T2=await L.launch({q:'go=1&scale=.3&fixed=1',w:240,h:160,mobile:false});await T2.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  const S2=await T2.ev(()=>{const sc=R.stats.scenery;return{...sc,at:undefined}});
  ok(JSON.stringify(S2)===JSON.stringify(S.sc),'7 deterministic: a second load builds exactly the same scenery');
  console.log('errs',T2.errs.slice(0,3));ok(T2.errs.length===0,'no page errors');
  await T2.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
