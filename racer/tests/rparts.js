// Visible damage parts: bonnet, boot lid, doors, bumpers, mirrors (hinged, come off, tumble on the road), cracked glass, dead lights, panels that spring open on traffic and cop cars.
// All of it is looks only: the driving must be identical with and without it.   usage: node racer/tests/rparts.js
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:320,h:200,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
  /* 1. the generator: every one of the 30 cars has its parts, and the index buffer is a clean run per part */
  const G=await T.ev(()=>{const rows=[];for(const def of RACER.CAR_ROSTER){const B=RACER.cgBuild(def.spec),b=B.body,P=B.S._parts,nv=b.nv;let maxI=0,sum=0,gsum=0;for(let i=0;i<b.I.length;i++)maxI=Math.max(maxI,b.I[i]);
      for(const r of b.pr)sum+=r.n;for(const r of b.gpr)gsum+=r.n;
      rows.push({n:def.name,hood:P[1]?P[1].n:0,trunk:P[2]?P[2].n:0,dR:P[3]?P[3].n:0,dL:P[4]?P[4].n:0,fb:P[5]?P[5].n:0,rb:P[6]?P[6].n:0,mR:P[7]?P[7].n:0,mL:P[8]?P[8].n:0,idxOk:maxI<nv,runsOk:sum===b.glassFrom&&sum+gsum===b.I.length,
        doorBox:P[3]&&P[4]?[P[3].box[0],P[4].box[3]]:null,hingeOk:[1,3,4,5,6].every(k=>P[k]&&P[k].p.every(Number.isFinite)),nvT:nv})}return rows});
  const miss=G.filter(r=>r.hood<100||r.dR<100||r.dL<100||r.fb<100||r.rb<100||r.mR<8||r.mL<8);
  ok(miss.length===0,'1 all '+G.length+' cars have bonnet, both doors, both bumpers and both mirrors'+(miss.length?'  MISSING on '+miss.map(r=>r.n).join(', '):''));
  ok(G.every(r=>r.idxOk&&r.runsOk&&r.hingeOk),'1 indices are in range, the per-part runs add up to the whole index buffer, every hinge is a finite point');
  const noT=G.filter(r=>r.trunk<60);console.log('     cars with no separate boot lid (their rear hatch/engine cover is the lid, or they have none):',noT.length,'of',G.length,'; most triangles in a body:',Math.max(...G.map(r=>r.nvT)),'vertices');
  ok(Math.max(...G.map(r=>r.nvT))<65000,'1 vertex count stays under the 16-bit index limit');
  /* 2. an undamaged car: nothing moves, nothing cracks, lights are on */
  const U=await T.ev(()=>{RACER.UI.paused=true;RACER.carPlace(4000,-3000,0,100);dmgReset();for(let i=0;i<60;i++)partsStep(1/60);return{angs:PP.slice(1).map(p=>p.a),off:PP.slice(1).map(p=>p.off),cr:PDM.cr.slice(),head:PDM.head.slice(),tail:PDM.tail.slice(),deb:DEB.length}});
  ok(U.angs.every(a=>a===0)&&U.off.every(o=>!o)&&U.cr.every(c=>c===0)&&!U.head[0]&&!U.head[1]&&!U.tail[0]&&!U.tail[1]&&U.deb===0,'2 undamaged: every part shut and on the car, no cracks, all four lights on');
  /* 3. a front hit opens the bonnet and breaks the front lights, a bigger one tears it off and the bumper goes */
  const F=await T.ev(()=>{const out={};const hit=(vn,nx,nz)=>{impactAdd(0,vn,0,0,C.x,C.z,nx,nz);dmgConsume();dmgDents(1);for(let i=0;i<90;i++)partsStep(1/60)};
    RACER.carPlace(4000,-3000,0,100);dmgReset();hit(18,0,1);out.hit1={z:DMG.z[0],hood:PP[1].a,hoodOff:PP[1].off,fb:PP[5].a,fbOff:PP[5].off,cr:PDM.cr[0],head:PDM.head.slice()};
    hit(22,0,1);out.hit2={z:DMG.z[0],hood:PP[1].a,hoodOff:PP[1].off,fbOff:PP[5].off,cr:PDM.cr[0],head:PDM.head.slice(),deb:DEB.length};
    for(let k=0;k<4;k++)hit(24,0,1);out.hit6={z:DMG.z[0],hoodOff:PP[1].off,fbOff:PP[5].off,deb:DEB.length,head:PDM.head.slice()};return out});
  ok(F.hit1.z>.2&&F.hit1.hood>.05,'3 an 18 m/s front hit (front damage '+F.hit1.z.toFixed(2)+'): bonnet lifted to '+(F.hit1.hood*57.3).toFixed(0)+' deg');
  ok(F.hit2.hood>.3||F.hit2.hoodOff,'3 after a second hit (damage '+F.hit2.z.toFixed(2)+') the bonnet is '+(F.hit2.hoodOff?'torn off':(F.hit2.hood*57.3).toFixed(0)+' deg up')+', windscreen cracks '+F.hit2.cr.toFixed(2));
  ok(F.hit6.hoodOff&&F.hit6.fbOff&&F.hit6.deb>=2,'3 after six hard front hits the bonnet and the front bumper have come off ('+F.hit6.deb+' pieces on the road), headlights '+(F.hit6.head[0]&&F.hit6.head[1]?'both dead':'not both dead'));
  ok(F.hit2.head[0]||F.hit2.head[1]||F.hit6.head[0],'3 front lights go dark as the front takes damage');
  /* 4. the pieces fall to the road and settle; they do not sink or fly off to infinity */
  const D=await T.ev(()=>{for(let i=0;i<60*5;i++)partsStep(1/60);return DEB.map(d=>({k:d.k,y:d.y,g:groundAt(d.x,d.z,d.y+1.5),rest:d.rest,dist:Math.hypot(d.x-C.x,d.z-C.z),fin:Number.isFinite(d.x+d.y+d.z+d.R[0])}))});
  ok(D.length>0&&D.every(d=>d.fin&&d.y>=d.g-.01&&d.y<d.g+.8),'4 '+D.length+' pieces lie on the road after 5 s (heights above ground: '+D.map(d=>(d.y-d.g).toFixed(2)).join(', ')+')');
  ok(D.every(d=>d.rest)&&D.every(d=>d.dist<120),'4 they come to rest, none further than '+Math.max(...D.map(d=>d.dist)).toFixed(0)+' m from the car');
  const D2=await T.ev(()=>{for(let i=0;i<60*16;i++)partsStep(1/60);return DEB.length});
  ok(D2===0,'4 after about 20 s the pieces are removed ('+D2+' left)');
  /* 5. doors and mirrors on the side that was hit */
  const S=await T.ev(()=>{const out={};const hit=(vn,nx,nz)=>{impactAdd(0,vn,0,0,C.x,C.z,nx,nz);dmgConsume();for(let i=0;i<90;i++)partsStep(1/60)};
    RACER.carPlace(4000,-3000,0,100);dmgReset();hit(20,-1,0);                                    /* pushed towards -x: a hit on the RIGHT side */
    out.right={zone:DMG.z.map(v=>+v.toFixed(2)),dR:PP[3].a,dL:PP[4].a,dRoff:PP[3].off,mRoff:PP[7].off,crR:PDM.cr[3],crL:PDM.cr[2]};
    for(let k=0;k<3;k++)hit(24,-1,0);out.right4={dRoff:PP[3].off,dL:PP[4].a,deb:DEB.length};
    RACER.carPlace(4000,-3000,0,100);dmgReset();hit(20,1,0);out.left={dL:PP[4].a,dR:PP[3].a,crL:PDM.cr[2]};return out});
  ok(S.right.zone[3]>S.right.zone[2]&&(S.right.dR>.2||S.right.dRoff),'5 a hit on the right side: the right door hangs open ('+(S.right.dR*57.3).toFixed(0)+' deg'+(S.right.dRoff?', off':'')+'), left door '+(S.right.dL*57.3).toFixed(0)+' deg');
  ok(S.right4.dRoff,'5 after four more hard side hits the right door has come off');
  ok(S.left.dL<-.2&&Math.abs(S.left.dR)<Math.abs(S.left.dL),'5 a hit on the left: the left door opens (angle '+(S.left.dL*57.3).toFixed(0)+' deg) before the right one');
  ok(S.right.crR>0&&S.left.crL>0,'5 the side windows crack on the side that was hit (right '+S.right.crR.toFixed(2)+', left '+S.left.crL.toFixed(2)+')');
  /* 6. repair puts everything back */
  const R=await T.ev(()=>{dmgReset();for(let i=0;i<30;i++)partsStep(1/60);return{angs:PP.slice(1).map(p=>p.a),off:PP.slice(1).map(p=>p.off),deb:DEB.length,cr:PDM.cr.slice(),head:PDM.head.slice()}});
  ok(R.angs.every(a=>a===0)&&R.off.every(o=>!o)&&R.deb===0&&R.cr.every(c=>c===0)&&!R.head[0]&&!R.head[1],'6 repair: every part back on and shut, pieces gone, glass clear, lights on');
  /* 7. looks only: the same drive with a wrecked body and a pristine one ends in exactly the same place */
  const run=async(wreck)=>T.ev(([wreck])=>{RACER.carPlace(4000,-3000,0,100);dmgReset();C.vx=C.vz=0;if(wreck){for(let k=0;k<6;k++){impactAdd(0,24,0,0,C.x,C.z,0,1);dmgConsume()}for(let k=0;k<4;k++){impactAdd(0,24,0,0,C.x,C.z,-1,0);dmgConsume()}for(let i=0;i<120;i++)partsStep(1/60)}
      C.x=C.px=4000;C.z=C.pz=-3000;C.vx=C.vz=0;C.yaw=C.pyaw=0;IN.thr=1;IN.steer=0;let r=[];for(let i=0;i<120*4;i++){if(i==240)IN.steer=.5;carStep(1/120)}IN.thr=0;IN.steer=0;return{x:C.x,z:C.z,yaw:C.yaw,v:C.speed,hp:DMG.hp,z0:DMG.z[0]}},[wreck]);
  const a=await run(false),b=await run(true);
  ok(a.x===b.x&&a.z===b.z&&a.yaw===b.yaw&&a.v===b.v,'7 driving is identical with a wrecked body ('+b.v.toFixed(2)+' m/s, '+b.x.toFixed(3)+', '+b.z.toFixed(3)+' vs '+a.v.toFixed(2)+', '+a.x.toFixed(3)+', '+a.z.toFixed(3)+'); health '+a.hp.toFixed(2)+' -> '+b.hp.toFixed(2));
  /* 8. traffic and police cars: the panel nearest a hit springs open, the shader draws it, no GL errors */
  const N=await T.ev(()=>{const out={pm:TRM.pm.slice(),hg:TRM.hg.map(h=>Array.from(h).every(Number.isFinite))};const mk=(type)=>{const c=TR.cars.find(q=>q.alive);c.type=type;c.state=0;c.dmg=0;c.pf=0;c.hl=TTYPES[type].hl;c.hw=TTYPES[type].hw;c.x=C.x+30;c.z=C.z;c.yaw=0;if(c.dn)c.dn.fill(0);return c};
    let c=mk(0);trDent(c,c.x,c.z-c.hl,90000);out.front=c.pf;c=mk(0);trDent(c,c.x,c.z+c.hl,90000);out.rear=c.pf;c=mk(0);trDent(c,c.x+c.hw,c.z,90000);out.right=c.pf;c=mk(0);trDent(c,c.x-c.hw,c.z,90000);out.left=c.pf;
    c=mk(0);trDent(c,c.x,c.z-c.hl,2000);out.tiny=c.pf;c=mk(4);trDent(c,c.x,c.z-c.hl,90000);out.cop=c.pf;
    c=mk(1);c.pf=16|32|64|128;c.dmg=.9;RACER.renderOnce(RACER.UI.cw,RACER.UI.ch);out.glErr=G.gl.getError();return out});
  ok(N.pm.every(m=>m&1&&m&4&&m&8),'8 every traffic body type (sedan, hatch, SUV, van, police) has a bonnet and two doors ('+N.pm.join(',')+'), hinge data finite '+N.hg.every(Boolean));
  ok((N.front&16)&&(N.rear&32)&&(N.right&64)&&(N.left&128),'8 a car hit at the front/rear/right/left opens its bonnet/boot/right door/left door (flags '+[N.front,N.rear,N.right,N.left].join(',')+')');
  ok(N.tiny===0,'8 a tap (2 kJ) opens nothing');ok((N.cop&16)!==0,'8 a police car opens its bonnet too');ok(N.glErr===0,'8 rendering a car with every panel open raises no GL error');
  /* 9. rendering the player's wreck for a while is clean */
  const E=await T.ev(()=>{dmgReset();RACER.carPlace(4000,-3000,0,100);for(let k=0;k<4;k++){impactAdd(0,24,0,0,C.x,C.z,0,1);dmgConsume();dmgDents(1)}impactAdd(0,24,0,0,C.x,C.z,-1,0);dmgConsume();for(let i=0;i<30;i++){partsStep(1/60);RACER.renderOnce(RACER.UI.cw,RACER.UI.ch)}return{err:G.gl.getError(),pp:PP.slice(1).map(p=>+p.a.toFixed(2))}});
  ok(E.err===0,'9 30 frames of a wrecked car draw without a GL error (angles '+E.pp.join(', ')+')');
  console.log('errs',T.errs.slice(0,3));ok(T.errs.length===0,'no page errors');
  await T.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
