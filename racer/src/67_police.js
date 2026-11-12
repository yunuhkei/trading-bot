'use strict';
/* ===== batch 3: police helicopters and spike strips =====
   HELICOPTERS (from 4 stars, STARS[heat].heli of them): a navy and white helicopter with a cabin, a tail boom and fin, skids, a main rotor and a tail rotor that blur into discs, a spotlight that
   follows you (a beam and a pool of light), and the chop of the rotor. It flies 32-45 m above the ground, holds a slot behind or beside you and keeps you in its light: while it is within
   220 m you cannot lose the police. It has fuel for 75 s, then it peels off; the next one comes 25 s later (that gap is your chance to escape). Drawn with the car program (one draw each).
   SPIKE STRIPS (from 4 stars): every 16-20 s a strip is laid 150-230 m ahead of you across ONE lane, the one you are in (one and a half lanes at five stars, plus a second strip 30 m on over the other side): swerve round it. A police car stands beside it. It lies there for 40 s. Driving over it bursts the tyres: a bang, sparks from the rims,
   "TYRES BURST" and a short loss of grip (7.8 s on the rims: grip down to 40 %, the car wanders and pulls to one side, top speed about 90 km/h, then the tyres reinflate; approved by the owner). THIS IS A DELIBERATE EXCEPTION to "damage never changes how the car drives". */
const HELI={list:[],mesh:null,nextT:0,want:0,chop:0,near:1e9,made:0};
const SPIKE={list:[],nextT:0,hits:0},HELI_PAINT=new Float32Array([.012,.03,.09]);
/* the helicopter mesh, built at a third of its size (the car mesh format holds +-4 m) and drawn three times bigger */
function heliMesh(){const b=new CGB(),M=CGM,k=1/3,box=(x,y,z,hx,hy,hz,m)=>cgBox(b,x*k,y*k,z*k,hx*k,hy*k,hz*k,m,0);
  box(0,1.7,-.4,.95,.85,1.9,M.paint);box(0,1.55,-2.55,.8,.7,.45,M.glass);box(0,2.05,-1.7,.85,.42,.55,M.glass);box(0,1.55,-1.0,.97,.45,1.05,M.plate);   /* cabin, nose glass, windscreen, white band */
  box(0,2.65,-.3,.55,.22,1.2,M.paint);box(0,2.95,-.2,.1,.18,.1,M.trim);                                                                               /* engine housing and the rotor mast */
  box(0,2.0,3.2,.22,.25,2.4,M.paint);box(0,2.7,5.4,.06,.75,.45,M.paint);box(.2,2.2,5.5,.04,.55,.55,M.trim);                                            /* tail boom, fin, the tail rotor hub */
  for(const sd of[-1,1]){box(sd*.85,.12,-.4,.06,.06,1.8,M.trim);box(sd*.75,.55,-1.2,.04,.42,.04,M.trim);box(sd*.75,.55,.6,.04,.42,.04,M.trim);box(sd*.98,1.8,-.6,.02,.35,.9,M.glass)}   /* skids and struts, side windows */
  box(0,.95,-2.7,.18,.14,.16,M.head);box(0,.45,-1.6,.14,.1,.14,M.chrome);box(0,3.0,1.6,.05,.05,.05,M.tail);box(0,1.0,1.0,.05,.05,.05,M.amber);              /* searchlight, camera ball, beacons */
  return b}
function heliInit(){if(!G.gl)return;const B=heliMesh();HELI.mesh=_mkMesh(G.gl,B,m=>m==CGM.paint?[255,255,255]:CGCOL[m])}
function heliSpawn(i){const ux=C.speed>3?C.vx/C.speed:Math.sin(C.yaw),uz=C.speed>3?C.vz/C.speed:-Math.cos(C.yaw);
  HELI.list.push({x:C.x-ux*260+(i&1?60:-60),z:C.z-uz*260,y:C.y+60,yaw:Math.atan2(ux,-uz),vx:ux*40,vz:uz*40,vy:0,rot:0,fuel:75,slot:i,px:0,py:0,pz:0,pyaw:0,leave:0});HELI.made++}
function copHeliTick(dt){
  const want=COP.heat>0?((STARS[COP.heat]||{}).heli||0):0;HELI.want=want;let near=1e9;
  if(HELI.nextT>0)HELI.nextT-=dt;
  const active=HELI.list.filter(h=>!h.leave).length;if(active<want&&HELI.nextT<=0){heliSpawn(HELI.list.length);HELI.nextT=active+1<want?4:0}
  for(const h of HELI.list){h.px=h.x;h.py=h.y;h.pz=h.z;h.pyaw=h.yaw;h.fuel-=dt;if((h.fuel<=0||want==0)&&!h.leave){h.leave=1;if(want>0)HELI.nextT=25}
    const ps=C.speed,ux=ps>3?C.vx/ps:Math.sin(C.yaw),uz=ps>3?C.vz/ps:-Math.cos(C.yaw),side=h.slot%3==0?0:h.slot%3==1?-1:1;
    let tx=C.x-ux*(22+8*(h.slot%3))+(-uz)*side*24+C.vx*.8,tz=C.z-uz*(22+8*(h.slot%3))+ux*side*24+C.vz*.8,ty=Math.max(terrainH(tx,tz),C.y)+32+5*(h.slot%3);
    if(h.leave){tx=h.x+h.vx*10+(h.slot&1?400:-400);tz=h.z+h.vz*10;ty=h.y+40}
    const dx=tx-h.x,dz=tz-h.z,d=Math.hypot(dx,dz),vmax=Math.min(85,ps*1.25+30),vw=Math.min(vmax,d*.9),ax=(dx/(d||1)*vw-h.vx)*1.3,az=(dz/(d||1)*vw-h.vz)*1.3,al=Math.hypot(ax,az),lim=14;
    h.vx+=(al>lim?ax/al*lim:ax)*dt;h.vz+=(al>lim?az/al*lim:az)*dt;h.vy+=((ty-h.y)*.8-h.vy)*Math.min(1,dt*2);h.x+=h.vx*dt;h.z+=h.vz*dt;h.y+=h.vy*dt;
    const gy=terrainH(h.x,h.z)+18;if(h.y<gy)h.y=gy;
    /* it faces you (the spotlight is in its nose), banked into its turns */
    const face=Math.atan2(C.x-h.x,-(C.z-h.z));h.yaw+=angd(h.leave?Math.atan2(h.vx,-h.vz):face,h.yaw)*Math.min(1,dt*1.5);h.rot+=dt*38;
    h.pitch=clamp((h.vx*Math.sin(h.yaw)-h.vz*Math.cos(h.yaw))*-.006,-.25,.25);h.roll=clamp((h.vx*Math.cos(h.yaw)+h.vz*Math.sin(h.yaw))*.006,-.3,.3);
    const dd=Math.hypot(h.x-C.x,h.z-C.z);if(!h.leave){near=Math.min(near,dd);if(dd<220){COP.sightT=0;COP.heliSeen=1}}}
  HELI.list=HELI.list.filter(h=>!(h.leave&&Math.hypot(h.x-C.x,h.z-C.z)>700));HELI.near=near;if(COP.heat==0&&!HELI.list.length)HELI.nextT=0}
function heliDraw(){
  if(!HELI.list.length||!HELI.mesh)return;const gl=G.gl,P=G.P.car,a=R.alpha,S=3/8192,M=new Float32Array(16);
  gl.useProgram(P.p);setEnvU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);gl.uniform4fv(P.u.uMat,CARM.mat);gl.uniform1f(P.u.uGl,0);carPaintU(P,HELI_PAINT);attrs(3);gl.disable(gl.CULL_FACE);
  gl.uniform3f(P.u.uBr,0,0,0);gl.uniform1f(P.u.uAlpha,1);gl.uniform3f(P.u.uWh,0,1,0);gl.uniform4f(P.u.uArch,0,0,0,0);gl.uniform4f(P.u.uDm,0,0,0,0);gl.uniform4f(P.u.uCr,0,0,0,0);gl.uniform1f(P.u.uZc,0);
  for(const h of HELI.list){const x=lerp(h.px,h.x,a),y=lerp(h.py,h.y,a),z=lerp(h.pz,h.z,a),yaw=h.pyaw+angd(h.yaw,h.pyaw)*a;M4.trs(M,x,y,z,-yaw,h.pitch||0,h.roll||0,S,S,S);drawCarMesh(HELI.mesh,M)}}
/* rotor discs (in the dark blob batch), the spotlight beam and its pool (additive), called from fxDraw */
function heliFx(quad,flat,stage){
  const a=R.alpha;
  for(const h of HELI.list){const x=lerp(h.px,h.x,a),y=lerp(h.py,h.y,a),z=lerp(h.pz,h.z,a),yaw=h.pyaw+angd(h.yaw,h.pyaw)*a,fx=Math.sin(yaw),fz=-Math.cos(yaw);
    if(stage==0){const ry=y+3.35,R0=6.2;quad(x-R0,ry,z-R0,x+R0,ry,z-R0,x+R0,ry,z+R0,x-R0,ry,z+R0,0,0,0,.32);
      const tx=x-fx*5.5+Math.cos(yaw)*.75,tz=z-fz*5.5+Math.sin(yaw)*.75,ty=y+2.25,r=1.1;quad(tx,ty-r,tz-fz*r,tx,ty-r,tz+fz*r,tx,ty+r,tz+fz*r,tx,ty+r,tz-fz*r,0,0,0,.28)}
    else if(!h.leave&&stage==5){const gy=C.gs+.06;flat(C.x+C.vx*.1,gy,C.z+C.vz*.1,8,8,1,.97,.85,.5)}
    else if(!h.leave&&stage==6){const sx=x+fx*2.6,sz=z+fz*2.6,sy=y+.3,gx=C.x,gz=C.z,gy=C.gs+.1,dx=gx-sx,dz=gz-sz,l=Math.hypot(dx,dz)||1,px=-dz/l,pz=dx/l;
      quad(sx-px*.3,sy,sz-pz*.3,sx+px*.3,sy,sz+pz*.3,gx+px*6,gy,gz+pz*6,gx-px*6,gy,gz-pz*6,1,.96,.85,.16)}}
  /* a spike strip: a dark mat 2 m wide across the whole road with a pale steel ridge of teeth standing on it */
  if(stage==2)for(const s of SPIKE.list){const L=s.hw,nx=s.nx,nz=s.nz,tx=-nz,tz=nx,w=1.1,y=s.y+.05;quad(s.x-tx*w-nx*L,y,s.z-tz*w-nz*L,s.x+tx*w-nx*L,y,s.z+tz*w-nz*L,s.x+tx*w+nx*L,y,s.z+tz*w+nz*L,s.x-tx*w+nx*L,y,s.z-tz*w+nz*L,.03,.03,.035,.95);
      for(const o of[-.4,0,.4])quad(s.x+tx*(o-.07)-nx*L,y+.02,s.z+tz*(o-.07)-nz*L,s.x+tx*(o+.07)-nx*L,y+.3,s.z+tz*(o+.07)-nz*L,s.x+tx*(o+.07)+nx*L,y+.3,s.z+tz*(o+.07)+nz*L,s.x+tx*(o-.07)+nx*L,y+.02,s.z+tz*(o-.07)+nz*L,.82,.85,.9,.95)}}
/* the glints of the spikes (sprites) */
function spikeFx(sprite,SRN){const on=Math.sin(R.time*14)>0;for(const s of SPIKE.list){const d=Math.hypot(s.x-C.x,s.z-C.z);if(d>260)continue;for(let k=-6;k<=6;k++){const q=k/6*s.hw;sprite(s.x+s.nx*q,s.y+.24,s.z+s.nz*q,.2+d*.004,.9,.92,1,.9)}
    /* a red flasher at each end, so the strip reads from a distance in daylight too */
    if(SRN)for(const sd of[-1,1])SRN.push(s.x+s.nx*s.hw*sd,s.y+.5,s.z+s.nz*s.hw*sd,(on==(sd>0)?.7:.3)+d*.006,1,.12,.08,on==(sd>0)?.95:.4)}}
/* ---- spike strips ---- */
function copSpikeTick(dt){if(COP.spikeWarn>0)COP.spikeWarn-=dt;
  const on=COP.heat>0&&(STARS[COP.heat]||{}).spikes;for(const s of SPIKE.list)s.life-=dt;SPIKE.list=SPIKE.list.filter(s=>s.life>0);
  if(on&&C.speed>14&&COP.sightT<1.5){SPIKE.nextT-=dt;if(SPIKE.nextT<=0){SPIKE.nextT=16+TR.rng()*4;const ux=C.vx/C.speed,uz=C.vz/C.speed,dd=150+TR.rng()*80;
      if(copAhead(dd,ux,uz)){const r=ROADS[TRP.ri],i=TRP.i,t=_tan(r,i),nx=-t[1],nz=t[0];
        /* batch 9: a strip covers one lane (one and a half at five stars) where YOU are driving, so you can swerve round it; at five stars a second strip 30 m on covers the other side.
           A police car stands at the road's edge beside it. */
        roadAt(C.x,C.z,C.y);const myLat=RQ.ri===TRP.ri?RQ.lat*((RQ.nx*nx+RQ.nz*nz)>0?1:-1):0,five=COP.heat>=5,shw=five?2.7:1.9,lim=r.hw-shw-.3,lat=clamp(myLat,-lim,lim);
        const put=(ii,la)=>{SPIKE.list.push({x:r.X[ii]+nx*la,z:r.Z[ii]+nz*la,y:r.Y[ii],nx,nz,hw:shw,life:40});copSpikeCar(r,ii,la>0?-1:1)};
        put(i,lat);if(five){const sg=(t[0]*ux+t[1]*uz)>=0?1:-1,j=Math.min(r.n-2,Math.max(1,i+sg*Math.round(30/r.ds)));put(j,clamp(-lat*.8+(lat>0?-1:1)*shw,-lim,lim))}COP.spikeWarn=3}}}
  else SPIKE.nextT=Math.min(SPIKE.nextT,5)}
/* the police car that laid the strip, parked on the road's edge beside it (on the other side from the strip) */
function copSpikeCar(r,i,side){const e=LG.ofRoad[ROADS.indexOf(r)]&&LG.ofRoad[ROADS.indexOf(r)][0][0];if(!e)return;const t=_tan(r,i),nx=-t[1],nz=t[0],o=side*(r.hw-1.4);
  const c=trPlace(e,Math.max(3,Math.min(e.n-4,i)),COP.heat>=4?21:4,12,0,Math.floor(TR.rng()*1e9));if(!c)return;c.x=c.px=r.X[i]+nx*o;c.z=c.pz=r.Z[i]+nz*o;c.yaw=c.pyaw=Math.atan2(t[0],-t[1])+side*.35;c.y=c.py=r.Y[i];
  c.state=1;c.kind=1;c.cm=3;c.block=1;c.siren=1;c.life=40;c.vx=c.vz=c.om=c.v=0;c.wt=0;c.L=null}
/* called every physics step from carStep: has a wheel crossed a strip? */
function spikeCheck(){if(!SPIKE.list.length||!C.grounded||C.shield>0)return;
  for(const s of SPIKE.list){const dx=C.x-s.x,dz=C.z-s.z,lat=dx*s.nx+dz*s.nz,al=-dx*s.nz+dz*s.nx;if(Math.abs(lat)<s.hw&&Math.abs(al)<1.6&&Math.abs(C.y-s.y)<2&&!(C.flatT>0)){
      C.flatT=7.8;C.flatSide=Math.random()<.5?-1:1;SPIKE.hits++;C.shake=Math.min(1,C.shake+.5);C.bob=-.06;safeToast('TYRES BURST',2.6);if(typeof sparkAt==='function')sparkAt(C.x,C.y+.3,C.z,0,0,18,6);if(typeof audioBang==='function')audioBang();s.life=Math.min(s.life,3)}}}
