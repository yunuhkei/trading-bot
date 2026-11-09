// Graphics (phase 4): tiers, post pass, shadows, lights, effects, the automatic quality choice, and what each effect costs in software GL.
// (what each effect costs is measured by rgfxcost.js)
const L=require('./rlib.js');
let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=1&tier=1',w:667,h:375,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  const ev=T.ev;
  await ev(()=>{const {UI}=RACER;UI.paused=true;UI.showStats=false;window.place=(id,f,run)=>{const {C,ROADS}=RACER;const r=ROADS.find(q=>q.id==id),i=Math.max(1,Math.round(f*r.n)),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));RACER.carPlace(r.X[i]+Math.cos(a)*r.hw*.5,r.Z[i]+Math.sin(a)*r.hw*.5,a,r.Y[i]+.5);RACER.camStep(0,true)};
    window.shot=()=>{RACER.renderOnce(RACER.UI.cw,RACER.UI.ch);const gl=RACER.G.gl;return gl.getError()};
    window.tms=(n)=>{const gl=RACER.G.gl,px=new Uint8Array(4),a=[];for(let k=0;k<n+1;k++){const t0=performance.now();RACER.renderOnce(RACER.UI.cw,RACER.UI.ch);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);if(k)a.push(performance.now()-t0)}a.sort((x,y)=>x-y);return a[a.length>>1]}});

  /* ---- 1 the three tiers ---- */
  for(const t of[0,1,2]){
    const r=await ev(t=>{RACER.GFX.fixed=true;RACER.gfxSetTier(t,true);place('ring',.3);const e=shot();const {GFX,SHD,R}=RACER;return{err:e,name:GFX.cur.name,fbo:!!GFX.fbo,bloom:!!GFX.bl[0],shadowOn:GFX.shadowOn,shres:SHD.res,draws:R.draws,tris:R.tris,scale:RACER.Q.scale,tmax:RACER.TR.max,nl:GFX.nlt,blur:GFX.cur.blur,bl:GFX.cur.bloom}},t);
    ok(r.err==0&&r.fbo,`tier ${t} (${r.name}): renders, GL error ${r.err}, off-screen target ${r.fbo}, ${r.draws} draws, ${Math.round(r.tris/1000)}k tris, traffic cap ${r.tmax}, ${r.nl} lights on the wet road`);
    if(t==0)ok(!r.shadowOn&&!r.bloom,'  Low: no shadow map, no bloom buffers');
    if(t==1)ok(r.shadowOn&&r.shres==512&&!r.bloom,'  Medium: 512 shadow map, no bloom buffers');
    if(t==2)ok(r.shadowOn&&r.shres==1024&&r.bloom,'  High: 1024 shadow map, bloom buffers');}
  const tm=await ev(()=>[RACER.GFXT[0].traf,RACER.GFXT[1].traf,RACER.GFXT[2].traf]);ok(tm[0]==1&&tm[2]>tm[1],`  stronger tiers get more traffic (x${tm.join(', x')})`);

  /* ---- 2 the picture: gloomy, desaturated, not blown out, not crushed ---- */
  for(const [id,f] of[['ring',.3],['sfnu3',.45],['mp',.3],['btp',.5]]){
    const r=await ev(([id,f])=>{RACER.GFX.fixed=true;RACER.gfxSetTier(1,true);place(id,f);shot();const gl=RACER.G.gl,w=RACER.UI.cw,h=RACER.UI.ch,px=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
      let sl=0,ss=0,clip=0,dark=0,n=0,sky=0,ns=0;for(let y=0;y<h;y+=3)for(let x=0;x<w;x+=3){const k=(y*w+x)*4,r=px[k]/255,g=px[k+1]/255,b=px[k+2]/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b);n++;sl+=.299*r+.587*g+.114*b;ss+=mx>0?(mx-mn)/mx:0;if(mx>.98)clip++;if(mx<.03)dark++;if(y>h*.7){}}
      return{luma:sl/n,sat:ss/n,clip:clip/n,dark:dark/n}},[id,f]);
    ok(r.luma>.16&&r.luma<.62&&r.sat<.36&&r.clip<.05&&r.dark<.04,`picture at ${id}: mean brightness ${r.luma.toFixed(2)}, mean saturation ${r.sat.toFixed(2)} (gloomy = low), clipped ${(r.clip*100).toFixed(1)} %, crushed ${(r.dark*100).toFixed(1)} %`)}

  /* ---- 3 lights: lamps, neon, the nearest-lamp search, the wet-road light list ---- */
  const lt=await ev(()=>{const {LAMPS,NEONS,GFX,C}=RACER;place('sfnu3',.45);shot();
    /* brute force nearest 4 lamps vs the grid search used by the renderer */
    const x=C.x,z=C.z;const all=[];for(let i=0;i<LAMPS.length;i+=3){const dx=LAMPS[i]-x,dz=LAMPS[i+2]-z;all.push([dx*dx+dz*dz,i])}all.sort((a,b)=>a[0]-b[0]);
    const near=window.nearLamps?null:null;return{lamps:LAMPS.length/3,neons:NEONS.length/7,lt:Array.from(GFX.lt.slice(0,32)),lc:Array.from(GFX.lc.slice(0,24)),nlt:GFX.nlt,brute:all.slice(0,3).map(a=>Math.round(Math.sqrt(a[0])))}});
  ok(lt.lamps>800,`${lt.lamps} street lamps with glowing heads`);ok(lt.neons>60,`${lt.neons} neon signs on the downtown and Valley buildings`);
  ok(lt.nlt>=4&&lt.lt[3]>0&&lt.lt.slice(0,4).every(Number.isFinite),`the wet road gets ${lt.nlt} lights (the car's headlight pool first, then tail light, lamps, traffic)`);
  const nn=await ev(()=>{const {C,LAMPS}=RACER;const res=[];for(const [id,f] of[['ring',.3],['sfnu3',.45],['mp',.3]]){place(id,f);const x=C.x,z=C.z,fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw);
      /* the renderer's search (gfxNearLamps) against a brute-force scan with the same score */
      const sc=i=>{const dx=LAMPS[i]-x,dz=LAMPS[i+2]-z;return dx*dx+dz*dz-(dx*fx+dz*fz)*6};const all=[];for(let i=0;i<LAMPS.length;i+=3){const dx=LAMPS[i]-x,dz=LAMPS[i+2]-z;if(dx*dx+dz*dz<=110*110)all.push([sc(i),i])}all.sort((a,b)=>a[0]-b[0]);
      const k=gfxNearLamps(x,z,110,5,fx,fz);const got=[];for(let i=0;i<k;i++)got.push(_lampPick[i]);res.push({id,same:all.slice(0,5).map(a=>a[1]).join()==got.join(),n:k})}return res});
  ok(nn.every(r=>r.same),`nearest-lamp search matches a brute-force scan (${nn.map(r=>r.id+':'+r.n).join(', ')})`);

  /* ---- 4 shadows: the map is made, it holds casters, the grid does not shimmer as the car moves ---- */
  const sh=await ev(()=>{RACER.GFX.fixed=true;RACER.gfxSetTier(2,true);place('sfnu3',.45);shot();const {SHD,G}=RACER,gl=G.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,SHD.fbo);const n=SHD.res,px=new Uint8Array(n*n*4);gl.readPixels(0,0,n,n,gl.RGBA,gl.UNSIGNED_BYTE,px);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    let hit=0;for(let k=0;k<px.length;k+=4)if(px[k]!=255||px[k+1]!=255)hit++;
    /* texel stability: where does a fixed world point land in the map, for a car moved by 5 cm and by 3 texels? */
    const P=[-900,40,60],tex=2*SHD.half/SHD.res;const pix=()=>{const m=SHD.LP,x=m[0]*P[0]+m[4]*P[1]+m[8]*P[2]+m[12],y=m[1]*P[0]+m[5]*P[1]+m[9]*P[2]+m[13];return[(x*.5+.5)*SHD.res,(y*.5+.5)*SHD.res]};
    const out=[];const {C}=RACER;const x0=C.x;for(const dx of[0,.05,.11,tex*3]){C.px=C.x=x0+dx;shot();out.push(pix())}C.px=C.x=x0;
    return{hit,res:SHD.res,tex,out,err:gl.getError()}});
  ok(sh.hit>2000&&sh.err==0,`shadow map ${sh.res}: ${sh.hit} texels hold casters (cars, buildings, trees, lamps), GL error ${sh.err}`);
  const fr=v=>v-Math.floor(v);const d1=Math.max(Math.abs(fr(sh.out[1][0])-fr(sh.out[0][0])),Math.abs(fr(sh.out[2][0])-fr(sh.out[0][0])),Math.abs(fr(sh.out[1][1])-fr(sh.out[0][1])),Math.abs(fr(sh.out[2][1])-fr(sh.out[0][1])));
  ok(d1<.01||d1>.99,`shadow grid is anchored to the world: moving the car 5 and 11 cm (texel ${(sh.tex*100).toFixed(1)} cm) shifts a fixed point by ${d1.toFixed(4)} texel (fraction), no shimmer`);

  /* ---- 5 effects: sparks on a crash, tyre spray on the wet road at speed, glows, a siren ---- */
  const fx=await ev(()=>{const {C,IMP,SPARK,SMOKE,R,TR}=RACER;RACER.GFX.fixed=true;RACER.gfxSetTier(2,true);place('ring',.3);C.vx=Math.sin(C.yaw)*30;C.vz=-Math.cos(C.yaw)*30;C.onRoad=1;C.grounded=1;C.speed=30;
    IMP.q.push({src:0,vn:12,E:60000,x:C.x+1,z:C.z,nx:-1,nz:0,zone:0,mass:1e6});IMP.n++;
    for(let k=0;k<20;k++)fxUpdate(1/60);const sparks=SPARK.filter(s=>s.age<s.life).length,spray=SMOKE.filter(s=>s.age<s.life&&s.k==1).length;
    /* a police-car siren glow: pick a live car and make it a cop for a moment */
    const c=TR.cars.find(q=>q.alive);let n0=0,n1=0;if(c){const f=[Math.sin(C.yaw),-Math.cos(C.yaw)];c.px=c.x=C.x+f[0]*14;c.pz=c.z=C.z+f[1]*14;c.py=c.y=C.y;c.siren=0;shot();n0=R.fxN;c.siren=1;shot();n1=R.fxN;c.siren=0}
    return{sparks,spray,fxN:R.fxN,max:R.fxMax,n0,n1,cars:TR.nAlive,err:RACER.G.gl.getError()}});
  ok(fx.sparks>=8,`a crash throws sparks (${fx.sparks} alive after 1/3 s)`);ok(fx.spray>=6,`at 30 m/s on the wet road the tyres throw spray (${fx.spray} puffs)`);
  ok(fx.fxN>20&&fx.fxN<fx.max*.9&&fx.err==0,`glows, pools, beams and particles this frame: ${fx.fxN} quads of ${fx.max} (GL error ${fx.err})`);
  if(fx.cars)ok(fx.n1>fx.n0&&fx.n1<=fx.n0+3,`a siren adds its glow (${fx.n0} -> ${fx.n1} quads)`);

  /* ---- 6 the automatic quality choice: made-up frame costs, the rules that keep the phone cool ---- */
  const gv=await ev(()=>{const {GFX,GFXT,GOV,Q}=RACER;const log=[];const run=(w,iv,n)=>{for(let i=0;i<n;i++){const a=RACER.gfxGovern(w,iv);if(a)log.push(a+'@'+GFX.tier+'/'+Q.scale.toFixed(2))}};
    GFX.fixed=false;GFX.mode='auto';GFX.upLock=[0,0,0];RACER.gfxSetTier(2,true);Q.scale=1;Q.apply();
    /* heavy: 20 ms of work per frame -> resolution drops first, then the tier, and a tier that failed is locked out */
    run(20,24,14);const afterHeavy={tier:GFX.tier,scale:+Q.scale.toFixed(2),log:log.slice()};
    /* light: 5 ms of work -> goes back up, but only to what it estimates it can afford (under 9.5 ms) */
    log.length=0;GFX.upLock=[0,0,0];run(5,16.7,30);const afterLight={tier:GFX.tier,scale:+Q.scale.toFixed(2),log:log.slice()};
    /* borderline: 11 ms -> neither up nor down (the dead band keeps it from flapping) */
    log.length=0;const t0=GFX.tier,s0=Q.scale;run(11,16.7,10);const border={same:GFX.tier==t0&&Math.abs(Q.scale-s0)<1e-9,log:log.slice()};
    /* late frames with little work (the screen cannot keep up for another reason) still go down */
    log.length=0;GFX.upLock=[0,0,0];RACER.gfxSetTier(2,true);Q.scale=.9;Q.apply();RACER.gfxGovern(8,22);const late={scale:+Q.scale.toFixed(2)};
    /* the estimate refuses a step that would cost too much: 8.5 ms at Low (x1.35 -> 11.5) must not go to Medium */
    log.length=0;GFX.upLock=[0,0,0];RACER.gfxSetTier(0,true);Q.scale=GFXT[0].scMax;Q.apply();GFX.okRuns=0;run(8.5,16.7,6);const refuse={tier:GFX.tier,log:log.slice()};
    return{afterHeavy,afterLight,border,late,refuse,GOV}});
  ok(gv.afterHeavy.tier==0&&gv.afterHeavy.log.some(s=>s.startsWith('scale down'))&&gv.afterHeavy.log.some(s=>s.startsWith('tier down')),`heavy frames (20 ms): resolution down first, then tier down to Low (${gv.afterHeavy.log.slice(0,4).join(', ')} ... scale ${gv.afterHeavy.scale})`);
  ok(gv.afterLight.log.some(s=>s.startsWith('scale up')||s.startsWith('tier up'))&&gv.afterLight.tier>=0,`light frames (5 ms): it climbs again (${gv.afterLight.log.slice(0,5).join(', ')} -> tier ${gv.afterLight.tier}, scale ${gv.afterLight.scale})`);
  ok(gv.border.same,'frames at 11 ms (between the 9.5 ms up and 13.5 ms down limits): no change, so no flapping');
  ok(gv.late.scale<.9,`late frames (22 ms between frames) with little work still lower the resolution (0.90 -> ${gv.late.scale})`);
  ok(gv.refuse.tier==0&&!gv.refuse.log.some(s=>s.startsWith('tier up')),'8.5 ms at Low is not enough room for Medium (estimated 11.5 ms > 9.5 ms): stays on Low, so the phone is never run flat out');
  /* the probe plumbing: every few seconds 8 frames are timed with a forced GPU wait, then gfxGovern gets the median */
  const pr=await ev(()=>{const {GFX,Q}=RACER;GFX.fixed=false;GFX.mode='auto';RACER.gfxSetTier(1,true);GFX.since=100;GFX.ivN=0;let calls=0,seen=null;const orig=window.gfxGovernSpy;let n=0,probes=0;
    for(let i=0;i<400&&probes<1;i++){gfxFrameStart();RACER.renderOnce(RACER.UI.cw,RACER.UI.ch);const was=GFX.probeOn;gfxFrameEnd(16.7);if(was&&!GFX.probeOn)probes++}
    return{probes,work:GFX.work,log:GFX.log.length,err:RACER.G.gl.getError()}});
  ok(pr.probes==1&&pr.work>0&&pr.err==0,`the timing probe runs (8 frames with a GPU wait), the governor is called with the median (${pr.work.toFixed(1)} ms in software GL)`);

  /* ---- 7 the setting: Auto / High / Low button, URL, saved choice ---- */
  const ui=await ev(()=>{const {UI,GFX}=RACER;const b=UI.bn.qual;const l0=b&&b.label;RACER.gfxSetMode('high');const h=[GFX.tier,GFX.mode];RACER.gfxSetMode('low');const lo=[GFX.tier,GFX.mode];RACER.gfxSetMode('auto');const au=[GFX.tier,GFX.mode];let saved=null;try{saved=localStorage.getItem('racer.gfx')}catch(e){}
    if(b)b.act(1);const l1=b&&b.label;return{has:!!b,l0,l1,h,lo,au,saved}});
  ok(ui.has&&ui.h[0]==2&&ui.lo[0]==0&&ui.au[0]==1&&ui.au[1]=='auto',`the GFX button: High -> tier ${ui.h[0]}, Low -> tier ${ui.lo[0]}, Auto -> starts at tier ${ui.au[0]} and adapts (label "${ui.l0}" -> "${ui.l1}")`);
  await T.close();
  console.log(bad?'\nFAILED '+bad:'\nall passed');process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
