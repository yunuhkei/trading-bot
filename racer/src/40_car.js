'use strict';
/* ===== the car: baked Surge Sport mesh, arcade driving model, chase camera ===== */
const CARM={body:null,wheels:[],mat:null};
function carGLInit(){carLoad();carSelect(CARSEL.cur);R.carDraw=carDraw;heliInit();R.carGlass=carGlassDraw;R.fxDraw=fxDraw}
const _mb=new Float32Array(16),_mw=new Float32Array(16),_mf=new Float32Array(16);
function drawCarMesh(m,M,count,from){const gl=G.gl,P=G.P.car,n=count==null?m.n:count;gl.uniformMatrix4fv(P.u.uM,false,M);gl.bindBuffer(gl.ARRAY_BUFFER,m.vb);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.ib);
  gl.vertexAttribPointer(0,4,gl.SHORT,false,16,0);gl.vertexAttribPointer(1,4,gl.BYTE,true,16,8);gl.vertexAttribPointer(2,4,gl.UNSIGNED_BYTE,true,16,12);gl.drawElements(gl.TRIANGLES,n,gl.UNSIGNED_SHORT,(from||0)*2);R.draws++;R.tris+=n/3}
function carDraw(){
  if(!CARM.body||crashBlink())return;const gl=G.gl,P=G.P.car,a=R.alpha,q=CARS_RENDER;
  gl.useProgram(P.p);setEnvU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);gl.uniform4fv(P.u.uMat,CARM.mat);gl.uniform1f(P.u.uGl,C.boosting?1:0);carPaintU(P,CARM.paint,CARM.paint2,CARM.fin,CARM.seam);attrs(3);gl.disable(gl.CULL_FACE);
  /* the model is stored in 1/8192 m units */const S=1/8192;
  const x=lerp(C.px,C.x,a),y=lerp(C.py,C.y,a),z=lerp(C.pz,C.z,a),yaw=C.pyaw+angd(C.yaw,C.pyaw)*a,pit=lerp(C.ppitch,C.pitch,a),rol=lerp(C.proll,C.roll,a);
  gl.uniform3f(P.u.uBr,C.braking?1:0,y,0);
  gl.uniform1f(P.u.uAlpha,1);gl.uniform3f(P.u.uWh,0,1,0);if(CARM.wheels.length>1){const na=CARM.def&&CARM.def.cc?0:1;gl.uniform4f(P.u.uArch,CARM.wheels[0].x,CARM.wheels[0].R*na,CARM.wheels[1].x,CARM.wheels[1].R*na)}   /* the shader's black arch circle is for the generated supercars; the Close Call bodies cut their own arches (the circle blackened their raised fenders) */gl.uniform4f(P.u.uDm,PDM.head[0],PDM.head[1],PDM.tail[0],PDM.tail[1]);gl.uniform4fv(P.u.uCr,PDM.cr);gl.uniform1f(P.u.uZc,CARM.zc||0);
  const fdrop=C.flatT>0?.075*Math.min(1,C.flatT/.8):0;carPose(_mf,a,1,-fdrop);CARM.mf.set(_mf);if(CARM.body.pr)partsDrawCar(_mf,S,false);else{carPose(_mb,a,S,-fdrop);drawCarMesh(CARM.body,_mb,CARM.body.gf)}
  /* wheels: stored in metres-as-int16 too, positions given in metres */
  const wblur=Math.min(.8,Math.max(0,(C.speed-22)/40));
  for(let w=0;w<CARM.wheels.length;w++){const wh=CARM.wheels[w];gl.uniform3f(P.u.uWh,1,wh.R,wblur);for(const sd of[-1,1]){
    const st=w==0?C.steerVis:0;M4.trs(_mw,sd*wh.lat,wh.R,wh.x,st,-C.spin,0,sd*S,S,S);
    /* body transform without its own scale */carPose(_mf,a,1,-fdrop);M4.mul(_mb,_mf,_mw);drawCarMesh(wh,_mb)}}
  gl.uniform3f(P.u.uWh,0,1,0)}
/* the tinted glass, drawn after the sky with blending (so the seats, the wheel and the dash show through it) */
function carGlassDraw(){
  const B=CARM.body;if(!B||B.gf>=B.n||crashBlink())return;const gl=G.gl,P=G.P.car,a=R.alpha;
  gl.useProgram(P.p);setEnvU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);gl.uniform4fv(P.u.uMat,CARM.mat);gl.uniform1f(P.u.uGl,C.boosting?1:0);carPaintU(P,CARM.paint,CARM.paint2,CARM.fin,CARM.seam);attrs(3);gl.disable(gl.CULL_FACE);
  const x=lerp(C.px,C.x,a),y=lerp(C.py,C.y,a),z=lerp(C.pz,C.z,a),yaw=C.pyaw+angd(C.yaw,C.pyaw)*a,pit=lerp(C.ppitch,C.pitch,a),rol=lerp(C.proll,C.roll,a),S=1/8192;
  gl.uniform3f(P.u.uBr,C.braking?1:0,y,0);gl.uniform1f(P.u.uAlpha,.66);gl.uniform3f(P.u.uWh,0,1,0);gl.uniform4f(P.u.uDm,PDM.head[0],PDM.head[1],PDM.tail[0],PDM.tail[1]);gl.uniform4fv(P.u.uCr,PDM.cr);gl.uniform1f(P.u.uZc,CARM.zc||0);
  if(B.gpr){carPose(_mf,a,1,-(C.flatT>0?.075*Math.min(1,C.flatT/.8):0));partsDrawCar(_mf,S,true)}else{carPose(_mb,a,S,-(C.flatT>0?.075*Math.min(1,C.flatT/.8):0));drawCarMesh(B,_mb,B.n-B.gf,B.gf)}gl.uniform1f(P.u.uAlpha,1)}
const CARS_RENDER=null;
/* ---------- state ---------- */
const GRAV=24;
const C={cbN:0,curbT:-9,dActive:0,dCombo:0,dTime:0,dGrace:0,dStart:0,dEnd:0,dLast:null,jump:null,jx:0,jz:0,slideT:0,kv:0,liftT:0,ke:0,E:0,handT:0,hk:0,handOn:0,slideDir:1,lastSteer:1,airMax:0,x:0,y:0,z:0,yaw:0,vx:0,vz:0,vy:0,pitch:0,roll:0,px:0,py:0,pz:0,pyaw:0,ppitch:0,proll:0,spin:0,steerVis:0,wyaw:0,bob:0,
  gs:0,gsp:0,gf:0,ax:0,grounded:1,onRoad:1,nos:.6,boosting:0,braking:0,drift:0,slip:0,speed:0,kmh:0,fwd:0,lat:0,hit:0,air:0,safeX:0,safeZ:0,safeY:0,safeYaw:0,safeT:0,wet:0,t:0,distance:0,driftScore:0,driftTime:0,shake:0,steer:0,thr:0,camYaw:0,camDist:7.5,camY:3,fov:1.08,flash:0,boostK:0,camDr:0,camYV:0,fovV:0,distV:0,tapN:0,tapT:0,dbK:0,slideMax:.45};
const IN={steer:0,thr:0,brk:0,hand:0,nitro:0,auto:false,assist:true,respawn:0};
/* impacts: everything the car hits (src 0 a building/pole/tree, 1 a steep bank, 2 a hard landing, 3 traffic) is recorded with its energy for the damage system.
   E = energy lost in the crash in joules (1/2 m v^2 style: for a wall 1/2 m_player (1-e^2) vn^2, for a car 1/2 mu (1-e^2) vn^2 with mu the reduced mass), zone 0 front 1 rear 2 left 3 right (-1 unknown/underside) */
const IMP={q:[],n:0,total:0,last:null,max:24};
function impactAdd(src,vn,E,mass,x,z,nx,nz){if(C.shield>0)return;   /* (the spawn shield: no damage) */
  if(E<=0)E=.5*1400*(1-.22*.22)*vn*vn;if(src!=2)crashImpact(E,src);
  const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw),dx=src==3?x-C.x:-nx,dz=src==3?z-C.z:-nz,lz=dx*fx+dz*fz,lx=dx*Math.cos(C.yaw)+dz*Math.sin(C.yaw);
  const zone=src==2?-1:(Math.abs(lz)/2.2>Math.abs(lx)/.95?(lz>0?0:1):(lx>0?3:2));
  const r={t:C.t,src,vn,E,mass,x,z,nx,nz,zone};IMP.last=r;IMP.n++;IMP.total+=E;IMP.q.push(r);if(IMP.q.length>IMP.max)IMP.q.shift()}
const WB=1.35,RADIUS=1.05;
/* handling review: the fixes below are on unless the old behaviour is asked for with ?hnd=classic (or the HANDLING switch in the car menu), so the two can be compared on the phone.
   What the review changed (measured by tests/rphys.js): 1 the road assist only steers with the thumb OFF the stick (it used to cancel small steering inputs up to 22 % of the stick);
   2 a glancing hit on a wall, a bank or a rail turns the car along it and keeps its speed (it used to leave the nose in the wall and grind to a stop);
   3 a real turning circle at low speed, with the tail following the nose (it used to spin about its middle on a 2 m radius); 4 reverse has a top speed; 5 the launch boost fades out instead of cutting at 14 m/s;
   6 in the air the car stops turning within about a third of a second (it used to keep the yaw rate it left the ground with for the whole flight and land sideways). */
const PHYS={classic:false,rmin:4.2,lr:1.33,revMax:11,wallMu:.2,railMu:.06,railE:.12};
try{const q=new URLSearchParams(location.search).get('hnd');PHYS.classic=q?q=='classic':localStorage.getItem('racer.hnd')=='classic'}catch(e){}
function physSetClassic(v){PHYS.classic=!!v;try{localStorage.setItem('racer.hnd',v?'classic':'new')}catch(e){}}
/* a hit on something long and solid (wall, bank, rail) with unit normal (nx,nz) pointing AWAY from it, the car closing at vn>0: bounce (restitution e), scrape (friction mu) and, when the hit is glancing,
   turn the car along the surface the way it is travelling, so it slides on instead of driving its nose into it. Returns the speed lost into the surface (for the impact record). */
function deflect(nx,nz,vn,e,mu){
  C.vx+=(1+e)*vn*nx;C.vz+=(1+e)*vn*nz;
  const vt=Math.hypot(C.vx,C.vz)||1,sc=1-Math.min(vt*.5,vn*mu)/vt;C.vx*=sc;C.vz*=sc;
  /* the surface's direction, taken the way the car is moving */
  let tx=-nz,tz=nx;const al=C.vx*tx+C.vz*tz;if(al<0){tx=-tx;tz=-tz}
  const ang=Math.atan2(vn,Math.abs(al)+1e-3);                       /* 0 = sliding along it, pi/2 = straight into it */
  const k=1-sstep(.6,1.0,ang);                                       /* glancing up to about 35 degrees, nothing past 57 */
  if(k>0&&vt>4){const fwd=Math.sin(C.yaw)*tx-Math.cos(C.yaw)*tz,want=Math.atan2(tx,-tz)+(fwd<0?Math.PI:0);   /* a car sliding along it backwards keeps facing backwards */
    const d=angd(want,C.yaw);C.yaw+=d*.3*k;C.wyaw*=1-.5*k;
    /* what is left of the speed points along the surface (the bounce is damped), so the tyres do not have to scrub it off */
    const out=C.vx*nx+C.vz*nz;if(out>0){C.vx-=out*nx*.6*k;C.vz-=out*nz*.6*k}}
  return vn}

/* handling tuning (arcade, grip first: understeer by design; the handbrake starts a controlled drift) */
const HND={grip:34,gripDrift:3.2,gripBrake:18,driftFric:9.5,driftFricV:.6,aBase:22,aAero:.0042,omLow:3.0,respond:18,respondDrift:26,betaSlow:3.0,betaFast:.55,driftBrake:24,handRamp:1.2,handBrake0:.35,tapAng:.6,tapFrac:.75,slideWin:.45,driftRelease:5,airDrag:.0002,landBottom:12,kBeta:7.5,omDrift:4.4,grass:.62,accel:11.5,accelLow:2.8,brake:23,scrub:.05,snap:.08,snapV:.003,leave:1,kvTau:.06,gsTau:.03,gfTau:.008,coast:4.5};
function carPlace(x,z,yaw,yh){TUM.on=0;C.shield=0;CC.on=0;CC.scale=1;CC.fadeIn=0;TUM.rightT=0;C.flatT=0;C.orbY=C.orbP=0;C.dActive=0;C.dLast=null;C.jump=null;C.x=C.px=x;C.z=C.pz=z;C.yaw=C.pyaw=yaw;C.vx=C.vz=C.vy=0;C.y=C.py=C.gs=C.gsp=C.gf=groundAt(x,z,yh==null?terrainH(x,z)+1.2:yh);C.grounded=1;C.pitch=C.roll=C.ppitch=C.proll=0;C.camYaw=yaw;C.wyaw=0;C.safeX=x;C.safeZ=z;C.safeY=C.y;C.safeYaw=yaw;C.t=0;C.nos=.6;C.flatT=0}
function respawn(){TUM.on=0;TUM.rightT=0;IN.nitro=0;const x=C.safeX,z=C.safeZ;C.x=C.px=x;C.z=C.pz=z;C.yaw=C.pyaw=C.safeYaw;C.vx=Math.sin(C.yaw)*12;C.vz=-Math.cos(C.yaw)*12;C.vy=0;C.y=C.py=C.gs=C.gsp=C.gf=groundAt(x,z,C.safeY)+.1;C.pitch=C.roll=0;C.flash=1;C.dActive=0;C.dLast=null;C.grounded=1;C.air=0;C.liftT=0;C.kv=0;C.drift=0;C.slideT=0;C.tapN=0;C.tapT=0;C.dbK=0}
const gw=(x,z,y)=>groundAt(x,z,y);
function carStep(dt){
  if(TUM.on){tumbleStep(dt);return}   /* a crash that rolls the car: a free rigid body until it is back on its wheels (42_tumble.js) */
  C.px=C.x;C.py=C.y;C.pz=C.z;C.pyaw=C.yaw;C.ppitch=C.pitch;C.proll=C.roll;
  const sy=Math.sin(C.yaw),cy=Math.cos(C.yaw),fx=sy,fz=-cy,rx=cy,rz=sy;
  let f=C.vx*fx+C.vz*fz,s=C.vx*rx+C.vz*rz;const af=Math.abs(f),f0=f;
  /* sample the surface under the four wheels */
  const hw=CD.hw,fo=CD.fo,ro=CD.ro;let sum=0,g0,g1,g2,g3;
  g0=gw(C.x+fx*fo-rx*hw,C.z+fz*fo-rz*hw,C.y);const on0=RQ.on;let nCb=RQ.cb;g1=gw(C.x+fx*fo+rx*hw,C.z+fz*fo+rz*hw,C.y);const on1=RQ.on;nCb+=RQ.cb;
  g2=gw(C.x-fx*ro-rx*hw,C.z-fz*ro-rz*hw,C.y);const on2=RQ.on;nCb+=RQ.cb;g3=gw(C.x-fx*ro+rx*hw,C.z-fz*ro+rz*hw,C.y);const on3=RQ.on;nCb+=RQ.cb;
  /* CURBS: a wheel that climbs onto a sidewalk jolts the car and costs a little speed (0.7 % a wheel, on top of what the step itself takes); dropping off one is a smaller bump. The 15 cm step itself is in the ground heights above. */
  if(nCb!=C.cbN){if(nCb>C.cbN&&C.grounded&&Math.abs(s)>17&&Math.abs(s)>.55*C.speed&&!PHYS.classic&&tumbleTrip(s,'curb'))return;if(C.grounded&&C.speed>1.5){const k=Math.abs(nCb-C.cbN),up=nCb>C.cbN,a=Math.min(1,.3+C.speed/25);C.shake=Math.min(1,C.shake+(up?.07:.035)*k*a);C.bob=Math.min(C.bob,up?-.035:-.02);if(up){const l=1-Math.min(.03,.007*k);f*=l;s*=l}C.curbT=C.t}C.cbN=nCb}
  const gy=(g0+g1+g2+g3)*.25,wasOn=C.onRoad;C.onRoad=(on0+on1+on2+on3)>=2;if(wasOn&&!C.onRoad&&C.grounded&&Math.abs(s)>19&&Math.abs(s)>.6*C.speed&&!PHYS.classic&&tumbleTrip(s*.9,'road edge'))return;
  const slope=((g0+g1)-(g2+g3))*.5/(fo+ro);       /* >0 nose up */
  const mr=((g1+g3)-(g0+g2))*.5/(2*hw),m2=1+slope*slope+mr*mr;   /* ground gradient: along the car (slope) and to its right (mr) */
  const tp=Math.atan2((g0+g1)*.5-(g2+g3)*.5,fo+ro),tr=Math.atan2((g1+g3)*.5-(g0+g2)*.5,hw*2);
  /* ---- vertical: the car sticks to the road unless it really leaves it (small kinks must never let go of the tyres) ---- */
  const k=1-Math.exp(-dt/HND.gsTau);C.gs+=(gy-C.gs)*k;let vG=(C.gs-C.gsp)/dt;C.gsp=C.gs;{const vm=.7*C.speed+4;vG=vG>vm?vm:vG<-vm?-vm:vG}   /* the ground cannot push the car faster than the road slope allows */C.gf+=(gy-C.gf)*(1-Math.exp(-dt/HND.gfTau));
  C.vy-=GRAV*dt;C.y+=C.vy*dt;
  const snap=HND.snap+HND.snapV*C.speed;
  /* TAKE-OFF: the car follows the ground only while the ground pushes up on it. Over a crest of vertical curvature k (1/m, negative on a crest) the ground needs the car to accelerate
     downwards by k v^2; gravity can only give it g. Once -k v^2 is more than g the tyres lose the road and the car flies on with the velocity it had (a ballistic arc). */
  const wasGr=C.grounded;let crest=false;
  if(C.grounded&&C.speed>16){const ux=C.vx/C.speed,uz=C.vz/C.speed,d=clamp(C.speed*.09,3.5,9),hA=gw(C.x+ux*d,C.z+uz*d,C.y),hB=gw(C.x-ux*d,C.z-uz*d,C.y);
    const kv=(clamp(hA-gy,-d,d)+clamp(hB-gy,-d,d))/(d*d);C.kv+=(kv-C.kv)*(1-Math.exp(-dt/HND.kvTau));
    crest=-C.kv*C.speed*C.speed>GRAV*HND.leave}
  else C.kv*=Math.max(0,1-dt*8);
  if(C.liftT>0)C.liftT-=dt;
  if(C.grounded&&crest){C.grounded=0;C.air=0;C.liftT=.12;C.vy=C.vy<vG?C.vy:vG}                           /* leave with the ground's own vertical speed */
  if(C.grounded?(C.y<=C.gf+snap&&C.vy-vG<6):(C.liftT<=0&&C.y<=C.gf+snap*.6&&C.vy-vG<0)){
    if(!C.grounded){
      /* LANDING: only the part of the velocity that points into the ground is absorbed (that energy, half vn squared, is gone); the part along the ground stays.
         So a flat landing keeps all its speed, a landing on a down slope turns the fall into forward speed and a landing on an up slope loses some. */
      const nrm=Math.sqrt(m2),vn=(C.vy-(slope*f+mr*s))/nrm,imp=vn<0?-vn:0;
      if(imp>0){f+=vn*slope/nrm;s+=vn*mr/nrm;
        if(imp>HND.landBottom){const l=Math.min(.1,(imp-HND.landBottom)*.008);f*=1-l;s*=1-l}      /* bottoming out costs a little more */
        C.hit=Math.max(C.hit,imp*.5);if(imp>6)impactAdd(2,imp,0,0,C.x,C.z,0,0)}
      if(imp>5){C.shake=Math.min(1,C.shake+imp*.04);C.bob=-Math.min(.2,imp*.012)}
      if(C.air>C.airMax)C.airMax=C.air;if(C.air>.4)C.jump={t:C.t,air:C.air,d:Math.hypot(C.x-C.jx,C.z-C.jz)};C.air=0}
    C.y=C.gf;C.vy=vG>40?40:vG<-40?-40:vG;C.grounded=1}else{C.grounded=0;C.air+=dt}
  if(wasGr&&!C.grounded){C.jx=C.x;C.jz=C.z}
  if(C.y<gy-.03)C.y=gy-.03;
  const gr=C.grounded;
  /* ---- inputs ---- */
  let thr=IN.thr,brk=IN.brk;if(IN.auto&&!IN.brk)thr=1;
  /* nitro is a latch: one tap starts it, it runs until the tank is empty (or you brake / tap again), and it pushes even if you are not on the gas */
  if(IN.nitro&&(C.nos<=.015||brk>0))IN.nitro=0;
  const nitroOn=IN.nitro?1:0;C.boosting=nitroOn;if(nitroOn){C.nos=Math.max(0,C.nos-dt*.30);thr=1}
  /* the boost fades in and out (about 0.15 s in, 0.3 s out) instead of switching: the push, the top speed and the camera all follow this one number */
  C.boostK+=((nitroOn?1:0)-C.boostK)*(1-Math.exp(-dt*(nitroOn?13:6)));
  const vmax=(C.onRoad?HND.vmax:HND.vmaxG)*(1+.26*C.boostK)*DMG.spd,surf=C.onRoad?1:HND.grass;
  /* ---- longitudinal: weighty launch, strong but not instant braking ---- */
  if(gr){
    let a=0;if(thr>0){const r=Math.max(0,1-Math.pow(Math.max(f,0)/vmax,2.3));a=thr*(HND.accel*r+HND.accelLow*(PHYS.classic?(f<14?1:0):1-sstep(9,19,f)))*(1+.9*C.boostK)*DMG.acc}
    if(brk>0){if(f>1.5)a-=brk*HND.brake*(.7+.3*surf);else a-=brk*8*(PHYS.classic?1:clamp(1+f/PHYS.revMax,0,1))}   /* brake, then reverse (up to PHYS.revMax m/s) */
    a-=Math.sign(f)*(.35+af*af*.0004);                 /* rolling + air drag */
    if(!C.onRoad)a-=Math.sign(f)*(2.2+af*.035);        /* grass drag */
    a-=GRAV*slope/m2;                                  /* hills: gravity along the ground (climbing turns speed into height, descending turns height into speed) */
    s-=GRAV*mr/m2*dt;                                  /* and sideways down a camber */
    f+=a*dt;
    if(thr==0&&brk==0&&!IN.auto)f-=Math.sign(f)*Math.min(af,HND.coast*dt)}
  /* ---- lateral: grip first (the car runs wide before it slides), the handbrake starts a controlled drift ---- */
  const sp=Math.min(1,af/60);const steer=C.steer;
  const spd=Math.hypot(f,s),hand=IN.hand&&spd>6&&gr;
  /* the drift pedal: pressing it kicks the tail out (a slide, towards the way you steer), and the longer it is held the harder the locked wheels brake */
  /* tapping the drift pedal again while the last tap's slide is still going builds the slide up, harder and harder (up to five taps): a bigger slide angle, a faster turn, less grip, a longer hold, more points. It fades 1.6 s after the last tap. */
  C.tapT=Math.max(0,C.tapT-dt);{const tb=C.tapT>0?C.tapN/5:0;C.dbK+=(tb-C.dbK)*(1-Math.exp(-dt*(tb>C.dbK?10:1.6)))}
  if(hand){if(!C.handOn){C.handOn=1;C.handT=0;C.slideDir=Math.abs(steer)>.12?Math.sign(steer):Math.abs(C.wyaw)>.05?Math.sign(C.wyaw):C.lastSteer;
      if(C.tapT>0&&(C.drift>.2||C.slideT>0||C.dActive))C.tapN=Math.min(5,C.tapN+1);else C.tapN=0;C.tapT=1.6}C.handT+=dt;C.hk=Math.min(1,C.handT/HND.handRamp);C.slideMax=HND.slideWin*(1+1.2*C.dbK);C.slideT=C.slideMax}
  else{C.handOn=0;C.handT=0;C.hk*=Math.max(0,1-dt*6);C.slideT=Math.max(0,C.slideT-dt)}
  const sl=hand?1:(gr&&spd>6?C.slideT/Math.max(.05,C.slideMax):0);   /* a tap keeps the slide going for a moment after the finger lifts */
  if(Math.abs(steer)>.3)C.lastSteer=Math.sign(steer);
  {const dT=hand?1:.75*sl;C.drift+=(dT-C.drift)*Math.min(1,dt*(dT>C.drift?14:lerp(9,HND.driftRelease,Math.min(1,C.slip*4))))}   /* a real slide lets go of the tyres more slowly */
  const dr=C.drift;let beta=0,sK=0;
  if(gr){
    /* the most sideways acceleration the tyres give: a little aero grip at speed, much less on grass */
    /* burst tyres (spike strips, batch 3): grip halved for 3 s, back over the next second. The one deliberate case of damage changing how the car drives. */
    const flatK=C.flatT>0?Math.min(1,C.flatT/.8):0;   /* flat tyres (a spike strip): 7.8 s on the rims, back to full grip over the last 0.8 s as they reinflate */
    const A=(HND.aBase+HND.aAero*af*af)*surf*(1-HND.powerOS*thr*Math.max(0,1-af/45))*(1-.62*flatK);   /* rear-drive cars with a lot of power break traction under throttle at low speed */
    /* steering target: yaw rate limited by that budget, so at speed full lock just gives you the tightest line (understeer), not a slide */
    const omN=steer*Math.min(PHYS.classic?HND.omLow*Math.min(1,af/6):af/(PHYS.rmin*HND0.omLow/HND.omLow),A/Math.max(af,4))*(f<-1?-1:1);   /* slow: the turning circle of a car (it used to be a 2 m radius); fast: the tyre budget */
    /* drift assist: the stick chooses the slide angle, the assist holds it and straightens the car the moment you let go */
    /* full-circle slide angle (signed forward speed): at speed the stick asks for a modest slide, as the drift sheds speed the allowed angle grows until a full-stick handbrake spins the car right round */
    beta=spd>2?Math.atan2(s,f):0;
    const bmax=lerp(HND.betaSlow,HND.betaFast,sstep(10,34,spd))*(1+.8*C.dbK);let bt=-steer*bmax;
    if(sl>0){const minA=Math.min(HND.tapAng*(1+1.5*C.dbK),HND.tapFrac*bmax)*sl*(hand?lerp(1,.5,sstep(.6,1.8,C.handT)):1),sg=Math.abs(steer)>.12?Math.sign(steer):C.slideDir;if(Math.abs(bt)<minA)bt=-sg*minA}   /* even with the stick centred the tap asks for a slide */
    const omDm=HND.omDrift*(1+.55*C.dbK),omD=clamp(HND.kBeta*(1+.4*C.dbK)*angd(beta,bt),-omDm,omDm);
    /* lateral friction: strong normally, weak in a drift; always limited, so a hit or a hard turn cannot snap the car around */
    let kg=HND.grip*surf*(1-.6*flatK);if(brk>0&&af>20&&Math.abs(steer)>.5)kg=Math.min(kg,HND.gripBrake);
    kg=lerp(kg,HND.gripDrift*(1-.4*C.dbK),dr);const fr=lerp(1.3*A,(HND.driftFric+HND.driftFricV*af)*(.6+.4*surf),dr);
    /* at low speed the car turns about its REAR axle like a real one (the middle of the car then moves sideways at yaw rate x the distance to that axle); it used to spin about its middle */
    sK=PHYS.classic?0:C.wyaw*PHYS.lr*(1-sstep(7,15,af))*(1-dr)*(f<0?-1:1);
    const se=s-sK;let ds=Math.min(Math.abs(se)*kg,fr)*dt;if(ds>Math.abs(se))ds=Math.abs(se);const s0=s;s-=Math.sign(se)*ds;
    /* in a drift the friction turns the car's path instead of eating its speed (the velocity is rotated, not braked) */
    if(dr>.02){const e=Math.sqrt(Math.max(0,f*f+s0*s0-s*s));f=Math.sign(f||1)*lerp(Math.abs(f),e,dr)}
    /* sliding costs a little speed; so does cornering at the limit */
    /* the handbrake is a brake: rear wheels locked, so a slide sheds speed (a straight pull still slows you; a full slide a lot more) */
    if(dr>.02&&spd>.5){const D=HND.driftBrake*dr*(HND.handBrake0+(1-HND.handBrake0)*C.hk)*(.5+.5*Math.min(1,Math.abs(Math.sin(beta))*2)),kk2=Math.max(0,1-D*dt/spd);f*=kk2;s*=kk2}
    const ratio=Math.min(1.2,Math.abs(C.wyaw)*af/Math.max(A,1));f-=Math.sign(f)*HND.scrub*A*ratio*ratio*(1-dr)*dt;
    let wt=lerp(omN,omD,dr);
    /* steering assist: with the thumb off the stick the car quietly follows the road (fades out as you steer) */
    if(IN.assist&&C.onRoad&&dr<.2&&af>12&&f>0&&roadAt(C.x,C.z,C.y)){const ang=Math.atan2(RQ.tx,-RQ.tz),dd=angd(ang,C.yaw);if(Math.abs(dd)<.9){/* follow the road's direction, and lean back towards the middle when you drift towards an edge */
      const edge=clamp((Math.abs(RQ.lat)-.55*RQ.hw)/(.45*RQ.hw),0,1),want=dd-Math.sign(RQ.lat)*edge*.2;
      wt+=want*1.6*Math.min(1,af/35)*(PHYS.classic?1-Math.min(1,Math.abs(steer)/.22):1-sstep(.015,.05,Math.abs(steer)))}}   /* only with the thumb off the stick: it used to fade out at 22 % of the stick and cancelled small corrections */
    wt+=DMG.pull*Math.min(1,af/12);                       /* a damaged side drags the car towards it (0 when undamaged) */
    {const lim=lerp(A/Math.max(af,4),HND.omDrift*(1+.55*C.dbK),dr);wt=wt>lim?lim:wt<-lim?-lim:wt}   /* nothing (assist included) may ask for more than the tyres have */
    C.wyaw+=(wt-C.wyaw)*(1-Math.exp(-dt*lerp(HND.respond,HND.respondDrift,dr)));
  }else{C.wyaw*=Math.max(0,1-dt*(PHYS.classic?.6:3));const kd=Math.max(0,1-HND.airDrag*spd*dt);f*=kd;s*=kd;C.vy*=kd}   /* airborne: gravity and air drag only */
  /* back to world velocity with the OLD heading: the car turns, the velocity does not, so the difference becomes slip */
  C.vx=fx*f+rx*s;C.vz=fz*f+rz*s;
  C.yaw+=C.wyaw*dt;
  /* ---- drift bookkeeping (nitro and score only while really sliding) ---- */
  const slipA=spd>8?Math.abs(s-sK)/spd:0;C.slip=slipA;
  /* any slide is a drift (whether or not the drift pedal is down: a slide that carries on after a tap, a slide after a landing or on grass); a short grace keeps the combo alive across a change of direction */
  const sliding=gr&&spd>10&&slipA>(C.dActive?.09:.15);
  if(sliding){if(!C.dActive){C.dActive=1;C.dCombo=0;C.dTime=0;C.dStart=C.t;C.dLast=null}C.dGrace=.5;C.dTime+=dt;const pts=dt*spd*slipA*2*(1+2*C.dbK);C.dCombo+=pts;C.driftScore+=pts;C.nos=Math.min(1,C.nos+dt*.2*Math.min(1,slipA*2.2+.3))}
  else if(C.dActive){C.dGrace-=dt;if(C.dGrace<=0){C.dActive=0;C.dEnd=C.t;C.dLast=C.dTime>.35&&C.dCombo>=1?{pts:Math.round(C.dCombo),t:C.t,start:C.dStart}:null}}
  C.nos=Math.min(1,C.nos+dt*.012);if(DMG.leak>0)C.nos=Math.max(0,C.nos-dt*DMG.leak);
  /* ---- move ---- */
  C.x+=C.vx*dt;C.z+=C.vz*dt;
  /* ---- steep ground (cut banks, cliffs) is a wall ---- */
  if(C.speed>1){const px=C.x+C.vx/C.speed*2.3,pz=C.z+C.vz/C.speed*2.3,hp=groundAt(px,pz,C.y+.3);
    if(!RQ.on&&hp-C.y>1.05){let gx=terrainH(px+2,pz)-terrainH(px-2,pz),gz=terrainH(px,pz+2)-terrainH(px,pz-2);const gl=Math.hypot(gx,gz);if(gl<.05){gx=C.vx;gz=C.vz;const l=Math.hypot(gx,gz)||1;gx/=l;gz/=l}else{gx/=gl;gz/=gl}
      C.x=C.px;C.z=C.pz;const vin=C.vx*gx+C.vz*gz;if(vin>0){if(PHYS.classic){C.vx-=1.3*vin*gx;C.vz-=1.3*vin*gz;const vt=Math.hypot(C.vx,C.vz)||1,sc=1-Math.min(vt*.5,vin*.25)/vt;C.vx*=sc;C.vz*=sc}else{deflect(-gx,-gz,vin,.3,.22);C.x+=C.vx*dt;C.z+=C.vz*dt}C.hit=Math.max(C.hit,vin);C.shake=Math.min(1,C.shake+vin*.03);if(vin>1.2)impactAdd(1,vin,0,0,C.x,C.z,-gx,-gz)}}}
  /* ---- guard rails ---- */
  /* GUARD RAILS: metal on metal. The car's corner nearest the rail is kept off its face (the car's own angle counts, so a nose-first hit stops at the nose); a hit bounces a little (e .12),
     scrapes (friction .06 of the hit) and, when it is glancing, turns the car along the rail so it slides on with most of its speed; rubbing along it costs 2 m/s2. The energy of the hit (the speed into the rail) is the damage,
     reported every quarter second (src 4: a scrape, so even a gentle one counts; the rubbing counts a fifth), with sparks and the scrape sound (C.railT, C.railP). */
  if(C.railT>0)C.railT-=dt;
  if(roadAt(C.x,C.z,C.y)&&RQ.rail){const sg=RQ.lat>0?1:-1;if(RQ.rail&(sg>0?2:1)){const rel=angd(C.yaw,Math.atan2(RQ.tx,-RQ.tz)),ext=Math.abs(Math.sin(rel))*TR.P.hl+Math.abs(Math.cos(rel))*TR.P.hw,out=Math.abs(RQ.lat)+ext-(RQ.hw+RAIL_IN);
    if(out>0){const nx=-RQ.nx*sg,nz=-RQ.nz*sg,v0=Math.hypot(C.vx,C.vz);C.x+=nx*out;C.z+=nz*out;const vn=-(C.vx*nx+C.vz*nz);
      if(vn>0){if(vn>16&&!PHYS.classic){const rl=nx*Math.cos(C.yaw)+nz*Math.sin(C.yaw);if(Math.abs(rl)>.6)tumbleTrip(-rl*vn,'guard rail')}deflect(nx,nz,vn,PHYS.railE,PHYS.railMu);C.hit=Math.max(C.hit,vn);C.shake=Math.min(1,C.shake+vn*.035);C.railVn=Math.max(C.railVn||0,vn)}
      const vh=Math.hypot(C.vx,C.vz);{if(vh>.3){const k=Math.max(0,1-2*dt/vh);C.vx*=k;C.vz*=k}}
      const v1=Math.hypot(C.vx,C.vz),ms=.5*(HND.mass||1400);C.railE=(C.railE||0)+(vn>0?ms*vn*vn*(1-PHYS.railE*PHYS.railE):0)+.2*ms*Math.max(0,vh*vh-v1*v1);   /* the energy of the hit (its part into the rail) in full, the rubbing a fifth (most of it is heat in the beam) */C.railT=.12;C.railP=[C.x-nx*(ext+.05),C.z-nz*(ext+.05),nx,nz];
      if((C.railCd||0)<=0&&C.railE>0){impactAdd(4,Math.max(C.railVn,.5),C.railE,0,C.x,C.z,nx,nz);C.railE=0;C.railVn=0;C.railCd=.25}}}}
  if(C.railCd>0)C.railCd-=dt;
  /* ---- solid things: buildings, poles, trees ---- */
  collide(fx,fz);
  C.ax+=(((f-f0)/dt)-C.ax)*Math.min(1,dt*6);
  /* ---- visual attitude ---- */
  const ta=gr?22:1.6,kk=1-Math.exp(-dt*ta);
  C.pitch+=((gr?tp+clamp(C.ax*.0034,-.09,.05):Math.atan2(C.vy,Math.max(8,af))*.8)-C.pitch)*kk;C.roll+=((gr?tr+clamp(C.wyaw*f*.0042,-.09,.09):0)-C.roll)*kk;
  /* body roll in corners and squat/dive */
  if(gr)C.bob*=Math.max(0,1-dt*8);
  C.spin+=f*dt/.34;C.steerVis+=((-steer*.5*(1-sp*.55))-C.steerVis)*Math.min(1,dt*14);
  C.speed=Math.hypot(C.vx,C.vz);C.ke=.5*(C.speed*C.speed+C.vy*C.vy);C.E=C.ke+GRAV*C.y;C.fwd=f;C.lat=s;C.kmh=C.speed*3.6;C.braking=brk>0&&f>1.5?1:0;C.t+=dt;C.distance+=C.speed*dt;C.shake*=Math.max(0,1-dt*5);C.flash*=Math.max(0,1-dt*3);C.hit*=Math.max(0,1-dt*6);
  /* last safe spot (on a road, moving, dry) for respawns */
  if(C.onRoad&&gr&&C.speed>3&&C.t-C.safeT>.6){C.safeT=C.t;C.safeX=C.x;C.safeZ=C.z;C.safeY=C.y;C.safeYaw=C.yaw}
  /* water */
  if(terrainH(C.x,C.z)<-1.2&&!C.onRoad){C.wet+=dt;C.vx*=1-dt*2.5;C.vz*=1-dt*2.5;C.y=Math.max(C.y,-1.2-C.wet*.3);if(C.wet>1.4){respawn();C.wet=0}}else C.wet=0;
  if(IN.respawn){IN.respawn=0;respawn()}
  if(C.flatT>0){const fk=Math.min(1,C.flatT/.8);C.flatT-=dt;
    /* on the rims: the car wanders and pulls to one side, the steering shakes, and it cannot hold much more than 90 km/h */
    if(gr&&C.speed>3){C.wyaw+=(Math.sin(C.t*23)*.55+Math.sin(C.t*5.1)*.35+(C.flatSide||1)*.42)*dt*fk;if(C.speed>25){const k=Math.max(0,1-5*fk*dt/C.speed);C.vx*=k;C.vz*=k}}
    if(C.flatT<=0){C.flatT=0;safeToast('TYRES REINFLATED',2)}}
  spikeCheck()
}
/* two circles along the car vs rects and circles from the spatial hash */
function collide(fx,fz){
  for(let ci=0;ci<2;ci++){const off=ci?-1.25:1.25,cx=C.x+fx*off,cz=C.z+fz*off,cs=QH.ccs,cn=QH.cnc,a=Math.floor((cx+W.half)/cs),b=Math.floor((cz+W.half)/cs);if(a<1||b<1||a>=cn-1||b>=cn-1)continue;
    for(let bb=b-1;bb<=b+1;bb++)for(let aa=a-1;aa<=a+1;aa++){const c=bb*cn+aa;for(let q=QH.cst[c];q<QH.cst[c+1];q++){const k=QH.cli[q];let nx=0,nz=0,pen=0;
      if(k<QH.nR){const x0=QH.CR[k*5],z0=QH.CR[k*5+1],x1=QH.CR[k*5+2],z1=QH.CR[k*5+3],top=QH.CR[k*5+4];if(C.y>top+.5)continue;const px=cx<x0?x0:cx>x1?x1:cx,pz=cz<z0?z0:cz>z1?z1:cz,dx=cx-px,dz=cz-pz,d2=dx*dx+dz*dz;
        if(d2>=RADIUS*RADIUS)continue;if(d2>1e-6){const d=Math.sqrt(d2);nx=dx/d;nz=dz/d;pen=RADIUS-d}else{const l=cx-x0,r=x1-cx,t=cz-z0,bt=z1-cz,m=Math.min(l,r,t,bt);if(m==l){nx=-1}else if(m==r){nx=1}else if(m==t){nz=-1}else nz=1;pen=RADIUS+m}}
      else if(k<QH.nR+QH.nC){const j=k-QH.nR,x=QH.CC[j*5],z=QH.CC[j*5+1],r=QH.CC[j*5+2]+RADIUS*.6,dx=cx-x,dz=cz-z,d2=dx*dx+dz*dz;if(d2>=r*r||d2<1e-8)continue;if(C.y>QH.CC[j*5+4]+.2||C.y+1.2<QH.CC[j*5+3])continue;const d=Math.sqrt(d2);nx=dx/d;nz=dz/d;pen=r-d;if(LPOSTC[j]!==undefined&&lampHit(j,nx,nz))continue}
      else{/* a rotated box (the angled grids of the city) */
        const j=k-QH.nR-QH.nC,ox=QH.CO[j*7],oz=QH.CO[j*7+1],hx=QH.CO[j*7+2],hz=QH.CO[j*7+3],cs2=QH.CO[j*7+4],sn2=QH.CO[j*7+5],top=QH.CO[j*7+6];if(C.y>top+.5)continue;
        const ddx=cx-ox,ddz=cz-oz,lx=ddx*cs2+ddz*sn2,lz=-ddx*sn2+ddz*cs2,px=lx<-hx?-hx:lx>hx?hx:lx,pz=lz<-hz?-hz:lz>hz?hz:lz,ex=lx-px,ez=lz-pz,d2=ex*ex+ez*ez;let nlx=0,nlz=0;
        if(d2>=RADIUS*RADIUS)continue;if(d2>1e-6){const d=Math.sqrt(d2);nlx=ex/d;nlz=ez/d;pen=RADIUS-d}else{const a1=lx+hx,a2=hx-lx,a3=lz+hz,a4=hz-lz,m=Math.min(a1,a2,a3,a4);if(m==a1)nlx=-1;else if(m==a2)nlx=1;else if(m==a3)nlz=-1;else nlz=1;pen=RADIUS+m}
        nx=nlx*cs2-nlz*sn2;nz=nlx*sn2+nlz*cs2}
      C.x+=nx*pen;C.z+=nz*pen;const vn=C.vx*nx+C.vz*nz;
      if(vn<0){const e=.22;if(PHYS.classic||(k>=QH.nR&&k<QH.nR+QH.nC)){C.vx-=(1+e)*vn*nx;C.vz-=(1+e)*vn*nz;const vt=Math.hypot(C.vx,C.vz)||1,sc=1-Math.min(vt*.5,-vn*.3)/vt;C.vx*=sc;C.vz*=sc}else deflect(nx,nz,-vn,e,PHYS.wallMu);   /* trees and poles (circles) knock the car as before; walls deflect it */if(-vn>25&&!PHYS.classic)tumbleFromStatic(nx,nz,-vn,k>=QH.nR&&k<QH.nR+QH.nC);C.hit=Math.max(C.hit,-vn);C.shake=Math.min(1,C.shake+-vn*.04);if(-vn>1.2)impactAdd(0,-vn,0,0,cx,cz,nx,nz);
        /* a glancing hit turns the nose along the wall */if(PHYS.classic){const tx=-nz,tz=nx,al=C.vx*tx+C.vz*tz,fa=Math.sin(C.yaw)*tx-Math.cos(C.yaw)*tz;C.wyaw+=(fa>0?-1:1)*Math.min(1.2,-vn*.05)*(ci?1:-1)*.3}}}}}}
/* ---------- chase camera ---------- */
const CAM={x:0,y:0,z:0,tx:0,ty:0,tz:0,fov:1.08};
function camStep(dt,snap){if(CC.on){crashCam();return}   /* (batch 17: the crash cinematic) */
  /* the camera follows the car exactly as it is DRAWN (interpolated between the 120 Hz physics steps), otherwise the car jitters against the camera by up to one step of travel (0.7 m at 80 m/s) */
  const a=snap?1:R.alpha,px=lerp(C.px,C.x,a),py=lerp(C.py,C.y,a),pz=lerp(C.pz,C.z,a),pyaw=C.pyaw+angd(C.yaw,C.pyaw)*a;
  const sp=Math.min(1,C.speed/70),tgtYaw=Math.atan2(C.vx,-C.vz),vw=sstep(3,8,C.speed);   /* the direction of travel only means something once the car is moving: faded in, no jump */
  /* look a little towards where the car points and a little towards where it is going, so drifts are visible */
  C.camDr=snap?C.drift:C.camDr+(C.drift-C.camDr)*(1-Math.exp(-dt*3));   /* the drift look-ahead eases in and out over about a third of a second */
  const want=pyaw+clamp(angd(tgtYaw,pyaw),-.8,.8)*vw*(.12+.5*Math.min(1,C.camDr*1.2));
  /* a critically damped spring (not a plain low-pass): the camera's turning speed starts from zero, so a sudden slide never makes it jerk */
  if(snap){C.camYaw=want;C.camYV=0}else{const w=5.2+sp*2.2,d=Math.min(dt,.05),acc=w*w*angd(want,C.camYaw)-2*w*C.camYV;C.camYV+=acc*d;C.camYaw+=C.camYV*d}
  /* the take-off: on a nitro tap the lens widens and the camera drops back fast, overshoots a little and settles (springs, so it is quick but never a jump); when it ends it snaps back the same way */
  const dTarget=5.4+sp*1.3+C.boostK*2.0,h=1.65+sp*.5;if(snap){C.camDist=dTarget;C.distV=0}else{const w=9,d=Math.min(dt,.05),acc=w*w*(dTarget-C.camDist)-2*.7*w*C.distV;C.distV+=acc*d;C.camDist+=C.distV*d}const dist=C.camDist;
  /* the look-around orbit (batch 5): o = how far the camera has been swung away from behind the car; it orbits the car's middle, further out and higher with the drag */
  const oY=C.orbY||0,oP=C.orbP||0,ow=Math.min(1,(Math.abs(oY)+Math.abs(oP))*5),cyw=C.camYaw+oY,el=Math.atan2(h,dist)+oP,dd=dist*(1+.15*ow);
  const hd=lerp(dist,dd*Math.cos(el),ow);let x=px-Math.sin(cyw)*hd,z=pz+Math.cos(cyw)*hd,y=lerp(py+h,py+.5+dd*Math.sin(el),ow);   /* with no orbit (ow 0) this is exactly the chase camera as it was */
  const gh=groundAt(x,z,py)+1.3*(1-ow)+.35*ow;if(y<gh)y=gh;
  const k=snap?1:1-Math.exp(-dt*(10));C.camY+=(y-C.camY)*k;if(snap)C.camY=y;
  CAM.x=x;CAM.y=C.camY;CAM.z=z;
  const la=(8.5+sp*7)*(1-ow);CAM.tx=px+Math.sin(cyw)*la;CAM.tz=pz-Math.cos(cyw)*la;CAM.ty=lerp(py-.15+(C.camY-(py+h))*.2+C.vy*.02,py+.55,ow);
  const shk=C.shake*.12;if(shk>.002){CAM.x+=(Math.random()-.5)*shk;CAM.y+=(Math.random()-.5)*shk;CAM.z+=(Math.random()-.5)*shk}
  const tf=.9+sp*.22+C.boostK*.26;if(snap){C.fov=tf;C.fovV=0}else{const w=13,d=Math.min(dt,.05),acc=w*w*(tf-C.fov)-2*.52*w*C.fovV;C.fovV+=acc*d;C.fov+=C.fovV*d}CAM.fov=C.fov}
/* (the effects - shadow blob, skid marks, smoke, spray, sparks, light glows and beams - are in 41_fx.js) */
