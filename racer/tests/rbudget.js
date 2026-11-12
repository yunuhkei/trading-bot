// Frame budgets: draw calls and triangles at fixed places on the three tiers. The limits are what the build that held a steady 60 fps on an iPhone SE drew at these places
// (commit c02a69c, measured by this script: the WORLD without traffic, which is deterministic; the numbers in the README's old "Graphics baseline" were older and lower).
// Traffic is reported too (it varies with which cars are near). `RFILE=old.html node racer/tests/rbudget.js` measures another build to compare.
const L=require('./rlib.js');
const PLACES=[['sfnu3',.43,'downtown'],['market',.5,'Market St'],['lau1',.5,'Valley'],['ring',.3,'ring'],['ring',.62,'ring jumps'],['mp',.2,'mountain pass'],['cr',.55,'coast'],['psu1',.5,'Palm Springs'],['btp',.3,'Santa Cruz'],['eh',.02,'ring crossroads'],['vegm',.5,'Las Vegas'],['sacm',.5,'Sacramento'],['sjm',.4,'San Jose']].concat(process.env.EXTRA?JSON.parse(process.env.EXTRA):[]);
const LIM=JSON.parse(process.env.LIM||'[[146,113],[210,160],[240,167]]');   /* world only, worst place per tier: [draws, thousand triangles] */
(async()=>{
  const T=await L.launch({q:'go=1&scale=.5&fixed=1',w:667,h:375,mobile:true,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const res=await T.ev((PLACES)=>{const {C,UI,ROADS,R,GFX,TR}=RACER,out=[];UI.paused=true;
    for(let tier=0;tier<3;tier++){RACER.gfxSetMode(tier==0?'low':'high');RACER.gfxSetTier(tier);
      for(const[id,f,name]of PLACES){const r=ROADS.find(q=>q.id==id);if(!r)continue;const i=Math.max(2,Math.min(r.n-3,Math.round(f*r.n))),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));
        RACER.carPlace(r.X[i]+Math.cos(a)*r.hw*.4,r.Z[i]+Math.sin(a)*r.hw*.4,a,r.Y[i]+.5);TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;RACER.trInit();
        const x0=C.x,z0=C.z;for(let s=0;s<120*6;s++){RACER.worldStep(1/120);C.x=C.px=x0;C.z=C.pz=z0;C.vx=C.vz=C.vy=0;C.wyaw=0}
        RACER.camStep(0,true);R.alpha=1;RACER.renderOnce(UI.cw,UI.ch);RACER.renderOnce(UI.cw,UI.ch);const d1=R.draws,t1=R.tris,cars=TR.nAlive;
        TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;RACER.renderOnce(UI.cw,UI.ch);RACER.renderOnce(UI.cw,UI.ch);
        out.push({tier,name,draws:R.draws,tris:Math.round(R.tris/1000),drawsT:d1,trisT:Math.round(t1/1000),cars})}}
    return out},PLACES);
  let bad=0;const names=['Low','Medium','High'];
  for(let t=0;t<3;t++){const rows=res.filter(r=>r.tier==t),md=Math.max(...rows.map(r=>r.draws)),mt=Math.max(...rows.map(r=>r.tris)),ok=md<=LIM[t][0]&&mt<=LIM[t][1];if(!ok)bad++;
    console.log((ok?'ok   ':'FAIL ')+names[t].padEnd(7)+'world: worst '+md+' draws (limit '+LIM[t][0]+'), '+mt+'k triangles (limit '+LIM[t][1]+'k);  with traffic: worst '+Math.max(...rows.map(r=>r.drawsT))+' draws, '+Math.max(...rows.map(r=>r.trisT))+'k triangles');
    console.log('      '+rows.map(r=>r.name+' '+r.draws+'/'+r.tris+'k').join('  '))}
  console.log('errs',T.errs.length?T.errs:0);await T.close();process.exit(bad||T.errs.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
