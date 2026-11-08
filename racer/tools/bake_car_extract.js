const L=require('./lib.js'),fs=require('fs');
(async()=>{
  const T=await L.launch({name:'bake1.html',w:667,h:375});
  // run hqCar with hqWheels intercepted so wheels come out as separate meshes
  const r=await T.ev(`(()=>{
    const c=CARBY['n_nitro'];
    const saved=hqWheels;let WH=[];
    hqWheels=function(g,d,hw,at){hqWI(d,hw,at).forEach(q=>{const wg=hqWheel(q);WH.push({x:q.x,R:q.R,w:q.w,zo:q.zo,v:wg.v,i:wg.i,n:wg.n})})};
    let res;try{res=hqCar(c,'#c0392b',{})}finally{hqWheels=saved}
    const g=res.g;
    return JSON.stringify({id:c.id,n:g.n,v:g.v,i:g.i,wh:WH,gl:g.gl,hl:HQ&&HQ.hl||null})})()`);
  fs.writeFileSync('bake_nitro.json',r);
  const o=JSON.parse(r);console.log('body verts',o.n,'tris',o.i.length/3,'wheels',o.wh.map(w=>[w.x.toFixed(1),w.R.toFixed(2),w.w,w.zo.toFixed(2),w.n]));
  let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];for(let k=0;k<o.v.length;k+=14)for(let a=0;a<3;a++){mn[a]=Math.min(mn[a],o.v[k+a]);mx[a]=Math.max(mx[a],o.v[k+a])}
  console.log('bbox',mn.map(x=>x.toFixed(1)),mx.map(x=>x.toFixed(1)));
  console.log('glow pts',o.gl&&o.gl.length);
  await T.close();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
