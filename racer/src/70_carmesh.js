'use strict';
/* ===== procedural car bodies: smooth lofted bodywork, wheel wells, real wheels, lights, intakes, wings, exhausts, mirrors =====
   Nothing here is a real car: every body is made from numbers (a spec) by the same code, in the style of the cars it takes its inspiration from.
   Model axes: x to the right, y up, z BACKWARDS (the nose is at -L/2), metres, origin on the ground under the middle of the wheelbase's centre of the body (z = 0 half way along). */
const CGM={paint:0,glass:1,trim:2,carbon:3,chrome:4,head:5,tail:6,rubber:7,rim:8,caliper:9,exh:10,plate:11,stripe:12,under:13,disc:14,inter:15,steel:16,amber:17,grille:18};
/* per material: colour (sRGB bytes) and [metal, roughness, emissive, clear coat] / 255 for the car shader */
const CGCOL=[[255,255,255],[8,10,14],[20,20,22],[34,35,40],[205,210,216],[255,244,190],[255,34,24],[14,14,15],[188,192,198],[205,28,28],[178,182,188],[230,230,224],[240,240,240],[18,18,20],[150,152,158],[34,34,38],[160,164,170],[255,150,24],[30,30,32]];
const CGMAT=[[140,66,0,255],[215,22,0,0],[0,170,0,0],[70,80,0,160],[235,60,0,0],[0,40,255,60],[0,40,255,60],[0,205,0,0],[215,80,0,40],[70,90,0,140],[240,70,0,0],[0,150,0,0],[120,70,0,230],[0,200,0,0],[200,110,0,0],[0,150,0,40],[225,90,0,0],[0,60,150,0],[110,255,0,0]];
class CGB{constructor(){this.P=[];this.N=[];this.M=[];this.I=[];this.S=[];this.Pt=[];this.cur=0}
  v(x,y,z,nx,ny,nz,m,sh){this.P.push(x,y,z);this.N.push(nx,ny,nz);this.M.push(m);this.S.push(sh==null?1:sh);this.Pt.push(this.cur);return this.M.length-1}
  t(a,b,c){this.I.push(a,b,c)}q(a,b,c,d){this.t(a,b,c);this.t(a,c,d)}
  get nv(){return this.M.length}}
const _cl=(x,a,b)=>x<a?a:x>b?b:x;
/* a smooth curve through points [x, y] (monotone cubic, so no overshoot between the points) */
function cgCurve(pts){const n=pts.length,x=pts.map(p=>p[0]),y=pts.map(p=>p[1]),d=[],m=new Array(n);
  for(let i=0;i<n-1;i++)d[i]=(y[i+1]-y[i])/Math.max(1e-6,x[i+1]-x[i]);
  m[0]=d[0];m[n-1]=d[n-2];for(let i=1;i<n-1;i++)m[i]=d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2;
  for(let i=0;i<n-1;i++){if(d[i]==0){m[i]=m[i+1]=0}else{const a=m[i]/d[i],b=m[i+1]/d[i],s=a*a+b*b;if(s>9){const t=3/Math.sqrt(s);m[i]=t*a*d[i];m[i+1]=t*b*d[i]}}}
  return t=>{if(t<=x[0])return y[0]+(t-x[0])*m[0]*0;if(t>=x[n-1])return y[n-1];let k=0;while(k<n-2&&t>x[k+1])k++;const h=Math.max(1e-6,x[k+1]-x[k]),u=(t-x[k])/h,u2=u*u,u3=u2*u;
    return(2*u3-3*u2+1)*y[k]+(u3-2*u2+u)*h*m[k]+(-2*u3+3*u2)*y[k+1]+(u3-u2)*h*m[k+1]}}
/* normals of a grid of points (rows i along the car, columns j round the ring) from central differences, pointing away from the row's centre */
function cgGridNormals(P,ni,nj,wrap,ctr){const N=new Float32Array(ni*nj*3);
  for(let i=0;i<ni;i++)for(let j=0;j<nj;j++){const i0=Math.max(0,i-1),i1=Math.min(ni-1,i+1);let j0=j-1,j1=j+1;if(wrap){j0=(j0+nj)%nj;j1=(j1+nj)%nj}else{j0=Math.max(0,j0);j1=Math.min(nj-1,j1)}
    const a=(i1*nj+j)*3,b=(i0*nj+j)*3,c=(i*nj+j1)*3,d=(i*nj+j0)*3,ux=P[a]-P[b],uy=P[a+1]-P[b+1],uz=P[a+2]-P[b+2],vx=P[c]-P[d],vy=P[c+1]-P[d+1],vz=P[c+2]-P[d+2];
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const k=(i*nj+j)*3,ox=P[k]-ctr[i*3],oy=P[k+1]-ctr[i*3+1],oz=P[k+2]-ctr[i*3+2];
    let l=Math.hypot(nx,ny,nz);if(l<1e-10){nx=ox;ny=oy;nz=oz;l=Math.hypot(nx,ny,nz)||1}
    if(nx*ox+ny*oy+nz*oz<0){nx=-nx;ny=-ny;nz=-nz}N[k]=nx/l;N[k+1]=ny/l;N[k+2]=nz/l}return N}
/* ---------------- the spec: defaults and the curves derived from the few numbers a car is described by ---------------- */
function cgSpec(o){
  const S=Object.assign({L:4.5,W:1.86,H:1.28,wb:2.45,fo:.92,nose:.56,hood:.80,cowl:1.62,roofF:2.12,roofR:3.0,rearS:3.5,deck:.97,tail:.80,hw0:.80,hwMax:.93,hwMaxS:3.0,hwTail:.82,crown:.09,tum:.09,dip:.012,flare:.035,flareR:.075,crest:.032,crestR:.05,tuck:.03,
    rf:.335,rr:.345,wf:.255,wr:.305,rimF:.235,rimR:.245,tf:.775,tr:.80,sill:.095,gw:.72,gt:.6,
    glassRoof:0,rearGlass:1,bpillar:0,spoke:5,wheelStyle:'spoke',head:'round',tail_:'bar',intake:'mid',wing:'none',duct:0,exh:2,exhS:'twin',louvres:0,stripe:0,mirror:1,diff:1,splitter:1,sideIntake:0,quad:1,grille:'none',drl:0,gills:0,buttress:0,scoop:0,canards:0,shark:0,plates:1,seat:'two',chromeTrim:0,tread:1,lhd:1},o||{});
  S.fz=-S.L/2+S.fo;S.rz=S.fz+S.wb;                        /* axle positions along z (front is negative) */
  S.zs=s=>s-S.L/2;                                         /* s measured from the nose -> z */
  S.hwF=S.W/2;return S}
/* ---------------- the body ---------------- */
function cgTubRing(S,s,K){K=K||S.K||16;
  const gF=Math.exp(-Math.pow((s-S.fo)/.5,2)),gR=Math.exp(-Math.pow((s-(S.fo+S.wb))/.55,2));
  const f=S.curves,hw=f.half(s)+S.fF*gF+S.fR*gR,yb=f.bot(s),yt=f.top(s),crown=S.crown*(s>S.gs0&&s<S.gs1?.35:1),ys=yt-crown,tum=S.tum,rb=Math.min(.06,(ys-yb)*.35);
  /* fender and haunch crests: the shoulder rises over each wheel and the middle of the bonnet and deck sits lower between them (not under the cabin) */
  const cab=1-.85*sstep(S.gs0-.1,S.gs0+.35,s)*(1-sstep(S.gs1-.35,S.gs1+.1,s)),cr=K>8?cab*(S.crest*Math.exp(-Math.pow((s-S.fo)/.6,2))+(S.crestR==null?S.crest:S.crestR)*Math.exp(-Math.pow((s-(S.fo+S.wb))/.62,2))):0;
  /* the side air intake, carved into the flank behind the door (mid-engine cars) */
  const scD=K>8&&S.sideIntake?(.04+.1*S.sideIntake)*Math.exp(-Math.pow((s-(S.roofR+.12))/.34,2)):0;
  const pts=[];pts.push([0,yb]);pts.push([hw*.78,yb]);
  for(let k=1;k<=2;k++){const a=-Math.PI/2+k*Math.PI/6;pts.push([hw-rb+rb*Math.cos(a),yb+rb+rb*Math.sin(a)])}
  const y0=yb+rb,hs=ys-y0,cf=(S.crease==null?1:S.crease)*sstep(.9,1.7,s)*(1-sstep(S.L-1.3,S.L-.45,s))*(K>8?1:0);
  const tw=.4;
  for(let k=0;k<=K;k++){const t=k/K,rid=cf*(.012*Math.exp(-Math.pow((t-.68)/.07,2))-.008*Math.exp(-Math.pow((t-.37)/.06,2))),
      bar=1-S.tuck*Math.pow(Math.max(0,1-t/tw),2)-tum*Math.pow(Math.max(0,(t-tw)/(1-tw)),2),sc=scD*Math.exp(-Math.pow((t-.5)/.19,2));
    pts.push([hw*bar+rid-sc,y0+hs*t+cr*t*t*t])}      /* a barrel section (widest at the hip line), a shoulder crease and a groove above the sill, the crest rising over the wheels, the intake scoop */
  const xs=pts[pts.length-1][0],n=K>8?5.2:3.15;          /* a tighter shoulder radius on the detailed bodies: a flatter top and a crisper edge, like pressed metal */for(let k=1;k<=5;k++){const a=k/5*Math.PI/2,c=Math.cos(a),sn=Math.sin(a),tt=k/5;pts.push([xs*Math.pow(c,2/n),ys+(yt-ys)*Math.pow(sn,2/n)+cr*(1-tt)*(1-tt)-S.dip*cab*tt*tt*(gF+gR>.05?1:0)])}
  return pts}
function cgBodyCurves(S){
  const L=S.L,top=[[0,S.nose*.8],[.18,S.nose*.97],[.5,S.nose+.025],[S.cowl*.5,(S.nose+S.hood)/2+.01],[S.cowl,S.hood],[(S.cowl+S.rearS)/2,(S.hood+S.deck)/2+.02],[S.rearS,S.deck],[L-.4,S.deck-.025],[L,S.tail]];
  const half=[[0,S.hw0*.9],[.35,S.hw0],[S.fo,S.hw0+(S.hwMax-S.hw0)*.35],[S.fo+S.wb*.45,S.hw0+(S.hwMax-S.hw0)*.55],[S.hwMaxS,S.hwMax],[L-.5,S.hwTail],[L,S.hwTail*.94]];
  const bot=[[0,S.sill+.03],[.4,S.sill],[L-.7,S.sill+.01],[L-.25,S.sill+.07],[L,S.sill+.12]];
  S.curves={top:cgCurve(top),half:cgCurve(half),bot:cgCurve(bot)};
  /* wheels sit inside the fenders: at each axle the body is at least as wide as the outside of the tyre, plus a couple of centimetres */
  S.fF=Math.max(S.flare,S.tf+S.wf/2+.024-S.curves.half(S.fo));S.fR=Math.max(S.flareR==null?S.flare:S.flareR,S.tr+S.wr/2+.024-S.curves.half(S.fo+S.wb));return S.curves}
function cgBody(S,mb,opt){
  const L=S.L,K=S.K=opt.lo?(opt.mid?8:5):16;S.gs0=S.cowl;S.gs1=S.rearS;cgBodyCurves(S);const zc=S.curves;
  /* stations along the car: even, with more near the wheels (for the arches) and at the two ends */
  const set=[];const stp=opt.lo?(opt.mid?.21:.3):.1;for(let s=.01;s<L;s+=stp)set.push(s);for(const e of(opt.lo?[.01,.08,.18,L-.01,L-.08,L-.18]:[.006,.02,.045,.09,.16,L-.006,L-.02,L-.045,L-.09,L-.16]))set.push(e);
  for(const ax of[S.fo,S.fo+S.wb]){const r=(ax==S.fo?S.rf:S.rr)+.12;for(let s=ax-r;s<=ax+r+1e-6;s+=opt.lo?(opt.mid?.09:.13):.04)set.push(s)}
  set.sort((a,b)=>a-b);const ss=[];for(const s of set){if(s<=0||s>=L)continue;if(!ss.length||s-ss[ss.length-1]>.018)ss.push(s)}
  const ni=ss.length,rings=[],capF=(S.capF||.34)*.88,capR=(S.capR||.5)*.62;
  for(const s of ss){const r=cgTubRing(S,s,K);let sc=1;const d0=s,d1=L-s;if(d0<capF)sc=Math.pow(1-Math.pow((capF-d0)/capF,2.4),1/2.4);else if(d1<capR)sc=Math.pow(1-Math.pow((capR-d1)/capR,3.4),1/3.4);
    const yb=r[0][1],yt=r[r.length-1][1];const cy=(yb+yt)/2;if(sc<1){const hs=.3+.7*sc;for(const p of r){p[0]*=sc;p[1]=cy+(p[1]-cy)*hs}}rings.push(r)}
  const M=rings[0].length,nj=2*M-2;
  const P=new Float32Array(ni*nj*3),ctr=new Float32Array(ni*3),flag=new Uint8Array(ni*nj),dark=new Float32Array(ni*nj);
  for(let i=0;i<ni;i++){const r=rings[i],z=S.zs(ss[i]);let cy=0;
    for(let j=0;j<nj;j++){let p,sgn=1;if(j<M)p=r[j];else{p=r[2*M-2-j];sgn=-1}const k=(i*nj+j)*3;P[k]=p[0]*sgn;P[k+1]=p[1];P[k+2]=z;cy+=p[1]}
    ctr[i*3]=0;ctr[i*3+1]=cy/nj;ctr[i*3+2]=z}
  /* wheel wells: the side of the body is pushed in where a wheel is (the wheel sits in the opening), and those cells are painted dark */
  const wheels=[[S.fz,S.rf,S.wf,S.tf],[S.rz,S.rr,S.wr,S.tr]];
  for(let i=0;i<ni;i++)for(let j=0;j<nj;j++){const k=(i*nj+j)*3,x=P[k],y=P[k+1],z=P[k+2];
    for(const[wz,R,w,tx]of wheels){const ra=R+.062,dz=z-wz,dy=y-R,dd=Math.sqrt(dz*dz+dy*dy)-ra;if(dd<.02&&Math.abs(x)>tx-w/2-.01){const xin=tx-w/2-.035,t=_cl(-(dd-.02)/.09,0,1),e=t*t*(3-2*t);P[k]=Math.sign(x)*(Math.abs(x)*(1-e)+Math.min(Math.abs(x),xin)*e);flag[i*nj+j]=1}   /* a smooth slope into the arch, not a step */
      /* the arch edge is shaded dark with a smooth ramp (a gradient of the vertex colour, not a ring of dark squares) */
      if(Math.abs(x)>tx-w/2-.06){const t=_cl(.5-dd/.04,0,1);dark[i*nj+j]=Math.max(dark[i*nj+j],t*t*(3-2*t))}}
    /* a livery with a dark lower body (police cars) */
    if(S.lowerDark&&Math.abs(P[k])>.3){const t=_cl((S.lowerDark-y)/.05,0,1);dark[i*nj+j]=Math.max(dark[i*nj+j],t*t*(3-2*t)*.96)}
    /* dark lower valances at the nose and the tail */
    if(!S.noSkirt){const sN=z+L/2,t=Math.max(_cl((S.sill+.30-y)/.07,0,1)*_cl((.75-sN)/.25,0,1),_cl((S.sill+.44-y)/.08,0,1)*_cl((sN-(L-.7))/.25,0,1));if(t>0)dark[i*nj+j]=Math.max(dark[i*nj+j],t*t*(3-2*t)*.92)}
    if(S.cladding){const t=_cl((S.sill+S.cladding-y)/.05,0,1);dark[i*nj+j]=Math.max(dark[i*nj+j],t*t*(3-2*t)*.93)}
    /* black side skirts: a ramp up the lower side */
    if(!S.noSkirt&&Math.abs(P[k])>.35){const t=_cl((S.sill+.23-y)/.1,0,1);dark[i*nj+j]=Math.max(dark[i*nj+j],t*t*(3-2*t)*.92)}}
  const Nn=cgGridNormals(P,ni,nj,true,ctr);
  /* vertices per (grid point, material) so that materials can change across a cell without breaking the smooth shading */
  const map=new Map();const vtx=(i,j,m)=>{const key=(i*nj+j)*16+m;let v=map.get(key);if(v===undefined){const k=(i*nj+j)*3;v=mb.v(P[k],P[k+1],P[k+2],Nn[k],Nn[k+1],Nn[k+2],m,1-.93*dark[i*nj+j]);map.set(key,v)}return v};
  const sw=S.stripe?S.stripe:0;
  for(let i=0;i<ni-1;i++){for(let j=0;j<nj;j++){const j1=(j+1)%nj,k0=(i*nj+j)*3,k1=(i*nj+j1)*3,k2=((i+1)*nj+j1)*3,k3=((i+1)*nj+j)*3;
      const cx=(P[k0]+P[k1]+P[k2]+P[k3])/4,cy=(P[k0+1]+P[k1+1]+P[k2+1]+P[k3+1])/4,cz=(P[k0+2]+P[k1+2]+P[k2+2]+P[k3+2])/4;
      let m=CGM.paint;const jj=j<M?j:2*M-2-j,sd=Math.abs(cx),carved=flag[i*nj+j]||flag[i*nj+j1]||flag[(i+1)*nj+j]||flag[(i+1)*nj+j1];
      if(jj<=1)m=CGM.under;                                                            /* the floor */
      else if(jj<=3&&cy<S.sill+.1)m=CGM.under;
      else if(S.splitter&&cz<-L/2+.55&&cy<S.sill+.075)m=CGM.carbon;                          /* front splitter lip */
      else if(sw&&jj>=M-4&&sd<sw&&cz>-L/2+.5&&cz<L/2-.25)m=CGM.stripe;
      const a=vtx(i,j,m),b=vtx(i,j1,m),c=vtx(i+1,j1,m),d=vtx(i+1,j,m);mb.q(a,b,c,d)}}
  /* end caps: a fan to a point in front of / behind the first and last ring */
  for(const[i,dir]of[[0,-1],[ni-1,1]]){const cx=ctr[i*3],cy=ctr[i*3+1],cz=ctr[i*3+2]+dir*.004;const cm=mb.v(cx,cy,cz,0,0,dir,CGM.paint);
    for(let j=0;j<nj;j++){const j1=(j+1)%nj;const k=(i*nj+j)*3;const a=mb.v(P[k],P[k+1],P[k+2],Nn[k],Nn[k+1],Nn[k+2],CGM.paint),k1=(i*nj+j1)*3,b=mb.v(P[k1],P[k1+1],P[k1+2],Nn[k1],Nn[k1+1],Nn[k1+2],CGM.paint);mb.t(a,b,cm)}}
  S._tub={P,Nn,ni,nj,M,ss,ctr};
  /* surface lookup: the vertex nearest to a point (used to place the lights and vents on the body) */
  S.near=(x,y,z)=>{let b=-1,bd=1e9;for(let i=0;i<ni;i++){const dz=P[i*nj*3+2]-z;if(dz*dz>bd)continue;for(let j=0;j<nj;j++){const k=(i*nj+j)*3,dx=P[k]-x,dy=P[k+1]-y,d=dx*dx+dy*dy+dz*dz;if(d<bd){bd=d;b=k}}}
    return{x:P[b],y:P[b+1],z:P[b+2],nx:Nn[b],ny:Nn[b+1],nz:Nn[b+2]}}}
/* a point on the top of the body at distance s from the nose and sideways x, with its normal; and a point on the side at height y */
function cgSurf(S,s,x){const y=cgTopAt(S,s,x),e=.05,dx=(cgTopAt(S,s,x+e)-cgTopAt(S,s,x-e))/(2*e),dz=(cgTopAt(S,s+e,x)-cgTopAt(S,Math.max(0,s-e),x))/(2*e),l=Math.hypot(dx,1,dz);return{x,y,z:S.zs(s),nx:-dx/l,ny:1/l,nz:-dz/l}}
function cgSide(S,s,y,sg){const r=cgTubRing(S,s,S.K);let x=r[Math.min(r.length-1,4)][0];for(let k=3;k<r.length;k++){if(r[k][1]>=y){const a=r[k-1],b=r[k],t=_cl((y-a[1])/Math.max(1e-6,b[1]-a[1]),0,1);x=a[0]+(b[0]-a[0])*t;break}}return{x:sg*x,y,z:S.zs(s),nx:sg,ny:0,nz:0}}
/* height of the top of the body at distance s from the nose, at sideways position x (from the ring) */
function cgTopAt(S,s,x){const r=cgTubRing(S,s,S.K);let y=r[r.length-1][1];for(let k=r.length-1;k>0;k--){if(r[k-1][0]>=Math.abs(x)){const a=r[k-1],b=r[k],t=_cl((a[0]-Math.abs(x))/Math.max(1e-6,a[0]-b[0]),0,1);y=a[1]+(b[1]-a[1])*t;break}}return y}
/* the greenhouse: glass, pillars and roof */
function cgGlasshouse(S,mb,opt){
  const s0=S.gs0,s1=S.gs1,K2=opt.lo?(opt.mid?4:3):5,stp=opt.lo?(opt.mid?.14:.25):.09,ss=[];for(let s=s0;s<s1-1e-6;s+=stp)ss.push(s);ss.push(s1);
  const roof=cgCurve([[s0,0],[S.cowl+(S.roofF-S.cowl)*.3,.3],[S.cowl+(S.roofF-S.cowl)*.7,.8],[S.roofF,1],[S.roofR,1],[S.roofR+(s1-S.roofR)*.4,.8],[S.roofR+(s1-S.roofR)*.75,.3],[s1,0]]);
  const ni=ss.length,rings=[];
  for(const s of ss){const hw=S.curves.half(s),wb=hw*S.gw,wt=wb*S.gt,yb0=cgTopAt(S,s,wb)-.025,u=roof(s),yr=yb0+(S.H-yb0)*u;const pts=[];
    for(let k=0;k<=K2;k++){const t=k/K2;pts.push([wb+(wt-wb)*t*.85,yb0+(yr-yb0)*Math.pow(t,1.15)*.88])}          /* the slanted side */
    const cx=wb+(wt-wb)*.85,cy=yb0+(yr-yb0)*.88;for(let k=1;k<=3;k++){const a=k/3*Math.PI/2;pts.push([cx*Math.cos(a),cy+(yr-cy)*Math.sin(a)])}   /* the corner and the roof, ending on the centre line */
    rings.push(pts)}
  const M=rings[0].length,nj=2*M-1;
  const P=new Float32Array(ni*nj*3),ctr=new Float32Array(ni*3),idxOf=j=>j<M?j:2*M-2-j;
  for(let i=0;i<ni;i++){const z=S.zs(ss[i]),r=rings[i];let cy=0;for(let j=0;j<nj;j++){const p=r[idxOf(j)],k=(i*nj+j)*3;P[k]=(j<M?-1:1)*p[0];P[k+1]=p[1];P[k+2]=z;cy+=p[1]}ctr[i*3]=0;ctr[i*3+1]=cy/nj-.25;ctr[i*3+2]=z}
  const Nn=cgGridNormals(P,ni,nj,false,ctr);
  const map=new Map();const vtx=(i,j,m)=>{const key=(i*nj+j)*16+m;let v=map.get(key);if(v===undefined){const k=(i*nj+j)*3;v=mb.v(P[k],P[k+1],P[k+2],Nn[k],Nn[k+1],Nn[k+2],m);map.set(key,v)}return v};
  for(let i=0;i<ni-1;i++){const s=(ss[i]+ss[i+1])/2;for(let j=0;j<nj-1;j++){const isSide=Math.max(idxOf(j),idxOf(j+1))<=K2;let m=CGM.paint;
      if(isSide){/* the side window: its front edge follows the A pillar (up and back), its rear edge the C pillar (up and forward); everything else on the side is pillar */
        const k0=(i*nj+j)*3,yb0=P[(i*nj+(j<M?0:nj-1))*3+1],ym=(P[k0+1]+P[(i*nj+j+1)*3+1])/2,t=_cl((ym-yb0)/Math.max(.05,S.H-yb0),0,1),sF=S.cowl+.12+(S.roofF-S.cowl)*t*.95,sR=S.rearS-.3-(S.rearS-S.roofR-.3)*Math.pow(t,1.3);
        m=(s>sF&&s<sR&&!(S.bpillar&&Math.abs(s-(sF+sR)/2)<.045))?CGM.glass:(opt.lo?CGM.paint:CGM.carbon)}
      else if(s<S.roofF-.02){m=CGM.glass}                                                  /* windshield */
      else if(s<=S.roofR){m=S.glassRoof?CGM.glass:CGM.paint}
      else m=(S.rearGlass&&s<S.roofR+(S.rearS-S.roofR)*.58)?CGM.glass:CGM.paint
      const a=vtx(i,j,m),b=vtx(i,j+1,m),c=vtx(i+1,j+1,m),d=vtx(i+1,j,m);mb.q(a,b,c,d)}}
  /* the headliner: the roof and the rear window get a dark lining 8 cm below them (the front of the windscreen stays clear so the dash and seats show) */
  if(!opt.lo){const hv=new Map(),hl=(i,j)=>{const key=i*nj+j;let v=hv.get(key);if(v===undefined){const k=key*3;v=mb.v(P[k]-Nn[k]*.08,P[k+1]-Nn[k+1]*.08,P[k+2]-Nn[k+2]*.08,Nn[k],Nn[k+1],Nn[k+2],CGM.under,.9);hv.set(key,v)}return v},sH=S.cowl+(S.roofF-S.cowl)*.6;
    for(let i=0;i<ni-1;i++){if((ss[i]+ss[i+1])/2<sH)continue;for(let j=0;j<nj-1;j++){if(Math.min(idxOf(j),idxOf(j+1))<K2)continue;mb.q(hl(i,j),hl(i,j+1),hl(i+1,j+1),hl(i+1,j))}}}
  S._gh={P,ni,nj,ss,K2,M}}
/* ---------------- small parts ---------------- */
function cgBasis(nx,ny,nz){/* tangent u (mostly sideways) and v from a surface normal */
  let ux=ny*0-nz*1,uy=nz*0-nx*0,uz=nx*1-ny*0;ux=-nz;uy=0;uz=nx;let l=Math.hypot(ux,uz);if(l<1e-4){ux=1;uz=0}else{ux/=l;uz/=l}
  const vx=ny*uz-nz*uy,vy=nz*ux-nx*uz,vz=nx*uy-ny*ux;return[ux,uy,uz,vx,vy,vz]}
/* a flat ellipse lying on the body at a point, facing along the normal, a hair above the surface */
function cgDisc(mb,p,rx,ry,m,seg,off,rot){const[ux,uy,uz,vx,vy,vz]=cgBasis(p.nx,p.ny,p.nz),cx=p.x+p.nx*((off==null?.006:off)+.003),cy=p.y+p.ny*((off==null?.006:off)+.003),cz=p.z+p.nz*((off==null?.006:off)+.003),cr=Math.cos(rot||0),sr=Math.sin(rot||0);
  const c=mb.v(cx,cy,cz,p.nx,p.ny,p.nz,m),ring=[];seg=seg||14;
  for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2,ex=Math.cos(a)*rx,ey=Math.sin(a)*ry,qx=ex*cr-ey*sr,qy=ex*sr+ey*cr;ring.push(mb.v(cx+ux*qx+vx*qy,cy+uy*qx+vy*qy,cz+uz*qx+vz*qy,p.nx,p.ny,p.nz,m))}
  for(let i=0;i<seg;i++)mb.t(c,ring[i],ring[(i+1)%seg])}
/* a box (flat shaded, each face its own vertices), optionally turned about the x axis by tilt */
function cgBox(mb,cx,cy,cz,hx,hy,hz,m,tilt){const ct=Math.cos(tilt||0),st=Math.sin(tilt||0);
  const T=(x,y,z)=>[cx+x,cy+y*ct-z*st,cz+y*st+z*ct],Nrm=(x,y,z)=>[x,y*ct-z*st,y*st+z*ct];
  const faces=[[[1,0,0],[[hx,-hy,-hz],[hx,hy,-hz],[hx,hy,hz],[hx,-hy,hz]]],[[-1,0,0],[[-hx,-hy,hz],[-hx,hy,hz],[-hx,hy,-hz],[-hx,-hy,-hz]]],[[0,1,0],[[-hx,hy,-hz],[-hx,hy,hz],[hx,hy,hz],[hx,hy,-hz]]],[[0,-1,0],[[-hx,-hy,hz],[-hx,-hy,-hz],[hx,-hy,-hz],[hx,-hy,hz]]],[[0,0,1],[[-hx,-hy,hz],[hx,-hy,hz],[hx,hy,hz],[-hx,hy,hz]]],[[0,0,-1],[[hx,-hy,-hz],[-hx,-hy,-hz],[-hx,hy,-hz],[hx,hy,-hz]]]];
  for(const[n,vs]of faces){const nn=Nrm(n[0],n[1],n[2]),ids=vs.map(v=>{const p=T(v[0],v[1],v[2]);return mb.v(p[0],p[1],p[2],nn[0],nn[1],nn[2],m)});mb.q(ids[0],ids[1],ids[2],ids[3])}}
/* a cylinder along z (exhaust tips) */
function cgCylZ(mb,x,y,z0,z1,r,m,seg){seg=seg||10;const a=[],b=[];for(let i=0;i<seg;i++){const t=i/seg*Math.PI*2,c=Math.cos(t),s=Math.sin(t);a.push(mb.v(x+c*r,y+s*r,z0,c,s,0,m));b.push(mb.v(x+c*r,y+s*r,z1,c,s,0,m))}
  for(let i=0;i<seg;i++){const j=(i+1)%seg;mb.q(a[i],a[j],b[j],b[i])}const cdark=mb.v(x,y,z1,0,0,1,CGM.under);for(let i=0;i<seg;i++){const j=(i+1)%seg;mb.t(cdark,b[i],b[j])}}
/* a thin strip along a polyline lying on the body (a light bar, a louvre, a door line) */
function cgStrip(mb,pts,w,m,off){const n=pts.length,L=[],R=[];for(let i=0;i<n;i++){const p=pts[i],q=pts[Math.min(n-1,i+1)],o=pts[Math.max(0,i-1)];let tx=q.x-o.x,ty=q.y-o.y,tz=q.z-o.z;const tl=Math.hypot(tx,ty,tz)||1;tx/=tl;ty/=tl;tz/=tl;
    let sx=ty*p.nz-tz*p.ny,sy=tz*p.nx-tx*p.nz,sz=tx*p.ny-ty*p.nx;const sl=Math.hypot(sx,sy,sz)||1;sx/=sl;sy/=sl;sz/=sl;const e=(off==null?.006:off)+.004;
    L.push(mb.v(p.x+p.nx*e-sx*w/2,p.y+p.ny*e-sy*w/2,p.z+p.nz*e-sz*w/2,p.nx,p.ny,p.nz,m));R.push(mb.v(p.x+p.nx*e+sx*w/2,p.y+p.ny*e+sy*w/2,p.z+p.nz*e+sz*w/2,p.nx,p.ny,p.nz,m))}
  for(let i=0;i<n-1;i++)mb.q(L[i],R[i],R[i+1],L[i+1])}
/* a line of surface points at a given height across the body at distance s from the nose */
function cgRowAt(S,s,y,xMax,n){const pts=[];for(let i=0;i<n;i++){const x=-xMax+2*xMax*i/(n-1);pts.push(S.near(x,y,S.zs(s)))}
  /* the nearest vertex jumps from row to row of the grid: smooth the line so a light bar is not a zigzag */
  for(let it=0;it<4;it++)for(let i=1;i<n-1;i++){const a=pts[i-1],b=pts[i],c=pts[i+1];b.y=(a.y+2*b.y+c.y)/4;b.z=(a.z+2*b.z+c.z)/4}
  return pts}
/* a lamp built in layers (bezel, chrome ring, dark reflector, glowing lens, a bright spot) so it reads as a lamp and not as a coloured dot. kind 0 round projector, 1 slim strip, 2 tail lamp (lens, dark inner ring, lens again) */
function cgLamp(mb,p,rx,ry,rot,m,kind){
  const d=(sx,sy,mat,off,seg)=>cgDisc(mb,p,rx*sx,ry*sy,mat,seg||18,off,rot);
  d(1.2,1.25,CGM.trim,.004);
  if(kind==1){d(1.04,1.1,CGM.chrome,.0055);d(.94,.9,CGM.grille,.0066);d(.86,.7,m,.0078);d(.6,.26,CGM.chrome,.0095,12)}
  else if(kind==2){d(1.0,1.0,m,.0058);d(.64,.64,CGM.trim,.0072,14);d(.42,.42,m,.0086,14);d(.14,.14,CGM.chrome,.0102,8)}
  else{d(1.03,1.03,CGM.chrome,.0055);d(.9,.9,CGM.grille,.0066);d(.74,.74,m,.0078);d(.42,.42,CGM.chrome,.0095,14);d(.2,.2,m,.0112,10)}}
/* a flat quad on a plane of constant z (a character on a plate) */
function cgQuadZ(mb,x0,y0,x1,y1,z,dir,m){const a=mb.v(x0,y0,z,0,0,dir,m),b=mb.v(x1,y0,z,0,0,dir,m),c=mb.v(x1,y1,z,0,0,dir,m),d=mb.v(x0,y1,z,0,0,dir,m);mb.q(a,b,c,d)}
/* a number plate with six characters (blocky seven-segment letters picked by a seeded generator) and a blue strip; dir -1 faces the front, +1 the rear */
function cgPlate(mb,cx,cy,cz,dir,seed){
  cgBox(mb,cx,cy,cz,.25,.062,.006,CGM.plate,0);const z=cz+dir*.0072,rg=mulberry((seed*7919+13)|0),sx=dir>0?1:-1;
  for(let g=0;g<6;g++){const gx=cx+sx*(-.19+g*.075),w=.026,h=.05,t=.0085;let mask=0;while(mask==0||mask==127)mask=(rg()*127)|0;
    const S7=[[-w,h-t,w,h],[w-t,0,w,h],[w-t,-h,w,0],[-w,-h,w,-h+t],[-w,-h,-w+t,0],[-w,0,-w+t,h],[-w,-t/2,w,t/2]];
    for(let k=0;k<7;k++)if(mask&(1<<k)){const q=S7[k];cgQuadZ(mb,gx+sx*q[0],cy+q[1],gx+sx*q[2],cy+q[3],z,dir,CGM.carbon)}}}
function cgDetails(S,mb,opt){
  const L=S.L,hw=S.W/2,lights={};
  /* ---- front lights ---- */
  const hy=S.nose+.03,hx=S.hw0*.66;
  for(const sg of[-1,1]){
    if(S.head=='round'){const p=S.near(sg*hx,hy+.02,S.zs(.2));cgLamp(mb,p,.105,.105,0,CGM.head,0)}
    else if(S.head=='oval'){const p=S.near(sg*hx*.95,hy+.01,S.zs(.2));cgLamp(mb,p,.15,.075,sg*.25,CGM.head,0)}
    else if(S.head=='slit'){const p=S.near(sg*hx*.95,hy+.03,S.zs(.22));cgLamp(mb,p,.24,.05,sg*.32,CGM.head,1)}
    else if(S.head=='led'){const p=S.near(sg*hx*.9,hy+.04,S.zs(.22));cgLamp(mb,p,.2,.06,sg*.28,CGM.head,1);const p2=S.near(sg*hx*.9,hy-.02,S.zs(.22));cgDisc(mb,p2,.12,.015,CGM.head,12,.009,sg*.28)}
    else if(S.head=='pop'){const p=S.near(sg*hx*.8,S.hood*.88,S.zs(S.cowl*.34));cgLamp(mb,p,.12,.06,0,CGM.head,0)}
    /* an amber indicator at the outer corner */
    {const p3=S.head!='pop'?S.near(sg*(hx+.16),hy-.012,S.zs(.17)):S.near(sg*(hx+.12),S.nose*.55,S.zs(.1));cgDisc(mb,p3,.05,.013,CGM.amber,10,.0085,sg*.45)}}
  lights.hx=hx;lights.hy=hy;lights.hz=-L/2+.1;
  /* ---- front intake and side intakes ---- */
  if(S.intake!='none'){const p=S.near(0,S.sill+.13,S.zs(.1));const wI=S.intake=='wide'?.62:S.intake=='mid'?.42:.3;cgDisc(mb,p,hw*wI,.1,CGM.grille,18,.005);
    for(const sg of[-1,1]){const q=S.near(sg*hw*.82,S.sill+.1,S.zs(.14));cgDisc(mb,q,.09,.06,CGM.grille,10,.005,sg*.3)}}
  if(S.duct){const p=S.near(0,S.hood,S.zs(S.cowl*.55));cgDisc(mb,p,.12,.2,CGM.grille,12,.004)}      /* a bonnet vent */
  /* ---- side intakes behind the doors (mid-engine cars) ---- */
  if(S.sideIntake){for(const sg of[-1,1]){const s=S.roofR+.1,y=cgTopAt(S,s,hw*.85)-.18,p=S.near(sg*hw*.97,y,S.zs(s));cgDisc(mb,p,S.sideIntake*.55,.045,CGM.grille,12,.005,-.3*sg)}}
  /* ---- door lines ---- */
  for(const sg of[-1,1]){const x0=S.near(sg*hw*.96,S.sill+.4,S.zs(S.cowl+.05)),pts=[];for(let k=0;k<=18;k++){const y=S.sill+.2+k*.03,s=S.cowl+.05+k*.0033;pts.push(cgSide(S,s,y,sg))}cgStrip(mb,pts,.011,CGM.trim,.007);void x0}
  /* ---- rear lights ---- */
  const tz=S.zs(L-.08),ty=S.deck-.06;
  const chips=(pts,r)=>{for(const q of pts)cgDisc(mb,q,r,r,CGM.chrome,8,.0095)};            /* the LED chips of a light bar */
  if(S.tail_=='bar'){const pts=cgRowAt(S,L-.1,ty,S.hwTail*.82,9);cgStrip(mb,pts,.07,CGM.trim,.004);cgStrip(mb,pts,.05,CGM.tail,.0062);chips(pts,.0085);const pts2=cgRowAt(S,L-.1,ty-.075,S.hwTail*.8,9);cgStrip(mb,pts2,.018,CGM.tail,.005);const pts3=cgRowAt(S,L-.1,ty-.11,S.hwTail*.78,9);cgStrip(mb,pts3,.012,CGM.trim,.004)}
  else if(S.tail_=='round'){for(const sg of[-1,1]){const p=S.near(sg*S.hwTail*.64,ty,tz);cgLamp(mb,p,.08,.08,0,CGM.tail,2);cgDisc(mb,S.near(sg*S.hwTail*.64,ty-.09,tz),.02,.02,CGM.amber,8,.008)}}
  else if(S.tail_=='quad'){for(const sg of[-1,1])for(const dx of[.5,.78]){const p=S.near(sg*S.hwTail*dx,ty-.02,tz);cgLamp(mb,p,.062,.062,0,CGM.tail,2)}}
  else if(S.tail_=='slit'){for(const sg of[-1,1]){const p=S.near(sg*S.hwTail*.62,ty,tz);cgLamp(mb,p,.22,.035,sg*-.12,CGM.tail,1);const pp=[-.6,-.2,.2,.6].map(f=>S.near(sg*S.hwTail*.62+f*.2*sg*-1,ty,tz));chips(pp,.008)}}
  else if(S.tail_=='wide'){const pts=cgRowAt(S,L-.1,ty+.02,S.hwTail*.9,11);cgStrip(mb,pts,.09,CGM.trim,.004);cgStrip(mb,pts,.07,CGM.tail,.0062);chips(pts,.01);cgStrip(mb,cgRowAt(S,L-.1,ty-.07,S.hwTail*.88,11),.016,CGM.tail,.005)}
  lights.tx=S.hwTail*.64;lights.ty=ty;lights.tz=L/2-.08;
  /* ---- engine cover louvres ---- */
  if(S.louvres){for(let k=0;k<S.louvres;k++){const s=S.roofR+.08+k*.13,pts=[];for(let q=0;q<7;q++){const x=-hw*.4+hw*.8*q/6;pts.push(S.near(x,cgTopAt(S,s,x),S.zs(s)))}cgStrip(mb,pts,.028,CGM.grille,.004)}}
  /* ---- mirrors ---- */
  if(S.mirror){for(const sg of[-1,1]){const s=S.cowl+.28,x=hw*S.gw+.1,y=cgTopAt(S,s,hw*S.gw)+.12;mb.cur=sg>0?7:8;cgBox(mb,sg*x,y,S.zs(s),.055,.04,.07,CGM.paint,0);cgBox(mb,sg*(x-.05),y-.075,S.zs(s)+.02,.03,.03,.02,CGM.trim,0);cgBox(mb,sg*x,y,S.zs(s)+.0715,.048,.033,.003,CGM.carbon,0);cgBox(mb,sg*(x-.07),y-.045,S.zs(s)+.02,.045,.012,.014,CGM.trim,0);mb.cur=0}}
  /* ---- roof rails (SUVs) ---- */
  if(S.roofRails){const sm=(S.roofF+S.roofR)/2,x=S.curves.half(sm)*S.gw*S.gt*.66,z0=S.zs(S.roofF+.15),z1=S.zs(S.roofR-.1);for(const sg of[-1,1]){cgBox(mb,sg*x,S.H+.008,(z0+z1)/2,.02,.018,Math.abs(z1-z0)/2,CGM.chrome,0);for(const f of[0,1])cgBox(mb,sg*x,S.H-.01,z0+(z1-z0)*f,.024,.03,.02,CGM.trim,0)}}
  /* ---- spoiler / wing ---- */
  const dz=S.zs(L-.2);
  if(S.wing=='duck'){cgBox(mb,0,S.deck+.04,S.zs(L-.16),S.hwTail*.78,.035,.1,CGM.paint,.15)}
  else if(S.wing=='lip'){cgBox(mb,0,S.deck+.015,S.zs(L-.08),S.hwTail*.8,.018,.05,CGM.carbon,.0)}
  else if(S.wing=='gt'||S.wing=='big'){const big=S.wing=='big',hy2=S.deck+(big?.36:.24),ww=S.hwTail*(big?.98:.9),ch=big?.17:.13;
    cgBox(mb,0,hy2,S.zs(L-(big?.28:.22)),ww,.012,ch,CGM.carbon,-.1);
    for(const sg of[-1,1]){cgBox(mb,sg*ww,hy2,S.zs(L-(big?.28:.22)),.012,big?.1:.07,ch+.02,CGM.carbon,-.05);cgBox(mb,sg*S.hwTail*.5,S.deck+(hy2-S.deck)/2,S.zs(L-(big?.3:.24)),.028,(hy2-S.deck)/2+.01,.05,CGM.carbon,0)}}
  /* ---- diffuser and exhaust ---- */
  if(S.diff){cgBox(mb,0,S.sill+.075,S.zs(L-.27),S.hwTail*.6,.012,.14,CGM.carbon,-.14);for(let k=-2;k<=2;k++)cgBox(mb,k*S.hwTail*.25,S.sill+.09,S.zs(L-.28),.008,.04,.12,CGM.carbon,-.14)}
  if(S.rearVent!==0&&!opt.lo)cgDisc(mb,S.near(0,S.sill+.69,S.zs(L-.05)),S.hwTail*.46,.055,CGM.grille,18,.004);          /* a vent panel between the lights and the diffuser */
  const ex=S.exh||0;for(let k=0;k<ex;k++){const px=ex==1?(S.exhOff||0):S.exhS=='center'?(k-(ex-1)/2)*.15:(k%2?1:-1)*(S.hwTail*(.52+.12*((k>>1)))),py=S.sill+.13+(S.exhS=='high'?.28:0);cgCylZ(mb,px,py,S.zs(L-.09),S.zs(L+.03),.042,CGM.exh,12);cgCylZ(mb,px,py,S.zs(L+.012),S.zs(L+.036),.049,CGM.chrome,14)}
  S._lights=lights}
/* a torus (the steering wheel) */
function cgTorus(mb,cx,cy,cz,R,r,tilt,m){const n=14,k=6,ct=Math.cos(tilt),st=Math.sin(tilt),rows=[];
  for(let i=0;i<n;i++){const a=i/n*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a),row=[];for(let j=0;j<k;j++){const b=j/k*Math.PI*2,cb=Math.cos(b),sb=Math.sin(b),rx=ca*(R+r*cb),ry=sa*(R+r*cb),rz=r*sb,ny=sa*cb;
      row.push(mb.v(cx+rx,cy+ry*ct-rz*st,cz+ry*st+rz*ct,ca*cb,ny*ct-sb*st,ny*st+sb*ct,m))}rows.push(row)}
  for(let i=0;i<n;i++){const i2=(i+1)%n;for(let j=0;j<k;j++){const j2=(j+1)%k;mb.q(rows[i][j],rows[i2][j],rows[i2][j2],rows[i][j2])}}}
/* the inside: dashboard, steering wheel, seats (seen through the tinted glass) */
function cgInterior(S,mb){
  const M=CGM.inter,hw=S.curves.half(S.cowl)*S.gw,sCab=(S.cowl+S.roofR)/2+.18,belt=cgTopAt(S,sCab,hw*.5)-.03,sx=Math.min(.42,hw*.55),drv=S.lhd?-1:1,room=Math.max(.2,S.H-belt-.1);
  /* the seats sit low (their lower half is under the body line); only the backrest and the headrest show through the windows */
  /* the seats must fit under the roof: on a low car the backrest and headrest are scaled down to stay 6 cm below the glass */
  const seat=(x,sz)=>{const y0=belt-.3,k=Math.min(1,Math.max(.35,(S.H-.06-y0)/(.64+.075)));cgBox(mb,x,y0+.05,S.zs(sz),.23,.05,.25,M,0);cgBox(mb,x,y0+.3*k,S.zs(sz+.26),.22,.27*k,.06,M,-.28);cgBox(mb,x,y0+.64*k,S.zs(sz+.33),.085,.075*k,.045,M,-.28)};
  if(S.seat=='centre')seat(0,sCab);else{seat(-sx,sCab);seat(sx,sCab)}
  const sD=S.cowl+.2,yD=cgTopAt(S,sD,0);cgBox(mb,0,yD-.07,S.zs(sD),hw*.82,.05,.2,M,.08);cgBox(mb,drv*sx,yD-.03,S.zs(sD+.05),.26,.04,.1,M,0);       /* dash and instrument hood */
  cgBox(mb,0,belt-.05,S.zs(sCab+.02),.06,.07,.34,M,0);                                                                                              /* the centre console */
  cgTorus(mb,S.seat=='centre'?0:drv*sx,yD+Math.min(.16,room*.45),S.zs(sD+.34),.14,.014,.55,M);cgBox(mb,0,belt-.04,S.zs(S.rearS-.1),hw*.8,.04,.1,M,0)}      /* the wheel, the rear shelf */
/* panel gaps, window trim, door handles, fuel cap, badges, plates, grille, daytime lights, vents, scoops, buttresses, fins */
function cgDetails2(S,mb,opt){
  const hw=S.W/2,L=S.L,cs=S.curves;
  /* bonnet and engine-lid shut lines */
  {const hx=s=>cs.half(s)*.72,s0=S.cowl-.04,s1=.4,left=[],right=[],front=[];for(let k=0;k<=8;k++){const s=s0-(s0-s1)*k/8;left.push(cgSurf(S,s,-hx(s)));right.push(cgSurf(S,s,hx(s)))}
    for(let k=0;k<=6;k++)front.push(cgSurf(S,s1,-hx(s1)+2*hx(s1)*k/6));cgStrip(mb,left,.012,CGM.trim,.008);cgStrip(mb,right,.012,CGM.trim,.008);cgStrip(mb,front,.012,CGM.trim,.008);
    const sl=S.rearS+.2,h2=s=>cs.half(s)*.7,lid=[];for(let k=0;k<=6;k++)lid.push(cgSurf(S,sl,-h2(sl)+2*h2(sl)*k/6));cgStrip(mb,lid,.012,CGM.trim,.008)}
  /* doors: the cut lines, the handle */
  const sCab=(S.cowl+S.roofR)/2,yB=cgTopAt(S,sCab,cs.half(sCab)*S.gw)-.03,doorF=S.cowl+.16,doorR=S.roofR+.12,y0=S.sill+.2;
  for(const sg of[-1,1]){const line=pts=>cgStrip(mb,pts,.011,CGM.trim,.007);
    const NL=Array.from({length:25},(_,k)=>k/24);          /* dense samples: a few points straight across the shoulder crease would sink into it and the line would be dashed */
    line(NL.map(k=>cgSide(S,doorF,y0+(yB-y0)*k,sg)));line(NL.map(k=>cgSide(S,doorR,y0+(yB-y0)*k,sg)));line(NL.map(k=>cgSide(S,doorF+(doorR-doorF)*k,y0,sg)));
    cgStrip(mb,[cgSide(S,doorR-.3,yB-.09,sg),cgSide(S,doorR-.12,yB-.09,sg)],.028,S.chromeTrim?CGM.chrome:CGM.trim,.004);
    /* window trim along the bottom edge of the side glass */
    const G=S._gh,tp=[];if(G)for(let i=0;i<G.ni;i++){const s=G.ss[i];if(s<doorF+.1||s>S.rearS-.3)continue;const j=sg<0?0:G.nj-1,k=(i*G.nj+j)*3;tp.push({x:G.P[k],y:G.P[k+1],z:G.P[k+2],nx:sg,ny:.2,nz:0})}
    if(tp.length>1)cgStrip(mb,tp,.03,S.chromeTrim?CGM.chrome:CGM.trim,.004);
    /* the roof rail: a dark strip along the top of the side glass, so the glasshouse has a frame */
    const tr=[];if(G)for(let i=0;i<G.ni;i++){const s=G.ss[i];if(s<doorF+.05||s>S.rearS-.25)continue;const j=sg<0?G.K2:G.nj-1-G.K2,k=(i*G.nj+j)*3;tr.push({x:G.P[k],y:G.P[k+1],z:G.P[k+2],nx:sg*.75,ny:.66,nz:0})}
    if(tr.length>1)cgStrip(mb,tr,.034,CGM.trim,.005);
    cgDisc(mb,cgSide(S,L-.95,yB-.12,sg),.065,.065,CGM.trim,10,.004);                                    /* the fuel flap */}
  /* badges and plates */
  cgDisc(mb,S.near(0,S.nose+.02,S.zs(.14)),.035,.035,CGM.chrome,10,.006);cgDisc(mb,S.near(0,S.deck-.1,S.zs(L-.1)),.035,.035,CGM.chrome,10,.006);
  if(S.plates){const pf=S.near(0,S.sill+.2,S.zs(.12)),pr=S.near(0,S.sill+.43,S.zs(L-.08));cgPlate(mb,pf.x,pf.y,pf.z-.01,-1,(S.L*100)|0);cgPlate(mb,pr.x,pr.y,pr.z+.01,1,((S.L+S.W)*100)|0)}
  /* the grille */
  const ny=S.nose-.2;
  if(S.grille=='wide'){const p=S.near(0,S.sill+.2,S.zs(.12));cgDisc(mb,p,hw*.46,.1,CGM.grille,18,.005);for(const k of[-1,0,1])cgStrip(mb,[-3,-2,-1,0,1,2,3].map(q=>S.near(q*hw*.13,S.sill+.2+k*.04,S.zs(.12))),.012,CGM.chrome,.007)}
  else if(S.grille=='twin'){for(const sg of[-1,1]){const p=S.near(sg*.2,ny+.1,S.zs(.1));cgDisc(mb,p,.2,.09,CGM.chrome,14,.004);cgDisc(mb,p,.18,.075,CGM.grille,14,.007)}}
  else if(S.grille=='horseshoe'){const pts=[];for(let k=0;k<=10;k++){const a=Math.PI*k/10,x=Math.cos(a)*.26,y=ny+.1+Math.sin(a)*.2-.07;pts.push(S.near(x,y,S.zs(.1)))}cgStrip(mb,pts,.02,CGM.chrome,.006);cgDisc(mb,S.near(0,ny+.09,S.zs(.1)),.22,.14,CGM.grille,16,.004)}
  else if(S.grille=='slit'){cgDisc(mb,S.near(0,S.sill+.2,S.zs(.1)),hw*.36,.032,CGM.grille,14,.005)}
  /* daytime running lights over the headlights */
  if(S.drl){for(const sg of[-1,1]){const hx=S.hw0*.66,pts=[];for(let k=0;k<5;k++)pts.push(S.near(sg*(hx-.12+.06*k),S.nose+.095,S.zs(.2)));cgStrip(mb,pts,.014,CGM.head,.008)}}
  /* fender gills, scoop, canards, shark fin, buttresses */
  if(S.gills){for(const sg of[-1,1])for(let k=0;k<S.gills;k++)cgStrip(mb,[cgSide(S,S.fo+.45+k*.06,S.sill+.5,sg),cgSide(S,S.fo+.7+k*.06,S.sill+.44,sg)],.02,CGM.under,.004)}
  if(S.scoop){const sT=S.cowl*.55,p=cgSurf(S,sT,0);cgBox(mb,0,p.y+.04,p.z,.14,.045,.2,CGM.paint,0);cgDisc(mb,{x:0,y:p.y+.05,z:p.z-.2,nx:0,ny:0,nz:-1},.1,.03,CGM.under,10,.003)}
  if(S.canards){for(const sg of[-1,1])cgBox(mb,sg*hw*.8,S.sill+.12,S.zs(.34),.09,.007,.06,CGM.carbon,.25*sg)}
  if(S.shark)cgBox(mb,0,S.H+.035,S.zs(S.roofR-.05),.007,.045,.3,CGM.paint,-.05);
  if(S.buttress){for(const sg of[-1,1]){const x=sg*(cs.half(S.rearS)*S.gw*.55+hw*.3),y1=S.H-.1,z1=S.zs(S.roofR+.1),y2=S.deck+.01,z2=S.zs(S.rearS+.2),dy=y2-y1,dz=z2-z1,len=Math.hypot(dy,dz);cgBox(mb,x,(y1+y2)/2,(z1+z2)/2,.035,.02,len/2,CGM.paint,-Math.atan2(dy,dz))}}}
/* ---------------- wheels: tyre, rim with spokes, brake disc, caliper; axis along x, the outer face at +x ---------------- */
function cgWheel(R,w,rimR,spokes,style,rimCol,lo,tread){
  const mb=new CGB(),seg=lo?(lo==2?14:10):32;
  const revolve=(prof,m)=>{const ni=prof.length,P=new Float32Array(ni*seg*3),ctr=new Float32Array(ni*3);
    for(let i=0;i<ni;i++){for(let j=0;j<seg;j++){const a=j/seg*Math.PI*2,k=(i*seg+j)*3;P[k]=prof[i][1];P[k+1]=Math.cos(a)*prof[i][0];P[k+2]=Math.sin(a)*prof[i][0]}ctr[i*3]=prof[i][1]}
    const Nn=cgGridNormals(P,ni,seg,true,ctr),ids=[];for(let i=0;i<ni;i++){const row=[];for(let j=0;j<seg;j++){const k=(i*seg+j)*3;row.push(mb.v(P[k],P[k+1],P[k+2],Nn[k],Nn[k+1],Nn[k+2],m))}ids.push(row)}
    for(let i=0;i<ni-1;i++)for(let j=0;j<seg;j++){const j1=(j+1)%seg;mb.q(ids[i][j],ids[i][j1],ids[i+1][j1],ids[i+1][j])}};
  const sw=R-rimR,h=w/2;
  if(lo){revolve([[rimR*.97,-h*.9],[R-.012,-h*.95],[R,-h*.45],[R,h*.45],[R-.012,h*.95],[rimR*.97,h*.9]],CGM.rubber);
    if(lo==2){revolve([[rimR*.97,h*.9],[rimR*.5,h*.92],[0,h*.94]],CGM.under);revolve([[rimR*1.0,h*.85],[rimR*.96,h*.97],[rimR*.9,h*.97]],CGM.rim);   /* a dark dish, a bright rim lip, five spokes */
      const nsp=spokes>4&&spokes<9?spokes:5,xs=h*.975;for(let k=0;k<nsp;k++){const a=k/nsp*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a),r0=rimR*.2,r1=rimR*.93,w0=.014,w1=.026;const p=(r,wd)=>[mb.v(xs,ca*r-sa*wd,sa*r+ca*wd,1,0,0,CGM.rim),mb.v(xs,ca*r+sa*wd,sa*r-ca*wd,1,0,0,CGM.rim)];const A=p(r0,w0),B=p(r1,w1);mb.q(A[0],A[1],B[1],B[0])}
      const hc=mb.v(xs,0,0,1,0,0,CGM.rim),rg=[];for(let k=0;k<8;k++){const a=k/8*Math.PI*2;rg.push(mb.v(xs,Math.cos(a)*rimR*.2,Math.sin(a)*rimR*.2,1,0,0,CGM.rim))}for(let k=0;k<8;k++)mb.t(hc,rg[k],rg[(k+1)%8])}
    else revolve([[rimR*.97,h*.9],[rimR*.5,h*.92],[0,h*.94]],CGM.rim);mb.rim=rimCol;return mb}
  /* the tyre: a rounded sidewall with lettering ribs, a crown with three grooves */
  const g=.005,crown=[];for(const x of[-.72,-.5,-.38,-.26,-.12,-.0,.12,.26,.38,.5,.72])crown.push([R-(x==-.38||x==-.0||x==.38?g*(tread==0?0:1):0)-.002*Math.abs(x),x*h]);
  revolve([[rimR*.97,-h*.9],[rimR+sw*.28,-h*.985],[rimR+sw*.5,-h*1.0],[rimR+sw*.56,-h*.985],[rimR+sw*.8,-h*.99],[R-.014,-h*.9]].concat(crown,[[R-.014,h*.9],[rimR+sw*.8,h*.99],[rimR+sw*.56,h*.985],[rimR+sw*.5,h*1.0],[rimR+sw*.28,h*.985],[rimR*.97,h*.9]]),CGM.rubber);
  /* the rim: a deep barrel with a lip, then the face with its spokes */
  revolve([[rimR*.97,h*.9],[rimR,h*.97],[rimR*.985,h*.82],[rimR*.9,h*.64],[rimR*.9,-h*.5]],CGM.rim);
  const fx=h*.64;
  if(style=='disc'){revolve([[rimR*.9,fx],[rimR*.6,fx+.008],[.05,fx+.02],[0,fx+.022]],CGM.rim);for(let k=0;k<spokes*2;k++){const a=k/(spokes*2)*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a),r=rimR*.74;cgDiscW(mb,fx+.012,ca*r,sa*r,.028,CGM.under)}}
  else{
    const plate=(pts,x0,sd)=>{const ids=[];for(const[r,t,a]of pts){const ca=Math.cos(a),sa=Math.sin(a);ids.push(mb.v(x0,ca*r-sa*t,sa*r+ca*t,sd,0,0,CGM.rim))}mb.q(ids[0],ids[1],ids[2],ids[3]);return ids};
    const n=style=='mesh'?spokes*2:spokes;
    for(let k=0;k<n;k++){const a=k/n*Math.PI*2,r0=.055,r1=rimR*.93;
      if(style=='mesh'){for(const sg of[-1,1]){const sw2=sg*.5;const pts=[[r0,-.01,a],[r1,-.014+sw2*.0,a+sg*.4],[r1,.014,a+sg*.4],[r0,.01,a]];plate(pts,fx+.01,1);plate(pts.slice().reverse(),fx-.012,-1)}}
      else if(style=='turbine'){const pts=[[r0,-.03,a],[r1,-.04,a+.32],[r1,.04,a+.32],[r0,.03,a]];plate(pts,fx+.012,1);plate(pts.slice().reverse(),fx-.012,-1)}
      else if(style=='split'){for(const sg of[-1,1]){const pts=[[r0,sg*.01-.012,a+sg*.035],[r1,sg*.062-.017,a],[r1,sg*.062+.017,a],[r0,sg*.01+.012,a+sg*.035]];plate(pts,fx+.011,1);plate(pts.slice().reverse(),fx-.012,-1)}}
      else{const pts=[[r0,-.032,a],[r1,-.058,a],[r1,.058,a],[r0,.032,a]];plate(pts,fx+.012,1);plate(pts.slice().reverse(),fx-.012,-1);
        /* the edge of the spoke, so it has a thickness */const e=[[r0,.032,a],[r1,.058,a]];const i0=mb.v(fx+.012,Math.cos(a)*e[0][0]-Math.sin(a)*e[0][1],Math.sin(a)*e[0][0]+Math.cos(a)*e[0][1],0,0,1,CGM.rim),i1=mb.v(fx+.012,Math.cos(a)*e[1][0]-Math.sin(a)*e[1][1],Math.sin(a)*e[1][0]+Math.cos(a)*e[1][1],0,0,1,CGM.rim),i2=mb.v(fx-.012,Math.cos(a)*e[1][0]-Math.sin(a)*e[1][1],Math.sin(a)*e[1][0]+Math.cos(a)*e[1][1],0,0,1,CGM.rim),i3=mb.v(fx-.012,Math.cos(a)*e[0][0]-Math.sin(a)*e[0][1],Math.sin(a)*e[0][0]+Math.cos(a)*e[0][1],0,0,1,CGM.rim);mb.q(i0,i1,i2,i3)}}
    revolve([[.08,fx+.004],[.075,fx+.02],[.05,fx+.03],[0,fx+.032]],CGM.rim);                       /* the hub */
    for(let k=0;k<5;k++){const a=k/5*Math.PI*2+.3;cgDiscW(mb,fx+.026,Math.cos(a)*.052,Math.sin(a)*.052,.011,CGM.chrome)}}                                              /* the lug nuts */
  /* brake disc (drilled) and caliper behind the spokes */
  revolve([[rimR*.86,fx-.07],[rimR*.86,fx-.09],[.07,fx-.09],[.07,fx-.07]],CGM.disc);
  for(let k=0;k<16;k++){const a=k/16*Math.PI*2,r=rimR*.73;cgDiscW(mb,fx-.0695,Math.cos(a)*r,Math.sin(a)*r,.012,CGM.under)}
  const ca=.9;cgBox(mb,fx-.05,Math.cos(ca)*rimR*.7,Math.sin(ca)*rimR*.7,.035,.075,.05,CGM.caliper,0);
  mb.rim=rimCol;return mb}
/* a small flat disc facing +x on a wheel at (y, z) */
function cgDiscW(mb,x,y,z,r,m){const c=mb.v(x,y,z,1,0,0,m),ring=[];for(let i=0;i<6;i++){const a=i/6*Math.PI*2;ring.push(mb.v(x,y+Math.cos(a)*r,z+Math.sin(a)*r,1,0,0,m))}for(let i=0;i<6;i++)mb.t(c,ring[i],ring[(i+1)%6])}
/* ---------------- the whole car ---------------- */
/* ---------------- the parts that can come off: bonnet, boot lid, two doors, two bumpers, two mirrors ----------------
   Parts are found by where a triangle is on the car (the same rules for every body), copied into vertices of their own (so a part can swing without tearing the body),
   and the opening behind a door, bonnet or boot lid gets a dark liner a few centimetres inside the skin (so an open door shows a dark cabin, not the other side of the paint).
   part ids: 0 the body, 1 bonnet, 2 boot lid, 3 door on the right (x > 0), 4 door on the left, 5 front bumper, 6 rear bumper, 7 right mirror, 8 left mirror */
function cgParts(S,mb,opt){
  const L=S.L,cs=S.curves,fo=S.fo,wb=S.wb,P=mb.P,N=mb.N,M=mb.M,Pt=mb.Pt,half=s=>cs.half(s);
  const rb=_cl(fo-S.rf-.1,.2,.46),rs=Math.min(L-.2,Math.max(L-.52,fo+wb+S.rr+.14)),hs0=rb,hs1=S.cowl-.04,ts0=S.rearS+.02,ts1=rs,dS0=fo+S.rf+.12,dS1=fo+wb-S.rr-.14;
  const okH=hs1-hs0>.3,okT=ts1-ts0>.3,okD=dS1-dS0>.6;
  const map=new Map(),dup=(v,p)=>{const k=v*16+p;let r=map.get(k);if(r===undefined){r=mb.v(P[v*3],P[v*3+1],P[v*3+2],N[v*3],N[v*3+1],N[v*3+2],M[v],mb.S[v]);Pt[r]=p;map.set(k,r)}return r};
  const I=mb.I,nt=I.length,lin=new Map(),liner=[],nTri=nt/3;
  /* which part a spot on the car belongs to (centre, average normal, material) */
  const classify=(cx,cy,cz,nx,ny,m)=>{if(cy<S.sill+.03)return 0;const sd=cz+L/2,ax=Math.abs(cx);
    if(sd<rb)return 5;if(sd>rs)return 6;
    if(okH&&sd>=hs0&&sd<=hs1&&ny>.25&&m!=CGM.glass&&ax<=half(sd)*(1-S.tum)*1.01&&cy>=cgTopAt(S,sd,cx)-.06)return 1;
    if(okT&&sd>=ts0&&sd<=ts1&&ny>.25&&m!=CGM.glass&&ax<=half(sd)*(1-S.tum)*1.01&&cy>=cgTopAt(S,sd,cx)-.06)return 2;
    if(okD&&sd>=dS0&&sd<=dS1&&Math.abs(nx)>.5&&ax>.45*half(sd)&&cy>S.sill+.12&&m!=CGM.head&&m!=CGM.tail)return cx>0?3:4;
    return 0};
  /* triangles come in pairs (the two halves of a grid cell): a pair is classified as one, so the edge of a door follows the grid lines and is not a row of teeth */
  const cen=t=>{const a=I[t],b=I[t+1],c=I[t+2];return[(P[a*3]+P[b*3]+P[c*3])/3,(P[a*3+1]+P[b*3+1]+P[c*3+1])/3,(P[a*3+2]+P[b*3+2]+P[c*3+2])/3,(N[a*3]+N[b*3]+N[c*3])/3,(N[a*3+1]+N[b*3+1]+N[c*3+1])/3]};
  const shares=(t,u)=>{let k=0;for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(I[t+i]==I[u+j])k++;return k>=2};
  const cls=new Int8Array(nTri);
  for(let q=0;q<nTri;q++){const t=q*3;if(Pt[I[t]]||Pt[I[t+1]]||Pt[I[t+2]]||M[I[t]]==CGM.inter)continue;
    if(q+1<nTri&&!cls[q+1]&&shares(t,t+3)&&!Pt[I[t+3]]&&M[I[t+3]]==M[I[t]]){const u=cen(t),w=cen(t+3),p=classify((u[0]+w[0])/2,(u[1]+w[1])/2,(u[2]+w[2])/2,(u[3]+w[3])/2,(u[4]+w[4])/2,M[I[t]]);cls[q]=cls[q+1]=p||0;if(p){cls[q]=cls[q+1]=p}q++;continue}
    const u=cen(t);cls[q]=classify(u[0],u[1],u[2],u[3],u[4],M[I[t]])}
  for(let q=0;q<nTri;q++){const p=cls[q];if(!p)continue;const t=q*3,a=I[t],b=I[t+1],c=I[t+2];
    /* the liner behind the moving panels of the skin (not behind glass, trim lines or bumpers) */
    if(p<=4&&M[a]==CGM.paint)liner.push(a,b,c);
    I[t]=dup(a,p);I[t+1]=dup(b,p);I[t+2]=dup(c,p)}
  const lv=v=>{let r=lin.get(v);if(r===undefined){r=mb.v(P[v*3]-N[v*3]*.085,P[v*3+1]-N[v*3+1]*.085,P[v*3+2]-N[v*3+2]*.085,N[v*3],N[v*3+1],N[v*3+2],CGM.under,.8);lin.set(v,r)}return r};
  for(let k=0;k<liner.length;k+=3)I.push(lv(liner[k]),lv(liner[k+1]),lv(liner[k+2]));
  /* the box, centre and hinge of every part */
  const bb={};for(let v=0;v<mb.nv;v++){const p=Pt[v];if(!p)continue;const q=bb[p]||(bb[p]={n:0,x0:1e9,x1:-1e9,y0:1e9,y1:-1e9,z0:1e9,z1:-1e9,sx:0,sy:0,sz:0});q.n++;const x=P[v*3],y=P[v*3+1],z=P[v*3+2];q.x0=Math.min(q.x0,x);q.x1=Math.max(q.x1,x);q.y0=Math.min(q.y0,y);q.y1=Math.max(q.y1,y);q.z0=Math.min(q.z0,z);q.z1=Math.max(q.z1,z);q.sx+=x;q.sy+=y;q.sz+=z}
  const def={};for(const k in bb){const q=bb[k],p=+k;if(q.n<4)continue;const c=[q.sx/q.n,q.sy/q.n,q.sz/q.n];let h;
    if(p==1)h={p:[0,q.y0+(q.y1-q.y0)*.08,q.z1],a:[1,0,0]};                                /* the bonnet hinges at its rear edge and lifts at the front */
    else if(p==2)h={p:[0,q.y0+(q.y1-q.y0)*.1,q.z0],a:[1,0,0]};                             /* the boot lid hinges at its front edge */
    else if(p==3||p==4){h={p:[p==3?q.x1:q.x0,(q.y0+q.y1)/2,q.z0],a:[0,1,0]}}      /* a door hinges at its front edge */
    else if(p==5)h={p:[0,(q.y0+q.y1)/2,q.z1],a:[0,1,0]};                                   /* a bumper pivots about its inner end (the side is chosen when it breaks) */
    else if(p==6)h={p:[0,(q.y0+q.y1)/2,q.z0],a:[0,1,0]};
    else h={p:[(p==7?q.x0:q.x1),(q.y0+q.y1)/2,c[2]],a:[0,1,0]};                           /* a mirror folds about its stalk */
    def[p]=Object.assign(h,{c,n:q.n,box:[q.x0,q.y0,q.z0,q.x1,q.y1,q.z1]})}
  S._parts=def}
/* triangles of glass last, so the glass can be drawn on its own, blended, after the sky; within each group the triangles are ordered by part, so every part is one run of the index buffer */
function cgSplitGlass(mb){const B=[[],[]];for(let g=0;g<2;g++)for(let p=0;p<9;p++)B[g].push([]);
  for(let t=0;t<mb.I.length;t+=3){const a=mb.I[t],g=mb.M[a]==CGM.glass?1:0;B[g][mb.Pt[a]||0].push(mb.I[t],mb.I[t+1],mb.I[t+2])}
  const I=[],pr=[],gpr=[];for(let g=0;g<2;g++)for(let p=0;p<9;p++){const run=B[g][p];(g?gpr:pr)[p]={f:I.length,n:run.length};for(let k=0;k<run.length;k++)I.push(run[k]);if(!g&&p==8)mb.glassFrom=I.length}
  mb.I=I;mb.pr=pr;mb.gpr=gpr}
function cgBuild(o,opt){
  opt=opt||{};const S=cgSpec(o);const body=new CGB();
  cgBody(S,body,opt);cgGlasshouse(S,body,opt);if(!opt.lo){cgDetails(S,body,opt);cgDetails2(S,body,opt);cgInterior(S,body);cgParts(S,body,opt);cgSplitGlass(body)}else if(opt.mid){cgDetails(S,body,opt);cgDetails2(S,body,opt);cgParts(S,body,opt)}else{cgDetails(Object.assign(S,{mirror:0,louvres:0,diff:0,exh:0}),body,opt);cgParts(S,body,opt)}
  const lw=opt.lo?(opt.mid?2:1):0,wf=cgWheel(S.rf,S.wf,S.rimF,S.spoke,S.wheelStyle,null,lw,S.tread),wr=cgWheel(S.rr,S.wr,S.rimR,S.spoke,S.wheelStyle,null,lw,S.tread);
  return{S,body,wheelF:wf,wheelR:wr}}
