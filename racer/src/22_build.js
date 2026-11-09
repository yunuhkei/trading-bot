'use strict';
/* ===== static geometry builders: road ribbons, barriers, bridges, lamps, buildings, trees. Pure data (no GL). ===== */
/* prop mesh: 28-byte vertices = pos f32x3 | normal i8x3 + window flag i8 | colour u8x4 | uv f32x2 */
class MB{constructor(){this.cap=512;this.f=new Float32Array(this.cap*7);this.u=new Uint8Array(this.f.buffer);this.s=new Int8Array(this.f.buffer);this.n=0;this.ix=new Uint16Array(this.cap*4);this.ni=0;
  this.x0=1e9;this.x1=-1e9;this.y0=1e9;this.y1=-1e9;this.z0=1e9;this.z1=-1e9}
 grow(){const c=this.cap*2,f=new Float32Array(c*7);f.set(this.f);this.f=f;this.u=new Uint8Array(f.buffer);this.s=new Int8Array(f.buffer);this.cap=c;const ix=new Uint16Array(c*4);ix.set(this.ix);this.ix=ix}
 v(x,y,z,nx,ny,nz,r,g,b,u,v,w){if(this.n>=this.cap)this.grow();const o=this.n*7,B=this.n*28;this.f[o]=x;this.f[o+1]=y;this.f[o+2]=z;this.s[B+12]=Math.round(nx*127);this.s[B+13]=Math.round(ny*127);this.s[B+14]=Math.round(nz*127);this.s[B+15]=w===2?-127:(w?127:0);
  this.u[B+16]=r;this.u[B+17]=g;this.u[B+18]=b;this.u[B+19]=255;this.f[o+5]=u;this.f[o+6]=v;
  if(x<this.x0)this.x0=x;if(x>this.x1)this.x1=x;if(y<this.y0)this.y0=y;if(y>this.y1)this.y1=y;if(z<this.z0)this.z0=z;if(z>this.z1)this.z1=z;return this.n++}
 t(a,b,c){if(this.ni+3>this.ix.length){const ix=new Uint16Array(this.ix.length*2);ix.set(this.ix);this.ix=ix}this.ix[this.ni++]=a;this.ix[this.ni++]=b;this.ix[this.ni++]=c}
 q(a,b,c,d){this.t(a,b,c);this.t(a,c,d)}}
/* a set of meshes keyed by 128 m cell + category; splits automatically before the 16-bit index limit */
const PCELL=128,PCATS=3;/* 0 street furniture, 1 buildings, 2 trees */
const PSET=new Map();
function pmb(x,z,cat,need){const k=(Math.floor((x+W.half)/PCELL)*128+Math.floor((z+W.half)/PCELL))*4+cat;let L=PSET.get(k);if(!L){L=[new MB()];PSET.set(k,L)}let m=L[L.length-1];if(m.n+need>60000){m=new MB();L.push(m)}return m}
/* box with flat-shaded faces, ambient-occlusion gradient on the walls, optional window tiling */
function pbox(cat,cx,y0,cz,hx,y1,hz,r,g,b,win,ao){const m=pmb(cx,cz,cat,24),h=y1-y0,a0=ao==null?.62:ao;const sc=(k)=>Math.round(k);
  const wall=(ax,az,bx,bz,nx,nz,len)=>{const u1=len/3.2,v1=h/3.4;const i0=m.v(ax,y0,az,nx,0,nz,r*a0,g*a0,b*a0,0,v1,win),i1=m.v(bx,y0,bz,nx,0,nz,r*a0,g*a0,b*a0,u1,v1,win),i2=m.v(bx,y1,bz,nx,0,nz,r,g,b,u1,0,win),i3=m.v(ax,y1,az,nx,0,nz,r,g,b,0,0,win);m.q(i0,i1,i2,i3)};
  wall(cx-hx,cz+hz,cx+hx,cz+hz,0,1,hx*2);wall(cx+hx,cz+hz,cx+hx,cz-hz,1,0,hz*2);wall(cx+hx,cz-hz,cx-hx,cz-hz,0,-1,hx*2);wall(cx-hx,cz-hz,cx-hx,cz+hz,-1,0,hz*2);
  const rf=.82,i0=m.v(cx-hx,y1,cz-hz,0,1,0,r*rf,g*rf,b*rf,.03,.03,0),i1=m.v(cx+hx,y1,cz-hz,0,1,0,r*rf,g*rf,b*rf,.03,.03,0),i2=m.v(cx+hx,y1,cz+hz,0,1,0,r*rf,g*rf,b*rf,.03,.03,0),i3=m.v(cx-hx,y1,cz+hz,0,1,0,r*rf,g*rf,b*rf,.03,.03,0);m.q(i0,i3,i2,i1)}
/* gable roof prism over a box footprint (houses, barns) */
function proof(cat,cx,y,cz,hx,hz,rh,r,g,b,alongX){const m=pmb(cx,cz,cat,10);
  if(alongX){const a=m.v(cx-hx,y,cz+hz,0,.7,.7,r,g,b,.03,.03,0),c=m.v(cx+hx,y,cz+hz,0,.7,.7,r,g,b,.03,.03,0),d=m.v(cx+hx,y+rh,cz,0,.7,.7,r,g,b,.03,.03,0),e=m.v(cx-hx,y+rh,cz,0,.7,.7,r,g,b,.03,.03,0);m.q(a,c,d,e);
   const a2=m.v(cx-hx,y,cz-hz,0,.7,-.7,r*.85,g*.85,b*.85,.03,.03,0),c2=m.v(cx+hx,y,cz-hz,0,.7,-.7,r*.85,g*.85,b*.85,.03,.03,0),d2=m.v(cx+hx,y+rh,cz,0,.7,-.7,r*.85,g*.85,b*.85,.03,.03,0),e2=m.v(cx-hx,y+rh,cz,0,.7,-.7,r*.85,g*.85,b*.85,.03,.03,0);m.q(c2,a2,e2,d2)}
  else{const a=m.v(cx+hx,y,cz-hz,.7,.7,0,r,g,b,.03,.03,0),c=m.v(cx+hx,y,cz+hz,.7,.7,0,r,g,b,.03,.03,0),d=m.v(cx,y+rh,cz+hz,.7,.7,0,r,g,b,.03,.03,0),e=m.v(cx,y+rh,cz-hz,.7,.7,0,r,g,b,.03,.03,0);m.q(a,c,d,e);
   const a2=m.v(cx-hx,y,cz-hz,-.7,.7,0,r*.85,g*.85,b*.85,.03,.03,0),c2=m.v(cx-hx,y,cz+hz,-.7,.7,0,r*.85,g*.85,b*.85,.03,.03,0),d2=m.v(cx,y+rh,cz+hz,-.7,.7,0,r*.85,g*.85,b*.85,.03,.03,0),e2=m.v(cx,y+rh,cz-hz,-.7,.7,0,r*.85,g*.85,b*.85,.03,.03,0);m.q(c2,a2,e2,d2)}}
/* cone (smooth-shaded) */
function pcone(cat,cx,y0,cz,rad,h,r,g,b,seg,rot){const m=pmb(cx,cz,cat,seg*2+2);const ring=[],ap=[];for(let i=0;i<seg;i++){const a=rot+i/seg*TAU,c=Math.cos(a),s=Math.sin(a),sl=rad/h,nl=1/Math.hypot(1,sl);
  ring.push(m.v(cx+c*rad,y0,cz+s*rad,c*nl,sl*nl,s*nl,r*.7,g*.7,b*.7,.03,.03,0));ap.push(m.v(cx,y0+h,cz,c*nl,sl*nl,s*nl,r,g,b,.03,.03,0))}
  for(let i=0;i<seg;i++){const j=(i+1)%seg;m.t(ring[i],ap[i],ring[j])}}
function ptrunk(cat,cx,y0,cz,rad,h,r,g,b){const m=pmb(cx,cz,cat,8),a=[];for(let i=0;i<4;i++){const an=i*1.5708+.78,c=Math.cos(an),s=Math.sin(an);a.push(m.v(cx+c*rad,y0,cz+s*rad,c,0,s,r*.6,g*.6,b*.6,.03,.03,0),m.v(cx+c*rad,y0+h,cz+s*rad,c,0,s,r,g,b,.03,.03,0))}
  for(let i=0;i<4;i++){const j=(i+1)%4;m.t(a[i*2],a[j*2],a[j*2+1]);m.t(a[i*2],a[j*2+1],a[i*2+1])}}
function pblob(cat,cx,y0,cz,rx,ry,r,g,b,rot){const m=pmb(cx,cz,cat,26),seg=7,rows=[[-.25,.78],[.35,1],[.95,.55]];const rings=[];
  rows.forEach(rw=>{const rr=[];for(let i=0;i<seg;i++){const a=rot+i/seg*TAU+rw[0],c=Math.cos(a),s=Math.sin(a),nl=1/Math.hypot(c,rw[0]*.7+.3,s);rr.push(m.v(cx+c*rx*rw[1],y0+ry*(.5+rw[0]*.55),cz+s*rx*rw[1],c*nl,(.3+rw[0]*.7)*nl,s*nl,r*(.75+rw[0]*.3),g*(.75+rw[0]*.3),b*(.75+rw[0]*.3),.03,.03,0))}rings.push(rr)});
  const top=m.v(cx,y0+ry*1.2,cz,0,1,0,r,g,b,.03,.03,0);for(let k=0;k<2;k++)for(let i=0;i<seg;i++){const j=(i+1)%seg;m.q(rings[k][i],rings[k][j],rings[k+1][j],rings[k+1][i])}for(let i=0;i<seg;i++)m.t(rings[2][i],rings[2][(i+1)%seg],top)}
function ptree(x,z,rng,y){const t=rng(),sc=.8+rng()*.7,rot=rng()*6;
  if(y>110||t<.55){const h=9*sc,rd=2.6*sc;ptrunk(2,x,y-.2,z,.28,2.2*sc,70,52,36);pcone(2,x,y+1.4*sc,z,rd,h*.62,22,66,34,7,rot);pcone(2,x,y+h*.45,z,rd*.68,h*.55,28,78,40,7,rot+.4)}
  else{const g=100+rng()*50;ptrunk(2,x,y-.2,z,.3,3*sc,72,54,38);pblob(2,x,y+2*sc,z,3.2*sc,5*sc,46+rng()*30,g,40,rot)}}
/* ---------- road ribbons ---------- */
const ROAD_PIECE=64;
let _cj=null;
/* where city streets cross or end on each other: no lane markings there */
function cityJunctions(){if(_cj)return _cj;const cr=ROADS.filter(r=>r.city),cell=24,H=new Map(),cl=[];
  cr.forEach((r,ri)=>{for(let i=0;i<r.n;i+=2){const k=Math.floor(r.X[i]/cell)+','+Math.floor(r.Z[i]/cell);let L=H.get(k);if(!L)H.set(k,L=[]);L.push(ri,i)}});
  /* wherever the centre-lines of two streets meet (a crossing, or a street ending on another), gather the meeting samples into one junction point */
  cr.forEach((A,ai)=>{for(let i=0;i<A.n;i+=2){const cx=Math.floor(A.X[i]/cell),cz=Math.floor(A.Z[i]/cell);let hit=false;
    for(let a=-1;a<=1&&!hit;a++)for(let b=-1;b<=1&&!hit;b++){const L=H.get((cx+a)+','+(cz+b));if(!L)continue;for(let q=0;q<L.length;q+=2){const bi=L[q];if(bi===ai)continue;const B=cr[bi],j=L[q+1];if(Math.hypot(A.X[i]-B.X[j],A.Z[i]-B.Z[j])<(A.hw+B.hw)*.7){hit=true;break}}}
    if(!hit)continue;let c=null;for(const k of cl)if(Math.hypot(k.x-A.X[i],k.z-A.Z[i])<26){c=k;break}
    if(c){c.x=(c.x*c.n+A.X[i])/(c.n+1);c.z=(c.z*c.n+A.Z[i])/(c.n+1);c.n++}else cl.push({x:A.X[i],z:A.Z[i],n:1})}});
  const out=[];for(const k of cl)out.push(k.x,k.z);return _cj=out}
function buildRoadMeshes(){
  _cj=null;const out=[];
  for(const r of ROADS){
    const n=r.n,rows=r.closed?n+1:n,S=r.S;
    if(r.city){const ix=cityJunctions();for(let i=0;i<n;i++){let m=1;for(let q=0;q<ix.length;q+=2){const d=Math.hypot(r.X[i]-ix[q],r.Z[i]-ix[q+1]);if(d<r.hw+10){const v=sstep(r.hw+1,r.hw+9,d);if(v<m)m=v}}r.mk[i]=m}}
    for(let p0=0;p0<rows-1;p0+=ROAD_PIECE){
      const p1=Math.min(rows-1,p0+ROAD_PIECE),cnt=p1-p0+1,V=new Float32Array(cnt*6*7),I=new Uint16Array((cnt-1)*5*6);let bx0=1e9,bx1=-1e9,by0=1e9,by1=-1e9,bz0=1e9,bz1=-1e9;
      for(let k=0;k<cnt;k++){const gi=p0+k,i=gi%n;const a=r.closed?(i+1)%n:Math.min(n-1,i+1),b=r.closed?(i+n-1)%n:Math.max(0,i-1);let tx=r.X[a]-r.X[b],tz=r.Z[a]-r.Z[b];const tl=Math.hypot(tx,tz)||1;tx/=tl;tz/=tl;const nx=-tz,nz=tx;
        const hw=r.hw*r.wk[i],y=r.Y[i],sv=(gi==n?r.len:S[i]),fl=r.lanes*16+r.style+.1+.8*r.mk[i];
        const L=[-(hw+RSH+.5),-(hw+RSH),-hw,hw,hw+RSH,hw+RSH+.5],DY=[-.5,-.12,0,0,-.12,-.5];
        for(let c=0;c<6;c++){const o=(k*6+c)*7,lt=L[c],x=r.X[i]+nx*lt,z=r.Z[i]+nz*lt,yy=y+DY[c];V[o]=x;V[o+1]=yy;V[o+2]=z;V[o+3]=Math.max(-hw-RSH,Math.min(hw+RSH,lt));V[o+4]=sv;V[o+5]=hw;V[o+6]=fl;
          if(x<bx0)bx0=x;if(x>bx1)bx1=x;if(yy<by0)by0=yy;if(yy>by1)by1=yy;if(z<bz0)bz0=z;if(z>bz1)bz1=z}}
      let q=0;for(let k=0;k<cnt-1;k++)for(let c=0;c<5;c++){const a=k*6+c,b=a+1,cc=a+6,d=cc+1;I[q++]=a;I[q++]=cc;I[q++]=b;I[q++]=b;I[q++]=cc;I[q++]=d}
      out.push({V,I,cx:(bx0+bx1)/2,cy:(by0+by1)/2,cz:(bz0+bz1)/2,rad:Math.hypot(bx1-bx0,by1-by0,bz1-bz0)/2+2})}}
  return out}
/* ---------- barriers, bridge decks + piers, lamp posts ---------- */
const COLC=[],COLR=[],COLO=[];
/* lights that glow: street lamp heads (x,y,z) and neon signs (x,y,z,r,g,b,size); the renderer draws a glow for the ones near the car and lights the wet road with them */
const LAMPS=[],NEONS=[];/* colliders: circles [x,z,r], rects [x0,z0,x1,z1,top], rotated rects [cx,z,hx,hz,cos,sin,top] */
function buildFurniture(){
  const cc=[170,166,158];
  for(const r of ROADS){const n=r.n,cnt=r.closed?n:n-1;
    for(let i=0;i<cnt;i++){const j=(i+1)%n;const a=r.rail[i]&r.rail[j];if(!a&&!(r.br[i]&&r.br[j]))continue;
      const dx=r.X[j]-r.X[i],dz=r.Z[j]-r.Z[i],l=Math.hypot(dx,dz)||1,tx=dx/l,tz=dz/l,nx=-tz,nz=tx,hwi=r.hw*r.wk[i],hwj=r.hw*r.wk[j],mx=(r.X[i]+r.X[j])/2,mz=(r.Z[i]+r.Z[j])/2;
      for(const sd of[-1,1]){if(!((a>>(sd<0?0:1))&1))continue;
        const m=pmb(mx,mz,0,12),oi=hwi+.9,oj=hwj+.9,w=.3,H=.95,yi=r.Y[i],yj=r.Y[j];
        const P=(o,y,t)=>[(t?r.X[j]:r.X[i])+nx*sd*o,y+(t?yj:yi),(t?r.Z[j]:r.Z[i])+nz*sd*o];
        const face=(p0,p1,p2,p3,n3,sh)=>{const k0=m.v(p0[0],p0[1],p0[2],n3[0],n3[1],n3[2],cc[0]*sh,cc[1]*sh,cc[2]*sh,.03,.03,0),k1=m.v(p1[0],p1[1],p1[2],n3[0],n3[1],n3[2],cc[0]*sh,cc[1]*sh,cc[2]*sh,.03,.03,0),k2=m.v(p2[0],p2[1],p2[2],n3[0],n3[1],n3[2],cc[0]*sh,cc[1]*sh,cc[2]*sh,.03,.03,0),k3=m.v(p3[0],p3[1],p3[2],n3[0],n3[1],n3[2],cc[0]*sh,cc[1]*sh,cc[2]*sh,.03,.03,0);m.q(k0,k1,k2,k3)};
        /* inner face (towards the road), top, outer face */
        face(P(oi-w,0,0),P(oj-w,0,1),P(oj-w,H,1),P(oi-w,H,0),[-nx*sd,0,-nz*sd],.7);
        face(P(oi-w,H,0),P(oj-w,H,1),P(oj+w,H,1),P(oi+w,H,0),[0,1,0],1);
        face(P(oi+w,H,0),P(oj+w,H,1),P(oj+w,0,1),P(oi+w,0,0),[nx*sd,0,nz*sd],.6)}}
    /* bridge deck underside and piers */
    let lastPier=-99;
    for(let i=0;i<cnt;i++){const j=(i+1)%n;if(!(r.br[i]&&r.br[j]))continue;
      const dx=r.X[j]-r.X[i],dz=r.Z[j]-r.Z[i],l=Math.hypot(dx,dz)||1,tx=dx/l,tz=dz/l,nx=-tz,nz=tx,hwi=r.hw*r.wk[i]+RSH,hwj=r.hw*r.wk[j]+RSH,mx=(r.X[i]+r.X[j])/2,mz=(r.Z[i]+r.Z[j])/2,m=pmb(mx,mz,0,12);
      const P=(o,y,t)=>[(t?r.X[j]:r.X[i])+nx*o,y+(t?r.Y[j]:r.Y[i]),(t?r.Z[j]:r.Z[i])+nz*o];const g=118;
      const f4=(p0,p1,p2,p3,n3,sh)=>{const ks=[p0,p1,p2,p3].map(p=>m.v(p[0],p[1],p[2],n3[0],n3[1],n3[2],g*sh,g*sh,g*sh*.97,.03,.03,0));m.q(ks[0],ks[1],ks[2],ks[3])};
      f4(P(-hwi,-.5,0),P(-hwi,-.5,1),P(hwi,-.5,1),P(hwi,-.5,0),[0,-.6,0],1.0);
      f4(P(-hwi,-1.6,0),P(-hwi,-.5,0),P(-hwi,-.5,1),P(-hwi,-1.6,1),[-nx,0,-nz],.8);f4(P(hwi,-.5,0),P(hwi,-1.6,0),P(hwi,-1.6,1),P(hwi,-.5,1),[nx,0,nz],.8);
      f4(P(-hwi,-1.6,0),P(-hwi,-1.6,1),P(hwi,-1.6,1),P(hwi,-1.6,0),[0,-.6,0],.9);
      if(i-lastPier>=7){lastPier=i;const gy=terrainH(r.X[i],r.Z[i]);if(r.Y[i]-gy>3){for(const o of[-hwi*.55,hwi*.55]){const px=r.X[i]+nx*o,pz=r.Z[i]+nz*o;pbox(0,px,terrainH(px,pz)-.5,pz,1.1,r.Y[i]-1.6,1.1,128,126,120,0,.8);COLC.push(px,pz,1.3,terrainH(px,pz)-.5,r.Y[i]-1.6)}}}}
    /* lamp posts */
    const step=r.city?15:(r.style==1?16:12),off=r.hw+RSH+(r.city?.8:1.4);let cnt2=0;
    for(let i=2;i<n-2;i+=step){if(r.br[i]||(r.city&&r.mk[i]<.5)||r.wk[i]<.9)continue;const j=Math.min(n-1,i+1),dx=r.X[j]-r.X[i-1],dz=r.Z[j]-r.Z[i-1],l=Math.hypot(dx,dz)||1,nx=-dz/l,nz=dx/l,sd=((cnt2++)&1)?1:-1;
      if(r.style==1&&!r.city&&(cnt2&1))continue;
      const px=r.X[i]+nx*sd*off,pz=r.Z[i]+nz*sd*off,gy=r.Y[i]-(r.city?.1:.35);pbox(0,px,gy,pz,.13,gy+7.2,.13,92,94,98,0,.7);
      pbox(0,px-nx*sd*1.1,gy+7.1,pz-nz*sd*1.1,.9*Math.abs(nx)+.1,gy+7.3,.9*Math.abs(nz)+.1,92,94,98,0,1);pbox(0,px-nx*sd*1.9,gy+6.95,pz-nz*sd*1.9,.35*Math.abs(nx)+.25,gy+7.12,.35*Math.abs(nz)+.25,255,236,180,2,1);COLC.push(px,pz,.45,gy-.5,gy+7.2);LAMPS.push(px-nx*sd*1.9,gy+6.9,pz-nz*sd*1.9)}}
}
/* ---------- districts: San Francisco style downtown + hills, Golden Gate Park, the LA style Valley, countryside ---------- */
/* rotated box (walls with window tiling + roof); collider registered by the caller */
function pboxR(cat,cx,cz,hx,hz,cs,sn,y0,y1,r,g,b,win,ao){
  const m=pmb(cx,cz,cat,24),h=y1-y0,a0=ao==null?.62:ao,Wd=(lx,lz)=>[cx+lx*cs-lz*sn,cz+lx*sn+lz*cs];
  const wall=(l0x,l0z,l1x,l1z,nlx,nlz,len)=>{const p0=Wd(l0x,l0z),p1=Wd(l1x,l1z),nx=nlx*cs-nlz*sn,nz=nlx*sn+nlz*cs,u1=len/3.2,v1=h/3.4;
    const i0=m.v(p0[0],y0,p0[1],nx,0,nz,r*a0,g*a0,b*a0,0,v1,win),i1=m.v(p1[0],y0,p1[1],nx,0,nz,r*a0,g*a0,b*a0,u1,v1,win),i2=m.v(p1[0],y1,p1[1],nx,0,nz,r,g,b,u1,0,win),i3=m.v(p0[0],y1,p0[1],nx,0,nz,r,g,b,0,0,win);m.q(i0,i1,i2,i3)};
  wall(-hx,hz,hx,hz,0,1,hx*2);wall(hx,hz,hx,-hz,1,0,hz*2);wall(hx,-hz,-hx,-hz,0,-1,hx*2);wall(-hx,-hz,-hx,hz,-1,0,hz*2);
  const rf=.82,P=(lx,lz)=>{const w=Wd(lx,lz);return m.v(w[0],y1,w[1],0,1,0,r*rf,g*rf,b*rf,.03,.03,0)},i0=P(-hx,-hz),i1=P(hx,-hz),i2=P(hx,hz),i3=P(-hx,hz);m.q(i0,i3,i2,i1)}
/* gable roof over a rotated footprint (ridge along the local x axis, or along z) */
function proofR(cat,cx,cz,hx,hz,cs,sn,y,rh,r,g,b,alongX){
  const m=pmb(cx,cz,cat,10),Wd=(lx,lz)=>[cx+lx*cs-lz*sn,cz+lx*sn+lz*cs],Q=(lx,ly,lz)=>{const w=Wd(lx,lz);return[w[0],ly,w[1]]};
  const face=(p0,p1,p2,p3,nlx,ny,nlz,sh)=>{const nx=nlx*cs-nlz*sn,nz=nlx*sn+nlz*cs,k=[p0,p1,p2,p3].map(p=>m.v(p[0],p[1],p[2],nx,ny,nz,r*sh,g*sh,b*sh,.03,.03,0));m.q(k[0],k[1],k[2],k[3])};
  if(alongX){face(Q(-hx,y,hz),Q(hx,y,hz),Q(hx,y+rh,0),Q(-hx,y+rh,0),0,.7,.7,1);face(Q(hx,y,-hz),Q(-hx,y,-hz),Q(-hx,y+rh,0),Q(hx,y+rh,0),0,.7,-.7,.85)}
  else{face(Q(hx,y,-hz),Q(hx,y,hz),Q(0,y+rh,hz),Q(0,y+rh,-hz),.7,.7,0,1);face(Q(-hx,y,hz),Q(-hx,y,-hz),Q(0,y+rh,-hz),Q(0,y+rh,hz),-.7,.7,0,.85)}}
/* pyramid tower (a nod to the Transamerica Pyramid) */
function ppyramid(cat,cx,cz,hb,y0,h,cs,sn){const m=pmb(cx,cz,cat,16),Wd=(lx,lz)=>{const w=[cx+lx*cs-lz*sn,cz+lx*sn+lz*cs];return w},cn=[[-hb,hb],[hb,hb],[hb,-hb],[-hb,-hb]],sl=hb/h;
  for(let k=0;k<4;k++){const c0=cn[k],c1=cn[(k+1)%4],mx=(c0[0]+c1[0])/2,mz=(c0[1]+c1[1])/2,l=Math.hypot(mx,mz),nlx=mx/l,nlz=mz/l,ny=sl*1.15,nn=Math.hypot(1,ny),nx=(nlx*cs-nlz*sn)/nn,nz=(nlx*sn+nlz*cs)/nn,sh=.75+.25*(k&1);
    const p0=Wd(c0[0],c0[1]),p1=Wd(c1[0],c1[1]),i0=m.v(p0[0],y0,p0[1],nx,ny/nn,nz,222*sh,224*sh,226*sh,.03,.03,0),i1=m.v(p1[0],y0,p1[1],nx,ny/nn,nz,222*sh,224*sh,226*sh,.03,.03,0),i2=m.v(cx,y0+h,cz,nx,ny/nn,nz,240*sh,242*sh,244*sh,.03,.03,0);m.t(i0,i1,i2)}}
/* flat ground patch (parking lots, lawns) */
function pflat(cat,cx,cz,hx,hz,cs,sn,y,r,g,b){const m=pmb(cx,cz,cat,4),Wd=(lx,lz)=>[cx+lx*cs-lz*sn,cz+lx*sn+lz*cs];
  const k=[[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz]].map(c=>{const w=Wd(c[0],c[1]);return m.v(w[0],y,w[1],0,1,0,r,g,b,.03,.03,0)});m.q(k[0],k[3],k[2],k[1])}
/* palm tree: tall thin trunk, drooping fronds (double sided) */
function ppalm(x,z,rng,y){const h=8.5+rng()*5,top=y+h,m=pmb(x,z,2,40);ptrunk(2,x,y-.2,z,.24,h,128,100,72);
  const n=7,rot=rng()*6;for(let k=0;k<n;k++){const a=rot+k/n*TAU,ca=Math.cos(a),sa=Math.sin(a),L=3.6+rng()*.8,mx=x+ca*L*.5,mz=z+sa*L*.5,tx=x+ca*L,tz=z+sa*L,pw=.9;
    const B=[x,top,z],Lf=[mx-sa*pw,top+.7,mz+ca*pw],Rt=[mx+sa*pw,top+.7,mz-ca*pw],T=[tx,top-1.7,tz];
    const v=(p,sh)=>m.v(p[0],p[1],p[2],0,1,0,40*sh,118*sh,42*sh,.03,.03,0),b0=v(B,.8),l0=v(Lf,1),r0=v(Rt,1),t0=v(T,.9);m.t(b0,l0,t0);m.t(b0,t0,r0);m.t(b0,t0,l0);m.t(b0,r0,t0)}}
const gmin=(cx,cz,hx,hz,cs,sn)=>{let m=terrainH(cx,cz);for(const c of[[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz]])m=Math.min(m,terrainH(cx+c[0]*cs-c[1]*sn,cz+c[0]*sn+c[1]*cs));return m};
const PASTEL=[[236,190,170],[170,200,222],[232,218,160],[204,170,204],[182,214,182],[226,150,142],[240,226,196],[160,190,204]];
const BRICK=[[168,112,92],[190,150,120],[150,120,104],[120,126,140]];
/* every block of a rotated street grid: calls fn with its local extents */
function forBlocks(g,fn){const hw=g.hw+3.8,pl=g.planes,Wd=(u,v)=>[g.ox+u*g.cs-v*g.sn,g.oz+u*g.sn+v*g.cs],sf=g.kind!='la';
  /* a town (g.box) also has blocks between its outer streets and the boulevard round it */
  const bx=g.box,ph=(g.phw||7)+3.8,us=bx?[bx.x0].concat(g.us,[bx.x1]):g.us,vs=bx?[bx.z0].concat(g.vs,[bx.z1]):g.vs,hu=(k,n)=>bx&&(k==0||k==n-1)?ph:hw;
  for(let i=0;i<us.length-1;i++)for(let j=0;j<vs.length-1;j++){const u0=us[i]+hu(i,us.length),u1=us[i+1]-hu(i+1,us.length),v0=vs[j]+hu(j,vs.length),v1=vs[j+1]-hu(j+1,vs.length);if(u1-u0<14||v1-v0<14)continue;
    let ok=true,x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
    for(const[u,v]of[[u0,v0],[u1,v0],[u1,v1],[u0,v1]]){const p=Wd(u,v);x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);z0=Math.min(z0,p[1]);z1=Math.max(z1,p[1]);
      for(let k=0;k<pl.length;k++){const m=(sf&&k==4)?MARKET.hw+12:(bx?6:18);if(pl[k][0]*p[0]+pl[k][1]*p[1]>pl[k][2]-m)ok=false}}
    if(g.cut)for(const R of g.cut)if(x1>R.x0&&x0<R.x1&&z1>R.z0&&z0<R.z1)ok=false;
    if(ok)fn({i,j,u0,u1,v0,v1,W:Wd,g})}}
const URB=[CITY,VALLEY];
const inUrban=(x,z,m)=>{if(inBox(x,z,CITY,m)||inBox(x,z,VALLEY,m)||inBox(x,z,PARK,m)||inBox(x,z,BEACH,m)||inBox(x,z,RESORT,m))return true;for(const zn of ZONES)if(inBox(x,z,zn.b,m))return true;for(const fl of FIELDS)if(inBox(x,z,fl.b,m*.3))return true;return false};
function buildCity(){
  const rng=mulberry(1337);let nb=0,pyramid=false;const CORE={x:-870,z:310};
  const reg=(cx,cz,hx,hz,cs,sn,top)=>{COLO.push(cx,cz,hx,hz,cs,sn,top)};
  const NEONC=[[255,40,120],[40,220,255],[255,190,40],[130,90,255],[60,255,150],[255,90,40]],nrng=mulberry(7771);
  /* a neon sign on a wall of a building: a glowing bar standing out of the wall; most tall downtown buildings get one or two */
  const neon=(cx,cz,hx,hz,cs,sn,gy,h)=>{const k=1+(nrng()<.4?1:0);for(let q=0;q<k;q++){const side=(nrng()*4)|0,c=NEONC[(nrng()*NEONC.length)|0],vert=nrng()<.45,y0=gy+3+nrng()*Math.max(0,Math.min(h-6,14));
      const ax=side&1?1:0,sg=side<2?1:-1;let lx,lz,hl,hd;                     /* local centre on the wall, and half sizes along it */
      const along=(nrng()-.5)*(ax?hz:hx)*1.2;if(ax){lx=sg*(hx+.25);lz=along;hl=[.25,vert?.5:Math.min(3.2,hz*.35)]}else{lz=sg*(hz+.25);lx=along;hl=[vert?.5:Math.min(3.2,hx*.35),.25]}
      const wx=cx+lx*cs-lz*sn,wz=cz+lx*sn+lz*cs,yy0=vert?y0:y0+3,yy1=vert?y0+Math.min(7,h*.4):y0+3+1.1;pboxR(1,wx,wz,hl[0],hl[1],cs,sn,yy0,yy1,c[0],c[1],c[2],2,1);
      NEONS.push(wx,(yy0+yy1)/2,wz,c[0]/255,c[1]/255,c[2]/255,vert?3.4:4.2)}};
  const bld=(cx,cz,hx,hz,cs,sn,h,c,win)=>{const gy=gmin(cx,cz,hx,hz,cs,sn);pboxR(1,cx,cz,hx,hz,cs,sn,gy-1.5,gy+h,c[0],c[1],c[2],win!==false,.62);reg(cx,cz,hx,hz,cs,sn,gy+h);nb++;if(h>=7&&win!==false&&(inBox(cx,cz,CITY,0)||inBox(cx,cz,VALLEY,0))&&nrng()<.7)neon(cx,cz,hx,hz,cs,sn,gy,h);return gy};
  const treesIn=(B,n)=>{for(let k=0;k<n;k++){const u=lerp(B.u0+4,B.u1-4,rng()),v=lerp(B.v0+4,B.v1-4,rng()),p=B.W(u,v);if(nearRoadXZ(p[0],p[1],6))continue;ptree(p[0],p[1],rng,terrainH(p[0],p[1]));COLC.push(p[0],p[1],.55,terrainH(p[0],p[1])-.5,terrainH(p[0],p[1])+12)}};
  for(const g of GRIDS){
    if(g.kind=='la'){
      forBlocks(g,B=>{const cu=(B.u0+B.u1)/2,cv=(B.v0+B.v1)/2,[cx,cz]=B.W(cu,cv),r=rng(),cs=g.cs,sn=g.sn,wu=B.u1-B.u0,wv=B.v1-B.v0;
        if(r<.36){/* strip mall + parking lot */const bd=Math.min(26,wv*.26),bw=wu*.74,by=B.v0+bd/2+8,[bx,bz]=B.W(cu,by),c=[[214,196,170],[196,200,206],[226,206,180]][(rng()*3)|0];bld(bx,bz,bw/2,bd/2,cs,sn,6+rng()*3,c,false);
          const ly=(B.v0+bd+14+B.v1-6)/2,lh=(B.v1-6-(B.v0+bd+14))/2,[lx,lz]=B.W(cu,ly);pflat(1,lx,lz,wu/2-8,lh,cs,sn,terrainH(lx,lz)+.1,52,52,56);
          for(let k=0;k<7;k++){const u=lerp(B.u0+6,B.u1-6,k/6),p=B.W(u,B.v1-5);ppalm(p[0],p[1],rng,terrainH(p[0],p[1]));COLC.push(p[0],p[1],.5,terrainH(p[0],p[1])-.5,terrainH(p[0],p[1])+12)}}
        else if(r<.84){/* a neighbourhood of small stucco houses with palms */const cols=4,rows=3,pw=wu/cols,pd=wv/rows;
          for(let a=0;a<cols;a++)for(let b=0;b<rows;b++){const u=B.u0+pw*(a+.5),v=B.v0+pd*(b+.5),[hx0,hz0]=[Math.min(7,pw*.34),Math.min(6,pd*.32)],[px,pz]=B.W(u,v),h=3.3+rng()*1.6,c=PASTEL[(rng()*PASTEL.length)|0];
            const gy=bld(px,pz,hx0,hz0,cs,sn,h,c,true);proofR(1,px,pz,hx0,hz0,cs,sn,gy+h,2+rng(),150+rng()*40,96,78,rng()<.5);
            if(rng()<.7){const p=B.W(u+hx0+3.5,v+hz0+3);ppalm(p[0],p[1],rng,terrainH(p[0],p[1]));COLC.push(p[0],p[1],.5,terrainH(p[0],p[1])-.5,terrainH(p[0],p[1])+12)}}}
        else{/* a glass mid-rise */bld(cx,cz,Math.min(20,wu*.3),Math.min(20,wv*.3),cs,sn,45+rng()*40,[112,134,156],true)}});
      /* palms along every boulevard */
      for(const r of g.roads){for(let i=3;i<r.n-3;i+=6){const a=(i+1<r.n?i+1:i),b=(i>0?i-1:i);let tx=r.X[a]-r.X[b],tz=r.Z[a]-r.Z[b];const l=Math.hypot(tx,tz)||1;tx/=l;tz/=l;if(r.mk[i]<.6)continue;
        for(const sd of[-1,1]){const px=r.X[i]-tz*sd*(r.hw+RSH+3.4),pz=r.Z[i]+tx*sd*(r.hw+RSH+3.4);ppalm(px,pz,rng,r.Y[i]-.3);COLC.push(px,pz,.5,terrainH(px,pz)-.5,terrainH(px,pz)+12)}}}
      continue}
    if(g.kind=='beach'){/* Santa Cruz: bungalows and motels, a boardwalk with a Ferris wheel, lifeguard towers, umbrellas on the sand */
      const BUN=[[238,120,110],[250,200,96],[96,184,196],[246,246,238],[210,140,190],[130,200,150],[255,170,90],[110,150,214]];
      const palm=(x,z)=>{const y=terrainH(x,z);if(y<1.5)return;ppalm(x,z,rng,y);COLC.push(x,z,.5,y-.5,y+12)};
      forBlocks(g,B=>{const cu=(B.u0+B.u1)/2,cv=(B.v0+B.v1)/2,cs=g.cs,sn=g.sn,wu=B.u1-B.u0,wv=B.v1-B.v0,r=rng();
        if(r<.22){const [px,pz]=B.W(cu,cv),hx0=wu*.42,hz0=Math.min(7,wv*.2),c=BUN[(rng()*BUN.length)|0],gy=bld(px,pz,hx0,hz0,cs,sn,4.6,c,true);
          const [sx,sz]=B.W(B.u0+5,B.v1-6);pbox(1,sx,gy,sz,.25,gy+9,.25,200,200,205,false,.7);pbox(1,sx,gy+7,sz,1.7,gy+9.2,.22,255,90,120,false,1);COLC.push(sx,sz,.4,gy-.5,gy+9);
          const [qx,qz]=B.W(cu,cv+hz0+8);palm(qx,qz)}
        else{const lw=wu/2,ld=wv/2;for(let a=0;a<2;a++)for(let b=0;b<2;b++){const u=B.u0+lw*(a+.5),v=B.v0+ld*(b+.5),[px,pz]=B.W(u,v),hx0=Math.min(8.5,lw*.36),hz0=Math.min(6.5,ld*.34),h=3.1+rng()*1.3,c=BUN[(rng()*BUN.length)|0],gy=bld(px,pz,hx0,hz0,cs,sn,h,c,true);
          proofR(1,px,pz,hx0,hz0,cs,sn,gy+h,1.8+rng()*.8,[196,90,74,120][(rng()*4)|0],110,92,rng()<.5);if(rng()<.65){const [qx,qz]=B.W(u+hx0+3,v+hz0+2.5);palm(qx,qz)}}}});
      /* boardwalk shops between the last street and the beach road, and a Ferris wheel */
      {const zS=BEACH.z1-34,uP=-350;
       for(let i=0;i<g.us.length-1;i++){const u0=g.us[i],u1=g.us[i+1],uc=(u0+u1)/2,half=(u1-u0)/2-g.hw-8;if(half<8)continue;
         if(uc>uP-45&&uc<uP+45)continue;                                           /* the pier entrance */
         if(i==g.us.length-3||(g.us.length<4&&i==1)){/* Ferris wheel */const gy=terrainH(uc,zS),cy=gy+19,R=15.5,N=20,C2=[[230,70,70],[240,200,60],[70,160,230],[90,200,120],[220,120,220]];
           for(const sd of[-1,1]){pbox(1,uc+sd*9,gy-.5,zS,.7,cy,.7,200,204,212,false,.8);COLC.push(uc+sd*9,zS,1,gy-.5,gy+19)}
           pbox(1,uc,cy-1.2,zS,1.5,cy+1.2,1.2,230,230,236,false,.9);
           for(let k=0;k<N;k++){const an=k/N*TAU,c=C2[k%5];pbox(1,uc+Math.cos(an)*R,cy+Math.sin(an)*R-1.2,zS,1.15,cy+Math.sin(an)*R+1.2,1.0,c[0],c[1],c[2],false,.9);
             if(k%2==0)for(const f of[.38,.69])pbox(1,uc+Math.cos(an)*R*f,cy+Math.sin(an)*R*f-.3,zS,.3,cy+Math.sin(an)*R*f+.3,.3,236,236,240,false,1)}
           continue}
         for(const k of[-1,1]){const px=uc+k*half*.52,hx0=half*.46,gy=bld(px,zS,hx0,7.5,1,0,4.4+rng()*1.2,BUN[(rng()*BUN.length)|0],true);
           const c=BUN[(rng()*BUN.length)|0];pboxR(1,px,zS+9,hx0,1.8,1,0,gy+3,gy+3.5,c[0],c[1],c[2],false,1)}}}
      /* lifeguard towers and beach umbrellas on the sand south of the beach road */
      for(const x of[-455,-215]){const z=BEACH.z1+34,y=terrainH(x,z);if(y<1)continue;pbox(1,x-.9,y-.4,z-.9,.2,y+2,.2,230,230,236,false,.8);pbox(1,x+.9,y-.4,z-.9,.2,y+2,.2,230,230,236,false,.8);pbox(1,x-.9,y-.4,z+.9,.2,y+2,.2,230,230,236,false,.8);pbox(1,x+.9,y-.4,z+.9,.2,y+2,.2,230,230,236,false,.8);
        pbox(1,x,y+2,z,1.5,y+4.1,1.5,240,70,60,true,.9);pbox(1,x,y+4.1,z,1.9,y+4.5,1.9,250,250,250,false,1);COLC.push(x,z,1.7,y-.5,y+4.5)}
      {const ur=mulberry(3131),UC=[[240,70,60],[250,210,70],[70,160,230],[250,250,250],[240,130,60]];for(let k=0;k<26;k++){const x=lerp(BEACH.x0+20,BEACH.x1-20,ur()),z=BEACH.z1+22+ur()*24,y=terrainH(x,z);if(y<1.2||y>8||nearRoadXZ(x,z,9))continue;const c=UC[(ur()*5)|0];pbox(1,x,y-.2,z,.07,y+2.2,.07,230,230,236,false,.8);pcone(1,x,y+1.9,z,1.7,.55,c[0],c[1],c[2],8,ur()*6)}}
      /* palms along the beach road and the pier road */
      {const bp=ROADS.find(q=>q.id=='btp');if(bp)for(let i=4;i<bp.n-4;i+=5){const a=(i+1)%bp.n,b=(i+bp.n-1)%bp.n;let tx=bp.X[a]-bp.X[b],tz=bp.Z[a]-bp.Z[b];const l=Math.hypot(tx,tz)||1;tx/=l;tz/=l;if(bp.mk[i]<.6)continue;
        for(const sd of[-1,1]){const px=bp.X[i]-tz*sd*(bp.hw+RSH+3.4),pz=bp.Z[i]+tx*sd*(bp.hw+RSH+3.4);if(nearRoadXZ(px,pz,1.5))continue;palm(px,pz)}}}
      continue}
    if(g.kind=='ps'){/* Palm Springs: mid-century hotels round big pools, a golf course, villas with pools, palm boulevards */
      const lawn=(cx,cz,hx,hz,cs,sn,c0,c1,c2,lift,t)=>{t=t||14;const nu=Math.max(1,Math.ceil(hx*2/t)),nv=Math.max(1,Math.ceil(hz*2/t)),tu=hx*2/nu,tv=hz*2/nv;
        for(let a=0;a<nu;a++)for(let b=0;b<nv;b++){const lu=-hx+tu*(a+.5),lv=-hz+tv*(b+.5),px=cx+lu*cs-lv*sn,pz=cz+lu*sn+lv*cs;let y=-1e9;
          for(const[du,dv]of[[-1,-1],[1,-1],[1,1],[-1,1],[0,0]]){const qx=px+(du*tu/2)*cs-(dv*tv/2)*sn,qz=pz+(du*tu/2)*sn+(dv*tv/2)*cs;y=Math.max(y,terrainH(qx,qz))}
          pflat(1,px,pz,tu/2+.05,tv/2+.05,cs,sn,y+lift,c0,c1,c2)}};
      const palmAt=(x,z)=>{const y=terrainH(x,z);ppalm(x,z,rng,y);COLC.push(x,z,.5,y-.5,y+12)};
      forBlocks(g,B=>{const cs=g.cs,sn=g.sn,wu=B.u1-B.u0,wv=B.v1-B.v0,cu=(B.u0+B.u1)/2,cv=(B.v0+B.v1)/2,typ=(B.i+B.j*2)%4,P=(u,v)=>B.W(u,v),pm=(u,v)=>{const p=P(u,v);palmAt(p[0],p[1])};
        if(typ==0||typ==3){/* hotel: a long main wing, a side wing, a pool deck */
          const [mx,mz]=P(cu,B.v0+20),gy=bld(mx,mz,wu*.46,10,cs,sn,10,typ==0?[238,226,200]:[244,200,190],true);pboxR(1,mx,mz,wu*.46+3,13,cs,sn,gy+10,gy+10.7,70,170,180,false,1);
          const [wx,wz]=P(B.u0+18,cv+8),gy2=bld(wx,wz,10,wv*.28,cs,sn,7.5,[236,170,170],true);pboxR(1,wx,wz,13,wv*.28+3,cs,sn,gy2+7.5,gy2+8.1,70,170,180,false,1);
          const [dx,dz]=P(cu+26,cv+24);lawn(dx,dz,34,17,cs,sn,232,226,210,.1);lawn(dx,dz,24,10,cs,sn,72,176,214,.2,12);
          for(const[u,v]of[[cu-4,cv+8],[cu+56,cv+8],[cu-4,cv+42],[cu+56,cv+42],[cu+26,cv+4],[cu+26,cv+46]])pm(u,v);
          const [lx,lz]=P(cu,B.v1-14);lawn(lx,lz,wu*.36,9,cs,sn,64,64,70,.1,16);
          const [sx,sz]=P(B.u1-10,B.v0+6),sy=terrainH(sx,sz);pbox(1,sx,sy-.5,sz,.5,sy+15,.5,236,236,240,false,.8);pbox(1,sx,sy+10,sz,3.2,sy+16,.5,250,120,150,false,1);COLC.push(sx,sz,.9,sy-.5,sy+15)}
        else if(typ==1){/* golf course with a pond and a clubhouse */
          lawn(...P(cu,cv),wu/2-3,wv/2-3,cs,sn,56,124,56,.1,16);lawn(...P(cu-10,cv-24),wu*.4,9,cs,sn,92,168,80,.2,16);lawn(...P(cu+12,cv+22),wu*.38,9,cs,sn,92,168,80,.2,16);
          const [px,pz]=P(cu+34,cv-2);lawn(px,pz,17,11,cs,sn,64,150,204,.3,12);
          const [cx0,cz0]=P(B.u0+26,B.v1-18),gy=bld(cx0,cz0,18,9,cs,sn,6.5,[236,226,210],true);proofR(1,cx0,cz0,19,10,cs,sn,gy+6.5,2.2,160,120,100,true);
          for(let k=0;k<22;k++){const u=lerp(B.u0+8,B.u1-8,rng()),v=lerp(B.v0+8,B.v1-8,rng()),p=P(u,v);if(Math.hypot(p[0]-px,p[1]-pz)<24||Math.hypot(p[0]-cx0,p[1]-cz0)<30)continue;
            const y=terrainH(p[0],p[1]);if(rng()<.55)ppalm(p[0],p[1],rng,y);else ptree(p[0],p[1],rng,y);COLC.push(p[0],p[1],.55,y-.5,y+12)}}
        else{/* villas: nine flat-roofed houses, each with a small pool */
          const lw=wu/3,ld=wv/3,HC=[[240,232,214],[226,196,170],[200,222,226],[236,214,180]];
          for(let a=0;a<3;a++)for(let b=0;b<3;b++){const u=B.u0+lw*(a+.5),v=B.v0+ld*(b+.5),[hx,hz]=P(u-4,v-6),h=3.4+rng()*.8,gy=bld(hx,hz,Math.min(13,lw*.28),Math.min(8,ld*.2),cs,sn,h,HC[(rng()*4)|0],true);
            pboxR(1,hx,hz,Math.min(13,lw*.28)+1.4,Math.min(8,ld*.2)+1.4,cs,sn,gy+h,gy+h+.45,226,226,230,false,1);
            const [wx,wz]=P(u+3,v+12);lawn(wx,wz,9,5,cs,sn,232,226,210,.1,12);lawn(wx,wz,6.5,3,cs,sn,72,176,214,.2,12);pm(u+lw*.36,v+ld*.3);if(rng()<.6)pm(u-lw*.36,v+ld*.3)}}});
      /* palms along the boulevards and the ring boulevard */
      for(const r of g.roads.concat(ROADS.filter(q=>q.id=='psp'))){for(let i=3;i<r.n-3;i+=6){const a=(i+1<r.n?i+1:(i+1)%r.n),b=(i>0?i-1:r.n-1);let tx=r.X[a]-r.X[b],tz=r.Z[a]-r.Z[b];const l=Math.hypot(tx,tz)||1;tx/=l;tz/=l;if(r.mk[i]<.6)continue;
        for(const sd of[-1,1]){const px=r.X[i]-tz*sd*(r.hw+RSH+3.4),pz=r.Z[i]+tx*sd*(r.hw+RSH+3.4);if(nearRoadXZ(px,pz,1.5))continue;palmAt(px,pz)}}}
      continue}
    if(g.kind=='town'){/* a small town: houses, a row of shops, trees, one landmark (church, water tower or lodge) */
      const TH={coast:{pal:PASTEL,rf:0},farm:{pal:[[240,238,230],[230,226,214],[196,64,56],[186,198,206],[232,220,170]],rf:0},desert:{pal:[[214,184,146],[226,200,160],[196,164,128],[232,214,180]],rf:1},pines:{pal:[[110,80,60],[130,96,70],[92,70,56],[150,112,80]],rf:2}}[g.theme]||{pal:PASTEL,rf:0};
      const SHOP=[[236,120,110],[250,200,96],[96,170,196],[240,240,232],[130,200,150],[214,150,90]];let lm=false;
      const tree=(x,z)=>{const y=terrainH(x,z);if(y<2)return;if(g.theme=='desert'||g.theme=='coast')ppalm(x,z,rng,y);else ptree(x,z,rng,y);COLC.push(x,z,.5,y-.5,y+12)};
      forBlocks(g,B=>{const cu=(B.u0+B.u1)/2,cv=(B.v0+B.v1)/2,cs=g.cs,sn=g.sn,wu=B.u1-B.u0,wv=B.v1-B.v0,r=rng();
        if(!lm&&r<.22){lm=true;const[px,pz]=B.W(cu,cv),y=terrainH(px,pz);
          if(g.theme=='desert'){for(const sx of[-3,3])for(const sz of[-3,3])pbox(1,px+sx,y-.4,pz+sz,.35,y+12,.35,150,150,156,false,.8);pbox(1,px,y+12,pz,5,y+19,5,196,196,200,false,.9);COLC.push(px,pz,4.8,y-.5,y+19)}
          else if(g.theme=='pines'){const gy=bld(px,pz,Math.min(13,wu*.3),Math.min(9,wv*.28),cs,sn,5.5,[122,90,66],true);proofR(1,px,pz,Math.min(13,wu*.3),Math.min(9,wv*.28),cs,sn,gy+5.5,7,236,238,242,true)}
          else{const gy=bld(px,pz,6,10,cs,sn,8,[236,232,222],true);proofR(1,px,pz,6,10,cs,sn,gy+8,2.6,150,92,76,false);ppyramid(1,...B.W(cu,cv-6),2.6,gy+8,9,cs,sn)}
          return}
        if(r<.6){const cols=wu>58?3:2,lw=wu/cols,ld=wv/2;for(let a=0;a<cols;a++)for(let c=0;c<2;c++){const u=B.u0+lw*(a+.5),v=B.v0+ld*(c+.5),[px,pz]=B.W(u,v),hx0=Math.min(8,lw*.36),hz0=Math.min(6.5,ld*.34),h=3.2+rng()*1.5,col=TH.pal[(rng()*TH.pal.length)|0],gy=bld(px,pz,hx0,hz0,cs,sn,h,col,true);
            if(TH.rf==0)proofR(1,px,pz,hx0,hz0,cs,sn,gy+h,1.9+rng()*.7,150,92,76,rng()<.5);else if(TH.rf==2)proofR(1,px,pz,hx0,hz0,cs,sn,gy+h,4+rng()*1.2,226,230,236,rng()<.5);else pboxR(1,px,pz,hx0+.6,hz0+.6,cs,sn,gy+h,gy+h+.4,226,214,190,false,1);
            if(rng()<.6){const p=B.W(u+hx0+3,v+hz0+2.5);tree(p[0],p[1])}}}
        else if(r<.8){const n=3,lw=wu/n;for(let a=0;a<n;a++){const u=B.u0+lw*(a+.5),[px,pz]=B.W(u,cv),hx0=lw/2-1.5,hz0=Math.min(7,wv*.22),h=4.5+rng()*2.5,col=SHOP[(rng()*SHOP.length)|0],gy=bld(px,pz,hx0,hz0,cs,sn,h,col,true);pboxR(1,px,pz,hx0+.3,hz0+.3,cs,sn,gy+h,gy+h+.5,92,96,104,false,1)}}
        else{for(let k=0;k<12;k++){const p=B.W(lerp(B.u0+4,B.u1-4,rng()),lerp(B.v0+4,B.v1-4,rng()));if(!nearRoadXZ(p[0],p[1],5))tree(p[0],p[1])}}});
      continue}
    if(g.kind=='ind'){/* industrial: warehouses, tanks with a chimney, container yards */
      const CONT=[[200,64,52],[52,110,170],[220,170,50],[70,140,90],[180,180,184]];
      forBlocks(g,B=>{const cu=(B.u0+B.u1)/2,cv=(B.v0+B.v1)/2,cs=g.cs,sn=g.sn,wu=B.u1-B.u0,wv=B.v1-B.v0,r=rng();
        if(r<.45){const hx0=Math.min(48,wu*.42),hz0=Math.min(26,wv*.38),h=8+rng()*5,[px,pz]=B.W(cu,cv),col=[[150,156,166],[176,170,160],[120,134,150],[170,150,130]][(rng()*4)|0],gy=bld(px,pz,hx0,hz0,cs,sn,h,col,false);pboxR(1,px,pz,hx0+.5,hz0+.5,cs,sn,gy+h,gy+h+.6,92,96,104,false,1)}
        else if(r<.75){for(let a=0;a<2;a++)for(let c=0;c<2;c++){const[px,pz]=B.W(B.u0+wu*(.25+.5*a),B.v0+wv*(.28+.44*c)),h=10+rng()*8;bld(px,pz,7,7,cs,sn,h,[210,212,214],false)}
          const[cx0,cz0]=B.W(cu,cv),y=terrainH(cx0,cz0);ptrunk(1,cx0,y-.4,cz0,1.6,38,150,140,130);COLC.push(cx0,cz0,1.7,y-.5,y+38)}
        else{for(let k=0;k<10;k++){const[px,pz]=B.W(B.u0+wu*(.12+.76*((k%5)/4)),B.v0+wv*(.3+.4*((k/5)|0)));bld(px,pz,6,1.3,cs,sn,2.6+(rng()<.4?2.6:0),CONT[(rng()*CONT.length)|0],false)}}});
      continue}
    /* San Francisco blocks */
    forBlocks(g,B=>{const cu=(B.u0+B.u1)/2,cv=(B.v0+B.v1)/2,[cx,cz]=B.W(cu,cv),cs=g.cs,sn=g.sn,wu=B.u1-B.u0,wv=B.v1-B.v0,dcore=Math.hypot(cx-CORE.x,cz-CORE.z),th=terrainH(cx,cz),r=rng();
      if(g.skip&&g.skip.indexOf(B.i+','+B.j)>=0){treesIn(B,5);return}                  /* the Lombard Street block */
      if(r<.07){treesIn(B,9);return}                                                    /* pocket park */
      if(dcore<340&&r<.92){/* financial district towers */
        const lots=rng()<.3?1:2,gap=2+rng()*3,tall=Math.max(0,1-dcore/340);
        for(let a=0;a<lots;a++){const lw=wu/lots,u=B.u0+lw*(a+.5),[px,pz]=B.W(u,cv),hx0=lw/2-gap/2,hz0=wv/2-gap/2,c=[[150,160,175],[176,170,158],[126,140,158],[112,122,138],[188,184,176],[96,108,126]][(rng()*6)|0],h=18+rng()*24+tall*tall*(60+rng()*130);
          if(!pyramid&&dcore<150&&a==0){pyramid=true;const gy=gmin(px,pz,hx0,hz0,cs,sn),hb=Math.min(hx0,hz0)-2;pboxR(1,px,pz,hb+4,hb+4,cs,sn,gy-1.5,gy+10,206,204,198,true,.7);ppyramid(1,px,pz,hb,gy+10,230,cs,sn);reg(px,pz,hb*.6,hb*.6,cs,sn,gy+120);nb++;continue}
          const ph=7+rng()*6,gy=bld(px,pz,hx0,hz0,cs,sn,Math.min(h,ph),[c[0]*.92,c[1]*.9,c[2]*.88]);const ins=1+rng()*4;pboxR(1,px,pz,hx0-ins,hz0-ins,cs,sn,gy+Math.min(h,ph),gy+h,c[0],c[1],c[2],true,.62);reg(px,pz,hx0-ins,hz0-ins,cs,sn,gy+h);if(nrng()<.85)neon(px,pz,hx0,hz0,cs,sn,gy,Math.min(h,ph))}}
      else if(th>22||rng()<.6){/* Victorian row houses: narrow pastel fronts side by side */
        const depth=Math.min(17,wv/2-1.5);let maxH=0;
        for(const side of[-1,1]){const v=side<0?B.v0+depth/2:B.v1-depth/2;let u=B.u0;const hs=[];
          while(u<B.u1-5){const w=Math.min(6.4+rng()*2.4,B.u1-u),c=PASTEL[(rng()*PASTEL.length)|0],h=9+rng()*4.5,pu=u+w/2,[px,pz]=B.W(pu,v),gy=gmin(px,pz,w/2,depth/2,cs,sn);
            pboxR(1,px,pz,w/2-.12,depth/2,cs,sn,gy-2.5,gy+h,c[0],c[1],c[2],true,.7);
            proofR(1,px,pz,w/2-.12,depth/2,cs,sn,gy+h,1.8+rng()*1.4,150,110,96,false);
            /* a bay window pushed out over the sidewalk */pboxR(1,...B.W(pu,v+side*(depth/2+.7)),w*.3,.75,cs,sn,gy+2.2,gy+h-1.6,Math.min(255,c[0]+14),Math.min(255,c[1]+14),Math.min(255,c[2]+14),true,.8);
            if(nrng()<.1)neon(px,pz,w/2-.12,depth/2,cs,sn,gy,h);maxH=Math.max(maxH,gy+h);u+=w}
          const [rx,rz]=B.W(cu,v);reg(rx,rz,wu/2,depth/2,cs,sn,maxH);nb++}}
      else{/* mid-rise apartments in brick and stucco */
        const lots=2,lw=wu/lots;for(let a=0;a<lots;a++){const u=B.u0+lw*(a+.5),[px,pz]=B.W(u,cv),c=rng()<.5?BRICK[(rng()*4)|0]:PASTEL[(rng()*PASTEL.length)|0];bld(px,pz,lw/2-3,wv/2-3,cs,sn,16+rng()*16,c,true)}}})}
  /* farms: barn, silo, house, shed */
  for(const f of FARMS){const cs=f.cs,sn=f.sn,Wd=(lx,lz)=>[f.x+lx*cs-lz*sn,f.z+lx*sn+lz*cs];let p=Wd(0,0);
    let gy=bld(p[0],p[1],8,6,cs,sn,6,[176,52,44],true);proofR(1,p[0],p[1],8,6,cs,sn,gy+6,3,110,56,48,true);
    p=Wd(-16,10);{const y=terrainH(p[0],p[1]);ptrunk(1,p[0],y-.4,p[1],2.4,11,200,200,204);pcone(1,p[0],y+11,p[1],2.8,2.4,170,60,52,8,0);COLC.push(p[0],p[1],2.6,y-.5,y+13)}
    p=Wd(14,14);gy=bld(p[0],p[1],5,4.2,cs,sn,4.4,[238,234,226],true);proofR(1,p[0],p[1],5,4.2,cs,sn,gy+4.4,2.2,150,90,76,true);
    p=Wd(-8,-16);bld(p[0],p[1],4,3,cs,sn,3,[160,150,140],false)}
  /* safe houses: a small garage with a tall green sign you can see from far away */
  for(const s of SAFEHOUSES){const cs=s.cs,sn=s.sn,gy=bld(s.x,s.z,8,6,cs,sn,4.2,[196,198,204],false);pboxR(1,s.x,s.z,8.6,6.6,cs,sn,gy+4.2,gy+4.8,40,200,120,false,1);
    pboxR(1,s.x+(s.side||-1)*sn*6.1,s.z-(s.side||-1)*cs*6.1,4.5,.2,cs,sn,gy,gy+3.4,60,66,76,false,1);          /* the roller door, on the side that faces the road */
    const px=s.x+cs*11,pz=s.z+sn*11,y=terrainH(px,pz);pbox(1,px,y-.4,pz,.3,y+13,.3,200,200,206,false,.8);pbox(1,px,y+10,pz,2.4,y+14,.45,60,235,130,false,1);COLC.push(px,pz,.5,y-.5,y+13)}
  /* Golden Gate Park: dense trees round a lake, kept clear of the drive */
  {const pr=mulberry(909),lk=LAKES[0];let np=0;for(let x=PARK.x0+4;x<PARK.x1-4;x+=8)for(let z=PARK.z0+4;z<PARK.z1-4;z+=8){const px=x+(pr()-.5)*7,pz=z+(pr()-.5)*7;if(Math.hypot(px-lk[0],pz-lk[1])<lk[2]+5)continue;
    const gi=Math.round((px+W.half)/W.T),gj=Math.round((pz+W.half)/W.T);if(W.D8[gj*W.N+gi]<5||pr()<.25||nearRoadXZ(px,pz,8))continue;ptree(px,pz,pr,terrainH(px,pz));COLC.push(px,pz,.55,terrainH(px,pz)-.5,terrainH(px,pz)+12);np++}}
  /* suburb: low houses on a loose grid around the city, clear of every road and of the districts */
  const sub=mulberry(77);let ns=0;
  for(const[SB,mx,mz]of[[CITY,420,380],[VALLEY,380,380],[TOWN_BAR,300,300],[TOWN_PAC,300,300],[TOWN_FRE,320,320],[TOWN_BIG,240,240]])
  for(let x=SB.x0-mx;x<SB.x1+mx;x+=34)for(let z=SB.z0-mz;z<SB.z1+mz;z+=34){
    if(inUrban(x,z,50))continue;
    const px=x+(sub()-.5)*20,pz=z+(sub()-.5)*20,gi=Math.round((px+W.half)/W.T),gj=Math.round((pz+W.half)/W.T);if(gi<2||gj<2||gi>=W.N-2||gj>=W.N-2)continue;
    const dr=W.D8[gj*W.N+gi];if(dr<9||sub()<.45||nearRoadXZ(px,pz,12))continue;const h0=terrainH(px,pz);if(h0<5||terrainSlope(px,pz)>.12)continue;
    const dcity=Math.max(SB.x0-px,px-SB.x1,SB.z0-pz,pz-SB.z1,0);if(sub()>.9-dcity*(.58/mx))continue;
    const hx=4.5+sub()*3,hz=4+sub()*3,h=3.4+sub()*2.4,wall=PASTEL[(sub()*PASTEL.length)|0];
    pbox(1,px,h0-.4,pz,hx,h0+h,hz,wall[0],wall[1],wall[2],true,.7);proof(1,px,h0+h,pz,hx,hz,2.2+sub(),120+sub()*40,70,58,hx>hz);COLR.push(px-hx,pz-hz,px+hx,pz+hz,h0+h);ns++}
  /* trees: forests and a few roadside trees */
  const tr=mulberry(4242);let nt=0;
  for(let x=-2800;x<2800;x+=19)for(let z=-2800;z<2800;z+=19){
    const px=x+(tr()-.5)*16,pz=z+(tr()-.5)*16,gi=Math.round((px+W.half)/W.T),gj=Math.round((pz+W.half)/W.T);if(gi<2||gj<2||gi>=W.N-2||gj>=W.N-2)continue;
    const h=W.hm[gj*W.N+gi],dr=W.D8[gj*W.N+gi],sl=terrainSlope(px,pz);let p=0;
    if(forestAt(px,pz,h,sl,dr))p=.66;else if(dr>13&&dr<45&&h>6&&sl<.4&&!inUrban(px,pz,60))p=.06+.2*sstep(1,2,fbm(px*.003,pz*.003,55,2)*2);
    if(h<5||tr()>p||nearRoadXZ(px,pz,9))continue;ptree(px,pz,tr,h);COLC.push(px,pz,.55,terrainH(px,pz)-.5,terrainH(px,pz)+12);nt++}
  return{buildings:nb,houses:ns,trees:nt}}
/* finalise prop meshes into plain arrays the GL side uploads */
function finishProps(){const out=[];PSET.forEach((L,k)=>{const cat=k&3;for(const m of L){if(!m.n)continue;out.push({cat,V:m.f.subarray(0,m.n*7),I:m.ix.subarray(0,m.ni),cx:(m.x0+m.x1)/2,cy:(m.y0+m.y1)/2,cz:(m.z0+m.z1)/2,rad:Math.hypot(m.x1-m.x0,m.y1-m.y0,m.z1-m.z0)/2+1})}});return out}
/* ---------- spatial hash for road queries + colliders ---------- */
const QH={cs:64,nc:0,st:null,li:null,segR:null,segI:null,cst:null,cli:null,ccs:32,cnc:0};
function buildRoadHash(){
  const cs=QH.cs,nc=QH.nc=Math.ceil(W.size/cs);let nseg=0;for(const r of ROADS)nseg+=r.closed?r.n:r.n-1;
  QH.segR=new Uint8Array(nseg);QH.segI=new Int32Array(nseg);let g=0;ROADS.forEach((r,ri)=>{const c=r.closed?r.n:r.n-1;for(let i=0;i<c;i++){QH.segR[g]=ri;QH.segI[g]=i;g++}});
  const cnt=new Int32Array(nc*nc+1);
  const each=(fn)=>{for(let s=0;s<nseg;s++){const r=ROADS[QH.segR[s]],i=QH.segI[s],j=(i+1)%r.n,pad=r.hw+RSH+2,x0=Math.min(r.X[i],r.X[j])-pad,x1=Math.max(r.X[i],r.X[j])+pad,z0=Math.min(r.Z[i],r.Z[j])-pad,z1=Math.max(r.Z[i],r.Z[j])+pad;
    const c0=Math.max(0,Math.floor((x0+W.half)/cs)),c1=Math.min(nc-1,Math.floor((x1+W.half)/cs)),d0=Math.max(0,Math.floor((z0+W.half)/cs)),d1=Math.min(nc-1,Math.floor((z1+W.half)/cs));for(let b=d0;b<=d1;b++)for(let a=c0;a<=c1;a++)fn(b*nc+a,s)}};
  each(c=>cnt[c+1]++);for(let k=0;k<nc*nc;k++)cnt[k+1]+=cnt[k];QH.st=cnt;QH.li=new Int32Array(cnt[nc*nc]);const fill=cnt.slice(0,nc*nc);each((c,s)=>{QH.li[fill[c]++]=s})}
/* is this spot on or right beside any road (any height, bridges included)? used to keep trees and houses off roads and their ramps */
function nearRoadXZ(x,z,m){const cs=QH.cs,nc=QH.nc,cx=Math.floor((x+W.half)/cs),cz=Math.floor((z+W.half)/cs);if(!QH.st||cx<0||cz<0||cx>=nc||cz>=nc)return false;const c=cz*nc+cx;
  for(let q=QH.st[c];q<QH.st[c+1];q++){const s=QH.li[q],r=ROADS[QH.segR[s]],i=QH.segI[s],j=i+1<r.n?i+1:0,ax=r.X[i],az=r.Z[i],dx=r.X[j]-ax,dz=r.Z[j]-az,l2=dx*dx+dz*dz||1;let t=((x-ax)*dx+(z-az)*dz)/l2;t=t<0?0:t>1?1:t;if(Math.hypot(x-ax-dx*t,z-az-dz*t)<r.hw*Math.min(r.wk[i],r.wk[j])+RSH+m)return true}return false}
function buildQueries(){
  if(!QH.st)buildRoadHash();const cs=QH.cs;
  /* colliders */
  const ccs=QH.ccs,cn=QH.cnc=Math.ceil(W.size/ccs),ccnt=new Int32Array(cn*cn+1),nR=COLR.length/5,nC=COLC.length/5,nO=COLO.length/7;
  const eachC=(fn)=>{for(let k=0;k<nR;k++){const x0=COLR[k*5],z0=COLR[k*5+1],x1=COLR[k*5+2],z1=COLR[k*5+3];const a0=Math.max(0,Math.floor((x0-2+W.half)/ccs)),a1=Math.min(cn-1,Math.floor((x1+2+W.half)/ccs)),b0=Math.max(0,Math.floor((z0-2+W.half)/ccs)),b1=Math.min(cn-1,Math.floor((z1+2+W.half)/ccs));for(let b=b0;b<=b1;b++)for(let a=a0;a<=a1;a++)fn(b*cn+a,k)}
    for(let k=0;k<nC;k++){const x=COLC[k*5],z=COLC[k*5+1];const a=Math.floor((x+W.half)/ccs),b=Math.floor((z+W.half)/ccs);if(a>=0&&b>=0&&a<cn&&b<cn)fn(b*cn+a,nR+k)}
    for(let k=0;k<nO;k++){const cx=COLO[k*7],cz=COLO[k*7+1],hx=COLO[k*7+2],hz=COLO[k*7+3],c=Math.abs(COLO[k*7+4]),s=Math.abs(COLO[k*7+5]),ex=hx*c+hz*s+2,ez=hx*s+hz*c+2;
      const a0=Math.max(0,Math.floor((cx-ex+W.half)/ccs)),a1=Math.min(cn-1,Math.floor((cx+ex+W.half)/ccs)),b0=Math.max(0,Math.floor((cz-ez+W.half)/ccs)),b1=Math.min(cn-1,Math.floor((cz+ez+W.half)/ccs));for(let bb=b0;bb<=b1;bb++)for(let aa=a0;aa<=a1;aa++)fn(bb*cn+aa,nR+nC+k)}};
  eachC(c=>ccnt[c+1]++);for(let k=0;k<cn*cn;k++)ccnt[k+1]+=ccnt[k];QH.cst=ccnt;QH.cli=new Int32Array(ccnt[cn*cn]);const f2=ccnt.slice(0,cn*cn);eachC((c,k)=>{QH.cli[f2[c]++]=k});QH.nR=nR;QH.nC=nC;
  QH.CR=new Float32Array(COLR);QH.CC=new Float32Array(COLC);QH.CO=new Float32Array(COLO)}
/* nearest road surface under a point, filtered by height so overpasses and the road below do not mix */
const RQ={on:0,y:0,lat:0,hw:0,tx:0,tz:0,nx:0,nz:0,rail:0,ri:0,br:0,ds:0};
function roadAt(x,z,yh){
  const cs=QH.cs,nc=QH.nc,cx=Math.floor((x+W.half)/cs),cz=Math.floor((z+W.half)/cs);if(cx<0||cz<0||cx>=nc||cz>=nc)return false;
  const c=cz*nc+cx;let found=false,bestL=1e9,bestF=1e9,fl=false;
  /* two passes of the same rule: nearest road centre-line wins. First only surfaces within 1.3 m of the car's height (its own level); only if there is
     none, anything within 4.5 m. That keeps a hairpin's upper leg or a crossing road from ever stealing the car. */
  for(let pass=0;pass<2;pass++){const tol=pass?4.5:1.3;if(pass&&found)break;
    for(let q=QH.st[c];q<QH.st[c+1];q++){const s=QH.li[q],r=ROADS[QH.segR[s]],i=QH.segI[s],j=i+1<r.n?i+1:0;
      const ax=r.X[i],az=r.Z[i],dx=r.X[j]-ax,dz=r.Z[j]-az,l2=dx*dx+dz*dz||1;let t=((x-ax)*dx+(z-az)*dz)/l2;t=t<0?0:t>1?1:t;
      const px=ax+dx*t,pz=az+dz*t,ex=x-px,ez=z-pz,d=Math.sqrt(ex*ex+ez*ez),hw=r.hw*(r.wk[i]+(r.wk[j]-r.wk[i])*t)+RSH;if(d>hw)continue;
      const yy=r.Y[i]+(r.Y[j]-r.Y[i])*t;if(Math.abs(yy-yh)>tol)continue;
      if(d<bestL){bestL=d;found=true;const l=Math.sqrt(l2),tx=dx/l,tz=dz/l;RQ.y=yy;RQ.tx=tx;RQ.tz=tz;RQ.nx=-tz;RQ.nz=tx;RQ.lat=ex*RQ.nx+ez*RQ.nz;RQ.hw=hw-RSH;RQ.rail=r.rail[i]&r.rail[j];RQ.ri=QH.segR[s];RQ.br=r.br[i];RQ.ds=r.S[i]+(r.S[j]-r.S[i])*t}}}
  return found}
/* ground height under a point (road surface if on a road at that level, else terrain) */
function groundAt(x,z,yh){const ty=terrainH(x,z);RQ.on=0;if(roadAt(x,z,yh)){const over=Math.abs(RQ.lat)-RQ.hw;let y=RQ.y-(over>0?Math.min(over,RSH)/RSH*.12:0);if(y>ty-2.2){RQ.on=1;return y}}return ty}
