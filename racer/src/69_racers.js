'use strict';
/* ===== batch 12: AI racers: RACES, DEATH RACES and rare STREET RACERS =====
   A racer is a traffic car taken off the lanes (state 3, kind 2, like a chasing cop) that follows a race route: it looks ahead along the route, takes bends at the speed its grip allows (a skill
   number per racer: grip 8.6-10 m/s2, top 64-76 m/s), slows for and overtakes traffic in its way (it moves over 3.5 m to the side that is free), gets a small catch-up push when far behind you,
   backs out when stuck, and is wrecked by a big hit (it is then out of the race).
   RACE: 4 racers on a grid; the order is by how far along the route each is; prizes for 1st / 2nd / 3rd. No police. You must pass the same checkpoint gates as in a time trial.
   DEATH RACE: the same with 5 racers that also try to ram you when you are close; every racer you wreck is 500 points, finishing 1st / 2nd / 3rd 1,500 / 1,000 / 500; medals by points.
   STREET RACERS: now and then (at most one, a chance every 100 s on the open road) a fast car joins the traffic ahead of you, a yellow light flashing over it; drive up behind or beside it and it
   challenges you to a race to the next town; first there wins. */
const RACE={sr:null,srT:60,pending:null};
const RACER_TYPES=[10,12,16,18,19],RACER_COLS=[0,3,6,9,12,15,1,4,7,10];
/* a racer at distance S along the route, lat metres to the right of it */
function racerSpawn(Rt,S,lat,k,skill,aggr){let j=0;while(j<Rt.n-2&&Rt.S[j+1]<S)j++;const p=Rt.pts,x=p[j*3],z=p[j*3+2],dx=p[j*3+3]-x,dz=p[j*3+5]-z,l=Math.hypot(dx,dz)||1,ux=dx/l,uz=dz/l;
  /* (batch 53) a grid slot off the asphalt (a narrow road) is moved in until it is on the road, well clear of the edge: racers used to start half in the barrier and hit it */
  {const ok=L=>roadAt(x-uz*L,z+ux*L,p[j*3+1]+1)&&Math.abs(RQ.lat)<RQ.hw-1.3;if(!ok(lat)){let f=null;for(const L of[lat*.7,lat*.45,-lat*.45,0,-lat*.7])if(ok(L)){f=L;break}lat=f==null?0:f}}
  const sn=navSnap(x,z,40);if(!sn)return null;const la=navLane(sn,x,z,ux,uz);if(!la)return null;const c=trPlace(la.e,la.u,skill.type!=null?skill.type:RACER_TYPES[k%RACER_TYPES.length],skill.type!=null?skill.col:RACER_COLS[k%RACER_COLS.length],0,7000+k);if(!c)return null;
  c.x=c.px=x-uz*lat;c.z=c.pz=z+ux*lat;c.y=c.py=groundAt(c.x,c.z,p[j*3+1]+1);c.yaw=c.pyaw=Math.atan2(ux,-uz);c.v=0;c.vx=c.vz=c.om=0;c.state=3;c.kind=2;c.cm=0;c.siren=0;c.L=null;c.stk=0;c.rev=0;c.hn=0;
  c.race={Rt,fi:j,s:S,go:false,done:-1,skill,aggr:aggr||0,off:lat,offT:lat,launch:4,ramCd:aggr==2?1.2:3.5,name:['Viper','Blaze','Ghost','Nova','Rook','Jinx','Vandal','Comet'][k%8]};return c}
const _ra=(Rt,bi,s)=>{let k=bi;while(k<Rt.n-1&&Rt.S[k]<s)k++;return k};
function racerStep(c,dt){
  c.px=c.x;c.pz=c.z;c.py=c.y;c.pyaw=c.yaw;c.age+=dt;const R=c.race;if(!R){c.state=1;return}const Rt=R.Rt,p=Rt.pts;
  /* where it is along the route */
  let bi=R.fi,bd=1e18;for(let k=Math.max(0,bi-4);k<Math.min(Rt.n,bi+40);k++){const d=(p[k*3]-c.x)**2+(p[k*3+2]-c.z)**2;if(d<bd){bd=d;bi=k}}R.fi=bi;R.s=Rt.S[bi];
  if(R.done<0&&R.s>=Rt.len-10&&R.go)R.done=EV.t;
  /* (batch 63) knocked off its route and driving away (fast, so the stuck check never fires): more than 30 m from the route for 1.5 s, it is put back on it */
  if(R.go&&R.done<0){R.offT=bd>900?(R.offT||0)+dt:0;if(R.offT>1.5){R.offT=0;if(racerRespot(c))return}}
  /* (batch 27) stuck for 5 s (a jam, a pile-up, a wall): it is put back on the route a little further on, on a clear spot */
  if(R.go&&R.done<0){R.still=c.v<2.5?(R.still||0)+dt:0;if(R.still>2.4&&racerRespot(c))return;if(R.still>7){R.still=0;if(EV.run&&EV.run.ev.type=='rage'){c.race=null;trKill(c,0);return}}   /* (batch 53) no clear spot to put it back on for 7 s: in a takedown it is removed, so the next wave can come */}
  if(!R.go||R.done>=0){const k=Math.exp(-dt*(R.done>=0?.8:20));c.v*=k;}
  else{
    const v=c.v,sk=R.skill,ahead=_ra(Rt,bi,R.s+Math.max(8,v*.7));
    /* the tightest bend in the next stretch: the curvature of the circle through three points of it (Menger), at two distances, and the speed its grip allows there */
    let cornerV=1e9;
    /* (batch 53) corners: the speed the tightest bend in the next ~3 s allows, looked at every 9 m (the two coarse samples above smoothed a 90-degree turn away), with the braking it takes to get there */
    {const bk=(sk.brk||9)*.72,maxD=Math.max(90,v*3.2),hd=q=>{const a=_ra(Rt,bi,q),b=_ra(Rt,bi,q+10);return Math.atan2(p[b*3]-p[a*3],-(p[b*3+2]-p[a*3+2]))};let h0=hd(R.s-8);
      for(let d=-2;d<maxD;d+=6){const h1=hd(R.s+d),kc=Math.abs(angd(h1,h0))/6;h0=h1;   /* (batch 54) from where it is now, every 6 m: the scan began 12 m ahead, so a car already in a tight turn stopped seeing it and accelerated out wide */if(kc>1e-3){const vc=Math.sqrt(sk.grip*1.05/kc);cornerV=Math.min(cornerV,Math.sqrt(vc*vc+2*bk*Math.max(0,d)))}}}
    /* nitro: the racers use it too, on a clear straight, for 2.5 s every 12-20 s */
    if(!R.started){R.started=1;if(sk.nitro&&(c.seed%10)<8){R.nzT=1.4+(c.seed%7)*.12;R.nzCd=10}}   /* (batch 65) most racers fire their nitro off the line, as you do */
    R.nzCd=(R.nzCd||4)-dt;if(R.nzT>0)R.nzT-=dt;else if(sk.nitro&&R.nzCd<=0&&v>25&&!(R.launch>0)){R.nzT=2.5;R.nzCd=12+((c.seed|0)%8)}
    const vLim=(sk.vtop||sk.vmax)*(R.nzT>0?1.26:1);   /* (batch 54) the car's real top speed, +26 % while its nitro burns: exactly what your boost gives you (it was +8 % all the time and +20 % on nitro) */
    let vt=sk.vmax*(R.nzT>0?1.26:1);for(const L of[Math.max(40,v*1.4),Math.max(80,v*2.6)]){const A=_ra(Rt,bi,R.s+10),B=_ra(Rt,bi,R.s+10+L/2),Cc=_ra(Rt,bi,R.s+10+L);const ax=p[A*3],az=p[A*3+2],bx=p[B*3],bz=p[B*3+2],cx=p[Cc*3],cz=p[Cc*3+2];
      const ar=Math.abs((bx-ax)*(cz-az)-(bz-az)*(cx-ax)),dd=Math.hypot(bx-ax,bz-az)*Math.hypot(cx-bx,cz-bz)*Math.hypot(cx-ax,cz-az),kc=dd>1e-3?2*ar/dd:0;if(kc>1e-4){const vb=Math.sqrt(sk.grip/kc),dist=Math.max(0,Rt.S[A]-R.s);vt=Math.min(vt,Math.sqrt(vb*vb+2*(sk.brk||9)*.72*dist))}}
    /* catch-up: a little faster when far behind you, a little slower when far ahead */
    const gap=(EV.run&&EV.run.ps!=null)?EV.run.ps-R.s:0;vt*=gap>300?1.3:gap>150?1.18:gap>60?1.08:gap<-320?.93:1;if(R.catchT>0){R.catchT-=dt;if(gap>20)vt*=1.12}
    {const sf=slipRacer(c);vt=Math.min(vt*sf,vLim*sf)}   /* catch-up brings it up to its car's limit, never past it (a slipstream adds up to 6 %, as yours adds 8 %) */
    vt=Math.min(vt,cornerV);   /* (batch 54) the catch-up boost is for the straights only: it used to be applied after the corner limit, so a racer catching up took bends up to 46 % too fast and ran wide off the road */   /* (batch 53) it really comes back at you after you knock it out or leave it behind */   /* (batch 53) it chases harder when it is behind you, and eases off only when it is a long way ahead */
    /* traffic in the way: overtake on the free side */
    const sy=Math.sin(c.yaw),cy=-Math.cos(c.yaw),look=Math.max(40,v*1.6),lat2=(o,dx,dz)=>{const ovx=Math.sin(o.yaw)*o.v,ovz=-Math.cos(o.yaw)*o.v,lt=dx*-cy+dz*sy,lv=ovx*-cy+ovz*sy;return[lt,lt+lv*.9]},   /* where it is across our path now and in 0.9 s (a car changing lanes) */
      inLane=(o,off)=>{const dx=o.x-c.x,dz=o.z-c.z,f=dx*sy+dz*cy;if(f<2||f>look)return -1;const L=lat2(o,dx,dz),q=off-R.off;return Math.min(Math.abs(L[0]-q),Math.abs(L[1]-q),(L[0]-q)*(L[1]-q)<0?0:9)<2.6?f:-1};   /* L is measured from this car; off is from the route centre, where this car is R.off */
    /* (batch 53) a civilian car in a racer's way that you cannot see (more than 140 m from you) simply turns off the road: racers no longer queue behind traffic out of your sight */
    for(const o of TR.cars){if(!o.alive||o===c||o.kind!=0||o.state!=0)continue;const dx=o.x-c.x,dz=o.z-c.z,f=dx*sy+dz*cy;if(f<0||f>70)continue;if(Math.abs(dx*-cy+dz*sy-0)>9)continue;if(Math.hypot(o.x-C.x,o.z-C.z)>140)trKill(o,0)}
    let block=null,bdist=1e9;for(const o of TR.cars){if(!o.alive||o===c)continue;const f=inLane(o,R.off);if(f>0&&f<bdist){bdist=f;block=o}}
    /* a car ahead that is turning or changing lanes (not going our way): be ready to stop behind it */
    for(const o of TR.cars){if(!o.alive||o===c||o.kind==2)continue;const dx=o.x-c.x,dz=o.z-c.z,f=dx*sy+dz*cy;if(f<3||f>look)continue;const lt=dx*-cy+dz*sy;if(Math.abs(lt)>7)continue;if(Math.abs(angd(o.yaw,c.yaw))>.12)vt=Math.min(vt,Math.max(o.v*Math.cos(angd(o.yaw,c.yaw)),0)+Math.max(0,f-12)*.5)}
    if(block&&block.kind===2&&block.race){const gap=v*.38+7;if(bdist<gap)vt=Math.min(vt,block.v+(bdist-gap)*.6)}   /* (batch 65) a racer ahead in its lane: hang back a car length or two (at the same speed they used to drive bumper to bumper and keep touching) */
    if(block&&block.v<v-1){/* overtake on whichever side is clear; if neither is, slow down behind it in good time */
      let moved=false;for(const side of[R.off<=0?3.6:-3.6,R.off<=0?-3.6:3.6]){const off=Math.max(-6,Math.min(6,R.off+side));let clear=true;for(const o of TR.cars){if(!o.alive||o===c)continue;const dx=o.x-c.x,dz=o.z-c.z,f=dx*sy+dz*cy;if(f>-8&&f<bdist+15){const L=lat2(o,dx,dz),q=off-R.off;if(Math.min(Math.abs(L[0]-q),Math.abs(L[1]-q))<2.9||(L[0]-q)*(L[1]-q)<0){clear=false;break}}}if(clear){R.offT=off;moved=true;break}}
      const closing=v-block.v,need=closing*closing/(2*7)+12;if(!moved||bdist<need)vt=Math.min(vt,block.v+Math.max(0,bdist-10)*.45)}   /* until it is actually beside it, it keeps a speed it can still stop from */
    else if(!block){if(R.pref==null)R.pref=Math.max(-3.2,Math.min(3.2,R.off*.85));if(R.launch>0)R.launch-=dt;else R.offT+=(R.pref-R.offT)*(1-Math.exp(-dt*.4));   /* (batch 65) back to a lane of its own (its grid side), not the middle: they all used to converge on the route's centre line and drive on top of each other */   /* for the first 4 s it holds its grid lane (they used to dive for the middle together and crash) */
      /* (batch 53) defending: a car right behind you in a race gets its nose across your line (a move every 1.2 s, never more than 4 m off the route) */
      if(EV.run&&EV.run.ev&&EV.run.t>=0&&!(c.spinT>0)){R.defT=(R.defT||0)-dt;const dpx=C.x-c.x,dpz=C.z-c.z,fd=dpx*sy+dpz*cy,lt=dpx*-cy+dpz*sy;
        /* (batch 64) racing you for position (every racer event, takedowns too): with you close behind or alongside it floors it, lights its nitro when you draw level, and once its nose is ahead of yours it cuts across in front of you (a move every second, never more than 4.5 m off the route) */
        if(fd>-28&&fd<9&&Math.abs(lt)<10&&v>12){vt=Math.min(cornerV,vLim);if(fd>-6&&sk.nitro&&!(R.nzT>0)&&(R.nzCd||0)<6){R.nzT=2;R.nzCd=11}}
        if(R.aggr>0&&R.defT<=0&&fd<-1.5&&fd>-35&&Math.abs(lt)<7&&v>18){R.defT=1;   /* (batch 65) clean racers (aggr 0) race you for position but never block */R.offT=Math.max(-4.5,Math.min(4.5,R.off+Math.sign(lt||1)*Math.min(3,Math.abs(lt)+.8)))}}}
    /* (batch 65) a racer right beside it: move apart (they rubbed side by side for 20-50 s of every minute and got tangled) */
    R.sepT=(R.sepT||0)-dt;if(R.sepT<=0){for(const o of TR.cars){if(!o.alive||o===c||o.kind!==2||!o.race||o.state!==3)continue;const dx=o.x-c.x,dz=o.z-c.z,f=dx*sy+dz*cy,lt=dx*-cy+dz*sy;if(Math.abs(f)<6&&Math.abs(lt)<3.6){R.offT=Math.max(-4.5,Math.min(4.5,R.off+(lt>0?-1:1)*(3.8-Math.abs(lt))));if(f>0)vt=Math.min(vt,o.v-1.5);R.sepT=.35;break}}}   /* the one behind yields */
    R.off+=(R.offT-R.off)*Math.min(1,dt*2.6);
    let tx=p[ahead*3],tz=p[ahead*3+2];{const a2=Math.min(Rt.n-1,ahead+1),dx=p[a2*3]-tx,dz=p[a2*3+2]-tz,l=Math.hypot(dx,dz)||1;
      /* (batch 53) never aim off the asphalt: an offset that would put the car on the verge or into the barrier is pulled back towards the route */
      R.rdT=(R.rdT||0)-dt;if(R.rdT<=0){R.rdT=.15;if(R.off!==0&&!(roadAt(tx-dz/l*R.off,tz+dx/l*R.off,c.y+1)&&Math.abs(RQ.lat)<RQ.hw-1.1)){R.offT*=.4;R.off*=.6;R.launch=0}}
      tx+=-dz/l*R.off;tz+=dx/l*R.off}
    /* a death racer goes for you when you are close */
    if(R.aggr&&EV.run&&!TUM.on){R.ramCd-=dt;const dpx=C.x-c.x,dpz=C.z-c.z,dp=Math.hypot(dpx,dpz);if(EV.run.ev&&EV.run.ev.type=='death'&&(dpx*sy+dpz*cy)<-6&&dp<110)vt=Math.min(vt,Math.max(C.speed*1.04,26));   /* (batch 53) a death racer stays in reach of you instead of running away from you: it is a fight */
      /* (batch 53) THE FIGHT: within 75 m it comes for you: from behind it aims at your rear corner (a PIT), alongside it swings into your door, then it backs off a second and comes again */
      if(dp<75&&R.ramCd<=0&&C.speed>15&&!(c.spinT>0)&&(dpx*sy+dpz*cy)>(EV.run.ev&&EV.run.ev.type=='death'?-28:-6)){   /* (only a moving target: a racer does not park itself against you when you have stopped) */const lt=dpx*-cy+dpz*sy,side=Math.sign(lt||1),fwd=dpx*sy+dpz*cy,cvx=C.vx,cvz=C.vz,cs=Math.hypot(cvx,cvz)||1,lead=Math.min(.6,dp/Math.max(8,v));
        let ax=C.x+cvx*lead,az=C.z+cvz*lead;if(fwd>2){ax-=cvx/cs*2.2;az-=cvz/cs*2.2}ax-=(-cvz/cs)*side*.4;az-=(cvx/cs)*side*.4;
        /* (batch 54) it only cuts straight at you when that line is along the road (you close by, or ahead down the road), and only onto asphalt: it used to dive across the inside of bends after you, off the road */const ra=Math.atan2(tx-c.x,-(tz-c.z)),aa=Math.atan2(ax-c.x,-(az-c.z));if((dp<16||Math.abs(angd(aa,ra))<.35)&&roadAt(ax,az,c.y+1)){tx=ax;tz=az;vt=Math.max(vt,Math.min(C.speed+18,cornerV*1.05,vLim))}else vt=Math.max(vt,Math.min(C.speed+12,cornerV,vLim));if(dp<4.8)R.ramCd=1.1}}
    if(c.rev>0){c.rev-=dt;c.yaw+=c.revS*1.1*dt;c.v=0;c.x-=sy*4*dt;c.z-=cy*4*dt;c.vx=-sy*4;c.vz=-cy*4;if(trStatic(c.x,c.z,c.hw+.1,c.y)){c.x+=_sx;c.z+=_sz}const g=groundAt(c.x,c.z,c.y+.5);c.y+=(g-c.y)*Math.min(1,dt*18);return}
    if(c.stk>.8&&c.v<2){c.rev=1;c.revS=angd(Math.atan2(tx-c.x,-(tz-c.z)),c.yaw)>0?-1:1;c.stk=.3}
    if(c.spinT>0){c.spinT-=dt;c.v*=Math.exp(-dt*.75);c.ks=c.ks||0;if(c.spinT<=0){c.yaw=c.yaw;c.ks*=.3}}   /* spinning out: no steering, it slides on and loses speed */
    const err=angd(Math.atan2(tx-c.x,-(tz-c.z)),c.yaw),maxYr=Math.min(2.4,sk.grip*1.3/Math.max(v,4)),yr=(c.spinT>0||c.air)?0:Math.max(-maxYr,Math.min(maxYr,err*3))*(c.loose>0?Math.max(.2,1-c.loose*.9):1);c.om=yr;c.yaw+=yr*dt;
    {const ea=Math.abs(angd(Math.atan2(tx-c.x,-(tz-c.z)),c.yaw));if(ea>.3&&!(c.spinT>0))vt=Math.min(vt,v*(ea>.6?.97:1))}   /* (batch 54) still turning in (pointing well away from where it is going): it does not put the power down yet */
    R.cv=cornerV;R.vt=vt;const accNow=sk.acc*(1-.8*Math.pow(Math.min(1,v/(sk.vmax*(R.nzT>0?1.26:1))),1.6))*(R.nzT>0?1.5:1),a=Math.max(-(sk.brk||11),Math.min(accNow,(vt-v)*1.6));if(!(c.spinT>0)&&!c.air)c.v=Math.max(0,Math.min(vLim*(1+.06*(c.slip||0)),v+a*dt));c.brake=a<-2.5?1:0;
    if(c.v<1.5)c.stk+=dt;else if(c.stk>0)c.stk=Math.max(0,c.stk-dt*.5)}
  const mvy=c.spinT>0&&c.sdir!=null?c.sdir+angd(c.yaw,c.sdir)*Math.max(0,1-c.spinT/.45):c.yaw,sy=Math.sin(mvy),cy=Math.cos(mvy);c.vx=sy*c.v;c.vz=-cy*c.v;c.x+=c.vx*dt;c.z+=c.vz*dt;
  /* (batch 53) a knock: a sideways drift and a spin that die away in about half a second */if(c.kx||c.kz){c.x+=c.kx*dt;c.z+=c.kz*dt;c.vx+=c.kx;c.vz+=c.kz;const kl=Math.hypot(c.kx,c.kz),nk=Math.max(0,kl-dt*(c.loose>0?6.5:14)-kl*dt*.8);c.kx*=nk/kl;c.kz*=nk/kl;if(nk<.15)c.kx=c.kz=0}if(c.ks){c.yaw+=c.ks*dt;c.ks*=Math.exp(-dt*(c.spinT>0?.8:c.loose>0?1.6:4));if(Math.abs(c.ks)<.02)c.ks=0}   /* (batch 54) the sideways slide is scrubbed off by the tyres (a steady ~0.7 g while they are loose), so a shove carries it several metres across: off the road if you push it there */if(c.loose>0)c.loose-=dt;
  for(const o of[-1,1]){const px=c.x+sy*o*c.hl*.55,pz=c.z-cy*o*c.hl*.55;if(trStatic(px,pz,c.hw+.1,c.y)){const vh=Math.hypot(c.vx,c.vz);c.x+=_sx;c.z+=_sz;c.v*=.6;c.stk+=.2;if(c.state==3&&c.alive&&C.t-(c.pHitT??-99)<4&&vh>9){/* (batch 54) a racer you hit that goes into a wall or a pole within 4 s, at 20 mph or more, is taken down (and it is your takedown) */c.state=1;c.wt=0;c.byP=1;TR.stat.wrecks++;trFlipKick(c,9e5);evTakedown(c);boostTakedown(c);return}}}
  if(c.state==3&&railRacer(c))return;   /* (batch 54) the guard rails stop racers too (they used to drive through them) */
  /* (batch 54) JUMPS, with your car's rule: it follows the road only while the road pushes up on it; over a crest or off a ramp lip, where the ground falls away faster than gravity (24 m/s2, as yours) can pull it down,
     it leaves the road with the road's own vertical speed and flies a ballistic arc (no steering, no power) until it lands. It used to be glued to the ground. */
  if(c.air){c.vy-=GRAV*dt;c.y+=c.vy*dt;c.airT=(c.airT||0)+dt;const g=gw(c.x,c.z,c.y+.5);if(c.y<=g&&c.vy<=0){c.y=g;c.air=0;c.vy=0;c.gs=c.gsp=g;c.landT=.3;c.kv=0}
    c.pitch+=(Math.atan2(c.vy,Math.max(8,c.v))*.6-c.pitch)*Math.min(1,dt*3);c.roll*=.97}
  else{const g=gw(c.x,c.z,Math.max(c.y,c.gs??c.y)+1);const v=c.v;   /* probed from above: climbing a ramp fast, the car used to lag under the ramp surface and lose it */if(c.gs==null||Math.abs(c.gs-g)>3){c.gs=g;c.gsp=g}c.gs+=(g-c.gs)*(1-Math.exp(-dt/.03));let vG=(c.gs-c.gsp)/dt;c.gsp=c.gs;{const vm=.7*v+4;vG=Math.max(-vm,Math.min(vm,vG))}   /* the ground's own vertical speed under the car, smoothed as for yours */
    if(v>16&&c.state==3){const d=Math.max(3.5,Math.min(9,v*.09)),hA=gw(c.x+sy*d,c.z-cy*d,c.y),hB=gw(c.x-sy*d,c.z+cy*d,c.y);const kv=(Math.max(-d,Math.min(d,hA-g))+Math.max(-d,Math.min(d,hB-g)))/(d*d);c.kv=(c.kv||0)+(kv-(c.kv||0))*(1-Math.exp(-dt/.06));
      if(c.landT>0)c.landT-=dt;else if(-c.kv*v*v>GRAV&&Math.abs(c.y-g)<.6){c.air=1;c.airT=0;c.vy=vG;c.y=g}}
    else c.kv=0;
    if(!c.air){c.y+=(g-c.y)*Math.min(1,dt*30);if(c.y<g)c.y=g}
    const gf=groundAt(c.x+sy*1.6,c.z-cy*1.6,c.y+.5),gb=groundAt(c.x-sy*1.6,c.z+cy*1.6,c.y+.5);c.pitch+=(Math.atan2(gf-gb,3.2)-c.pitch)*Math.min(1,dt*10);c.roll*=.9}
  /* (batch 54) the body jolt from a hit (the same spring as yours) */{const K=120,D=7.5;c.jrv=(c.jrv||0)+(-K*(c.jr||0)-D*(c.jrv||0))*dt;c.jr=Math.max(-.16,Math.min(.16,(c.jr||0)+c.jrv*dt));c.jpv=(c.jpv||0)+(-K*(c.jp||0)-D*(c.jpv||0))*dt;c.jp=Math.max(-.1,Math.min(.1,(c.jp||0)+c.jpv*dt));if(Math.abs(c.jr)+Math.abs(c.jrv)>.001)c.roll=c.jr;if(Math.abs(c.jp)+Math.abs(c.jpv)>.001)c.pitch+=c.jp-(c.jpPrev||0);c.jpPrev=c.jp}}
/* (batch 53) a racer is one of the playable cars: the pool car about as fast as yours (the lead racer 3 % faster), driven with that car's own figures: its grip, top speed, acceleration and braking, a little under what you can do with it (95-99 %) */
let _rTier=null;   /* (batch 54) the event's car band (km/h), from its difficulty */
function racerCarNear(want,used){let b=null;const T=_rTier;if(T)want=Math.max(T[0]+5,Math.min(T[1]-5,want));for(const p of RACER_POOL){if(used&&used.has(p.id))continue;if(T&&(p.top<T[0]||p.top>T[1]))continue;if(!b||Math.abs(p.top-want)<Math.abs(b.top-want))b=p}if(!b&&T){for(const p of RACER_POOL)if(p.top>=T[0]&&p.top<=T[1]&&(!b||Math.abs(p.top-want)<Math.abs(b.top-want)))b=p}b=b||RACER_POOL[0];if(used)used.add(b.id);return b}
function racerSkillFor(pc,sk,nitro){const r=pc.def.real,vm=1+(r.top/308-1)*.75,gr=Math.pow(r.lat/1.05,.9),ac=Math.pow(3.7/r.t100,.8),br=Math.pow(34/r.brk,.9);
  return{grip:15*gr*sk,vmax:r.top/3.6*sk,vtop:r.top/3.6,acc:12*ac*sk,brk:19*br,type:pc.type,col:pc.col,car:pc.id,nitro:nitro?1:0}}
const racerMyTop=()=>{const d=CAR_ROSTER[CARSEL.cur];return d?(typeof upgReal=='function'?upgReal(d).top:d.real.top):300};
const racerDiff=()=>{const ev=EV.run&&EV.run.ev||EV._starting;return ev&&typeof evDiff=='function'?evDiff(ev):2};
let _rUsed=null;const racerSkill=(k,n,hard)=>{if(k==0)_rUsed=new Set();const d=racerDiff();_rTier=EV_DTOP[d];const dl=typeof DIFF!='undefined'?DIFF.lv:1,pc=racerCarNear(racerMyTop()*(hard?1.07:1.03)*(1-.032*k)*(typeof DIFF!='undefined'?DIFF.car[dl]:1),_rUsed);_rTier=null;return racerSkillFor(pc,Math.min(1.02,((hard?1:.99)-.018*k-[0,.07,.025,0][d])*(typeof DIFF!='undefined'?DIFF.racer[dl]:1)),1)};   /* (batch 63) the difficulty setting */   /* (batch 54) easy racers drive a little below their best too */   /* (batch 53) they drive their cars almost flat out */
/* the field for an event: n racers on the grid behind the start line, two abreast */
function racerGrid(Rt,n,aggr){/* you are on the front row on the right (24 m along the route); the racers: beside you on the left, then two by two behind */const G=[[24,-3.4],[15,3.4],[15,-3.4],[6,3.4],[6,-3.4],[0,0]];const out=[];const ev=EV._starting,LU=ev&&ev.lineup;if(LU)n=LU.length;for(let k=0;k<n;k++){/* (batch 58) a story event names its racers and their cars */const lu=LU&&LU[k],pc=lu&&RACER_POOL.find(p=>p.id==lu.car);const c=racerSpawn(Rt,G[k][0],G[k][1],k,pc?racerSkillFor(pc,Math.min(1.02,(lu.sk||.95)*(typeof DIFF!='undefined'?DIFF.story[DIFF.lv]:1)),lu.nitro!=null?lu.nitro:1):racerSkill(k,n,aggr),lu&&lu.aggr!=null?lu.aggr:(aggr?2:1));if(c&&lu){c.race.name=lu.name;c.race.who=lu.who}   /* (batch 53) every racer tries to take you down, in every mode */if(c)out.push(c)}return out}
/* (batch 27) TAKEDOWN: the pack sets off 70-300 m ahead of you, two abreast, a little slower than race racers (top 50-60 m/s), not ramming */
/* (batch 53) TAKEDOWN waves: three racers, each a different playable car a little slower than yours, already rolling S0 metres along the route (ahead of you); when you have wrecked or passed them the next three appear further on */
let _pkUsed=new Set();
function racerPack(Rt,n,S0,wave){const out=[];if(!wave)_pkUsed=new Set();if(_pkUsed.size>RACER_POOL.length-n)_pkUsed=new Set();
  for(let k=0;k<n;k++){const S=(S0||200)+k*48;if(S>Rt.len-70)break;const d=racerDiff();_rTier=EV_DTOP[d];const dl=typeof DIFF!='undefined'?DIFF.lv:1,pc=racerCarNear(racerMyTop()*(.98-.03*k)*(typeof DIFF!='undefined'?DIFF.car[dl]:1),_pkUsed);_rTier=null;const c=racerSpawn(Rt,S,(k&1)?-3.4:3.4,k+(wave||0)*3,racerSkillFor(pc,Math.min(1.02,(.97-.02*k-[0,.06,.02,0][d])*(typeof DIFF!='undefined'?DIFF.racer[dl]:1)),1),1);   /* (batch 64) the pack drives cars about as fast as yours (they were 8-16 % slower) */if(c)out.push(c)}return out}
/* (batch 53) a racer that has crashed in a plain race is back on the road after 2.2 s (further on, on a clear spot), not out for the rest of the race; takedowns and death races keep their wrecks */
function racerRecover(c,dt){const R=c.race,ev=EV.run&&EV.run.ev;if(!R||!ev||(ev.type!='race'&&ev.type!='death'&&ev.type!='rage')||R.done>=0||!R.go)return false;if(ev.type=='rage'&&c.byP)return false;   /* (batch 53) in a takedown a racer that crashed on its own comes back too; one YOU took down stays down */c.recT=(c.recT||0)+dt;
  if(c.recT>(ev.type=='death'?3.5:2.2)&&racerRespot(c)){c.recT=0;R.catchT=12;c.state=3;c.kind=2;c.dmg=Math.min(c.dmg||0,.45);c.rev=0;c.stk=0;c.hn=0;return true}return false}
function racerRespot(c){const R=c.race,Rt=R.Rt,p=Rt.pts;R.still=0;c.loose=0;c.air=0;c.vy=0;
  for(let d=25;d<=145;d+=20)for(const lat of[R.off<0?-3.4:3.4,0,R.off<0?3.4:-3.4]){const S=Math.min(Rt.len-15,R.s+d);let j=0;while(j<Rt.n-2&&Rt.S[j+1]<S)j++;const dx=p[j*3+3]-p[j*3],dz=p[j*3+5]-p[j*3+2],l=Math.hypot(dx,dz)||1,ux=dx/l,uz=dz/l,x=p[j*3]-uz*lat,z=p[j*3+2]+ux*lat;
    if(Math.hypot(x-C.x,z-C.z)<18)continue;if(TR.cars.some(o=>o.alive&&o!==c&&Math.hypot(o.x-x,o.z-z)<9))continue;if(trStatic(x,z,c.hw+.3,p[j*3+1]))continue;
    c.x=c.px=x;c.z=c.pz=z;c.y=c.py=groundAt(x,z,p[j*3+1]+1);c.yaw=c.pyaw=Math.atan2(ux,-uz);c.v=10;c.vx=ux*10;c.vz=uz*10;c.om=0;c.rev=0;c.stk=0;c.roll=c.pitch=0;R.fi=j;R.s=Rt.S[j];R.off=R.offT=lat;return true}
  return false}
function racerClear(){for(const c of TR.cars)if(c.alive&&c.kind==2&&c.race){c.race=null;trKill(c,0)}}
/* ---- street racers ---- */
function racerTick(dt){
  const s=RACE.sr;
  if(s&&(!s.alive||s.kind!==2&&!s.sr)){RACE.sr=null}
  if(EV.run||GAME.state||(typeof storyGuided=='function'&&storyGuided())){return}
  if(!RACE.sr){RACE.srT-=dt;if(RACE.srT<=0){RACE.srT=100;if(TR.rng()<.35&&C.speed>14&&!DISTRICT_BOXES.some(B=>inBox(C.x,C.z,B,100)))racerStreetSpawn()}return}
  /* drive up behind or beside it for 1.5 s and it challenges you */
  const c=RACE.sr,d=Math.hypot(c.x-C.x,c.z-C.z);if(d>700){trKill(c,0);RACE.sr=null;return}
  if(d<16&&C.speed>10&&!EV.card){c.chal=(c.chal||0)+dt;if(c.chal>1.5){c.chal=0;racerOffer(c)}}else c.chal=Math.max(0,(c.chal||0)-dt)}
function racerStreetSpawn(){const ux=C.vx/C.speed,uz=C.vz/C.speed;if(!copAhead(170+TR.rng()*60,ux,uz))return;const r=ROADS[TRP.ri],o=LG.ofRoad[TRP.ri];if(!o)return;const t=_tan(r,TRP.i),di=(t[0]*ux+t[1]*uz)>=0?0:1,e=o[di][0];if(!e)return;
  const u=e.dir>0?TRP.i:r.n-1-TRP.i;if(u<4||u>e.n-6)return;trPt(e,u);if(trSeen(_pt.x,_pt.z)&&Math.hypot(_pt.x-C.x,_pt.z-C.z)<150)return;
  const k=Math.floor(TR.rng()*RACER_TYPES.length),pc=racerCarNear(racerMyTop()*(1.0+TR.rng()*.08)),c=trPlace(e,u,pc.type,pc.col,Math.min(e.lim,25),Math.floor(TR.rng()*1e9));if(!c)return;c.sr=1;c.v0f=1.15;RACE.sr=c}
function racerOffer(c){/* a town 1.2-3.5 km away that you can reach */let best=null;for(const P of PLACES){const B=P.box,x=(B.x0+B.x1)/2,z=(B.z0+B.z1)/2,d=Math.hypot(x-C.x,z-C.z);if(d<1200||d>3500)continue;if(!best||Math.abs(d-2200)<Math.abs(best.d-2200))best={P,x,z,d}}if(!best)return;
  const pr=ROADS.find(q=>q.id==best.P.road);if(!pr)return;const gi=Math.floor(pr.n/2),gx=pr.X[gi],gz=pr.Z[gi];
  const me={x:C.x,z:C.z,yaw:Math.atan2(C.vx,-C.vz)},Rp=evRoute(me,gx,gz),Rr=evRoute({x:c.x,z:c.z,yaw:c.yaw},gx,gz);if(!Rp||!Rr||Rp.len<800)return;
  const prize=Math.round(Rp.len/1000*1800/100)*100;
  EV.card={offer:1,street:1,title:'STREET RACE',sub:'Race to '+best.P.name,lines:[[fmtLen(Rp.len)+'  ·  first there wins '+evMoney(prize),'#fff'],['the yellow car is waiting for your answer','#9cc8ff']],
    btns:[{label:'RACE!',col:'#ff7a1a',act:()=>racerStreetStart(c,Rp,Rr,best.P.name,prize)},{label:'NO',col:'#8a94a6',act:()=>{EV.card=null;c.chal=-8}}]}}
function racerStreetStart(c,Rp,Rr,name,prize){EV.card=null;if(!c.alive)return;const ev={id:'street',type:'race',street:1,name:'Street race to '+name,prize,R:Rp,cps:[],len:Rp.len,s:{x:C.x,z:C.z,y:C.y,yaw:C.yaw}};
  const n=Math.max(2,Math.round(Rp.len/300));for(let k=1;k<=n;k++){const S=Rp.len*k/n;let j=0;while(j<Rp.n-2&&Rp.S[j+1]<S)j++;const x=Rp.pts[j*3],y=Rp.pts[j*3+1],z=Rp.pts[j*3+2],dx=Rp.pts[j*3+3]-x,dz=Rp.pts[j*3+5]-z,l=Math.hypot(dx,dz)||1;ev.cps.push({x,y,z,nx:-dz/l,nz:dx/l})}
  c.state=3;c.kind=2;c.L=null;c.sr=0;c.race={Rt:Rr,fi:0,s:0,go:true,done:-1,skill:racerSkillFor(RACER_POOL.find(p=>p.type==c.type)||racerCarNear(racerMyTop()),.975,1),aggr:1,off:0,offT:0,ramCd:3,name:'Street racer'};RACE.sr=null;
  EV.run={ev,t:0,cp:0,ghost:[],gt:0,copsWas:COP.on,racers:[c],bonus:0,wrecks:0,pop:0,ps:0,fi:0,lastBeep:0};COP.on=false;navSet(ev.cps[0].x,ev.cps[0].z);evBeep(880,.25);safeToast('GO!',1.2,1)}
/* the yellow light over a street racer, and the racers on the minimap */
function racerFx(sprite){const s=RACE.sr;if(s&&s.alive){const d=Math.hypot(s.x-C.x,s.z-C.z);if(d<500){const on=Math.sin(EV.t*8)>0;sprite(s.x,s.y+2.2,s.z,(on?.7:.35)+d*.004,1,.85,.1,on?.95:.5)}}}
function racerMapIcons(ctx,px,pz,r){const s=RACE.sr;if(s&&s.alive){ctx.fillStyle=((EV.t*4|0)&1)?'#ffd23a':'#a08000';ctx.beginPath();ctx.arc(px(s.x),pz(s.z),r*.75,0,TAU);ctx.fill()}
  for(const c of TR.cars)if(c.alive&&c.kind==2&&c.race){ctx.fillStyle='#ffd23a';ctx.fillRect(px(c.x)-r*.5,pz(c.z)-r*.5,r,r)}}

/* ===== (batch 53) KILL CAM: when you wreck a racer the game drops into slow motion for a moment and the camera cuts to the wreck; the takedown fills a third of the nitro tank at once ===== */
const KC={t:0,c:null,cam:[0,0,0]};
function killCamStart(c){if(CC.on||KC.t>0||TUM.on)return;const sp=Math.hypot(C.vx,C.vz)||1,dx=C.vx/sp,dz=C.vz/sp,sd=((c.x-C.x)*-dz+(c.z-C.z)*dx)>0?1:-1;KC.t=1.4;KC.c=c;
  const x=c.x+dx*10+(-dz)*sd*5,z=c.z+dz*10+dx*sd*5;KC.cam[0]=x;KC.cam[2]=z;KC.cam[1]=Math.max(groundAt(x,z,c.y+3)+1.4,c.y+1.8)}
function killCamFrame(sec){if(KC.t>0){KC.t-=sec;if(!KC.c||!KC.c.alive||CC.on)KC.t=0}}
function killCam(){const c=KC.c,a=R.alpha;CAM.x=KC.cam[0];CAM.y=KC.cam[1];CAM.z=KC.cam[2];CAM.tx=lerp(c.px,c.x,a);CAM.ty=lerp(c.py,c.y,a)+.7;CAM.tz=lerp(c.pz,c.z,a);CAM.fov=.8}
function killCamHud(c,W_,H_,u){if(!(KC.t>0))return;const k=Math.min(1,(1.4-KC.t)*5)*Math.min(1,KC.t*3);c.save();c.globalAlpha=k;c.fillStyle='#000';c.fillRect(0,0,W_,H_*.09);c.fillRect(0,H_*.91,W_,H_*.09);fxText(c,'TAKEDOWN!',W_*.5,H_*.66,u*.95,'#ffb000','center','rgba(255,120,20,.8)');c.restore()}
