'use strict';
/* ===== batch 27: earning nitro =====
   Besides drifting (40_car.js) and the slow trickle, the tank fills from: driving on the wrong side of the road (into the oncoming lanes), NEAR MISSES (a car flashes past
   within about a metre and a half, no contact), TAKEDOWNS of racers and cops, JUMPS (by length), and holding a high speed (120 mph, or 88 % of the car's top speed if that is lower)
   for more than 2 s. What is earned goes into a pending pool that flows into the tank at 0.3 a second, so the gauge rises gradually; a small label shows what earned it.
   Drive-through repair shops fill the tank (63_safe.js). */
const BOOST={pend:0,pops:[],fast:0,opp:0,oppPop:-9,lastJ:-1,fastPop:0,n:{opp:0,near:0,take:0,jump:0,fast:0}};
function boostAdd(k,label,key){BOOST.pend=Math.min(1.5,BOOST.pend+k);if(key)BOOST.n[key]++;if(label){BOOST.pops.push({t:C.t,l:label});if(BOOST.pops.length>3)BOOST.pops.shift()}}
function boostTick(dt){if(GAME.state||TUM.on||CC.on)return;
  if(BOOST.pend>0){const f=Math.min(BOOST.pend,dt*.3);BOOST.pend-=f;C.nos=Math.min(1,C.nos+f)}
  const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw),rx=-fz,rz=fx;
  /* the wrong side of the road: left of the centre line, against the way the road is drawn on that side */
  let opp=false;if(C.grounded&&C.speed>12&&roadAt(C.x,C.z,C.y+1)&&ROADS[RQ.ri]){const r=ROADS[RQ.ri],sg=(C.vx*RQ.tx+C.vz*RQ.tz)>=0?1:-1,lat=RQ.lat*sg;opp=lat<-.6&&Math.abs(RQ.lat)<RQ.hw&&!r.oneway}
  if(opp){BOOST.opp+=dt;if(BOOST.opp>.5){BOOST.pend=Math.min(1.5,BOOST.pend+dt*.05);if(C.t-BOOST.oppPop>4){BOOST.oppPop=C.t;boostAdd(0,'ONCOMING','opp')}}}else BOOST.opp=0;
  /* near misses */
  for(const c of TR.cars){if(!c.alive||c.state==1)continue;const dx=c.x-C.x,dz=c.z-C.z;if(dx*dx+dz*dz>400){c.nmF=undefined;continue}
    const f=dx*fx+dz*fz,l=dx*rx+dz*rz,pf=c.nmF;c.nmF=f;if(pf===undefined||(pf>0)===(f>0))continue;
    const gap=Math.abs(l)-(c.hw||1)-CD.hw,cvx=Math.sin(c.yaw)*(c.v||0),cvz=-Math.cos(c.yaw)*(c.v||0),rel=Math.hypot(C.vx-(c.vx!=null&&c.state==3?c.vx:cvx),C.vz-(c.vz!=null&&c.state==3?c.vz:cvz));
    if(gap>-.05&&gap<1.5&&rel>10&&C.t-(c.hitT||-9)>1&&C.t-(c.nmT||-9)>2){c.nmT=C.t;boostAdd(.07,'NEAR MISS','near')}}
  /* jumps */
  if(C.jump&&C.jump.t!==BOOST.lastJ){BOOST.lastJ=C.jump.t;if(C.jump.d>10)boostAdd(Math.min(.3,.06+C.jump.d*.004),'JUMP','jump')}
  /* holding a high speed */
  const vf=Math.min(53.65,HND.vmax*.88);if(C.speed>vf&&!IN.nitro&&C.grounded){BOOST.fast+=dt;if(BOOST.fast>2){BOOST.pend=Math.min(1.5,BOOST.pend+dt*.05);if(!BOOST.fastPop){BOOST.fastPop=1;boostAdd(0,'TOP SPEED','fast')}}}else{BOOST.fast=0;BOOST.fastPop=0}}
/* a racer or a cop wrecked by you (from trPlayerCollide) */
function boostTakedown(c){if(c.kind==1||c.kind==2)boostAdd(.25,c.kind==1?'COP TAKEDOWN':'TAKEDOWN','take')}
/* the labels, over the nitro gauge (from hudDraw) */
function boostHud(c,W_,H_,u){const G=UI.gg;if(!G||!BOOST.pops.length)return;c.save();c.textAlign='center';let k=0;
  for(let i=BOOST.pops.length-1;i>=0;i--){const p=BOOST.pops[i],a=C.t-p.t;if(a>1.4||a<0)continue;const al=Math.min(1,a*6)*(1-sstep(1,1.4,a));c.globalAlpha=al;c.font='italic 800 '+Math.round(u*.24)+'px '+UIF;
    c.fillStyle=DASH.amber;c.shadowColor='rgba(0,0,0,.6)';c.shadowBlur=u*.08;c.fillText('+ '+p.l,G.x+G.w/2,G.y1-u*.25-k*u*.3-a*u*.2);k++}
  c.restore()}
