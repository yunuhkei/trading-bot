'use strict';
/* ===== batch 6: crashes that roll and flip =====
   THE PLAYER'S CAR becomes a free rigid body (TUM) when a crash is big enough: a heavy side hit from (or into) another car, a pole or a wall taken flat out, vaulting a guard rail, or tripping
   over a curb or the road edge while sliding sideways fast. It then has a full orientation (a 3 x 3 matrix TUM.R, model to world), a spin TUM.w and its centre of mass TUM.p, falls under gravity,
   and touches the ground with ten points (four at the sills, four at the roof, the nose and the tail): each contact pushes back with an impulse (bounce, friction) and, if it lands hard, dents that
   corner (the roof when it lands upside down: impact source 5, with the point on the body). When it settles on its wheels it is a car again; on its side or its roof it lies there for two seconds
   and is then righted (it rocks back onto its wheels) so the game goes on. Damage, as always, never changes how the car drives afterwards; the tumble itself is the crash.
   TRAFFIC CARS (trBack / trWreck in 60_traffic.js) get a simpler version: a big hit throws them up and rolls or pitches them; they land on the wheels, a side or the roof. */
const TUM={on:0,R:new Float64Array(9),w:[0,0,0],p:[0,0,0],rest:0,rightT:0,t:0,n:0,why:'',touch:new Uint8Array(10),R0:null,yawT:0,impacts:0,maxTilt:0,lastE:0};
const TUM_COM=.55,TUM_H=1.22,GRAV_T=9.81;
/* the matrix of the car's pose (scale sc), interpolated by a between the last two physics steps: the tumble's own matrix, or yaw / pitch / roll */
function carPose(o,a,sc,dy){
  const x=lerp(C.px,C.x,a),y=lerp(C.py,C.y,a)+C.bob+(dy||0),z=lerp(C.pz,C.z,a);
  if(TUM.on){const R=TUM.R;o[0]=R[0]*sc;o[1]=R[1]*sc;o[2]=R[2]*sc;o[3]=0;o[4]=R[3]*sc;o[5]=R[4]*sc;o[6]=R[5]*sc;o[7]=0;o[8]=R[6]*sc;o[9]=R[7]*sc;o[10]=R[8]*sc;o[11]=0;o[12]=x;o[13]=y;o[14]=z;o[15]=1;return o}
  const yaw=C.pyaw+angd(C.yaw,C.pyaw)*a,pit=lerp(C.ppitch,C.pitch,a),rol=lerp(C.proll,C.roll,a);return M4.trs(o,x,y,z,-yaw,pit,rol,sc,sc,sc)}
/* R (column-major 3 x 3) times a body vector */
const _tv=[0,0,0];
function tumMul(R,x,y,z){_tv[0]=R[0]*x+R[3]*y+R[6]*z;_tv[1]=R[1]*x+R[4]*y+R[7]*z;_tv[2]=R[2]*x+R[5]*y+R[8]*z;return _tv}
function tumOrtho(R){/* Gram-Schmidt on the columns */let l=Math.hypot(R[0],R[1],R[2]);R[0]/=l;R[1]/=l;R[2]/=l;let d=R[3]*R[0]+R[4]*R[1]+R[5]*R[2];R[3]-=d*R[0];R[4]-=d*R[1];R[5]-=d*R[2];l=Math.hypot(R[3],R[4],R[5]);R[3]/=l;R[4]/=l;R[5]/=l;
  R[6]=R[1]*R[5]-R[2]*R[4];R[7]=R[2]*R[3]-R[0]*R[5];R[8]=R[0]*R[4]-R[1]*R[3]}
/* start a tumble. w: a spin in the CAR's frame (x right: pitch, y up: yaw, z back: roll), vy: a kick upwards */
function tumbleStart(wbx,wby,wbz,vy,why){
  if(TUM.on||GAME.state||!CARM.body)return false;const M=_tm16;M4.trs(M,0,0,0,-C.yaw,C.pitch,C.roll,1,1,1);const R=TUM.R;for(let c=0;c<3;c++)for(let r=0;r<3;r++)R[c*3+r]=M[c*4+r];
  const w=tumMul(R,wbx,wby,wbz);TUM.w[0]=w[0];TUM.w[1]=w[1]+C.wyaw;TUM.w[2]=w[2];const cm=tumMul(R,0,TUM_COM,0);TUM.p[0]=C.x+cm[0];TUM.p[1]=C.y+cm[1];TUM.p[2]=C.z+cm[2];
  C.vy=Math.max(C.vy||0,vy);TUM.on=1;TUM.rest=0;TUM.slow=0;TUM.rightT=0;TUM.t=0;TUM.n++;TUM.why=why;TUM.touch.fill(0);TUM.maxTilt=0;C.grounded=0;C.drift=0;C.dActive=0;C.slideT=0;IN.nitro=0;C.wyaw=0;
  C.shake=Math.min(1,C.shake+.6);return true}
const _tm16=new Float32Array(16);
/* the ten touch points of the body (model frame: x right, y up from the road, z towards the back) */
function tumPoints(){const hw=(CARM.hw||.95)*.96,hl=(CARM.hl||2.25)*.97,H=TUM_H;
  return[[-hw,.12,-hl],[hw,.12,-hl],[-hw,.12,hl],[hw,.12,hl],[-hw*.7,H,-hl*.42],[hw*.7,H,-hl*.42],[-hw*.7,H,hl*.48],[hw*.7,H,hl*.48],[0,.45,-hl-.02],[0,.5,hl+.02]]}
/* one physics step of a tumbling car (called from carStep instead of the driving model) */
function tumbleStep(dt){
  C.px=C.x;C.py=C.y;C.pz=C.z;C.pyaw=C.yaw;C.ppitch=C.pitch;C.proll=C.roll;TUM.t+=dt;
  const R=TUM.R,w=TUM.w,p=TUM.p,m=HND.mass||1400,hw=CARM.hw||.95,hl=CARM.hl||2.25,H=TUM_H;
  /* inertia of a box (model frame): about x (pitch) m/12 (H^2 + L^2), about y (yaw) m/12 (W^2 + L^2), about z (roll) m/12 (W^2 + H^2); the inverse in the world is R I^-1 R^T */
  const Ix=m/12*(H*H+4*hl*hl),Iy=m/12*(4*hw*hw+4*hl*hl),Iz=m/12*(4*hw*hw+H*H);
  const Iinv=(vx,vy,vz,o)=>{const bx=R[0]*vx+R[1]*vy+R[2]*vz,by=R[3]*vx+R[4]*vy+R[5]*vz,bz=R[6]*vx+R[7]*vy+R[8]*vz,qx=bx/Ix,qy=by/Iy,qz=bz/Iz;o[0]=R[0]*qx+R[3]*qy+R[6]*qz;o[1]=R[1]*qx+R[4]*qy+R[7]*qz;o[2]=R[2]*qx+R[5]*qy+R[8]*qz;return o};
  const t1=[0,0,0],t2=[0,0,0];
  if(TUM.rightT>0){tumRighting(dt);return}
  /* gravity, air */
  C.vy-=GRAV_T*dt;const sp0=Math.hypot(C.vx,C.vz,C.vy),dr=Math.max(0,1-dt*(.02+.0004*sp0));C.vx*=dr;C.vz*=dr;C.vy*=dr;
  p[0]+=C.vx*dt;p[1]+=C.vy*dt;p[2]+=C.vz*dt;
  /* rotate: R += [w]x R dt, then keep it a rotation */
  {const wx=w[0]*dt,wy=w[1]*dt,wz=w[2]*dt;for(let c=0;c<3;c++){const a=R[c*3],b=R[c*3+1],d=R[c*3+2];R[c*3]=a+(wy*d-wz*b);R[c*3+1]=b+(wz*a-wx*d);R[c*3+2]=d+(wx*b-wy*a)}tumOrtho(R)}
  const wl=Math.hypot(w[0],w[1],w[2]);if(wl>14){w[0]*=14/wl;w[1]*=14/wl;w[2]*=14/wl}
  /* the ground: each touch point below the surface gets an impulse along the up direction (bounce .2 on a hard hit) and friction along the ground */
  const P=tumPoints();let lift=0,nTouch=0,bottom=0;
  for(let it=0;it<2;it++)for(let k=0;k<P.length;k++){const b=P[k],r0=tumMul(R,b[0],b[1]-TUM_COM,b[2]),rx=r0[0],ry=r0[1],rz=r0[2],px=p[0]+rx,py=p[1]+ry,pz=p[2]+rz,g=groundAt(px,pz,py+.35);
    if(py>g){if(it==1)TUM.touch[k]=0;continue}
    if(it==0){lift=Math.max(lift,g-py);nTouch++;if(k<4)bottom++}
    /* the ground's own normal there (a bank, an embankment, a kerb face) */
    const e2=.35,gx=groundAt(px+e2,pz,py+.35)-groundAt(px-e2,pz,py+.35),gz=groundAt(px,pz+e2,py+.35)-groundAt(px,pz-e2,py+.35);let nx=-gx/(2*e2),ny=1,nz=-gz/(2*e2);{const l=Math.hypot(nx,ny,nz);nx/=l;ny/=l;nz/=l;if(ny<.35){ny=.35;const h=Math.hypot(nx,nz)||1;nx=nx/h*.937;nz=nz/h*.937}}
    /* velocity of the point: v + w x r */
    const vpx=C.vx+(w[1]*rz-w[2]*ry),vpy=C.vy+(w[2]*rx-w[0]*rz),vpz=C.vz+(w[0]*ry-w[1]*rx),vn=vpx*nx+vpy*ny+vpz*nz;if(vn>=0)continue;
    /* normal impulse: j = -(1+e) vn / (1/m + n . ((I^-1 (r x n)) x r)) */
    const cx=ry*nz-rz*ny,cy=rz*nx-rx*nz,cz=rx*ny-ry*nx;Iinv(cx,cy,cz,t1);const K=1/m+(nx*(t1[1]*rz-t1[2]*ry)+ny*(t1[2]*rx-t1[0]*rz)+nz*(t1[0]*ry-t1[1]*rx)),e=vn<-4?.2:0,j=-(1+e)*vn/K;
    C.vx+=j*nx/m;C.vy+=j*ny/m;C.vz+=j*nz/m;w[0]+=t1[0]*j;w[1]+=t1[1]*j;w[2]+=t1[2]*j;
    /* friction: an impulse against the sliding of the point along the ground, at most mu j */
    {const ux=vpx-vn*nx,uy=vpy-vn*ny,uz=vpz-vn*nz,tl=Math.hypot(ux,uy,uz);if(tl>1e-3){const mu=k<4?.75:.7,tx=ux/tl,ty=uy/tl,tz=uz/tl,ax=ry*tz-rz*ty,ay=rz*tx-rx*tz,az=rx*ty-ry*tx;Iinv(ax,ay,az,t1);
      const Kt=1/m+(tx*(t1[1]*rz-t1[2]*ry)+ty*(t1[2]*rx-t1[0]*rz)+tz*(t1[0]*ry-t1[1]*rx)),jt=Math.min(mu*j,tl/Math.max(Kt,1e-6));C.vx-=jt*tx/m;C.vy-=jt*ty/m;C.vz-=jt*tz/m;w[0]-=t1[0]*jt;w[1]-=t1[1]*jt;w[2]-=t1[2]*jt}}
    const vpy_=vn;
    /* a hard landing on a new point: damage there (a roof point crushes the roof) */
    if(it==0&&!TUM.touch[k]&&-vpy_>3.5){const vn=-vpy_,E=.5*m*.45*vn*vn;TUM.impacts++;TUM.lastE=E;C.shake=Math.min(1,C.shake+vn*.05);C.hit=Math.max(C.hit,vn);
      const zone=k>=4&&k<8?4:k==8?0:k==9?1:(Math.abs(R[3*0+1])>.6?(b[0]>0?3:2):(b[2]<0?0:1));impactAdd(5,vn,E,0,px,pz,0,0);const rr=IMP.last;rr.zone=zone;rr.b=[b[0],b[1],b[2]];
      if(typeof sparkAt==='function'&&vn>5)sparkAt(px,g+.05,pz,C.vx*.05,C.vz*.05,Math.min(14,vn*1.2),4);if(typeof audioBang==='function'&&vn>6)audioBang(Math.min(1,vn/14))}
    if(it==0)TUM.touch[k]=1}
  if(lift>0)p[1]+=lift*.9;
  if(nTouch){const k=Math.exp(-dt*(bottom>=3?2.5:Math.hypot(C.vx,C.vz)<3?3:.9));w[0]*=k;w[1]*=Math.exp(-dt*1.2);w[2]*=k}else{w[0]*=Math.exp(-dt*.05);w[1]*=Math.exp(-dt*.05);w[2]*=Math.exp(-dt*.05)}
  /* walls and posts still stop it (the car's ground-plane circles) */
  const cm=tumMul(R,0,TUM_COM,0);C.x=p[0]-cm[0];C.y=p[1]-cm[1];C.z=p[2]-cm[2];const ox=C.x,oz=C.z;C.speed=Math.hypot(C.vx,C.vz);collide(Math.sin(C.yaw),-Math.cos(C.yaw));p[0]+=C.x-ox;p[2]+=C.z-oz;
  /* the heading the camera follows: the direction of travel while it is moving, the car's nose when it stops */
  const fx=-R[6],fz=-R[8],fl=Math.hypot(fx,fz),sp=Math.hypot(C.vx,C.vz);if(sp>4)C.yaw=C.pyaw+angd(Math.atan2(C.vx,-C.vz),C.pyaw)*Math.min(1,dt*3);else if(fl>.3)C.yaw=C.pyaw+angd(Math.atan2(fx,-fz),C.pyaw)*Math.min(1,dt*3);
  C.speed=sp;C.kmh=sp*3.6;C.pitch=C.roll=0;C.grounded=bottom>=3?1:0;C.t+=dt;C.distance+=sp*dt;C.shake*=Math.max(0,1-dt*4);C.hit*=Math.max(0,1-dt*6);C.flash*=Math.max(0,1-dt*3);C.braking=0;C.boosting=0;C.boostK*=.9;
  const up=R[4];TUM.maxTilt=Math.max(TUM.maxTilt,Math.acos(Math.max(-1,Math.min(1,up))));
  /* back on its wheels and calm enough to drive: a car again */
  if(TUM.t>.5&&up>.9&&bottom>=3&&Math.hypot(w[0],w[2])<1.4&&C.vy<1.5){tumbleEnd();return}
  /* at rest on its side or roof: wait, then right it */
  if(nTouch&&sp<1.5&&wl<1.5)TUM.rest+=dt;else TUM.rest=Math.max(0,TUM.rest-dt*2);if(sp<2.5&&TUM.t>4)TUM.slow=(TUM.slow||0)+dt;else TUM.slow=0;
  if((TUM.rest>2.2||TUM.slow>4)&&up<=.9){TUM.rightT=1;TUM.R0=Float64Array.from(R);TUM.yawT=fl>.2?Math.atan2(fx,-fz):C.yaw;TUM.y0=p[1];safeToast('FLIPPED  -  RIGHTING THE CAR',1.6)}
  if(IN.respawn){IN.respawn=0;TUM.on=0;respawn()}
  if(C.y<-60){TUM.on=0;respawn()}}
/* righting: the car rocks back onto its wheels over 1.1 s, lifted a little so it does not pass through the road */
function tumRighting(dt){const R=TUM.R,R0=TUM.R0,p=TUM.p;TUM.rightT-=dt/1.1;const u=sstep(0,1,1-Math.max(0,TUM.rightT)),cy=Math.cos(TUM.yawT),sy=Math.sin(TUM.yawT);
  /* the target: upright, facing the same way (yaw only) */const T=[cy,0,sy,0,1,0,-sy,0,cy];for(let i=0;i<9;i++)R[i]=R0[i]*(1-u)+T[i]*u;tumOrtho(R);
  const g=groundAt(p[0],p[2],p[1]+2);p[1]=Math.max(p[1],g+TUM_COM)+(TUM.y0>g+TUM_COM-2?Math.sin(u*Math.PI)*.06:0);p[1]=lerp(p[1],g+TUM_COM+Math.sin(u*Math.PI)*1.2,Math.min(1,dt*8));
  C.vx*=.8;C.vz*=.8;C.vy=0;TUM.w[0]=TUM.w[1]=TUM.w[2]=0;const cm=tumMul(R,0,TUM_COM,0);C.x=p[0]-cm[0];C.y=p[1]-cm[1];C.z=p[2]-cm[2];C.t+=dt;
  if(TUM.rightT<=0){for(let i=0;i<9;i++)R[i]=T[i];tumbleEnd()}}
function tumbleEnd(){const R=TUM.R,fx=-R[6],fz=-R[8];C.yaw=C.pyaw=Math.abs(fx)+Math.abs(fz)>.2?Math.atan2(fx,-fz):C.yaw;C.wyaw=TUM.w[1];
  const g=groundAt(C.x,C.z,C.y+1);C.y=C.py=C.gs=C.gsp=C.gf=Math.max(g,Math.min(C.y,g+.3));C.vy=0;C.grounded=1;C.air=0;C.pitch=C.roll=C.ppitch=C.proll=0;C.kv=0;TUM.on=0;TUM.rightT=0}
/* ---- what starts a tumble (called from the collision code); all return true when it started ---- */
/* a hit from or into another car: n = the contact normal (from the other car to you), vn = the closing speed, E = the energy */
function tumbleFromCar(nx,nz,vn,E,mass){if(TUM.on||vn<13||E<110e3)return false;const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw),rx=Math.cos(C.yaw),rz=Math.sin(C.yaw),lat=nx*rx+nz*rz,lon=nx*fx+nz*fz;
  const k=Math.min(1,(vn-13)/22)*Math.min(1.5,(mass||1400)/1500+.3);if(Math.abs(lat)>.55){const rs=Math.sign(lat);return tumbleStart(0,(Math.random()-.5)*2*k,-rs*(3+7*k),2.5+4*k,'side hit')}
  if(k>.45)return tumbleStart(Math.sign(lon)*(1.5+3*k),(Math.random()-.5)*3,(Math.random()-.5)*2,1.5+3*k,'head-on');return false}
/* a pole, a tree or a wall taken flat out (vn = the speed into it) */
function tumbleFromStatic(nx,nz,vn,round){if(TUM.on||vn<(round?25:28))return false;const rx=Math.cos(C.yaw),rz=Math.sin(C.yaw),lat=nx*rx+nz*rz,k=Math.min(1,(vn-25)/25);
  return tumbleStart((1+2.5*k)*(Math.random()<.5?-1:1)*.6,(Math.random()-.5)*4*k,(Math.abs(lat)>.4?-Math.sign(lat):Math.random()<.5?-1:1)*(2.5+6*k),2+3.5*k,round?'pole':'wall')}
/* sliding sideways fast and catching a curb, a guard rail or the edge of the road: the car trips over its own wheels and rolls */
function tumbleTrip(sideSpeed,why){if(TUM.on||Math.abs(sideSpeed)<15)return false;const k=Math.min(1,(Math.abs(sideSpeed)-15)/18);return tumbleStart(0,0,-Math.sign(sideSpeed)*(3.5+6.5*k),2.5+3.5*k,why)}
/* ---- traffic cars: thrown, rolled and pitched by a big hit (from trBack), landing on wheels, side or roof (from trWreck) ---- */
function trFlipKick(c,E){if(E<120e3||c.state!==1)return;const k=Math.min(1,(E-120e3)/260e3),lat=HIT.nx*Math.cos(c.yaw)+HIT.nz*Math.sin(c.yaw),lon=HIT.nx*Math.sin(c.yaw)-HIT.nz*Math.cos(c.yaw);
  c.vy=Math.max(c.vy||0,1.8+5*k);c.rr=(c.rr||0)+Math.sign(lat||1)*Math.abs(lat)*(2+8*k);c.prr=(c.prr||0)+Math.sign(lon||1)*Math.abs(lon)*(1+3.5*k);c.air=1;c.rec=0}
/* how high a car's origin rests above the ground at this roll and pitch (on its side the body is half its width up, on its roof its height) */
function trRestH(c){const h=c.hw*1.55;return c.hw*Math.abs(Math.sin(c.roll))-Math.min(0,h*Math.cos(c.roll)*Math.cos(c.pitch))+c.hl*.35*Math.abs(Math.sin(c.pitch))}
function trTumble(c,dt){const g=groundAt(c.x,c.z,c.y+.5);
  if(c.air){c.vy-=GRAV_T*dt;c.y+=c.vy*dt;c.roll+=(c.rr||0)*dt;c.pitch+=(c.prr||0)*dt;const rest=g+trRestH(c);
    if(c.y<=rest){c.y=rest;if(c.vy<-2.5){c.vy*=-.28;c.rr*=.6;c.prr*=.5;c.vx*=.85;c.vz*=.85;trDent(c,c.x,c.z,.5*c.m*c.vy*c.vy)}else{c.vy=0;c.air=0}}}
  else{/* settle onto the nearest stable side: wheels, a side or the roof (and the pitch back to level or onto its roof) */
    const q=Math.PI/2,tr=Math.round(c.roll/q)*q,tp=Math.abs(c.pitch)>2.2?Math.sign(c.pitch)*Math.PI:0,k=Math.min(1,dt*5);c.roll+=(tr-c.roll)*k;c.pitch+=(tp-c.pitch)*k;c.rr=c.prr=0;
    c.y+=(g+trRestH(c)-c.y)*Math.min(1,dt*18);if(c.y<g)c.y=g}
  return Math.abs(c.roll)>.6||Math.abs(c.pitch)>.6}
/* ---- lamp posts you can knock down (batch 6) ----
   Hitting a street lamp post at more than 15 km/h knocks it over instead of stopping the car: it falls the way you were going (it swings down over about 0.7 s and lies on the ground), its light goes out,
   the car loses a little speed and takes a small knock. Up to 8 fallen posts are kept (the vertex shader turns the post's own vertices: no extra draw call); one that is far behind you is stood up again. */
const KO={list:[],U1:new Float32Array(32),U2:new Float32Array(32),dark:new Uint8Array(65536),n:0};
function lampHit(j,nx,nz){const lid=LPOSTC[j];if(lid===undefined||C.speed<4.2)return false;const L=LPOST[lid];if(!L)return false;
  if(KO.list.length>=8){let bi=-1,bd=-1;for(let i=0;i<KO.list.length;i++){const q=KO.list[i],d=Math.hypot(LPOST[q.lid][0]-C.x,LPOST[q.lid][1]-C.z);if(d>bd){bd=d;bi=i}}lampRestore(KO.list[bi]);KO.list.splice(bi,1)}
  const dir=Math.atan2(C.vz,C.vx);KO.list.push({lid,j,dir,a:0,w:.4+C.speed*.04,t:0,top:QH.CC[j*5+4]});QH.CC[j*5+4]=-1e4;KO.dark[lid]=1;KO.n++;
  const v0=C.speed,k=Math.max(.78,1-1.4/Math.max(v0,1));C.vx*=k;C.vz*=k;C.shake=Math.min(1,C.shake+.25);C.bob=Math.min(C.bob,-.04);impactAdd(0,v0*.3,0,0,L[0],L[1],nx,nz);if(typeof sparkAt==='function')sparkAt(L[0],L[2]+.6,L[1],C.vx*.05,C.vz*.05,10,5);if(typeof audioBang==='function')audioBang(.5);return true}
function lampRestore(q){QH.CC[q.j*5+4]=q.top;KO.dark[q.lid]=0}
function lampTick(dt){const L=KO.list;for(let i=L.length-1;i>=0;i--){const q=L[i];q.t+=dt;if(q.a<1.48){q.w+=dt*7*Math.sin(Math.max(.15,q.a));q.a=Math.min(1.48,q.a+q.w*dt)}
    const P=LPOST[q.lid];if(q.t>25&&Math.hypot(P[0]-C.x,P[1]-C.z)>320){lampRestore(q);L.splice(i,1)}}
  KO.U1.fill(-1);KO.U2.fill(0);for(let i=0;i<L.length&&i<8;i++){const q=L[i],P=LPOST[q.lid];KO.U1[i*4]=q.lid;KO.U1[i*4+1]=P[0];KO.U1[i*4+2]=P[1];KO.U2[i*4]=q.dir;KO.U2[i*4+1]=q.a;KO.U2[i*4+2]=P[2]}}
function lampReset(){for(const q of KO.list)lampRestore(q);KO.list.length=0;lampTick(0)}