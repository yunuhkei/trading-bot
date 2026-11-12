// The 30 cars: every body builds and is sane, every car drives like its real counterpart (figures measured on flat ground and compared with the real ones), the car menu and unlock hook,
// dents on the generated bodies, the smooth traffic cars with per-car dents.   usage: node racer/tests/rcars.js     (SKIPDRIVE=1 skips the driving runs)
const L=require('./rlib.js');
let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
const rank=a=>{const o=a.map((v,i)=>[v,i]).sort((x,y)=>x[0]-y[0]),r=new Array(a.length);o.forEach((p,k)=>r[p[1]]=k);return r};
const spearman=(a,b)=>{const ra=rank(a),rb=rank(b),n=a.length;let d=0;for(let i=0;i<n;i++)d+=(ra[i]-rb[i])**2;return 1-6*d/(n*(n*n-1))};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:300,h:200,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  const ev=T.ev;
  /* ---- 1 the bodies ---- */
  const bodies=await ev(()=>{const {CAR_ROSTER}=RACER;const out=[];for(let i=0;i<CAR_ROSTER.length;i++){const d=CAR_ROSTER[i];if(d.cc)continue;const t0=performance.now(),B=cgBuild(d.spec,{}),ms=performance.now()-t0,b=B.body;let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9],nan=0,mat=0;
      for(let k=0;k<b.P.length;k+=3)for(let a=0;a<3;a++){const v=b.P[k+a];if(!isFinite(v))nan++;mn[a]=Math.min(mn[a],v);mx[a]=Math.max(mx[a],v)}
      for(const m of b.M)if(!(m>=0&&m<CGMAT.length))mat++;let badIdx=0;for(const k of b.I)if(k<0||k>=b.nv)badIdx++;let badN=0;for(let k=0;k<b.N.length;k+=3){const l=Math.hypot(b.N[k],b.N[k+1],b.N[k+2]);if(!(l>.9&&l<1.1))badN++}
      out.push({id:d.id,name:d.name,nv:b.nv,tris:b.I.length/3,ms,nan,mat,badIdx,badN,L:mx[2]-mn[2],W:mx[0]-mn[0],H:mx[1],sL:d.spec.L,sW:d.spec.W,sH:d.spec.H,wv:B.wheelF.nv})}return out});
  ok(bodies.length==30,'30 cars in the roster: '+bodies.map(b=>b.name).join(', '));
  ok(bodies.every(b=>b.nan==0&&b.mat==0&&b.badIdx==0&&b.badN==0),'every body is made of finite numbers, valid materials and indexes, unit normals');
  ok(bodies.every(b=>b.tris>9000&&b.tris<17000&&b.nv<30000),'every body has 9-17k triangles (min '+Math.min(...bodies.map(b=>b.tris))+', max '+Math.max(...bodies.map(b=>b.tris))+'), 16-bit indexes are enough');
  ok(bodies.every(b=>Math.abs(b.L-b.sL)<.35&&b.W<b.sW+.2&&b.W>b.sW-.15&&b.H>b.sH-.2&&b.H<b.sH+.4),'every body is the length, width and height of its spec (within 0.35 m / mirrors, wings)');
  ok(bodies.every(b=>b.ms<250),'each body is built in '+Math.max(...bodies.map(b=>b.ms)).toFixed(0)+' ms at most (the whole roster '+bodies.reduce((s,b)=>s+b.ms,0).toFixed(0)+' ms)');
  const sizes=new Set(bodies.map(b=>[b.L.toFixed(1),b.W.toFixed(1),b.H.toFixed(1)].join('x')));ok(sizes.size>=18,'the cars really differ in size ('+sizes.size+' distinct length x width x height combinations of 30)');
  /* installing a car: the first one is the Porsche-type starter, the GL buffers exist, the dent engine has its pristine copy */
  const inst=await ev(()=>{const {CARM,DMG,G,CAR_ROSTER,CARSEL}=RACER;const out=[];const gl=G.gl;for(const i of[0,7,13,29]){RACER.carSelect(i);out.push({i,id:CARM.def.id,vb:!!CARM.body.vb,wheels:CARM.wheels.length,dmgReady:DMG.ready,nv:CARM.body.ab.byteLength/16,err:gl.getError(),paint:Array.from(CARM.paint).map(v=>+v.toFixed(2))})}RACER.carSelect(carIndex('k1'));let sorted=true;for(let i=1;i<CAR_ROSTER.length;i++)if(CAR_ROSTER[i].real.top<CAR_ROSTER[i-1].real.top)sorted=false;return{out,first:CAR_ROSTER[0].name,last:CAR_ROSTER[CAR_ROSTER.length-1].name,sorted,starter:CAR_ROSTER[carIndex('k1')].name,def:carIndex('k1')}});
  ok(inst.sorted&&inst.starter=='Kestrel S'&&inst.out.every(o=>o.vb&&o.wheels==2&&o.dmgReady&&o.err==0),'carSelect installs body, wheels, materials, paint and the dent copy with no GL errors; the menu runs from the slowest ("'+inst.first+'") to the fastest ("'+inst.last+'"), the starter is still the rear-engine coupe "'+inst.starter+'"');

  /* ---- 2 driving: measured on flat ground against the real figures ---- */
  if(!process.env.SKIPDRIVE){
    const rows=await ev(()=>{
      const {C,IN,UI,carStep,carPlace,CAR_ROSTER,HND}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;
      const H=(x,z)=>0;window.groundAt=(x,z,y)=>{RQ.on=1;RQ.lat=0;return 0};window.roadAt=()=>false;window.terrainH=()=>0;window.collide=function(){};
      const reset=(v,yaw)=>{carPlace(0,0,0);C.x=C.px=0;C.z=C.pz=0;C.yaw=C.pyaw=Math.PI/2;C.vx=v;C.vz=0;C.vy=0;C.y=C.py=C.gs=C.gsp=C.gf=.01;C.steer=0;C.wyaw=0;C.grounded=1;C.drift=0;C.slip=0;C.boostK=0;C.nos=0;IN.thr=0;IN.brk=0;IN.hand=0;IN.nitro=0;C.pitch=C.roll=0;C.slideT=0;C.handOn=0};
      const out=[];const dt=1/120;
      for(let i=0;i<CAR_ROSTER.length;i++){RACER.carSelect(i);const d=CAR_ROSTER[i];
        /* 0-100 km/h */reset(0);IN.thr=1;let t=0;while(C.speed<27.78&&t<30){carStep(dt);t+=dt}const t100=t;
        /* top speed after 80 s of full throttle (no nitro) */reset(0);IN.thr=1;let top=0;for(let s=0;s<120*90;s++){carStep(dt);if(C.speed>top)top=C.speed}
        /* braking from 100 km/h to a stop */reset(27.78);IN.thr=0;IN.brk=1;let x0=C.x,bt=0;while(C.speed>.6&&bt<20){carStep(dt);bt+=dt}const brk=Math.abs(C.x-x0);IN.brk=0;
        /* steady cornering at 100 km/h: full lock, throttle to hold the speed */reset(27.78);C.steer=1;let sum=0,n=0;for(let s=0;s<120*5;s++){IN.thr=C.speed<27.5?1:0;carStep(dt);if(s>120*2.5){sum+=Math.abs(C.wyaw)*C.speed;n++}}const lat=sum/n/9.81;
        out.push({id:d.id,name:d.name,drive:d.real.drive,t100,top:top*3.6,brk,lat,vmax:HND.vmax,real:d.real})}
      return out});
    const mk=(f)=>rows.map(f);
    const rt=spearman(mk(r=>r.real.top),mk(r=>r.top)),ra=spearman(mk(r=>-r.real.t100),mk(r=>-r.t100)),rb=spearman(mk(r=>-r.real.brk),mk(r=>-r.brk)),rg=spearman(mk(r=>r.real.lat),mk(r=>r.lat));
    console.log('\ncar              real top / measured | real 0-100 / measured | real brake / measured | real lat g / measured (steady at 100 km/h, full lock)');
    for(const r of rows)console.log((r.name.padEnd(18))+String(r.real.top).padStart(5)+' /'+r.top.toFixed(0).padStart(4)+' km/h |'+r.real.t100.toFixed(1).padStart(6)+' /'+r.t100.toFixed(2).padStart(5)+' s |'+String(r.real.brk).padStart(5)+' /'+r.brk.toFixed(1).padStart(5)+' m |'+r.real.lat.toFixed(2).padStart(6)+' /'+r.lat.toFixed(2).padStart(5)+' g  '+r.drive);
    console.log('');
    ok(rt>.95,'top speed: the measured order follows the real one (rank correlation '+rt.toFixed(2)+')');
    ok(ra>.85,'0-100 km/h: the measured order follows the real one (rank correlation '+ra.toFixed(2)+')');
    ok(rb>.85,'braking distance: the measured order follows the real one (rank correlation '+rb.toFixed(2)+')');
    ok(rg>.85,'cornering grip: the measured order follows the real one (rank correlation '+rg.toFixed(2)+')');
    const byId=id=>rows.find(r=>r.id==id);const k1=byId('k1');
    ok(Math.abs(k1.t100-2.33)<.15&&k1.top>245&&k1.top<275&&Math.abs(k1.brk-16.4)<1.5,'the starter keeps the old feel: 0-100 '+k1.t100.toFixed(2)+' s, top '+k1.top.toFixed(0)+' km/h, 100-0 in '+k1.brk.toFixed(1)+' m');
    ok(byId('h3').top>byId('k1').top*1.2&&byId('l2').top<byId('k1').top*.9,'a hypercar is clearly faster than the starter ('+byId('h3').top.toFixed(0)+' vs '+k1.top.toFixed(0)+' km/h), the small light car clearly slower ('+byId('l2').top.toFixed(0)+')');
    ok(byId('u5').t100<k1.t100&&byId('u5').top<k1.top&&byId('u5').lat<k1.lat,'the drag-strip muscle car launches harder than the starter ('+byId('u5').t100.toFixed(2)+' s) but tops out lower and corners worse ('+byId('u5').lat.toFixed(2)+' g)');
    ok(byId('l3').lat>k1.lat*1.15,'the open track car out-corners everything ('+byId('l3').lat.toFixed(2)+' g vs '+k1.lat.toFixed(2)+')');
    ok(rows.filter(r=>r.drive=='AWD').every(r=>r.t100<r.real.t100*.9+.6),'all-wheel-drive cars launch well');
  }

  /* ---- 3 the car menu, owning and unlocking ---- */
  const mn=await ev(()=>{const {MENU,CAROWN,CARSEL,HND,CARM,CAR_ROSTER}=RACER;const defAll=CAROWN.all,defOwned=CAR_ROSTER.filter((d,i)=>carOwned(i)).length,nAll=CAR_ROSTER.length;localStorage.removeItem('racer.cars');CAROWN.all=false;Object.keys(CAROWN.owned).forEach(k=>delete CAROWN.owned[k]);CAROWN.owned.k1=true;RACER.carSelect(carIndex('k1'));
    const r={};r.owned=CAR_ROSTER.filter((d,i)=>carOwned(i)).length;const v0=HND.vmax,id0=CARM.def.id;
    menuOpen();r.open=MENU.open;menuPreview(12);r.expId=CAR_ROSTER[12].id;r.prevId=CARM.def.id;r.vmaxPrev=HND.vmax;r.curPrev=CARSEL.cur;                    /* looking is not choosing */
    menuChoose();r.lockedStill=CARSEL.cur;r.still=MENU.open;                                                                  /* a locked car cannot be chosen */
    menuClose();r.backId=CARM.def.id;r.open2=MENU.open;
    carUnlock('m1');menuOpen();menuPreview(CAR_ROSTER.findIndex(d=>d.id=='m1'));menuChoose();r.chosen=CARSEL.cur;r.chosenId=CARM.def.id;r.vmaxNew=HND.vmax;r.closed=!MENU.open;
    const j=JSON.parse(localStorage.getItem('racer.cars')||'{}');r.saved=j.curId;r.savedOwned=Object.keys(j.owned||{});
    CAROWN.all=true;menuOpen();menuPreview(CAR_ROSTER.length-1);menuChoose();r.allCur=CARSEL.cur;r.lastI=CAR_ROSTER.length-1;
    menuOpen();menuPaint(4);const pk=Array.from(CARM.paint);r.paint=pk;menuClose();
    CAROWN.all=false;RACER.carSelect(carIndex('k1'));return Object.assign(r,{v0,id0,defAll,defOwned,n:nAll,k1:carIndex('k1')})});
  ok(mn.defAll&&mn.defOwned==mn.n,'for now every car is unlocked from the start ('+mn.defOwned+' of '+mn.n+' owned)');
  ok(mn.owned==1,'with the unlock-all switch off only the starter is owned (the earning rule will use this: '+mn.owned+' of 30)');
  ok(mn.open==1&&mn.prevId==mn.expId&&mn.vmaxPrev===mn.v0&&mn.curPrev==mn.k1,'browsing the showroom only shows the car (preview "'+mn.prevId+'"), the handling and the chosen car stay the same');
  ok(mn.lockedStill==mn.k1&&mn.still==1,'a locked car cannot be chosen (the menu says how to earn it is not decided yet)');
  ok(mn.backId==mn.id0&&mn.open2==0,'closing without choosing puts your own car back ('+mn.backId+')');
  ok(mn.chosen>0&&mn.chosenId=='m1'&&mn.closed&&mn.vmaxNew>mn.v0,'after the earning hook carUnlock("m1") the car can be chosen: it becomes the car, its handling comes with it (top speed number '+mn.v0.toFixed(0)+' -> '+mn.vmaxNew.toFixed(0)+')');
  ok(mn.saved=='m1'&&mn.savedOwned.indexOf('m1')>=0&&mn.savedOwned.indexOf('k1')>=0,'what you own and drive is saved');
  ok(mn.allCur==mn.lastI,'"unlock all (testing)" lets you take any car (the last, fastest one)');
  ok(mn.paint[2]>mn.paint[0],'the paint colour can be changed (blue: '+mn.paint.map(v=>v.toFixed(2)).join(',')+')');

  /* ---- 4 dents on the generated bodies ---- */
  const dn=await ev(()=>{const {CARM,DMG,C}=RACER;RACER.carSelect(5);dmgReset();const B=CARM.body;const f=B.f16,pf=DMG.pf16;let moved0=0;for(let i=0;i<f.length;i++)if(f[i]!==pf[i])moved0++;
    C.yaw=0;dentApply(0,.5,-CARM.hl,0,0,1,200000);let moved=0,maxd=0;for(let v=0;v<B.nv;v++)for(let a=0;a<3;a++){const d=Math.abs(f[v*8+a]-pf[v*8+a])/8192;if(d>0)moved++;if(d>maxd)maxd=d}
    let nan=0;for(let i=0;i<f.length;i++)if(!isFinite(f[i]))nan++;dmgReset();let after=0;for(let i=0;i<f.length;i++)if(f[i]!==pf[i])after++;RACER.carSelect(carIndex('k1'));return{moved0,moved,maxd,nan,after,nv:B.nv}});
  ok(dn.moved0==0&&dn.moved>200&&dn.maxd<=.51&&dn.nan==0,'a hit dents the generated body ('+dn.moved+' vertex coordinates moved, deepest '+dn.maxd.toFixed(2)+' m, none NaN)');
  ok(dn.after==0,'repair restores the generated body exactly');

  /* ---- 5 the smooth traffic cars ---- */
  const tr=await ev(()=>{const {TR,TRM,C,R,ROADS,UI,G}=RACER;UI.paused=true;const rd=ROADS.find(q=>q.id=='ring'),i=Math.round(.3*rd.n),a=Math.atan2(rd.X[i+1]-rd.X[i],-(rd.Z[i+1]-rd.Z[i]));RACER.carPlace(rd.X[i]+Math.cos(a)*5.6,rd.Z[i]+Math.sin(a)*5.6,a,rd.Y[i]+.5);window.camStep(0,true);
    const out={groups:TRM.types.length,tris:TRM.types.map(t=>t.n/3)};
    /* put one car of each type near (smooth) and one far (low poly) */
    const cars=TR.cars.filter(c=>c.alive);for(const c of TR.cars)c.alive&&0;
    const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw);if(cars.length<2){out.skip=1;return out}
    const near=cars[0],far=cars[1];near.px=near.x=C.x+fx*14;near.pz=near.z=C.z+fz*14;near.py=near.y=C.y;far.px=far.x=C.x+fx*160;far.pz=far.z=C.z+fz*160;far.py=far.y=C.y;near.state=far.state=0;
    RACER.renderOnce(UI.cw,UI.ch);out.nearGi=near.gi;out.farGi=far.gi;out.nearLod=near.gi&1,out.farLod=far.gi&1;
    /* a dent: it is kept, deepens when hit again nearby, a second one goes to the other slot, and it reaches the instance buffer */
    near.dn=null;const sy=Math.sin(near.yaw),cy=Math.cos(near.yaw);trDent(near,near.x+sy*3,near.z-cy*3,120000);const d1=Array.from(near.dn);trDent(near,near.x+sy*3.02,near.z-cy*3.02,120000);const d2=Array.from(near.dn);trDent(near,near.x+cy*2,near.z+sy*2,150000);const d3=Array.from(near.dn);
    RACER.renderOnce(UI.cw,UI.ch);const I=TRM.inst;let found=0;for(let q=0;q<TRM.nv;q++){const o=q*20;if(Math.abs(I[o]-near.x)<.01&&Math.abs(I[o+2]-near.z)<.01&&I[o+10]>0)found=1}
    out.d1=d1;out.d2=d2;out.d3=d3;out.inInstance=found;out.err=G.gl.getError();trDent(near,near.x,near.z,1000);out.smallIgnored=Array.from(near.dn).join()==d3.join();
    return out});
  ok(tr.groups>=10&&tr.tris[0]>3500&&tr.tris[0]<8000&&tr.tris[1]<400,'traffic has a smooth body (about '+Math.round(tr.tris[0])+' triangles) and the old low-poly body ('+Math.round(tr.tris[1])+') for each of the first 5 types ('+tr.groups/2+' types in all)');
  if(!tr.skip){ok(tr.nearLod==0&&tr.farLod==1,'cars near the camera use the smooth body, far ones the low-poly body (group '+tr.nearGi+' vs '+tr.farGi+')');
    ok(tr.d1[2]>0&&tr.d2[2]>tr.d1[2]&&tr.d2[6]==0&&tr.d3[6]>0&&tr.d3.length==12,'a crash dents the traffic car: depth '+tr.d1[2].toFixed(2)+' m, a second hit nearby deepens it to '+tr.d2[2].toFixed(2)+', a hit elsewhere uses the second slot');
    ok(tr.inInstance==1&&tr.err==0&&tr.smallIgnored,'the dent is in the instance data the shader reads (no GL error), and a tap does not dent');}
  console.log('errs',T.errs.slice(0,4));ok(T.errs.length==0,'no page errors');
  await T.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
