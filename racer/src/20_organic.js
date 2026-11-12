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
  const gates=(o.gates||[]).map(([dx,dz])=>{const a=dx*cs+dz*sn,b=-dx*sn+dz*cs;return Math.abs(a)>Math.abs(b)?(a>0?0:Math.PI):(b>0?Math.PI/2:-Math.PI/2)});
  const R=th=>{const c=Math.cos(th),s=Math.sin(th);let r=1/Math.sqrt((c/ax)**2+(s/az)**2);let f=1+hm[0]*Math.sin(2*th+hp[0])+hm[1]*Math.sin(3*th+hp[1])+hm[2]*Math.sin(5*th+hp[2]);
    for(const gth of gates){const d=angd(th,gth);f+=arm*Math.exp(-((d/.42)**2))}return r*f};
  const ins=(u,v,m)=>Math.hypot(u,v)<R(Math.atan2(v,u))-(m||0);
  const g={id,kind:'town',theme,organic:1,ang,cs,sn,toW,toL,R,insL:ins,cx,cz,hw:o.hw||5.5,phw:o.phw||6,lift:o.lift||.05,roads:[],us:[],vs:[]};
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
function townGate(g,dx,dz){let best=null;for(const S of g.pieces){if(!S.main)continue;const r=S.r;for(const e of[0,1]){const ie=e?r.n-1:0,ib=e?r.n-4:3;let tx=r.X[ie]-r.X[ib],tz=r.Z[ie]-r.Z[ib];const l=Math.hypot(tx,tz)||1;tx/=l;tz/=l;
    const s=tx*dx+tz*dz;if(!best||s>best.s)best={s,x:r.X[ie],z:r.Z[ie],dx:tx,dz:tz}}}return best}
/* a point in a district zone: the outline of a natural town, the box of anything else */
const inZone=(x,z,zn,m)=>inBox(x,z,zn.b,m)&&(!zn.shape||zn.shape.ins(x,z,-m));
