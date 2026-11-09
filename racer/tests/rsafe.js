// Safe houses: every garage has a pad on the road side that a car can really drive onto from the road; servicing repairs and saves; a locked garage refuses (no economy yet);
// respawn goes to the nearest garage you own; the economy hooks exist and do nothing.
// usage: node racer/tests/rsafe.js
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1&cops=off',w:240,h:160,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
  const G=await T.ev(()=>{RACER.UI.paused=true;const out=[];for(const s of SAFE.pads){let bd=1e9,br=null,bi=0;for(const r of ROADS){if(r.style==2)continue;for(let i=0;i<r.n;i+=2){const d=Math.hypot(r.X[i]-s.pad.x,r.Z[i]-s.pad.z);if(d<bd){bd=d;br=r;bi=i}}}
      const t=_tan(br,bi),hs=terrainH(s.pad.x,s.pad.z);let lo=1e9,hi=-1e9;for(const[a,b]of[[1,1],[1,-1],[-1,1],[-1,-1],[0,0]]){const h=terrainH(s.pad.x+s.dd[0]*s.pad.hl*a+s.t[0]*s.pad.hw*b,s.pad.z+s.dd[1]*s.pad.hl*a+s.t[1]*s.pad.hw*b);lo=Math.min(lo,h);hi=Math.max(hi,h)}
      const toRoad=[br.X[bi]-s.pad.x,br.Z[bi]-s.pad.z],l=Math.hypot(...toRoad),face=(toRoad[0]*s.dd[0]+toRoad[1]*s.dd[1])/l;
      out.push({id:s.id,road:br.id,gap:+(bd-br.hw-RSH).toFixed(1),slope:+(hi-lo).toFixed(1),face:+face.toFixed(2),owned:SAFE.owned[s.id],price:SAFE.price[s.id]})}return out});
  ok(G.length==17,'17 safe houses have pads');
  for(const g of G)if(g.gap<1||g.gap>28||g.slope>4||g.face<.4)ok(false,'pad of '+g.id+' (road '+g.road+'): '+g.gap+' m off the shoulder, '+g.slope+' m height change over the pad, door faces the road '+g.face);
  ok(G.every(g=>g.gap>=1&&g.gap<=28&&g.slope<=4&&g.face>=.4),'every pad is 1-28 m from the road edge, within 4 m of level, and the door faces the road (worst: '+Math.max(...G.map(g=>g.gap))+' m away, '+Math.max(...G.map(g=>g.slope))+' m of height change, door '+Math.min(...G.map(g=>g.face))+')');
  ok(G.filter(g=>g.owned).length==1&&G.find(g=>g.id=='home').owned&&G.find(g=>g.id=='home').price===0,'only the Home Garage is owned (price 0); the other 16 are locked with price unset (null)');
  ok(G.filter(g=>!g.owned).every(g=>g.price===null),'locked garages have no price yet (null): nothing was invented');
  /* drive onto every pad from the road */
  const R=await T.ev(()=>{const {C,IN,UI}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;const out=[];
    for(const s of SAFE.pads){SAFE.owned[s.id]=true;                       /* try them all as owned */
      let bd=1e9,br=null,bi=0;for(const r of ROADS){if(r.style==2)continue;for(let i=0;i<r.n;i++){const d=Math.hypot(r.X[i]-s.pad.x,r.Z[i]-s.pad.z);if(d<bd){bd=d;br=r;bi=i}}}
      /* start on the road at the nearest point, heading for the pad */
      const hd=Math.atan2(s.pad.x-br.X[bi],-(s.pad.z-br.Z[bi]));RACER.carPlace(br.X[bi],br.Z[bi],hd,br.Y[bi]+.5);C.vx=Math.sin(hd)*6;C.vz=-Math.cos(hd)*6;dmgReset();DMG.z[0]=.5;dmgEffects();SAFE.visit=null;SAFE.svc=0;SAFE.msg='';SAFE.msgT=0;
      let done=false,t=0,stuck=0,maxOff=0;
      for(let k=0;k<120*30&&!done;k++){const dx=s.pad.x-C.x,dz=s.pad.z-C.z,d=Math.hypot(dx,dz),want=Math.atan2(dx,-dz);C.steer=Math.max(-1,Math.min(1,angd(want,C.yaw)*2.5));
        const tv=d>14?9:d>6?6:4;IN.thr=C.speed<tv?1:0;IN.brk=C.speed>tv+2?1:0;RACER.worldStep(1/120);t+=1/120;
        if(C.speed<.4&&d>6){stuck+=1/120;if(stuck>3)break}else stuck=0;
        if(/SAVED/.test(SAFE.msg)&&SAFE.msgT>0){done=true}}
      out.push({id:s.id,done,t:+t.toFixed(1),repaired:DMG.z[0]===0,d:+Math.hypot(s.pad.x-C.x,s.pad.z-C.z).toFixed(1),speed:+C.speed.toFixed(1),stuck:stuck>3,start:Math.round(bd)});SAFE.owned[s.id]=s.id=='home'}
    return out});
  for(const r of R)if(!r.done||!r.repaired)ok(false,'could not service at '+r.id+': '+JSON.stringify(r));
  ok(R.every(r=>r.done&&r.repaired),'driving from the road onto each of the 17 pads repairs and saves ('+R.filter(r=>r.done&&r.repaired).length+'/17, slowest '+Math.max(...R.map(r=>r.t))+' s)');
  /* locked garage and the economy hooks */
  const K=await T.ev(()=>{const {C,IN}=RACER;const s=SAFE.pads.find(q=>q.id=='pines');SAFE.owned.pines=false;carPlace(s.pad.x,s.pad.z,s.yaw,s.y+.4);C.vx=C.vz=0;dmgReset();DMG.z[0]=.5;dmgEffects();SAFE.visit=null;SAFE.svc=0;
    for(let k=0;k<120*3;k++){IN.thr=0;IN.brk=1;RACER.worldStep(1/120)}
    return{msg:SAFE.msg,front:DMG.z[0],buy:ECON.buy('pines'),can:ECON.canBuy('pines'),price:ECON.price('pines'),cost:ECON.repairCost(1e6),still:SAFE.owned.pines}});
  ok(/LOCKED/.test(K.msg)&&K.front===.5,'a locked garage says "'+K.msg+'" and does not repair');
  ok(K.buy===false&&K.can===false&&K.price===null&&K.cost===0,'economy hooks are stubs: buy '+K.buy+', canBuy '+K.can+', price '+K.price+', repair cost '+K.cost);
  /* respawn: nearest owned */
  const N=await T.ev(()=>{const {C}=RACER;const out={};safeUnlock('pacifica');const p=SAFE.pads.find(q=>q.id=='pacifica'),h=SAFE.pads.find(q=>q.id=='home');
    const near=(x,z)=>{RACER.carPlace(x,z,0,terrainH(x,z)+1);dmgReset();DMG.z[0]=1;dmgEffects();gameStep(.01);for(let s=0;s<120*4;s++)RACER.worldStep(1/120);return Math.hypot(C.x-p.pad.x,C.z-p.pad.z)<8?'pacifica':Math.hypot(C.x-h.pad.x,C.z-h.pad.z)<8?'home':'?'};
    out.nearP=near(p.x+200,p.z+100);out.nearH=near(h.x-300,h.z+200);out.saved=JSON.parse(localStorage.getItem('racer.save')||'null');return out});
  ok(N.nearP=='pacifica'&&N.nearH=='home','wrecked near Pacifica (owned) respawns there; wrecked near Home respawns at Home (got '+N.nearP+' / '+N.nearH+')');
  ok(N.saved&&N.saved.owned&&N.saved.owned.pacifica===true,'ownership is saved (localStorage): '+JSON.stringify(N.saved&&N.saved.owned&&Object.keys(N.saved.owned).filter(k=>N.saved.owned[k])));
  console.log('errs',T.errs);ok(T.errs.length==0,'no page errors');await T.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
