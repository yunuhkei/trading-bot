/* (batch 54) GUARD RAILS as real, breakable barriers.
   Every rail section (one road sample, about 4 m, one side of the road) is a line segment in a grid. Your car and the racers collide with it from EITHER side (it used to be a check against
   the nearest road only: racers ignored rails completely, and you could pass through where the nearest road was another one, e.g. the far side of a divided highway).
   A glancing hit scrapes and slides along it (as before). A hard hit (more than ~38 mph straight into it) BREAKS the section: it vanishes with sparks and a bang and the car goes through
   (off the bridge or the cliff it was guarding, which is how a rail still kills you); above ~58 mph into it the next section goes too.
   A racer that hits a rail hard is wrecked (and if you touched it in the last 4 s it is your takedown). Broken sections come back after 90 s once you are well away.
   The section's vertices (beam and post) are collapsed in the GPU buffer to hide it, from a small CPU copy kept for each section. */
const railNow=()=>performance.now()/1000,RAILSEG=[],RAILG=new Map(),RAIL_CELL=24,RAIL_BRK=17,RAIL_BRK2=26;
let _railRec=null;   /* the section being built (buildFurniture) */
function railKey(cx,cz){return (cx+4096)*8192+(cz+4096)}
function railBegin(ax,az,ay,bx,bz,by,side,road,i){_railRec={ax,az,ay,bx,bz,by,side,broken:0,t:0,pieces:[],road,ri:i,bit:side<0?1:2}}
function railPiece(m,a,b){if(_railRec&&b>a)_railRec.pieces.push({m,a,b})}
function railEnd(){const s=_railRec;_railRec=null;if(!s)return;const i=RAILSEG.length;RAILSEG.push(s);
  const x0=Math.floor((Math.min(s.ax,s.bx)-2)/RAIL_CELL),x1=Math.floor((Math.max(s.ax,s.bx)+2)/RAIL_CELL),z0=Math.floor((Math.min(s.az,s.bz)-2)/RAIL_CELL),z1=Math.floor((Math.max(s.az,s.bz)+2)/RAIL_CELL);
  for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const k=railKey(x,z);let L=RAILG.get(k);if(!L){L=[];RAILG.set(k,L)}L.push(i)}}
/* after finishProps numbered the meshes: keep a copy of each section's vertices (to hide and restore it) */
function railFinish(){for(const s of RAILSEG)for(const p of s.pieces){if(!p.m)continue;p.pi=p.m.outIdx;p.cpu=p.m.f.slice(p.a*7,p.b*7);p.m=null}}
function railShow(s,on){const gl=G.gl;if(!gl||!R.props)return;for(const p of s.pieces){const P=R.props[p.pi];if(!P||!p.cpu)continue;let d=p.cpu;
    if(!on){d=p.cpu.slice();const x=d[0],y=d[1]-3,z=d[2];for(let o=0;o<d.length;o+=7){d[o]=x;d[o+1]=y;d[o+2]=z}}
    gl.bindBuffer(gl.ARRAY_BUFFER,P.vb);gl.bufferSubData(gl.ARRAY_BUFFER,p.a*28,d)}}
function railBreak(i,vn,x,z){const s=RAILSEG[i];if(!s||s.broken)return;s.broken=1;s.t=railNow();railShow(s,false);
  if(typeof sparkAt=='function'){sparkAt((s.ax+s.bx)/2,(s.ay+s.by)/2+.6,(s.az+s.bz)/2,0,0,24,Math.min(14,4+vn*.3))}
  if(vn>RAIL_BRK2){/* the next section along goes too */for(const j of[i-1,i+1]){const o=RAILSEG[j];if(o&&!o.broken&&o.side===s.side&&Math.hypot(o.ax-s.bx,o.az-s.bz)+Math.hypot(o.bx-s.ax,o.bz-s.az)<12){o.broken=1;o.t=railNow();railShow(o,false)}}}}
function railRepair(){if(!RAILSEG.length)return;for(const s of RAILSEG)if(s.broken&&railNow()-s.t>90&&Math.hypot((s.ax+s.bx)/2-C.x,(s.az+s.bz)/2-C.z)>300){s.broken=0;railShow(s,true)}}
function railReset(){for(const s of RAILSEG)if(s.broken){s.broken=0;railShow(s,true)}}
/* the nearest unbroken section a circle (cx,cz, radius r, at height y) is touching: returns its index and sets _rl (normal from the rail to the circle, penetration) */
const _rl={nx:0,nz:0,pen:0,i:-1};
function railHit(cx,cz,y,r){const gx=Math.floor(cx/RAIL_CELL),gz=Math.floor(cz/RAIL_CELL),L=RAILG.get(railKey(gx,gz));if(!L)return -1;let best=-1,bp=0;
  for(const i of L){const s=RAILSEG[i];if(s.broken||(s.road&&!(s.road.rail[s.ri]&s.bit)))continue;const ex=s.bx-s.ax,ez=s.bz-s.az,l2=ex*ex+ez*ez||1;let t=((cx-s.ax)*ex+(cz-s.az)*ez)/l2;t=t<0?0:t>1?1:t;
    const ry=s.ay+(s.by-s.ay)*t;if(y>ry+1.1||y<ry-2.2)continue;const px=s.ax+ex*t,pz=s.az+ez*t,dx=cx-px,dz=cz-pz,d=Math.hypot(dx,dz),pen=r+.1-d;if(pen<=0||pen<=bp)continue;
    bp=pen;best=i;if(d>1e-4){_rl.nx=dx/d;_rl.nz=dz/d}else{const l=Math.sqrt(l2);_rl.nx=-ez/l*s.side;_rl.nz=ex/l*s.side}}
  _rl.pen=bp;_rl.i=best;return best}
/* YOUR CAR against the rails (from carStep, replacing the old nearest-road test) */
function railCollide(dt){if(C.railT>0)C.railT-=dt;if(C.railCd>0)C.railCd-=dt;if(!RAILSEG.length)return;{const t=railNow();if(t-(railCollide.rt||0)>2){railCollide.rt=t;railRepair()}}
  const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw),r=(TR.P.hw||.95)+.06;
  for(const off of[1.3,-1.3]){const cx=C.x+fx*off,cz=C.z+fz*off,i=railHit(cx,cz,C.y,r);if(i<0)continue;const nx=_rl.nx,nz=_rl.nz;
    const vn=-(C.vx*nx+C.vz*nz);
    if(vn>RAIL_BRK){/* BREAK THROUGH: the rail takes a big bite of the speed into it and some of the rest, then lets the car through */
      railBreak(i,vn,cx,cz);C.vx+=nx*vn*.45;C.vz+=nz*vn*.45;C.vx*=.86;C.vz*=.86;C.hit=Math.max(C.hit,vn);C.shake=Math.min(1,C.shake+.5);C.bob=-.08;
      if(typeof audioBang=='function')audioBang(1);if(!PHYS.classic){const rl=nx*Math.cos(C.yaw)+nz*Math.sin(C.yaw);if(Math.abs(rl)>.6)tumbleTrip(-rl*vn,'guard rail')}
      impactAdd(4,vn,.5*(HND.mass||1400)*vn*vn*.6,0,cx,cz,nx,nz);C.jrv=(C.jrv||0)+(Math.random()<.5?-2.5:2.5);continue}
    C.x+=nx*_rl.pen;C.z+=nz*_rl.pen;
    if(vn>0){if(vn>16&&!PHYS.classic){const rl=nx*Math.cos(C.yaw)+nz*Math.sin(C.yaw);if(Math.abs(rl)>.6)tumbleTrip(-rl*vn,'guard rail')}deflect(nx,nz,vn,PHYS.railE,PHYS.railMu);C.hit=Math.max(C.hit,vn);C.shake=Math.min(1,C.shake+vn*.035);C.railVn=Math.max(C.railVn||0,vn);if(vn>3&&typeof audioBang=='function'&&(C.railCd||0)<=0)audioBang(.2+vn/30)}
    const vh=Math.hypot(C.vx,C.vz);if(vh>.3){const k=Math.max(0,1-2*dt/vh);C.vx*=k;C.vz*=k}
    const v1=Math.hypot(C.vx,C.vz),ms=.5*(HND.mass||1400);C.railE=(C.railE||0)+(vn>0?ms*vn*vn*(1-PHYS.railE*PHYS.railE):0)+.2*ms*Math.max(0,vh*vh-v1*v1);C.railT=.12;C.railP=[cx-nx*(r+.05),cz-nz*(r+.05),nx,nz];
    if((C.railCd||0)<=0&&C.railE>0){impactAdd(4,Math.max(C.railVn,.5),C.railE,0,C.x,C.z,nx,nz);C.railE=0;C.railVn=0;C.railCd=.25}}}
/* A RACER against the rails (from racerStep). Returns true when it was wrecked. */
function railRacer(c){if(!RAILSEG.length)return false;const fx=Math.sin(c.yaw),fz=-Math.cos(c.yaw),r=c.hw+.05;
  for(const off of[c.hl*.55,-c.hl*.55]){const cx=c.x+fx*off,cz=c.z+fz*off,i=railHit(cx,cz,c.y,r);if(i<0)continue;const nx=_rl.nx,nz=_rl.nz,vx=c.vx||fx*c.v,vz=c.vz||fz*c.v,vn=-(vx*nx+vz*nz);
    const mine=C.t-(c.pHitT??-99)<4;
    if(vn>(mine?8:16)){/* a hard hit: wrecked, through the rail if it was hard enough */if(vn>RAIL_BRK)railBreak(i,vn,cx,cz);else{c.x+=nx*_rl.pen;c.z+=nz*_rl.pen}
      if(typeof sparkAt=='function')sparkAt(cx-nx*r,c.y+.5,cz-nz*r,nx,nz,16,8);
      c.state=1;c.wt=0;TR.stat.wrecks++;c.vx=vx+nx*vn*.5;c.vz=vz+nz*vn*.5;trFlipKick(c,Math.max(3e5,c.m*vn*vn*.5));
      if(mine){c.byP=1;if(typeof evTakedown=='function')evTakedown(c);if(typeof boostTakedown=='function')boostTakedown(c)}return true}
    /* a scrape: kept off the rail, nudged back towards the road, a little speed lost */
    c.x+=nx*_rl.pen;c.z+=nz*_rl.pen;if(vn>0){c.kx=(c.kx||0)+nx*Math.min(4,vn*.8);c.kz=(c.kz||0)+nz*Math.min(4,vn*.8);c.v*=.985}
    if(typeof sparkAt=='function'&&Math.random()<.3)sparkAt(cx-nx*r,c.y+.45,cz-nz*r,nx,nz,3,5)}
  return false}
