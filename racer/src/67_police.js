'use strict';
/* ===== batch 3: police helicopters and spike strips =====
   HELICOPTERS (from 4 stars, STARS[heat].heli of them): a navy and white helicopter with a cabin, a tail boom and fin, skids, a main rotor and a tail rotor that blur into discs, a spotlight that
   follows you (a beam and a pool of light), and the chop of the rotor. It flies 32-45 m above the ground, holds a slot behind or beside you and keeps you in its light: while it is within
   220 m you cannot lose the police. It has fuel for 75 s (55 s at four stars, batch 68), then it peels off; the next one comes 25 s later, and (batch 68) only if a police car can see you then (that gap is your chance to escape). Drawn with the car program (one draw each).
   (batch 68) THE HELICOPTER DROPS SPIKES: about 10 s after it arrives, then every 13-17 s, it speeds up past you, and once it is 50 m or more ahead of you it throws a spike
   strip down onto the lane you are in (it lands 90 m + 1.2 s of your speed ahead of you, falling for 1.2 s, with sparks where it lands): "HELICOPTER DROPPED SPIKES AHEAD". Swerve
   round it like any strip. If it cannot get ahead in 10 s (you are too fast), it gives up and tries again later. It waits if a strip was laid in the last 6 s.
   SPIKE STRIPS (from 4 stars): every 16-20 s a strip is laid 150-230 m ahead of you across ONE lane, the one you are in (one and a half lanes at five stars, plus a second strip 30 m on over the other side): swerve round it. A police car stands beside it. It lies there for 40 s. Driving over it bursts the tyres: a bang, sparks from the rims,
   "TYRES BURST" and a short loss of grip (7.8 s on the rims: grip down to 40 %, the car wanders and pulls to one side, top speed about 90 km/h, then the tyres reinflate; approved by the owner). THIS IS A DELIBERATE EXCEPTION to "damage never changes how the car drives". */
const HELI={list:[],mesh:null,nextT:0,want:0,chop:0,near:1e9,made:0};
const SPIKE={list:[],fall:[],nextT:0,hits:0,drops:0},HELI_PAINT=new Float32Array([.012,.03,.09]);
/* the helicopter mesh, built at a third of its size (the car mesh format holds +-4 m) and drawn three times bigger */
function heliMesh(){const b=new CGB(),M=CGM,k=1/3,box=(x,y,z,hx,hy,hz,m)=>cgBox(b,x*k,y*k,z*k,hx*k,hy*k,hz*k,m,0);
  box(0,1.7,-.4,.95,.85,1.9,M.paint);box(0,1.55,-2.55,.8,.7,.45,M.glass);box(0,2.05,-1.7,.85,.42,.55,M.glass);box(0,1.55,-1.0,.97,.45,1.05,M.plate);   /* cabin, nose glass, windscreen, white band */
  box(0,2.65,-.3,.55,.22,1.2,M.paint);box(0,2.95,-.2,.1,.18,.1,M.trim);                                                                               /* engine housing and the rotor mast */
  box(0,2.0,3.2,.22,.25,2.4,M.paint);box(0,2.7,5.4,.06,.75,.45,M.paint);box(.2,2.2,5.5,.04,.55,.55,M.trim);                                            /* tail boom, fin, the tail rotor hub */
  for(const sd of[-1,1]){box(sd*.85,.12,-.4,.06,.06,1.8,M.trim);box(sd*.75,.55,-1.2,.04,.42,.04,M.trim);box(sd*.75,.55,.6,.04,.42,.04,M.trim);box(sd*.98,1.8,-.6,.02,.35,.9,M.glass)}   /* skids and struts, side windows */
  box(0,.95,-2.7,.18,.14,.16,M.head);box(0,.45,-1.6,.14,.1,.14,M.chrome);box(0,3.0,1.6,.05,.05,.05,M.tail);box(0,1.0,1.0,.05,.05,.05,M.amber);              /* searchlight, camera ball, beacons */
  return b}
function heliInit(){if(!G.gl)return;const B=heliMesh();HELI.mesh=_mkMesh(G.gl,B,m=>m==CGM.paint?[255,255,255]:CGCOL[m])}
/* (batch 79) what the helicopter can do: lose you beyond HELI_LOSE m, pick you up again within HELI_FIND m, fly at HELI_VMAX */
const HELI_LOSE=260,HELI_FIND=190,HELI_VMAX=()=>COP.heat>=5?68:60;   /* (batch 83) a little keener: 260 / 190 m, 134 mph (152 at five stars); it was 230 / 160 m and 125 / 143 mph */
function heliSpawn(i){const ux=C.speed>3?C.vx/C.speed:Math.sin(C.yaw),uz=C.speed>3?C.vz/C.speed:-Math.cos(C.yaw);
  HELI.list.push({x:C.x-ux*150+(i&1?40:-40),z:C.z-uz*150,   /* (batch 79) arrives 150 m behind you, inside the distance at which it can see you (it came from 260 m) */y:C.y+60,yaw:Math.atan2(ux,-uz),vx:ux*40,vz:uz*40,vy:0,rot:0,fuel:COP.heat>=5?75:55,slot:i,px:0,py:0,pz:0,pyaw:0,leave:0,dropT:10+i*5,run:0,lock:1,lx:C.x,lz:C.z});HELI.made++}
function copHeliTick(dt){
  const want=COP.heat>0?((STARS[COP.heat]||{}).heli||0):0;HELI.want=want;let near=1e9;
  if(HELI.nextT>0)HELI.nextT-=dt;
  const active=HELI.list.filter(h=>!h.leave).length;if(active<want&&HELI.nextT<=0&&COP.sightT<2){heliSpawn(HELI.list.length);HELI.nextT=active+1<want?4:0}   /* (batch 68) a helicopter is only called in while a police car can see you: lose them while it refuels and none comes back */
  for(const h of HELI.list){h.px=h.x;h.py=h.y;h.pz=h.z;h.pyaw=h.yaw;h.fuel-=dt;if((h.fuel<=0||want==0)&&!h.leave){h.leave=1;if(want>0)HELI.nextT=25}
    const ps=C.speed,ux=ps>3?C.vx/ps:Math.sin(C.yaw),uz=ps>3?C.vz/ps:-Math.cos(C.yaw),side=h.slot%3==0?0:h.slot%3==1?-1:1;
    const sd2=side||(h.slot&1?1:-1);let tx=C.x+ux*(75+10*(h.slot%3))+(-uz)*sd2*20+C.vx*.4,tz=C.z+uz*(75+10*(h.slot%3))+ux*sd2*20+C.vz*.4,ty=Math.max(terrainH(tx,tz),C.y)+14+3*(h.slot%3);   /* (batch 69) lower (14-20 m, was 32-45) and ahead to one side, so you see it in the windscreen doing its job */
    /* (batch 79) it has to SEE you: while it does (you within 230 m) it follows you; out of its sight it flies to the last place it saw you and circles there, its light sweeping the ground; it finds you again within 160 m */
    const dd0=Math.hypot(h.x-C.x,h.z-C.z);if(h.lock&&dd0>HELI_LOSE)h.lock=0;else if(!h.lock&&dd0<HELI_FIND)h.lock=1;if(h.lock){h.lx=C.x;h.lz=C.z}
    if(!h.lock){const a=COP.t*.5+h.slot*2.1;tx=h.lx+Math.cos(a)*70;tz=h.lz+Math.sin(a)*70;ty=Math.max(terrainH(tx,tz),C.y)+20;h.run=0}
    if(h.leave){tx=h.x+h.vx*10+(h.slot&1?400:-400);tz=h.z+h.vz*10;ty=h.y+40}
    /* (batch 68) a spike run: fly out ahead of you, then throw a strip down onto your lane */
    if(!h.leave&&h.lock){h.dropT-=dt;if(!h.run&&h.dropT<=0){if(ps>14&&COP.t-(SPIKE.lastT||-99)>6){h.run=1;h.runT=0}else h.dropT=2}
      if(h.run){h.runT+=dt;tx=C.x+ux*(90+ps*.6)+(-uz)*side*8;tz=C.z+uz*(90+ps*.6)+ux*side*8;ty=Math.max(terrainH(tx,tz),C.y)+18;
        const ah=(h.x-C.x)*ux+(h.z-C.z)*uz;if(ah>50&&heliDrop(h,ux,uz)){h.run=0;h.dropT=13+TR.rng()*4}else if(h.runT>10||ps<8){h.run=0;h.dropT=6+TR.rng()*4}}}
    const dx=tx-h.x,dz=tz-h.z,d=Math.hypot(dx,dz),vmax=Math.min(h.run?HELI_VMAX()+10:HELI_VMAX(),h.lock?ps*1.25+30:42),   /* (batch 79) a top speed a fast car can beat (125 mph at four stars, 143 at five; it was 190-270 mph) */vw=Math.min(vmax,d*.9),ax=(dx/(d||1)*vw-h.vx)*1.3,az=(dz/(d||1)*vw-h.vz)*1.3,al=Math.hypot(ax,az),lim=h.run?24:14;
    h.vx+=(al>lim?ax/al*lim:ax)*dt;h.vz+=(al>lim?az/al*lim:az)*dt;h.vy+=((ty-h.y)*.8-h.vy)*Math.min(1,dt*2);h.x+=h.vx*dt;h.z+=h.vz*dt;h.y+=h.vy*dt;
    const gy=terrainH(h.x,h.z)+11;if(h.y<gy)h.y=gy;
    /* it faces you (the spotlight is in its nose), banked into its turns */
    const face=h.lock?Math.atan2(C.x-h.x,-(C.z-h.z)):Math.atan2(h.vx,-h.vz);h.yaw+=angd(h.leave?Math.atan2(h.vx,-h.vz):face,h.yaw)*Math.min(1,dt*1.5);h.rot+=dt*38;
    h.pitch=clamp((h.vx*Math.sin(h.yaw)-h.vz*Math.cos(h.yaw))*-.006,-.25,.25);h.roll=clamp((h.vx*Math.cos(h.yaw)+h.vz*Math.sin(h.yaw))*.006,-.3,.3);
    const dd=Math.hypot(h.x-C.x,h.z-C.z);if(!h.leave){near=Math.min(near,dd);if(h.lock&&dd<HELI_LOSE){COP.sightT=0;COP.heliSeen=1}}}
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
    else if(!h.leave&&stage==5){if(h.lock){const gy=C.gs+.06;flat(C.x+C.vx*.1,gy,C.z+C.vz*.1,8,8,1,.97,.85,.5)}else{const gx=x+fx*18,gz=z+fz*18;flat(gx,terrainH(gx,gz)+.06,gz,8,8,1,.97,.85,.35)}}   /* (batch 79) searching: the light sweeps the ground ahead of it, not you */
    else if(!h.leave&&stage==6){const sx=x+fx*2.6,sz=z+fz*2.6,sy=y+.3,gx=h.lock?C.x:x+fx*18,gz=h.lock?C.z:z+fz*18,gy=h.lock?C.gs+.1:terrainH(gx,gz)+.1,dx=gx-sx,dz=gz-sz,l=Math.hypot(dx,dz)||1,px=-dz/l,pz=dx/l;
      quad(sx-px*.3,sy,sz-pz*.3,sx+px*.3,sy,sz+pz*.3,gx+px*6,gy,gz+pz*6,gx-px*6,gy,gz-pz*6,1,.96,.85,.16)}}
  /* a spike strip: a dark mat 2 m wide across the whole road with a pale steel ridge of teeth standing on it */
  if(stage==2)for(const s of SPIKE.list){const L=s.hw,nx=s.nx,nz=s.nz,tx=-nz,tz=nx,w=1.1,y=s.y+.05;quad(s.x-tx*w-nx*L,y,s.z-tz*w-nz*L,s.x+tx*w-nx*L,y,s.z+tz*w-nz*L,s.x+tx*w+nx*L,y,s.z+tz*w+nz*L,s.x-tx*w+nx*L,y,s.z-tz*w+nz*L,.03,.03,.035,.95);
      for(const o of[-.4,0,.4])quad(s.x+tx*(o-.07)-nx*L,y+.02,s.z+tz*(o-.07)-nz*L,s.x+tx*(o+.07)-nx*L,y+.3,s.z+tz*(o+.07)-nz*L,s.x+tx*(o+.07)+nx*L,y+.3,s.z+tz*(o+.07)+nz*L,s.x+tx*(o-.07)+nx*L,y+.02,s.z+tz*(o-.07)+nz*L,.82,.85,.9,.95)}}
/* the glints of the spikes (sprites) */
/* (batch 68) the helicopter throws a strip down onto the lane you are in, far enough ahead to swerve round it */
function heliDrop(h,ux,uz){const dd=90+C.speed*1.2;if(!copAhead(dd,ux,uz))return false;const r=ROADS[TRP.ri],i=TRP.i,t=_tan(r,i),nx=-t[1],nz=t[0];
  roadAt(C.x,C.z,C.y);const myLat=RQ.ri===TRP.ri?RQ.lat*((RQ.nx*nx+RQ.nz*nz)>0?1:-1):0,shw=COP.heat>=5?2.4:1.9,lim=r.hw-shw-.3,lat=clamp(myLat,-lim,lim);
  SPIKE.fall.push({x0:h.x,y0:h.y-1.5,z0:h.z,x:h.x,y:h.y,z:h.z,lx:r.X[i]+nx*lat,ly:r.Y[i],lz:r.Z[i]+nz*lat,nx,nz,hw:shw,t:0,T:1.2});SPIKE.drops++;SPIKE.lastT=COP.t;SPIKE.nextT=Math.max(SPIKE.nextT,6);COP.spikeWarn=3;COP.spikeHeli=1;return true}
function spikeFallTick(dt){for(const f of SPIKE.fall){f.t+=dt;const k=Math.min(1,f.t/f.T);f.x=f.x0+(f.lx-f.x0)*k;f.z=f.z0+(f.lz-f.z0)*k;f.y=f.y0+(f.ly-f.y0)*k*k+4*k*(1-k);
    if(k>=1){SPIKE.list.push({x:f.lx,z:f.lz,y:f.ly,nx:f.nx,nz:f.nz,hw:f.hw,life:25,heli:1});if(typeof sparkAt==='function'&&Math.hypot(f.lx-C.x,f.lz-C.z)<300)sparkAt(f.lx,f.ly+.3,f.lz,0,0,10,4)}}
  SPIKE.fall=SPIKE.fall.filter(f=>f.t<f.T)}
function spikeFx(sprite,SRN){{const on=Math.sin(R.time*18)>0;for(const f of SPIKE.fall){/* the falling strip: a dark bundle with a red flasher */const dd=Math.hypot(f.x-C.x,f.z-C.z);sprite(f.x,f.y,f.z,1.6+dd*.01,.3,.3,.34,.95);if(SRN)SRN.push(f.x,f.y+.6,f.z,(on?1.6:.8)+dd*.012,1,.12,.08,on?1:.5)}}const on=Math.sin(R.time*14)>0;for(const s of SPIKE.list){const d=Math.hypot(s.x-C.x,s.z-C.z);if(d>260)continue;for(let k=-6;k<=6;k++){const q=k/6*s.hw;sprite(s.x+s.nx*q,s.y+.24,s.z+s.nz*q,.2+d*.004,.9,.92,1,.9)}
    /* a red flasher at each end, so the strip reads from a distance in daylight too */
    if(SRN)for(const sd of[-1,1])SRN.push(s.x+s.nx*s.hw*sd,s.y+.5,s.z+s.nz*s.hw*sd,(on==(sd>0)?.7:.3)+d*.006,1,.12,.08,on==(sd>0)?.95:.4)}}
/* ---- spike strips ---- */
function copSpikeTick(dt){if(COP.spikeWarn>0)COP.spikeWarn-=dt;spikeFallTick(dt);
  const on=COP.heat>0&&(STARS[COP.heat]||{}).spikes;for(const s of SPIKE.list)s.life-=dt;SPIKE.list=SPIKE.list.filter(s=>s.life>0);
  if(on&&C.speed>14&&COP.sightT<1.5){SPIKE.nextT-=dt;if(SPIKE.nextT<=0){SPIKE.nextT=16+TR.rng()*4;const ux=C.vx/C.speed,uz=C.vz/C.speed,dd=150+TR.rng()*80;
      if(copAhead(dd,ux,uz)){const r=ROADS[TRP.ri],i=TRP.i,t=_tan(r,i),nx=-t[1],nz=t[0];
        /* batch 9: a strip covers one lane (one and a half at five stars) where YOU are driving, so you can swerve round it; at five stars a second strip 30 m on covers the other side.
           A police car stands at the road's edge beside it. */
        roadAt(C.x,C.z,C.y);const myLat=RQ.ri===TRP.ri?RQ.lat*((RQ.nx*nx+RQ.nz*nz)>0?1:-1):0,five=COP.heat>=5,shw=five?2.7:1.9,lim=r.hw-shw-.3,lat=clamp(myLat,-lim,lim);
        const put=(ii,la)=>{SPIKE.list.push({x:r.X[ii]+nx*la,z:r.Z[ii]+nz*la,y:r.Y[ii],nx,nz,hw:shw,life:40});copSpikeCar(r,ii,la>0?-1:1)};
        put(i,lat);if(five){const sg=(t[0]*ux+t[1]*uz)>=0?1:-1,j=Math.min(r.n-2,Math.max(1,i+sg*Math.round(30/r.ds)));put(j,clamp(-lat*.8+(lat>0?-1:1)*shw,-lim,lim))}COP.spikeWarn=3;COP.spikeHeli=0;SPIKE.lastT=COP.t}}}
  else SPIKE.nextT=Math.min(SPIKE.nextT,5)}
/* the police car that laid the strip, parked on the road's edge beside it (on the other side from the strip) */
function copSpikeCar(r,i,side){const e=LG.ofRoad[ROADS.indexOf(r)]&&LG.ofRoad[ROADS.indexOf(r)][0][0];if(!e)return;const t=_tan(r,i),nx=-t[1],nz=t[0],o=side*(r.hw-1.4);
  const c=trPlace(e,Math.max(3,Math.min(e.n-4,i)),COP.heat>=4?21:4,12,0,Math.floor(TR.rng()*1e9));if(!c)return;c.x=c.px=r.X[i]+nx*o;c.z=c.pz=r.Z[i]+nz*o;c.yaw=c.pyaw=Math.atan2(t[0],-t[1])+side*.35;c.y=c.py=r.Y[i];
  c.state=1;c.kind=1;c.cm=3;c.block=1;c.siren=1;c.life=40;c.vx=c.vz=c.om=c.v=0;c.wt=0;c.L=null}
/* called every physics step from carStep: has a wheel crossed a strip? */
function spikeCheck(){if(!SPIKE.list.length||!C.grounded||C.shield>0)return;
  for(const s of SPIKE.list){const dx=C.x-s.x,dz=C.z-s.z,lat=dx*s.nx+dz*s.nz,al=-dx*s.nz+dz*s.nx;if(Math.abs(lat)<s.hw&&Math.abs(al)<1.6&&Math.abs(C.y-s.y)<2&&!(C.flatT>0)){
      C.flatT=7.8;C.flatSide=Math.random()<.5?-1:1;SPIKE.hits++;C.shake=Math.min(1,C.shake+.5);C.bob=-.06;safeToast('TYRES BURST',2.6);if(typeof sparkAt==='function')sparkAt(C.x,C.y+.3,C.z,0,0,18,6);if(typeof audioBang==='function')audioBang();s.life=Math.min(s.life,3)}}}
