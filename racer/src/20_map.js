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
/* three more cities, each with its own look (world 1c) */
const CITY_VEG={x0:3960,z0:1820,x1:4480,z1:2400};        /* Las Vegas: a neon casino strip in the south-east desert */
const CITY_SAC={x0:70,z0:-2240,x1:540,z1:-1800};         /* Sacramento: a brick capital city with a domed capitol, north of the ring */
const CITY_SJ={x0:-380,z0:-930,x1:240,z1:-450};          /* San Jose: glass tech campuses round a ring-shaped headquarters, inside the ring */
/* batch 8: four more towns on the long empty highways (each joined to the network at two points, so the highway runs through a town instead of past nothing) */
const TOWN_GIL={x0:-900,z0:1750,x1:-560,z1:2050};      /* Gilroy: a farm town between the ring and the coast road */
const TOWN_IND={x0:1950,z0:1950,x1:2250,z1:2250};       /* Indio: a desert town between the southern highway and the east loop */
const TOWN_HES={x0:2380,z0:-300,x1:2720,z1:40};         /* Hesperia: on the east highway to Barstow, on a levelled shelf */
const TOWN_TAH={x0:500,z0:-3000,x1:820,z1:-2720};       /* Tahoe: a pine village in the northern foothills, between Big Pines and the pass */
const TOWN_BIS={x0:1850,z0:-3050,x1:2150,z1:-2800};      /* Bishop: a mountain town on the new northern highway from Tahoe to the canyon rim */
const TERRACES=[[-190,-3125,380,85],[2550,-130,380,18],[660,-2860,360,70],[2000,-2925,330,155]];                   /* flattened sites: x,z,radius,height */
const ZONES=[{b:TOWN_PAC,c:[.30,.27,.22]},{b:TOWN_FRE,c:[.26,.24,.19]},{b:TOWN_BAR,c:[.33,.27,.19]},{b:TOWN_BIG,c:[.2,.2,.19]},{b:IND_HAR,c:[.2,.2,.2]},{b:IND_MOJ,c:[.25,.23,.2]},{b:CITY_VEG,c:[.3,.25,.19],d:.85},{b:CITY_SAC,c:[.19,.2,.17],d:.8},{b:CITY_SJ,c:[.2,.22,.2],d:.8},{b:TOWN_GIL,c:[.27,.25,.19],d:.7},{b:TOWN_IND,c:[.33,.28,.2],d:.7},{b:TOWN_HES,c:[.29,.26,.2],d:.7},{b:TOWN_TAH,c:[.2,.2,.19],d:.7},{b:TOWN_BIS,c:[.22,.21,.19],d:.7}];   /* ground colour (linear) inside each */
const FIELDS=[];                                        /* farm fields: {b,c:[[r,g,b],[r,g,b]]} (filled in with the farm roads) */
const FARMS=[];                                         /* {x,z,cs,sn}: a barn, silo, house and shed */
const SAFEHOUSES=[],REPAIRS=[],RSTOPS=[];   /* RSTOPS (batch 8): roadside stops on the long empty roads: gas stations, diners, motels, a few houses */
//   /* REPAIRS: the drive-through repair shops (batch 7), picked beside the main roads by pickRepairs() */                                    /* {id,name,x,z,yaw} filled in by defineWorld */
const inBox=(x,z,B,m)=>x>B.x0-m&&x<B.x1+m&&z>B.z0-m&&z<B.z1+m&&(!B.pl||polySd(B.pl,x,z)>-m);
/* batch 16: the old districts get an irregular outline: the box with its corners cut at different angles and an edge or two pushed out (convex, so the street grids still clip
   with planes). B.poly: the corners, clockwise from the north-west; B.pl: the planes [nx,nz,c] (outward normal). Every point where a road joins stays on an uncut stretch of the edge. */
function polyPlanes(V){let ax=0,az=0;for(const v of V){ax+=v[0]/V.length;az+=v[1]/V.length}return V.map((a,i)=>{const b=V[(i+1)%V.length];let nx=b[1]-a[1],nz=-(b[0]-a[0]);const l=Math.hypot(nx,nz);nx/=l;nz/=l;if(nx*(ax-a[0])+nz*(az-a[1])>0){nx=-nx;nz=-nz}return[nx,nz,nx*a[0]+nz*a[1]]})}
function polySd(pl,x,z){let m=1e9;for(const p of pl){const d=p[2]-(p[0]*x+p[1]*z);if(d<m)m=d}return m}   /* how far inside (negative: outside, roughly) */
function setPoly(B,V){B.poly=V;B.pl=polyPlanes(V)}
setPoly(CITY,[[-1180,-170],[-900,-202],[-640,-170],[-470,-60],[-470,430],[-520,700],[-1290,700],[-1330,650],[-1330,168]]);
setPoly(VALLEY,[[420,520],[860,520],[1050,680],[1050,1000],[905,1290],[400,1290],[230,1150],[205,925],[230,700]]);
setPoly(BEACH,[[-450,2540],[-200,2540],[-130,2602],[-130,2780],[-520,2780],[-520,2618]]);
setPoly(RESORT,[[1525,1420],[1765,1420],[1860,1515],[1860,1775],[1752,1900],[1500,1900],[1380,1810],[1380,1565]]);
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
/* smooth a road's height profile (binomial filter, about 30 m wide): the slope clamps that follow the terrain leave kinks (a slope that flips from +22 % to +6 % again and again, a crest only 15 m in radius that throws a car into the air).
   The first and last few samples keep their heights, so a road still meets the road it joins flush. */
function vSmooth(Y,ds,closed,pins){const n=Y.length,passes=Math.round(Math.pow(28/ds,2));let A=Float32Array.from(Y),B=new Float32Array(n);
  /* beyond the ends the profile continues as a point reflection (2 y0 - y), which keeps the end height and the end slope exactly while the inside is smoothed */
  const at=(a,i)=>closed?a[(i%n+n)%n]:(i<0?2*a[0]-a[-i]:i>=n?2*a[n-1]-a[2*(n-1)-i]:a[i]);
  for(let p=0;p<passes;p++){for(let i=0;i<n;i++)B[i]=(at(A,i-2)+4*at(A,i-1)+6*A[i]+4*at(A,i+1)+at(A,i+2))/16;const t=A;A=B;B=t}
  for(let i=0;i<n;i++)Y[i]=A[i]}
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
  /* the parent's height under a point (projected on its centre-line, not the nearest sample: on a 30 % street 4 m of sample spacing is a 0.3 m step) and the distance to it */
  const under=(rr,x,z)=>{let bd=1e18,by=0;const c=rr.closed?rr.n:rr.n-1;for(let k=0;k<c;k++){const j=(k+1)%rr.n,ax=rr.X[k],az=rr.Z[k],ex=rr.X[j]-ax,ez=rr.Z[j]-az,l2=ex*ex+ez*ez||1;let t=((x-ax)*ex+(z-az)*ez)/l2;t=t<0?0:t>1?1:t;const dd=(x-ax-ex*t)**2+(z-az-ez*t)**2;if(dd<bd){bd=dd;const l=Math.sqrt(l2),lat=((x-ax)*(-ez)+(z-az)*ex)/l,lim=rr.hw+Math.max(RSH,rr.sw);by=rr.Y[k]+(rr.Y[j]-rr.Y[k])*t+clamp(lat,-lim,lim)*(rr.cf[k]+(rr.cf[j]-rr.cf[k])*t)}}return[Math.sqrt(bd),by]};
  const yf=d.from||d.yFrom,yt=d.to||d.yTo;if(d.yLine)for(let i=0;i<n;i++)Y[i]=lerp(d.yLine[0],d.yLine[1],r.S[i]/r.len);
  {const ra=yf&&ROADS.find(q=>q.id==yf),rb=yt&&ROADS.find(q=>q.id==yt);
   if(ra||rb)for(let i=0;i<n;i++){const s0=r.S[i],s1=r.len-r.S[i],f=s0/r.len;let wa=0,wb=0,ya=0,yb=0;
     if(ra&&s0<=320){const q=under(ra,X[i],Z[i]);ya=q[1];wa=1-Math.max(sstep(8,170,q[0]),sstep(150,320,s0))}
     if(rb&&s1<=320){const q=under(rb,X[i],Z[i]);yb=q[1];wb=1-Math.max(sstep(8,170,q[0]),sstep(150,320,s1))}
     /* a short connector is pulled by both ends: each end rules its own half (the far end used to drag the near end off its road by up to half a metre) */
     if(ra&&rb){wa*=1-sstep(.2,.6,f);wb*=sstep(.4,.8,f)}
     Y[i]=Y[i]*(1-wa)*(1-wb)+ya*wa*(1-wb)+yb*wb}}
  if((yf||yt)&&d.flat==null&&!d.cityField&&!d.yLine){const g=(d.grade||.085)*ds,p0=Y[0],p1=Y[n-1];for(let it=0;it<3;it++){if(yf)Y[0]=p0;for(let i=1;i<n;i++)Y[i]=clamp(Y[i],Y[i-1]-g,Y[i-1]+g);if(yt)Y[n-1]=p1;for(let i=n-2;i>=0;i--)Y[i]=clamp(Y[i],Y[i+1]-g,Y[i+1]+g)}}
  if(d.flat==null&&!d.cityField&&!d.yLine)vSmooth(Y,ds,!!d.closed,(yf?1:0)|(yt?2:0));
  /* the smoothing lets the hill beyond leak into the junction (a mountain road was already 0.4-0.8 m off its parent at the parent's edge): across the parent's width the branch takes the parent's
     height exactly, and it eases to its own profile over the next 30 m */
  if(!d.cityField&&!d.yLine)for(const[ref,fromStart]of[[yf,true],[yt,false]]){const rr=ref&&ROADS.find(q=>q.id==ref);if(!rr)continue;
    for(let q=0;q<n;q++){const i=fromStart?q:n-1-q,sd=fromStart?r.S[i]:r.len-r.S[i];if(sd>rr.hw+46)break;const u=under(rr,X[i],Z[i]);Y[i]=lerp(u[1],Y[i],sstep(rr.hw+3,rr.hw+34,u[0]))}}
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
  /* width ramps in over the first stretch of a branch so it merges like a slip road */
  r.wk=new Float32Array(n).fill(1);
  if(d.from&&d.taper)for(let i=0;i<n;i++)r.wk[i]=lerp(.25,1,sstep(0,120,r.S[i]));
  if(d.to&&d.taper)for(let i=0;i<n;i++)r.wk[i]=Math.min(r.wk[i],lerp(.25,1,sstep(0,120,r.len-r.S[i])));
  r.rail=new Uint8Array(n);   /* bit0 left, bit1 right: filled in after carving (cliffs) + bridges */
  r.sw=d.city&&d.style!=2?SWW:0;   /* sidewalk width (city streets and boulevards); where it is cut for crossing roads is worked out in buildSidewalks */
  r.cf=new Float32Array(n);   /* cross slope (m per m to the right of the index direction): 0 except where the road runs onto a road that climbs, see findJunctions */
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
const DISTRICT_BOXES=[CITY,VALLEY,BEACH,RESORT,PARK,TOWN_PAC,TOWN_FRE,TOWN_BAR,TOWN_BIG,IND_HAR,IND_MOJ,CITY_VEG,CITY_SAC,CITY_SJ,TOWN_GIL,TOWN_IND,TOWN_HES,TOWN_TAH,TOWN_BIS];
/* every city, town and industrial area with the boulevard round it (the network test routes between every pair of them) */
const PLACES=[{name:'Downtown',road:'sfp',box:CITY},{name:'The Valley',road:'lap',box:VALLEY},{name:'Santa Cruz',road:'btp',box:BEACH},{name:'Palm Springs',road:'psp',box:RESORT},{name:'Pacifica',road:'pacp',box:TOWN_PAC},{name:'Fresno',road:'frep',box:TOWN_FRE},{name:'Barstow',road:'barp',box:TOWN_BAR},{name:'Big Pines',road:'bigp',box:TOWN_BIG},{name:'Harbor',road:'harp',box:IND_HAR},{name:'Mojave Works',road:'mojp',box:IND_MOJ},{name:'Las Vegas',road:'vegp',box:CITY_VEG},{name:'Sacramento',road:'sacp',box:CITY_SAC},{name:'San Jose',road:'sjp',box:CITY_SJ},{name:'Gilroy',road:'gilp',box:TOWN_GIL},{name:'Indio',road:'indp',box:TOWN_IND},{name:'Hesperia',road:'hesp',box:TOWN_HES},{name:'Tahoe',road:'tahp',box:TOWN_TAH},{name:'Bishop',road:'bisp',box:TOWN_BIS}];
/* road ends that are meant to lead nowhere */
const DEAD_OK=['pierhead'];
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
function clipSeg(ax,az,bx,bz,planes){let t0=0,t1=1,p0=-1,p1=-1;for(let q=0;q<planes.length;q++){const[nx,nz,c]=planes[q],da=nx*ax+nz*az-c,db=nx*bx+nz*bz-c;if(da>0&&db>0)return null;if(da>0){const t=da/(da-db);if(t>t0){t0=t;p0=q}}else if(db>0){const t=da/(da-db);if(t<t1){t1=t;p1=q}}}return t0<t1?[t0,t1,p0,p1]:null}   /* [t0,t1, the plane that cut the start, the plane that cut the end] */
function cutRect(ax,az,bx,bz,R){/* remove the part of a segment inside the rectangle: returns pieces as [t0,t1] */
  let t0=0,t1=1;const dx=bx-ax,dz=bz-az;for(const[p,d,lo,hi]of[[ax,dx,R.x0,R.x1],[az,dz,R.z0,R.z1]]){if(Math.abs(d)<1e-9){if(p<lo||p>hi)return[[0,1]];continue}let u0=(lo-p)/d,u1=(hi-p)/d;if(u0>u1){const q=u0;u0=u1;u1=q}t0=Math.max(t0,u0);t1=Math.min(t1,u1)}
  if(t0>=t1)return[[0,1]];const out=[];if(t0>0)out.push([0,t0]);if(t1<1)out.push([t1,1]);return out}
function gridStreets(g){
  const cs=g.cs=Math.cos(g.ang),sn=g.sn=Math.sin(g.ang),toW=(u,v)=>[g.ox+u*cs-v*sn,g.oz+u*sn+v*cs],B=9000;g.roads=[];let idx=0;
  const cand=[];
  const add=(tag,p0,p1,fam,ov)=>{const c=clipSeg(p0[0],p0[1],p1[0],p1[1],g.planes);if(!c)return;const ax=p0[0]+(p1[0]-p0[0])*c[0],az=p0[1]+(p1[1]-p0[1])*c[0],bx=p0[0]+(p1[0]-p0[0])*c[1],bz=p0[1]+(p1[1]-p0[1])*c[1];
    let pieces=[[0,1]];for(const R of(g.cut||[])){const next=[];for(const[a0,a1]of pieces){const sx=ax+(bx-ax)*a0,sz=az+(bz-az)*a0,ex=ax+(bx-ax)*a1,ez=az+(bz-az)*a1;for(const[c0,c1]of cutRect(sx,sz,ex,ez,R))next.push([a0+(a1-a0)*c0,a0+(a1-a0)*c1])}pieces=next}
    for(const[a0,a1]of pieces){const sx=ax+(bx-ax)*a0,sz=az+(bz-az)*a0,ex=ax+(bx-ax)*a1,ez=az+(bz-az)*a1,len=Math.hypot(ex-sx,ez-sz);if(len<34)continue;cand.push({id:g.id+tag+(a0>0||a1<1?'~':''),fam,sx,sz,ex,ez,len,ok:1,ps:a0>0?-1:c[2],pe:a1<1?-1:c[3],ov})}};
  g.us.forEach((u,i)=>add('u'+i,toW(u,-B),toW(u,B),0,g.uw&&g.uw[i]));g.vs.forEach((v,j)=>add('v'+j,toW(-B,v),toW(B,v),1));
  /* ONE FAMILY OF STREETS PER EDGE. Where the grid is not square to the edge that cuts it (the rotated grid against the box, the straight grid against Market Street) the streets along u and
     along v both reached the edge, at irregular spacings: mouths 13-23 m apart on the boulevard with a crossing just behind them, three junctions on top of each other (and on a hill no landing
     could serve them all). Now only the family that meets an edge more squarely opens onto it; a street of the other family stops as a T on the last street it crosses that is at least 40 m
     from that street's own ends (or is left out if that leaves less than 34 m of it). */
  {const fd=[[-sn,cs],[cs,sn]],keep=q=>{const[nx,nz]=g.planes[q];return Math.abs(fd[0][0]*nx+fd[0][1]*nz)>=Math.abs(fd[1][0]*nx+fd[1][1]*nz)-1e-6?0:1};g.trimmed=[];
   for(const P of cand)for(const end of[0,1]){const q=end?P.pe:P.ps;if(q<0)continue;const[nx,nz]=g.planes[q];const ex=end?P.ex:P.sx,ez=end?P.ez:P.sz;
     const nearV=g.verts&&g.verts.some(v=>Math.hypot(v[0]-ex,v[1]-ez)<30);   /* (batch 16: an end on a rounded corner of the boulevard is cut back too) */
     if(!nearV&&(Math.abs(fd[P.fam][0]*nx+fd[P.fam][1]*nz)<.05||Math.abs(fd[1-P.fam][0]*nx+fd[1-P.fam][1]*nz)<.05||keep(q)==P.fam))continue;
     let best=null,bd=1e9;
     for(const Q of cand){if(Q.fam==P.fam||!Q.ok)continue;const k=1.5/(Q.len||1),X=segX(P.sx,P.sz,P.ex,P.ez,Q.sx-(Q.ex-Q.sx)*k,Q.sz-(Q.ez-Q.sz)*k,Q.ex+(Q.ex-Q.sx)*k,Q.ez+(Q.ez-Q.sz)*k);   /* (a street that stops AT this one, cut by the park, counts) */if(!X)continue;if((Q.ps>=0&&Math.hypot(X[0]-Q.sx,X[1]-Q.sz)<40)||(Q.pe>=0&&Math.hypot(X[0]-Q.ex,X[1]-Q.ez)<40))continue;const d=Math.hypot(X[0]-ex,X[1]-ez);if(d<bd){bd=d;best=X}}
     g.trimmed.push(P.id+(end?' end':' start')+(best?' -'+Math.round(bd)+' m':' gone'));
     if(!best){P.ok=0;continue}if(end){P.ex=best[0];P.ez=best[1];P.pe=-1}else{P.sx=best[0];P.sz=best[1];P.ps=-1}P.len=Math.hypot(P.ex-P.sx,P.ez-P.sz);if(P.len<34)P.ok=0}}
  /* (batch 16) an end cut back onto a street that was itself cut back afterwards: cut back again to a street that is still there */
  {const dseg=(x,z,Q)=>{const ex=Q.ex-Q.sx,ez=Q.ez-Q.sz,l2=ex*ex+ez*ez||1;let t=((x-Q.sx)*ex+(z-Q.sz)*ez)/l2;t=t<0?0:t>1?1:t;return Math.hypot(x-Q.sx-ex*t,z-Q.sz-ez*t)};
   for(let it=0;it<3;it++){let ch=0;for(const P of cand){if(!P.ok)continue;for(const end of[0,1]){if((end?P.pe:P.ps)!==-1)continue;const ex=end?P.ex:P.sx,ez=end?P.ez:P.sz;
       if(cand.some(Q=>Q.ok&&Q.fam!=P.fam&&dseg(ex,ez,Q)<2))continue;
       let best=null,bd=1e9;for(const Q of cand){if(Q.fam==P.fam||!Q.ok)continue;const X=segX(P.sx,P.sz,P.ex,P.ez,Q.sx,Q.sz,Q.ex,Q.ez);if(!X)continue;const d=Math.hypot(X[0]-ex,X[1]-ez);if(d<bd){bd=d;best=X}}
       ch=1;if(!best){P.ok=0;break}if(end){P.ex=best[0];P.ez=best[1]}else{P.sx=best[0];P.sz=best[1]}P.len=Math.hypot(P.ex-P.sx,P.ez-P.sz);if(P.len<34){P.ok=0;break}}}if(!ch)break}}
  for(const P of cand){if(!P.ok)continue;const r=buildRoad({id:P.id,hw:P.ov?P.ov.hw:g.hw,lanes:1,style:P.ov?P.ov.style:g.style,city:1,smooth:g.smooth||60,grade:g.grade||.26,lift:g.lift+(idx++)*.0004,cityField:1,pts:[[P.sx,P.sz],[P.ex,P.ez]]});g.roads.push(r);cityEnds.push([P.sx,P.sz,r.id],[P.ex,P.ez,r.id])}
  GRIDS.push(g);return g}
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
/* JOINING A ROAD: a branch runs square onto its parent and ends ON THE PARENT'S CENTRE LINE (like the city streets do), so the asphalt of the two always overlaps and there is never a strip of shoulder across the mouth.
   tJoin returns the two control points of that: J on the parent's centre line (at sample ix) and A, 34 m beyond the parent's edge on the side (fx,fz) is on. The junction box (no lane markings, the median open)
   is made from the list findJunctions() builds. (The old helpers left a 1 m gap at every T, let roads arrive at 12 degrees, and one 'ramp' started as a blunt second road beside the highway.) */
function tJoin(par,ix,fx,fz){const[tx,tz]=_tan(par,ix),px=par.X[ix],pz=par.Z[ix],side=((fx-px)*(-tz)+(fz-pz)*tx)>=0?1:-1,L=par.hw*par.wk[ix]+34;return[[px,pz],[px-tz*side*L,pz+tx*side*L]]}
/* every place a road END sits on another road: {r,e (0 start, 1 end),par,pi,x,z,y,rad}. Two ends on the same spot of the parent make a crossroads. Also sets the cross slope (r.cf) of the branch near its end,
   so its surface lies on the parent's even where the parent climbs (the branch is flat across, the parent is not flat along) */
const JUNC=[];
function findJunctions(){JUNC.length=0;
  for(const r of ROADS){if(r.closed)continue;for(const e of[0,1]){const ie=e?r.n-1:0,x=r.X[ie],z=r.Z[ie];let best=null;
      for(const o of ROADS){if(o===r||o.style==2&&r.style!=2)continue;const c=o.closed?o.n:o.n-1;for(let k=0;k<c;k++){const j=(k+1)%o.n,ax=o.X[k],az=o.Z[k],ex=o.X[j]-ax,ez=o.Z[j]-az,l2=ex*ex+ez*ez||1;let t=((x-ax)*ex+(z-az)*ez)/l2;t=t<0?0:t>1?1:t;
          const dd=Math.hypot(x-ax-ex*t,z-az-ez*t),hw=o.hw*o.wk[k];if(dd>hw+RSH+2.5)continue;const yy=o.Y[k]+(o.Y[j]-o.Y[k])*t;if(Math.abs(yy-r.Y[ie])>3.5)continue;const kk=t>.5?j:k,g=dd-hw+(!o.closed&&(kk<=1||kk>=o.n-2)?100:0);   /* another road's END is the last choice: two ends on one spot of a through road are a crossroads on that road */
          if(!best||g<best.g)best={g,o,k:kk,yy}}}
      if(!best)continue;const o=best.o,k=best.k;JUNC.push({r,e,par:o,pi:k,x:o.X[k],z:o.Z[k],y:best.yy,rad:Math.max(o.hw,r.hw)+1.5,city:r.city&&o.city});
      if(r.city&&o.city)continue;                       /* city streets share one height field: nothing to match */
      /* the parent's grade there, and how much of it lies across the branch */
      const a=o.closed?(k+2)%o.n:Math.min(o.n-1,k+2),b=o.closed?(k-2+o.n)%o.n:Math.max(0,k-2),dl=Math.hypot(o.X[a]-o.X[b],o.Z[a]-o.Z[b])||1,gp=(o.Y[a]-o.Y[b])/dl,px=(o.X[a]-o.X[b])/dl,pz=(o.Z[a]-o.Z[b])/dl,hwP=o.hw*o.wk[k];
      for(let q=0;q<r.n;q++){const i=e?r.n-1-q:q,sd=e?r.len-r.S[i]:r.S[i];if(sd>hwP+40)break;const[tx,tz]=_tan(r,i);r.cf[i]=(gp*(px*(-tz)+pz*tx)+o.cf[k]*(px*tx+pz*tz))*(1-sstep(hwP+2,hwP+38,sd))}}}   /* the parent's plane: its grade and its own cross slope */
  return JUNC}
/* CITY CROSSINGS ARE LANDINGS. The streets of a district take their height from one field along their centre lines, but each street is flat ACROSS, so where two crossed on a hill the edge of one stood
   up to 1.6 m above or below the other (a slab across a 21 % San Francisco street). Like the real city, every crossing is now a nearly level landing: inside the box both streets follow ONE plane
   through the crossing point whose grade along each street is that street's own grade limited to CITY_LAND (8 %); each street eases back to its own profile over the next 14 m and takes the plane's
   cross slope (r.cf). So a steep street climbs in steps (steep, landing, steep), and crossings are flush from curb to curb. Called once per district, right after its streets and boulevard exist
   and BEFORE any other road is joined to them (those copy the boulevard's height). */
const CITY_LAND=.08;let _clFrom=0;
function cityLand(){
  const cr=ROADS.slice(_clFrom).filter(r=>r.city&&r.style!=2&&!r.landed);_clFrom=ROADS.length;if(cr.length<2)return 0;
  const cell=32,H=new Map(),key=(a,b)=>(a+2048)*8192+(b+2048);
  cr.forEach((r,ri)=>{r.landed=1;for(let i=0;i<r.n;i++){const k=key(Math.floor(r.X[i]/cell),Math.floor(r.Z[i]/cell));let L=H.get(k);if(!L)H.set(k,L=[]);L.push(ri,i)}});
  const gradeAt=(r,i)=>{const k=3,a=r.closed?(i+k)%r.n:Math.min(r.n-1,i+k),b=r.closed?(i+r.n-k)%r.n:Math.max(0,i-k);let dl=r.S[a]-r.S[b];if(r.closed&&dl<=0)dl+=r.len;return dl>1?(r.Y[a]-r.Y[b])/dl:0};
  /* the crossings of each street: the sample nearest another street's centre line (within 3.2 m), one per other street and place */
  const nodes=[];
  cr.forEach((A,ai)=>{const last=new Map();for(let i=0;i<A.n;i++){const x=A.X[i],z=A.Z[i],cx=Math.floor(x/cell),cz=Math.floor(z/cell),end=!A.closed&&(i==0||i==A.n-1),best=new Map();
      for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const L=H.get(key(cx+a,cz+b));if(!L)continue;for(let q=0;q<L.length;q+=2){if(L[q]===ai)continue;const o=cr[L[q]],k=L[q+1],d=Math.hypot(o.X[k]-x,o.Z[k]-z);
          if(d<(end?o.hw+2:3.2)){const c=best.get(L[q]);if(!c||d<c.d)best.set(L[q],{k,d})}}}
      for(const[bi,c]of best){const l=last.get(bi);if(l&&i-l.i<=3){if(c.d<l.d){l.i=i;l.k=c.k;l.d=c.d}continue}
        const N={A,i,bi,B:cr[bi],k:c.k,d:c.d};last.set(bi,N);nodes.push(N);
        if(end&&c.d>=3.2)nodes.push({A:cr[bi],i:c.k,bi:ai,B:A,k:i,d:c.d})}}});          /* a street END a few metres off (the rounded corners of a boulevard): the same node seen from the other street */
  if(!nodes.length)return 0;
  /* the plane of each node from the ORIGINAL profiles (all read before anything is changed) */
  for(const N of nodes){const tA=_tan(N.A,N.i),tB=_tan(N.B,N.k);N.yc=(N.A.Y[N.i]-N.A.lift+N.B.Y[N.k]-N.B.lift)/2;N.gA=clamp(gradeAt(N.A,N.i),-CITY_LAND,CITY_LAND);N.gB=clamp(gradeAt(N.B,N.k),-CITY_LAND,CITY_LAND);
    N.dot=tA[0]*tB[0]+tA[1]*tB[1];N.nt=-tA[1]*tB[0]+tA[0]*tB[1]}
  const acc=new Map();
  for(const N of nodes){const A=N.A,hb=N.B.hw+2,R=hb+14,cfN=Math.abs(N.nt)>.3?clamp((N.gB-N.dot*N.gA)/N.nt,-.12,.12):0;let o=acc.get(A);if(!o)acc.set(A,o={w:new Float32Array(A.n),y:new Float32Array(A.n),c:new Float32Array(A.n)});
    for(let i=0;i<A.n;i++){let ds=A.S[i]-A.S[N.i];if(A.closed){if(ds>A.len/2)ds-=A.len;else if(ds<-A.len/2)ds+=A.len}if(Math.abs(ds)>R)continue;const w=1-sstep(hb,R,Math.abs(ds));o.w[i]+=w;o.y[i]+=w*(N.yc+N.gA*ds);o.c[i]+=w*cfN}}
  for(const[A,o]of acc)for(let i=0;i<A.n;i++){const w=o.w[i];if(w<=0)continue;const k=w>1?1/w:1,y0=A.Y[i]-A.lift;A.Y[i]=A.lift+y0*(1-w*k)+o.y[i]*k;A.cf[i]=o.c[i]*k}
  return nodes.length}
/* a boulevard round a district: every street of the district ends on it */
function perimeter(id,B,hw,lift){const r=30,P=[];
  const edge=(ax,az,bx,bz)=>{const L=Math.hypot(bx-ax,bz-az),k=Math.max(1,Math.ceil(L/70));for(let i=0;i<k;i++)P.push([ax+(bx-ax)*i/k,az+(bz-az)*i/k])};
  const arc=(cx,cz,a0)=>{for(let i=0;i<=4;i++){const a=a0+i*Math.PI/8;P.push([cx+Math.cos(a)*r,cz+Math.sin(a)*r])}};
  edge(B.x0+r,B.z0,B.x1-r,B.z0);arc(B.x1-r,B.z0+r,-Math.PI/2);edge(B.x1,B.z0+r,B.x1,B.z1-r);arc(B.x1-r,B.z1-r,0);edge(B.x1-r,B.z1,B.x0+r,B.z1);arc(B.x0+r,B.z1-r,Math.PI/2);edge(B.x0,B.z1-r,B.x0,B.z0+r);arc(B.x0+r,B.z0+r,Math.PI);
  P.pop();   /* the last arc point is the first edge point */
  const road=buildRoad({id,closed:1,hw,lanes:2,style:4,city:1,cityField:1,lift,pts:P});for(let i=0;i<road.n;i+=3)cityEnds.push([road.X[i],road.Z[i],id]);return road}
/* a boulevard round a district's polygon (batch 16): straight edges, every corner rounded */
function perimeterPoly(id,V,hw,lift){const P=[],n=V.length,r=34;
  for(let i=0;i<n;i++){const a=V[(i+n-1)%n],v=V[i],b=V[(i+1)%n],la=Math.hypot(v[0]-a[0],v[1]-a[1]),lb=Math.hypot(b[0]-v[0],b[1]-v[1]),di=[(v[0]-a[0])/la,(v[1]-a[1])/la],dO=[(b[0]-v[0])/lb,(b[1]-v[1])/lb];
    const ph=Math.acos(clamp(di[0]*dO[0]+di[1]*dO[1],-1,1)),f=Math.min(r*Math.tan(ph/2)+6,la*.4,lb*.4),p0=[v[0]-di[0]*f,v[1]-di[1]*f],p1=[v[0]+dO[0]*f,v[1]+dO[1]*f];
    for(let k=0;k<=4;k++){const t=k/4,u=1-t;P.push([u*u*p0[0]+2*u*t*v[0]+t*t*p1[0],u*u*p0[1]+2*u*t*v[1]+t*t*p1[1]])}
    const e0=p1,e1=(()=>{const c=V[(i+2)%n],lc=Math.hypot(c[0]-b[0],c[1]-b[1]),dc=[(c[0]-b[0])/lc,(c[1]-b[1])/lc],ph2=Math.acos(clamp(dO[0]*dc[0]+dO[1]*dc[1],-1,1)),f2=Math.min(r*Math.tan(ph2/2)+6,lb*.4,lc*.4);return[b[0]-dO[0]*f2,b[1]-dO[1]*f2]})();
    const L=Math.hypot(e1[0]-e0[0],e1[1]-e0[1]),k=Math.max(1,Math.ceil(L/70));for(let q=1;q<k;q++)P.push([e0[0]+(e1[0]-e0[0])*q/k,e0[1]+(e1[1]-e0[1])*q/k])}
  const road=buildRoad({id,closed:1,hw,lanes:2,style:4,city:1,cityField:1,lift,pts:P});for(let i=0;i<road.n;i+=3)cityEnds.push([road.X[i],road.Z[i],id]);return road}
/* the outskirts of a district with a polygon (batch 16): houses on the outer side of its boulevard and along the roads leading in (organicTown, kind 'outskirts') */
function outskirts(id,B,theme,per){const g={id,kind:'outskirts',theme,organic:1,box:B,per,roads:[],us:[],vs:[],cx:(B.x0+B.x1)/2,cz:(B.z0+B.z1)/2,cs:1,sn:0,hw:6,phw:per.hw};
  g.ins=(x,z,m)=>polySd(B.pl,x,z)>(m||0);g.sd=(x,z)=>polySd(B.pl,x,z);g.toL=(x,z)=>[x-g.cx,z-g.cz];g.toW=(u,v)=>[g.cx+u,g.cz+v];g.R=()=>1e9;GRIDS.push(g);return g}
/* a small turnaround loop at the end of a road */
function loopRoad(id,cx,cz,r,hw,lift,flat){const P=[];for(let k=0;k<8;k++){const a=k*TAU/8;P.push([cx+Math.cos(a)*r,cz+Math.sin(a)*r])}return buildRoad({id,closed:1,hw,lanes:1,style:0,lift,pts:P,flat:flat==null?undefined:flat})}
function defineRoads(){
  ROADS.length=0;GRIDS.length=0;cityEnds.length=0;_cj=null;_clFrom=0;SAFEHOUSES.length=0;FARMS.length=0;FIELDS.length=0;
  const ring=buildCurvy({id:'ring',closed:1,hw:13,lanes:3,style:1,smooth:120,minR:75,humps:[{f:.64,n:3,len:68,amp:6}],wig:{a1:430,l1:900,a2:120,l2:360,seed:3,straight:[[.60,.72]]},
    pts:[[-1640,120],[-1560,-520],[-1180,-980],[-620,-1260],[-60,-1380],[560,-1290],[1130,-1020],[1520,-540],[1680,60],[1560,700],[1320,1260],[700,1580],[-30,1560],[-640,1400],[-1160,1050],[-1500,600]]});
  const ramp=(par,hx,hz,nx,nz,hw)=>tJoin(par,jn(par,hx,hz),nx,nz);                 /* leave a road at the sample nearest (hx,hz), heading for (nx,nz): [J, A] */
  const rampIn=(par,hx,hz,px,pz,hw)=>tJoin(par,jn(par,hx,hz),px,pz).reverse();      /* arrive onto a road at the sample nearest (hx,hz), coming from (px,pz): [A, J] */
  const tIn=(par,px,pz)=>tJoin(par,jn(par,px,pz),px,pz).reverse();                 /* the same for a point given once: [A, J] (use tOut for a start) */
  const tOut=(par,px,pz)=>tJoin(par,jn(par,px,pz),px,pz);
  const at=(par,q)=>[par.X[q],par.Z[q]];
  /* ===== San Francisco style downtown: a boulevard round the box, two street grids that meet along the diagonal Market Street ===== */
  const M=MARKET,ml=Math.hypot(M.x1-M.x0,M.z1-M.z0),mdx=(M.x1-M.x0)/ml,mdz=(M.z1-M.z0)/ml,nx=-mdz,nz=mdx,c0=nx*M.x0+nz*M.z0;   /* n points to the south-east of Market */
  const cutPark={x0:PARK.x0-2,z0:381,x1:PARK.x1+2,z1:464};   /* the park interior: the two streets along its edges (Fulton, Lincoln) stay, the cross streets stop at them */
  const us=[],vs=[];for(let x=-1290;x<=-470;x+=125)us.push(x);for(let z=-130;z<=690;z+=85)vs.push(z);
  const gN=gridStreets({id:'sfn',kind:'sfN',ox:0,oz:0,ang:0,us,vs,hw:7.5,style:3,lift:.02,planes:CITY.pl.concat([[nx,nz,c0]]),cut:[cutPark],mkI:CITY.pl.length,verts:CITY.poly});
  const us2=[],vs2=[];for(let u=0;u<=ml;u+=125)us2.push(u);for(let k=0;k<9;k++)vs2.push(42.5+85*k);
  const gS=gridStreets({id:'sfs',kind:'sfS',ox:M.x0,oz:M.z0,ang:Math.atan2(mdz,mdx),us:us2,vs:vs2,hw:7.5,style:3,lift:.03,planes:CITY.pl.concat([[-nx,-nz,-c0]]),cut:[cutPark],mkI:CITY.pl.length,verts:CITY.poly});
  buildRoad({id:'market',hw:M.hw,lanes:2,style:4,city:1,cityField:1,lift:.015,pts:[[M.x0,M.z0],[M.x1,M.z1]]});cityEnds.push([M.x0,M.z0,'market'],[M.x1,M.z1,'market']);
  const sfp=perimeterPoly('sfp',CITY.poly,11,.025);cityLand();
  /* Lombard Street: eight hairpins down one block of Russian Hill, joining the two streets above and below it */
  {let bi=0,bj=0,bd=1e18;for(let i=0;i<us.length-1;i++)for(let j=0;j<vs.length-1;j++){const d=((us[i]+us[i+1])/2+1090)**2+((vs[j]+vs[j+1])/2+5)**2;if(d<bd){bd=d;bi=i;bj=j}}
    gN.skip=[bi+','+bj];const xc=(us[bi]+us[bi+1])/2,z0=vs[bj],z1=vs[bj+1],pts=[[xc,z0]];const nzz=7;for(let k=1;k<nzz;k++){pts.push([xc+(k%2?-30:30),z0+(z1-z0)*k/nzz])}pts.push([xc,z1]);
    buildRoad({id:'lombard',hw:3.8,lanes:1,style:2,lift:.05,yLine:[Hs(xc,z0)+.02,Hs(xc,z1)+.02],pts});gN.lombard={xc,z0,z1,bi,bj}}
  /* Golden Gate Park drive: from the ring road through the park to Lincoln Way */
  buildRoad({id:'jfk',hw:5.5,lanes:1,style:0,from:'ring',yTo:'sfp',lift:.05,smooth:25,
    pts:ramp(ring,-1480,446,-1440,449,5.5).concat([[-1440,449]]).concat(tIn(sfp,-1392,444))});
  buildRoad({id:'jfkp',hw:5.5,lanes:1,style:0,yFrom:'sfp',yTo:'sfnv7',lift:.05,smooth:25,
    pts:tOut(sfp,-1270,444).concat([[-1212,452],[-1162,444],[-1116,451],[-1082,454],[-1078,465]])});
  /* Twin Peaks Boulevard: out of the grid, a loop up over the two peaks and back down into the grid */
  {const stEnd=(x,z)=>{let b=null,bd=1e18;for(const e of cityEnds){if(e[2]=='sfp')continue;const d=(e[0]-x)**2+(e[1]-z)**2;if(d<bd){bd=d;b=e}}return b},e1=nearEnd(-760,700),e2=stEnd(-552,700);   /* the east end comes down exactly opposite a street: a crossroads on the boulevard */
   buildRoad({id:'tp',hw:5.5,lanes:1,style:0,smooth:18,grade:.22,lift:.05,yFrom:'sfp',yTo:'sfp',pts:[[e1[0],e1[1]],[-762,738],[-735,772],[-690,792],[-650,772],[-620,802],[-640,836],[-598,862],[-556,838],[-540,800],[-547,758],[e2[0],e2[1]]]})}
  /* ===== the long highways ===== */
  /* Geary: ring (west) -> the downtown boulevard */
  buildCurvy({id:'dc',hw:10,lanes:2,style:1,from:'ring',yTo:'sfp',lift:.03,minR:45,wig:{a1:40,l1:240,a2:14,l2:110,seed:8,fade:130},
    pts:ramp(ring,-1480,195,-1410,212,10).concat([[-1410,210],[-1360,210],[CITY.x0,210]])});   /* arrives opposite the street at z = 210: a crossroads on the downtown boulevard */
  /* the boulevard: Market's north-east end -> east across the hills to the ring */
  const bv=buildCurvy({id:'bv',hw:10,lanes:2,style:1,to:'ring',yFrom:'sfp',lift:.04,smooth:70,minR:55,wig:{a1:230,l1:560,a2:70,l2:230,seed:5,fade:200},
    pts:[[CITY.x1,-6],[-390,0],[-300,60],[-180,170],[60,150],[300,225],[620,200],[980,130],[1300,90]].concat(rampIn(ring,1440,50,1300,90,10))});
  /* the mountain pass: out of the ring in the north-east, up the switchbacks, down the north coast and back onto the ring in the north-west */
  const sb=switchbacks(1950,-1950,[[2.25,1.42,1040],[1.42,2.5,860],[2.5,1.5,700],[1.5,2.35,600]]);   /* the fan starts just outside the ring, so the pass leaves the ring and never has to cross it */
  buildCurvy({id:'mp',hw:8.5,lanes:1,style:0,from:'ring',to:'ring',lift:.05,smooth:50,grade:.145,minR:0,wig:{a1:100,l1:520,a2:30,l2:200,seed:13,fade:300},
    pts:ramp(ring,sb[0][0],sb[0][1],sb[4][0],sb[4][1],8.5).concat(sb.slice(4)).concat([[1420,-1700],[1250,-1950],[1000,-2180],[650,-2420],[200,-2540],[-300,-2480],[-760,-2300],[-1110,-1960],[-1260,-1480]]).concat(rampIn(ring,-1235,-1260,-1260,-1480,8.5))});
  /* Mulholland: very twisty ridge road, off the ring and down onto the boulevard */
  {const bi=jn(bv,520,130);buildCurvy({id:'mh',hw:7,lanes:1,style:0,from:'ring',to:'bv',lift:.09,smooth:35,grade:.13,minR:34,wig:{a1:120,l1:380,a2:34,l2:150,seed:31,fade:260},
    pts:ramp(ring,1480,-190,1330,-170,7).concat([[1330,-170],[1160,-195],[990,-150],[820,-135],[670,-100],[570,-70]]).concat(tIn(bv,520,-60))})}
  /* the southern highway: ring (south) -> long straight on the plains -> a turnaround loop at the beach lookout; the east link meets it from the north */
  const sh=buildCurvy({id:'sh',hw:12,lanes:2,style:1,from:'ring',lift:.07,smooth:150,grade:.05,minR:85,humps:[{f:.53,n:3,len:68,amp:6},{f:.76,n:3,len:68,amp:6}],wig:{a1:220,l1:700,a2:60,l2:260,seed:23,straight:[[.52,.88]],fade:260},
    pts:ramp(ring,40,1850,40,1850,12).concat([[300,2260],[800,2420],[1500,2440],[2100,2420],[2500,2420],[2610,2418]])});
  loopRoad('lookout',2650,2418,40,6,.09,sh.Y[sh.n-1]-sh.lift);   /* flat, at the height the highway arrives at (it used to sit half a metre lower) */
  /* the east link: ring (east) -> south along the east side -> onto the southern highway */
  const el=buildCurvy({id:'el',hw:10,lanes:2,style:1,from:'ring',to:'sh',yFrom:null,lift:.08,smooth:100,minR:65,humps:[{f:.66,n:3,len:68,amp:6}],wig:{a1:230,l1:620,a2:66,l2:250,seed:29,straight:[[.62,.80]],fade:200},
    pts:tJoin(ring,jn(ring,1300,745),2000,1060).concat([[2000,1060],[2300,1560],[2410,2000],[2412,2280]]).concat(tIn(sh,2412,2280))});   /* leaves the ring exactly opposite the Valley's east road (lae): one crossroads */
  /* the coast road (Highway 1 style): out of Market's south-west end, over the ring, along the beach, round a headland and onto the southern highway */
  {buildCurvy({id:'cr',hw:9,lanes:1,style:0,to:'sh',yFrom:'sfp',lift:.06,smooth:70,minR:45,bridgeOver:['ring'],wig:{a1:190,l1:480,a2:60,l2:200,seed:17,fade:200},
    pts:[[M.x0,M.z0],[-1275,742],[-1380,790],[-1560,1000],[-1790,1250],[-1900,1600],[-1840,2000],[-1560,2300],[-1100,2470],[-560,2432],[-80,2400],[230,2452],[400,2462]].concat((q=>tJoin(sh,q,sh.X[q],sh.Z[q]+200).reverse())(jn(sh,560,2400)))})}   /* it used to run onto the highway at 12 degrees */
  /* ===== the Valley: LA style boulevards, ringed by a boulevard that joins the boulevard road and the ring ===== */
  const vu=[275,575,875,1015],vv=[565,825,1085,1245];
  gridStreets({id:'la',kind:'la',ox:0,oz:0,ang:0,us:vu,vs:vv,hw:12,style:4,lift:.05,planes:VALLEY.pl,verts:VALLEY.poly});
  const lap=perimeterPoly('lap',VALLEY.poly,11,.055);cityLand();
  buildCurvy({id:'lan',hw:9,lanes:1,style:0,to:'bv',yFrom:'lap',lift:.1,minR:50,wig:{a1:24,l1:300,a2:7,l2:120,seed:37,fade:120},pts:[[640,VALLEY.z0],[622,470],[590,380],[600,300]].concat(tIn(bv,600,300))});
  buildCurvy({id:'lae',hw:10,lanes:2,style:1,to:'ring',yFrom:'lap',lift:.11,minR:60,wig:{a1:40,l1:420,a2:10,l2:170,seed:41,fade:160},pts:[[VALLEY.x1,826],[1150,800],[1300,745]].concat(rampIn(ring,1300,745,1300,745,10))});
  /* the Valley's south road: straight down to the ring (the Valley used to have no way south: the harbour 1.5 km away was a 5 km drive) */
  buildCurvy({id:'las',hw:9,lanes:1,style:0,to:'ring',yFrom:'lap',lift:.1,minR:50,wig:{a1:16,l1:260,a2:5,l2:110,seed:39,fade:90,hold:60},pts:[[640,VALLEY.z1],[648,1400]].concat(tIn(ring,645,1500))});
  /* ===== Santa Cruz: a beach town on the south coast with a boardwalk and a pier ===== */
  const bu=[-470,-390,-310,-230,-170],bvv=[2580,2645,2710];
  gridStreets({id:'bt',kind:'beach',ox:0,oz:0,ang:0,us:bu,vs:bvv,hw:6,style:3,lift:.05,planes:BEACH.pl,verts:BEACH.poly});
  perimeterPoly('btp',BEACH.poly,8,.055);cityLand();
  {const c=ROADS.find(q=>q.id=='cr');buildRoad({id:'btl',hw:7,lanes:1,style:0,lift:.07,yFrom:'cr',yTo:'btp',pts:[at(c,jn(c,-350,BEACH.z0)),[-350,BEACH.z0]]})}
  /* the pier: out over the water from the boardwalk (a bridge deck on piles, with a T-shaped head to turn round on) */
  {const bp=ROADS.find(q=>q.id=='btp'),e=at(bp,jn(bp,-350,BEACH.z1+60)),yd=Math.max(Hs(-350,BEACH.z1+4),3.2)+.2,zh=BEACH.z1+205;
   buildRoad({id:'pier',hw:5,lanes:1,style:2,flat:yd,lift:.04,bridge:[{x:-350,z:BEACH.z1+110,len:500,h:0}],pts:[e,[-350,BEACH.z1+110],[-350,zh]]});
   buildRoad({id:'pierhead',hw:5,lanes:1,style:2,flat:yd,lift:.04,bridge:[{x:-350,z:zh,len:500,h:0}],pts:[[-387,zh],[-350,zh],[-313,zh]]})}
  /* ===== Palm Springs: a desert resort town of wide palm boulevards, joined to the east link and the southern highway ===== */
  gridStreets({id:'ps',kind:'ps',ox:0,oz:0,ang:0,us:[1440,1620,1800],vs:[1480,1660,1840],hw:12,style:4,lift:.05,planes:RESORT.pl,verts:RESORT.poly});
  perimeterPoly('psp',RESORT.poly,11,.055);cityLand();
  buildCurvy({id:'psl',hw:9,lanes:1,style:0,to:'el',yFrom:'psp',lift:.1,minR:50,wig:{a1:30,l1:300,a2:8,l2:120,seed:43,fade:120},pts:[[RESORT.x1,1660],[1980,1650],[2100,1610]].concat(tIn(el,2100,1610))});
  buildCurvy({id:'pss',hw:9,lanes:1,style:0,to:'sh',yFrom:'psp',lift:.1,minR:50,wig:{a1:40,l1:320,a2:10,l2:130,seed:47,fade:140},pts:[[1620,RESORT.z1],[1612,2060],[1630,2250]].concat(tIn(sh,1630,2250))});
  defineWorld(ring,sh,{ramp,rampIn,tIn,tOut,at});
  outskirts('sfo',CITY,'city',sfp);outskirts('lao',VALLEY,'la',lap);outskirts('bto',BEACH,'coast',ROADS.find(q=>q.id=='btp'));outskirts('pso',RESORT,'desert',ROADS.find(q=>q.id=='psp'));
  const fixed=fixCrossings();findJunctions();if(typeof console!=='undefined'&&fixed.length&&window.__dbg)console.log('bridges added:',fixed.join('; '));BRIDGES_ADDED=fixed;findJumps();
  return GRIDS}
let BRIDGES_ADDED=[];
/* where the jump hills are: [x,z,radius] (for the map and the region name) */
const JUMPZ=[];
function findJumps(){JUMPZ.length=0;for(const r of ROADS){if(!r.def||!r.def.humps)continue;for(const h of r.def.humps){const s0=h.f*r.len,s1=s0+h.n*h.len;let a=0,b=0;for(let i=0;i<r.n;i++){if(r.S[i]<=s0)a=i;if(r.S[i]<=s1)b=i}
      JUMPZ.push([(r.X[a]+r.X[b])/2,(r.Z[a]+r.Z[b])/2,Math.hypot(r.X[a]-r.X[b],r.Z[a]-r.Z[b])/2+60])}}}
const roadById=id=>ROADS.find(r=>r.id==id);
