'use strict';
/* ===== the lane graph: a centre-line per lane per direction for every road, and a short curve (a LINK) for every turn at every junction =====
   Lane geometry comes from laneInfo(hw,style) in 00_util.js, the same function the road shader paints its lines with, so the AI lanes sit exactly between the painted lines.
   Right-hand traffic: with n=(-tz,tx), +n is the right-hand side of a vehicle that drives along the road's index direction (so lanes of direction -1 sit on the -n side).
   An EDGE is one lane of one road in one direction, stored in TRAVEL order (the index grows the way cars drive). A LINK leaves an edge at index fu, curves, and joins another edge at index tu.
   Junctions: a road END that touches another road (T, ramp, end to end) and two roads that cross at the same level. Patches (Lombard Street, the pier) get no lanes.
   Pure data, no GL, deterministic (plain arithmetic only). */
const LG={edges:[],links:[],ofRoad:[],stat:{},ready:false};
const LG_ALAT=3.2,LG_ALATT=3.0;                         /* comfortable lateral acceleration (m/s^2) on lanes and on turns */
const lgDirI=d=>d>0?0:1;
/* speed limit (m/s) and class (3 highway, 2 main road, 1 street) of a road */
function lgLimit(r){if(r.city)return r.style==4?[16,2]:[12.5,1];if(r.style==1)return[r.hw>=12?30:28,3];if(r.hw>=8)return[21,2];return[r.hw>=6.5?18:15,1]}
function lgTan(e,i){const n=e.n,a=e.closed?(i+1)%n:Math.min(n-1,i+1),b=e.closed?(i+n-1)%n:Math.max(0,i-1);let tx=e.X[a]-e.X[b],tz=e.Z[a]-e.Z[b];const l=Math.hypot(tx,tz)||1;return[tx/l,tz/l]}
/* comfortable speed along a polyline: the limit, lowered by curvature (circle through three points about 8 m apart) and by steep grades */
function lgSpeeds(X,Z,Y,n,closed,lim,alat,K){
  K=K||2;const V=new Float32Array(n);
  for(let i=0;i<n;i++){let a=i-K,b=i+K;if(closed){a=(a%n+n)%n;b=b%n}else{a=a<0?0:a;b=b>n-1?n-1:b}
    const ax=X[a],az=Z[a],bx=X[i],bz=Z[i],cx=X[b],cz=Z[b],ab=Math.hypot(bx-ax,bz-az),bc=Math.hypot(cx-bx,cz-bz),ca=Math.hypot(ax-cx,az-cz),A2=Math.abs((bx-ax)*(cz-az)-(bz-az)*(cx-ax));
    let v=lim;if(A2>1e-4&&ab>.1&&bc>.1){const R=ab*bc*ca/(2*A2);v=Math.min(v,Math.sqrt(alat*R))}
    const g=ca>.1?Math.abs(Y[b]-Y[a])/ca:0;if(g>.16)v=Math.min(v,Math.max(5,12-(g-.16)*40));
    V[i]=Math.max(3,v)}
  /* look a little ahead and behind: the slowest sample of +-2 wins, so cars start braking before the bend */
  const W=new Float32Array(n);for(let i=0;i<n;i++){let m=V[i];for(let k=-2;k<=2;k++){let j=i+k;if(closed)j=(j%n+n)%n;else if(j<0||j>=n)continue;if(V[j]<m)m=V[j]}W[i]=m}
  return W}
function lgMkEdge(r,ri,dir,k,li,lim){
  const n=r.n,off=li.x0+(k+.5)*li.lw,X=new Float32Array(n),Z=new Float32Array(n),Y=new Float32Array(n),S=new Float32Array(n);
  for(let j=0;j<n;j++){const i=dir>0?j:n-1-j,t=_tan(r,i),nx=-t[1]*dir,nz=t[0]*dir;X[j]=r.X[i]+nx*off;Z[j]=r.Z[i]+nz*off;Y[j]=r.Y[i]+off*dir*(r.cf?r.cf[i]:0)}
  for(let j=1;j<n;j++)S[j]=S[j-1]+Math.hypot(X[j]-X[j-1],Z[j]-Z[j-1]);
  const len=S[n-1]+(r.closed?Math.hypot(X[0]-X[n-1],Z[0]-Z[n-1]):0);
  const e={id:LG.edges.length,ri,road:r,dir,k,nl:li.nl,n,closed:r.closed,X,Z,Y,S,len,V:lgSpeeds(X,Z,Y,n,r.closed,lim[0],LG_ALAT),lim:lim[0],cls:lim[1],out:[],ds:len/(r.closed?n:n-1),hw:r.hw};
  LG.edges.push(e);return e}
/* a turn: a cubic curve from edge A at index fu to edge B at index tu (tangents follow the lanes); kind 0 straight/merge, 1 right, 2 left, 3 u-turn */
function lgLink(A,fu,foot,B,tu,kind){
  const key=A.id+':'+fu+':'+B.id+':'+tu;if(LG._seen.has(key))return null;LG._seen.add(key);
  const ta=lgTan(A,fu),tb=lgTan(B,tu),p0x=A.X[fu],p0z=A.Z[fu],p3x=B.X[tu],p3z=B.Z[tu],ch=Math.hypot(p3x-p0x,p3z-p0z),c=kind==3?ch*.5+9:ch*.4;
  if(ch<4){(LG.dropped||(LG.dropped=[])).push(A.road.id+(A.dir>0?'+':'-')+A.k+'->'+B.road.id+(B.dir>0?'+':'-')+B.k+' ch'+ch.toFixed(1)+' kind'+kind+' fu'+fu+'/'+A.n+' tu'+tu+'/'+B.n);return null}                                    /* the two ends coincide (a street that ends on top of another road's lanes): no usable turn */
  const p1x=p0x+ta[0]*c,p1z=p0z+ta[1]*c,p2x=p3x-tb[0]*c,p2z=p3z-tb[1]*c,m=Math.max(4,Math.ceil(ch*1.25/4)),n=m+1;
  const X=new Float32Array(n),Z=new Float32Array(n),Y=new Float32Array(n),S=new Float32Array(n);
  for(let j=0;j<n;j++){const t=j/m,u=1-t,b0=u*u*u,b1=3*u*u*t,b2=3*u*t*t,b3=t*t*t;X[j]=b0*p0x+b1*p1x+b2*p2x+b3*p3x;Z[j]=b0*p0z+b1*p1z+b2*p2z+b3*p3z;Y[j]=A.Y[fu]+(B.Y[tu]-A.Y[fu])*t;if(j)S[j]=S[j-1]+Math.hypot(X[j]-X[j-1],Z[j]-Z[j-1])}
  const lim=Math.min(A.lim,B.lim,kind==0?99:11);
  const L={id:LG.links.length,from:A,fu,foot,to:B,tu,kind,n,X,Z,Y,S,len:S[n-1],V:lgSpeeds(X,Z,Y,n,false,lim,LG_ALATT,1),jg:null};
  LG.links.push(L);A.out.push(L);return L}
/* all turns from road X (driving direction dx, junction at road sample fx) onto road Y (direction dy, junction at sample fy) */
function lgTurn(X,dx,fx,Y,dy,fy){
  const ax=LG.ofRoad[X.ri][lgDirI(dx)],ay=LG.ofRoad[Y.ri][lgDirI(dy)];if(!ax||!ay||!ax.length||!ay.length)return;
  const nx=X.n,ny=Y.n,ix=dx>0?fx:nx-1-fx,iy=dy>0?fy:ny-1-fy,tx=_tan(X,fx),ty=_tan(Y,fy),ux=tx[0]*dx,uz=tx[1]*dx,vx=ty[0]*dy,vz=ty[1]*dy;
  const ang=Math.atan2(ux*vz-uz*vx,ux*vx+uz*vz);if(Math.abs(ang)>2.6)return;            /* ang>0: the exit is to the right of the way we are heading */
  const dt=ux*vx+uz*vz,par=dt>0?dt*dt:0;                                                  /* 1 when the two roads run side by side (ramps): long gentle curves */
  let ai=Math.round(Math.max(6,lerp(Y.hw+3,18,par))/X.ds),bi=Math.round(Math.max(6,lerp(X.hw+3,18,par))/Y.ds);   /* (there are no ramps any more: straight on across a junction is a short link, it used to be 100 m long and counted as a turn) */
  const nlx=ax.length,nly=ay.length,end=!X.closed&&ix>=nx-3;
  let fu,tu;
  /* the two ends of the curve must not nearly coincide (an acute T onto a diagonal road): move them further away from the junction until the curve is at least 8 m long */
  for(let it=0;it<8;it++){
    if(X.closed)fu=((ix-ai)%nx+nx)%nx;else{if(ix-ai<2)ai=ix-2;if(ai<2)return;fu=ix-ai}
    if(Y.closed)tu=(iy+bi)%ny;else{if(iy+bi>ny-3)bi=ny-3-iy;if(bi<2)return;tu=iy+bi}
    const A0=ax[nlx-1],B0=ay[nly-1];if(Math.hypot(B0.X[tu]-A0.X[fu],B0.Z[tu]-A0.Z[fu])>=8)break;
    if(it==7)break;ai+=2;bi+=2}
  let cat=ang>.42?1:ang<-.42?2:0,lat=0;
  if(cat==0){/* straight on, or a ramp that runs alongside: which side of us is the exit? */
    const sx=dx>0?fx-ai:fx+ai,sy=dy>0?fy+bi:fy-bi,qx=((sx%nx)+nx)%nx,qy=((sy%ny)+ny)%ny,cx=X.closed?qx:Math.max(0,Math.min(nx-1,sx)),cy=Y.closed?qy:Math.max(0,Math.min(ny-1,sy));
    lat=(Y.X[cy]-X.X[cx])*(-uz)+(Y.Z[cy]-X.Z[cx])*ux;if(lat>3.5)cat=1;else if(lat<-3.5)cat=2}
  const highway=(X.style==1&&!X.city)||(Y.style==1&&!Y.city);
  if(cat==2&&highway&&!LG._box)return;                                                    /* no left turns across a highway's median, except at a junction box (where a road ends on it: the median is open there) */
  const left=k=>end?k<Math.ceil(nlx/2):k==0,right=k=>end?k>=Math.floor(nlx/2):k==nlx-1;
  for(let k=0;k<nlx;k++){
    if(cat==1&&!right(k))continue;if(cat==2&&!left(k))continue;
    const A=ax[k];let kk=0;
    if(cat==0)kk=Math.min(k,nly-1);
    else{let bd=1e18;for(let q=0;q<nly;q++){const B=ay[q],d=(B.X[tu]-A.X[fu])**2+(B.Z[tu]-A.Z[fu])**2;if(d<bd){bd=d;kk=q}}}
    lgLink(A,fu,ix,ay[kk],tu,cat)}}
function lgBuild(){
  const t0=typeof performance!=='undefined'?performance.now():0;
  LG.edges.length=0;LG.links.length=0;LG.ofRoad=[];LG._seen=new Set();
  ROADS.forEach((r,ri)=>{r.ri=ri;if(r.style==2){LG.ofRoad[ri]=null;return}
    const li=laneInfo(r.hw,r.style),lim=lgLimit(r),o=[[],[]];
    for(const dir of[1,-1])for(let k=0;k<li.nl;k++)o[lgDirI(dir)].push(lgMkEdge(r,ri,dir,k,li,lim));
    LG.ofRoad[ri]=o});
  /* ---- spatial hash of road samples (touches) and segments (crossings) ---- */
  const cell=48,H=new Map(),key=(a,b)=>(a+2048)*8192+(b+2048);
  ROADS.forEach((r,ri)=>{if(!LG.ofRoad[ri])return;for(let i=0;i<r.n;i++){const k=key(Math.floor(r.X[i]/cell),Math.floor(r.Z[i]/cell));let L=H.get(k);if(!L)H.set(k,L=[]);L.push(ri,i)}});
  const touches=[],tseen=new Set(),mism=[];
  ROADS.forEach((B,bi)=>{if(!LG.ofRoad[bi]||B.closed)return;
    for(const e of[0,B.n-1]){const x=B.X[e],z=B.Z[e],cx=Math.floor(x/cell),cz=Math.floor(z/cell),hit=new Map(),any=new Map();
      for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const L=H.get(key(cx+a,cz+b));if(!L)continue;
        for(let q=0;q<L.length;q+=2){const ri=L[q];if(ri===bi)continue;const A=ROADS[ri],j=L[q+1],d=Math.hypot(A.X[j]-x,A.Z[j]-z);
          if(d<A.hw+B.hw+RSH+2.5){const h0=any.get(ri);if(!h0||d<h0.d)any.set(ri,{A,j,d});if(Math.abs(A.Y[j]-B.Y[e])<3.5){const h=hit.get(ri);if(!h||d<h.d)hit.set(ri,{A,j,d})}}}}
      for(const[ri,h0]of any)if(!hit.has(ri)&&Math.abs(h0.A.Y[h0.j]-B.Y[e])<60)mism.push(B.id+(e?' end':' start')+' vs '+h0.A.id+' dY '+(B.Y[e]-h0.A.Y[h0.j]).toFixed(1));
      /* every road this end touches (three roads can meet at one point) */
      for(const best of hit.values()){
        /* two road ends that touch each other are one junction, not two */
        const A=best.A,aEnd=!A.closed&&(best.j<=1||best.j>=A.n-2);
        if(aEnd){const k1=Math.min(A.ri,bi)+'.'+Math.max(A.ri,bi)+'.'+Math.round(x/20)+'.'+Math.round(z/20);if(tseen.has(k1))continue;tseen.add(k1)}
        touches.push({B,e,A,j:best.j})}}});
  LG._box=true;
  for(const t of touches){const{B,e,A,j}=t,out=e==B.n-1?-1:1;     /* B leaves the junction in direction `out` and arrives in direction -out */
    for(const dA of[1,-1]){lgTurn(A,dA,j,B,out,e);lgTurn(B,-out,e,A,dA,j)}}
  LG._box=false;
  /* ---- crossings at the same level ---- */
  const sc=96,SG=new Map();
  ROADS.forEach((r,ri)=>{if(!LG.ofRoad[ri])return;const c=r.closed?r.n:r.n-1;
    for(let i=0;i<c;i++){const j=(i+1)%r.n,x0=Math.min(r.X[i],r.X[j]),x1=Math.max(r.X[i],r.X[j]),z0=Math.min(r.Z[i],r.Z[j]),z1=Math.max(r.Z[i],r.Z[j]);
      for(let a=Math.floor(x0/sc);a<=Math.floor(x1/sc);a++)for(let b=Math.floor(z0/sc);b<=Math.floor(z1/sc);b++){const k=key(a,b);let L=SG.get(k);if(!L)SG.set(k,L=[]);L.push(ri,i)}}});
  const cseen=new Map();let nCross=0;
  const segT=(ax,az,bx,bz,cx,cz,dx,dz)=>{const den=(bx-ax)*(dz-cz)-(bz-az)*(dx-cx);if(Math.abs(den)<1e-9)return null;const t=((cx-ax)*(dz-cz)-(cz-az)*(dx-cx))/den,u=((cx-ax)*(bz-az)-(cz-az)*(bx-ax))/den;return(t>=0&&t<=1&&u>=0&&u<=1)?[t,u]:null};
  for(const L of SG.values())for(let p=0;p<L.length;p+=2)for(let q=p+2;q<L.length;q+=2){const ra=L[p],rb=L[q];if(ra===rb)continue;const A=ROADS[ra],B=ROADS[rb],ia=L[p+1],ib=L[q+1],ja=(ia+1)%A.n,jb=(ib+1)%B.n;
    const h=segT(A.X[ia],A.Z[ia],A.X[ja],A.Z[ja],B.X[ib],B.Z[ib],B.X[jb],B.Z[jb]);if(!h)continue;
    const fa=ia+h[0],fb=ib+h[1],ya=A.Y[ia]+(A.Y[ja]-A.Y[ia])*h[0],yb=B.Y[ib]+(B.Y[jb]-B.Y[ib])*h[1];if(Math.abs(ya-yb)>3.5)continue;
    if(!A.closed&&(fa<4||fa>A.n-5))continue;if(!B.closed&&(fb<4||fb>B.n-5))continue;          /* near an end: that is a touch */
    const px=A.X[ia]+(A.X[ja]-A.X[ia])*h[0],pz=A.Z[ia]+(A.Z[ja]-A.Z[ia])*h[0],pk=Math.min(ra,rb)*4096+Math.max(ra,rb);let ps=cseen.get(pk);if(!ps)cseen.set(pk,ps=[]);
    let dup=false;for(let s=0;s<ps.length;s+=2)if(Math.hypot(ps[s]-px,ps[s+1]-pz)<18){dup=true;break}if(dup)continue;ps.push(px,pz);nCross++;
    const FA=Math.round(fa)%A.n,FB=Math.round(fb)%B.n;
    for(const dA of[1,-1])for(const dB of[1,-1]){lgTurn(A,dA,FA,B,dB,FB);lgTurn(B,dB,FB,A,dA,FA)}}
  /* ---- median crossovers: highways get a U-turn gap every 500 m or so (like real divided roads), so a car can change carriageway and reach the roads on the other side ---- */
  let nX=0;
  ROADS.forEach((r,ri)=>{const o=LG.ofRoad[ri];if(!o||r.style!=1||r.city)return;const step=Math.round(520/r.ds),n=r.n;
    const feet=[];for(const e of o[0])for(const l of e.out)feet.push(l.foot);for(const e of o[1])for(const l of e.out)feet.push(n-1-l.foot);
    const near=i=>{for(const f of feet)if(Math.abs(f-i)<16)return true;return false};
    for(let i=Math.round(step*.6);i<n-(r.closed?0:step*.5);i+=step){let p=-1;
      for(let d=0;d<step*.4&&p<0;d+=3)for(const c of[i+d,i-d]){if(c<14||c>n-15)continue;if(near(c)||r.br[c])continue;const e0=o[0][0];if(e0.V[c]<e0.lim*.9)continue;p=c;break}
      if(p<0)continue;
      for(let di=0;di<2;di++){const dir=di?-1:1,e=o[di][0],op=o[1-di][0],ix=dir>0?p:n-1-p,ox=dir>0?n-1-p:p;
        if(lgLink(e,ix-4,ix,op,ox+4,3))nX++}}});
  /* ---- a road end with only ONE way on (an L-shaped corner): the turn was given to the inner or the outer lane only, so the other lanes ended in nothing. Every lane gets it. ---- */
  ROADS.forEach((r,ri)=>{const o=LG.ofRoad[ri];if(!o||r.closed)return;
    for(let di=0;di<2;di++){const ends=[];for(const e of o[di])for(const l of e.out)if(l.foot>=e.n-4)ends.push(l);if(!ends.length)continue;
      for(const e of o[di]){if(e.out.some(l=>l.foot>=e.n-4))continue;for(const l of ends)lgLink(e,l.fu,l.foot,l.to,l.tu,l.kind)}}});
  /* ---- dead ends: where NO lane of a road direction has a way on, every lane turns round into the opposite lane ---- */
  let nU=0;
  ROADS.forEach((r,ri)=>{const o=LG.ofRoad[ri];if(!o||r.closed||r.n<12)return;
    for(let di=0;di<2;di++){let has=false;for(const e of o[di])for(const l of e.out)if(l.foot>=e.n-4)has=true;if(has)continue;
      for(const e of o[di]){const op=o[1-di][Math.min(e.k,o[1-di].length-1)];if(op&&lgLink(e,e.n-4,e.n-1,op,3,3))nU++}}});
  /* ---- junction groups per road direction (all lanes together): the links that belong to one junction, found by where the junction is (foot); a car picks one of them and changes lane if it has to ---- */
  LG.jg=[];
  ROADS.forEach((r,ri)=>{const o=LG.ofRoad[ri];if(!o)return;
    for(let di=0;di<2;di++){const all=[];for(const e of o[di])for(const l of e.out)all.push(l);all.sort((a,b)=>a.foot-b.foot||a.id-b.id);const G=[];let g=null;
      for(const l of all){if(!g||l.foot-g.last>3){g={id:(ri*2+di)*256+G.length,foot:l.foot,last:l.foot,minFu:l.fu,links:[],through:false,e0:o[di][0]};G.push(g)}g.links.push(l);g.last=l.foot;if(l.fu<g.minFu)g.minFu=l.fu;l.jg=g}
      for(const g of G){g.through=r.closed||g.foot<r.n-4}
      LG.jg[ri*2+di]=G}});
  let lk=0,pts=0,k3=[0,0,0,0];for(const e of LG.edges){lk+=e.len;pts+=e.n}for(const l of LG.links){k3[l.kind]++;pts+=l.n}
  LG.stat={edges:LG.edges.length,links:LG.links.length,laneKm:lk/1000,points:pts,touches:touches.length,mismatch:mism,crossings:nCross,uturns:nU,crossovers:nX,straight:k3[0],right:k3[1],left:k3[2],ms:typeof performance!=='undefined'?performance.now()-t0:0};
  LG._seen=null;LG.ready=true;return LG.stat}
/* the next junction of this road direction ahead of index u on an edge (its foot is still ahead): the group, or null */
function lgNextJ(e,u){const G=LG.jg[e.ri*2+lgDirI(e.dir)];if(!G||!G.length)return null;
  for(let i=0;i<G.length;i++)if(G[i].foot>=u)return G[i];
  return e.closed?G[0]:null}
