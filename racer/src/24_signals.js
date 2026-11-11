'use strict';
/* ===== traffic lights (world 1d): a controller at every junction where roads cross or meet, two phases, cars stop at the line and queue =====
   An APPROACH is one road direction arriving at a junction (a junction group of the lane graph, LG.jg). Approaches whose groups lie within 24 m of each other form one INTERSECTION.
   Phase 0 holds the approaches along the main road's axis (the highest road class), phase 1 the ones across it. An intersection gets a light when it has three or more approaches and both phases;
   where the main road is a highway (class 3) the side roads just give way, as before. Cycle: green, yellow (3 s, 3.5 on main roads), all red (1.2 s), then the other phase.
   The main road gets 14 s of green and the cross street 9 s when it is the bigger road, 11 / 11 when they are equal. Each intersection starts at its own offset (a hash).
   The stop line is where the first turn of the group starts (g.minFu): 3 m before the crossing road's asphalt. Time is SIG.t (advanced by worldStep), so everything is deterministic.
   Pure data plus two small functions the traffic and the renderer call; the poles and heads are props (buildFurniture), the lit lamps are glow sprites (41_fx.js). */
const SIG={t:0,I:[],heads:[],nAp:0};
function sigHash(a){let h=Math.imul(a|0,2654435761)^0x5bd1e995;h=Math.imul(h^(h>>>15),2246822519);return((h^(h>>>13))>>>0)/4294967296}
function sigBuild(){
  SIG.I.length=0;SIG.heads.length=0;SIG.nAp=0;const ap=[];
  ROADS.forEach((r,ri)=>{const o=LG.ofRoad[ri];if(!o)return;
    for(let di=0;di<2;di++){const G=LG.jg[ri*2+di];if(!G)continue;
      for(const g of G){g.sig=null;if(g.links.every(l=>l.kind==3))continue;const e=g.e0,ix=di==0?g.foot:r.n-1-g.foot;if(ix<0||ix>=r.n)continue;
        let toFoot=e.S[Math.min(e.n-1,g.foot)]-e.S[g.minFu];if(toFoot<0&&e.closed)toFoot+=e.len;if(toFoot<0||toFoot>40)continue;
        const t=lgTan(e,g.minFu);ap.push({g,r,ri,di,e,x:r.X[ix],z:r.Z[ix],ax:Math.atan2(t[1],t[0]),tx:t[0],tz:t[1],cls:e.cls,su:g.minFu})}}});
  /* group approaches into intersections (greedy, by the junction point) */
  const done=new Uint8Array(ap.length);
  for(let a=0;a<ap.length;a++){if(done[a])continue;const L=[ap[a]];done[a]=1;let cx=ap[a].x,cz=ap[a].z;
    for(let b=a+1;b<ap.length;b++){if(done[b])continue;if(Math.hypot(ap[b].x-cx,ap[b].z-cz)<24){done[b]=1;L.push(ap[b]);cx=(cx*(L.length-1)+ap[b].x)/L.length;cz=(cz*(L.length-1)+ap[b].z)/L.length}}
    if(L.length<3)continue;
    let main=L[0];for(const p of L)if(p.cls>main.cls)main=p;if(main.cls>=3)continue;
    const axd=p=>{let d=Math.abs(angd(p.ax,main.ax));if(d>Math.PI/2)d=Math.PI-d;return d};
    for(const p of L)p.ph=axd(p)<Math.PI/4?0:1;
    const n0=L.filter(p=>p.ph==0).length;if(n0==0||n0==L.length)continue;
    const c0=Math.max(...L.filter(p=>p.ph==0).map(p=>p.cls)),c1=Math.max(...L.filter(p=>p.ph==1).map(p=>p.cls));
    const I={id:SIG.I.length,x:cx,z:cz,ap:L,g0:c0>c1?14:11,g1:c0>c1?9:11,Y:c0>=2?3.5:3,AR:1.2};I.T=I.g0+I.g1+2*(I.Y+I.AR);I.off=sigHash(I.id*7+Math.round(cx)+Math.round(cz)*3)*I.T;
    for(const p of L){p.g.sig={I,ph:p.ph};SIG.nAp++}SIG.I.push(I)}
  return{intersections:SIG.I.length,approaches:SIG.nAp}}
/* 0 green, 1 yellow, 2 red for phase ph of intersection I at time t */
function sigState(s,t){const I=s.I,k=((((t==null?SIG.t:t)+I.off)%I.T)+I.T)%I.T,a=I.g0+I.Y+I.AR;
  if(s.ph==0)return k<I.g0?0:k<I.g0+I.Y?1:2;
  return k<a?2:k<a+I.g1?0:k<a+I.g1+I.Y?1:2}
/* the poles and heads, placed once the props are being built: a pole on the right-hand corner of each approach at the stop line with a head at 2.8 m, and an arm reaching over the road with a
   second head at 5.6 m. heads: [x,y,z, facing x,z, intersection, phase] (two per approach) for the lit lamps */
function sigProps(){SIG.heads.length=0;
  for(const I of SIG.I)for(const p of I.ap){const r=p.r,ix=p.di==0?p.su:r.n-1-p.su;if(ix<0||ix>=r.n)continue;const nx=-p.tz,nz=p.tx,hw=r.hw*r.wk[ix],off=hw+(r.sw?.9:RSH*.75),y=r.Y[ix]+(r.sw?CURB_H:-.1);
    const px=r.X[ix]+nx*off,pz=r.Z[ix]+nz*off;if(otherAsphalt(px,pz,r,r.Y[ix],.2))continue;
    const fx=-p.tx,fz=-p.tz,arm=clamp(off-hw*.45,2,8),ax=px-nx*arm,az=pz-nz*arm;
    ptrunk(0,px,y-.3,pz,.11,6.1,96,100,104);pbar(0,px,y+5.95,pz,ax,y+5.95,az,.12,96,100,104);COLC.push(px,pz,.25,y-.5,y+6);
    for(const[hx,hy,hz]of[[ax,y+5.35,az],[px-nx*.25,y+2.8,pz-nz*.25]]){
      pboxR(0,hx,hz,.15,.19,-nz,nx,hy-.55,hy+.55,30,32,34,false,1);                                   /* the housing: 0.38 m wide, 1.1 m tall */
      for(const dy of[.34,0,-.34])pboxR(0,hx+fx*.15,hz+fz*.15,.03,.13,-nz,nx,hy+dy-.13,hy+dy+.13,14,14,16,false,1);   /* three dark lenses (the lit one is a glow sprite) */
      SIG.heads.push(hx+fx*.24,hy,hz+fz*.24,fx,fz,I.id,p.ph)}}
  return SIG.heads.length/7}
