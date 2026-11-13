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
  const sn=navSnap(x,z,40);if(!sn)return null;const la=navLane(sn,x,z,ux,uz);if(!la)return null;const c=trPlace(la.e,la.u,RACER_TYPES[k%RACER_TYPES.length],RACER_COLS[k%RACER_COLS.length],0,7000+k);if(!c)return null;
  c.x=c.px=x-uz*lat;c.z=c.pz=z+ux*lat;c.y=c.py=groundAt(c.x,c.z,p[j*3+1]+1);c.yaw=c.pyaw=Math.atan2(ux,-uz);c.v=0;c.vx=c.vz=c.om=0;c.state=3;c.kind=2;c.cm=0;c.siren=0;c.L=null;c.stk=0;c.rev=0;c.hn=0;
  c.race={Rt,fi:j,s:S,go:false,done:-1,skill,aggr:aggr||0,off:0,offT:0,ramCd:2,name:['Viper','Blaze','Ghost','Nova','Rook','Jinx','Vandal','Comet'][k%8]};return c}
const _ra=(Rt,bi,s)=>{let k=bi;while(k<Rt.n-1&&Rt.S[k]<s)k++;return k};
function racerStep(c,dt){
  c.px=c.x;c.pz=c.z;c.py=c.y;c.pyaw=c.yaw;c.age+=dt;const R=c.race;if(!R){c.state=1;return}const Rt=R.Rt,p=Rt.pts;
  /* where it is along the route */
  let bi=R.fi,bd=1e18;for(let k=Math.max(0,bi-4);k<Math.min(Rt.n,bi+40);k++){const d=(p[k*3]-c.x)**2+(p[k*3+2]-c.z)**2;if(d<bd){bd=d;bi=k}}R.fi=bi;R.s=Rt.S[bi];
  if(R.done<0&&R.s>=Rt.len-10&&R.go)R.done=EV.t;
  /* (batch 27) stuck for 5 s (a jam, a pile-up, a wall): it is put back on the route a little further on, on a clear spot */
  if(R.go&&R.done<0){R.still=c.v<2.5?(R.still||0)+dt:0;if(R.still>5&&racerRespot(c))return}
  if(!R.go||R.done>=0){const k=Math.exp(-dt*(R.done>=0?.8:20));c.v*=k;}
  else{
    const v=c.v,sk=R.skill,ahead=_ra(Rt,bi,R.s+Math.max(8,v*.7));
    /* the tightest bend in the next stretch: the curvature of the circle through three points of it (Menger), at two distances, and the speed its grip allows there */
    let vt=sk.vmax;for(const L of[Math.max(40,v*1.4),Math.max(80,v*2.6)]){const A=_ra(Rt,bi,R.s+10),B=_ra(Rt,bi,R.s+10+L/2),Cc=_ra(Rt,bi,R.s+10+L);const ax=p[A*3],az=p[A*3+2],bx=p[B*3],bz=p[B*3+2],cx=p[Cc*3],cz=p[Cc*3+2];
      const ar=Math.abs((bx-ax)*(cz-az)-(bz-az)*(cx-ax)),dd=Math.hypot(bx-ax,bz-az)*Math.hypot(cx-bx,cz-bz)*Math.hypot(cx-ax,cz-az),kc=dd>1e-3?2*ar/dd:0;if(kc>1e-4){const vb=Math.sqrt(sk.grip/kc),dist=Math.max(0,Rt.S[A]-R.s);vt=Math.min(vt,Math.sqrt(vb*vb+2*9*dist))}}
    /* catch-up: a little faster when far behind you, a little slower when far ahead */
    const gap=(EV.run&&EV.run.ps!=null)?EV.run.ps-R.s:0;vt*=gap>150?1.07:gap<-250?.94:1;
    /* traffic in the way: overtake on the free side */
    const sy=Math.sin(c.yaw),cy=-Math.cos(c.yaw),look=Math.max(40,v*1.6),lat2=(o,dx,dz)=>{const ovx=Math.sin(o.yaw)*o.v,ovz=-Math.cos(o.yaw)*o.v,lt=dx*-cy+dz*sy,lv=ovx*-cy+ovz*sy;return[lt,lt+lv*.9]},   /* where it is across our path now and in 0.9 s (a car changing lanes) */
      inLane=(o,off)=>{const dx=o.x-c.x,dz=o.z-c.z,f=dx*sy+dz*cy;if(f<2||f>look)return -1;const L=lat2(o,dx,dz),q=off-R.off;return Math.min(Math.abs(L[0]-q),Math.abs(L[1]-q),(L[0]-q)*(L[1]-q)<0?0:9)<2.6?f:-1};   /* L is measured from this car; off is from the route centre, where this car is R.off */
    let block=null,bdist=1e9;for(const o of TR.cars){if(!o.alive||o===c)continue;const f=inLane(o,R.off);if(f>0&&f<bdist){bdist=f;block=o}}
    /* a car ahead that is turning or changing lanes (not going our way): be ready to stop behind it */
    for(const o of TR.cars){if(!o.alive||o===c||o.kind==2)continue;const dx=o.x-c.x,dz=o.z-c.z,f=dx*sy+dz*cy;if(f<3||f>look)continue;const lt=dx*-cy+dz*sy;if(Math.abs(lt)>7)continue;if(Math.abs(angd(o.yaw,c.yaw))>.12)vt=Math.min(vt,Math.max(o.v*Math.cos(angd(o.yaw,c.yaw)),0)+Math.max(0,f-12)*.5)}
    if(block&&block.v<v-1){/* overtake on whichever side is clear; if neither is, slow down behind it in good time */
      let moved=false;for(const side of[R.off<=0?3.6:-3.6,R.off<=0?-3.6:3.6]){const off=Math.max(-6,Math.min(6,R.off+side));let clear=true;for(const o of TR.cars){if(!o.alive||o===c)continue;const dx=o.x-c.x,dz=o.z-c.z,f=dx*sy+dz*cy;if(f>-8&&f<bdist+15){const L=lat2(o,dx,dz),q=off-R.off;if(Math.min(Math.abs(L[0]-q),Math.abs(L[1]-q))<2.9||(L[0]-q)*(L[1]-q)<0){clear=false;break}}}if(clear){R.offT=off;moved=true;break}}
      const closing=v-block.v,need=closing*closing/(2*7)+12;if(!moved||bdist<need)vt=Math.min(vt,block.v+Math.max(0,bdist-10)*.45)}   /* until it is actually beside it, it keeps a speed it can still stop from */
    else if(!block)R.offT*=Math.exp(-dt*.4);
    R.off+=(R.offT-R.off)*Math.min(1,dt*2.6);
    let tx=p[ahead*3],tz=p[ahead*3+2];{const a2=Math.min(Rt.n-1,ahead+1),dx=p[a2*3]-tx,dz=p[a2*3+2]-tz,l=Math.hypot(dx,dz)||1;tx+=-dz/l*R.off;tz+=dx/l*R.off}
    /* a death racer goes for you when you are close */
    if(R.aggr&&EV.run&&!TUM.on){R.ramCd-=dt;const dpx=C.x-c.x,dpz=C.z-c.z,dp=Math.hypot(dpx,dpz);if(dp<26&&R.ramCd<=0&&(dpx*sy+dpz*cy)>-6){tx=C.x+C.vx*.4;tz=C.z+C.vz*.4;vt=Math.max(vt,C.speed+10);if(dp<4.5)R.ramCd=3.5}}
    if(c.rev>0){c.rev-=dt;c.yaw+=c.revS*1.1*dt;c.v=0;c.x-=sy*4*dt;c.z-=cy*4*dt;c.vx=-sy*4;c.vz=-cy*4;if(trStatic(c.x,c.z,c.hw+.1,c.y)){c.x+=_sx;c.z+=_sz}const g=groundAt(c.x,c.z,c.y+.5);c.y+=(g-c.y)*Math.min(1,dt*18);return}
    if(c.stk>1.1&&c.v<2){c.rev=1;c.revS=angd(Math.atan2(tx-c.x,-(tz-c.z)),c.yaw)>0?-1:1;c.stk=.3}
    const err=angd(Math.atan2(tx-c.x,-(tz-c.z)),c.yaw),maxYr=Math.min(2.4,sk.grip*1.3/Math.max(v,4)),yr=Math.max(-maxYr,Math.min(maxYr,err*3));c.om=yr;c.yaw+=yr*dt;
    const a=Math.max(-11,Math.min(sk.acc,(vt-v)*1.6));c.v=Math.max(0,Math.min(sk.vmax*1.1,v+a*dt));c.brake=a<-2.5?1:0;
    if(c.v<1.5)c.stk+=dt;else if(c.stk>0)c.stk=Math.max(0,c.stk-dt*.5)}
  const sy=Math.sin(c.yaw),cy=Math.cos(c.yaw);c.vx=sy*c.v;c.vz=-cy*c.v;c.x+=c.vx*dt;c.z+=c.vz*dt;
  for(const o of[-1,1]){const px=c.x+sy*o*c.hl*.55,pz=c.z-cy*o*c.hl*.55;if(trStatic(px,pz,c.hw+.1,c.y)){c.x+=_sx;c.z+=_sz;c.v*=.6;c.stk+=.2}}
  const g=groundAt(c.x,c.z,c.y+.5);c.y+=(g-c.y)*Math.min(1,dt*18);if(c.y<g)c.y=g;
  const gf=groundAt(c.x+sy*1.6,c.z-cy*1.6,c.y+.5),gb=groundAt(c.x-sy*1.6,c.z+cy*1.6,c.y+.5);c.pitch+=(Math.atan2(gf-gb,3.2)-c.pitch)*Math.min(1,dt*10);c.roll*=.9}
const racerSkill=(k,n,hard)=>{const f=n>1?k/(n-1):0;return{grip:8.6+1.4*(1-f)+(hard?.4:0),vmax:64+12*(1-f)+(hard?3:0),acc:6.5+1.5*(1-f)}};
/* the field for an event: n racers on the grid behind the start line, two abreast */
function racerGrid(Rt,n,aggr){/* you are on the front row on the right (24 m along the route); the racers: beside you on the left, then two by two behind */const G=[[24,-3.4],[15,3.4],[15,-3.4],[6,3.4],[6,-3.4],[0,0]];const out=[];for(let k=0;k<n;k++){const c=racerSpawn(Rt,G[k][0],G[k][1],k,racerSkill(k,n,aggr),aggr);if(c)out.push(c)}return out}
/* (batch 27) TAKEDOWN: the pack sets off 70-300 m ahead of you, two abreast, a little slower than race racers (top 50-60 m/s), not ramming */
function racerPack(Rt,n){const out=[];for(let k=0;k<n;k++){const f=n>1?k/(n-1):0,c=racerSpawn(Rt,300-(k>>1)*90-(k&1)*25,(k&1)?-3.4:3.4,k,{grip:8.3+.9*(1-f),vmax:50+10*(1-f),acc:5+1.2*(1-f)},0);if(c)out.push(c)}return out}
function racerRespot(c){const R=c.race,Rt=R.Rt,p=Rt.pts;R.still=0;
  for(let d=25;d<=145;d+=20)for(const lat of[R.off<0?-3.4:3.4,0,R.off<0?3.4:-3.4]){const S=Math.min(Rt.len-15,R.s+d);let j=0;while(j<Rt.n-2&&Rt.S[j+1]<S)j++;const dx=p[j*3+3]-p[j*3],dz=p[j*3+5]-p[j*3+2],l=Math.hypot(dx,dz)||1,ux=dx/l,uz=dz/l,x=p[j*3]-uz*lat,z=p[j*3+2]+ux*lat;
    if(Math.hypot(x-C.x,z-C.z)<18)continue;if(TR.cars.some(o=>o.alive&&o!==c&&Math.hypot(o.x-x,o.z-z)<9))continue;if(trStatic(x,z,c.hw+.3,p[j*3+1]))continue;
    c.x=c.px=x;c.z=c.pz=z;c.y=c.py=groundAt(x,z,p[j*3+1]+1);c.yaw=c.pyaw=Math.atan2(ux,-uz);c.v=10;c.vx=ux*10;c.vz=uz*10;c.om=0;c.rev=0;c.stk=0;c.roll=c.pitch=0;R.fi=j;R.s=Rt.S[j];R.off=R.offT=lat;return true}
  return false}
function racerClear(){for(const c of TR.cars)if(c.alive&&c.kind==2&&c.race){c.race=null;trKill(c,0)}}
/* ---- street racers ---- */
function racerTick(dt){
  const s=RACE.sr;
  if(s&&(!s.alive||s.kind!==2&&!s.sr)){RACE.sr=null}
  if(EV.run||GAME.state){return}
  if(!RACE.sr){RACE.srT-=dt;if(RACE.srT<=0){RACE.srT=100;if(TR.rng()<.35&&C.speed>14&&!DISTRICT_BOXES.some(B=>inBox(C.x,C.z,B,100)))racerStreetSpawn()}return}
  /* drive up behind or beside it for 1.5 s and it challenges you */
  const c=RACE.sr,d=Math.hypot(c.x-C.x,c.z-C.z);if(d>700){trKill(c,0);RACE.sr=null;return}
  if(d<16&&C.speed>10&&!EV.card){c.chal=(c.chal||0)+dt;if(c.chal>1.5){c.chal=0;racerOffer(c)}}else c.chal=Math.max(0,(c.chal||0)-dt)}
function racerStreetSpawn(){const ux=C.vx/C.speed,uz=C.vz/C.speed;if(!copAhead(170+TR.rng()*60,ux,uz))return;const r=ROADS[TRP.ri],o=LG.ofRoad[TRP.ri];if(!o)return;const t=_tan(r,TRP.i),di=(t[0]*ux+t[1]*uz)>=0?0:1,e=o[di][0];if(!e)return;
  const u=e.dir>0?TRP.i:r.n-1-TRP.i;if(u<4||u>e.n-6)return;trPt(e,u);if(trSeen(_pt.x,_pt.z)&&Math.hypot(_pt.x-C.x,_pt.z-C.z)<150)return;
  const k=Math.floor(TR.rng()*RACER_TYPES.length),c=trPlace(e,u,RACER_TYPES[k],RACER_COLS[(k*3+1)%RACER_COLS.length],Math.min(e.lim,25),Math.floor(TR.rng()*1e9));if(!c)return;c.sr=1;c.v0f=1.15;RACE.sr=c}
function racerOffer(c){/* a town 1.2-3.5 km away that you can reach */let best=null;for(const P of PLACES){const B=P.box,x=(B.x0+B.x1)/2,z=(B.z0+B.z1)/2,d=Math.hypot(x-C.x,z-C.z);if(d<1200||d>3500)continue;if(!best||Math.abs(d-2200)<Math.abs(best.d-2200))best={P,x,z,d}}if(!best)return;
  const pr=ROADS.find(q=>q.id==best.P.road);if(!pr)return;const gi=Math.floor(pr.n/2),gx=pr.X[gi],gz=pr.Z[gi];
  const me={x:C.x,z:C.z,yaw:Math.atan2(C.vx,-C.vz)},Rp=evRoute(me,gx,gz),Rr=evRoute({x:c.x,z:c.z,yaw:c.yaw},gx,gz);if(!Rp||!Rr||Rp.len<800)return;
  const prize=Math.round(Rp.len/1000*1800/100)*100;
  EV.card={offer:1,street:1,title:'STREET RACE',sub:'Race to '+best.P.name,lines:[[fmtLen(Rp.len)+'  ·  first there wins '+evMoney(prize),'#fff'],['the yellow car is waiting for your answer','#9cc8ff']],
    btns:[{label:'RACE!',col:'#ff7a1a',act:()=>racerStreetStart(c,Rp,Rr,best.P.name,prize)},{label:'NO',col:'#8a94a6',act:()=>{EV.card=null;c.chal=-8}}]}}
function racerStreetStart(c,Rp,Rr,name,prize){EV.card=null;if(!c.alive)return;const ev={id:'street',type:'race',street:1,name:'Street race to '+name,prize,R:Rp,cps:[],len:Rp.len,s:{x:C.x,z:C.z,y:C.y,yaw:C.yaw}};
  const n=Math.max(2,Math.round(Rp.len/300));for(let k=1;k<=n;k++){const S=Rp.len*k/n;let j=0;while(j<Rp.n-2&&Rp.S[j+1]<S)j++;const x=Rp.pts[j*3],y=Rp.pts[j*3+1],z=Rp.pts[j*3+2],dx=Rp.pts[j*3+3]-x,dz=Rp.pts[j*3+5]-z,l=Math.hypot(dx,dz)||1;ev.cps.push({x,y,z,nx:-dz/l,nz:dx/l})}
  c.state=3;c.kind=2;c.L=null;c.sr=0;c.race={Rt:Rr,fi:0,s:0,go:true,done:-1,skill:{grip:9.6,vmax:72,acc:7.5},aggr:0,off:0,offT:0,ramCd:9,name:'Street racer'};RACE.sr=null;
  EV.run={ev,t:0,cp:0,ghost:[],gt:0,copsWas:COP.on,racers:[c],bonus:0,wrecks:0,pop:0,ps:0,fi:0,lastBeep:0};COP.on=false;navSet(ev.cps[0].x,ev.cps[0].z);evBeep(880,.25);safeToast('GO!',1.2,1)}
/* the yellow light over a street racer, and the racers on the minimap */
function racerFx(sprite){const s=RACE.sr;if(s&&s.alive){const d=Math.hypot(s.x-C.x,s.z-C.z);if(d<500){const on=Math.sin(EV.t*8)>0;sprite(s.x,s.y+2.2,s.z,(on?.7:.35)+d*.004,1,.85,.1,on?.95:.5)}}}
function racerMapIcons(ctx,px,pz,r){const s=RACE.sr;if(s&&s.alive){ctx.fillStyle=((EV.t*4|0)&1)?'#ffd23a':'#a08000';ctx.beginPath();ctx.arc(px(s.x),pz(s.z),r*.75,0,TAU);ctx.fill()}
  for(const c of TR.cars)if(c.alive&&c.kind==2&&c.race){ctx.fillStyle='#ffd23a';ctx.fillRect(px(c.x)-r*.5,pz(c.z)-r*.5,r,r)}}
