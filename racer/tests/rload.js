const {launch,sleep}=require('./rlib');
(async()=>{const t0=Date.now();const L=await launch();
  await L.page.waitForFunction('window.RACER&&window.RACER.BOOT&&window.RACER.BOOT.done!==false&&window.RACER.W&&window.RACER.W.hm',{timeout:240000}).catch(e=>console.log('wait fail',e.message.slice(0,100)));
  await sleep(1500);
  const r=await L.ev(()=>({roads:RACER.ROADS.length,bridges:RACER.ROADS.filter(r=>r.br.some(x=>x)).map(r=>r.id).join(','),rails:RACER.ROADS.reduce((s,r)=>s+r.rail.reduce((a,b)=>a+b,0),0),pos:[RACER.C.x|0,RACER.C.z|0]}));
  console.log('loaded in',((Date.now()-t0)/1000).toFixed(1),'s',JSON.stringify(r));
  console.log('errors:',L.errs.length,L.errs.slice(0,6).join(' | '));
  await L.close()})().catch(e=>{console.log('ERR',e.message);process.exit(1)});
