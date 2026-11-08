'use strict';
/* ===== static geometry builders: road ribbons, barriers, bridges, lamps, buildings, trees. Pure data (no GL). ===== */
/* prop mesh: 28-byte vertices = pos f32x3 | normal i8x3 + window flag i8 | colour u8x4 | uv f32x2 */
class MB{constructor(){this.cap=512;this.f=new Float32Array(this.cap*7);this.u=new Uint8Array(this.f.buffer);this.s=new Int8Array(this.f.buffer);this.n=0;this.ix=new Uint16Array(this.cap*4);this.ni=0;
  this.x0=1e9;this.x1=-1e9;this.y0=1e9;this.y1=-1e9;this.z0=1e9;this.z1=-1e9}
 grow(){const c=this.cap*2,f=new Float32Array(c*7);f.set(this.f);this.f=f;this.u=new Uint8Array(f.buffer);this.s=new Int8Array(f.buffer);this.cap=c;const ix=new Uint16Array(c*4);ix.set(this.ix);this.ix=ix}
 v(x,y,z,nx,ny,nz,r,g,b,u,v,w){if(this.n>=this.cap)this.grow();const o=this.n*7,B=this.n*28;this.f[o]=x;this.f[o+1]=y;this.f[o+2]=z;this.s[B+12]=Math.round(nx*127);this.s[B+13]=Math.round(ny*127);this.s[B+14]=Math.round(nz*127);this.s[B+15]=w?127:0;
  this.u[B+16]=r;this.u[B+17]=g;this.u[B+18]=b;this.u[B+19]=255;this.f[o+5]=u;this.f[o+6]=v;
  if(x<this.x0)this.x0=x;if(x>this.x1)this.x1=x;if(y<this.y0)this.y0=y;if(y>this.y1)this.y1=y;if(z<this.z0)this.z0=z;if(z>this.z1)this.z1=z;return this.n++}
 t(a,b,c){if(this.ni+3>this.ix.length){const ix=new Uint16Array(this.ix.length*2);ix.set(this.ix);this.ix=ix}this.ix[this.ni++]=a;this.ix[this.ni++]=b;this.ix[this.ni++]=c}
 q(a,b,c,d){this.t(a,b,c);this.t(a,c,d)}}
/* a set of meshes keyed by 128 m cell + category; splits automatically before the 16-bit index limit */
const PCELL=128,PCATS=3;/* 0 street furniture, 1 buildings, 2 trees */
const PSET=new Map();
function pmb(x,z,cat,need){const k=(Math.floor((x+W.half)/PCELL)*64+Math.floor((z+W.half)/PCELL))*4+cat;let L=PSET.get(k);if(!L){L=[new MB()];PSET.set(k,L)}let m=L[L.length-1];if(m.n+need>60000){m=new MB();L.push(m)}return m}
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
function buildRoadMeshes(){
  const out=[];
  for(const r of ROADS){
    const n=r.n,rows=r.closed?n+1:n,S=r.S;
    if(r.city){/* no lane markings through intersections */for(let i=0;i<n;i++){const along=r.id.charAt(0)=='n'?(r.Z[i]-CITY.z0):(r.X[i]-CITY.x0),m=((along%CITY.bs)+CITY.bs)%CITY.bs,dc=Math.min(m,CITY.bs-m);r.mk[i]=sstep(CITY.hw+1,CITY.hw+9,dc)}}
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
const COLC=[],COLR=[];/* colliders: circles [x,z,r] and rects [x0,z0,x1,z1,top] */
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
      f4(P(-hwi,-.5,0),P(-hwi,-.5,1),P(hwi,-.5,1),P(hwi,-.5,0),[0,-1,0],.55);
      f4(P(-hwi,-1.6,0),P(-hwi,-.5,0),P(-hwi,-.5,1),P(-hwi,-1.6,1),[-nx,0,-nz],.8);f4(P(hwi,-.5,0),P(hwi,-1.6,0),P(hwi,-1.6,1),P(hwi,-.5,1),[nx,0,nz],.8);
      f4(P(-hwi,-1.6,0),P(-hwi,-1.6,1),P(hwi,-1.6,1),P(hwi,-1.6,0),[0,-1,0],.5);
      if(i-lastPier>=7){lastPier=i;const gy=terrainH(r.X[i],r.Z[i]);if(r.Y[i]-gy>3){for(const o of[-hwi*.55,hwi*.55]){const px=r.X[i]+nx*o,pz=r.Z[i]+nz*o;pbox(0,px,terrainH(px,pz)-.5,pz,1.1,r.Y[i]-1.6,1.1,128,126,120,0,.8);COLC.push(px,pz,1.3)}}}}
    /* lamp posts */
    const step=r.city?15:(r.style==1?16:12),off=r.hw+RSH+(r.city?.8:1.4);let cnt2=0;
    for(let i=2;i<n-2;i+=step){if(r.br[i]||(r.city&&r.mk[i]<.5)||r.wk[i]<.9)continue;const j=Math.min(n-1,i+1),dx=r.X[j]-r.X[i-1],dz=r.Z[j]-r.Z[i-1],l=Math.hypot(dx,dz)||1,nx=-dz/l,nz=dx/l,sd=((cnt2++)&1)?1:-1;
      if(r.style==1&&!r.city&&(cnt2&1))continue;
      const px=r.X[i]+nx*sd*off,pz=r.Z[i]+nz*sd*off,gy=r.Y[i]-(r.city?.1:.35);pbox(0,px,gy,pz,.13,gy+7.2,.13,92,94,98,0,.7);
      pbox(0,px-nx*sd*1.1,gy+7.1,pz-nz*sd*1.1,.9*Math.abs(nx)+.1,gy+7.3,.9*Math.abs(nz)+.1,92,94,98,0,1);pbox(0,px-nx*sd*1.9,gy+6.95,pz-nz*sd*1.9,.35*Math.abs(nx)+.25,gy+7.12,.35*Math.abs(nz)+.25,255,236,180,0,1);COLC.push(px,pz,.45)}}
}
/* ---------- the city and the countryside ---------- */
function buildCity(){
  const rng=mulberry(1337),cx=(CITY.x0+CITY.x1)/2,cz=(CITY.z0+CITY.z1)/2,pal=[[150,160,175],[176,170,158],[126,140,158],[168,120,98],[112,122,138],[188,184,176],[96,108,126]];
  const gy=CITY.y;let nb=0;
  const put=(x0,z0,x1,z1,h,c,win)=>{const hx=(x1-x0)/2,hz=(z1-z0)/2;pbox(1,x0+hx,gy-.3,z0+hz,hx,gy+h,hz,c[0],c[1],c[2],win!==false,.62);COLR.push(x0,z0,x1,z1,gy+h);nb++};
  for(let i=0;i<CITY.nx-1;i++)for(let j=0;j<CITY.nz-1;j++){
    const bx0=CITY.x0+i*CITY.bs+CITY.hw+3.6,bx1=CITY.x0+(i+1)*CITY.bs-CITY.hw-3.6,bz0=CITY.z0+j*CITY.bs+CITY.hw+3.6,bz1=CITY.z0+(j+1)*CITY.bs-CITY.hw-3.6;
    const mx=(bx0+bx1)/2-cx,mz=(bz0+bz1)/2-cz,dn=Math.hypot(mx/(CITY.nx*CITY.bs*.5),mz/(CITY.nz*CITY.bs*.5));
    if(rng()<.1){/*pocket park*/for(let k=0;k<7;k++){const x=lerp(bx0+8,bx1-8,rng()),z=lerp(bz0+8,bz1-8,rng());ptree(x,z,rng,gy)}continue}
    const lots=rng()<.3?1:2,gap=2+rng()*3;
    for(let a=0;a<lots;a++)for(let b=0;b<lots;b++){
      const lw=(bx1-bx0)/lots,ld=(bz1-bz0)/lots,x0=bx0+a*lw+gap/2,x1=bx0+(a+1)*lw-gap/2,z0=bz0+b*ld+gap/2,z1=bz0+(b+1)*ld-gap/2;
      const tall=Math.max(0,1-dn*.95),h=18+rng()*26+tall*tall*(40+rng()*120),c=pal[(rng()*pal.length)|0];
      if(lots==1||rng()<.5){/*tower with a wider podium*/const ph=7+rng()*6;put(x0,z0,x1,z1,Math.min(h,ph),[c[0]*.92,c[1]*.9,c[2]*.88]);const ins=(1+rng()*4);put(x0+ins,z0+ins,x1-ins,z1-ins,h,c)}else put(x0,z0,x1,z1,h,c)}}
  /* suburb: low houses and sheds on a loose grid around downtown, clear of every road */
  const sub=mulberry(77);let ns=0;
  for(let x=CITY.x0-420;x<CITY.x1+420;x+=34)for(let z=CITY.z0-380;z<CITY.z1+380;z+=34){
    if(x>CITY.x0-40&&x<CITY.x1+40&&z>CITY.z0-40&&z<CITY.z1+40)continue;
    const px=x+(sub()-.5)*20,pz=z+(sub()-.5)*20,gi=Math.round((px+W.half)/W.T),gj=Math.round((pz+W.half)/W.T);if(gi<2||gj<2||gi>=W.N-2||gj>=W.N-2)continue;
    const dr=W.D8[gj*W.N+gi];if(dr<9||sub()<.35)continue;const h0=terrainH(px,pz);if(h0<5||terrainSlope(px,pz)>.12)continue;
    const dcity=Math.max(CITY.x0-px,px-CITY.x1,CITY.z0-pz,pz-CITY.z1,0);if(sub()>.9-dcity*.0012)continue;
    const hx=4.5+sub()*3,hz=4+sub()*3,h=3.4+sub()*2.4,wall=[[206,196,176],[190,178,160],[168,172,178],[198,170,140]][(sub()*4)|0];
    pbox(1,px,h0-.4,pz,hx,h0+h,hz,wall[0],wall[1],wall[2],true,.7);proof(1,px,h0+h,pz,hx,hz,2.2+sub(),120+sub()*40,70,58,hx>hz);COLR.push(px-hx,pz-hz,px+hx,pz+hz,h0+h);ns++}
  /* trees: forests and a few roadside trees */
  const tr=mulberry(4242);let nt=0;
  for(let x=-2800;x<2800;x+=19)for(let z=-2800;z<2800;z+=19){
    const px=x+(tr()-.5)*16,pz=z+(tr()-.5)*16,gi=Math.round((px+W.half)/W.T),gj=Math.round((pz+W.half)/W.T);if(gi<2||gj<2||gi>=W.N-2||gj>=W.N-2)continue;
    const h=W.hm[gj*W.N+gi],dr=W.D8[gj*W.N+gi],sl=terrainSlope(px,pz);let p=0;
    if(forestAt(px,pz,h,sl,dr))p=.66;else if(dr>13&&dr<45&&h>6&&sl<.4&&!(px>CITY.x0-60&&px<CITY.x1+60&&pz>CITY.z0-60&&pz<CITY.z1+60))p=.06+.2*sstep(1,2,fbm(px*.003,pz*.003,55,2)*2);
    if(h<5||tr()>p)continue;ptree(px,pz,tr,h);COLC.push(px,pz,.55);nt++}
  return{buildings:nb,houses:ns,trees:nt}}
/* finalise prop meshes into plain arrays the GL side uploads */
function finishProps(){const out=[];PSET.forEach((L,k)=>{const cat=k&3;for(const m of L){if(!m.n)continue;out.push({cat,V:m.f.subarray(0,m.n*7),I:m.ix.subarray(0,m.ni),cx:(m.x0+m.x1)/2,cy:(m.y0+m.y1)/2,cz:(m.z0+m.z1)/2,rad:Math.hypot(m.x1-m.x0,m.y1-m.y0,m.z1-m.z0)/2+1})}});return out}
/* ---------- spatial hash for road queries + colliders ---------- */
const QH={cs:64,nc:0,st:null,li:null,segR:null,segI:null,cst:null,cli:null,ccs:32,cnc:0};
function buildQueries(){
  const cs=QH.cs,nc=QH.nc=Math.ceil(W.size/cs);let nseg=0;for(const r of ROADS)nseg+=r.closed?r.n:r.n-1;
  QH.segR=new Uint8Array(nseg);QH.segI=new Int32Array(nseg);let g=0;ROADS.forEach((r,ri)=>{const c=r.closed?r.n:r.n-1;for(let i=0;i<c;i++){QH.segR[g]=ri;QH.segI[g]=i;g++}});
  const cnt=new Int32Array(nc*nc+1);
  const each=(fn)=>{for(let s=0;s<nseg;s++){const r=ROADS[QH.segR[s]],i=QH.segI[s],j=(i+1)%r.n,pad=r.hw+RSH+2,x0=Math.min(r.X[i],r.X[j])-pad,x1=Math.max(r.X[i],r.X[j])+pad,z0=Math.min(r.Z[i],r.Z[j])-pad,z1=Math.max(r.Z[i],r.Z[j])+pad;
    const c0=Math.max(0,Math.floor((x0+W.half)/cs)),c1=Math.min(nc-1,Math.floor((x1+W.half)/cs)),d0=Math.max(0,Math.floor((z0+W.half)/cs)),d1=Math.min(nc-1,Math.floor((z1+W.half)/cs));for(let b=d0;b<=d1;b++)for(let a=c0;a<=c1;a++)fn(b*nc+a,s)}};
  each(c=>cnt[c+1]++);for(let k=0;k<nc*nc;k++)cnt[k+1]+=cnt[k];QH.st=cnt;QH.li=new Int32Array(cnt[nc*nc]);const fill=cnt.slice(0,nc*nc);each((c,s)=>{QH.li[fill[c]++]=s});
  /* colliders */
  const ccs=QH.ccs,cn=QH.cnc=Math.ceil(W.size/ccs),ccnt=new Int32Array(cn*cn+1),nR=COLR.length/5,nC=COLC.length/3;
  const eachC=(fn)=>{for(let k=0;k<nR;k++){const x0=COLR[k*5],z0=COLR[k*5+1],x1=COLR[k*5+2],z1=COLR[k*5+3];const a0=Math.max(0,Math.floor((x0-2+W.half)/ccs)),a1=Math.min(cn-1,Math.floor((x1+2+W.half)/ccs)),b0=Math.max(0,Math.floor((z0-2+W.half)/ccs)),b1=Math.min(cn-1,Math.floor((z1+2+W.half)/ccs));for(let b=b0;b<=b1;b++)for(let a=a0;a<=a1;a++)fn(b*cn+a,k)}
    for(let k=0;k<nC;k++){const x=COLC[k*3],z=COLC[k*3+1];const a=Math.floor((x+W.half)/ccs),b=Math.floor((z+W.half)/ccs);if(a>=0&&b>=0&&a<cn&&b<cn)fn(b*cn+a,nR+k)}};
  eachC(c=>ccnt[c+1]++);for(let k=0;k<cn*cn;k++)ccnt[k+1]+=ccnt[k];QH.cst=ccnt;QH.cli=new Int32Array(ccnt[cn*cn]);const f2=ccnt.slice(0,cn*cn);eachC((c,k)=>{QH.cli[f2[c]++]=k});QH.nR=nR;
  QH.CR=new Float32Array(COLR);QH.CC=new Float32Array(COLC)}
/* nearest road surface under a point, filtered by height so overpasses and the road below do not mix */
const RQ={on:0,y:0,lat:0,hw:0,tx:0,tz:0,nx:0,nz:0,rail:0,ri:0,br:0,ds:0};
function roadAt(x,z,yh){
  const cs=QH.cs,nc=QH.nc,cx=Math.floor((x+W.half)/cs),cz=Math.floor((z+W.half)/cs);if(cx<0||cz<0||cx>=nc||cz>=nc)return false;
  const c=cz*nc+cx;let best=1e9,found=false;
  for(let q=QH.st[c];q<QH.st[c+1];q++){const s=QH.li[q],r=ROADS[QH.segR[s]],i=QH.segI[s],j=i+1<r.n?i+1:0;
    const ax=r.X[i],az=r.Z[i],dx=r.X[j]-ax,dz=r.Z[j]-az,l2=dx*dx+dz*dz||1;let t=((x-ax)*dx+(z-az)*dz)/l2;t=t<0?0:t>1?1:t;
    const px=ax+dx*t,pz=az+dz*t,ex=x-px,ez=z-pz,d=Math.sqrt(ex*ex+ez*ez),hw=r.hw*(r.wk[i]+(r.wk[j]-r.wk[i])*t)+RSH;if(d>hw)continue;
    const yy=r.Y[i]+(r.Y[j]-r.Y[i])*t;if(Math.abs(yy-yh)>4.5)continue;
    const score=Math.abs(yy-yh)+d*.05;if(score<best){best=score;found=true;const l=Math.sqrt(l2),tx=dx/l,tz=dz/l;RQ.y=yy;RQ.tx=tx;RQ.tz=tz;RQ.nx=-tz;RQ.nz=tx;RQ.lat=ex*RQ.nx+ez*RQ.nz;RQ.hw=hw-RSH;RQ.rail=r.rail[i]&r.rail[j];RQ.ri=QH.segR[s];RQ.br=r.br[i];RQ.ds=r.S[i]+(r.S[j]-r.S[i])*t}}
  return found}
/* ground height under a point (road surface if on a road at that level, else terrain) */
function groundAt(x,z,yh){const ty=terrainH(x,z);RQ.on=0;if(roadAt(x,z,yh)){const over=Math.abs(RQ.lat)-RQ.hw;let y=RQ.y-(over>0?Math.min(over,RSH)/RSH*.12:0);if(y>ty-.6){RQ.on=1;return y}}return ty}
