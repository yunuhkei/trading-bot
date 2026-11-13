'use strict';
/* ===== crash cam and reset (batch 17) =====
   When a crash gets wild (the car rolls or flips hard, is thrown into the air, or hits something big head on), the game turns it into a short CINEMATIC: the world runs in slow motion,
   the camera jumps to a fixed spot beside the crash and follows the car, black bars close in at the top and the bottom, and after about 2.8 s the screen fades out.
   Then the car is put back ON THE ROAD where it was about 1.5 s before the crash (from a short history of road positions), facing the same way at a sensible speed, with the
   traffic cleared round it, and a SPAWN SHIELD for 3 s: the car blinks, drives through traffic, takes no damage and cannot tumble, burst its tyres or be busted.
   A milder tumble (a slow roll onto the side) still rights itself as before (42_tumble.js). CC.enabled=false turns the whole thing off (physics tests). */
const CC={tn:-1,tv:0,enabled:true,on:0,t:0,dur:2.8,scale:1,cam:[0,0,0],fade:0,fadeIn:0,hist:[],histT:-9,crashT:0,why:'',n:0,shield:0};
/* every 0.25 s on the road, upright, moving: one entry {x,z,y,yaw,v,t} (the last 10 s) */
function crashHistory(){if(TUM.on||CC.on||C.shield>0)return;const H=CC.hist;
  if(H.length&&C.t<H[H.length-1].t)H.length=0;                                       /* the car was put somewhere else (C.t restarts): forget */
  if(C.t-CC.histT<.25||!C.onRoad||!C.grounded||C.speed<2||Math.abs(C.roll)>.3||Math.abs(C.pitch)>.3)return;
  CC.histT=C.t;H.push({x:C.x,z:C.z,y:C.y,yaw:Math.atan2(C.vx,-C.vz),v:C.speed,t:C.t});if(H.length>40)H.shift()}
/* is this crash wild enough for the cinematic? */
function crashWild(){if(!TUM.on||TUM.rightT>0)return false;const w=Math.hypot(TUM.w[0],TUM.w[1]*.4,TUM.w[2]),g=groundAt(TUM.p[0],TUM.p[2],TUM.p[1]+.5);
  return TUM.t>.25&&CC.tv>25&&(TUM.maxTilt>1.5||w>4||TUM.p[1]-g>3.5)}   /* (batch 25: only very big crashes: a roll past 86 degrees, a violent spin or a throw 3.5 m up, starting above 25 m/s; the rest right themselves as before) */
function crashStart(why){if(!CC.enabled||CC.on||GAME.state)return;CC.on=1;CC.t=0;CC.fade=0;CC.scale=.3;CC.still=0;CC.endT=null;CC.why=why;CC.crashT=C.t;CC.n++;
  /* the camera: a fixed spot beside the crash, a little ahead of where it is going, looking back at it */
  let dx=C.vx,dz=C.vz,l=Math.hypot(dx,dz);if(l<2){dx=Math.sin(C.yaw);dz=-Math.cos(C.yaw);l=1}dx/=l;dz/=l;const sd=(CC.n&1)?1:-1,sx=-dz*sd,sz=dx*sd,ahead=Math.min(14,4+C.speed*.25);
  const x=C.x+dx*ahead+sx*9,z=C.z+dz*ahead+sz*9,g=groundAt(x,z,C.y+3);CC.cam[0]=x;CC.cam[2]=z;CC.cam[1]=Math.max(g+1.6,C.y+2.2);C.shake=0}
/* called every physics step (from worldStep, after carStep) */
function crashTick(dt){if(C.shield>0){C.shield=Math.max(0,C.shield-dt);COP.bust=Math.max(0,COP.bust-dt*3)}
  if(TUM.on&&TUM.n!==CC.tn){CC.tn=TUM.n;CC.tv=Math.hypot(C.vx,C.vz)}           /* the speed the tumble started at */
  crashHistory();if(!CC.enabled)return;
  if(!CC.on&&crashWild())crashStart(TUM.why||'roll');
  if(CC.on){IN.thr=IN.brk=0;IN.nitro=0;COP.bust=0;
    /* the clock of the cinematic runs in real time: the world step is slowed by CC.scale */
    /* (batch 24) it plays until the car has stopped: slow motion for the first moments, then the rest of the tumble at full speed; it ends 0.7 s after the car comes to rest
       (or starts to be righted), 12 s at most, then fades out */
    CC.t+=dt/CC.scale;CC.scale=CC.t<1.4?.3:CC.t<2.4?.55:1;
    const sp=Math.hypot(C.vx,C.vy||0,C.vz),still=TUM.on?(TUM.rightT>0||(sp<1.2&&TUM.rest>.2)):sp<1.2;CC.still=still?(CC.still||0)+dt/CC.scale:0;
    if(CC.endT==null&&CC.t>1.2&&(CC.still>.7||CC.t>12))CC.endT=CC.t;
    CC.fade=CC.endT!=null?sstep(CC.endT,CC.endT+.45,CC.t):0;if(CC.endT!=null&&CC.t>=CC.endT+.45)crashReset()}}
/* a hit too big to drive on from (a wall or a car taken head on, flat out): from impactAdd */
function crashImpact(E,src){if(CC.enabled&&!CC.on&&E>750e3&&C.shield<=0&&!GAME.state&&(src!=3||C.speed>20))crashStart(src==3?'car':'wall')}   /* (batch 24: rammed while parked or crawling, as in a bust, is not your wild crash) */
/* every frame (from frame() in 90_main.js): the fade back in */
function crashFrame(sec){if(CC.fadeIn>0)CC.fadeIn=Math.max(0,CC.fadeIn-sec*2.4);if(!CC.on)CC.scale=1}
/* back on the road, where the car was about 1.5 s before the crash */
function crashReset(){CC.on=0;CC.scale=1;CC.fade=0;CC.fadeIn=1;const H=CC.hist;let e=null;
  for(let i=H.length-1;i>=0;i--)if(H[i].t<=CC.crashT-1.4){e=H[i];break}if(!e&&H.length)e=H[0];
  if(e){C.safeX=e.x;C.safeZ=e.z;C.safeY=e.y;C.safeYaw=e.yaw}
  TUM.on=0;TUM.rightT=0;respawn();const v=e?clamp(e.v*.8,8,34):12;C.vx=Math.sin(C.yaw)*v;C.vz=-Math.cos(C.yaw)*v;C.speed=v;C.flash=0;C.camYaw=C.yaw;C.flatT=0;
  /* the history after that point is the crash itself */
  if(e)while(H.length&&H[H.length-1].t>e.t)H.pop();
  /* clear the traffic round the spot (not the racers in a race, not a chasing cop) */
  for(const c of TR.cars){if(!c.alive)continue;if(c.kind==2&&c.race)continue;if(c.kind==1&&c.cm>0&&c.state==3)continue;if(Math.hypot(c.x-C.x,c.z-C.z)<40)trKill(c,0)}
  dmgSoften();   /* (batch 23: back on the road lightly knocked about, never a wreck) */
  C.shield=3;safeToast('BACK ON THE ROAD  -  SHIELD 3 s',2.2);camStep(0,true)}
/* the cinematic camera (from camStep) */
function crashCam(){const a=R.alpha,x=lerp(C.px,C.x,a),y=lerp(C.py,C.y,a),z=lerp(C.pz,C.z,a);CAM.x=CC.cam[0];CAM.y=CC.cam[1];CAM.z=CC.cam[2];CAM.tx=x;CAM.ty=y+.6;CAM.tz=z;
  const d=Math.hypot(x-CAM.x,z-CAM.z);CAM.fov=clamp(1.2-d*.006-CC.t*.05,.55,1.1)}
/* is the car hidden this frame (the shield blinks it) */
function crashBlink(){return C.shield>0&&((C.shield*7.5)|0)%3==0}
/* the shield: a blue shimmer round the car (from 41_fx.js) */
function crashFx(sprite){if(!(C.shield>0))return;const k=Math.min(1,C.shield),t=R.time*6;for(let i=0;i<6;i++){const a=t+i*TAU/6;sprite(C.x+Math.cos(a)*2.2,C.y+.8+Math.sin(t*.7+i)*.4,C.z+Math.sin(a)*2.2,.9,.4,.8,1,.55*k)}}
/* the black bars, the label and the fades (from hudDraw) */
function crashHud(c,W_,H_,u){if(!CC.on&&!(CC.fadeIn>0))return;c.save();
  if(CC.on){const b=H_*.11*sstep(0,.35,CC.t);c.fillStyle='#000';c.fillRect(0,0,W_,b);c.fillRect(0,H_-b,W_,b);
    if(CC.t>.4){c.globalAlpha=sstep(.4,.8,CC.t)*(1-CC.fade);c.fillStyle='#fff';c.font='800 '+Math.round(u*.55)+'px -apple-system,Roboto,sans-serif';c.textAlign='center';c.fillText('CRASH',W_/2,H_-b*.38)}
    if(CC.t>=1.5&&CC.endT==null){c.globalAlpha=sstep(1.5,1.9,CC.t)*.75;c.fillStyle='#fff';c.font='600 '+Math.round(u*.2)+'px -apple-system,Roboto,sans-serif';c.textAlign='right';c.fillText('TAP TO SKIP',W_-u*.4,H_-b*.42)}}
  const f=CC.on?CC.fade:CC.fadeIn;if(f>0){c.globalAlpha=f;c.fillStyle='#000';c.fillRect(0,0,W_,H_)}c.restore()}
/* (batch 25) a tap skips the movie, but not in its first 1.5 s: the fade starts at once */
function crashSkip(){if(!CC.on||CC.t<1.5||CC.endT!=null)return false;CC.endT=CC.t;return true}
