'use strict';
/* ===== the county: terrain function, road network (plan view only; heights follow the land), carving, ground colours =====
   x = east, z = south, y = up, metres. Everything here is deterministic. */
const W={half:5120,T:5,N:2048,sea:0,hmin:-60,hrange:720,hm:null,col:null,CN:1536,city:null};   /* 10.2 km square heightmap, 5 m cells; the sea is to the west and south, the land runs out to the north and east */
W.size=W.half*2;
/* ---- the county's districts (San Francisco / California inspired). All coordinates in metres. ---- */
const CITY={x0:-1330,z0:-170,x1:-470,z1:700};          /* the downtown box (two street grids meeting at Market Street), ringed by a boulevard */
const MARKET={x0:-1240,z0:700,x1:-470,z1:-6,hw:13};      /* the diagonal avenue that splits the two grids (corner to corner of the box) */
const PARK={x0:-1450,z0:392,x1:-1010,z1:453};           /* Golden Gate Park style green strip with a lake, between two edge streets */
const VALLEY={x0:230,z0:520,x1:1050,z1:1290};           /* LA style: wide boulevards, low buildings, palms */
const BEACH={x0:-520,z0:2540,x1:-130,z1:2780};          /* Santa Cruz style beach town on the south coast, boardwalk + pier */
const RESORT={x0:1380,z0:1420,x1:1860,z1:1900};         /* Palm Springs style desert resort: wide palm boulevards, pools, golf */
const HILLS=[[-860,0,40,230],[-1100,-90,52,210],[-640,790,56,250],[-520,850,40,190],[-1390,250,22,150]];   /* Nob Hill, Russian Hill, Twin Peaks */
const LAKES=[[-1235,412,22,-3],[4100,650,420,-3],[-1950,-2500,200,-3]];   /* Golden Gate Park, the desert lake, the farm lake */
const RIDGES=[[1580,-250,560,-70,74,130]];              /* the Mulholland ridge: x0,z0,x1,z1,height,half-width */
const PEAKS=[[1950,-1950,330,900],[2550,-1000,200,600],
  /* the northern range (snow above about 360 m) and the north-east mountains */
  [-300,-4150,440,700],[1000,-4200,490,720],[2300,-3950,430,700],[3500,-3700,390,700],[-1500,-3950,330,700],[600,-3750,300,500],[4300,-2700,370,750]];
/* the mesa and its canyon in the north-east desert: a plateau with a winding trench cut through it (the canyon road follows the trench) */
const MESA={x0:2900,z0:-3100,x1:4700,z1:300,h:75};
const CANYON=[[3000,350],[3250,-100],[3500,-350],[3550,-800],[3800,-1200],[4000,-1700],[3900,-2300],[3600,-2700]];
function canyonDist(x,z){let d=1e9;for(let i=0;i<CANYON.length-1;i++){const a=CANYON[i],b=CANYON[i+1],ex=b[0]-a[0],ez=b[1]-a[1];let t=((x-a[0])*ex+(z-a[1])*ez)/(ex*ex+ez*ez);t=t<0?0:t>1?1:t;const q=Math.hypot(x-a[0]-ex*t,z-a[1]-ez*t);if(q<d)d=q}return d}
/* the new towns and industrial areas that fill the gaps (each a street grid ringed by a boulevard) */
const TOWN_PAC={x0:-1800,z0:1380,x1:-1480,z1:1640};     /* Pacifica: a coastal village on the coast road */
const TOWN_FRE={x0:-1650,z0:-2250,x1:-1350,z1:-2030};   /* Fresno: the farm town */
const TOWN_BAR={x0:3500,z0:1250,x1:3860,z1:1560};       /* Barstow: a desert town */
const TOWN_BIG={x0:-350,z0:-3250,x1:-30,z1:-3000};      /* Big Pines: a mountain village in the northern foothills */
const IND_HAR={x0:900,z0:2560,x1:1500,z1:2760};         /* the harbour industrial area on the south coast */
const IND_MOJ={x0:3150,z0:2150,x1:3600,z1:2420};        /* Mojave Works: a desert refinery and warehouses */
const TERRACES=[[-190,-3125,380,85]];                   /* flattened sites: x,z,radius,height */
const ZONES=[{b:TOWN_PAC,c:[.30,.27,.22]},{b:TOWN_FRE,c:[.26,.24,.19]},{b:TOWN_BAR,c:[.33,.27,.19]},{b:TOWN_BIG,c:[.2,.2,.19]},{b:IND_HAR,c:[.2,.2,.2]},{b:IND_MOJ,c:[.25,.23,.2]}];   /* ground colour (linear) inside each */
const FIELDS=[];                                        /* farm fields: {b,c:[[r,g,b],[r,g,b]]} (filled in with the farm roads) */
const FARMS=[];                                         /* {x,z,cs,sn}: a barn, silo, house and shed */
const SAFEHOUSES=[];                                    /* {id,name,x,z,yaw} filled in by defineWorld */
const inBox=(x,z,B,m)=>x>B.x0-m&&x<B.x1+m&&z>B.z0-m&&z<B.z1+m;
function baseH(x,z){
  let h=9+(fbm(x*.0011,z*.0011,3,4)-.5)*15;
  const hm=sstep(-300,1500,x)*sstep(500,-1000,z)+.2*sstep(-1800,-800,z);
  h+=hm*38*(.25+.75*fbm(x*.0012+3,z*.0012,5,4))*(1.2*(fbm(x*.0021,z*.0021,6,2)-.2));
  for(let i=0;i<PEAKS.length;i++){const p=PEAKS[i],dx=x-p[0],dz=z-p[1],r2=(dx*dx+dz*dz)/(p[3]*p[3]);if(r2<9)h+=p[2]*Math.exp(-r2)*(.72+.42*ridge(x*.0016,z*.0016,9+i,3))}
  /* the city hills: the street grid is laid over them like San Francisco's */
  for(let i=0;i<HILLS.length;i++){const q=HILLS[i],dx=x-q[0],dz=z-q[1],r2=(dx*dx+dz*dz)/(q[3]*q[3]);if(r2<6)h+=q[2]*Math.exp(-r2*1.2)}
  for(let i=0;i<RIDGES.length;i++){const q=RIDGES[i],ex=q[2]-q[0],ez=q[3]-q[1],l2=ex*ex+ez*ez;let t=((x-q[0])*ex+(z-q[1])*ez)/l2;t=t<0?0:t>1?1:t;const d=Math.hypot(x-(q[0]+ex*t),z-(q[1]+ez*t)),w=d/q[5];if(w<3)h+=q[4]*Math.exp(-w*w)*(.55+.9*fbm(x*.004,z*.004,41,3))*sstep(0,.4,t)*(1-sstep(.6,1,t))}
  /* coast to the west: beach slope from the waterline, then sea */
  const cx=-2150+(fbm(z*.0008,2.3,13,3)-.5)*560,dc=x-cx;
  h=dc<-700?-40:(dc<0?lerp(-40,0,sstep(-700,0,dc)):(dc<300?lerp(0,h,sstep(0,300,dc)*.85+.15*sstep(0,300,dc)):h));
  for(let i=0;i<TERRACES.length;i++){const q=TERRACES[i],d=Math.hypot(x-q[0],z-q[1]);if(d<q[2])h=lerp(h,q[3],1-sstep(q[2]*.55,q[2],d))}
  /* lakes: a bowl dipping below sea level (the water plane then shows) */
  for(let i=0;i<LAKES.length;i++){const q=LAKES[i],d=Math.hypot(x-q[0],z-q[1]);if(d<q[2])h=lerp(h,q[3],1-sstep(q[2]*.55,q[2],d))}
  /* the mesa: a 75 m plateau with the canyon cut through it */
  {const m=sstep(MESA.x0-250,MESA.x0+150,x)*(1-sstep(MESA.x1-150,MESA.x1+250,x))*sstep(MESA.z0-250,MESA.z0+150,z)*(1-sstep(MESA.z1-150,MESA.z1+250,z));
   if(m>0){const d=canyonDist(x,z);h+=m*MESA.h*(.85+.3*fbm(x*.003,z*.003,61,3))*sstep(38,98,d)}}
  /* the land ends in sea: the west coast is above, the south coast here, cliffs on the east coast, a beach to the north */
  h-=Math.max(sstep(2760,3062,z),sstep(4650,4760,x),sstep(4650,4950,-z))*(h+45);
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
/* a smoothed copy of the land (about 30 m blur): all city streets take their height from it, so streets that cross are always flush */
function Hs(x,z){let s=baseH(x,z)*2,w=2;for(let k=0;k<8;k++){const a=k*.7854;s+=baseH(x+Math.cos(a)*14,z+Math.sin(a)*14)+baseH(x+Math.cos(a)*30,z+Math.sin(a)*30);w+=2}return s/w}
function crossPoint(r,o){const rc=r.closed?r.n:r.n-1,oc=o.closed?o.n:o.n-1;
  for(let i=0;i<rc;i++){const j=(i+1)%r.n,ax=r.X[i],az=r.Z[i],bx=r.X[j],bz=r.Z[j];
    for(let k=0;k<oc;k++){const l=(k+1)%o.n,cx=o.X[k],cz=o.Z[k],dx=o.X[l],dz=o.Z[l],den=(bx-ax)*(dz-cz)-(bz-az)*(dx-cx);if(Math.abs(den)<1e-9)continue;
      const t=((cx-ax)*(dz-cz)-(cz-az)*(dx-cx))/den,u=((cx-ax)*(bz-az)-(cz-az)*(bx-ax))/den;if(t>=0&&t<=1&&u>=0&&u<=1)return[ax+t*(bx-ax),az+t*(bz-az)]}}
  return null}
function buildRoad(d,dry){
  const ds=4,sp=catmull(d.pts,!!d.closed,ds),n=sp.n,X=sp.X,Z=sp.Z;
  let Y=new Float32Array(n);
  for(let i=0;i<n;i++)Y[i]=d.flat!=null?d.flat:Math.max(baseH(X[i],Z[i]),d.minY==null?3.2:d.minY);
  if(d.cityField){for(let i=0;i<n;i++)Y[i]=Math.max(Hs(X[i],Z[i]),3.2)}
  else if(d.flat==null){Y=smoothArr(Y,Math.round((d.smooth||90)/ds),!!d.closed);gradeLimit(Y,ds,d.grade||.085,!!d.closed)}
  const r={id:d.id,n,X,Z,Y,ds:sp.step,hw:d.hw,lanes:laneInfo(d.hw,d.style).nl,style:d.style,closed:!!d.closed,lift:d.lift||0,city:!!d.city,def:d};
  r.S=new Float32Array(n);for(let i=1;i<n;i++)r.S[i]=r.S[i-1]+Math.hypot(X[i]-X[i-1],Z[i]-Z[i-1]);
  r.len=r.S[n-1]+(r.closed?Math.hypot(X[0]-X[n-1],Z[0]-Z[n-1]):0);
  /* blend heights into the roads we join so the junction is flush */
  /* within ~150 m of the parent road, follow the parent's own height so the two surfaces stay flush */
  const blend=(ref,at,fromStart)=>{const rr=ROADS.find(q=>q.id==ref);if(!rr)return;
    for(let i=0;i<n;i++){const s=fromStart?r.S[i]:r.len-r.S[i];if(s>320)continue;let bd=1e18,bk=0;for(let k=0;k<rr.n;k++){const dd=(rr.X[k]-X[i])**2+(rr.Z[k]-Z[i])**2;if(dd<bd){bd=dd;bk=k}}
      const t=sstep(8,170,Math.sqrt(bd)),w=Math.max(t,sstep(150,320,s));Y[i]=lerp(rr.Y[bk],Y[i],w)}};
  const yf=d.from||d.yFrom,yt=d.to||d.yTo;if(d.yLine)for(let i=0;i<n;i++)Y[i]=lerp(d.yLine[0],d.yLine[1],r.S[i]/r.len);
  if(yf)blend(yf,0,true);if(yt)blend(yt,0,false);
  if((yf||yt)&&d.flat==null&&!d.cityField&&!d.yLine){const g=(d.grade||.085)*ds,p0=Y[0],p1=Y[n-1];for(let it=0;it<3;it++){if(yf)Y[0]=p0;for(let i=1;i<n;i++)Y[i]=clamp(Y[i],Y[i-1]-g,Y[i-1]+g);if(yt)Y[n-1]=p1;for(let i=n-2;i>=0;i--)Y[i]=clamp(Y[i],Y[i+1]-g,Y[i+1]+g)}}
  /* jump hills: a run of n sin^2 crests of the given length and height starting f of the way along the road. A crest of height h and length L has a crest radius of about L^2/(2 pi^2 h),
     and a car leaves the ground over it once v^2/radius > gravity (so a 6 m, 68 m crest launches a car at about 68 mph) */
  if(d.humps)for(const h of d.humps){const s0=h.f*r.len;for(let i=0;i<n;i++){const t=(r.S[i]-s0)/h.len;if(t>0&&t<h.n)Y[i]+=h.amp*Math.pow(Math.sin(Math.PI*t),2)}}
  /* overpasses: lift a stretch of this road above whatever it crosses (bridgeOver names the roads to find the crossing with) */
  r.br=new Uint8Array(n);
  const bl=(d.bridge||[]).slice();if(d.bridgeOver)for(const id of d.bridgeOver){const o=ROADS.find(q=>q.id==id),c=o&&crossPoint(r,o);if(c)bl.push({x:c[0],z:c[1],len:100,h:9.5})}
  for(const b of bl){const c=roadNear(r,b.x,b.z),half=b.len/2,ramp=b.ramp||150;for(let i=0;i<n;i++){const s=Math.abs(r.S[i]-r.S[c]);const k=1-sstep(half,half+ramp,s);if(k>0){Y[i]+=b.h*k;if(k>.35)r.br[i]=1}}}
  r.Y=Y;for(let i=0;i<n;i++)r.Y[i]+=r.lift;
  /* marking fade near the ends of side roads / near crossings (0..1) */
  r.mk=new Float32Array(n).fill(1);
  if(d.from)for(let i=0;i<n;i++)r.mk[i]=Math.min(r.mk[i],sstep(30,110,r.S[i]));
  if(d.to)for(let i=0;i<n;i++)r.mk[i]=Math.min(r.mk[i],sstep(30,110,r.len-r.S[i]));
  /* width ramps in over the first stretch of a branch so it merges like a slip road */
  r.wk=new Float32Array(n).fill(1);
  if(d.from&&d.taper)for(let i=0;i<n;i++)r.wk[i]=lerp(.25,1,sstep(0,120,r.S[i]));
  if(d.to&&d.taper)for(let i=0;i<n;i++)r.wk[i]=Math.min(r.wk[i],lerp(.25,1,sstep(0,120,r.len-r.S[i])));
  r.rail=new Uint8Array(n);   /* bit0 left, bit1 right: filled in after carving (cliffs) + bridges */
  if(!dry)ROADS.push(r);return r}
function switchbacks(cx,cz,arms){const o=[];arms.forEach((A,k)=>{const n=Math.max(3,Math.round(Math.abs(A[1]-A[0])/.12));for(let s=(k?1:0);s<=n;s++){const t=s/n,a=lerp(A[0],A[1],t),r=A[2]-(k<arms.length-1?(arms[k][2]-arms[k+1][2])*t*.0:0);o.push([cx+Math.cos(a)*r,cz+Math.sin(a)*r])}});return o}
/* ---------- curvy roads: displace the centre-line with smooth noise, then check the curves are drivable and the road stays on land ---------- */
function vn1(x,seed,per){const ix=Math.floor(x),f=x-ix,u=f*f*(3-2*f),w=k=>per?((k%per)+per)%per:k;return(h2(w(ix),0,seed)*(1-u)+h2(w(ix+1),0,seed)*u)*2-1}
function wiggle(P,closed,o){
  const base=catmull(P,closed,60),n=base.n,X=base.X,Z=base.Z,step=base.step,len=step*(closed?n:n-1),pts=[];
  const P1=closed?Math.max(2,Math.round(len/o.l1)):0,P2=closed?Math.max(2,Math.round(len/o.l2)):0,fade=o.fade||240;
  for(let i=0;i<n;i++){const s=i*step,a=closed?(i+n-1)%n:Math.max(0,i-1),b=closed?(i+1)%n:Math.min(n-1,i+1);let tx=X[b]-X[a],tz=Z[b]-Z[a];const l=Math.hypot(tx,tz)||1;tx/=l;tz/=l;
    let amp=1;if(!closed){const hd=o.hold==null?140:o.hold;amp=Math.min(sstep(hd,hd+fade,s),sstep(hd,hd+fade,len-s))}
    if(o.straight)for(const[f0,f1]of o.straight){const q=s/len,fd=.05;amp*=1-sstep(f0-fd,f0,q)*(1-sstep(f1,f1+fd,q))}
    const d=amp*(o.a1*vn1(s/(closed?len/P1:o.l1),o.seed,P1)+o.a2*vn1(s/(closed?len/P2:o.l2),o.seed+11,P2));pts.push([X[i]-tz*d,Z[i]+tx*d])}
  if(!closed){pts[0]=[P[0][0],P[0][1]];pts[n-1]=[P[P.length-1][0],P[P.length-1][1]]}
  return pts}
function minRadius(r,k){const n=r.n,lo=r.closed?0:Math.max(k,30),hi=r.closed?n:n-Math.max(k,30);let m=1e9;
  for(let i=lo;i<hi;i++){const a=(i-k+n)%n,b=(i+k)%n,ax=r.X[a],az=r.Z[a],bx=r.X[i],bz=r.Z[i],cx=r.X[b],cz=r.Z[b];const ab=Math.hypot(bx-ax,bz-az),bc=Math.hypot(cx-bx,cz-bz),ca=Math.hypot(ax-cx,az-cz),A2=Math.abs((bx-ax)*(cz-az)-(bz-az)*(cx-ax));if(A2<1e-6)continue;const R=ab*bc*ca/(2*A2);if(R<m)m=R}return m}
function landOK(r){for(let i=0;i<r.n;i+=2)if(baseH(r.X[i],r.Z[i])<2.4)return false;return true}
function segX(ax,az,bx,bz,cx,cz,dx,dz){const den=(bx-ax)*(dz-cz)-(bz-az)*(dx-cx);if(Math.abs(den)<1e-9)return null;const t=((cx-ax)*(dz-cz)-(cz-az)*(dx-cx))/den,u=((cx-ax)*(bz-az)-(cz-az)*(bx-ax))/den;return(t>=0&&t<=1&&u>=0&&u<=1)?[ax+t*(bx-ax),az+t*(bz-az)]:null}
function trimTo(pts,par){for(let i=0;i<pts.length-1;i++)for(let k=0;k<par.n-1;k++){const p=segX(pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1],par.X[k],par.Z[k],par.X[k+1],par.Z[k+1]);if(p)return pts.slice(0,i+1).concat([[p[0],p[1]]])}return pts}
const DISTRICT_BOXES=[CITY,VALLEY,BEACH,RESORT,PARK,TOWN_PAC,TOWN_FRE,TOWN_BAR,TOWN_BIG,IND_HAR,IND_MOJ];
function clearOf(r){const lo=r.closed?0:170;for(let i=0;i<r.n;i+=2){if(!r.closed&&(r.S[i]<lo||r.len-r.S[i]<lo))continue;for(const B of DISTRICT_BOXES)if(inBox(r.X[i],r.Z[i],B,46))return false}return true}
function buildCurvy(def){
  const w=def.wig;if(!w)return buildRoad(def);
  let scale=1,r=null;
  for(let t=0;t<9;t++){const o=Object.assign({},w,{a1:w.a1*Math.pow(.9,t),a2:w.a2*Math.pow(.62,t)});scale=Math.pow(.9,t);let pts=wiggle(def.pts,!!def.closed,o);if(def.trimTo){const par=ROADS.find(q=>q.id==def.trimTo);if(par)pts=trimTo(pts,par)}r=buildRoad(Object.assign({},def,{pts}),true);
    if((minRadius(r,5)>=(def.minR||60)&&landOK(r)&&clearOf(r))||t==8)break}
  r.wigScale=scale;ROADS.push(r);return r}
/* ---------- district street grids (rotated grids, clipped to a convex region and with rectangles cut out) ---------- */
const GRIDS=[],cityEnds=[];
const planesBox=B=>[[-1,0,-B.x0],[1,0,B.x1],[0,-1,-B.z0],[0,1,B.z1]];
function clipSeg(ax,az,bx,bz,planes){let t0=0,t1=1;for(const[nx,nz,c]of planes){const da=nx*ax+nz*az-c,db=nx*bx+nz*bz-c;if(da>0&&db>0)return null;if(da>0)t0=Math.max(t0,da/(da-db));else if(db>0)t1=Math.min(t1,da/(da-db))}return t0<t1?[t0,t1]:null}
function cutRect(ax,az,bx,bz,R){/* remove the part of a segment inside the rectangle: returns pieces as [t0,t1] */
  let t0=0,t1=1;const dx=bx-ax,dz=bz-az;for(const[p,d,lo,hi]of[[ax,dx,R.x0,R.x1],[az,dz,R.z0,R.z1]]){if(Math.abs(d)<1e-9){if(p<lo||p>hi)return[[0,1]];continue}let u0=(lo-p)/d,u1=(hi-p)/d;if(u0>u1){const q=u0;u0=u1;u1=q}t0=Math.max(t0,u0);t1=Math.min(t1,u1)}
  if(t0>=t1)return[[0,1]];const out=[];if(t0>0)out.push([0,t0]);if(t1<1)out.push([t1,1]);return out}
function gridStreets(g){
  const cs=g.cs=Math.cos(g.ang),sn=g.sn=Math.sin(g.ang),toW=(u,v)=>[g.ox+u*cs-v*sn,g.oz+u*sn+v*cs],B=9000;g.roads=[];let idx=0;
  const add=(tag,p0,p1)=>{const c=clipSeg(p0[0],p0[1],p1[0],p1[1],g.planes);if(!c)return;const ax=p0[0]+(p1[0]-p0[0])*c[0],az=p0[1]+(p1[1]-p0[1])*c[0],bx=p0[0]+(p1[0]-p0[0])*c[1],bz=p0[1]+(p1[1]-p0[1])*c[1];
    let pieces=[[0,1]];for(const R of(g.cut||[])){const next=[];for(const[a0,a1]of pieces){const sx=ax+(bx-ax)*a0,sz=az+(bz-az)*a0,ex=ax+(bx-ax)*a1,ez=az+(bz-az)*a1;for(const[c0,c1]of cutRect(sx,sz,ex,ez,R))next.push([a0+(a1-a0)*c0,a0+(a1-a0)*c1])}pieces=next}
    for(const[a0,a1]of pieces){const sx=ax+(bx-ax)*a0,sz=az+(bz-az)*a0,ex=ax+(bx-ax)*a1,ez=az+(bz-az)*a1;if(Math.hypot(ex-sx,ez-sz)<34)continue;
      const r=buildRoad({id:g.id+tag+(a0>0||a1<1?'~':''),hw:g.hw,lanes:1,style:g.style,city:1,smooth:g.smooth||60,grade:g.grade||.26,lift:g.lift+(idx++)*.0004,cityField:1,pts:[[sx,sz],[ex,ez]]});g.roads.push(r);cityEnds.push([sx,sz,r.id],[ex,ez,r.id])}};
  g.us.forEach((u,i)=>add('u'+i,toW(u,-B),toW(u,B)));g.vs.forEach((v,j)=>add('v'+j,toW(-B,v),toW(B,v)));GRIDS.push(g);return g}
const nearEnd=(x,z)=>{let b=null,bd=1e18;for(const e of cityEnds){const d=(e[0]-x)**2+(e[1]-z)**2;if(d<bd){bd=d;b=e}}return b};
function applyBridge(r,x,z,len,h){const c=roadNear(r,x,z),half=len/2,ramp=150;for(let i=0;i<r.n;i++){const k=1-sstep(half,half+ramp,Math.abs(r.S[i]-r.S[c]));if(k>0){r.Y[i]+=h*k;if(k>.35)r.br[i]=1}}}
/* any two roads that cross away from their ends must pass at different levels (a real overpass), never at the same height */
function fixCrossings(){
  const cell=160,grid=new Map(),endD=(r,i)=>r.closed?1e9:Math.min(r.S[i],r.len-r.S[i]);
  ROADS.forEach((r,ri)=>{const c=r.closed?r.n:r.n-1;for(let i=0;i<c;i++){const j=(i+1)%r.n,x0=Math.min(r.X[i],r.X[j]),x1=Math.max(r.X[i],r.X[j]),z0=Math.min(r.Z[i],r.Z[j]),z1=Math.max(r.Z[i],r.Z[j]);
    for(let a=Math.floor(x0/cell);a<=Math.floor(x1/cell);a++)for(let b=Math.floor(z0/cell);b<=Math.floor(z1/cell);b++){const k=a+','+b;(grid.get(k)||grid.set(k,[]).get(k)).push([ri,i])}}});
  const seen=new Set(),done=[];
  for(const L of grid.values())for(let p=0;p<L.length;p++)for(let q=p+1;q<L.length;q++){const[ra,ia]=L[p],[rb,ib]=L[q];if(ra===rb)continue;const A=ROADS[ra],B=ROADS[rb];if(A.city&&B.city)continue;
    const ja=(ia+1)%A.n,jb=(ib+1)%B.n,pt=segX(A.X[ia],A.Z[ia],A.X[ja],A.Z[ja],B.X[ib],B.Z[ib],B.X[jb],B.Z[jb]);if(!pt)continue;
    const key=Math.min(ra,rb)+'-'+Math.max(ra,rb)+'@'+Math.round(pt[0]/80)+','+Math.round(pt[1]/80);if(seen.has(key))continue;seen.add(key);
    if(Math.min(endD(A,ia),endD(B,ib))<260)continue;                       /* a junction, not a crossing */
    if(Math.abs(A.Y[ia]-B.Y[ib])>=6)continue;                              /* already at different levels */
    const rbr=A.id=='ring'?B:B.id=='ring'?A:(ra>rb?A:B);if(rbr.city)continue;
    applyBridge(rbr,pt[0],pt[1],100,9.5);done.push(rbr.id+' over '+(rbr===A?B:A).id+' at '+Math.round(pt[0])+','+Math.round(pt[1]))}
  return done}
/* ---------- junction helpers ---------- */
const jn=(par,x,z)=>roadNear(par,x,z);
const _tan=(par,i)=>{const n=par.n,a=par.closed?(i+1)%n:Math.min(n-1,i+1),b=par.closed?(i+n-1)%n:Math.max(0,i-1);let tx=par.X[a]-par.X[b],tz=par.Z[a]-par.Z[b];const l=Math.hypot(tx,tz)||1;return[tx/l,tz/l]};
/* leave (or join) a road along its side: three control points that start touching the parent's edge, run alongside for a while and peel away, so the branch never lies on top of the parent */
function rampPts(par,ix,nx,nz,hwB){
  const n=par.n,ds=par.ds,I=i=>par.closed?((i%n)+n)%n:Math.max(0,Math.min(n-1,i)),[tx,tz]=_tan(par,I(ix)),px=par.X[I(ix)],pz=par.Z[I(ix)];
  const side=((nx-px)*(-tz)+(nz-pz)*tx)>=0?1:-1,dir=((nx-px)*tx+(nz-pz)*tz)>=0?1:-1,off=par.hw*par.wk[I(ix)]+hwB+1.4,out=[];
  {const dl0=Math.hypot(nx-px,nz-pz)||1;if(Math.abs((nx-px)*tx+(nz-pz)*tz)/dl0<.5)return[edgePt(par,I(ix),nx,nz)]}   /* leaving at a steep angle: a plain T */
  let qi=ix;for(const[k,ex]of[[0,0],[Math.round(80/ds),6],[Math.round(170/ds),30]]){const i=I(ix+dir*k),[a,b]=_tan(par,i);out.push([par.X[i]-b*side*(off+ex),par.Z[i]+a*side*(off+ex)]);qi=i}
  {const[Tx,Tz]=_tan(par,I(qi)),Q=out[2],dx=nx-Q[0],dz=nz-Q[1],dl=Math.hypot(dx,dz)||1,ux=dx/dl,uz=dz/dl,tx2=Tx*dir,tz2=Tz*dir,dot=tx2*ux+tz2*uz;
   if(dot<.92&&dl>140){const bx=tx2+ux,bz=tz2+uz,bl=Math.hypot(bx,bz)||1,L=Math.max(70,Math.min(170,dl*.32));out.push([Q[0]+bx/bl*L,Q[1]+bz/bl*L])}}
  return out}
/* a T-junction end that touches the parent's edge from the side the branch comes from (instead of overlapping its lanes) */
function edgePt(par,ix,fx,fz){const px=par.X[ix],pz=par.Z[ix],dx=fx-px,dz=fz-pz,l=Math.hypot(dx,dz)||1,e=par.hw*par.wk[ix]+1.0;return[px+dx/l*e,pz+dz/l*e]}
/* a boulevard round a district: every street of the district ends on it */
function perimeter(id,B,hw,lift){const r=30,P=[];
  const edge=(ax,az,bx,bz)=>{const L=Math.hypot(bx-ax,bz-az),k=Math.max(1,Math.ceil(L/70));for(let i=0;i<k;i++)P.push([ax+(bx-ax)*i/k,az+(bz-az)*i/k])};
  const arc=(cx,cz,a0)=>{for(let i=0;i<=4;i++){const a=a0+i*Math.PI/8;P.push([cx+Math.cos(a)*r,cz+Math.sin(a)*r])}};
  edge(B.x0+r,B.z0,B.x1-r,B.z0);arc(B.x1-r,B.z0+r,-Math.PI/2);edge(B.x1,B.z0+r,B.x1,B.z1-r);arc(B.x1-r,B.z1-r,0);edge(B.x1-r,B.z1,B.x0+r,B.z1);arc(B.x0+r,B.z1-r,Math.PI/2);edge(B.x0,B.z1-r,B.x0,B.z0+r);arc(B.x0+r,B.z0+r,Math.PI);
  P.pop();   /* the last arc point is the first edge point */
  const road=buildRoad({id,closed:1,hw,lanes:2,style:4,city:1,cityField:1,lift,pts:P});for(let i=0;i<road.n;i+=3)cityEnds.push([road.X[i],road.Z[i],id]);return road}
/* a small turnaround loop at the end of a road */
function loopRoad(id,cx,cz,r,hw,lift){const P=[];for(let k=0;k<8;k++){const a=k*TAU/8;P.push([cx+Math.cos(a)*r,cz+Math.sin(a)*r])}return buildRoad({id,closed:1,hw,lanes:1,style:0,lift,pts:P})}
function defineRoads(){
  ROADS.length=0;GRIDS.length=0;cityEnds.length=0;_cj=null;SAFEHOUSES.length=0;FARMS.length=0;FIELDS.length=0;
  const ring=buildCurvy({id:'ring',closed:1,hw:13,lanes:3,style:1,smooth:120,minR:75,humps:[{f:.64,n:3,len:68,amp:6}],wig:{a1:430,l1:900,a2:120,l2:360,seed:3,straight:[[.60,.72]]},
    pts:[[-1640,120],[-1560,-520],[-1180,-980],[-620,-1260],[-60,-1380],[560,-1290],[1130,-1020],[1520,-540],[1680,60],[1560,700],[1320,1260],[700,1580],[-30,1560],[-640,1400],[-1160,1050],[-1500,600]]});
  const ramp=(par,hx,hz,nx,nz,hw)=>rampPts(par,jn(par,hx,hz),nx,nz,hw);          /* leave a road at the sample nearest (hx,hz), heading for (nx,nz) */
  const rampIn=(par,hx,hz,px,pz,hw)=>rampPts(par,jn(par,hx,hz),px,pz,hw).reverse(); /* arrive onto a road at the sample nearest (hx,hz), coming from (px,pz) */
  const tIn=(par,px,pz)=>edgePt(par,jn(par,px,pz),px,pz);  /* T-end touching a road's edge, on the side the branch comes from */
  /* ===== San Francisco style downtown: a boulevard round the box, two street grids that meet along the diagonal Market Street ===== */
  const M=MARKET,ml=Math.hypot(M.x1-M.x0,M.z1-M.z0),mdx=(M.x1-M.x0)/ml,mdz=(M.z1-M.z0)/ml,nx=-mdz,nz=mdx,c0=nx*M.x0+nz*M.z0;   /* n points to the south-east of Market */
  const cutPark={x0:PARK.x0-2,z0:381,x1:PARK.x1+2,z1:464};   /* the park interior: the two streets along its edges (Fulton, Lincoln) stay, the cross streets stop at them */
  const us=[],vs=[];for(let x=-1290;x<=-470;x+=125)us.push(x);for(let z=-130;z<=690;z+=85)vs.push(z);
  const gN=gridStreets({id:'sfn',kind:'sfN',ox:0,oz:0,ang:0,us,vs,hw:7.5,style:3,lift:.02,planes:planesBox(CITY).concat([[nx,nz,c0]]),cut:[cutPark]});
  const us2=[],vs2=[];for(let u=0;u<=ml;u+=125)us2.push(u);for(let k=0;k<9;k++)vs2.push(42.5+85*k);
  const gS=gridStreets({id:'sfs',kind:'sfS',ox:M.x0,oz:M.z0,ang:Math.atan2(mdz,mdx),us:us2,vs:vs2,hw:7.5,style:3,lift:.03,planes:planesBox(CITY).concat([[-nx,-nz,-c0]]),cut:[cutPark]});
  buildRoad({id:'market',hw:M.hw,lanes:2,style:4,city:1,cityField:1,lift:.015,pts:[[M.x0,M.z0],[M.x1,M.z1]]});cityEnds.push([M.x0,M.z0,'market'],[M.x1,M.z1,'market']);
  const sfp=perimeter('sfp',CITY,11,.025);
  /* Lombard Street: eight hairpins down one block of Russian Hill, joining the two streets above and below it */
  {let bi=0,bj=0,bd=1e18;for(let i=0;i<us.length-1;i++)for(let j=0;j<vs.length-1;j++){const d=((us[i]+us[i+1])/2+1090)**2+((vs[j]+vs[j+1])/2+5)**2;if(d<bd){bd=d;bi=i;bj=j}}
    gN.skip=[bi+','+bj];const xc=(us[bi]+us[bi+1])/2,z0=vs[bj],z1=vs[bj+1],pts=[[xc,z0]];const nzz=7;for(let k=1;k<nzz;k++){pts.push([xc+(k%2?-30:30),z0+(z1-z0)*k/nzz])}pts.push([xc,z1]);
    buildRoad({id:'lombard',hw:3.8,lanes:1,style:2,lift:.05,yLine:[Hs(xc,z0)+.02,Hs(xc,z1)+.02],pts});gN.lombard={xc,z0,z1,bi,bj}}
  /* Golden Gate Park drive: from the ring road through the park to Lincoln Way */
  buildRoad({id:'jfk',hw:5.5,lanes:1,style:0,from:'ring',yTo:'sfp',lift:.05,smooth:25,
    pts:ramp(ring,-1480,446,-1440,449,5.5).concat([[-1440,449],[-1392,444]]).concat([tIn(sfp,-1392,444)])});
  buildRoad({id:'jfkp',hw:5.5,lanes:1,style:0,yFrom:'sfp',yTo:'sfnv7',lift:.05,smooth:25,
    pts:[tIn(sfp,-1270,444),[-1262,446],[-1212,452],[-1162,444],[-1116,451],[-1082,454],[-1078,465]]});
  /* Twin Peaks Boulevard: out of the grid, a loop up over the two peaks and back down into the grid */
  {const e1=nearEnd(-760,700),e2=nearEnd(-552,700);buildRoad({id:'tp',hw:5.5,lanes:1,style:0,smooth:18,grade:.22,lift:.05,yFrom:e1[2],yTo:e2[2],pts:[[e1[0],e1[1]],[-762,738],[-735,772],[-690,792],[-650,772],[-620,802],[-640,836],[-598,862],[-556,838],[-540,800],[-547,758],[e2[0],e2[1]]]})}
  /* ===== the long highways ===== */
  /* Geary: ring (west) -> the downtown boulevard */
  buildCurvy({id:'dc',hw:10,lanes:2,style:1,from:'ring',yTo:'sfp',lift:.03,minR:45,wig:{a1:40,l1:240,a2:14,l2:110,seed:8,fade:130},
    pts:ramp(ring,-1480,195,-1410,212,10).concat([[-1410,212],[-1360,220],[CITY.x0,222]])});
  /* the boulevard: Market's north-east end -> east across the hills to the ring */
  const bv=buildCurvy({id:'bv',hw:10,lanes:2,style:1,to:'ring',yFrom:'sfp',lift:.04,smooth:70,minR:55,wig:{a1:230,l1:560,a2:70,l2:230,seed:5,fade:200},
    pts:[[CITY.x1,-6],[-390,0],[-300,60],[-180,170],[60,150],[300,225],[620,200],[980,130],[1300,90]].concat(rampIn(ring,1440,50,1300,90,10))});
  /* the mountain pass: out of the ring in the north-east, up the switchbacks, down the north coast and back onto the ring in the north-west */
  const sb=switchbacks(1950,-1950,[[2.25,1.42,1040],[1.42,2.5,860],[2.5,1.5,700],[1.5,2.35,600]]);   /* the fan starts just outside the ring, so the pass leaves the ring and never has to cross it */
  buildCurvy({id:'mp',hw:8.5,lanes:1,style:0,from:'ring',to:'ring',lift:.05,smooth:50,grade:.145,minR:0,wig:{a1:100,l1:520,a2:30,l2:200,seed:13,fade:300},
    pts:ramp(ring,sb[0][0],sb[0][1],sb[4][0],sb[4][1],8.5).concat(sb.slice(4)).concat([[1420,-1700],[1250,-1950],[1000,-2180],[650,-2420],[200,-2540],[-300,-2480],[-760,-2300],[-1110,-1960],[-1260,-1480]]).concat(rampIn(ring,-1235,-1260,-1260,-1480,8.5))});
  /* Mulholland: very twisty ridge road, off the ring and down onto the boulevard */
  {const bi=jn(bv,520,130);buildCurvy({id:'mh',hw:7,lanes:1,style:0,from:'ring',to:'bv',lift:.09,smooth:35,grade:.13,minR:34,wig:{a1:120,l1:380,a2:34,l2:150,seed:31,fade:260},
    pts:ramp(ring,1480,-190,1330,-170,7).concat([[1330,-170],[1160,-195],[990,-150],[820,-135],[670,-100],[570,-70],[520,-10]]).concat([tIn(bv,520,-10)])})}
  /* the southern highway: ring (south) -> long straight on the plains -> a turnaround loop at the beach lookout; the east link meets it from the north */
  const sh=buildCurvy({id:'sh',hw:12,lanes:2,style:1,from:'ring',lift:.07,smooth:150,grade:.05,minR:85,humps:[{f:.53,n:3,len:68,amp:6},{f:.76,n:3,len:68,amp:6}],wig:{a1:220,l1:700,a2:60,l2:260,seed:23,straight:[[.52,.88]],fade:260},
    pts:ramp(ring,40,1850,40,1850,12).concat([[300,2260],[800,2420],[1500,2440],[2100,2420],[2500,2420],[2610,2418]])});
  loopRoad('lookout',2650,2418,40,6,.09);
  /* the east link: ring (east) -> south along the east side -> onto the southern highway */
  const el=buildCurvy({id:'el',hw:10,lanes:2,style:1,from:'ring',to:'sh',yFrom:null,lift:.08,smooth:100,minR:65,humps:[{f:.66,n:3,len:68,amp:6}],wig:{a1:230,l1:620,a2:66,l2:250,seed:29,straight:[[.62,.80]],fade:200},
    pts:ramp(ring,2000,1060,2000,1060,10).concat([[2000,1060],[2300,1560],[2410,2000],[2412,2280],tIn(sh,2412,2280)])});
  /* the coast road (Highway 1 style): out of Market's south-west end, over the ring, along the beach, round a headland and onto the southern highway */
  {buildCurvy({id:'cr',hw:9,lanes:1,style:0,to:'sh',yFrom:'sfp',lift:.06,smooth:70,minR:45,bridgeOver:['ring'],wig:{a1:190,l1:480,a2:60,l2:200,seed:17,fade:200},
    pts:[[M.x0,M.z0],[-1275,742],[-1380,790],[-1560,1000],[-1790,1250],[-1900,1600],[-1840,2000],[-1560,2300],[-1100,2470],[-560,2432],[-80,2400],[230,2452],[420,2438],[540,2398]].concat([tIn(sh,540,2398)])})}
  /* ===== the Valley: LA style boulevards, ringed by a boulevard that joins the boulevard road and the ring ===== */
  const vu=[275,575,875,1015],vv=[565,825,1085,1245];
  gridStreets({id:'la',kind:'la',ox:0,oz:0,ang:0,us:vu,vs:vv,hw:12,style:4,lift:.05,planes:planesBox(VALLEY)});
  const lap=perimeter('lap',VALLEY,11,.055);
  buildCurvy({id:'lan',hw:9,lanes:1,style:0,to:'bv',yFrom:'lap',lift:.1,minR:50,wig:{a1:24,l1:300,a2:7,l2:120,seed:37,fade:120},pts:[[640,VALLEY.z0],[622,470],[590,380],[600,300],tIn(bv,600,300)]});
  buildCurvy({id:'lae',hw:10,lanes:2,style:1,to:'ring',yFrom:'lap',lift:.11,minR:60,wig:{a1:40,l1:420,a2:10,l2:170,seed:41,fade:160},pts:[[VALLEY.x1,826],[1150,800],[1300,745]].concat(rampIn(ring,1300,745,1300,745,10))});
  /* ===== Santa Cruz: a beach town on the south coast with a boardwalk and a pier ===== */
  const bu=[-470,-390,-310,-230,-170],bvv=[2580,2645,2710];
  gridStreets({id:'bt',kind:'beach',ox:0,oz:0,ang:0,us:bu,vs:bvv,hw:6,style:3,lift:.05,planes:planesBox(BEACH)});
  perimeter('btp',BEACH,8,.055);
  {const c=ROADS.find(q=>q.id=='cr');buildRoad({id:'btl',hw:7,lanes:1,style:0,lift:.07,yFrom:'cr',yTo:'btp',pts:[tIn(c,-350,BEACH.z0),[-350,BEACH.z0]]})}
  /* the pier: out over the water from the boardwalk (a bridge deck on piles, with a T-shaped head to turn round on) */
  {const bp=ROADS.find(q=>q.id=='btp'),e=tIn(bp,-350,BEACH.z1+60),yd=Math.max(Hs(-350,BEACH.z1+4),3.2)+.2,zh=BEACH.z1+205;
   buildRoad({id:'pier',hw:5,lanes:1,style:2,flat:yd,lift:.04,bridge:[{x:-350,z:BEACH.z1+110,len:500,h:0}],pts:[e,[-350,BEACH.z1+110],[-350,zh]]});
   buildRoad({id:'pierhead',hw:5,lanes:1,style:2,flat:yd,lift:.04,bridge:[{x:-350,z:zh,len:500,h:0}],pts:[[-387,zh],[-350,zh],[-313,zh]]})}
  /* ===== Palm Springs: a desert resort town of wide palm boulevards, joined to the east link and the southern highway ===== */
  gridStreets({id:'ps',kind:'ps',ox:0,oz:0,ang:0,us:[1440,1620,1800],vs:[1480,1660,1840],hw:12,style:4,lift:.05,planes:planesBox(RESORT)});
  perimeter('psp',RESORT,11,.055);
  buildCurvy({id:'psl',hw:9,lanes:1,style:0,to:'el',yFrom:'psp',lift:.1,minR:50,wig:{a1:30,l1:300,a2:8,l2:120,seed:43,fade:120},pts:[[RESORT.x1,1660],[1980,1650],[2100,1610],tIn(el,2100,1610)]});
  buildCurvy({id:'pss',hw:9,lanes:1,style:0,to:'sh',yFrom:'psp',lift:.1,minR:50,wig:{a1:40,l1:320,a2:10,l2:130,seed:47,fade:140},pts:[[1620,RESORT.z1],[1612,2060],[1630,2250],tIn(sh,1630,2250)]});
  defineWorld(ring,sh,{ramp,rampIn,tIn});
  const fixed=fixCrossings();if(typeof console!=='undefined'&&fixed.length&&window.__dbg)console.log('bridges added:',fixed.join('; '));BRIDGES_ADDED=fixed;findJumps();
  return GRIDS}
let BRIDGES_ADDED=[];
/* where the jump hills are: [x,z,radius] (for the map and the region name) */
const JUMPZ=[];
function findJumps(){JUMPZ.length=0;for(const r of ROADS){if(!r.def||!r.def.humps)continue;for(const h of r.def.humps){const s0=h.f*r.len,s1=s0+h.n*h.len;let a=0,b=0;for(let i=0;i<r.n;i++){if(r.S[i]<=s0)a=i;if(r.S[i]<=s1)b=i}
      JUMPZ.push([(r.X[a]+r.X[b])/2,(r.Z[a]+r.Z[b])/2,Math.hypot(r.X[a]-r.X[b],r.Z[a]-r.Z[b])/2+60])}}}
const roadById=id=>ROADS.find(r=>r.id==id);
