// Damage: impacts -> zones -> effects on driving -> dents in the car mesh -> repair, and the wrecked flow back to the garage.
// usage: node racer/tests/rdamage.js
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:240,h:160,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
  /* 1. an undamaged car: every effect is exactly neutral */
  const U=await T.ev(()=>{RACER.UI.paused=true;return{spd:DMG.spd,acc:DMG.acc,pull:DMG.pull,leak:DMG.leak,hp:DMG.hp,ready:DMG.ready,nv:CARM.body.nv}});
  ok(U.spd===1&&U.acc===1&&U.pull===0&&U.leak===0&&U.hp===1,'1 undamaged: speed x'+U.spd+', power x'+U.acc+', pull '+U.pull+', nitro leak '+U.leak+', health '+U.hp+'  (so the feel cannot change)');
  ok(U.ready&&U.nv>6000,'1 the body mesh is held on the CPU for dents ('+U.nv+' vertices)');
  /* 2. zones from where the hit comes */
  const Z=await T.ev(()=>{const out={};const hit=(name,nx,nz)=>{RACER.carPlace(4000,-3000,0,100);dmgReset();const n0=IMP.n;impactAdd(0,20,0,0,C.x,C.z,nx,nz);dmgConsume();out[name]=DMG.z.map(v=>+v.toFixed(3));out[name+'E']=IMP.last.E};
    hit('front',0,1);hit('rear',0,-1);hit('left',1,0);hit('right',-1,0);   /* the car faces north (yaw 0): a wall in front pushes the car back (south, +z) */
    RACER.carPlace(4000,-3000,0,100);dmgReset();impactAdd(2,16,0,0,C.x,C.z,0,0);dmgConsume();out.landing=DMG.z.map(v=>+v.toFixed(3));
    RACER.carPlace(4000,-3000,0,100);dmgReset();impactAdd(0,2,0,0,C.x,C.z,0,1);dmgConsume();out.scrape=DMG.z.map(v=>+v.toFixed(3));return out});
  ok(Z.front[0]>Z.front[1]&&Z.front[0]>.3,'2 a wall in front: front '+Z.front[0]+' (others '+Z.front.slice(1).join(', ')+')  energy '+(Z.frontE/1000).toFixed(0)+' kJ');
  ok(Z.rear[1]>Z.rear[0]&&Z.rear[1]>.3,'2 a hit from behind: rear '+Z.rear[1]);
  ok(Z.left[2]>Z.left[3]&&Z.left[2]>.3,'2 a hit on the left: left '+Z.left[2]+' (right '+Z.left[3]+')');
  ok(Z.right[3]>Z.right[2]&&Z.right[3]>.3,'2 a hit on the right: right '+Z.right[3]+' (left '+Z.right[2]+')');
  ok(Z.landing[4]>0&&Z.landing[0]>0,'2 a hard landing (16 m/s) hurts the axles and the roof: '+Z.landing.join(', '));
  ok(Z.scrape.every(v=>v===0),'2 a 2 m/s scrape does nothing');
  /* 3. dents */
  const D=await T.ev(()=>{const out={};const B=CARM.body;const cmp=()=>{const f=new Int16Array(B.ab),p=DMG.pf16;let n=0,mx=0,sx=0,sz=0,nan=0,sy=0,topP=-9,topC=-9,mxx=0,mxz=0;for(let v=0;v<B.nv;v++){if(Math.abs(p[v*8]/8192)<.45&&Math.abs(p[v*8+2]/8192)<.6){if(p[v*8+1]/8192>topP)topP=p[v*8+1]/8192;if(f[v*8+1]/8192>topC)topC=f[v*8+1]/8192}const dx=(f[v*8]-p[v*8])/8192,dy=(f[v*8+1]-p[v*8+1])/8192,dz=(f[v*8+2]-p[v*8+2])/8192,d=Math.hypot(dx,dy,dz);if(d>.003){n++;sx+=p[v*8]/8192;sz+=p[v*8+2]/8192;sy+=p[v*8+1]/8192;if(d>mx){mx=d;mxx=p[v*8]/8192;mxz=p[v*8+2]/8192}}if(!isFinite(d))nan++}return{mxx:+mxx.toFixed(2),mxz:+mxz.toFixed(2),moved:n,topDrop:+(topP-topC).toFixed(3),max:+mx.toFixed(3),cx:n?+(sx/n).toFixed(2):0,cz:n?+(sz/n).toFixed(2):0,cy:n?+(sy/n).toFixed(2):0,nan}};
    RACER.carPlace(4000,-3000,0,100);dmgReset();out.clean=cmp();
    impactAdd(0,22,0,0,C.x,C.z,0,1);dmgConsume();dmgDents(1);out.front=cmp();
    dmgReset();out.afterRepair=cmp();same=true;{const a=new Uint8Array(B.ab);for(let i=0;i<a.length;i++)if(a[i]!==DMG.pris[i]){same=false;break}}out.repairExact=same;
    impactAdd(0,22,0,0,C.x,C.z,-1,0);dmgConsume();dmgDents(1);out.right=cmp();dmgReset();
    impactAdd(2,16,0,0,C.x,C.z,0,0);dmgConsume();dmgDents(1);out.roof=cmp();dmgReset();
    for(let k=0;k<12;k++){impactAdd(0,25,0,0,C.x,C.z,0,1);dmgConsume();dmgDents(1)}out.many=cmp();dmgReset();return out});
  ok(D.clean.moved===0,'3 a clean car has no displaced vertices');
  ok(D.front.moved>40&&D.front.max<=.5,'3 a front hit dents '+D.front.moved+' vertices, deepest '+D.front.max+' m (limit 0.5), no NaN '+D.front.nan);
  ok(D.front.mxz<-1.2,'3 the deepest point of a front dent is at the front of the model (z '+D.front.mxz+', front is negative z)');
  ok(D.right.moved>20&&D.right.mxx>.5,'3 the deepest point of a right-side dent is on the right side (x '+D.right.mxx+')');
  ok(D.roof.moved>20&&D.roof.topDrop>.08,'3 a hard landing buckles the roof: the middle of the roof drops '+D.roof.topDrop+' m ('+D.roof.moved+' vertices moved)');
  ok(D.many.max<=.5&&D.many.nan===0,'3 twelve hits in a row stay within 0.5 m ('+D.many.max+') and finite');
  ok(D.afterRepair.moved===0&&D.repairExact,'3 repair puts the pristine mesh back byte for byte');
  /* 4. effects on driving */
  const E=await T.ev(()=>{const {IN,UI}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;const out={};
    const run=(setup,secs)=>{RACER.carPlace(0,0,0,0);dmgReset();setup();dmgEffects();C.vx=0;C.vz=0;C.nos=.8;IN.thr=1;IN.brk=0;IN.nitro=0;IN.hand=0;C.steer=0;
      /* drive on the real ring so the ground is real: put the car on the ring's straight */
      const r=ROADS.find(q=>q.id=='ring'),i=Math.round(r.n*.69),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));RACER.carPlace(r.X[i]+Math.cos(a)*5.5,r.Z[i]+Math.sin(a)*5.5,a,r.Y[i]+.5);IN.thr=1;
      let yaw0=C.yaw,maxv=0,t=0;for(let s=0;s<secs*120;s++){RACER.carStep(1/120);if(C.speed>maxv)maxv=C.speed}return{maxv:+maxv.toFixed(1),dyaw:+angd(C.yaw,yaw0).toFixed(3),nos:+C.nos.toFixed(3),acc20:C.speed}};
    out.clean=run(()=>{},14);out.front=run(()=>{DMG.z[0]=.6},14);out.rightDmg=run(()=>{DMG.z[3]=.7},4);out.leftDmg=run(()=>{DMG.z[2]=.7},4);out.rear=run(()=>{DMG.z[1]=.8},6);out.rearClean=run(()=>{},6);dmgReset();return out});
  ok(E.front.maxv<E.clean.maxv*.9,'4 front damage .6: top speed over 14 s '+E.front.maxv+' m/s vs '+E.clean.maxv+' undamaged');
  ok(E.rightDmg.dyaw>E.leftDmg.dyaw+.05,'4 a damaged right side pulls right ('+E.rightDmg.dyaw+' rad in 4 s), a damaged left side pulls left ('+E.leftDmg.dyaw+')');
  ok(E.rear.nos<E.rearClean.nos-.15,'4 rear damage leaks nitro: tank '+E.rear.nos+' after 6 s vs '+E.rearClean.nos+' undamaged');
  /* 5. wrecked -> the end screen -> back at the garage, repaired */
  const W=await T.ev(()=>{const {IN,UI}=RACER;const r=ROADS.find(q=>q.id=='ring'),i=Math.round(r.n*.5);RACER.carPlace(r.X[i],r.Z[i],0,r.Y[i]+.5);dmgReset();
    const home=SAFE.pads.find(s=>s.id=='home'),d0=Math.hypot(C.x-home.pad.x,C.z-home.pad.z);
    for(let k=0;k<4;k++){impactAdd(0,30,0,0,C.x,C.z,0,1);dmgConsume()}dmgEffects();const wr=DMG.wrecked,st=(gameStep(.01),GAME.state);let locked=GAME.lock;
    for(let s=0;s<120*4;s++)RACER.worldStep(1/120);
    return{wr,st,locked,after:GAME.state,lockAfter:GAME.lock,hp:DMG.hp,dist:Math.hypot(C.x-home.pad.x,C.z-home.pad.z),d0:Math.round(d0),speed:C.speed,toast:SAFE.msg}});
  ok(W.wr===1&&W.st===1,'5 four 30 m/s wall hits wreck the car (wrecked '+W.wr+', end screen state '+W.st+')');
  ok(W.after===0&&W.hp===1,'5 four seconds later the game is running again with the car repaired (health '+W.hp+')');
  ok(W.dist<6,'5 and it is on the Home Garage pad ('+W.dist.toFixed(1)+' m from its centre, it was '+W.d0+' m away): "'+W.toast+'"');
  console.log('errs',T.errs);ok(T.errs.length==0,'no page errors');await T.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
