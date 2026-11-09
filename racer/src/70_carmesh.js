'use strict';
/* ===== procedural car bodies: smooth lofted bodywork, wheel wells, real wheels, lights, intakes, wings, exhausts, mirrors =====
   Nothing here is a real car: every body is made from numbers (a spec) by the same code, in the style of the cars it takes its inspiration from.
   Model axes: x to the right, y up, z BACKWARDS (the nose is at -L/2), metres, origin on the ground under the middle of the wheelbase's centre of the body (z = 0 half way along). */
const CGM={paint:0,glass:1,trim:2,carbon:3,chrome:4,head:5,tail:6,rubber:7,rim:8,caliper:9,exh:10,plate:11,stripe:12,under:13,disc:14};
/* per material: colour (sRGB bytes) and [metal, roughness, emissive, clear coat] / 255 for the car shader */
const CGCOL=[[255,255,255],[8,10,14],[20,20,22],[34,35,40],[205,210,216],[255,244,190],[255,34,24],[14,14,15],[188,192,198],[205,28,28],[120,124,130],[230,230,224],[240,240,240],[18,18,20],[150,152,158]];
const CGMAT=[[140,66,0,255],[215,22,0,0],[0,170,0,0],[70,80,0,160],[235,60,0,0],[0,40,255,60],[0,40,255,60],[0,205,0,0],[215,80,0,40],[70,90,0,140],[240,70,0,0],[0,150,0,0],[120,70,0,230],[0,200,0,0],[200,110,0,0]];
class CGB{constructor(){this.P=[];this.N=[];this.M=[];this.I=[];this.S=[]}
  v(x,y,z,nx,ny,nz,m,sh){this.P.push(x,y,z);this.N.push(nx,ny,nz);this.M.push(m);this.S.push(sh==null?1:sh);return this.M.length-1}
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
  const S=Object.assign({L:4.5,W:1.86,H:1.28,wb:2.45,fo:.92,nose:.56,hood:.80,cowl:1.62,roofF:2.12,roofR:3.0,rearS:3.5,deck:.97,tail:.80,hw0:.80,hwMax:.93,hwMaxS:3.0,hwTail:.82,crown:.09,tum:.05,flare:.03,
    rf:.335,rr:.345,wf:.255,wr:.305,rimF:.235,rimR:.245,tf:.775,tr:.80,sill:.12,gw:.80,gt:.66,
    glassRoof:0,rearGlass:1,bpillar:0,spoke:5,wheelStyle:'spoke',head:'round',tail_:'bar',intake:'mid',wing:'none',duct:0,exh:2,exhS:'twin',louvres:0,stripe:0,mirror:1,diff:1,splitter:1,sideIntake:0,quad:1},o||{});
  S.fz=-S.L/2+S.fo;S.rz=S.fz+S.wb;                        /* axle positions along z (front is negative) */
  S.zs=s=>s-S.L/2;                                         /* s measured from the nose -> z */
  S.hwF=S.W/2;return S}
/* ---------------- the body ---------------- */
function cgTubRing(S,s,K){K=K||S.K||10;
  const f=S.curves,hw=f.half(s)+S.flare*(Math.exp(-Math.pow((s-S.fo)/.5,2))+Math.exp(-Math.pow((s-(S.fo+S.wb))/.5,2))),yb=f.bot(s),yt=f.top(s),crown=S.crown*(s>S.gs0&&s<S.gs1?.35:1),ys=yt-crown,tum=S.tum,rb=Math.min(.06,(ys-yb)*.35);
  const pts=[];pts.push([0,yb]);pts.push([hw*.78,yb]);
  for(let k=1;k<=2;k++){const a=-Math.PI/2+k*Math.PI/6;pts.push([hw-rb+rb*Math.cos(a),yb+rb+rb*Math.sin(a)])}
  const y0=yb+rb,hs=ys-y0;for(let k=0;k<=K;k++){const t=k/K;pts.push([hw*(1-tum*t*t),y0+hs*t])}
  const xs=hw*(1-tum);const n=2.7;for(let k=1;k<=5;k++){const a=k/5*Math.PI/2,c=Math.cos(a),sn=Math.sin(a);pts.push([xs*Math.pow(c,2/n),ys+(yt-ys)*Math.pow(sn,2/n)])}
  return pts}
function cgBodyCurves(S){
  const L=S.L,top=[[0,S.nose*.8],[.18,S.nose*.97],[.5,S.nose+.025],[S.cowl*.5,(S.nose+S.hood)/2+.01],[S.cowl,S.hood],[(S.cowl+S.rearS)/2,(S.hood+S.deck)/2+.02],[S.rearS,S.deck],[L-.4,S.deck-.025],[L,S.tail]];
  const half=[[0,S.hw0*.9],[.35,S.hw0],[S.fo,S.hw0+(S.hwMax-S.hw0)*.35],[S.fo+S.wb*.45,S.hw0+(S.hwMax-S.hw0)*.55],[S.hwMaxS,S.hwMax],[L-.5,S.hwTail],[L,S.hwTail*.94]];
  const bot=[[0,S.sill+.03],[.4,S.sill],[L-.7,S.sill+.01],[L-.25,S.sill+.07],[L,S.sill+.12]];
  S.curves={top:cgCurve(top),half:cgCurve(half),bot:cgCurve(bot)};return S.curves}
function cgBody(S,mb,opt){
  const L=S.L,K=S.K=opt.lo?5:10;S.gs0=S.cowl;S.gs1=S.rearS;cgBodyCurves(S);const zc=S.curves;
  /* stations along the car: even, with more near the wheels (for the arches) and at the two ends */
  const set=[];const stp=opt.lo?.3:.1;for(let s=.01;s<L;s+=stp)set.push(s);for(const e of(opt.lo?[.01,.08,.18,L-.01,L-.08,L-.18]:[.006,.02,.045,.09,.16,L-.006,L-.02,L-.045,L-.09,L-.16]))set.push(e);
  for(const ax of[S.fo,S.fo+S.wb]){const r=(ax==S.fo?S.rf:S.rr)+.12;for(let s=ax-r;s<=ax+r+1e-6;s+=opt.lo?.13:.04)set.push(s)}
  set.sort((a,b)=>a-b);const ss=[];for(const s of set){if(s<=0||s>=L)continue;if(!ss.length||s-ss[ss.length-1]>.018)ss.push(s)}
  const ni=ss.length,rings=[],capF=S.capF||.34,capR=S.capR||.5;
  for(const s of ss){const r=cgTubRing(S,s,K);let sc=1;const d0=s,d1=L-s;if(d0<capF)sc=Math.pow(1-Math.pow((capF-d0)/capF,2.4),1/2.4);else if(d1<capR)sc=Math.pow(1-Math.pow((capR-d1)/capR,2.2),1/2.2);
    const yb=r[0][1],yt=r[r.length-1][1];const cy=(yb+yt)/2;if(sc<1){const hs=.3+.7*sc;for(const p of r){p[0]*=sc;p[1]=cy+(p[1]-cy)*hs}}rings.push(r)}
  const M=rings[0].length,nj=2*M-2;
  const P=new Float32Array(ni*nj*3),ctr=new Float32Array(ni*3),flag=new Uint8Array(ni*nj),dark=new Float32Array(ni*nj);
  for(let i=0;i<ni;i++){const r=rings[i],z=S.zs(ss[i]);let cy=0;
    for(let j=0;j<nj;j++){let p,sgn=1;if(j<M)p=r[j];else{p=r[2*M-2-j];sgn=-1}const k=(i*nj+j)*3;P[k]=p[0]*sgn;P[k+1]=p[1];P[k+2]=z;cy+=p[1]}
    ctr[i*3]=0;ctr[i*3+1]=cy/nj;ctr[i*3+2]=z}
  /* wheel wells: the side of the body is pushed in where a wheel is (the wheel sits in the opening), and those cells are painted dark */
  const wheels=[[S.fz,S.rf,S.wf,S.tf],[S.rz,S.rr,S.wr,S.tr]];
  for(let i=0;i<ni;i++)for(let j=0;j<nj;j++){const k=(i*nj+j)*3,x=P[k],y=P[k+1],z=P[k+2];
    for(const[wz,R,w,tx]of wheels){const ra=R+.045,dz=z-wz,dy=y-R,dd=Math.sqrt(dz*dz+dy*dy)-ra;if(dd<.02&&Math.abs(x)>tx-w/2-.01){const xin=tx-w/2-.035,t=_cl(-(dd-.02)/.09,0,1),e=t*t*(3-2*t);P[k]=Math.sign(x)*(Math.abs(x)*(1-e)+Math.min(Math.abs(x),xin)*e);flag[i*nj+j]=1}   /* a smooth slope into the arch, not a step */
      /* the arch edge is shaded dark with a smooth ramp (a gradient of the vertex colour, not a ring of dark squares) */
      if(Math.abs(x)>tx-w/2-.06){const t=_cl(.5-dd/.055,0,1);dark[i*nj+j]=Math.max(dark[i*nj+j],t*t*(3-2*t))}}
    /* a livery with a dark lower body (police cars) */
    if(S.lowerDark&&Math.abs(P[k])>.3){const t=_cl((S.lowerDark-y)/.05,0,1);dark[i*nj+j]=Math.max(dark[i*nj+j],t*t*(3-2*t)*.96)}
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
/* height of the top of the body at distance s from the nose, at sideways position x (from the ring) */
function cgTopAt(S,s,x){const r=cgTubRing(S,s,S.K);let y=r[r.length-1][1];for(let k=r.length-1;k>0;k--){if(r[k-1][0]>=Math.abs(x)){const a=r[k-1],b=r[k],t=_cl((a[0]-Math.abs(x))/Math.max(1e-6,a[0]-b[0]),0,1);y=a[1]+(b[1]-a[1])*t;break}}return y}
/* the greenhouse: glass, pillars and roof */
function cgGlasshouse(S,mb,opt){
  const s0=S.gs0,s1=S.gs1,K2=opt.lo?3:5,stp=opt.lo?.25:.09,ss=[];for(let s=s0;s<s1-1e-6;s+=stp)ss.push(s);ss.push(s1);
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
        m=(s>sF&&s<sR&&!(S.bpillar&&Math.abs(s-(sF+sR)/2)<.045))?CGM.glass:CGM.paint}
      else if(s<S.roofF-.02){m=CGM.glass}                                                  /* windshield */
      else if(s<=S.roofR){m=S.glassRoof?CGM.glass:CGM.paint}
      else m=S.rearGlass?CGM.glass:CGM.paint
      const a=vtx(i,j,m),b=vtx(i,j+1,m),c=vtx(i+1,j+1,m),d=vtx(i+1,j,m);mb.q(a,b,c,d)}}
  S._gh={P,ni,nj}}
/* ---------------- small parts ---------------- */
function cgBasis(nx,ny,nz){/* tangent u (mostly sideways) and v from a surface normal */
  let ux=ny*0-nz*1,uy=nz*0-nx*0,uz=nx*1-ny*0;ux=-nz;uy=0;uz=nx;let l=Math.hypot(ux,uz);if(l<1e-4){ux=1;uz=0}else{ux/=l;uz/=l}
  const vx=ny*uz-nz*uy,vy=nz*ux-nx*uz,vz=nx*uy-ny*ux;return[ux,uy,uz,vx,vy,vz]}
/* a flat ellipse lying on the body at a point, facing along the normal, a hair above the surface */
function cgDisc(mb,p,rx,ry,m,seg,off,rot){const[ux,uy,uz,vx,vy,vz]=cgBasis(p.nx,p.ny,p.nz),cx=p.x+p.nx*(off==null?.006:off),cy=p.y+p.ny*(off==null?.006:off),cz=p.z+p.nz*(off==null?.006:off),cr=Math.cos(rot||0),sr=Math.sin(rot||0);
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
    let sx=ty*p.nz-tz*p.ny,sy=tz*p.nx-tx*p.nz,sz=tx*p.ny-ty*p.nx;const sl=Math.hypot(sx,sy,sz)||1;sx/=sl;sy/=sl;sz/=sl;const e=off==null?.006:off;
    L.push(mb.v(p.x+p.nx*e-sx*w/2,p.y+p.ny*e-sy*w/2,p.z+p.nz*e-sz*w/2,p.nx,p.ny,p.nz,m));R.push(mb.v(p.x+p.nx*e+sx*w/2,p.y+p.ny*e+sy*w/2,p.z+p.nz*e+sz*w/2,p.nx,p.ny,p.nz,m))}
  for(let i=0;i<n-1;i++)mb.q(L[i],R[i],R[i+1],L[i+1])}
/* a line of surface points at a given height across the body at distance s from the nose */
function cgRowAt(S,s,y,xMax,n){const pts=[];for(let i=0;i<n;i++){const x=-xMax+2*xMax*i/(n-1);pts.push(S.near(x,y,S.zs(s)))}return pts}
function cgDetails(S,mb,opt){
  const L=S.L,hw=S.W/2,lights={};
  /* ---- front lights ---- */
  const hy=S.nose+.03,hx=S.hw0*.66;
  for(const sg of[-1,1]){
    if(S.head=='round'){const p=S.near(sg*hx,hy+.02,S.zs(.2));cgDisc(mb,p,.105,.105,CGM.trim,16,.004);cgDisc(mb,p,.082,.082,CGM.head,16,.009)}
    else if(S.head=='oval'){const p=S.near(sg*hx*.95,hy+.01,S.zs(.2));cgDisc(mb,p,.15,.075,CGM.trim,16,.004,sg*.25);cgDisc(mb,p,.125,.055,CGM.head,16,.009,sg*.25)}
    else if(S.head=='slit'){const p=S.near(sg*hx*.95,hy+.03,S.zs(.22));cgDisc(mb,p,.24,.05,CGM.trim,16,.004,sg*.32);cgDisc(mb,p,.21,.03,CGM.head,16,.009,sg*.32)}
    else if(S.head=='led'){const p=S.near(sg*hx*.9,hy+.04,S.zs(.22));cgDisc(mb,p,.2,.06,CGM.trim,16,.004,sg*.28);const p2=S.near(sg*hx*.9,hy-.02,S.zs(.22));cgDisc(mb,p,.17,.018,CGM.head,12,.009,sg*.28);cgDisc(mb,p2,.12,.015,CGM.head,12,.009,sg*.28)}
    else if(S.head=='pop'){const p=S.near(sg*hx*.8,S.hood*.88,S.zs(S.cowl*.34));cgDisc(mb,p,.12,.06,CGM.trim,14,.003);cgDisc(mb,p,.095,.045,CGM.head,14,.006)}}
  lights.hx=hx;lights.hy=hy;lights.hz=-L/2+.1;
  /* ---- front intake and side intakes ---- */
  if(S.intake!='none'){const p=S.near(0,S.sill+.13,S.zs(.1));const wI=S.intake=='wide'?.62:S.intake=='mid'?.42:.3;cgDisc(mb,p,hw*wI,.075,CGM.under,16,.005);
    for(const sg of[-1,1]){const q=S.near(sg*hw*.82,S.sill+.1,S.zs(.14));cgDisc(mb,q,.09,.06,CGM.under,10,.005,sg*.3)}}
  if(S.duct){const p=S.near(0,S.hood,S.zs(S.cowl*.55));cgDisc(mb,p,.12,.2,CGM.under,12,.004)}      /* a bonnet vent */
  /* ---- side intakes behind the doors (mid-engine cars) ---- */
  if(S.sideIntake){for(const sg of[-1,1]){const s=S.roofR+.1,y=cgTopAt(S,s,hw*.85)-.18,p=S.near(sg*hw*.97,y,S.zs(s));cgDisc(mb,p,S.sideIntake*.55,.045,CGM.under,12,.005,-.3*sg)}}
  /* ---- door lines ---- */
  for(const sg of[-1,1]){const x0=S.near(sg*hw*.96,S.sill+.4,S.zs(S.cowl+.05)),pts=[];for(let k=0;k<=3;k++){const y=S.sill+.2+k*.18,s=S.cowl+.05+k*.01;pts.push(S.near(sg*hw*.99,y,S.zs(s)))}cgStrip(mb,pts,.008,CGM.trim,.003);void x0}
  /* ---- rear lights ---- */
  const tz=S.zs(L-.08),ty=S.deck-.06;
  if(S.tail_=='bar'){const pts=cgRowAt(S,L-.1,ty,S.hwTail*.82,9);cgStrip(mb,pts,.045,CGM.tail,.005);const pts2=cgRowAt(S,L-.1,ty-.07,S.hwTail*.8,9);cgStrip(mb,pts2,.02,CGM.trim,.004)}
  else if(S.tail_=='round'){for(const sg of[-1,1]){const p=S.near(sg*S.hwTail*.64,ty,tz);cgDisc(mb,p,.08,.08,CGM.trim,14,.004);cgDisc(mb,p,.062,.062,CGM.tail,14,.009)}}
  else if(S.tail_=='quad'){for(const sg of[-1,1])for(const dx of[.5,.78]){const p=S.near(sg*S.hwTail*dx,ty-.02,tz);cgDisc(mb,p,.062,.062,CGM.tail,12,.007)}}
  else if(S.tail_=='slit'){for(const sg of[-1,1]){const p=S.near(sg*S.hwTail*.62,ty,tz);cgDisc(mb,p,.22,.035,CGM.tail,12,.007,sg*-.12)}}
  else if(S.tail_=='wide'){const pts=cgRowAt(S,L-.1,ty+.02,S.hwTail*.9,11);cgStrip(mb,pts,.07,CGM.tail,.005)}
  lights.tx=S.hwTail*.64;lights.ty=ty;lights.tz=L/2-.08;
  /* ---- engine cover louvres ---- */
  if(S.louvres){for(let k=0;k<S.louvres;k++){const s=S.roofR+.08+k*.13,pts=[];for(let q=0;q<7;q++){const x=-hw*.4+hw*.8*q/6;pts.push(S.near(x,cgTopAt(S,s,x),S.zs(s)))}cgStrip(mb,pts,.028,CGM.under,.004)}}
  /* ---- mirrors ---- */
  if(S.mirror){for(const sg of[-1,1]){const s=S.cowl+.28,x=hw*S.gw+.1,y=cgTopAt(S,s,hw*S.gw)+.12;cgBox(mb,sg*x,y,S.zs(s),.055,.04,.07,CGM.paint,0);cgBox(mb,sg*(x-.05),y-.075,S.zs(s)+.02,.03,.03,.02,CGM.trim,0)}}
  /* ---- spoiler / wing ---- */
  const dz=S.zs(L-.2);
  if(S.wing=='duck'){cgBox(mb,0,S.deck+.04,S.zs(L-.16),S.hwTail*.78,.035,.1,CGM.paint,.15)}
  else if(S.wing=='lip'){cgBox(mb,0,S.deck+.015,S.zs(L-.08),S.hwTail*.8,.018,.05,CGM.carbon,.0)}
  else if(S.wing=='gt'||S.wing=='big'){const big=S.wing=='big',hy2=S.deck+(big?.36:.24),ww=S.hwTail*(big?.98:.9),ch=big?.17:.13;
    cgBox(mb,0,hy2,S.zs(L-(big?.28:.22)),ww,.012,ch,CGM.carbon,-.1);
    for(const sg of[-1,1]){cgBox(mb,sg*ww,hy2,S.zs(L-(big?.28:.22)),.012,big?.1:.07,ch+.02,CGM.carbon,-.05);cgBox(mb,sg*S.hwTail*.5,S.deck+(hy2-S.deck)/2,S.zs(L-(big?.3:.24)),.018,(hy2-S.deck)/2+.01,.035,CGM.carbon,0)}}
  /* ---- diffuser and exhaust ---- */
  if(S.diff){cgBox(mb,0,S.sill+.07,S.zs(L-.18),S.hwTail*.62,.012,.2,CGM.carbon,-.14);for(let k=-2;k<=2;k++)cgBox(mb,k*S.hwTail*.26,S.sill+.085,S.zs(L-.19),.008,.04,.18,CGM.carbon,-.14)}
  const ex=S.exh||0;for(let k=0;k<ex;k++){const px=ex==1?0:S.exhS=='center'?(k-(ex-1)/2)*.15:(k%2?1:-1)*(S.hwTail*(.52+.12*((k>>1)))),py=S.sill+.1+(S.exhS=='high'?.28:0);cgCylZ(mb,px,py,S.zs(L-.09),S.zs(L+.035),.047,CGM.exh,10)}
  S._lights=lights}
/* ---------------- wheels: tyre, rim with spokes, brake disc, caliper; axis along x, the outer face at +x ---------------- */
function cgWheel(R,w,rimR,spokes,style,rimCol,lo){
  const mb=new CGB(),seg=lo?10:36;
  const revolve=(prof,m,wrapSmooth)=>{const ni=prof.length,P=new Float32Array(ni*seg*3),ctr=new Float32Array(ni*3);
    for(let i=0;i<ni;i++){for(let j=0;j<seg;j++){const a=j/seg*Math.PI*2,k=(i*seg+j)*3;P[k]=prof[i][1];P[k+1]=Math.cos(a)*prof[i][0];P[k+2]=Math.sin(a)*prof[i][0]}ctr[i*3]=prof[i][1]}
    const Nn=cgGridNormals(P,ni,seg,true,ctr),ids=[];for(let i=0;i<ni;i++){const row=[];for(let j=0;j<seg;j++){const k=(i*seg+j)*3;row.push(mb.v(P[k],P[k+1],P[k+2],Nn[k],Nn[k+1],Nn[k+2],m))}ids.push(row)}
    for(let i=0;i<ni-1;i++)for(let j=0;j<seg;j++){const j1=(j+1)%seg;mb.q(ids[i][j],ids[i][j1],ids[i+1][j1],ids[i+1][j])}};
  const sw=R-rimR,h=w/2;
  if(lo){revolve([[rimR*.97,-h*.9],[R-.012,-h*.95],[R,-h*.45],[R,h*.45],[R-.012,h*.95],[rimR*.97,h*.9]],CGM.rubber);revolve([[rimR*.97,h*.9],[rimR*.5,h*.92],[0,h*.94]],CGM.rim);mb.rim=rimCol;return mb}
  revolve([[rimR*.97,-h*.9],[rimR+sw*.3,-h*.985],[rimR+sw*.72,-h],[R-.014,-h*.88],[R-.002,-h*.55],[R,0],[R-.002,h*.55],[R-.014,h*.88],[rimR+sw*.72,h],[rimR+sw*.3,h*.985],[rimR*.97,h*.9]],CGM.rubber);
  /* rim barrel + lip */
  revolve([[rimR*.97,h*.88],[rimR,h*.96],[rimR*.985,h*.8],[rimR*.9,h*.62],[rimR*.9,-h*.5]],CGM.rim);
  const fx=h*.7;                                                    /* the plane of the spokes */
  if(style=='disc'){revolve([[rimR*.9,fx],[rimR*.55,fx+.01],[.04,fx+.02],[0,fx+.025]],CGM.rim)}
  else{const n=spokes,th=style=='mesh'?.026:.05;for(let s=0;s<n;s++){const a=s/n*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a),r0=.05,r1=rimR*.92;
      const pts=[[r0,-th*.5],[r1,-th*.9],[r1,th*.9],[r0,th*.5]];const ids=[];for(const[r,t]of pts){const y=ca*r-sa*t,z=sa*r+ca*t;ids.push(mb.v(fx+.012,y,z,1,0,0,CGM.rim))}mb.q(ids[0],ids[1],ids[2],ids[3]);
      const ids2=[];for(const[r,t]of pts){const y=ca*r-sa*t,z=sa*r+ca*t;ids2.push(mb.v(fx-.012,y,z,-1,0,0,CGM.rim))}mb.q(ids2[3],ids2[2],ids2[1],ids2[0])}
    revolve([[.07,fx+.008],[.045,fx+.022],[0,fx+.026]],CGM.rim)}
  /* brake disc and caliper behind the spokes */
  revolve([[rimR*.86,fx-.07],[rimR*.86,fx-.09],[.07,fx-.09],[.07,fx-.07]],CGM.disc);
  const ca=.9;cgBox(mb,fx-.05,Math.cos(ca)*rimR*.7,Math.sin(ca)*rimR*.7,.035,.06,.05,CGM.caliper,0);
  mb.rim=rimCol;return mb}
/* ---------------- the whole car ---------------- */
function cgBuild(o,opt){
  opt=opt||{};const S=cgSpec(o);const body=new CGB();
  cgBody(S,body,opt);cgGlasshouse(S,body,opt);if(!opt.lo)cgDetails(S,body,opt);else cgDetails(Object.assign(S,{mirror:0,louvres:0,diff:0,exh:0}),body,opt);
  const wf=cgWheel(S.rf,S.wf,S.rimF,S.spoke,S.wheelStyle,null,opt.lo),wr=cgWheel(S.rr,S.wr,S.rimR,S.spoke,S.wheelStyle,null,opt.lo);
  return{S,body,wheelF:wf,wheelR:wr}}
