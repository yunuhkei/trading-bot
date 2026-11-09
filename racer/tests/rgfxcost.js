// What each graphics effect costs: the same three views rendered with one effect switched on at a time. Measured with SwiftShader (the CPU draws the frame), so this shows the RELATIVE weight of
// each effect and how many extra draw calls it adds, NOT phone milliseconds: a real phone GPU has to be measured on the phone. QUICK=1 uses fewer repeats (about 2 minutes, otherwise 4).
const L=require('./rlib.js');
(async()=>{
  /* ---- 8 what each effect costs (software GL, relative) ---- */
  const T2=await L.launch({q:'go=1&scale=1&tier=0',w:667,h:375,mobile:false,traffic:true});
  await T2.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  await T2.ev(()=>{const {UI}=RACER;UI.paused=true;UI.showStats=false;window.place=(id,f)=>{const {C,ROADS}=RACER;const r=ROADS.find(q=>q.id==id),i=Math.max(1,Math.round(f*r.n)),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));RACER.carPlace(r.X[i]+Math.cos(a)*r.hw*.5,r.Z[i]+Math.sin(a)*r.hw*.5,a,r.Y[i]+.5);RACER.camStep(0,true)};
    window.tms=(n)=>{const gl=RACER.G.gl,px=new Uint8Array(4),a=[];for(let k=0;k<n+1;k++){const t0=performance.now();RACER.renderOnce(RACER.UI.cw,RACER.UI.ch);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);if(k)a.push(performance.now()-t0)}a.sort((x,y)=>x-y);return a[a.length>>1]};
    /* a custom tier in slot 2: Low's settings plus overrides */
    window.GORIG=RACER.GFXT.slice();window.setCfg=(o,post)=>{const {GFXT,GFX}=RACER;GFXT[2]=Object.assign({},GFXT[0],{name:'custom',cost:1,scMin:1,scMax:1},o);GFX.fixed=true;GFX.ok=post!==false;RACER.gfxSetTier(2,true);RACER.Q.scale=1;RACER.Q.apply();GFX.blurAmt=o&&o.blur?.6:0}});
  const spots=[['ring',.3],['sfnu3',.45],['btp',.5]],N=process.env.QUICK?4:9;
  const cfgs=[['direct to the canvas (no post pass), Low settings',{},false],['+ post pass with FXAA (Low)',{}],['+ speed blur on (40 m/s)',{blur:1}],['+ bloom (quarter res, 2 blur passes)',{bloom:1}],['+ shadows Medium (512, cars)',{shadow:1}],['+ shadows High (1024, cars + props)',{shadow:2}],
    ['wet-road lights 1 (instead of 4)',{NL:1}],['wet-road lights 8',{NL:8}],['no lamp/neon glows (glow 0, pools 0)',{glow:0,pool:0}],['glows 80 + pools 16',{glow:80,pool:16}],['sky third cloud octave (HI)',{hi:1}],
    ['TIER Low as shipped',null,'t0'],['TIER Medium as shipped',null,'t1'],['TIER High as shipped',null,'t2']];
  const base={};console.log('\ncost of each effect, SwiftShader, 667x375 at scale 1, median of '+N+' frames at 3 places (ms per frame; draws; triangles)');
  const rows=[];
  for(const [name,o,tier] of cfgs){let sum=0,dr=0,tr=0;const per=[];
    for(const [id,f] of spots){const r=await T2.ev(([o,tier,id,f,N,name])=>{if(tier){RACER.GFXT[2]=GORIG[2];RACER.GFX.ok=true;RACER.GFX.fixed=true;RACER.gfxSetTier(+tier[1],true);RACER.GFX.blurAmt=tier=='t0'?0:.6;RACER.Q.scale=1;RACER.Q.apply()}else setCfg(o,!name.startsWith('direct'));place(id,f);const ms=tms(N);return{ms,d:RACER.R.draws,t:RACER.R.tris}},[o,tier,id,f,N,name]);per.push(r.ms);sum+=r.ms;dr+=r.d;tr+=r.t}
    rows.push({name,ms:sum/3,draws:dr/3,tris:tr/3,per});}
  const fx=rows[1].ms,pad=(t,n)=>String(t).padStart(n);
  console.log('(effect rows are measured with the post pass on, so they are compared with the "post pass + FXAA" row)');
  rows.forEach((r,k)=>{const base=k<2?rows[0].ms:(k<11?fx:rows[0].ms),lab=k<2?'direct':(k<11?'FXAA row':'direct');
    console.log(r.name.padEnd(54)+pad(r.ms.toFixed(0)+' ms',8)+'  '+pad((r.ms>=base?'+':'')+(r.ms-base).toFixed(0)+' ms vs '+lab,22)+pad(Math.round(r.draws)+' draws',12)+pad(Math.round(r.tris/1000)+'k tris',10))});
  await T2.close();
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
