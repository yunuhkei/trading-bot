'use strict';
/* ===== batch 13: NATURAL TOWNS =====
   The towns used to be a square street grid clipped to a box with a boulevard round it. A natural town is laid out in its own frame (u,v), then:
   - its OUTLINE is irregular: an ellipse fitted to the old box, wobbled by a few harmonics, with ARMS that reach out along the main streets (a town grows along its main road);
   - its streets are a grid in (u,v) at an irregular spacing, turned by the town's own angle and BENT by a smooth warp, so every street is a gentle curve and no block is square;
     both families of streets go through the same warp, so they still cross where they did, and the landings and junctions work as on any grid;
   - the two MAIN STREETS (u=0 and v=0) cross in the old centre and run out to the edge, where the roads from the other towns join them in line (a crossroads at each gate);
   - a street that would meet the edge at a slant (or right next to another mouth) stops instead as a T on the last street it crosses;
   - the edge street follows the outline, as narrow as any other street (no boulevard);
   - buildings (22_build.js) follow the bent streets lot by lot: shops in the centre, houses round it, thinning out to trees and empty lots towards the edge.
   g.ins(x,z,m) says whether a point lies inside the outline (m metres inside it); the ground colour of the town follows it, not the old box. */
function makeOrganic(id,B,theme,o){o=o||{};
  const cx=(B.x0+B.x1)/2,cz=(B.z0+B.z1)/2,hx=(B.x1-B.x0)/2,hz=(B.z1-B.z0)/2;let sd=0;for(const ch of id)sd=sd*31+ch.charCodeAt(0)|0;const rng=mulberry(9100+sd);
  const ang=o.ang!=null?o.ang:(rng()-.5)*.5,cs=Math.cos(ang),sn=Math.sin(ang);
  const wa=o.warp==null?22:o.warp,wk=TAU/(o.wl||400),ph=[0,1,2,3].map(()=>rng()*TAU);
  const warp=(u,v)=>[wa*Math.sin(v*wk+ph[0])+wa*.35*Math.sin((u+v)*wk*1.6+ph[1]),wa*Math.sin(u*wk*1.15+ph[2])+wa*.35*Math.sin((u-v)*wk*1.4+ph[3])];
  const toW=(u,v)=>{const w=warp(u,v),a=u+w[0],b=v+w[1];return[cx+a*cs-b*sn,cz+a*sn+b*cs]};
  const toL=(x,z)=>{const a=(x-cx)*cs+(z-cz)*sn,b=-(x-cx)*sn+(z-cz)*cs;let u=a,v=b;for(let k=0;k<4;k++){const w=warp(u,v);u=a-w[0];v=b-w[1]}return[u,v]};
  /* the outline, in the local frame: r = R(theta) */
  const ax=hx*(o.rk||.86),az=hz*(o.rk||.86),hm=[.07+rng()*.05,.05+rng()*.04,.03+rng()*.02],hp=[rng()*TAU,rng()*TAU,rng()*TAU],arm=o.arm==null?.24:o.arm;
  const gates=(o.gates||[]).map(([dx,dz,am])=>{const a=dx*cs+dz*sn,b=-dx*sn+dz*cs;return[Math.abs(a)>Math.abs(b)?(a>0?0:Math.PI):(b>0?Math.PI/2:-Math.PI/2),am==null?arm:am]});
  const R=th=>{const c=Math.cos(th),s=Math.sin(th);let r=1/Math.sqrt((c/ax)**2+(s/az)**2);let f=1+hm[0]*Math.sin(2*th+hp[0])+hm[1]*Math.sin(3*th+hp[1])+hm[2]*Math.sin(5*th+hp[2]);
    for(const[gth,am]of gates){const d=angd(th,gth);f+=am*Math.exp(-((d/.42)**2))}return r*f};
  const ins=(u,v,m)=>Math.hypot(u,v)<R(Math.atan2(v,u))-(m||0);
  const g={id,kind:o.kind||'town',theme,organic:1,ang,cs,sn,toW,toL,R,insL:ins,cx,cz,hw:o.hw||5.5,phw:o.phw||6,lift:o.lift||.05,roads:[],us:[],vs:[]};
  g.ins=(x,z,m)=>{const[u,v]=toL(x,z);return ins(u,v,m)};
  g.sd=(x,z)=>{const[u,v]=toL(x,z);return R(Math.atan2(v,u))-Math.hypot(u,v)};   /* about how far inside the outline (negative: outside) */
  /* the streets: u=0 and v=0 are the main streets; the others at 70-100 m, a little irregular */
  let rmax=0;for(let k=0;k<64;k++)rmax=Math.max(rmax,R(k*TAU/64));
  const spread=(d)=>{const L=[0];for(const sgn of[1,-1]){let p=0;for(;;){p+=d*(.82+rng()*.36);if(p>rmax-25)break;L.push(sgn*p)}}return L.sort((a,b)=>a-b)};
  g.us=spread(o.du||85);g.vs=spread(o.dv||80);
  /* each street's pieces inside the outline: [a0,a1] along it, and what each end does (1 = it meets the edge) */
  const P=[];
  const pieces=(fam,c)=>{const pt=t=>fam?[t,c]:[c,t],out=[];let a=null;const st=3,L=rmax+20;
    const edge=(t0,t1)=>{for(let k=0;k<24;k++){const m=(t0+t1)/2;if(ins(...pt(m),0)===ins(...pt(t0),0))t0=m;else t1=m}return(t0+t1)/2};
    for(let t=-L;t<=L;t+=st){const i=ins(...pt(t),0);if(i&&a==null)a=edge(t-st,t);if(!i&&a!=null){out.push([a,edge(t-st,t)]);a=null}}return out};
  g.us.forEach((u,i)=>{for(const[a0,a1]of pieces(0,u))P.push({fam:0,c:u,a0,a1,e0:1,e1:1,main:u==0,tag:'u'+i})});
  g.vs.forEach((v,j)=>{for(const[a0,a1]of pieces(1,v))P.push({fam:1,c:v,a0,a1,e0:1,e1:1,main:v==0,tag:'v'+j})});
  const ptL=(S,t)=>S.fam?[t,S.c]:[S.c,t];
  /* how squarely a street end meets the edge: |cos| between the street and the edge (0 = square) */
  const slant=(S,t)=>{const[u,v]=ptL(S,t),th=Math.atan2(v,u),e=.01,p0=[R(th-e)*Math.cos(th-e),R(th-e)*Math.sin(th-e)],p1=[R(th+e)*Math.cos(th+e),R(th+e)*Math.sin(th+e)],tx=p1[0]-p0[0],tz=p1[1]-p0[1],tl=Math.hypot(tx,tz)||1;
    return Math.abs((S.fam?tx:tz)/tl)};
  /* a street end that is cut back stops at the nearest street of the other family that it crosses, at least 30 m from that street's own ends */
  const covers=(Q,t,m)=>t>Q.a0+m&&t<Q.a1-m;
  const trim=(S,end)=>{let best=null;for(const Q of P){if(Q.dead||Q.fam==S.fam||!covers(Q,S.c,22))continue;const t=Q.c;if(t<=S.a0+1||t>=S.a1-1)continue;
      const d=end?S.a1-t:t-S.a0;if(d>0&&(best==null||d<best.d))best={t,d}}
    if(!best){S.dead=1;return}if(end){S.a1=best.t;S.e1=0}else{S.a0=best.t;S.e0=0}if(S.a1-S.a0<34)S.dead=1};
  for(const S of P){if(S.main)continue;for(const end of[0,1]){if(S.dead)break;if((end?S.e1:S.e0)&&slant(S,end?S.a1:S.a0)>.68)trim(S,end)}}
  /* mouths on the edge closer than 36 m: the worse one is cut back */
  for(let it=0;it<3;it++){const M=[];for(const S of P)if(!S.dead)for(const end of[0,1])if(end?S.e1:S.e0){const t=end?S.a1:S.a0,w=toW(...ptL(S,t));M.push({S,end,x:w[0],z:w[1],sl:slant(S,t)})}
    let ch=0;for(let a=0;a<M.length;a++)for(let b=a+1;b<M.length;b++){const A=M[a],Bm=M[b];if(A.S===Bm.S||A.S.dead||Bm.S.dead)continue;if(Math.hypot(A.x-Bm.x,A.z-Bm.z)>36)continue;
      const k=A.S.main?Bm:Bm.S.main?A:(A.sl>Bm.sl?A:Bm);if(k.S.main)continue;if(k.end?k.S.e1:k.S.e0){trim(k.S,k.end);ch=1}}if(!ch)break}
  /* (batch 16) a short stub: an end on the edge less than 40 m past the last crossing makes two junctions too close for a car to stop between: it stops at that crossing */
  for(const S of P){if(S.main||S.dead)continue;for(const end of[0,1]){if(S.dead||!(end?S.e1:S.e0))continue;const te=end?S.a1:S.a0;if(P.some(Q=>!Q.dead&&Q.fam!=S.fam&&covers(Q,S.c,0)&&Math.abs(Q.c-te)<40&&Q.c>S.a0&&Q.c<S.a1))trim(S,end)}}
  /* (and a street that ends as a T on another less than 40 m from that one's mouth: its own end goes back to its last crossing) */
  for(const S of P){if(S.dead)continue;for(const end of[0,1]){if(!(end?S.e1:S.e0))continue;const te=end?S.a1:S.a0;for(const Q of P){if(Q.dead||Q.main||Q.fam==S.fam||Math.abs(Q.c-te)>=40)continue;for(const qe of[0,1])if(!Q.dead&&!(qe?Q.e1:Q.e0)&&Math.abs((qe?Q.a1:Q.a0)-S.c)<.01)trim(Q,qe)}}}
  /* a T end whose street was cut back or dropped: cut back again */
  for(let it=0;it<4;it++){let ch=0;for(const S of P){if(S.dead)continue;for(const end of[0,1]){if(S.dead||(end?S.e1:S.e0))continue;const t=end?S.a1:S.a0;
      if(!P.some(Q=>!Q.dead&&Q.fam!=S.fam&&Math.abs(Q.c-t)<.01&&covers(Q,S.c,20))){trim(S,end);ch=1}}}if(!ch)break}
  /* the edge street */
  const OP=[];for(let k=0;k<56;k++){const th=k*TAU/56,r=R(th);OP.push(toW(r*Math.cos(th),r*Math.sin(th)))}
  const per=buildRoad({id:id+'p',closed:1,hw:g.phw,lanes:1,style:3,city:1,cityField:1,lift:g.lift+.005,pts:OP});for(let i=0;i<per.n;i+=3)cityEnds.push([per.X[i],per.Z[i],per.id]);
  /* the streets, sampled every 25 m along the bent line */
  let idx=0;g.pieces=P.filter(S=>!S.dead);
  for(const S of g.pieces){const L=S.a1-S.a0,k=Math.max(2,Math.ceil(L/25)),pts=[];for(let q=0;q<=k;q++)pts.push(toW(...ptL(S,S.a0+L*q/k)));
    const r=buildRoad({id:id+S.tag+(P.filter(Q=>Q.tag==S.tag&&!Q.dead).length>1?'~'+Math.round(S.a0):''),hw:S.main?(o.mhw||6):g.hw,lanes:1,style:3,city:1,smooth:60,grade:.26,lift:g.lift+(idx++)*.0004,cityField:1,pts});
    S.r=r;g.roads.push(r);cityEnds.push([r.X[0],r.Z[0],r.id],[r.X[r.n-1],r.Z[r.n-1],r.id])}
  /* the box becomes the outline's bounds (everything that asks "is this in a district" still works) */
  {let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(let i=0;i<per.n;i++){x0=Math.min(x0,per.X[i]);x1=Math.max(x1,per.X[i]);z0=Math.min(z0,per.Z[i]);z1=Math.max(z1,per.Z[i])}B.x0=x0;B.x1=x1;B.z0=z0;B.z1=z1}
  g.box=B;g.per=per;const zn=ZONES.find(q=>q.b===B);if(zn)zn.shape=g;
  GRIDS.push(g);cityLand();return g}
/* a gate of a natural town: the edge end of the main street pointing most nearly along (dx,dz): {x,z,dx,dz} (dx,dz the street's own outward direction there) */
function townGate(g,dx,dz){let best=null;for(const S of g.pieces){if(!S.main)continue;const r=S.r;for(const e of[0,1]){if(S.edge&&!(e?S.e1:S.e0))continue;const ie=e?r.n-1:0,ib=e?r.n-4:3;let tx=r.X[ie]-r.X[ib],tz=r.Z[ie]-r.Z[ib];const l=Math.hypot(tx,tz)||1;tx/=l;tz/=l;
    if(S.edge&&g.per){/* a city: an end on the edge street (not on the avenue), scored by where it is as much as by where it points */const px=r.X[ie]-g.cx,pz=r.Z[ie]-g.cz,pl=Math.hypot(px,pz)||1;if(g.sd(r.X[ie],r.Z[ie])>4)continue;
      const s=.5*(tx*dx+tz*dz)+(px*dx+pz*dz)/pl;if(!best||s>best.s)best={s,x:r.X[ie],z:r.Z[ie],dx:tx,dz:tz};continue}
    const s=tx*dx+tz*dz;if(!best||s>best.s)best={s,x:r.X[ie],z:r.Z[ie],dx:tx,dz:tz}}}return best}
/* a point in a district zone: the outline of a natural town, the box of anything else */
const inZone=(x,z,zn,m)=>inBox(x,z,zn.b,m)&&(!zn.shape||zn.shape.ins(x,z,-m));
/* ===== batch 15: NATURAL CITIES =====
   A city is split by its main AVENUE (a straight boulevard from edge to edge through the centre: the Strip in Las Vegas) into two NEIGHBOURHOODS, each with its own street grid at its own
   angle and its own bend, meeting along the avenue (as the two grids of Downtown meet along Market Street). The outline is irregular as in a town (an ellipse with harmonics and arms
   to the gates); the edge street runs round it. Each neighbourhood's streets end on the avenue or on the edge street (or, at a slant, as a T on the last street they cross).
   Each neighbourhood is a GRIDS entry of the city's kind (the city builders fill its whole blocks; g.city is the city's id); the city itself is one more entry (kind 'cityedge') whose
   lots line the streets in the blocks the outline cuts, and whose outskirts thin out along the roads leading in (organicTown).
   o.avenue: {ang (its direction), hw, style, off (how far from the centre)}; o.hoods: [{ang, warp, du, dv, ou, ov}] for the left and the right side of the avenue. */
function makeOrganicCity(id,B,theme,o){
  const cx=(B.x0+B.x1)/2,cz=(B.z0+B.z1)/2,hx=(B.x1-B.x0)/2,hz=(B.z1-B.z0)/2;let sd0=0;for(const ch of id)sd0=sd0*31+ch.charCodeAt(0)|0;const rng=mulberry(9300+sd0);
  const A=o.avenue,ad=[Math.cos(A.ang),Math.sin(A.ang)],an=[-ad[1],ad[0]],aoff=A.off||0;
  const side=(x,z)=>(x-cx)*an[0]+(z-cz)*an[1]-aoff;                                  /* signed distance from the avenue's centre line */
  /* the outline (frame of the old box, no bend) */
  const ax=hx*(o.rk||.86),az=hz*(o.rk||.86),hm=[.06+rng()*.04,.05+rng()*.03,.025+rng()*.02],hp=[rng()*TAU,rng()*TAU,rng()*TAU],arm=o.arm==null?.16:o.arm;
  const gates=(o.gates||[]).map(([dx,dz,am])=>[Math.atan2(dz,dx),am==null?arm:am]);
  const R=th=>{const c=Math.cos(th),s=Math.sin(th);let r=1/Math.sqrt((c/ax)**2+(s/az)**2),f=1+hm[0]*Math.sin(2*th+hp[0])+hm[1]*Math.sin(3*th+hp[1])+hm[2]*Math.sin(5*th+hp[2]);
    for(const[gth,am]of gates){const d=angd(th,gth);f+=am*Math.exp(-((d/.42)**2))}return r*f};
  const sdO=(x,z)=>{const u=x-cx,v=z-cz;return R(Math.atan2(v,u))-Math.hypot(u,v)};
  const city={id,kind:'cityedge',theme,organic:1,cityOf:id,cx,cz,cs:Math.cos(A.ang),sn:Math.sin(A.ang),hw:o.hw||7.5,phw:o.phw||7,lift:o.lift||.05,roads:[],us:[],vs:[],hoods:[]};
  city.toL=(x,z)=>[x-cx,z-cz];city.toW=(u,v)=>[cx+u,cz+v];city.R=R;city.insL=(u,v,m)=>Math.hypot(u,v)<R(Math.atan2(v,u))-(m||0);
  city.ins=(x,z,m)=>sdO(x,z)>(m||0);city.sd=sdO;
  let rmax=0;for(let k=0;k<64;k++)rmax=Math.max(rmax,R(k*TAU/64));
  /* the avenue: where its line leaves the outline on both sides */
  const aEnd=sg=>{let t0=0,t1=rmax+50;const p=t=>[cx+an[0]*aoff+ad[0]*t*sg,cz+an[1]*aoff+ad[1]*t*sg];for(let k=0;k<30;k++){const m=(t0+t1)/2;if(sdO(...p(m))>0)t0=m;else t1=m}return p((t0+t1)/2)};
  const a0=aEnd(-1),a1=aEnd(1),aL=Math.hypot(a1[0]-a0[0],a1[1]-a0[1]),aN=Math.max(2,Math.ceil(aL/30)),AP=[];for(let q=0;q<=aN;q++)AP.push([lerp(a0[0],a1[0],q/aN),lerp(a0[1],a1[1],q/aN)]);
  /* a world point is in neighbourhood k (side +1 / -1) at least m metres inside (the avenue counts its own width) */
  const inHood=(sg,x,z,m)=>sdO(x,z)>m&&sg*side(x,z)>(m>0?m+(A.hw-city.phw):0);
  const P=[];let idx=0;
  (o.hoods||[]).forEach((H,k)=>{const sg=k?-1:1,cs=Math.cos(H.ang),sn=Math.sin(H.ang),wa=H.warp==null?8:H.warp,wk=TAU/(H.wl||520),ph=[0,1,2,3].map(()=>rng()*TAU);
    const ox=cx+an[0]*sg*(H.on||40)+ad[0]*(H.oa||0),oz=cz+an[1]*sg*(H.on||40)+ad[1]*(H.oa||0);   /* the grid's origin: inside its own side, so no street lies along the avenue */
    const warp=(u,v)=>[wa*Math.sin(v*wk+ph[0])+wa*.3*Math.sin((u+v)*wk*1.5+ph[1]),wa*Math.sin(u*wk*1.1+ph[2])+wa*.3*Math.sin((u-v)*wk*1.3+ph[3])];
    const toW=(u,v)=>{const w=warp(u,v),a=u+w[0],b=v+w[1];return[ox+a*cs-b*sn,oz+a*sn+b*cs]};
    const toL=(x,z)=>{const a=(x-ox)*cs+(z-oz)*sn,b=-(x-ox)*sn+(z-oz)*cs;let u=a,v=b;for(let q=0;q<4;q++){const w=warp(u,v);u=a-w[0];v=b-w[1]}return[u,v]};
    const spread=d=>{const L=[0];for(const s of[1,-1]){let p=0;for(;;){p+=d*(.88+rng()*.24);if(p>rmax*1.5)break;L.push(s*p)}}return L.sort((a,b)=>a-b)};
    const g={id:id+(k?'b':'a'),city:id,kind:o.kind,theme,organic:1,ang:H.ang,cs,sn,toW,toL,hw:city.hw,phw:city.phw,lift:city.lift,roads:[],us:spread(H.du),vs:spread(H.dv)};
    g.insL=(u,v,m)=>{const w=toW(u,v);return inHood(sg,w[0],w[1],m||0)};g.R=null;g.rrL=(u,v)=>{const w=toW(u,v);return Math.hypot(w[0]-cx,w[1]-cz)/R(Math.atan2(w[1]-cz,w[0]-cx))};
    g.us=g.us.filter(u=>{for(let t=-rmax*1.6;t<rmax*1.6;t+=20)if(g.insL(u,t,0))return true;return false});g.vs=g.vs.filter(v=>{for(let t=-rmax*1.6;t<rmax*1.6;t+=20)if(g.insL(t,v,0))return true;return false});
    const pieces=(fam,c)=>{const pt=t=>fam?[t,c]:[c,t],inn=t=>g.insL(...pt(t),0),out=[];let a=null;const st=3,L=rmax*1.6;
      const edge=(t0,t1)=>{const i0=inn(t0);for(let q=0;q<24;q++){const m=(t0+t1)/2;if(inn(m)===i0)t0=m;else t1=m}return(t0+t1)/2};
      for(let t=-L;t<=L;t+=st){const i=inn(t);if(i&&a==null)a=edge(t-st,t);if(!i&&a!=null){out.push([a,edge(t-st,t)]);a=null}}return out};
    const SP=[];g.us.forEach((u,i)=>{for(const[p0,p1]of pieces(0,u))SP.push({g,fam:0,c:u,a0:p0,a1:p1,e0:1,e1:1,tag:'u'+i})});g.vs.forEach((v,j)=>{for(const[p0,p1]of pieces(1,v))SP.push({g,fam:1,c:v,a0:p0,a1:p1,e0:1,e1:1,tag:'v'+j})});
    g.SP=SP;g.sg=sg;city.hoods.push(g);P.push(...SP)});
  const ptL=(S,t)=>S.fam?[t,S.c]:[S.c,t],wAt=(S,t)=>S.g.toW(...ptL(S,t));
  /* how squarely an end meets what it ends on (the avenue or the edge): |sin| of the angle between them, 0 = square */
  const slant=(S,t)=>{const p=wAt(S,t),q=wAt(S,t+(S.a1>t?-1:1)),tx=p[0]-q[0],tz=p[1]-q[1],tl=Math.hypot(tx,tz)||1;let nx,nz;
    if(Math.abs(side(...p))<2){nx=an[0];nz=an[1]}else{nx=sdO(p[0]+1,p[1])-sdO(p[0]-1,p[1]);nz=sdO(p[0],p[1]+1)-sdO(p[0],p[1]-1)}const nl=Math.hypot(nx,nz)||1,c=(tx*nx+tz*nz)/tl/nl;return Math.sqrt(Math.max(0,1-c*c))};
  const covers=(Q,t,m)=>t>Q.a0+m&&t<Q.a1-m;
  const trim=(S,end)=>{let best=null;for(const Q of S.g.SP){if(Q.dead||Q.fam==S.fam||!covers(Q,S.c,22))continue;const t=Q.c;if(t<=S.a0+1||t>=S.a1-1)continue;const d=end?S.a1-t:t-S.a0;if(d>0&&(best==null||d<best.d))best={t,d}}
    if(!best){S.dead=1;return}if(end){S.a1=best.t;S.e1=0}else{S.a0=best.t;S.e0=0}if(S.a1-S.a0<40)S.dead=1};
  for(const S of P)for(const end of[0,1]){if(S.dead)break;if((end?S.e1:S.e0)&&slant(S,end?S.a1:S.a0)>.68)trim(S,end)}
  /* mouths on the avenue or the edge closer than 36 m (ends from the two sides of the avenue within 4 m of each other make one crossroads: kept) */
  /* (two ends on the avenue from its two sides 4-22 m apart: the worse one bends its last stretch to meet the other, one crossroads) */
  for(let it=0;it<4;it++){const M=[];for(const S of P)if(!S.dead)for(const end of[0,1])if(end?S.e1:S.e0){const t=end?S.a1:S.a0,sn_=S['snap'+end],w=sn_||wAt(S,t);M.push({S,end,x:w[0],z:w[1],sl:slant(S,t),av:Math.abs(side(w[0],w[1]))<2,sn:!!sn_})}
    for(const p of[a0,a1])M.push({S:null,x:p[0],z:p[1],sl:0});
    let ch=0;for(let a=0;a<M.length;a++)for(let b=a+1;b<M.length;b++){const P1=M[a],P2=M[b];if(P1.S&&P1.S===P2.S)continue;if((P1.S&&P1.S.dead)||(P2.S&&P2.S.dead))continue;const d=Math.hypot(P1.x-P2.x,P1.z-P2.z);if(d>36)continue;
      if(d<4&&P1.S&&P2.S&&P1.S.g!==P2.S.g)continue;
      if(d<=22&&P1.S&&P2.S&&P1.S.g!==P2.S.g&&P1.av&&P2.av&&!P1.sn&&!P2.sn){const k=P1.sl>P2.sl?P1:P2,o2=k===P1?P2:P1;k.S['snap'+k.end]=[o2.x,o2.z];k.sn=1;ch=1;continue}
      const k=!P1.S?P2:!P2.S?P1:(P1.sl>P2.sl?P1:P2);if(k.end?k.S.e1:k.S.e0){trim(k.S,k.end);ch=1}}if(!ch)break}
  for(const S of P){if(S.dead)continue;for(const end of[0,1]){if(S.dead||!(end?S.e1:S.e0))continue;const te=end?S.a1:S.a0;if(S.g.SP.some(Q=>!Q.dead&&Q.fam!=S.fam&&covers(Q,S.c,0)&&Math.abs(Q.c-te)<40&&Q.c>S.a0&&Q.c<S.a1))trim(S,end)}}   /* (short stubs, as in the towns) */
  for(const S of P){if(S.dead)continue;for(const end of[0,1]){if(!(end?S.e1:S.e0))continue;const te=end?S.a1:S.a0;for(const Q of S.g.SP){if(Q.dead||Q.fam==S.fam||Math.abs(Q.c-te)>=40)continue;for(const qe of[0,1])if(!Q.dead&&!(qe?Q.e1:Q.e0)&&Math.abs((qe?Q.a1:Q.a0)-S.c)<.01)trim(Q,qe)}}}
  for(let it=0;it<4;it++){let ch=0;for(const S of P){if(S.dead)continue;for(const end of[0,1]){if(S.dead||(end?S.e1:S.e0))continue;const t=end?S.a1:S.a0;
      if(!S.g.SP.some(Q=>!Q.dead&&Q.fam!=S.fam&&Math.abs(Q.c-t)<.01&&covers(Q,S.c,20))){trim(S,end);ch=1}}}if(!ch)break}
  /* build: the edge street, the avenue, the streets */
  const OP=[];for(let k=0;k<72;k++){const th=k*TAU/72,r=R(th);OP.push([cx+r*Math.cos(th),cz+r*Math.sin(th)])}
  const per=buildRoad({id:id+'p',closed:1,hw:city.phw,lanes:2,style:3,city:1,cityField:1,lift:city.lift+.005,pts:OP});for(let i=0;i<per.n;i+=3)cityEnds.push([per.X[i],per.Z[i],per.id]);
  const av=buildRoad({id:id+'m',hw:A.hw,lanes:2,style:A.style==null?4:A.style,city:1,cityField:1,lift:city.lift+.003,pts:AP});cityEnds.push([av.X[0],av.Z[0],av.id],[av.X[av.n-1],av.Z[av.n-1],av.id]);
  city.roads.push(av);city.av=av;
  for(const g of city.hoods){g.pieces=g.SP.filter(S=>!S.dead);for(const S of g.pieces){const L=S.a1-S.a0,k=Math.max(2,Math.ceil(L/25)),pts=[];for(let q=0;q<=k;q++)pts.push(g.toW(...ptL(S,S.a0+L*q/k)));if(S.snap0)pts[0]=S.snap0;if(S.snap1)pts[k]=S.snap1;
      const r=buildRoad({id:g.id+S.tag+(g.SP.filter(Q=>Q.tag==S.tag&&!Q.dead).length>1?'~'+Math.round(S.a0):''),hw:city.hw,lanes:1,style:3,city:1,smooth:60,grade:.26,lift:city.lift+(idx++)*.0004,cityField:1,pts});
      S.r=r;g.roads.push(r);city.roads.push(r);cityEnds.push([r.X[0],r.Z[0],r.id],[r.X[r.n-1],r.Z[r.n-1],r.id])}}
  city.hoods[0].roads.push(av);   /* (the avenue's palms and lamps come with the first neighbourhood) */
  {let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(let i=0;i<per.n;i++){x0=Math.min(x0,per.X[i]);x1=Math.max(x1,per.X[i]);z0=Math.min(z0,per.Z[i]);z1=Math.max(z1,per.Z[i])}B.x0=x0;B.x1=x1;B.z0=z0;B.z1=z1}
  city.box=B;city.per=per;for(const g of city.hoods){g.box=B;g.per=per}const zn=ZONES.find(q=>q.b===B);if(zn)zn.shape=city;
  /* the gates: the avenue's ends and every street end on the edge */
  city.pieces=[];for(const g of city.hoods)for(const S of g.pieces)if(S.e0||S.e1)city.pieces.push({main:1,r:S.r,e0:S.e0,e1:S.e1,edge:1});city.pieces.push({main:1,r:av,e0:1,e1:1,edge:1});
  for(const g of city.hoods)GRIDS.push(g);GRIDS.push(city);cityLand();return city}
