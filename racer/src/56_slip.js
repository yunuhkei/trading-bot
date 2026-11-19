/* (batch 54) SLIPSTREAM (batch 72: behind a RACER only, at 100 mph or more, shown only as air streaming off its tail): tucked in behind a moving car, 3-30 m back and within about a car's width of its line, above 50 mph, the air it pushes aside
   tows you (3-40 m back): up to 70 % less drag, a pull of 4.5 m/s2 and 10 % more top speed, and your nitro fills (a tank in about 8 s). It builds over half a second and fades over a second when you pull out.
   Wind streaks stream past the car and SLIPSTREAM shows with a bar. Racers get it too, behind you or each other (up to +6 % speed). */
const SLIP={k:0,src:null,t:0};
function slipTick(dt){let best=0,src=null;
  if(C.speed>=44.7&&!TUM.on&&!CC.on&&TR.on){const fx=C.vx/C.speed,fz=C.vz/C.speed;   /* (batch 72) only at 100 mph or more, and only behind a RACER (traffic and police no longer tow you) */
    for(const c of TR.cars){if(!c.alive||c.state==1||c.kind!==2)continue;const dx=c.x-C.x,dz=c.z-C.z,f=dx*fx+dz*fz;if(f<3||f>40)continue;const lat=Math.abs(dx*-fz+dz*fx);if(lat>2.3)continue;
      const cv=c.state==0?c.v:Math.hypot(c.vx||0,c.vz||0);if(cv<35)continue;const hx=c.state==0?Math.sin(c.yaw):(c.vx||0)/cv,hz=c.state==0?-Math.cos(c.yaw):(c.vz||0)/cv;if(hx*fx+hz*fz<.92)continue;
      const k=Math.min(1,(1.15-lat/2.3))*(f<10?1:1-(f-10)/30);if(k>best){best=k;src=c}}}
  const want=Math.min(1,best*1.4);SLIP.k+=(want-SLIP.k)*(1-Math.exp(-dt*(want>SLIP.k?2.2:1.1)));if(SLIP.k<.01)SLIP.k=0;C.tow=SLIP.k;SLIP.src=src;
  if(SLIP.k>.15){C.nos=Math.min(1,C.nos+dt*.12*SLIP.k);SLIP.t+=dt}else SLIP.t=0}
/* a racer in someone's tow: a factor on its target speed */
function slipRacer(c){const v=c.v;if(v<22)return 1;const fx=Math.sin(c.yaw),fz=-Math.cos(c.yaw);let best=0;
  const test=(x,z,vx,vz)=>{const dx=x-c.x,dz=z-c.z,f=dx*fx+dz*fz;if(f<3||f>30)return;const lat=Math.abs(dx*-fz+dz*fx);if(lat>1.9)return;const ov=Math.hypot(vx,vz);if(ov<16||(vx*fx+vz*fz)/ov<.92)return;const k=(1-lat/1.9)*(f<8?1:1-(f-8)/22);if(k>best)best=k};
  test(C.x,C.z,C.vx,C.vz);for(const o of(EV.run&&EV.run.racers||[]))if(o!==c&&o.alive&&o.state==3)test(o.x,o.z,o.vx||0,o.vz||0);
  c.slip=(c.slip||0)+(best-(c.slip||0))*.05;return 1+.06*c.slip}
/* (batch 72) the slipstream you can SEE: streaks of air peeling off the back of the racer you are tucked in behind, streaming back past you. No words, no bar */
function slipFx(quad,time){const s=SLIP.src;if(!(SLIP.k>.05)||!s||!s.alive)return;const cv=Math.hypot(s.vx||0,s.vz||0)||1,hx=s.state==0?Math.sin(s.yaw):(s.vx||0)/cv,hz=s.state==0?-Math.cos(s.yaw):(s.vz||0)/cv,rx=-hz,rz=hx;
  const hl=s.hl||2.2,tx=s.x-hx*hl,tz=s.z-hz*hl,D=Math.max(8,(tx-C.x)*hx+(tz-C.z)*hz+10),n=Math.round(30*SLIP.k),y0=(s.y||C.y);
  for(let i=0;i<n;i++){const h=(i*.618+.13)%1,h2=(h*13)%1,h3=(h*29)%1,h4=(h*7)%1,side=h<.5?-1:1,ph=(time*2.6+h*7)%1,along=ph*D,spread=(s.hw||.9)*(.35+.75*h2)*(1+.9*along/D),
      L=2.2+h4*3.2,w=.04+.02*h3,y=y0+.25+h3*1.15,x0=tx-hx*along+rx*side*spread,z0=tz-hz*along+rz*side*spread,x1=x0-hx*L,z1=z0-hz*L,al=.75*SLIP.k*Math.sin(ph*Math.PI);
    quad(x0,y-w,z0,x0,y+w,z0,x1,y+w,z1,x1,y-w,z1,.85,.95,1,al)}}
function slipHud(){}   /* (batch 72) the SLIPSTREAM label, its bar and the screen-edge lines are gone */
