// Cost of the traffic: draw calls and triangles with and without it at the same camera spots (667x375), and the JS time of one 60 Hz traffic tick.
// (This browser renders in software on a server CPU, so no frame time is shown: it would say nothing about a phone's GPU. Draws, triangles and the JS cost carry over.)
const L=require('./rlib.js');
const spots=[['sfnu3',.43,'downtown'],['lau1',.5,'valley'],['ring',.3,'ring'],['sh',.4,'southern highway'],['bigu1',.5,'Big Pines']];
(async()=>{
  const T=await L.launch({q:'go=1&scale=1&fixed=1',w:667,h:375,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  console.log('lane graph build '+(await T.ev(()=>BOOT.lgMs)).toFixed(0)+' ms on this machine; map boot '+(await T.ev(()=>BOOT.genMs/1000)).toFixed(1)+' s');
  console.log('place'.padEnd(18)+'cars  drawn | draws (off -> on)  triangles (off -> on)  | cpu per traffic tick (ms)');
  for(const [id,f,label] of spots){
    const r=await T.ev(([id,f])=>{const {C,ROADS,R,TR,UI,LG}=RACER;UI.paused=true;window.camStep=function(){};const r=ROADS.find(q=>q.id==id);let i=Math.max(20,Math.min(r.n-24,Math.round(f*r.n)));{const near=q=>{for(const g of(LG.jg[ROADS.indexOf(r)*2]||[]))if(Math.abs(g.foot-q)<16)return true;for(const g of(LG.jg[ROADS.indexOf(r)*2+1]||[]))if(Math.abs((r.n-1-g.foot)-q)<16)return true;return false};for(let d=0;d<200&&near(i);d++)i=Math.max(20,Math.min(r.n-24,i+(d%2?d:-d)))}
      const a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));TR.on=true;TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;trInit();RACER.carPlace(r.X[i]+Math.cos(a)*(r.hw*.5),r.Z[i]+Math.sin(a)*(r.hw*.5),a,r.Y[i]+.5);
      const x0=C.x,z0=C.z,y0=C.y;TR.stat.msSum=0;TR.stat.ticks=0;TR.ms=0;
      for(let s=0;s<40*120;s++){RACER.worldStep(1/120);C.x=C.px=x0;C.z=C.pz=z0;C.y=C.py=y0;C.vx=C.vz=0;C.wyaw=0}
      RACER.camStep(0,true);R.alpha=1;const gl=G.gl;const meas=()=>{RACER.renderOnce(UI.cw,UI.ch);gl.finish();const t=performance.now();for(let k=0;k<6;k++){RACER.renderOnce(UI.cw,UI.ch)}gl.finish();return[R.draws,R.tris,(performance.now()-t)/6]};
      const on=meas(),n=TR.nAlive,drawn=TR.drawn;TR.on=false;const off=meas();TR.on=true;
      return{n,drawn,on,off,cpu:TR.stat.msSum/Math.max(1,TR.stat.ticks)}},[id,f]);
    console.log(label.padEnd(18)+String(r.n).padEnd(6)+String(r.drawn).padEnd(7)+'| '+(r.off[0]+' -> '+r.on[0]).padEnd(17)+(Math.round(r.off[1]/1000)+'k -> '+Math.round(r.on[1]/1000)+'k').padEnd(22)+'| '+r.cpu.toFixed(3))}
  console.log('errs',T.errs);await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
