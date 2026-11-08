'use strict';
/* ===== the county: terrain function, road network (plan view only; heights follow the land), carving, ground colours =====
   x = east, z = south, y = up, metres. Everything here is deterministic. */
const W={half:3072,T:4,N:1536,sea:0,hmin:-60,hrange:720,hm:null,col:null,CN:1024,city:null};
W.size=W.half*2;
/* downtown: street grid + the flat plateau it sits on */
const CITY={x0:-1260,z0:0,nx:7,nz:6,bs:120,hw:8};   /* streets at x0+i*bs and z0+j*bs */
CITY.x1=CITY.x0+(CITY.nx-1)*CITY.bs;CITY.z1=CITY.z0+(CITY.nz-1)*CITY.bs;CITY.y=12;
const PEAKS=[[1950,-1950,330,900],[2550,-1000,200,600]];
function baseH(x,z){
  let h=9+(fbm(x*.0011,z*.0011,3,4)-.5)*15;
  const hm=sstep(-300,1500,x)*sstep(500,-1000,z)+.2*sstep(-1800,-800,z);
  h+=hm*38*(.25+.75*fbm(x*.0012+3,z*.0012,5,4))*(1.2*(fbm(x*.0021,z*.0021,6,2)-.2));
  for(let i=0;i<PEAKS.length;i++){const p=PEAKS[i],dx=x-p[0],dz=z-p[1],r2=(dx*dx+dz*dz)/(p[3]*p[3]);if(r2<9)h+=p[2]*Math.exp(-r2)*(.72+.42*ridge(x*.0016,z*.0016,9+i,3))}
  /* coast to the west: beach slope from the waterline, then sea */
  const cx=-2150+(fbm(z*.0008,2.3,13,3)-.5)*560,dc=x-cx;
  h=dc<-700?-40:(dc<0?lerp(-40,0,sstep(-700,0,dc)):(dc<300?lerp(0,h,sstep(0,300,dc)*.85+.15*sstep(0,300,dc)):h));
  /* the downtown plateau */
  const px=Math.max(Math.abs(x-(CITY.x0+CITY.x1)/2)-(CITY.x1-CITY.x0)/2-60,0),pz=Math.max(Math.abs(z-(CITY.z0+CITY.z1)/2)-(CITY.z1-CITY.z0)/2-60,0);
  h=lerp(CITY.y,h,sstep(0,220,Math.hypot(px,pz)));
  /* the island ends in sea on every side */
  const e=Math.max(Math.abs(x),Math.abs(z));h-=sstep(2560,3040,e)*(h+45);
  return h}
/* ---------- roads ---------- */
const ROADS=[];            /* built roads: {id,n,X,Z,Y,S,HW,mk,rail,br,st,lanes,len,closed,lift} */
const RSH=2.2;             /* shoulder width outside the asphalt */
function catmull(P,closed,ds){
  const n=P.length,seg=closed?n:n-1,poly=[];const G=i=>closed?P[(i%n+n)%n]:P[Math.max(0,Math.min(n-1,i))];
  for(let i=0;i<seg;i++){const p0=G(i-1),p1=G(i),p2=G(i+1),p3=G(i+2);
    const d1=Math.pow(Math.hypot(p1[0]-p0[0],p1[1]-p0[1])||1,.5),d2=Math.pow(Math.hypot(p2[0]-p1[0],p2[1]-p1[1])||1,.5),d3=Math.pow(Math.hypot(p3[0]-p2[0],p3[1]-p2[1])||1,.5);
    const m=Math.max(6,Math.ceil(Math.hypot(p2[0]-p1[0],p2[1]-p1[1])/12));
    for(let k=0;k<m;k++){const t=k/m;
      /* centripetal Catmull-Rom as Barry-Goldman pyramid */
      const t0=0,t1=t0+d1,t2=t1+d2,t3=t2+d3,tt=t1+(t2-t1)*t;
      const A1=[0,0],A2=[0,0],A3=[0,0],B1=[0,0],B2=[0,0],C=[0,0];
      for(let c=0;c<2;c++){A1[c]=(t1-tt)/(t1-t0)*p0[c]+(tt-t0)/(t1-t0)*p1[c];A2[c]=(t2-tt)/(t2-t1)*p1[c]+(tt-t1)/(t2-t1)*p2[c];A3[c]=(t3-tt)/(t3-t2)*p2[c]+(tt-t2)/(t3-t2)*p3[c];
        B1[c]=(t2-tt)/(t2-t0)*A1[c]+(tt-t0)/(t2-t0)*A2[c];B2[c]=(t3-tt)/(t3-t1)*A2[c]+(tt-t1)/(t3-t1)*A3[c];C[c]=(t2-tt)/(t2-t1)*B1[c]+(tt-t1)/(t2-t1)*B2[c]}
      poly.push(C[0],C[1])}}
  if(!closed)poly.push(P[n-1][0],P[n-1][1]);
  /* resample by arc length */
  const pts=poly.length/2,cum=new Float64Array(pts);for(let i=1;i<pts;i++)cum[i]=cum[i-1]+Math.hypot(poly[i*2]-poly[i*2-2],poly[i*2+1]-poly[i*2-1]);
  let total=cum[pts-1];if(closed)total+=Math.hypot(poly[0]-poly[pts*2-2],poly[1]-poly[pts*2-1]);
  const cnt=Math.max(2,Math.round(total/ds))+(closed?0:1),X=new Float32Array(cnt),Z=new Float32Array(cnt);let j=0;
  const step=closed?total/cnt:total/(cnt-1);
  for(let i=0;i<cnt;i++){const s=i*step;while(j<pts-2&&cum[j+1]<s)j++;
    if(closed&&s>cum[pts-1]){const e=poly.length-2,t=(s-cum[pts-1])/Math.max(1e-6,total-cum[pts-1]);X[i]=poly[e]+(poly[0]-poly[e])*t;Z[i]=poly[e+1]+(poly[1]-poly[e+1])*t}
    else{const sg=Math.max(1e-6,cum[j+1]-cum[j]),t=clamp((s-cum[j])/sg,0,1);X[i]=poly[j*2]+(poly[j*2+2]-poly[j*2])*t;Z[i]=poly[j*2+1]+(poly[j*2+3]-poly[j*2+1])*t}}
  return{X,Z,step,n:cnt}}
/* find the arc-length fraction / point of a built road */
function roadPt(r,f){const i=clamp(Math.round(f*(r.closed?r.n:r.n-1)),0,r.n-1);return[r.X[i],r.Z[i],i]}
function roadNear(r,x,z){let bi=0,bd=1e18;for(let i=0;i<r.n;i++){const d=(r.X[i]-x)**2+(r.Z[i]-z)**2;if(d<bd){bd=d;bi=i}}return bi}
function smoothArr(a,rad,closed){const n=a.length,o=new Float32Array(n);for(let i=0;i<n;i++){let s=0,c=0;for(let k=-rad;k<=rad;k++){let j=i+k;if(closed)j=(j%n+n)%n;else if(j<0||j>=n)continue;s+=a[j];c++}o[i]=s/c}return o}
function gradeLimit(y,ds,g,closed){const n=y.length,m=g*ds;for(let pass=0;pass<(closed?3:1);pass++){for(let i=1;i<n;i++)y[i]=clamp(y[i],y[i-1]-m,y[i-1]+m);for(let i=n-2;i>=0;i--)y[i]=clamp(y[i],y[i+1]-m,y[i+1]+m);if(closed){y[0]=clamp(y[0],y[n-1]-m,y[n-1]+m)}}}
/* def: {id,hw,lanes,style,closed,pts,flat,from:[road,f],to:[road,f],bridge:[{x,z,len,h}],lift,yfix} ; style 0 two-way, 1 divided, 2 patch, 3 city street */
function buildRoad(d){
  const ds=4,sp=catmull(d.pts,!!d.closed,ds),n=sp.n,X=sp.X,Z=sp.Z;
  let Y=new Float32Array(n);
  for(let i=0;i<n;i++)Y[i]=d.flat!=null?d.flat:Math.max(baseH(X[i],Z[i]),d.minY==null?3.2:d.minY);
  if(d.flat==null){Y=smoothArr(Y,Math.round((d.smooth||90)/ds),!!d.closed);gradeLimit(Y,ds,d.grade||.085,!!d.closed)}
  const r={id:d.id,n,X,Z,Y,ds:sp.step,hw:d.hw,lanes:d.lanes,style:d.style,closed:!!d.closed,lift:d.lift||0,city:!!d.city,def:d};
  r.S=new Float32Array(n);for(let i=1;i<n;i++)r.S[i]=r.S[i-1]+Math.hypot(X[i]-X[i-1],Z[i]-Z[i-1]);
  r.len=r.S[n-1]+(r.closed?Math.hypot(X[0]-X[n-1],Z[0]-Z[n-1]):0);
  /* blend heights into the roads we join so the junction is flush */
  /* within ~150 m of the parent road, follow the parent's own height so the two surfaces stay flush */
  const blend=(ref,at,fromStart)=>{const rr=ROADS.find(q=>q.id==ref);if(!rr)return;
    for(let i=0;i<n;i++){const s=fromStart?r.S[i]:r.len-r.S[i];if(s>320)continue;let bd=1e18,bk=0;for(let k=0;k<rr.n;k++){const dd=(rr.X[k]-X[i])**2+(rr.Z[k]-Z[i])**2;if(dd<bd){bd=dd;bk=k}}
      const t=sstep(8,170,Math.sqrt(bd)),w=Math.max(t,sstep(150,320,s));Y[i]=lerp(rr.Y[bk],Y[i],w)}};
  if(d.from)blend(d.from,0,true);if(d.to)blend(d.to,0,false);
  /* overpasses: lift a stretch of this road above whatever it crosses */
  r.br=new Uint8Array(n);
  if(d.bridge)for(const b of d.bridge){const c=roadNear(r,b.x,b.z),half=b.len/2,ramp=b.ramp||150;for(let i=0;i<n;i++){const s=Math.abs(r.S[i]-r.S[c]);const k=1-sstep(half,half+ramp,s);if(k>0){Y[i]+=b.h*k;if(k>.35)r.br[i]=1}}}
  r.Y=Y;for(let i=0;i<n;i++)r.Y[i]+=r.lift;
  /* marking fade near the ends of side roads / near crossings (0..1) */
  r.mk=new Float32Array(n).fill(1);
  if(d.from)for(let i=0;i<n;i++)r.mk[i]=Math.min(r.mk[i],sstep(30,110,r.S[i]));
  if(d.to)for(let i=0;i<n;i++)r.mk[i]=Math.min(r.mk[i],sstep(30,110,r.len-r.S[i]));
  /* width ramps in over the first stretch of a branch so it merges like a slip road */
  r.wk=new Float32Array(n).fill(1);
  if(d.from)for(let i=0;i<n;i++)r.wk[i]=lerp(.25,1,sstep(0,120,r.S[i]));
  if(d.to)for(let i=0;i<n;i++)r.wk[i]=Math.min(r.wk[i],lerp(.25,1,sstep(0,120,r.len-r.S[i])));
  r.rail=new Uint8Array(n);   /* bit0 left, bit1 right: filled in after carving (cliffs) + bridges */
  ROADS.push(r);return r}
function switchbacks(cx,cz,arms){const o=[];arms.forEach((A,k)=>{const n=Math.max(3,Math.round(Math.abs(A[1]-A[0])/.12));for(let s=(k?1:0);s<=n;s++){const t=s/n,a=lerp(A[0],A[1],t),r=A[2]-(k<arms.length-1?(arms[k][2]-arms[k+1][2])*t*.0:0);o.push([cx+Math.cos(a)*r,cz+Math.sin(a)*r])}});return o}
function defineRoads(){
  ROADS.length=0;
  const ring=buildRoad({id:'ring',closed:1,hw:13,lanes:3,style:1,smooth:120,pts:[[-1640,120],[-1560,-520],[-1180,-980],[-620,-1260],[-60,-1380],[560,-1290],[1130,-1020],[1520,-540],[1680,60],[1560,700],[1180,1180],[620,1500],[-30,1560],[-640,1400],[-1160,1050],[-1500,600]]});
  const pt=(rd,f)=>{const q=roadPt(rd,f);return[q[0],q[1]]};
  const ptn=(rd,x,z)=>{const i=roadNear(rd,x,z);return[rd.X[i],rd.Z[i]]};
  /* downtown street grid (flat, own geometry) */
  const cityRoads=[];
  for(let i=0;i<CITY.nx;i++){const x=CITY.x0+i*CITY.bs;cityRoads.push(buildRoad({id:'ns'+i,hw:CITY.hw,lanes:1,style:3,flat:CITY.y,city:1,lift:.02+i*.001,pts:[[x,CITY.z0],[x,CITY.z1]]}))}
  for(let j=0;j<CITY.nz;j++){const z=CITY.z0+j*CITY.bs;cityRoads.push(buildRoad({id:'ew'+j,hw:CITY.hw,lanes:1,style:3,flat:CITY.y,city:1,lift:.05+j*.001,pts:[[CITY.x0,z],[CITY.x1,z]]}))}
  /* connector: ring west -> downtown west edge */
  buildRoad({id:'dc',hw:10,lanes:2,style:1,from:'ring',lift:.03,pts:[pt(ring,.0),[-1560,150],[-1420,235],[-1330,290],[CITY.x0,CITY.z0+300]]});
  /* boulevard: downtown east edge -> ring east */
  buildRoad({id:'bv',hw:10,lanes:2,style:1,to:'ring',lift:.04,smooth:70,pts:[[CITY.x1,CITY.z0+300],[-300,360],[40,330],[400,190],[800,230],[1200,120],[1520,40],pt(ring,.5)]});
  /* the mountain pass: leaves the ring in the north-east, climbs in switchbacks, comes down the north coast and rejoins the ring */
  const sb=switchbacks(1950,-1950,[[2.04,2.5,1230],[2.5,1.42,1040],[1.42,2.5,860],[2.5,1.5,700],[1.5,2.35,600]]);
  buildRoad({id:'mp',hw:8.5,lanes:1,style:0,from:'ring',to:'ring',lift:.05,smooth:50,grade:.145,pts:[ptn(ring,1394,-853)].concat(sb.slice(1)).concat([[1420,-1700],[1250,-1950],[1000,-2180],[650,-2420],[200,-2540],[-300,-2480],[-760,-2300],[-1110,-1960],[-1260,-1480],ptn(ring,-1180,-980)])});
  /* coast road: leaves downtown south-west, goes over the ring, runs along the beach, climbs a cliff headland, ends in the plains */
  buildRoad({id:'cr',hw:9,lanes:1,style:0,lift:.06,smooth:70,bridge:[{x:-1310,z:790,len:90,h:9}],pts:[[CITY.x0,CITY.z0+600],[-1380,780],[-1560,1000],[-1790,1250],[-1900,1600],[-1840,2000],[-1560,2300],[-1100,2480],[-560,2470],[-80,2380],[420,2330]]});
  /* southern highway: ring south -> long plains straight -> beach lookout, passes over the east link */
  buildRoad({id:'sh',hw:12,lanes:2,style:1,from:'ring',lift:.07,smooth:150,grade:.05,bridge:[{x:2380,z:2420,len:100,h:9}],pts:[pt(ring,.77),[40,1850],[300,2260],[800,2420],[1500,2440],[2100,2420],[2500,2420],[2700,2400]]});
  /* east link: ring east -> south along the east side, goes under the highway */
  buildRoad({id:'el',hw:10,lanes:2,style:1,from:'ring',lift:.08,smooth:100,pts:[pt(ring,.63),[2000,1060],[2300,1560],[2420,2000],[2380,2420],[2330,2620]]});
  return cityRoads}
const roadById=id=>ROADS.find(r=>r.id==id);
