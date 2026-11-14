// Wheel spin (batch 35): the wheels of EVERY traffic-type vehicle (cars, taxis, police, buses, trucks, the Close Call civilians) turn round their axles with the distance the vehicle has travelled.
// For each type the same car is drawn with the wheel angle 0, 0.9 rad and a full turn: the picture must change for 0.9 and be the same for a full turn. usage: node racer/tests/rspin.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.6&fixed=1&tier=2&env=day',w:480,h:270,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  const R=await T.ev(()=>{const {C,UI,CAM,R,ROADS,TR,TTYPES,carPlace,renderOnce,G}=RACER;UI.paused=true;UI.showStats=false;UI.hud.style.display='none';window.camStep=function(){};
    const gl=G.gl,W=UI.cw,H=UI.ch;const out=[];
    const rd=ROADS.find(q=>q.id=='ring'),i=Math.round(.3*rd.n),a=Math.atan2(rd.X[i+1]-rd.X[i],-(rd.Z[i+1]-rd.Z[i]));
    const grab=()=>{renderOnce(W,H);renderOnce(W,H);const px=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);return px};
    const diff=(p,q)=>{let n=0;for(let k=0;k<p.length;k+=4)if(Math.abs(p[k]-q[k])+Math.abs(p[k+1]-q[k+1])+Math.abs(p[k+2]-q[k+2])>60)n++;return n};
    for(let t=0;t<TTYPES.length;t++){carPlace(rd.X[i]+Math.cos(a)*5,rd.Z[i]+Math.sin(a)*5,a,rd.Y[i]+.5);C.vx=C.vz=0;for(const c of TR.cars)if(c.alive)trKill(c,0);
      const c=TR.cars[0];c.alive=1;c.type=t;c.col=2;c.state=0;c.kind=TTYPES[t].cop?1:0;c.cm=0;c.siren=0;c.v=0;c.vx=c.vz=0;c.hl=TTYPES[t].hl;c.hw=TTYPES[t].hw;c.dmg=0;c.pf=0;if(c.dn)c.dn.fill(0);TR.nAlive=1;
      const x=C.x,z=C.z;c.px=c.x=x;c.pz=c.z=z;c.py=c.y=rd.Y[i];c.yaw=c.pyaw=a;c.pitch=c.roll=c.ppitch=c.proll=0;
      const d=Math.max(7,TTYPES[t].hl*2.6),ca=a+.2*Math.PI;CAM.x=x+Math.sin(ca)*d;CAM.z=z-Math.cos(ca)*d;CAM.y=rd.Y[i]+1.3;CAM.tx=x;CAM.ty=rd.Y[i]+.6;CAM.tz=z;CAM.fov=.62;R.alpha=1;
      const keepx=C.x,keepz=C.z;C.x=C.px=x+900;C.z=C.pz=z+900;
      const set=w=>{c.wr=w;c.wt1=R.time};set(0);const p0=grab();set(0.9);const p1=grab();set(6.2831853-1e-4);const p2=grab();set(0);const p3=grab();
      out.push({t,name:TTYPES[t].name||TTYPES[t].box||'',spin:diff(p0,p1),turn:diff(p0,p2),again:diff(p0,p3)});C.x=C.px=keepx;C.z=C.pz=keepz}
    return out});
  for(const r of R)console.log(('type '+r.t+(r.name?' '+r.name:'')).padEnd(22),'changed by 0.9 rad:',String(r.spin).padStart(5),'px | a full turn:',String(r.turn).padStart(3),'px | same angle again:',r.again);
  ok(R.length>=20&&R.every(r=>r.spin>60),'1 the wheels of all '+R.length+' vehicle types change with the angle (fewest changed pixels '+Math.min(...R.map(r=>r.spin))+')');
  ok(R.every(r=>r.turn<r.spin*.2+8),'2 a full turn looks like zero (largest difference '+Math.max(...R.map(r=>r.turn))+' px)');
  ok(R.every(r=>r.again<12),'3 the same angle draws the same picture (largest difference '+Math.max(...R.map(r=>r.again))+' px)');
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
