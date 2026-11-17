/* (batch 54) SLIPSTREAM: tucked in behind a moving car (a racer, a cop or traffic going your way), 3-30 m back and within about a car's width of its line, above 50 mph, the air it pushes aside
   tows you (3-40 m back): up to 70 % less drag, a pull of 4.5 m/s2 and 10 % more top speed, and your nitro fills (a tank in about 8 s). It builds over half a second and fades over a second when you pull out.
   Wind streaks stream past the car and SLIPSTREAM shows with a bar. Racers get it too, behind you or each other (up to +6 % speed). */
const SLIP={k:0,src:null,t:0};
function slipTick(dt){let best=0,src=null;
  if(C.speed>22&&!TUM.on&&!CC.on&&TR.on){const fx=C.vx/C.speed,fz=C.vz/C.speed;
    for(const c of TR.cars){if(!c.alive||c.state==1)continue;const dx=c.x-C.x,dz=c.z-C.z,f=dx*fx+dz*fz;if(f<3||f>40)continue;const lat=Math.abs(dx*-fz+dz*fx);if(lat>2.3)continue;
      const cv=c.state==0?c.v:Math.hypot(c.vx||0,c.vz||0);if(cv<16)continue;const hx=c.state==0?Math.sin(c.yaw):(c.vx||0)/cv,hz=c.state==0?-Math.cos(c.yaw):(c.vz||0)/cv;if(hx*fx+hz*fz<.92)continue;
      const k=Math.min(1,(1.15-lat/2.3))*(f<10?1:1-(f-10)/30);if(k>best){best=k;src=c}}}
  const want=Math.min(1,best*1.4);SLIP.k+=(want-SLIP.k)*(1-Math.exp(-dt*(want>SLIP.k?2.2:1.1)));if(SLIP.k<.01)SLIP.k=0;C.tow=SLIP.k;SLIP.src=src;
  if(SLIP.k>.15){C.nos=Math.min(1,C.nos+dt*.12*SLIP.k);SLIP.t+=dt}else SLIP.t=0}
/* a racer in someone's tow: a factor on its target speed */
function slipRacer(c){const v=c.v;if(v<22)return 1;const fx=Math.sin(c.yaw),fz=-Math.cos(c.yaw);let best=0;
  const test=(x,z,vx,vz)=>{const dx=x-c.x,dz=z-c.z,f=dx*fx+dz*fz;if(f<3||f>30)return;const lat=Math.abs(dx*-fz+dz*fx);if(lat>1.9)return;const ov=Math.hypot(vx,vz);if(ov<16||(vx*fx+vz*fz)/ov<.92)return;const k=(1-lat/1.9)*(f<8?1:1-(f-8)/22);if(k>best)best=k};
  test(C.x,C.z,C.vx,C.vz);for(const o of(EV.run&&EV.run.racers||[]))if(o!==c&&o.alive&&o.state==3)test(o.x,o.z,o.vx||0,o.vz||0);
  c.slip=(c.slip||0)+(best-(c.slip||0))*.05;return 1+.06*c.slip}
/* wind streaks past the car (from the effects pass) */
function slipFx(quad,time){if(!(SLIP.k>.05))return;const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw),rx=Math.cos(C.yaw),rz=Math.sin(C.yaw),n=Math.round(22*SLIP.k);
  for(let i=0;i<n;i++){const h=(i*0.618+.13)%1,side=(h<.5?-1:1),ph=((time*2.8+h*7)%1),along=7-ph*18,lat=side*(.9+((h*13)%1)*2.2),y=C.y+.25+((h*29)%1)*1.6,L=3.5+((h*7)%1)*3.5,w=.045;
    const x0=C.x+fx*along+rx*lat,z0=C.z+fz*along+rz*lat,x1=x0-fx*L,z1=z0-fz*L,al=.85*SLIP.k*Math.sin(ph*Math.PI);
    quad(x0,y-w,z0,x0,y+w,z0,x1,y+w,z1,x1,y-w,z1,.85,.95,1,al)}}
function slipHud(c,W_,H_,u){if(!(SLIP.k>.05)||EV.card||GAME.state||CC.on)return;c.save();
  /* speed lines down both edges of the screen while you are in the tow */{const n=Math.round(14*SLIP.k),t=performance.now()/1000;c.strokeStyle='rgba(220,240,255,'+(.35*SLIP.k)+')';c.lineWidth=Math.max(1,u*.025);c.beginPath();
    for(let i=0;i<n;i++){const h=(i*.618+.31)%1,side=h<.5?0:1,ph=(t*1.8+h*5)%1,x=side?W_*(.86+((h*7)%1)*.13):W_*(.01+((h*7)%1)*.13),y=H_*(ph*1.2-.1),L=H_*(.08+.1*((h*13)%1));c.moveTo(x,y);c.lineTo(x+(side?1:-1)*L*.12,y+L)}c.stroke()}
  if(SLIP.k>.15){const a=Math.min(1,(SLIP.k-.15)*3);c.globalAlpha=a;fxText(c,'SLIPSTREAM',W_/2,H_*.2,u*.38,'#d6f1ff','center','rgba(90,180,255,.85)');
    const bw=u*2.6,bh=u*.09,x=W_/2-bw/2,y=H_*.2+u*.13;c.fillStyle='rgba(0,0,0,.5)';c.fillRect(x,y,bw,bh);c.fillStyle='#7fd0ff';c.fillRect(x,y,bw*SLIP.k,bh)}
  c.restore()}
