'use strict';
/* ===== heightmap generation, road carving, ground colours, height queries ===== */
const CUT_SLOPE=.36;
const RAILS=true;    /* metal guard rails: along the divided highways (open at every junction and garage), wherever the ground falls away beside a road, and on bridges */
const RAIL_IN=RSH-.47;   /* the rail's inner face, metres beyond the edge of the asphalt (the shoulder stays drivable) */
function hmIdx(x,z){return[(x+W.half)/W.T,(z+W.half)/W.T]}
/* bilinear terrain height at a world position */
function terrainH(x,z){const N=W.N;let gx=(x+W.half)/W.T,gz=(z+W.half)/W.T;gx=clamp(gx,0,N-1.001);gz=clamp(gz,0,N-1.001);const i=gx|0,j=gz|0,fx=gx-i,fz=gz-j,h=W.hm,o=j*N+i;
  return(h[o]*(1-fx)+h[o+1]*fx)*(1-fz)+(h[o+N]*(1-fx)+h[o+N+1]*fx)*fz}
function terrainSlope(x,z){const e=3;return Math.hypot(terrainH(x+e,z)-terrainH(x-e,z),terrainH(x,z+e)-terrainH(x,z-e))/(2*e)}
async function genHeight(prog){
  const N=W.N,T=W.T,half=W.half,NC=N/2+1,C=new Float32Array(NC*NC);
  for(let j=0;j<NC;j++){const z=-half+j*T*2;for(let i=0;i<NC;i++)C[j*NC+i]=baseH(-half+i*T*2,z);if((j&31)==31){prog&&prog(j/NC);await nextTick()}}
  const hm=W.hm=new Float32Array(N*N);
  for(let j=0;j<N;j++){const gj=j/2,j0=Math.min(gj|0,NC-2),fj=gj-j0;for(let i=0;i<N;i++){const gi=i/2,i0=Math.min(gi|0,NC-2),fi=gi-i0,o=j0*NC+i0;
    hm[j*N+i]=(C[o]*(1-fi)+C[o+1]*fi)*(1-fj)+(C[o+NC]*(1-fi)+C[o+NC+1]*fi)*fj}}
}
/* flatten terrain around every road (not under bridges), with cut/fill banks; returns the distance-beyond-road field */
async function carveRoads(prog){
  const N=W.N,T=W.T,half=W.half,hm=W.hm,D=new Float32Array(N*N).fill(1e9),Yr=new Float32Array(N*N),PV=new Float32Array(N*N).fill(1e9);
  for(let ri=0;ri<ROADS.length;ri++){const r=ROADS[ri],n=r.n,cnt=r.closed?n:n-1;
    for(let i=0;i<cnt;i++){const b=(i+1)%n;if(r.br[i]&&r.br[b])continue;
      const ax=r.X[i],az=r.Z[i],ay=r.Y[i],bx=r.X[b],bz=r.Z[b],by=r.Y[b],dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz||1,wk=Math.min(r.wk[i],r.wk[b]),flat=r.hw*wk+RSH+4.1,R=flat+90;
      const i0=Math.max(0,Math.floor((Math.min(ax,bx)-R+half)/T)),i1=Math.min(N-1,Math.ceil((Math.max(ax,bx)+R+half)/T)),j0=Math.max(0,Math.floor((Math.min(az,bz)-R+half)/T)),j1=Math.min(N-1,Math.ceil((Math.max(az,bz)+R+half)/T));
      for(let j=j0;j<=j1;j++){const wz=-half+j*T,row=j*N;for(let ii=i0;ii<=i1;ii++){const wx=-half+ii*T;let t=((wx-ax)*dx+(wz-az)*dz)/l2;t=t<0?0:t>1?1:t;const px=ax+dx*t-wx,pz=az+dz*t-wz,dist=Math.sqrt(px*px+pz*pz),d=dist-flat,cfq=r.cf[i]+(r.cf[b]-r.cf[i])*t,yh=ay+(by-ay)*t+(cfq?clamp(((wx-ax)*(-dz)+(wz-az)*dx)/Math.sqrt(l2),-flat,flat)*cfq:0);
        if(d<D[row+ii]){D[row+ii]=d;Yr[row+ii]=yh+(r.sw?.55:0)}   /* city: the ground beyond the curb is at sidewalk level (c = Yr - .5 below) */
        /* inside ANY road's paved footprint the ground must stay below that road's surface (the lowest of overlapping roads wins) */
        if(dist<r.hw*wk+(r.sw?.9:RSH+1.4)){const p=yh-.55;if(p<PV[row+ii])PV[row+ii]=p}}}}
    prog&&prog(ri/ROADS.length);await nextTick()}
  for(let k=0;k<N*N;k++){const d=D[k];if(d<1e8){const dd=d<0?0:d,c=Yr[k]-.5,lo=c-CUT_SLOPE*dd,hi=c+CUT_SLOPE*dd,h=hm[k];hm[k]=h<lo?lo:h>hi?hi:h}if(PV[k]<1e8&&hm[k]>PV[k])hm[k]=PV[k]}
  /* soften creases in the banks only (never under the asphalt) */
  const tmp=new Float32Array(hm);
  for(let pass=0;pass<2;pass++){for(let j=1;j<N-1;j++)for(let i=1;i<N-1;i++){const k=j*N+i,d=D[k];if(d>0&&d<50){tmp[k]=(hm[k]*4+hm[k-1]+hm[k+1]+hm[k-N]+hm[k+N]+(hm[k-N-1]+hm[k-N+1]+hm[k+N-1]+hm[k+N+1])*.5)/10}else tmp[k]=hm[k]}hm.set(tmp);for(let k=0;k<N*N;k++)if(PV[k]<1e8&&hm[k]>PV[k])hm[k]=PV[k]}
  const D8=W.D8=new Uint8Array(N*N);for(let k=0;k<N*N;k++)D8[k]=D[k]>250?250:D[k]<0?0:D[k]+.5|0;
  return D}
/* guardrails: continuous on the divided highways (except around junctions), wherever the ground falls away steeply beside a road, and always on bridges */
/* DRIVE-THROUGH REPAIR SHOPS (batch 7): a roofed bay open at both ends, beside a main road out of town, parallel to it: leave the road, drive through, and the car is fixed.
   Picked here (the terrain and the roads are known): every 600 m along the wide roads outside the towns, on whichever side the ground is level with the road for the whole bay and its two
   approaches, away from junctions (120 m), garages (150 m), water, bridges and other asphalt; at least 1.1 km apart. */
function pickRepairs(){REPAIRS.length=0;const L=17,W2=7.5;
  const far=(x,z,d)=>REPAIRS.every(p=>Math.hypot(p.x-x,p.z-z)>d)&&SAFEHOUSES.every(s=>Math.hypot(s.x-x,s.z-z)>150)&&JUNC.every(J=>Math.hypot(J.x-x,J.z-z)>120);
  const built=(x,z)=>inBox(x,z,CITY,80)||inBox(x,z,VALLEY,80)||inBox(x,z,BEACH,80)||inBox(x,z,RESORT,80)||ZONES.some(zn=>inBox(x,z,zn.b,80))||FIELDS.some(f=>inBox(x,z,f.b,20));
  for(const r of ROADS){if(r.city||r.hw<7||r.n*r.ds<900)continue;const st=Math.round(600/r.ds),m=Math.round(60/r.ds);
    for(let i=m;i<r.n-m;i+=st){if(r.br[i]||r.br[Math.max(0,i-8)]||r.br[Math.min(r.n-1,i+8)])continue;const t=_tan(r,i),nx=-t[1],nz=t[0],y=r.Y[i];
      for(const sd of[1,-1]){const off=r.hw+RSH+6.5,cx=r.X[i]+nx*sd*off,cz=r.Z[i]+nz*sd*off;if(built(cx,cz)||!far(cx,cz,1100))continue;let okk=true;
        for(let a=-1.6;a<=1.6&&okk;a+=.4)for(const b of[-1,-.3,.3,1]){const px=cx+t[0]*a*L+nx*sd*b*W2*.5,pz=cz+t[1]*a*L+nz*sd*b*W2*.5,h=terrainH(px,pz);if(h<2||Math.abs(h-y)>1.3){okk=false;break}}
        /* the way in and out: level from the road's edge to each opening (no drop off an embankment) */
        for(const e of[-1,1])for(let f=0;f<=1&&okk;f+=.1){const a=e*(L*.5+3+12*(1-f)),b=-(off-r.hw-RSH)*(1-f)-W2*.2*f,px=cx+t[0]*a+nx*sd*b,pz=cz+t[1]*a+nz*sd*b,h=terrainH(px,pz);if(Math.abs(h-y)>.9)okk=false}
        if(!okk)continue;for(let a=-1;a<=1&&okk;a+=.25)if(otherAsphalt(cx+t[0]*a*L,cz+t[1]*a*L,r,y,4))okk=false;if(!okk)continue;
        REPAIRS.push({id:'rp'+REPAIRS.length,x:cx,z:cz,cs:t[0],sn:t[1],side:sd,road:r.id,y,L,W:W2});break}}}}
function railPass(){
  pickRepairs();
  if(!RAILS){for(const r of ROADS)r.rail.fill(0);return}
  /* junctions: where a road starts or ends on another road */
  /* rails open at every junction (JUNC: where a road end sits on another road, both roads) and in front of every garage */
  const jz=[];for(const J of JUNC)jz.push(J.x,J.z,J.rad+62);for(const s of SAFEHOUSES)jz.push(s.x,s.z,46);for(const p of REPAIRS)jz.push(p.x,p.z,66);
  const nearJ=(x,z)=>{for(let q=0;q<jz.length;q+=3){if((jz[q]-x)**2+(jz[q+1]-z)**2<jz[q+2]*jz[q+2])return true}return false};
  for(const r of ROADS){const n=r.n,raw=new Uint8Array(n);
    for(let i=0;i<n;i++){const a=(i+1<n?i+1:i),b=(i>0?i-1:i);let tx=r.X[a]-r.X[b],tz=r.Z[a]-r.Z[b];const l=Math.hypot(tx,tz)||1;tx/=l;tz/=l;const nx=-tz,nz=tx,off=r.hw+RSH+7;let m=0;
      if(r.br[i])m=3;else if(!r.city&&!nearJ(r.X[i],r.Z[i])){if(r.Y[i]-terrainH(r.X[i]-nx*off,r.Z[i]-nz*off)>5.5)m|=1;if(r.Y[i]-terrainH(r.X[i]+nx*off,r.Z[i]+nz*off)>5.5)m|=2;
        if(r.style==1&&r.wk[i]>.99)m=3}
      raw[i]=m}
    for(let i=0;i<n;i++){let m=0;for(let k=-4;k<=4;k++){const j=r.closed?((i+k)%n+n)%n:Math.min(n-1,Math.max(0,i+k));m|=raw[j]}r.rail[i]=m}}}
/* ground colour map (sqrt-linear bytes) */
function genColors(){
  const CN=W.CN,N=W.N,half=W.half,cs=W.size/CN,col=W.col=new Uint8Array(CN*CN*4),hm=W.hm,D8=W.D8;
  const sq=(r,g,b)=>[Math.sqrt(r),Math.sqrt(g),Math.sqrt(b)];
  for(let j=0;j<CN;j++){const z=-half+(j+.5)*cs,gj=Math.min(N-2,Math.max(1,Math.round((z+half)/W.T)));
    for(let i=0;i<CN;i++){const x=-half+(i+.5)*cs,gi=Math.min(N-2,Math.max(1,Math.round((x+half)/W.T)));
      const k=gj*N+gi,h=hm[k],sx=(hm[k+1]-hm[k-1])/(2*W.T),sz=(hm[k+N]-hm[k-N])/(2*W.T),sl=Math.hypot(sx,sz),dr=D8[k];
      const nz1=fbm(x*.02,z*.02,31,2),nz2=fbm(x*.0035,z*.0035,37,3);
      let c;
      const dry=Math.min(1,sstep(1300,2300,z)*.8+sstep(500,1800,x)*.15+sstep(2600,3800,x)*.9);
      const gr=[.075+.035*nz1,.16+.05*nz1,.04+.02*nz1],dg=[.30,.23,.095];
      c=[lerp(gr[0],dg[0],dry*(.5+nz2*.6)),lerp(gr[1],dg[1],dry*(.5+nz2*.6)),lerp(gr[2],dg[2],dry*(.5+nz2*.6))];
      const forest=forestAt(x,z,h,sl,dr);if(forest)c=[.04+.02*nz1,.09+.03*nz1,.02];
      const inCity=inBox(x,z,CITY,10)||inBox(x,z,VALLEY,10)||inBox(x,z,BEACH,10)||inBox(x,z,RESORT,10);if(inCity)c=inBox(x,z,VALLEY,10)?[.2,.19,.17]:inBox(x,z,BEACH,10)?[.36+.03*nz1,.31+.03*nz1,.22]:inBox(x,z,RESORT,10)?[.33+.03*nz1,.27+.03*nz1,.18]:[.17,.165,.155];if(inBox(x,z,PARK,0))c=[.07+.03*nz1,.2+.05*nz1,.05];
      for(const zn of ZONES)if(inBox(x,z,zn.b,10)){c=[zn.c[0]+.03*nz1,zn.c[1]+.03*nz1,zn.c[2]]}
      for(const fl of FIELDS)if(inBox(x,z,fl.b,0)){const sp=(((x*.06+z*.025)|0)&1)?fl.c[0]:fl.c[1];c=[sp[0]*(.9+.2*nz1),sp[1]*(.9+.2*nz1),sp[2]]}
      /* sand */const sd=1-sstep(2.2,5.5,h+nz1*2);if(sd>0)c=[lerp(c[0],.46,sd),lerp(c[1],.37,sd),lerp(c[2],.22,sd)];
      if(h<.3){const w=sstep(-1.5,.3,h);c=[lerp(.2,c[0],w),lerp(.17,c[1],w),lerp(.1,c[2],w)]}
      /* rock on slopes and up high, snow on the peaks */
      const rk=Math.max(sstep(.5,.85,sl),sstep(230,330,h+nz2*60)*.9);if(rk>0)c=[lerp(c[0],.2+.05*nz1,rk),lerp(c[1],.18+.05*nz1,rk),lerp(c[2],.16,rk)];
      const sn=sstep(360,420,h+(nz2-.5)*80)*(1-sstep(.8,1.2,sl));if(sn>0)c=[lerp(c[0],.8,sn),lerp(c[1],.83,sn),lerp(c[2],.9,sn)];
      /* freshly cut banks beside the roads are bare earth */
      if(dr>0&&dr<22&&sl>.3&&!inCity){const e=(1-sstep(8,22,dr))*sstep(.3,.5,sl);c=[lerp(c[0],.2,e),lerp(c[1],.14,e),lerp(c[2],.08,e)]}
      const o=(j*CN+i)*4,s=sq(c[0],c[1],c[2]);col[o]=Math.min(255,s[0]*255);col[o+1]=Math.min(255,s[1]*255);col[o+2]=Math.min(255,s[2]*255);col[o+3]=255}}
}
function forestAt(x,z,h,sl,dr){if(h<7||h>300||sl>.5||dr<26)return false;if(inBox(x,z,CITY,80)||inBox(x,z,VALLEY,80)||inBox(x,z,PARK,40)||inBox(x,z,BEACH,60)||inBox(x,z,RESORT,60))return false;
  for(const zn of ZONES)if(inBox(x,z,zn.b,70))return false;for(const fl of FIELDS)if(inBox(x,z,fl.b,12))return false;
  const f=fbm(x*.0042,z*.0042,21,3)*1.0+.12*sstep(-200,900,x)*sstep(100,-900,z)+(fbm(x*.02,z*.02,22,2)-.5)*.2;return f>.58+sstep(2500,3300,x)*.9}
/* RGBA8 texture data for the GPU: 16-bit height in R/G */
function heightTexData(){const N=W.N,hm=W.hm,o=new Uint8Array(N*N*4);for(let k=0;k<N*N;k++){let v=Math.round((hm[k]-W.hmin)/W.hrange*65535);v=v<0?0:v>65535?65535:v;o[k*4]=v>>8;o[k*4+1]=v&255;o[k*4+2]=0;o[k*4+3]=255}return o}
