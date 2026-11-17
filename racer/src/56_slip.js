/* (batch 54) SLIPSTREAM: tucked in behind a moving car (a racer, a cop or traffic going your way), 3-30 m back and within about a car's width of its line, above 50 mph, the air it pushes aside
   tows you: up to 60 % less drag, a pull of 2.6 m/s2 and 8 % more top speed, and your nitro fills (a tank in about 14 s). It builds over half a second and fades over a second when you pull out.
   Wind streaks stream past the car and SLIPSTREAM shows with a bar. Racers get it too, behind you or each other (up to +6 % speed). */
const SLIP={k:0,src:null,t:0};
function slipTick(dt){let best=0,src=null;
  if(C.speed>22&&!TUM.on&&!CC.on&&TR.on){const fx=C.vx/C.speed,fz=C.vz/C.speed;
    for(const c of TR.cars){if(!c.alive||c.state==1)continue;const dx=c.x-C.x,dz=c.z-C.z,f=dx*fx+dz*fz;if(f<3||f>30)continue;const lat=Math.abs(dx*-fz+dz*fx);if(lat>1.9)continue;
      const cv=c.state==0?c.v:Math.hypot(c.vx||0,c.vz||0);if(cv<16)continue;const hx=c.state==0?Math.sin(c.yaw):(c.vx||0)/cv,hz=c.state==0?-Math.cos(c.yaw):(c.vz||0)/cv;if(hx*fx+hz*fz<.92)continue;
      const k=(1-lat/1.9)*(f<8?1:1-(f-8)/22);if(k>best){best=k;src=c}}}
  const want=Math.min(1,best*1.25);SLIP.k+=(want-SLIP.k)*(1-Math.exp(-dt*(want>SLIP.k?2.2:1.1)));if(SLIP.k<.01)SLIP.k=0;C.tow=SLIP.k;SLIP.src=src;
  if(SLIP.k>.15){C.nos=Math.min(1,C.nos+dt*.07*SLIP.k);SLIP.t+=dt}else SLIP.t=0}
/* a racer in someone's tow: a factor on its target speed */
function slipRacer(c){const v=c.v;if(v<22)return 1;const fx=Math.sin(c.yaw),fz=-Math.cos(c.yaw);let best=0;
  const test=(x,z,vx,vz)=>{const dx=x-c.x,dz=z-c.z,f=dx*fx+dz*fz;if(f<3||f>30)return;const lat=Math.abs(dx*-fz+dz*fx);if(lat>1.9)return;const ov=Math.hypot(vx,vz);if(ov<16||(vx*fx+vz*fz)/ov<.92)return;const k=(1-lat/1.9)*(f<8?1:1-(f-8)/22);if(k>best)best=k};
  test(C.x,C.z,C.vx,C.vz);for(const o of(EV.run&&EV.run.racers||[]))if(o!==c&&o.alive&&o.state==3)test(o.x,o.z,o.vx||0,o.vz||0);
  c.slip=(c.slip||0)+(best-(c.slip||0))*.05;return 1+.06*c.slip}
/* wind streaks past the car (from the effects pass) */
function slipFx(quad,time){if(!(SLIP.k>.08))return;const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw),rx=Math.cos(C.yaw),rz=Math.sin(C.yaw),n=Math.round(10*SLIP.k);
  for(let i=0;i<n;i++){const h=(i*0.618+.13)%1,side=(h<.5?-1:1),ph=((time*2.2+h*7)%1),along=4-ph*12,lat=side*(1.1+((h*13)%1)*1.4),y=C.y+.35+((h*29)%1)*1.1,L=2.4+((h*7)%1)*2,w=.03;
    const x0=C.x+fx*along+rx*lat,z0=C.z+fz*along+rz*lat,x1=x0-fx*L,z1=z0-fz*L,al=.55*SLIP.k*Math.sin(ph*Math.PI);
    quad(x0,y-w,z0,x0,y+w,z0,x1,y+w,z1,x1,y-w,z1,1,1,1,al)}}
function slipHud(c,W_,H_,u){if(!(SLIP.k>.15)||EV.card||GAME.state||CC.on)return;const a=Math.min(1,(SLIP.k-.15)*3);c.save();c.globalAlpha=a;
  fxText(c,'SLIPSTREAM',W_/2,H_*.17,u*.3,'#bfe8ff','center','rgba(90,180,255,.7)');
  const bw=u*2.2,bh=u*.07,x=W_/2-bw/2,y=H_*.17+u*.1;c.fillStyle='rgba(0,0,0,.45)';c.fillRect(x,y,bw,bh);c.fillStyle='#7fd0ff';c.fillRect(x,y,bw*SLIP.k,bh);c.restore()}
