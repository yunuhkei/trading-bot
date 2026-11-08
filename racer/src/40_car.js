'use strict';
/* ===== the car: baked Surge Sport mesh, arcade driving model, chase camera ===== */
const CARM={body:null,wheels:[],mat:null};
function carGLInit(){
  const gl=G.gl,bin=atob(CAR_NITRO_B64),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
  const mk=d=>{const nv=d.nv,o=d.off;let p=o;const P=new Int16Array(u8.slice(p,p+nv*6).buffer);p+=nv*6;const N=new Int8Array(u8.slice(p,p+nv*3).buffer);p+=nv*3;const C=u8.subarray(p,p+nv*3);p+=nv*3;const M=u8.subarray(p,p+nv);p+=nv;
    const T=new Uint16Array(u8.slice(p,p+d.nt*6).buffer);const ab=new ArrayBuffer(nv*16),i16=new Int16Array(ab),i8=new Int8Array(ab),b8=new Uint8Array(ab);
    for(let v=0;v<nv;v++){i16[v*8]=P[v*3];i16[v*8+1]=P[v*3+1];i16[v*8+2]=P[v*3+2];i16[v*8+3]=0;i8[v*16+8]=N[v*3];i8[v*16+9]=N[v*3+1];i8[v*16+10]=N[v*3+2];i8[v*16+11]=M[v];b8[v*16+12]=C[v*3];b8[v*16+13]=C[v*3+1];b8[v*16+14]=C[v*3+2];b8[v*16+15]=255}
    return{vb:mkBuf(gl.ARRAY_BUFFER,ab),ib:mkBuf(gl.ELEMENT_ARRAY_BUFFER,T),n:d.nt*3}};
  CARM.body=mk(CAR_NITRO.parts[0]);CARM.wheels=CAR_NITRO.wheels.map(w=>Object.assign(mk(w),{x:w.x,R:w.R,lat:w.lat}));
  const mat=new Float32Array(160);CAR_NITRO.mat.forEach((m,i)=>{for(let k=0;k<4;k++)mat[i*4+k]=m[k]/255});CARM.mat=mat;
  R.carDraw=carDraw;R.fxDraw=fxDraw}
const _mb=new Float32Array(16),_mw=new Float32Array(16),_mf=new Float32Array(16);
function drawCarMesh(m,M){const gl=G.gl,P=G.P.car;gl.uniformMatrix4fv(P.u.uM,false,M);gl.bindBuffer(gl.ARRAY_BUFFER,m.vb);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.ib);
  gl.vertexAttribPointer(0,4,gl.SHORT,false,16,0);gl.vertexAttribPointer(1,4,gl.BYTE,true,16,8);gl.vertexAttribPointer(2,4,gl.UNSIGNED_BYTE,true,16,12);gl.drawElements(gl.TRIANGLES,m.n,gl.UNSIGNED_SHORT,0);R.draws++;R.tris+=m.n/3}
function carDraw(){
  if(!CARM.body)return;const gl=G.gl,P=G.P.car,a=R.alpha,q=CARS_RENDER;
  gl.useProgram(P.p);setEnvU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);gl.uniform4fv(P.u.uMat,CARM.mat);gl.uniform1f(P.u.uGl,C.boosting?1:0);attrs(3);gl.disable(gl.CULL_FACE);
  /* the model is stored in 1/8192 m units */const S=1/8192;
  const x=lerp(C.px,C.x,a),y=lerp(C.py,C.y,a),z=lerp(C.pz,C.z,a),yaw=C.pyaw+angd(C.yaw,C.pyaw)*a,pit=lerp(C.ppitch,C.pitch,a),rol=lerp(C.proll,C.roll,a);
  gl.uniform3f(P.u.uBr,C.braking?1:0,y,0);
  M4.trs(_mb,x,y+C.bob,z,-yaw,pit,rol,S,S,S);drawCarMesh(CARM.body,_mb);
  /* wheels: stored in metres-as-int16 too, positions given in metres */
  for(let w=0;w<CARM.wheels.length;w++){const wh=CARM.wheels[w];for(const sd of[-1,1]){
    const st=w==0?C.steerVis:0;M4.trs(_mw,sd*wh.lat,wh.R,wh.x,st,-C.spin,0,sd*S,S,S);
    /* body transform without its own scale */M4.trs(_mf,x,y+C.bob,z,-yaw,pit,rol,1,1,1);M4.mul(_mb,_mf,_mw);drawCarMesh(wh,_mb)}}
}
const CARS_RENDER=null;
/* ---------- state ---------- */
const GRAV=24;
const C={x:0,y:0,z:0,yaw:0,vx:0,vz:0,vy:0,pitch:0,roll:0,px:0,py:0,pz:0,pyaw:0,ppitch:0,proll:0,spin:0,steerVis:0,wyaw:0,bob:0,
  gs:0,gsp:0,ax:0,grounded:1,onRoad:1,nos:.6,boosting:0,braking:0,drift:0,slip:0,speed:0,kmh:0,fwd:0,lat:0,hit:0,air:0,safeX:0,safeZ:0,safeY:0,safeYaw:0,safeT:0,wet:0,t:0,distance:0,driftScore:0,driftTime:0,shake:0,steer:0,thr:0,camYaw:0,camDist:7.5,camY:3,fov:1.08,flash:0};
const IN={steer:0,thr:0,brk:0,hand:0,nitro:0,auto:false,assist:true,respawn:0};
const WB=1.35,TR=.8,RADIUS=1.05;
/* handling tuning (arcade, grip first: understeer by design; the handbrake starts a controlled drift) */
const HND={grip:32,gripDrift:3.2,gripBrake:16,driftFric:9.5,aBase:14,aAero:.0015,omLow:2.3,respond:7,respondDrift:12,betaMax:.66,betaMin:.45,kBeta:3.2,omDrift:2.4,grass:.62,accel:11.5,accelLow:2.8,brake:11.5,scrub:.05,snap:.1,snapV:.004};
function carPlace(x,z,yaw,yh){C.x=C.px=x;C.z=C.pz=z;C.yaw=C.pyaw=yaw;C.vx=C.vz=C.vy=0;C.y=C.py=C.gs=C.gsp=groundAt(x,z,yh==null?terrainH(x,z)+1.2:yh);C.grounded=1;C.pitch=C.roll=C.ppitch=C.proll=0;C.camYaw=yaw;C.wyaw=0;C.safeX=x;C.safeZ=z;C.safeY=C.y;C.safeYaw=yaw;C.t=0;C.nos=.6}
function respawn(){const x=C.safeX,z=C.safeZ;C.x=C.px=x;C.z=C.pz=z;C.yaw=C.pyaw=C.safeYaw;C.vx=Math.sin(C.yaw)*12;C.vz=-Math.cos(C.yaw)*12;C.vy=0;C.y=C.py=C.gs=C.gsp=groundAt(x,z,C.safeY)+.1;C.pitch=C.roll=0;C.flash=1}
const gw=(x,z,y)=>groundAt(x,z,y);
function carStep(dt){
  C.px=C.x;C.py=C.y;C.pz=C.z;C.pyaw=C.yaw;C.ppitch=C.pitch;C.proll=C.roll;
  const sy=Math.sin(C.yaw),cy=Math.cos(C.yaw),fx=sy,fz=-cy,rx=cy,rz=sy;
  let f=C.vx*fx+C.vz*fz,s=C.vx*rx+C.vz*rz;const af=Math.abs(f),f0=f;
  /* sample the surface under the four wheels */
  const hw=TR,fo=WB*.55,ro=WB*.65;let sum=0,g0,g1,g2,g3;
  g0=gw(C.x+fx*fo-rx*hw,C.z+fz*fo-rz*hw,C.y);const on0=RQ.on;g1=gw(C.x+fx*fo+rx*hw,C.z+fz*fo+rz*hw,C.y);const on1=RQ.on;
  g2=gw(C.x-fx*ro-rx*hw,C.z-fz*ro-rz*hw,C.y);const on2=RQ.on;g3=gw(C.x-fx*ro+rx*hw,C.z-fz*ro+rz*hw,C.y);const on3=RQ.on;
  const gy=(g0+g1+g2+g3)*.25;C.onRoad=(on0+on1+on2+on3)>=2;
  const slope=((g0+g1)-(g2+g3))*.5/(fo+ro);       /* >0 nose up */
  const tp=Math.atan2((g0+g1)*.5-(g2+g3)*.5,fo+ro),tr=Math.atan2((g1+g3)*.5-(g0+g2)*.5,hw*2);
  /* ---- vertical: the car sticks to the road unless it really leaves it (small kinks must never let go of the tyres) ---- */
  const k=1-Math.exp(-dt/.05);C.gs+=(gy-C.gs)*k;const vG=(C.gs-C.gsp)/dt;C.gsp=C.gs;
  C.vy-=GRAV*dt;C.y+=C.vy*dt;
  const snap=HND.snap+HND.snapV*C.speed;
  if(C.y<=C.gs+snap&&C.vy-vG<6){if(!C.grounded){const imp=-(C.vy-vG);if(imp>5){C.shake=Math.min(1,C.shake+imp*.04);C.bob=-Math.min(.18,imp*.012)}C.air=0}C.y=C.gs;C.vy=vG>40?40:vG<-40?-40:vG;C.grounded=1}else{C.grounded=0;C.air+=dt}
  if(C.y<gy-.03)C.y=gy-.03;
  const gr=C.grounded;
  /* ---- inputs ---- */
  let thr=IN.thr,brk=IN.brk;if(IN.auto&&!IN.brk)thr=1;
  const nitroOn=IN.nitro&&C.nos>.015&&(thr>0||IN.auto);C.boosting=nitroOn?1:0;if(nitroOn)C.nos=Math.max(0,C.nos-dt*.30);
  const vmax=(C.onRoad?80:62)*(nitroOn?1.26:1),surf=C.onRoad?1:HND.grass;
  /* ---- longitudinal: weighty launch, strong but not instant braking ---- */
  if(gr){
    let a=0;if(thr>0&&f>-1){const r=Math.max(0,1-Math.pow(Math.max(f,0)/vmax,2.3));a=thr*(HND.accel*r+HND.accelLow*(f<14?1:0))*(nitroOn?1.9:1)}
    if(brk>0){if(f>1.5)a-=brk*HND.brake*(.7+.3*surf);else a-=brk*8}   /* brake, then reverse */
    a-=Math.sign(f)*(.35+af*af*.0004);                 /* rolling + air drag */
    if(!C.onRoad)a-=Math.sign(f)*(2.2+af*.035);        /* grass drag */
    a-=slope*GRAV*.9;                                  /* hills */
    f+=a*dt;
    if(thr==0&&brk==0&&!IN.auto)f-=Math.sign(f)*Math.min(af,3.2*dt)}
  /* ---- lateral: grip first (the car runs wide before it slides), the handbrake starts a controlled drift ---- */
  const sp=Math.min(1,af/60);const steer=C.steer;
  const hand=IN.hand&&f>8&&gr;
  C.drift+=((hand?1:0)-C.drift)*Math.min(1,dt*(hand?10:5));
  const dr=C.drift;let beta=0;
  if(gr){
    /* the most sideways acceleration the tyres give: a little aero grip at speed, much less on grass */
    const A=(HND.aBase+HND.aAero*af*af)*surf;
    /* steering target: yaw rate limited by that budget, so at speed full lock just gives you the tightest line (understeer), not a slide */
    const omN=steer*Math.min(HND.omLow*Math.min(1,af/6),A/Math.max(af,4))*(f<-1?-1:1);
    /* drift assist: the stick chooses the slide angle, the assist holds it and straightens the car the moment you let go */
    beta=Math.atan2(s,Math.max(af,3));
    const bt=-steer*lerp(HND.betaMax,HND.betaMin,sp),omD=clamp(HND.kBeta*(beta-bt),-HND.omDrift,HND.omDrift);
    /* lateral friction: strong normally, weak in a drift; always limited, so a hit or a hard turn cannot snap the car around */
    let kg=HND.grip*surf;if(brk>0&&af>20&&Math.abs(steer)>.5)kg=Math.min(kg,HND.gripBrake);
    kg=lerp(kg,HND.gripDrift,dr);const fr=lerp(1.3*A,HND.driftFric*(.6+.4*surf),dr);
    let ds=Math.min(Math.abs(s)*kg,fr)*dt;if(ds>Math.abs(s))ds=Math.abs(s);s-=Math.sign(s)*ds;
    /* sliding costs a little speed; so does cornering at the limit */
    if(dr>.05)f-=Math.sign(f)*.5*HND.driftFric*Math.abs(Math.sin(beta))*dr*dt;
    const ratio=Math.min(1.2,Math.abs(C.wyaw)*af/Math.max(A,1));f-=Math.sign(f)*HND.scrub*A*ratio*ratio*dt;
    let wt=lerp(omN,omD,dr);
    /* steering assist: with the thumb off the stick the car quietly follows the road (fades out as you steer) */
    if(IN.assist&&C.onRoad&&dr<.2&&af>12&&f>0&&roadAt(C.x,C.z,C.y)){const ang=Math.atan2(RQ.tx,-RQ.tz),dd=angd(ang,C.yaw);if(Math.abs(dd)<.9){/* follow the road's direction, and lean back towards the middle when you drift towards an edge */
      const edge=clamp((Math.abs(RQ.lat)-.55*RQ.hw)/(.45*RQ.hw),0,1),want=dd-Math.sign(RQ.lat)*edge*.2;
      wt+=want*1.6*Math.min(1,af/35)*(1-Math.min(1,Math.abs(steer)/.22))}}
    {const lim=lerp(A/Math.max(af,4),HND.omDrift,dr);wt=wt>lim?lim:wt<-lim?-lim:wt}   /* nothing (assist included) may ask for more than the tyres have */
    C.wyaw+=(wt-C.wyaw)*(1-Math.exp(-dt*lerp(HND.respond,HND.respondDrift,dr)));
  }else{C.wyaw*=Math.max(0,1-dt*.6)}
  /* back to world velocity with the OLD heading: the car turns, the velocity does not, so the difference becomes slip */
  C.vx=fx*f+rx*s;C.vz=fz*f+rz*s;
  C.yaw+=C.wyaw*dt;
  /* ---- drift bookkeeping (nitro and score only while really sliding) ---- */
  const slipA=af>8?Math.abs(s)/Math.max(af,8):0;C.slip=slipA;
  const drifting=gr&&af>10&&dr>.4&&slipA>.14;
  if(drifting){C.nos=Math.min(1,C.nos+dt*.2*Math.min(1,slipA*2.2+.3));C.driftTime+=dt;C.driftScore+=dt*af*slipA*2}else if(C.driftTime>0){C.driftTime=Math.max(0,C.driftTime-dt*4)}
  C.nos=Math.min(1,C.nos+dt*.012);
  /* ---- move ---- */
  C.x+=C.vx*dt;C.z+=C.vz*dt;
  /* ---- steep ground (cut banks, cliffs) is a wall ---- */
  if(C.speed>1){const px=C.x+C.vx/C.speed*2.3,pz=C.z+C.vz/C.speed*2.3,hp=groundAt(px,pz,C.y+.3);
    if(hp-C.y>1.05){let gx=terrainH(px+2,pz)-terrainH(px-2,pz),gz=terrainH(px,pz+2)-terrainH(px,pz-2);const gl=Math.hypot(gx,gz);if(gl<.05){gx=C.vx;gz=C.vz;const l=Math.hypot(gx,gz)||1;gx/=l;gz/=l}else{gx/=gl;gz/=gl}
      C.x=C.px;C.z=C.pz;const vin=C.vx*gx+C.vz*gz;if(vin>0){C.vx-=1.3*vin*gx;C.vz-=1.3*vin*gz;const sc=1-Math.min(.5,vin*.012);C.vx*=sc;C.vz*=sc;C.hit=Math.max(C.hit,vin);C.shake=Math.min(1,C.shake+vin*.03)}}}
  /* ---- guard rails ---- */
  if(roadAt(C.x,C.z,C.y)&&RQ.rail){const lim=RQ.hw+.55,a=RQ.lat;if((a>lim&&(RQ.rail&2))||(a<-lim&&(RQ.rail&1))){const out=Math.abs(a)-lim,sg=a>0?1:-1;C.x-=RQ.nx*sg*out;C.z-=RQ.nz*sg*out;const vn=C.vx*RQ.nx*sg+C.vz*RQ.nz*sg;if(vn>0){C.vx-=RQ.nx*sg*vn*1.25;C.vz-=RQ.nz*sg*vn*1.25;const sc=1-Math.min(.25,vn*.012);C.vx*=sc;C.vz*=sc;C.hit=Math.max(C.hit,vn);C.shake=Math.min(1,C.shake+vn*.03)}}}
  /* ---- solid things: buildings, poles, trees ---- */
  collide(fx,fz);
  C.ax+=(((f-f0)/dt)-C.ax)*Math.min(1,dt*6);
  /* ---- visual attitude ---- */
  const ta=gr?14:1.6,kk=1-Math.exp(-dt*ta);
  C.pitch+=((gr?tp+clamp(C.ax*.0028,-.07,.05):Math.atan2(C.vy,Math.max(8,af))*.8)-C.pitch)*kk;C.roll+=((gr?tr+clamp(C.wyaw*f*.0042,-.09,.09):0)-C.roll)*kk;
  /* body roll in corners and squat/dive */
  if(gr)C.bob*=Math.max(0,1-dt*8);
  C.spin+=f*dt/.34;C.steerVis+=((-steer*.5*(1-sp*.55))-C.steerVis)*Math.min(1,dt*14);
  C.speed=Math.hypot(C.vx,C.vz);C.fwd=f;C.lat=s;C.kmh=C.speed*3.6;C.braking=brk>0&&f>1.5?1:0;C.t+=dt;C.distance+=C.speed*dt;C.shake*=Math.max(0,1-dt*5);C.flash*=Math.max(0,1-dt*3);C.hit*=Math.max(0,1-dt*6);
  /* last safe spot (on a road, moving, dry) for respawns */
  if(C.onRoad&&gr&&C.speed>3&&C.t-C.safeT>.6){C.safeT=C.t;C.safeX=C.x;C.safeZ=C.z;C.safeY=C.y;C.safeYaw=C.yaw}
  /* water */
  if(terrainH(C.x,C.z)<-1.2&&!C.onRoad){C.wet+=dt;C.vx*=1-dt*2.5;C.vz*=1-dt*2.5;C.y=Math.max(C.y,-1.2-C.wet*.3);if(C.wet>1.4){respawn();C.wet=0}}else C.wet=0;
  if(IN.respawn){IN.respawn=0;respawn()}
}
/* two circles along the car vs rects and circles from the spatial hash */
function collide(fx,fz){
  for(let ci=0;ci<2;ci++){const off=ci?-1.25:1.25,cx=C.x+fx*off,cz=C.z+fz*off,cs=QH.ccs,cn=QH.cnc,a=Math.floor((cx+W.half)/cs),b=Math.floor((cz+W.half)/cs);if(a<1||b<1||a>=cn-1||b>=cn-1)continue;
    for(let bb=b-1;bb<=b+1;bb++)for(let aa=a-1;aa<=a+1;aa++){const c=bb*cn+aa;for(let q=QH.cst[c];q<QH.cst[c+1];q++){const k=QH.cli[q];let nx=0,nz=0,pen=0;
      if(k<QH.nR){const x0=QH.CR[k*5],z0=QH.CR[k*5+1],x1=QH.CR[k*5+2],z1=QH.CR[k*5+3],top=QH.CR[k*5+4];if(C.y>top+.5)continue;const px=cx<x0?x0:cx>x1?x1:cx,pz=cz<z0?z0:cz>z1?z1:cz,dx=cx-px,dz=cz-pz,d2=dx*dx+dz*dz;
        if(d2>=RADIUS*RADIUS)continue;if(d2>1e-6){const d=Math.sqrt(d2);nx=dx/d;nz=dz/d;pen=RADIUS-d}else{const l=cx-x0,r=x1-cx,t=cz-z0,bt=z1-cz,m=Math.min(l,r,t,bt);if(m==l){nx=-1}else if(m==r){nx=1}else if(m==t){nz=-1}else nz=1;pen=RADIUS+m}}
      else{const j=k-QH.nR,x=QH.CC[j*3],z=QH.CC[j*3+1],r=QH.CC[j*3+2]+RADIUS*.8,dx=cx-x,dz=cz-z,d2=dx*dx+dz*dz;if(d2>=r*r||d2<1e-8)continue;const d=Math.sqrt(d2);nx=dx/d;nz=dz/d;pen=r-d}
      C.x+=nx*pen;C.z+=nz*pen;const vn=C.vx*nx+C.vz*nz;
      if(vn<0){const e=.22;C.vx-=(1+e)*vn*nx;C.vz-=(1+e)*vn*nz;const sc=1-Math.min(.45,-vn*.02);C.vx*=sc;C.vz*=sc;C.hit=Math.max(C.hit,-vn);C.shake=Math.min(1,C.shake+-vn*.04);
        /* a glancing hit turns the nose along the wall */const tx=-nz,tz=nx,al=C.vx*tx+C.vz*tz,fa=Math.sin(C.yaw)*tx-Math.cos(C.yaw)*tz;C.wyaw+=(fa>0?-1:1)*Math.min(1.2,-vn*.05)*(ci?1:-1)*.3}}}}}
/* ---------- chase camera ---------- */
const CAM={x:0,y:0,z:0,tx:0,ty:0,tz:0,fov:1.08};
function camStep(dt,snap){
  const sp=Math.min(1,C.speed/70),tgtYaw=C.speed>6?Math.atan2(C.vx,-C.vz):C.yaw;
  /* look a little towards where the car points and a little towards where it is going, so drifts are visible */
  const want=C.yaw+angd(tgtYaw,C.yaw)*(.12+.5*Math.min(1,C.drift*1.2));
  C.camYaw+=angd(want,C.camYaw)*(snap?1:1-Math.exp(-dt*(3.2+sp*2.5)));
  const dist=5.7+sp*1.9+(C.boosting?1.1:0),h=1.95+sp*.55;
  const cyw=C.camYaw,x=C.x-Math.sin(cyw)*dist,z=C.z+Math.cos(cyw)*dist;let y=C.y+h;
  const gh=groundAt(x,z,C.y)+1.3;if(y<gh)y=gh;
  const k=snap?1:1-Math.exp(-dt*(10));C.camY+=(y-C.camY)*k;if(snap)C.camY=y;
  CAM.x=x;CAM.y=C.camY;CAM.z=z;
  const la=9+sp*8;CAM.tx=C.x+Math.sin(cyw)*la;CAM.tz=C.z-Math.cos(cyw)*la;CAM.ty=C.y+1.15+(C.camY-(C.y+h))*.2+C.vy*.02;
  const shk=C.shake*.12;if(shk>.002){CAM.x+=(Math.random()-.5)*shk;CAM.y+=(Math.random()-.5)*shk;CAM.z+=(Math.random()-.5)*shk}
  const tf=1.05+sp*.22+(C.boosting?.1:0);C.fov+=(tf-C.fov)*(snap?1:1-Math.exp(-dt*3));CAM.fov=C.fov}
/* ---------- effects: blob shadow, smoke, skid marks ---------- */
const SKID=[],SKMAX=240;let skidHead=0;const SMOKE=[];for(let i=0;i<64;i++)SMOKE.push({x:0,y:0,z:0,vx:0,vy:0,vz:0,age:9,life:1,sz:1,a:0});let smokeHead=0;
const lastSk=[[0,0,0,0],[0,0,0,0]];let skCool=0;
function fxUpdate(dt){
  /* tyre smoke + skid marks from the rear wheels while sliding */
  const act=C.grounded&&C.drift>.35&&C.slip>.1&&C.speed>10,sy=Math.sin(C.yaw),cy=Math.cos(C.yaw);
  for(let w=0;w<2;w++){const sd=w?1:-1,px=C.x-sy*1.3+cy*sd*.8,pz=C.z+cy*1.3+sy*sd*.8;
    if(act){const L=lastSk[w];if(L[3]){const q=SKID[skidHead%SKMAX]=SKID[skidHead%SKMAX]||new Float32Array(8);q[0]=L[0];q[1]=L[1];q[2]=px;q[3]=pz;q[4]=C.y;q[5]=C.t;q[6]=Math.min(1,C.drift);skidHead++}L[0]=px;L[1]=pz;L[3]=1}else lastSk[w][3]=0}
  if(act||C.boosting){skCool-=dt;while(skCool<=0){skCool+=.035;const s=SMOKE[smokeHead++%64],sd=Math.random()<.5?-1:1;s.x=C.x-sy*1.4+cy*sd*.8;s.z=C.z+cy*1.4+sy*sd*.8;s.y=C.y+.25;s.vx=C.vx*.25+(Math.random()-.5)*1.5;s.vz=C.vz*.25+(Math.random()-.5)*1.5;s.vy=1+Math.random()*1.2;s.age=0;s.life=.9+Math.random()*.6;s.sz=.9;s.a=act?.5:.3;s.fire=!act}}
  for(const s of SMOKE){if(s.age<s.life){s.age+=dt;s.x+=s.vx*dt;s.y+=s.vy*dt;s.z+=s.vz*dt;s.vy*=Math.max(0,1-dt*1.2)}}}
function fxDraw(){
  const gl=G.gl,P=G.P.fx,F=R.fxF;let n=0;
  const quad=(x0,y0,z0,x1,y1,z1,x2,y2,z2,x3,y3,z3,r,g,b,a)=>{if(n>=R.fxMax)return;let o=n*36;
    F[o]=x0;F[o+1]=y0;F[o+2]=z0;F[o+3]=r;F[o+4]=g;F[o+5]=b;F[o+6]=a;F[o+7]=0;F[o+8]=0;o+=9;
    F[o]=x1;F[o+1]=y1;F[o+2]=z1;F[o+3]=r;F[o+4]=g;F[o+5]=b;F[o+6]=a;F[o+7]=1;F[o+8]=0;o+=9;
    F[o]=x2;F[o+1]=y2;F[o+2]=z2;F[o+3]=r;F[o+4]=g;F[o+5]=b;F[o+6]=a;F[o+7]=1;F[o+8]=1;o+=9;
    F[o]=x3;F[o+1]=y3;F[o+2]=z3;F[o+3]=r;F[o+4]=g;F[o+5]=b;F[o+6]=a;F[o+7]=0;F[o+8]=1;n++};
  const x=C.x,z=C.z,sy=Math.sin(C.yaw),cy=Math.cos(C.yaw);
  /* blob shadow under the car (mode 0 batch comes first) */
  const gy=C.gs+.04,L=2.6,Wd=1.35;quad(x+sy*-L-cy*Wd,gy,z+cy*L-sy*Wd,x+sy*-L+cy*Wd,gy,z+cy*L+sy*Wd,x+sy*L+cy*Wd,gy,z-cy*L+sy*Wd,x+sy*L-cy*Wd,gy,z-cy*L-sy*Wd,0,0,0,.5/(1+Math.max(0,C.y-C.gs)*.4));
  const nShadow=n;
  /* skid marks (mode 2 batch) */
  const nsk=Math.min(skidHead,SKMAX);for(let i=0;i<nsk;i++){const q=SKID[i],age=C.t-q[5];if(age>40)continue;const dx=q[2]-q[0],dz=q[3]-q[1],l=Math.hypot(dx,dz)||1,nx=-dz/l*.14,nz=dx/l*.14,y=q[4]+.05,a=.55*(1-age/40)*q[6];if(l>6)continue;
    quad(q[0]-nx,y,q[1]-nz,q[0]+nx,y,q[1]+nz,q[2]+nx,y,q[3]+nz,q[2]-nx,y,q[3]-nz,.02,.02,.02,a)}
  const nSkid=n;
  /* smoke + exhaust flame puffs (mode 1 batch): camera-facing quads */
  const rx=R.rt[0],rz=R.rt[2];for(const s of SMOKE){if(s.age>=s.life||n>=R.fxMax)continue;const t=s.age/s.life,sz=s.sz+t*2.6,a=s.a*(1-t)*(1-t);const ux=R.up[0]*sz,uy=R.up[1]*sz,uz=R.up[2]*sz,hx=rx*sz,hz=rz*sz;
    const cr=s.fire?1:.86,cg=s.fire?.55-.4*t:.86,cb=s.fire?.2:.88;quad(s.x-hx-ux,s.y-uy,s.z-hz-uz,s.x+hx-ux,s.y-uy,s.z+hz-uz,s.x+hx+ux,s.y+uy,s.z+hz+uz,s.x-hx+ux,s.y+uy,s.z-hz+uz,cr,cg,cb,a)}
  if(!n)return;gl.useProgram(P.p);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);gl.bindBuffer(gl.ARRAY_BUFFER,R.fx);gl.bufferSubData(gl.ARRAY_BUFFER,0,F.subarray(0,n*36));gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,R.fxIx);attrs(3);
  gl.vertexAttribPointer(0,3,gl.FLOAT,false,36,0);gl.vertexAttribPointer(1,4,gl.FLOAT,false,36,12);gl.vertexAttribPointer(2,2,gl.FLOAT,false,36,28);gl.disable(gl.CULL_FACE);
  gl.uniform1f(P.u.uMode,0);gl.drawElements(gl.TRIANGLES,nShadow*6,gl.UNSIGNED_SHORT,0);
  if(nSkid>nShadow){gl.uniform1f(P.u.uMode,2);gl.drawElements(gl.TRIANGLES,(nSkid-nShadow)*6,gl.UNSIGNED_SHORT,nShadow*12)}
  if(n>nSkid){gl.uniform1f(P.u.uMode,1);gl.drawElements(gl.TRIANGLES,(n-nSkid)*6,gl.UNSIGNED_SHORT,nSkid*12)}R.draws+=3}
