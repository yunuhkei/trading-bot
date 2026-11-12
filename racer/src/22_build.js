'use strict';
/* ===== static geometry builders: road ribbons, barriers, bridges, lamps, buildings, trees. Pure data (no GL). ===== */
/* prop mesh: 28-byte vertices = pos f32x3 | normal i8x3 + window flag i8 | colour u8x4 | uv f32x2 */
class MB{constructor(){this.cap=512;this.f=new Float32Array(this.cap*7);this.u=new Uint8Array(this.f.buffer);this.s=new Int8Array(this.f.buffer);this.n=0;this.ix=new Uint16Array(this.cap*4);this.ni=0;
  this.x0=1e9;this.x1=-1e9;this.y0=1e9;this.y1=-1e9;this.z0=1e9;this.z1=-1e9}
 grow(){const c=this.cap*2,f=new Float32Array(c*7);f.set(this.f);this.f=f;this.u=new Uint8Array(f.buffer);this.s=new Int8Array(f.buffer);this.cap=c;const ix=new Uint16Array(c*4);ix.set(this.ix);this.ix=ix}
 v(x,y,z,nx,ny,nz,r,g,b,u,v,w,al){if(this.n>=this.cap)this.grow();if(PROP_TAG){u=PROP_TAG;v=0}const o=this.n*7,B=this.n*28;this.f[o]=x;this.f[o+1]=y;this.f[o+2]=z;this.s[B+12]=Math.round(nx*127);this.s[B+13]=Math.round(ny*127);this.s[B+14]=Math.round(nz*127);this.s[B+15]=w===2?-127:(w===3?64:(w?127:0));
  this.u[B+16]=r;this.u[B+17]=g;this.u[B+18]=b;this.u[B+19]=al==null?255:al;this.f[o+5]=u;this.f[o+6]=v;
  if(x<this.x0)this.x0=x;if(x>this.x1)this.x1=x;if(y<this.y0)this.y0=y;if(y>this.y1)this.y1=y;if(z<this.z0)this.z0=z;if(z>this.z1)this.z1=z;return this.n++}
 t(a,b,c){if(this.ni+3>this.ix.length){const ix=new Uint16Array(this.ix.length*2);ix.set(this.ix);this.ix=ix}this.ix[this.ni++]=a;this.ix[this.ni++]=b;this.ix[this.ni++]=c}
 q(a,b,c,d){this.t(a,b,c);this.t(a,c,d)}}
/* a set of meshes keyed by 128 m cell + category; splits automatically before the 16-bit index limit */
const PCELL=128,PCATS=3;/* 0 street furniture, 1 buildings, 2 trees */
const PSET=new Map();
/* buildings are merged per 256 m cell (a quarter of the draw calls of 128 m cells: draw calls, not triangles, are what the new cities cost), furniture and trees per 128 m */
const PCELLS=[PCELL,PCELL*2,PCELL];
function pmb(x,z,cat,need){const pc=PCELLS[cat],k=(Math.floor((x+W.half)/pc)*128+Math.floor((z+W.half)/pc))*4+cat;let L=PSET.get(k);if(!L){L=[new MB()];PSET.set(k,L)}let m=L[L.length-1];if(m.n+need>60000){m=new MB();L.push(m)}return m}
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
/* ---- foliage: leaf cards and needle cones that sample the leaf atlas (makeFoliageTex in 30_render.js; tile 0 broadleaf cluster, 1 fir needles, 2 bush, 3 grass tuft) ---- */
const FTILE=(t,lu,lv)=>[((t&1)+.04+lu*.92)*.5,((t>>1)+.04+lv*.92)*.5];
/* a card (a quad, drawn from both sides) in a crown: its normal is the direction away from the crown's middle, so a crown shades like a ball and not like a pile of flat cards. ctr/rad: the crown; sway: how much it moves in the wind */
function pcard(cat,x,y,z,yaw,tilt,w,h,tile,r,g,b,ctr,rad,sway){
  const m=pmb(x,z,cat,4),cy=Math.cos(yaw),sy=Math.sin(yaw),ct=Math.cos(tilt),st=Math.sin(tilt),ids=[];
  for(const[sx,sv]of[[-1,0],[1,0],[1,1],[-1,1]]){const lx=sx*w/2,ly=(sv-.5)*h;const px=lx*cy,pz=lx*sy,py=ly*ct,qx=-st*ly*sy*0+0;
    /* tilt about the card's own horizontal axis: moves the top towards or away from the middle */const dxz=-ly*st;const wx=x+px+dxz*sy,wy=y+py,wz=z+pz-dxz*cy;
    let nx=wx-ctr[0],ny=(wy-ctr[1])*.8+rad*.25,nz=wz-ctr[2];const nl=Math.hypot(nx,ny,nz)||1;nx/=nl;ny/=nl;nz/=nl;
    const k=.5+.5*Math.max(0,Math.min(1,((wy-ctr[1])/rad+.8)/1.6)),uv=FTILE(tile,sx<0?0:1,sv);
    ids.push(m.v(wx,wy,wz,nx,ny,nz,Math.min(255,r*k),Math.min(255,g*k),Math.min(255,b*k),uv[0],uv[1],3,sway));void qx}
  m.q(ids[0],ids[1],ids[2],ids[3]);m.q(ids[0],ids[3],ids[2],ids[1])}
/* a crown of n cards in an ellipsoid (rx, ry, rz) centred at (cx, cy, cz); cw the card width; positions come from a small hash generator of the place, so the stream of the world generator is untouched */
function pcrown(cat,cx,cy,cz,rx,ry,rz,n,cw,seed,r,g,b,tile,sway){
  const rg=mulberry(((seed*977)|0)^0x5bd1e995),ctr=[cx,cy,cz],rad=Math.max(rx,ry,rz);
  for(let i=0;i<n;i++){const u=rg(),v=rg()*2-1,a=rg()*TAU,rr=Math.pow(rg(),.45)*(.55+.45*u)+.25,sq=Math.sqrt(Math.max(0,1-v*v));
    const px=cx+Math.cos(a)*sq*rx*rr,py=cy+v*ry*rr*.95,pz=cz+Math.sin(a)*sq*rz*rr,j=.88+rg()*.28,sz=cw*(.8+rg()*.5);
    pcard(cat,px,py,pz,rg()*Math.PI,(rg()-.5)*1.1,sz,sz*(.85+rg()*.3),tile,r*j,g*j*(.94+rg()*.12),b*j,ctr,rad,sway==null?200:sway)}}
/* a fir tier: a star-shaped cone (points alternate long and short, so the edge is ragged like drooping branches) with the needle texture; apex vertices per facet so the pattern stays whole */
function pstar(cat,cx,y0,cz,rad,h,r,g,b,n,rot){
  const m=pmb(cx,cz,cat,n*2+2),ring=[],ap=[];
  for(let i=0;i<=n;i++){const a=rot+(i%n)/n*TAU,c=Math.cos(a),s=Math.sin(a),rr=((i%n)%2?.72:1)*rad,sl=rr/h,nl=1/Math.hypot(1,sl),uv=FTILE(1,i/n,0);
    ring.push(m.v(cx+c*rr,y0,cz+s*rr,c*nl,sl*nl,s*nl,r*.6,g*.6,b*.6,uv[0],uv[1],3,60))}
  for(let i=0;i<n;i++){const a=rot+(i+.5)/n*TAU,c=Math.cos(a),s=Math.sin(a),sl=rad/h,nl=1/Math.hypot(1,sl),uv=FTILE(1,(i+.5)/n,1);ap.push(m.v(cx,y0+h,cz,c*nl,sl*nl,s*nl,r,g,b,uv[0],uv[1],3,0))}
  for(let i=0;i<n;i++){m.t(ring[i],ap[i],ring[i+1]);m.t(ring[i],ring[i+1],ap[i])}}
/* the greens of the broadleaf trees: a few desaturated shades and the odd autumn one, so no two stands look the same */
const TGREEN=[[52,100,46],[62,112,50],[44,88,52],[78,116,48],[66,98,42],[40,82,58],[86,112,56]],TFALL=[[176,128,44],[190,100,46],[156,90,52]];
function ptree(x,z,rng,y,hero){const t=rng(),sc=.8+rng()*.7,rot=rng()*6,hh=Math.sin(x*12.9898+z*78.233)*43758.5453,cl=hh-Math.floor(hh),h2=Math.sin(x*39.346+z*11.135)*24634.6345,pk=h2-Math.floor(h2),seed=(x*13.7+z*7.1)|0;
  if(y>110||t<.55){
    if(hero){const h=11*sc,g=[26+cl*16,66+cl*24,38+cl*14];ptrunk(2,x,y-.2,z,.3,2.8*sc,70,52,36);                                          /* a fir: three ragged tiers */
      pstar(2,x,y+1.5*sc,z,3*sc,h*.5,g[0]*.9,g[1]*.9,g[2]*.9,12,rot);pstar(2,x,y+h*.32,z,2.35*sc,h*.46,g[0],g[1],g[2],12,rot+.3);pstar(2,x,y+h*.56,z,1.6*sc,h*.46,g[0]*1.12,g[1]*1.12,g[2]*1.1,10,rot+.6)}
    else{const h=9*sc,rd=2.6*sc;ptrunk(2,x,y-.2,z,.28,2.2*sc,70,52,36);pstar(2,x,y+1.4*sc,z,rd,h*.62,26,70,38,8,rot);pstar(2,x,y+h*.45,z,rd*.68,h*.55,32,82,44,8,rot+.4)}}
  else{const q1=rng(),q2=rng(),c=pk<.07?TFALL[(cl*3)|0]:TGREEN[(cl*7)|0];
    if(hero&&pk>.8){ptrunk(2,x,y-.2,z,.2,3*sc,72,60,46);pcrown(2,x,y+1.4*sc+3.4*sc,z,1.5*sc,3.9*sc,1.5*sc,9,2.2*sc,seed,c[0]*.9,c[1]*.95,c[2]*.9,0)}       /* a poplar: a tall narrow column */
    else if(hero){ptrunk(2,x,y-.2,z,.27,4.4*sc,72,54,38);const a=rot*1.7;                                                                            /* an oak: trunk, two boughs, a crown of leaf cards */
      pbar(2,x,y+2.6*sc,z,x+Math.cos(a)*1.8*sc,y+4.6*sc,z+Math.sin(a)*1.8*sc,.16,66,50,36);pbar(2,x,y+3*sc,z,x-Math.cos(a)*1.4*sc,y+4.8*sc,z-Math.sin(a)*1.4*sc,.14,66,50,36);
      pcrown(2,x,y+5.2*sc,z,3.6*sc,2.9*sc,3.6*sc,12,3.1*sc,seed,c[0],c[1],c[2],0)}
    else{ptrunk(2,x,y-.2,z,.3,3*sc,72,54,38);pcrown(2,x,y+4.6*sc,z,3.3*sc,2.7*sc,3.3*sc,5,3.7*sc,seed,48+q2*26,86+q1*44,40,0)}}}
/* a tuft of tall grass: two crossed cards of the blade tile, darker at the root, swaying in the wind */
function ptuft(x,y,z,yaw,w,h,r,g,b){const m=pmb(x,z,2,8);for(let k=0;k<2;k++){const a=yaw+k*1.5708,ca=Math.cos(a),sa=Math.sin(a),ids=[];
    for(const[sx,sv]of[[-1,0],[1,0],[1,1],[-1,1]]){const uv=FTILE(3,sx<0?0:1,sv),sh=sv?1:.5;ids.push(m.v(x+ca*sx*w/2,y+sv*h,z+sa*sx*w/2,-sa*.45,.89,ca*.45,Math.min(255,r*sh),Math.min(255,g*sh),Math.min(255,b*sh),uv[0],uv[1],3,sv?255:0))}
    m.q(ids[0],ids[1],ids[2],ids[3]);m.q(ids[0],ids[3],ids[2],ids[1])}}
/* a bush: five leaf cards in a heap; a rock or boulder: a low squashed blob that sits on the ground */
function pbush(x,z,y,rx,ry,r,g,b,rot){pcrown(2,x,y+ry*.55,z,rx*1.05,ry*.7,rx*1.05,5,rx*1.5,((x*7.3+z*3.1)|0),r,g,b,2,150)}
function prock(x,z,y,rx,ry,r,g,b,rot){pblob(2,x,y-.4*ry,z,rx,ry,r,g,b,rot)}
/* a bar of square section between two points (wires, rails, cactus arms, turbine parts); drawn from both sides so it never disappears */
function pbar(cat,x0,y0,z0,x1,y1,z1,w,r,g,b){const m=pmb((x0+x1)/2,(z0+z1)/2,cat,8);let dx=x1-x0,dy=y1-y0,dz=z1-z0;const l=Math.hypot(dx,dy,dz)||1;dx/=l;dy/=l;dz/=l;
  let ux=-dz,uz=dx;const ul=Math.hypot(ux,uz);if(ul<1e-4){ux=1;uz=0}else{ux/=ul;uz/=ul}
  const vx=dy*uz,vy=dz*ux-dx*uz,vz=-dy*ux,k=[];
  for(const p of[[x0,y0,z0],[x1,y1,z1]])for(const q of[[1,1],[-1,1],[-1,-1],[1,-1]]){const nx=ux*q[0]+vx*q[1],ny=vy*q[1],nz=uz*q[0]+vz*q[1],nl=Math.hypot(nx,ny,nz)||1;k.push(m.v(p[0]+nx*w/2,p[1]+ny*w/2,p[2]+nz*w/2,nx/nl,ny/nl,nz/nl,r,g,b,.03,.03,0))}
  for(let i=0;i<4;i++){const j=(i+1)&3;m.q(k[i],k[j],k[4+j],k[4+i]);m.q(k[i],k[4+i],k[4+j],k[j])}}
/* a smooth tapered column (turbine towers, silos) */
function pfrus(cat,cx,y0,cz,r0,r1,h,r,g,b,seg){const m=pmb(cx,cz,cat,seg*2+2),a=[],sl=(r0-r1)/h,nl=1/Math.hypot(1,sl);
  for(let i=0;i<seg;i++){const an=i/seg*TAU,c=Math.cos(an),s=Math.sin(an);a.push(m.v(cx+c*r0,y0,cz+s*r0,c*nl,sl*nl,s*nl,r*.75,g*.75,b*.75,.03,.03,0),m.v(cx+c*r1,y0+h,cz+s*r1,c*nl,sl*nl,s*nl,r,g,b,.03,.03,0))}
  for(let i=0;i<seg;i++){const j=(i+1)%seg;m.t(a[i*2],a[j*2],a[j*2+1]);m.t(a[i*2],a[j*2+1],a[i*2+1])}}
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
/* is this spot on ANOTHER road's asphalt (at about the same height)? m widens that road */
function otherAsphalt(x,z,self,y,m){const cs=QH.cs,nc=QH.nc,cx=Math.floor((x+W.half)/cs),cz=Math.floor((z+W.half)/cs);if(!QH.st||cx<0||cz<0||cx>=nc||cz>=nc)return false;const c=cz*nc+cx;
  for(let q=QH.st[c];q<QH.st[c+1];q++){const s=QH.li[q],r=ROADS[QH.segR[s]];if(r===self)continue;const i=QH.segI[s],j=i+1<r.n?i+1:0,ax=r.X[i],az=r.Z[i],dx=r.X[j]-ax,dz=r.Z[j]-az,l2=dx*dx+dz*dz||1;let t=((x-ax)*dx+(z-az)*dz)/l2;t=t<0?0:t>1?1:t;
    if(Math.hypot(x-ax-dx*t,z-az-dz*t)<r.hw*(r.wk[i]+(r.wk[j]-r.wk[i])*t)+m&&Math.abs(r.Y[i]+(r.Y[j]-r.Y[i])*t-y)<3)return true}return false}
/* SIDEWALKS: a city street has a raised sidewalk behind a curb on each side, except where another road's asphalt crosses it (a junction mouth). For each side the stations where it starts and stops
   are found exactly (bisection between samples) and kept in r.swB[side] (sorted); r.sw0[side] says whether it is there at station 0. side 0 = the -n side, 1 = the +n side (n = (-tz,tx)). */
function buildSidewalks(){
  for(const r of ROADS){r.swB=null;if(!r.sw)continue;const n=r.n,cnt=r.closed?n:n-1;r.swB=[[],[]];r.sw0=[1,1];
    for(let si=0;si<2;si++){const sd=si?1:-1;
      const cut=(i,t)=>{const j=(i+1)%n,dx=r.X[j]-r.X[i],dz=r.Z[j]-r.Z[i],l=Math.hypot(dx,dz)||1,x=r.X[i]+dx*t,z=r.Z[i]+dz*t,y=r.Y[i]+(r.Y[j]-r.Y[i])*t,nx=-dz/l*sd,nz=dx/l*sd;
        for(const o of[r.hw+.35,r.hw+r.sw*.5,r.hw+r.sw-.3])if(otherAsphalt(x+nx*o,z+nz*o,r,y,.3))return 1;return 0};
      const c=new Uint8Array(n+1);for(let i=0;i<n;i++)c[i]=i<cnt?cut(i,0):cut(n-2,1);c[n]=r.closed?c[0]:c[n-1];r.sw0[si]=c[0]?0:1;
      for(let i=0;i<cnt;i++){const j=r.closed?(i+1)%n:i+1;if(c[i]==c[j])continue;let lo=0,hi=1;for(let k=0;k<7;k++){const m=(lo+hi)/2;if(cut(i,m)==c[i])lo=m;else hi=m}
        r.swB[si].push(r.S[i]+(lo+hi)/2*Math.hypot(r.X[j]-r.X[i],r.Z[j]-r.Z[i]))}}}}
/* is there a sidewalk on that side of the road at station s? */
function swOn(r,si,s){const B=r.swB[si];let k=r.sw0[si];for(let q=0;q<B.length&&B[q]<s;q++)k^=1;return k}
function buildRoadMeshes(){
  _cj=null;const out=[];buildSidewalks();
  for(const r of ROADS){
    const n=r.n,rows=r.closed?n+1:n,S=r.S,sw=r.sw,NR=sw?8:6;
    if(r.city){const ix=cityJunctions();for(let i=0;i<n;i++){let m=1;for(let q=0;q<ix.length;q+=2){const d=Math.hypot(r.X[i]-ix[q],r.Z[i]-ix[q+1]);if(d<r.hw+10){const v=sstep(r.hw+1,r.hw+9,d);if(v<m)m=v}}r.mk[i]=m}}
    /* the junction box of every road end that sits on another road: no lane lines, no median, on the branch and on the road it joins */
    for(const J of JUNC){if(J.city||(J.r!==r&&J.par!==r))continue;for(let i=0;i<n;i++){const d=Math.hypot(r.X[i]-J.x,r.Z[i]-J.z);if(d<J.rad+9){const v=sstep(J.rad,J.rad+8,d);if(v<r.mk[i])r.mk[i]=v}}}
    /* the rows of the ribbon: one per sample, and two more (before / after) wherever a sidewalk starts or stops, so its end is a clean vertical face at the edge of the crossing road */
    const RW=[];let sL=sw?r.sw0[0]:0,sR=sw?r.sw0[1]:0;
    for(let gi=0;gi<rows;gi++){RW.push(gi,0,sL,sR);if(!sw||gi==rows-1)continue;const i=gi%n,j=(i+1)%n,s0=S[i],sl=Math.hypot(r.X[j]-r.X[i],r.Z[j]-r.Z[i])||1,ev=[];
      for(let si=0;si<2;si++)for(const b of r.swB[si])if(b>=s0&&b<s0+sl)ev.push([(b-s0)/sl,si]);ev.sort((a,b)=>a[0]-b[0]);
      for(const[t,si]of ev){const tt=Math.min(.999,Math.max(.001,t));RW.push(gi,tt,sL,sR);if(si)sR^=1;else sL^=1;RW.push(gi,tt,sL,sR)}}
    const nrw=RW.length/4;
    /* pieces of ROAD_PIECE samples (not rows: the extra rows of the sidewalk ends must not add draw calls) */
    for(let p0=0;p0<nrw-1;){let p1=p0+1;const g0=RW[p0*4];while(p1<nrw-1&&!(RW[p1*4]>=g0+ROAD_PIECE&&RW[p1*4+1]==0))p1++;
      const cnt=p1-p0+1,V=new Float32Array(cnt*NR*7),I=[];let bx0=1e9,bx1=-1e9,by0=1e9,by1=-1e9,bz0=1e9,bz1=-1e9;
      for(let k=0;k<cnt;k++){const gi=RW[(p0+k)*4],ft=RW[(p0+k)*4+1],oL=RW[(p0+k)*4+2],oR=RW[(p0+k)*4+3],i=gi%n,i2=(i+1)%n;
        const tan=q=>{const a=r.closed?(q+1)%n:Math.min(n-1,q+1),b=r.closed?(q+n-1)%n:Math.max(0,q-1);let tx=r.X[a]-r.X[b],tz=r.Z[a]-r.Z[b];const tl=Math.hypot(tx,tz)||1;return[tx/tl,tz/tl]};
        let[tx,tz]=tan(i),cx=r.X[i],cz=r.Z[i],y=r.Y[i],hw=r.hw*r.wk[i],mk=r.mk[i],cf=r.cf[i],sv=(gi==n?r.len:S[i]);
        if(ft>0){const t2=tan(i2);tx+=(t2[0]-tx)*ft;tz+=(t2[1]-tz)*ft;const tl=Math.hypot(tx,tz)||1;tx/=tl;tz/=tl;cx+=(r.X[i2]-cx)*ft;cz+=(r.Z[i2]-cz)*ft;y+=(r.Y[i2]-y)*ft;hw+=(r.hw*r.wk[i2]-hw)*ft;mk+=(r.mk[i2]-mk)*ft;cf+=(r.cf[i2]-cf)*ft;sv+=Math.hypot(r.X[i2]-r.X[i],r.Z[i2]-r.Z[i])*ft}
        const nx=-tz,nz=tx,fl=r.lanes*16+r.style+.1+.8*mk;let L,DY,A;
        if(sw){const hL=oL?CURB_H:-.03,hR=oR?CURB_H:-.03,eL=oL?CURB_H:-.14,eR=oR?CURB_H:-.14;
          L=[-(hw+sw+.4),-(hw+sw),-(hw+.04),-hw,hw,hw+.04,hw+sw,hw+sw+.4];DY=[-.5,eL,hL,0,0,hR,eR,-.5];A=[-(hw+sw),-(hw+sw),-(hw+.2),-hw,hw,hw+.2,hw+sw,hw+sw]}
        else{L=[-(hw+RSH+.5),-(hw+RSH),-hw,hw,hw+RSH,hw+RSH+.5];DY=[-.5,-.12,0,0,-.12,-.5];A=[-(hw+RSH),-(hw+RSH),-hw,hw,hw+RSH,hw+RSH]}
        for(let c=0;c<NR;c++){const o=(k*NR+c)*7,lt=L[c],x=cx+nx*lt,z=cz+nz*lt,yy=y+DY[c]+lt*cf;V[o]=x;V[o+1]=yy;V[o+2]=z;V[o+3]=A[c];V[o+4]=sv;V[o+5]=hw;V[o+6]=fl;
          if(x<bx0)bx0=x;if(x>bx1)bx1=x;if(yy<by0)by0=yy;if(yy>by1)by1=yy;if(z<bz0)bz0=z;if(z>bz1)bz1=z}}
      for(let k=0;k<cnt-1;k++)for(let c=0;c<NR-1;c++){const a=k*NR+c,b=a+1,cc=a+NR,d=cc+1;I.push(a,cc,b,b,cc,d)}
      /* the far version of the piece (used beyond R.roadLod): every second sample, no sidewalk-end rows, and three strips across (the sidewalk a ramp, the shoulder a slope): about a third of the triangles */
      const n1=I.length,COL=sw?[1,3,4,6]:[0,2,3,5];let kp=0;
      for(let k=1;k<cnt;k++){const g=RW[(p0+k)*4],ft=RW[(p0+k)*4+1];if(k<cnt-1&&(ft>0||((g-g0)&1)))continue;
        for(let c=0;c<3;c++){const a=kp*NR+COL[c],b=kp*NR+COL[c+1],cc=k*NR+COL[c],d=k*NR+COL[c+1];I.push(a,cc,b,b,cc,d)}kp=k}
      out.push({V,I:new Uint16Array(I),n1,cx:(bx0+bx1)/2,cy:(by0+by1)/2,cz:(bz0+bz1)/2,rad:Math.hypot(bx1-bx0,by1-by0,bz1-bz0)/2+2});p0=p1}}
  return out}
/* ---------- barriers, bridge decks + piers, lamp posts ---------- */
const COLC=[],COLR=[],COLO=[];
/* lights that glow: street lamp heads (x,y,z) and neon signs (x,y,z,r,g,b,size); the renderer draws a glow for the ones near the car and lights the wet road with them */
const LAMPS=[],NEONS=[],LPOST=[],LPOSTC=[];let PROP_TAG=0;   /* batch 6: street lamp posts that can be knocked down: LPOST[lamp] = [x, z, base y, circle], LPOSTC[circle] = lamp; the post's vertices carry 10000 + lamp in u (PROP_TAG while it is built) */
/* colliders: circles [x,z,r], rects [x0,z0,x1,z1,top], rotated rects [cx,z,hx,hz,cos,sin,top] */
function buildFurniture(){
  if(typeof sigProps==='function')BOOT.sigHeads=sigProps();if(typeof trStopProps==='function')BOOT.busStops=trStopProps();
  const cc=[170,166,158];
  for(const r of ROADS){const n=r.n,cnt=r.closed?n:n-1;
    for(let i=0;i<cnt;i++){const j=(i+1)%n;const a=r.rail[i]&r.rail[j];if(!a&&!(r.br[i]&&r.br[j]))continue;
      const dx=r.X[j]-r.X[i],dz=r.Z[j]-r.Z[i],l=Math.hypot(dx,dz)||1,tx=dx/l,tz=dz/l,nx=-tz,nz=tx,hwi=r.hw*r.wk[i],hwj=r.hw*r.wk[j],mx=(r.X[i]+r.X[j])/2,mz=(r.Z[i]+r.Z[j])/2;
      for(const sd of[-1,1]){if(!((a>>(sd<0?0:1))&1))continue;
        const m=pmb(mx,mz,0,20),oi=hwi+RAIL_IN+.1,oj=hwj+RAIL_IN+.1,w=.1,H=.78,yi=r.Y[i]+.42,yj=r.Y[j]+.42,cc=[196,200,206];   /* the beam: 0.36 m tall, its top 0.78 m above the road, on posts every sample (4 m) */
        const P=(o,y,t)=>[(t?r.X[j]:r.X[i])+nx*sd*o,y+(t?yj:yi),(t?r.Z[j]:r.Z[i])+nz*sd*o];
        const face=(p0,p1,p2,p3,n3,sh)=>{const k0=m.v(p0[0],p0[1],p0[2],n3[0],n3[1],n3[2],cc[0]*sh,cc[1]*sh,cc[2]*sh,.03,.03,0),k1=m.v(p1[0],p1[1],p1[2],n3[0],n3[1],n3[2],cc[0]*sh,cc[1]*sh,cc[2]*sh,.03,.03,0),k2=m.v(p2[0],p2[1],p2[2],n3[0],n3[1],n3[2],cc[0]*sh,cc[1]*sh,cc[2]*sh,.03,.03,0),k3=m.v(p3[0],p3[1],p3[2],n3[0],n3[1],n3[2],cc[0]*sh,cc[1]*sh,cc[2]*sh,.03,.03,0);m.q(k0,k1,k2,k3)};
        /* inner face (towards the road), top, outer face */
        const hb=H-.42;face(P(oi-w,0,0),P(oj-w,0,1),P(oj-w,hb*.5,1),P(oi-w,hb*.5,0),[-nx*sd,-.3,-nz*sd],.95);face(P(oi-w,hb*.5,0),P(oj-w,hb*.5,1),P(oj-w,hb,1),P(oi-w,hb,0),[-nx*sd,.35,-nz*sd],1.12);   /* the W profile: two faces that catch the light differently */
        face(P(oi-w,hb,0),P(oj-w,hb,1),P(oj+w,hb,1),P(oi+w,hb,0),[0,1,0],.9);face(P(oi+w,hb,0),P(oj+w,hb,1),P(oj+w,0,1),P(oi+w,0,0),[nx*sd,0,nz*sd],.6);
        {const px=r.X[i]+nx*sd*(oi+w+.08),pz=r.Z[i]+nz*sd*(oi+w+.08);pbox(0,px,r.Y[i]-.4,pz,.07,r.Y[i]+.72,.07,120,122,126,false,.8)}}}
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
    const step=r.city?15:(r.style==1?16:12),off=r.hw+(r.sw?.75:RSH+(r.city?.8:1.4));let cnt2=0;
    for(let i=2;i<n-2;i+=step){if(r.br[i]||r.mk[i]<.5||r.wk[i]<.9)continue;const j=Math.min(n-1,i+1),dx=r.X[j]-r.X[i-1],dz=r.Z[j]-r.Z[i-1],l=Math.hypot(dx,dz)||1,nx=-dz/l,nz=dx/l,sd=((cnt2++)&1)?1:-1;
      if(r.style==1&&!r.city&&(cnt2&1))continue;
      const px=r.X[i]+nx*sd*off,pz=r.Z[i]+nz*sd*off,gy=r.Y[i]-(r.city?.1:.35);if(nearRepair(px,pz,6))continue;if(roadAt(px,pz,gy+.6)&&Math.abs(RQ.lat)<RQ.hw+.25)continue;   /* never a lamp post on asphalt: on a hairpin street the post of one leg stood in the lane of the next (the road bot got stuck on Lombard) */
      const lid=LAMPS.length/3;PROP_TAG=10000+lid;pbox(0,px,gy,pz,.13,gy+7.2,.13,92,94,98,0,.7);
      pbox(0,px-nx*sd*1.1,gy+7.1,pz-nz*sd*1.1,.9*Math.abs(nx)+.1,gy+7.3,.9*Math.abs(nz)+.1,92,94,98,0,1);pbox(0,px-nx*sd*1.9,gy+6.95,pz-nz*sd*1.9,.35*Math.abs(nx)+.25,gy+7.12,.35*Math.abs(nz)+.25,255,236,180,2,1);PROP_TAG=0;LPOST[lid]=[px,pz,gy,COLC.length/5];LPOSTC[COLC.length/5]=lid;COLC.push(px,pz,.45,gy-.5,gy+7.2);LAMPS.push(px-nx*sd*1.9,gy+6.9,pz-nz*sd*1.9)}}
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
function ppyramid(cat,cx,cz,hb,y0,h,cs,sn,col){const pc=col||[222,224,226];const m=pmb(cx,cz,cat,16),Wd=(lx,lz)=>{const w=[cx+lx*cs-lz*sn,cz+lx*sn+lz*cs];return w},cn=[[-hb,hb],[hb,hb],[hb,-hb],[-hb,-hb]],sl=hb/h;
  for(let k=0;k<4;k++){const c0=cn[k],c1=cn[(k+1)%4],mx=(c0[0]+c1[0])/2,mz=(c0[1]+c1[1])/2,l=Math.hypot(mx,mz),nlx=mx/l,nlz=mz/l,ny=sl*1.15,nn=Math.hypot(1,ny),nx=(nlx*cs-nlz*sn)/nn,nz=(nlx*sn+nlz*cs)/nn,sh=.75+.25*(k&1);
    const p0=Wd(c0[0],c0[1]),p1=Wd(c1[0],c1[1]),i0=m.v(p0[0],y0,p0[1],nx,ny/nn,nz,pc[0]*sh,pc[1]*sh,pc[2]*sh,.03,.03,0),i1=m.v(p1[0],y0,p1[1],nx,ny/nn,nz,pc[0]*sh,pc[1]*sh,pc[2]*sh,.03,.03,0),i2=m.v(cx,y0+h,cz,nx,ny/nn,nz,Math.min(255,pc[0]*1.08)*sh,Math.min(255,pc[1]*1.08)*sh,Math.min(255,pc[2]*1.08)*sh,.03,.03,0);m.t(i0,i1,i2)}}
/* flat ground patch (parking lots, lawns) */
function pflat(cat,cx,cz,hx,hz,cs,sn,y,r,g,b){const m=pmb(cx,cz,cat,4),Wd=(lx,lz)=>[cx+lx*cs-lz*sn,cz+lx*sn+lz*cs];
  const k=[[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz]].map(c=>{const w=Wd(c[0],c[1]);return m.v(w[0],y,w[1],0,1,0,r,g,b,.03,.03,0)});m.q(k[0],k[3],k[2],k[1])}
/* palm tree: a tall trunk and fronds that arch over and droop, each a cut-out strip of the grass-blade tile (the blades run along the frond like leaflets), drawn from both sides */
function ppalm(x,z,rng,y){const h=8.5+rng()*5,top=y+h,m=pmb(x,z,2,60);ptrunk(2,x,y-.2,z,.24,h,128,100,72);
  const n=7,rot=rng()*6;for(let k=0;k<n;k++){const a=rot+k/n*TAU,ca=Math.cos(a),sa=Math.sin(a),L=3.6+rng()*.8,pa=-sa,pb=ca;
    const P=[[0,0,.12],[.55,.45,1.0],[.5*L,.75,1.55],[.82*L,-.2,1.1],[L,-1.7,.18]],ids=[];
    for(let i=0;i<P.length;i++){const d=P[i][0],yy=top+P[i][1],hw=P[i][2]*.5*(k%2?1:1.1),nx=ca*.35,nz=sa*.35,nl=Math.hypot(nx,.9,nz),sh=.62+.38*i/(P.length-1),u0=FTILE(3,0,i/(P.length-1)),u1=FTILE(3,1,i/(P.length-1));
      ids.push([m.v(x+ca*d+pa*hw,yy,z+sa*d+pb*hw,nx/nl,.9/nl,nz/nl,92*sh,150*sh,66*sh,u0[0],u0[1],3,230),m.v(x+ca*d-pa*hw,yy,z+sa*d-pb*hw,nx/nl,.9/nl,nz/nl,92*sh,150*sh,66*sh,u1[0],u1[1],3,230)])}
    for(let i=0;i<P.length-1;i++){const A=ids[i],B=ids[i+1];m.q(A[0],A[1],B[1],B[0]);m.q(A[0],B[0],B[1],A[1])}}}
const gmin=(cx,cz,hx,hz,cs,sn)=>{let m=terrainH(cx,cz);for(const c of[[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz]])m=Math.min(m,terrainH(cx+c[0]*cs-c[1]*sn,cz+c[0]*sn+c[1]*cs));return m};
const PASTEL=[[236,190,170],[170,200,222],[232,218,160],[204,170,204],[182,214,182],[226,150,142],[240,226,196],[160,190,204]];
const BRICK=[[168,112,92],[190,150,120],[150,120,104],[120,126,140]];
/* every block of a rotated street grid: calls fn with its local extents */
function forBlocks(g,fn){const hw=g.hw+3.8,pl=g.planes,Wd=(u,v)=>[g.ox+u*g.cs-v*g.sn,g.oz+u*g.sn+v*g.cs],sf=g.kind!='la';
  /* a town (g.box) also has blocks between its outer streets and the boulevard round it */
  const bx=g.box,ph=(g.phw||7)+3.8,us=bx?[bx.x0].concat(g.us,[bx.x1]):g.us,vs=bx?[bx.z0].concat(g.vs,[bx.z1]):g.vs,hv=(k,n)=>bx&&(k==0||k==n-1)?ph:hw,hu=(k,n)=>{const w=g.uw&&g.uw[bx?k-1:k];return w?w.hw+3.8:hv(k,n)};
  for(let i=0;i<us.length-1;i++)for(let j=0;j<vs.length-1;j++){const u0=us[i]+hu(i,us.length),u1=us[i+1]-hu(i+1,us.length),v0=vs[j]+hv(j,vs.length),v1=vs[j+1]-hv(j+1,vs.length);if(u1-u0<14||v1-v0<14)continue;
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
  const roofRng=mulberry(31337);
  const bld=(cx,cz,hx,hz,cs,sn,h,c,win)=>{const gy=gmin(cx,cz,hx,hz,cs,sn);pboxR(1,cx,cz,hx,hz,cs,sn,gy-1.5,gy+h,c[0],c[1],c[2],win!==false,.62);reg(cx,cz,hx,hz,cs,sn,gy+h);nb++;
    /* air-conditioning boxes, a stair head and a tank on the roof of the taller buildings */
    if(h>=9&&win!==false&&hx>2.5&&hz>2.5){const k=1+((roofRng()*3)|0);for(let q=0;q<k;q++){const lx=(roofRng()-.5)*hx*1.3,lz=(roofRng()-.5)*hz*1.3,wx=cx+lx*cs-lz*sn,wz=cz+lx*sn+lz*cs,s1=Math.min(hx*.4,.8+roofRng()*1.4),s2=Math.min(hz*.4,.7+roofRng()*1.2),hh=.8+roofRng()*1.8;pboxR(1,wx,wz,s1,s2,cs,sn,gy+h,gy+h+hh,150+roofRng()*20,152+roofRng()*16,156,false,.8)}}
    if(h>=7&&win!==false&&(inBox(cx,cz,CITY,0)||inBox(cx,cz,VALLEY,0))&&nrng()<.7)neon(cx,cz,hx,hz,cs,sn,gy,h);return gy};
  const treesIn=(B,n)=>{for(let k=0;k<n;k++){const u=lerp(B.u0+4,B.u1-4,rng()),v=lerp(B.v0+4,B.v1-4,rng()),p=B.W(u,v);if(nearRoadXZ(p[0],p[1],6))continue;ptree(p[0],p[1],rng,terrainH(p[0],p[1]),true);COLC.push(p[0],p[1],.55,terrainH(p[0],p[1])-.5,terrainH(p[0],p[1])+12)}};
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
            const y=terrainH(p[0],p[1]);if(rng()<.55)ppalm(p[0],p[1],rng,y);else ptree(p[0],p[1],rng,y,true);COLC.push(p[0],p[1],.55,y-.5,y+12)}}
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
      const tree=(x,z)=>{const y=terrainH(x,z);if(y<2)return;if(g.theme=='desert'||g.theme=='coast')ppalm(x,z,rng,y);else ptree(x,z,rng,y,true);COLC.push(x,z,.5,y-.5,y+12)};
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
    if(g.kind=='vegas'){/* Las Vegas: hotel towers in gold, black glass and pink over wide podiums, a black pyramid with a beam of light, a needle tower, low casinos with lit marquees, neon everywhere, palms */
      const vr=mulberry(7007),HOT=[[214,172,64],[34,38,50],[236,124,164],[58,168,190],[238,232,218],[152,44,56],[96,66,156],[226,150,50]],cs=g.cs,sn=g.sn;let pyr=false,ndl=false;
      const glow=(x,y,z,c,sz)=>NEONS.push(x,y,z,c[0]/255,c[1]/255,c[2]/255,sz),palmV=(x,z)=>{const y=terrainH(x,z);if(y<2||nearRoadXZ(x,z,.5))return;ppalm(x,z,vr,y);COLC.push(x,z,.5,y-.5,y+12)};
      /* a sign pylon by the street: a post and a lit panel */
      const pylon=(x,z,h,c)=>{const y=terrainH(x,z);pbox(1,x,y-.4,z,.45,y+h,.45,70,72,80,false,.8);pboxR(1,x,z,2.6,.35,cs,sn,y+h*.55,y+h,c[0],c[1],c[2],2,1);pboxR(1,x,z,2.9,.25,cs,sn,y+h,y+h+.5,250,240,200,2,1);COLC.push(x,z,.7,y-.5,y+h);glow(x,y+h*.78,z,c,5)};
      forBlocks(g,B=>{const cu=(B.u0+B.u1)/2,cv=(B.v0+B.v1)/2,wu=B.u1-B.u0,wv=B.v1-B.v0,[cx,cz]=B.W(cu,cv),r=vr(),c=HOT[(vr()*HOT.length)|0],c2=NEONC[(vr()*NEONC.length)|0];
        if(!pyr&&B.i==1&&B.j==2){pyr=true;const hb=Math.min(wu,wv)*.4,gy=gmin(cx,cz,hb,hb,cs,sn);pboxR(1,cx,cz,hb+3,hb+3,cs,sn,gy-1.5,gy+1.2,60,58,56,false,.8);ppyramid(1,cx,cz,hb,gy+1.2,hb*1.3,cs,sn,[30,32,42]);reg(cx,cz,hb*.7,hb*.7,cs,sn,gy+hb);nb++;
          pbox(1,cx,gy+hb*1.3,cz,.5,gy+hb*1.3+70,.5,255,250,225,2,1);glow(cx,gy+hb*1.3+2,cz,[255,250,220],9);const[sx,sz]=B.W(B.u0+5,B.v1-5);pylon(sx,sz,13,[250,200,60]);return}
        if(!ndl&&B.i==4&&B.j==1){ndl=true;const y=terrainH(cx,cz);pfrus(1,cx,y-.5,cz,3.4,1.5,104,214,214,220,8);pfrus(1,cx,y+100,cz,2,9.5,3,226,226,232,10);pfrus(1,cx,y+103,cz,9.5,8,3.2,90,170,220,10);pfrus(1,cx,y+106.2,cz,8,1,5,226,226,232,10);
          pbox(1,cx,y+111,cz,.3,y+132,.3,255,90,90,2,1);COLC.push(cx,cz,3.6,y-.5,y+100);glow(cx,y+105,cz,[90,190,255],10);glow(cx,y+131,cz,[255,60,60],5);
          for(const[du,dv]of[[-.3,-.3],[.3,.3]]){const[px,pz]=B.W(cu+wu*du,cv+wv*dv);bld(px,pz,wu*.16,wv*.16,cs,sn,7,HOT[(vr()*HOT.length)|0],true)}return}
        if(r<.55){/* a hotel: a slab tower on a podium, a lit crown, a pylon sign */
          const h=42+vr()*48,hx=wu*.36,hz=Math.min(11,wv*.2),[tx,tz]=B.W(cu,B.v0+hz+6),gy=bld(tx,tz,hx,hz,cs,sn,h,c,true);pboxR(1,tx,tz,hx+.4,hz+.4,cs,sn,gy+h,gy+h+1.6,c2[0],c2[1],c2[2],2,1);glow(tx,gy+h+1,tz,c2,8);
          if(vr()<.6){const[wx,wz]=B.W(cu+(vr()<.5?-1:1)*(hx-hz),cv+2);bld(wx,wz,hz,wv*.22,cs,sn,h*.8,c,true)}
          const[px,pz]=B.W(cu,cv+wv*.2);bld(px,pz,wu*.44,wv*.22,cs,sn,8,[c[0]*.8+40,c[1]*.8+40,c[2]*.8+40],false);pboxR(1,px,pz,wu*.44+.3,wv*.22+.3,cs,sn,gy+8,gy+8.5,c[0]*.5+30,c[1]*.5+30,c[2]*.5+30,false,1);for(const sd of[-1,1]){const[mx,mz]=B.W(cu,cv+wv*.2+sd*(wv*.22+.35));pboxR(1,mx,mz,wu*.4,.3,cs,sn,gy+6.3,gy+7.6,c2[0],c2[1],c2[2],2,1)}
          const[sx,sz]=B.W(B.u0+5,B.v1-5);pylon(sx,sz,11+vr()*6,c2);for(let k=0;k<4;k++){const[qx,qz]=B.W(lerp(B.u0+12,B.u1-6,k/3),B.v1-4);palmV(qx,qz)}}
        else if(r<.82){/* a low casino under a big marquee */
          const gy=bld(cx,cz,wu*.42,wv*.34,cs,sn,10+vr()*4,[c[0]*.6+70,c[1]*.6+70,c[2]*.6+70],false);for(const sd of[-1,1]){const[mx,mz]=B.W(cu,cv+sd*(wv*.34+.5));pboxR(1,mx,mz,wu*.3,.5,cs,sn,gy+5,gy+9,c2[0],c2[1],c2[2],2,1);glow(mx,gy+7,mz,c2,7)}
          const[dx,dz]=B.W(cu+wu*.2,cv);pfrus(1,dx,gy+10,dz,Math.min(wu,wv)*.16,2,7,c[0],c[1],c[2],10);for(let k=0;k<3;k++){const[qx,qz]=B.W(lerp(B.u0+8,B.u1-8,k/2),B.v0+4);palmV(qx,qz)}}
        else{/* a parking lot with palms and a small white chapel with a spire */
          pflat(1,cx,cz,wu/2-4,wv/2-4,cs,sn,terrainH(cx,cz)+.12,48,48,54);const[px,pz]=B.W(B.u0+14,B.v0+12),gy=bld(px,pz,6,4.5,cs,sn,4.5,[244,244,240],true);proofR(1,px,pz,6,4.5,cs,sn,gy+4.5,2.4,200,70,90,true);ppyramid(1,px,pz,1.3,gy+6,7,cs,sn,[244,244,240]);
          glow(px,gy+5,pz,[255,120,180],4);for(let k=0;k<5;k++){const[qx,qz]=B.W(lerp(B.u0+8,B.u1-8,k/4),B.v1-5);palmV(qx,qz)}}});
      /* palms down both sides of the Strip */
      for(const r of g.roads){if(r.hw<11)continue;for(let i=4;i<r.n-4;i+=5){if(r.mk[i]<.6)continue;const t=_tan(r,i);for(const sd of[-1,1])palmV(r.X[i]-t[1]*sd*(r.hw+SWW+2.2),r.Z[i]+t[0]*sd*(r.hw+SWW+2.2))}}
      continue}
    if(g.kind=='cap'){/* Sacramento: red and brown brick blocks with stone cornices and shop awnings, a white capitol with a gold dome and columns in a park, brick row houses, oaks */
      const sr2=mulberry(4004),cs=g.cs,sn=g.sn,BR=[[150,74,58],[168,96,70],[132,70,60],[176,122,92],[120,84,70],[158,110,96]],AW=[[40,110,70],[150,40,44],[36,70,130],[220,180,60]];let capd=false;
      const oak=(x,z)=>{const y=terrainH(x,z);if(y<2||nearRoadXZ(x,z,1))return;let c0=0;const fr=()=>c0++==0?.8:sr2();ptree(x,z,fr,y,true);COLC.push(x,z,.5,y-.5,y+10)};
      forBlocks(g,B=>{const cu=(B.u0+B.u1)/2,cv=(B.v0+B.v1)/2,wu=B.u1-B.u0,wv=B.v1-B.v0,[cx,cz]=B.W(cu,cv),r=sr2();
        if(!capd&&B.i==2&&B.j==2){capd=true;/* the capitol */const y=terrainH(cx,cz);pflat(1,cx,cz,wu/2-2,wv/2-2,cs,sn,y+.1,60,118,58);
          const gy=bld(cx,cz,wu*.3,wv*.17,cs,sn,13,[236,232,220],true);pboxR(1,cx,cz,wu*.3+.6,wv*.17+.6,cs,sn,gy+13,gy+14,226,222,210,false,1);
          for(const sd of[-1,1]){const[wx,wz]=B.W(cu+sd*wu*.3,cv);bld(wx,wz,wu*.08,wv*.22,cs,sn,10,[232,228,216],true)}
          pfrus(1,cx,gy+14,cz,7.4,7.4,7,232,228,216,14);pblob(1,cx,gy+19.5,cz,7.6,7.2,214,178,70,0);ptrunk(1,cx,gy+28,cz,.9,3.4,236,232,220);pcone(1,cx,gy+31.4,cz,1.1,2.2,214,178,70,8,0);
          for(let k=0;k<8;k++){const[px,pz]=B.W(cu+(k-3.5)*wu*.05,cv+wv*.17+1.6);ptrunk(1,px,gy-.3,pz,.5,10.5,238,236,228)}{const[px,pz]=B.W(cu,cv+wv*.17+1.6);pboxR(1,px,pz,wu*.2,1.3,cs,sn,gy+10.2,gy+12.6,236,232,220,false,.9);reg(px,pz,wu*.2,1.2,cs,sn,gy+12)}
          for(let k=0;k<14;k++){const a=k/14*TAU,[px,pz]=B.W(cu+Math.cos(a)*wu*.42,cv+Math.sin(a)*wv*.4);oak(px,pz)}return}
        if(r<.14){/* a square: lawn, oaks, a bandstand */const y=terrainH(cx,cz);pflat(1,cx,cz,wu/2-3,wv/2-3,cs,sn,y+.1,58,112,56);pfrus(1,cx,y,cz,3.4,3.4,.7,200,196,188,8);for(let k=0;k<6;k++){const a=k/6*TAU;ptrunk(1,cx+Math.cos(a)*3,y+.7,cz+Math.sin(a)*3,.12,2.8,236,236,232)}pcone(1,cx,y+3.5,cz,3.9,1.6,150,60,52,8,0);COLC.push(cx,cz,3.4,y-.5,y+4);
          for(let k=0;k<10;k++){const[px,pz]=B.W(lerp(B.u0+5,B.u1-5,sr2()),lerp(B.v0+5,B.v1-5,sr2()));if(Math.hypot(px-cx,pz-cz)>7)oak(px,pz)}return}
        if(r<.72){/* brick blocks: two or three lots, a stone cornice, awnings over the shops */
          const lots=wu>70?3:2,lw=wu/lots;for(let a=0;a<lots;a++){const u=B.u0+lw*(a+.5),[px,pz]=B.W(u,cv),c=BR[(sr2()*BR.length)|0],h=12+((sr2()*4)|0)*3.4,hx=lw/2-1.2,hz=wv/2-2,gy=bld(px,pz,hx,hz,cs,sn,h,c,true);
            pboxR(1,px,pz,hx+.45,hz+.45,cs,sn,gy+h,gy+h+.8,214,206,190,false,1);const aw=AW[(sr2()*AW.length)|0];for(const sd of[-1,1]){const[ax,az]=B.W(u,cv+sd*(hz+.7));pboxR(1,ax,az,hx*.8,.7,cs,sn,gy+3.1,gy+3.5,aw[0],aw[1],aw[2],false,1)}}}
        else{/* brick row houses with gables */
          const depth=Math.min(13,wv/2-2);for(const side of[-1,1]){const v=side<0?B.v0+depth/2+1:B.v1-depth/2-1;let u=B.u0+1;while(u<B.u1-6){const w=Math.min(7+sr2()*2.5,B.u1-u-1),c=BR[(sr2()*BR.length)|0],h=7.5+sr2()*2.5,[px,pz]=B.W(u+w/2,v),gy=gmin(px,pz,w/2,depth/2,cs,sn);
              pboxR(1,px,pz,w/2-.1,depth/2,cs,sn,gy-2,gy+h,c[0],c[1],c[2],true,.7);proofR(1,px,pz,w/2-.1,depth/2,cs,sn,gy+h,2.6,86,82,84,false);u+=w}
            const[rx,rz]=B.W(cu,v);reg(rx,rz,wu/2-1,depth/2,cs,sn,terrainH(rx,rz)+11);nb++}
          for(let k=0;k<3;k++){const[px,pz]=B.W(lerp(B.u0+8,B.u1-8,k/2),cv);oak(px,pz)}}});
      continue}
    if(g.kind=='tech'){/* San Jose: a ring-shaped headquarters in a park, low glass and white campuses on lawns, car parks under solar roofs, windowless data halls, white apartment blocks */
      const tq=mulberry(9009),cs=g.cs,sn=g.sn,GL=[[120,168,196],[136,184,176],[108,150,190],[150,176,200]];let ringd=false;
      const sap=(x,z)=>{const y=terrainH(x,z);if(y<2||nearRoadXZ(x,z,1))return;ptrunk(2,x,y-.2,z,.12,2.4,96,80,62);pcrown(2,x,y+3.6,z,1.5,1.6,1.5,5,2,((x*5.1+z*3.3)|0),70,128,58,0);COLC.push(x,z,.35,y-.5,y+5)};
      const solar=(px,pz,hx,hz)=>{const y=terrainH(px,pz);pflat(1,px,pz,hx,hz,cs,sn,y+.12,52,54,60);for(const k of[-1,1]){const lz=k*hz*.5,wx=px-lz*sn,wz=pz+lz*cs;pboxR(1,wx,wz,hx-1,2.6,cs,sn,y+3.1,y+3.3,26,44,96,false,1);for(const q of[-1,1]){const ex=wx+q*(hx-2)*cs,ez=wz+q*(hx-2)*sn;pbox(1,ex,y,ez,.14,y+3.1,.14,180,182,188,false,.8);COLC.push(ex,ez,.25,y-.5,y+3.1)}}};
      forBlocks(g,B=>{const cu=(B.u0+B.u1)/2,cv=(B.v0+B.v1)/2,wu=B.u1-B.u0,wv=B.v1-B.v0,[cx,cz]=B.W(cu,cv),r=tq(),c=GL[(tq()*GL.length)|0];
        if(!ringd&&B.i==2&&B.j==1){ringd=true;/* the ring */const y=terrainH(cx,cz),Rr=Math.min(wu,wv)*.4,N=18,sw=Rr*TAU/N*.56;pflat(1,cx,cz,wu/2-2,wv/2-2,cs,sn,y+.1,70,132,62);
          for(let k=0;k<N;k++){const a=k/N*TAU,px=cx+Math.cos(a)*Rr,pz=cz+Math.sin(a)*Rr,c2=Math.cos(a+Math.PI/2),s2=Math.sin(a+Math.PI/2),gy=gmin(px,pz,sw,5,c2,s2);pboxR(1,px,pz,sw,5,c2,s2,gy-1,gy+13,150,196,214,true,.72);pboxR(1,px,pz,sw+.2,5.5,c2,s2,gy+13,gy+13.7,240,240,244,false,1);reg(px,pz,sw,5,c2,s2,gy+13.7);nb++}
          for(let k=0;k<9;k++){const a=k/9*TAU+.3;sap(cx+Math.cos(a)*Rr*.5,cz+Math.sin(a)*Rr*.5)}return}
        if(r<.5){/* a campus: two low glass buildings with white bands, a lawn, a car park under solar roofs */
          const y=terrainH(cx,cz);pflat(1,cx,cz,wu/2-2,wv/2-2,cs,sn,y+.1,74,134,64);
          for(const k of[-1,1]){const[px,pz]=B.W(cu+k*wu*.24,B.v0+wv*.3),hx=wu*.2,hz=wv*.2,h=9+((tq()*3)|0)*3.5,gy=bld(px,pz,hx,hz,cs,sn,h,c,true);for(let q=3.5;q<h;q+=3.5)pboxR(1,px,pz,hx+.25,hz+.25,cs,sn,gy+q-.35,gy+q,238,240,244,false,1);pboxR(1,px,pz,hx+.25,hz+.25,cs,sn,gy+h,gy+h+.5,238,240,244,false,1)}
          {const[px,pz]=B.W(cu,B.v1-wv*.2);solar(px,pz,wu*.4,wv*.14)}for(let k=0;k<5;k++){const[px,pz]=B.W(lerp(B.u0+6,B.u1-6,k/4),cv+2);sap(px,pz)}}
        else if(r<.72){/* a data hall: a big white windowless box with cooling units on the roof and a fence of vents */
          const hx=wu*.4,hz=wv*.34,gy=bld(cx,cz,hx,hz,cs,sn,11,[232,234,238],false);pboxR(1,cx,cz,hx+.3,hz+.3,cs,sn,gy+4,gy+4.5,40,120,200,false,1);
          for(let k=0;k<6;k++){const lx=(k%3-1)*hx*.55,lz=((k/3|0)-.5)*hz*.9,wx=cx+lx*cs-lz*sn,wz=cz+lx*sn+lz*cs;pboxR(1,wx,wz,3,2,cs,sn,gy+11,gy+12.6,160,166,174,false,.85)}}
        else{/* white apartment blocks with balconies */
          for(const k of[-1,1]){const[px,pz]=B.W(cu+k*wu*.25,cv),hx=wu*.17,hz=wv*.36,h=15+tq()*5,gy=bld(px,pz,hx,hz,cs,sn,h,[236,236,232],true);for(let q=3.2;q<h-1;q+=3.2)for(const sd of[-1,1]){const lx=sd*(hx+.5),wx=px+lx*cs,wz=pz+lx*sn;pboxR(1,wx,wz,.5,hz*.9,cs,sn,gy+q,gy+q+.25,150,156,164,false,1)}}
          for(let k=0;k<4;k++){const[px,pz]=B.W(cu,lerp(B.v0+6,B.v1-6,k/3));sap(px,pz)}}});
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
  /* drive-through repair shops (batch 7): two long walls and a roof over a bay you drive straight through, a blue and white striped front, a big glowing white cross on a blue sign, a dark floor */
  for(const p of REPAIRS){const cs=p.cs,sn=p.sn,nx=-sn,nz=cs,hl=p.L/2,hw=p.W/2,Wd=(a,b)=>[p.x+cs*a+nx*b,p.z+sn*a+nz*b];let gy=1e9;for(const a of[-hl,0,hl])for(const b of[-hw,hw]){const q=Wd(a,b);gy=Math.min(gy,terrainH(q[0],q[1]))}
    for(const sd of[-1,1]){const q=Wd(0,sd*(hw+.25));pboxR(1,q[0],q[1],hl,.25,cs,sn,gy-1.5,gy+4.6,226,230,236,false,.7);COLO.push(q[0],q[1],hl,.3,cs,sn,gy+4.6);
      for(let k=-2;k<=2;k++){const s2=Wd(k*hl*.4,sd*(hw+.52));pboxR(1,s2[0],s2[1],hl*.16,.03,cs,sn,gy+1.2,gy+2.0,30,90,220,false,1)}}         /* blue bands on the walls */
    pboxR(1,p.x,p.z,hl+.4,hw+.6,cs,sn,gy+4.6,gy+5.1,40,90,210,false,1);                                                                   /* the roof, blue */
    for(const e of[-1,1]){const q=Wd(e*(hl+.3),0);pboxR(1,q[0],q[1],.15,hw+.6,cs,sn,gy+4.0,gy+4.6,250,250,252,false,1);                   /* a white lintel over each opening */
      for(let k=-3;k<=3;k++){const s3=Wd(e*(hl-1.5),k*hw/3.5);pboxR(1,s3[0],s3[1],.08,.32,cs,sn,gy+4.1,gy+4.18,255,244,214,2,1)}}          /* lights inside */
    for(let a=-hl+1;a<hl;a+=2.4){const q=Wd(a,0);pboxR(1,q[0],q[1],1.25,hw-.4,cs,sn,terrainH(q[0],q[1])+.02,terrainH(q[0],q[1])+.05,46,50,58,false,1)}   /* the floor */
    /* two gravel aprons: from the road shoulder to each opening */
    for(const e of[-1,1])for(let k=0;k<6;k++){const f=k/5,a=e*(hl+2+f*9),b=-p.side*(hw+3)*f*0+(-p.side)*(f*(hw+5.5)),q=Wd(a,b);pboxR(1,q[0],q[1],1.6,2.4,cs,sn,terrainH(q[0],q[1])+.015,terrainH(q[0],q[1])+.04,88,86,80,false,1)}
    /* the sign: a blue board on a post by the road with a white cross that glows */
    {const q=Wd(0,-p.side*(hw+3.5)),y=terrainH(q[0],q[1]);pbox(1,q[0],y-.4,q[1],.2,y+7.5,.2,200,200,206,false,.8);COLC.push(q[0],q[1],.35,y-.5,y+7.5);
     pboxR(1,q[0],q[1],2.2,.18,cs,sn,y+6,y+9.2,30,90,220,false,1);const f=[nx*-p.side*.2,nz*-p.side*.2];pboxR(1,q[0]+f[0],q[1]+f[1],1.3,.1,cs,sn,y+7.35,y+7.85,250,252,255,2,1);pboxR(1,q[0]+f[0],q[1]+f[1],.25,.1,cs,sn,y+6.4,y+8.8,250,252,255,2,1);
     NEONS.push(q[0],y+7.6,q[1],.7,.85,1,4)}
    p.gy=gy}
  /* Golden Gate Park: dense trees round a lake, kept clear of the drive */
  {const pr=mulberry(909),lk=LAKES[0];let np=0;for(let x=PARK.x0+4;x<PARK.x1-4;x+=8)for(let z=PARK.z0+4;z<PARK.z1-4;z+=8){const px=x+(pr()-.5)*7,pz=z+(pr()-.5)*7;if(Math.hypot(px-lk[0],pz-lk[1])<lk[2]+5)continue;
    const gi=Math.round((px+W.half)/W.T),gj=Math.round((pz+W.half)/W.T);if(W.D8[gj*W.N+gi]<5||pr()<.25||nearRoadXZ(px,pz,8))continue;ptree(px,pz,pr,terrainH(px,pz),true);COLC.push(px,pz,.55,terrainH(px,pz)-.5,terrainH(px,pz)+12);np++}}
  /* suburb: low houses on a loose grid around the city, clear of every road and of the districts */
  const sub=mulberry(77);let ns=0;
  for(const[SB,mx,mz]of[[CITY,420,380],[VALLEY,380,380],[TOWN_BAR,300,300],[TOWN_PAC,300,300],[TOWN_FRE,320,320],[TOWN_BIG,240,240],[CITY_SAC,280,260],[CITY_SJ,300,280]])
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
    if(forestAt(px,pz,h,sl,dr))p=.66;else if(dr>13&&dr<95&&h>6&&sl<.4&&!inUrban(px,pz,60))p=(.11+.3*sstep(1,2,fbm(px*.003,pz*.003,55,2)*2))*(1-.65*sstep(40,95,dr));
    if(h<5||tr()>p||nearRoadXZ(px,pz,9))continue;ptree(px,pz,tr,h);COLC.push(px,pz,.55,terrainH(px,pz)-.5,terrainH(px,pz)+12);nt++}
  return{buildings:nb,houses:ns,trees:nt,scenery:buildScenery()}}
/* ---------- scenery along the open roads: poles + wires, gantry signs, billboards, speed + curve signs, fences, groves, bushes, rocks, cacti, wind turbines, gas stations ---------- */
function buildScenery(){
  const sr=mulberry(5150),St={poles:0,delin:0,gantry:0,bill:0,chev:0,sign:0,fence:0,groves:0,trees:0,bush:0,rock:0,cactus:0,turb:0,gas:0,farm:0,hv:0,tuft:0,street:0,at:{gas:[],farm:[],bill:[],gantry:[],turb:[],hv:[]}};
  const dryAt=(x,z)=>Math.min(1,sstep(1300,2300,z)*.8+sstep(500,1800,x)*.15+sstep(2600,3800,x)*.9);
  const BB=[[214,64,52],[244,196,44],[44,108,214],[236,236,232],[34,148,92],[238,120,36],[130,60,170]];
  const sideAt=(r,i,tx,tz,sd,g)=>{const o=r.hw*r.wk[i]+RSH+g,px=r.X[i]-tz*sd*o,pz=r.Z[i]+tx*sd*o;return[px,pz,terrainH(px,pz)]};
  const free=(px,pz,y,g,dy)=>{const ty=terrainH(px,pz);return ty>3&&Math.abs(ty-y)<dy&&!nearRoadXZ(px,pz,Math.min(g*.7,6))};
  const quad2=(m,A,B,C,D,nx,ny,nz,r,g,b)=>{const f=[A,B,C,D].map(p=>m.v(p[0],p[1],p[2],nx,ny,nz,r,g,b,.03,.03,0)),k=[D,C,B,A].map(p=>m.v(p[0],p[1],p[2],-nx,-ny,-nz,r*.8,g*.8,b*.8,.03,.03,0));m.q(f[0],f[1],f[2],f[3]);m.q(k[0],k[1],k[2],k[3])};
  /* street trees along the city streets: broadleaf trees on the sidewalk, every other lamp's distance */
  ROADS.forEach((r,ri)=>{if(!r.city||r.style==4)return;const n=r.n,rg=mulberry(8800+ri);let d=rg()*20;
    for(let i=1;i<n-1;i++){d+=Math.hypot(r.X[i]-r.X[i-1],r.Z[i]-r.Z[i-1]);if(d<24)continue;d=0;if(r.br[i]||r.mk[i]<.9||r.wk[i]<.9||rg()<.45)continue;
      const dx=r.X[i+1]-r.X[i-1],dz=r.Z[i+1]-r.Z[i-1],l=Math.hypot(dx,dz)||1,nx=-dz/l,nz=dx/l,sd=rg()<.5?-1:1,o=r.hw*r.wk[i]+(r.sw?1.3:RSH+.55),px=r.X[i]+nx*sd*o,pz=r.Z[i]+nz*sd*o,ty=terrainH(px,pz);
      if(ty<3||Math.abs(ty-r.Y[i])>2.5||nearRepair(px,pz,4)||otherAsphalt(px,pz,r,r.Y[i],RSH+.4)||(r.sw&&!swOn(r,sd>0?1:0,r.S[i])))continue;let c0=0;const q=mulberry((px*7+pz*3)|0),fr=()=>c0++==0?.8:q();ptree(px,pz,fr,ty,true);COLC.push(px,pz,.5,ty-.5,ty+8);St.street++}});
  ROADS.forEach((r,ri)=>{if(r.city)return;const n=r.n,hwy=r.style==1,poleSide=((ri*5+3)&1)?1:-1;
    const nx_={pole:sr()*40,del:sr()*40,gan:250+sr()*700,bill:300+sr()*800,sign:150+sr()*400,grove:0,turb:500+sr()*700,gas:700+sr()*1500,home:600+sr()*1200,hv:300+sr()*2000,hvn:0};
    let d=0,pp=null,lastChev=-1e9;const fence=[{n:0},{n:0}],hv={n:0,sd:1,p:null};
    for(let i=0;i<n;i++){const ip=(i-1+n)%n,inn=(i+1)%n;if(!r.closed&&(i<1||i>n-2))continue;
      d+=Math.hypot(r.X[i]-r.X[ip],r.Z[i]-r.Z[ip]);if(r.br[i]||r.mk[i]<.99||r.wk[i]<.9)continue;
      let tx=r.X[inn]-r.X[ip],tz=r.Z[inn]-r.Z[ip];const tl=Math.hypot(tx,tz)||1;tx/=tl;tz/=tl;const nx=-tz,nz=tx,cx=r.X[i],cz=r.Z[i],Y=r.Y[i],hwl=r.hw*r.wk[i];
      /* telegraph poles with two wires along one side of the two-lane roads */
      if(!hwy&&r.hw<=11&&d>=nx_.pole){nx_.pole=d+52;const[px,pz,ty]=sideAt(r,i,tx,tz,poleSide,3.6);
        if(free(px,pz,Y,2,3.5)){ptrunk(0,px,ty-.2,pz,.17,9.2,92,72,52);pboxR(0,px,pz,1.15,.07,nx,nz,ty+8.2,ty+8.45,70,58,44,false,1);COLC.push(px,pz,.3,ty-.5,ty+9);St.poles++;
          if(pp&&Math.hypot(px-pp[0],pz-pp[1])<80)for(const o of[-.95,.95]){const a=[pp[0]+pp[3]*o,pp[2]+8.5,pp[1]+pp[4]*o],b=[px+nx*o,ty+8.5,pz+nz*o],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2-.75,(a[2]+b[2])/2];pbar(0,a[0],a[1],a[2],mid[0],mid[1],mid[2],.05,24,24,28);pbar(0,mid[0],mid[1],mid[2],b[0],b[1],b[2],.05,24,24,28)}
          pp=[px,pz,ty,nx,nz]}else pp=null}
      /* white reflector posts along the edge of the highways */
      if(hwy&&d>=nx_.del){nx_.del=d+44;for(const sd of[-1,1]){const[px,pz,ty]=sideAt(r,i,tx,tz,sd,.45);if(free(px,pz,Y,.5,2)){ptrunk(0,px,ty-.1,pz,.05,1.05,238,238,232);St.delin++}}}
      /* overhead gantry signs on the highways: two legs, a beam, a green panel for each carriageway */
      if(hwy&&hwl>=8&&d>=nx_.gan){nx_.gan=d+500+sr()*600;const a=sideAt(r,i,tx,tz,-1,2.6),b=sideAt(r,i,tx,tz,1,2.6);
        if(free(a[0],a[1],Y,2.6,4)&&free(b[0],b[1],Y,2.6,4)){const o=hwl+RSH+2.6;
          for(const p of[a,b]){ptrunk(1,p[0],p[2]-.4,p[1],.34,Y+7.3-p[2]+.4,112,116,122);COLC.push(p[0],p[1],.5,p[2]-.5,Y+7)}
          pboxR(1,cx,cz,o,.35,nx,nz,Y+6.7,Y+7.35,112,116,122,false,.9);
          for(const lat of[-hwl*.5,hwl*.5]){const sx=cx+nx*lat,sz=cz+nz*lat;pboxR(1,sx,sz,3.1,.1,nx,nz,Y+4.7,Y+6.7,14,104,68,false,1);
            for(const sg of[-1,1])for(const[w,yc]of[[2.2,6.2],[1.4,5.7],[1.9,5.2]])pboxR(1,sx-nz*sg*.115,sz+nx*sg*.115,w,.015,nx,nz,Y+yc-.11,Y+yc+.11,240,240,234,false,1)}
          St.at.gantry.push([cx,cz,tx,tz]);St.gantry++}}
      /* billboards on stilts, facing the road */
      if(d>=nx_.bill){nx_.bill=d+380+sr()*600;const sd=sr()<.5?-1:1,g=11+sr()*9,[px,pz,ty]=sideAt(r,i,tx,tz,sd,g);
        if(free(px,pz,Y,g,3.5)&&!inBox(px,pz,CITY,100)&&!inBox(px,pz,VALLEY,100)){const c=BB[(sr()*BB.length)|0],c2=BB[(sr()*BB.length)|0],dk=c[0]+c[1]+c[2]>520?[24,24,30]:[245,245,240],k=sr();
          for(const q of[-4,4]){ptrunk(1,px+tx*q,ty-.4,pz+tz*q,.34,9.4,100,100,106);COLC.push(px+tx*q,pz+tz*q,.5,ty-.5,ty+9)}
          pboxR(1,px,pz,6.2,.22,tx,tz,ty+8.7,ty+13.5,c[0],c[1],c[2],false,.9);const fo=-sd*.25,ox=px+nx*fo,oz=pz+nz*fo;
          pboxR(1,ox,oz,4.6,.02,tx,tz,ty+11.5,ty+12.7,dk[0],dk[1],dk[2],false,1);pboxR(1,ox,oz,3.2-k,.02,tx,tz,ty+10.0,ty+10.8,dk[0],dk[1],dk[2],false,1);pboxR(1,ox+tx*(k>.5?3.9:-3.9),oz+tz*(k>.5?3.9:-3.9),1.2,.02,tx,tz,ty+9.1,ty+9.9,c2[0],c2[1],c2[2],false,1);
          St.at.bill.push([px,pz,tx,tz]);St.bill++}}
      /* speed limit signs */
      if(d>=nx_.sign){nx_.sign=d+420+sr()*300;for(const sd of(hwy?[-1,1]:[poleSide*-1])){const[px,pz,ty]=sideAt(r,i,tx,tz,sd,1.6);if(!free(px,pz,Y,1.6,2.5))continue;
          ptrunk(0,px,ty-.2,pz,.045,2.5,150,150,156);pboxR(0,px,pz,.34,.02,nx,nz,ty+1.55,ty+2.45,236,236,232,false,1);
          for(const sg of[-1,1])pboxR(0,px-nz*sg*.03,pz+nx*sg*.03,.2,.012,nx,nz,ty+1.78,ty+2.2,26,26,30,false,1);St.sign++}}
      /* chevron boards on the outside of the bends */
      {const a=(i-6+n)%n,b=(i+6)%n;if((r.closed||(i>6&&i<n-7))&&d-lastChev>(hwy?46:36)){const ax=r.X[i]-r.X[a],az=r.Z[i]-r.Z[a],bx=r.X[b]-r.X[i],bz=r.Z[b]-r.Z[i],al=Math.hypot(ax,az)||1,bl=Math.hypot(bx,bz)||1,cr=(ax*bz-az*bx)/(al*bl);
        if(Math.abs(cr)>.2){const ix=bx/bl-ax/al,iz=bz/bl-az/al,sd=(nx*ix+nz*iz)>0?-1:1,[px,pz,ty]=sideAt(r,i,tx,tz,sd,1.5);
          if(free(px,pz,Y,1.5,2.5)){lastChev=d;ptrunk(0,px,ty-.2,pz,.05,1.4,150,150,156);pboxR(0,px,pz,.8,.035,tx,tz,ty+1.2,ty+2.25,242,196,28,false,1);
            pboxR(0,px-nx*sd*.05,pz-nz*sd*.05,.52,.012,tx,tz,ty+1.42,ty+2.03,26,26,30,false,1);St.chev++}}}}
      /* fences, groves, bushes, rocks and cacti on both sides */
      if(d>=nx_.grove){nx_.grove=d+15;
        for(let si=0;si<2;si++){const sd=si?1:-1,dry0=dryAt(cx+nx*sd*30,cz+nz*sd*30),fz=fence[si];
          /* a fence along fields */
          if(fz.n>0){const[px,pz,ty]=sideAt(r,i,tx,tz,sd,2.8);if(free(px,pz,Y,2.8,3)){ptrunk(0,px,ty-.2,pz,.07,1.15,112,88,62);if(fz.p&&Math.hypot(px-fz.p[0],pz-fz.p[1])<24)for(const hh of[.45,.95])pbar(0,fz.p[0],fz.p[2]+hh,fz.p[1],px,ty+hh,pz,.07,124,100,72);fz.p=[px,pz,ty];fz.n--}else{fz.n=0;fz.p=null}}
          else if(dry0<.5&&sr()<.025){fz.n=7+((sr()*9)|0);fz.p=null;St.fence++}
          /* the tree belts come and go with a noise field; the dry country gets rocks and cacti instead */
          const nz2=fbm((cx+nx*sd*30)*.004,(cz+nz*sd*30)*.004,77,2),g=4+sr()*24,[px,pz,ty]=sideAt(r,i,tx,tz,sd,g);
          if(!free(px,pz,Y,g,7))continue;
          if(dry0>.55){const q=sr();
            if(q<.28){const h=3.2+sr()*3.4;ptrunk(2,px,ty-.2,pz,.3,h,72,112,66);const arms=1+((sr()*2)|0);for(let k=0;k<arms;k++){const a=sr()*TAU,ax=Math.cos(a),az=Math.sin(a),y1=ty+h*(.35+sr()*.2);pbar(2,px,y1,pz,px+ax*.95,y1,pz+az*.95,.27,72,112,66);pbar(2,px+ax*.95,y1,pz+az*.95,px+ax*.95,y1+1.2+sr()*.9,pz+az*.95,.27,76,118,70)}COLC.push(px,pz,.4,ty-.5,ty+h);St.cactus++}
            else if(q<.45){const k=1+((sr()*3)|0);for(let j=0;j<k;j++){const ox=px+(sr()-.5)*4,oz=pz+(sr()-.5)*4,sc=.7+sr()*1.4,c=104+sr()*40,ty2=terrainH(ox,oz);prock(ox,oz,ty2,1.5*sc,1.05*sc,c,c*.93,c*.82,sr()*6);if(j==0)COLC.push(ox,oz,1.1*sc,ty2-.5,ty2+1.3*sc)}St.rock++}
            else if(q<.8){const sc=.7+sr()*.8,c=116+sr()*30;pbush(px,pz,ty,1.1*sc,.8*sc,c,c*.9,c*.5,sr()*6);St.bush++}}
          else if(nz2>.36&&sr()<.2+.65*sstep(.4,.62,nz2)){const k=2+((sr()*5)|0);St.groves++;
            for(let j=0;j<k;j++){const ox=px+(sr()-.5)*14,oz=pz+(sr()-.5)*14,ty2=terrainH(ox,oz);if(!free(ox,oz,Y,g,8))continue;ptree(ox,oz,sr,ty2,true);COLC.push(ox,oz,.55,ty2-.5,ty2+12);St.trees++}}
          else if(sr()<.5){const sc=.8+sr()*.9,gr=sr()<.2?[104,110,56]:[48+sr()*26,92+sr()*30,44];pbush(px,pz,ty,1.3*sc,1.0*sc,gr[0],gr[1],gr[2],sr()*6);St.bush++}
          if(g<12&&sr()<.5){const sc=.7+sr()*.8,gr=dry0>.55?[132,120,70]:[56+sr()*20,98+sr()*20,48],g2=3+sr()*3,[bx,bz,by]=sideAt(r,i,tx,tz,sd,g2);if(free(bx,bz,Y,g2,3)){pbush(bx,bz,by,1.0*sc,.75*sc,gr[0],gr[1],gr[2],sr()*6);St.bush++}}
          /* tufts of tall grass along the verge (golden in the dry country) */
          {const nT=1+((sr()*3)|0),dc=dry0>.45;for(let q=0;q<nT;q++){const gt=1.4+sr()*9,[ux,uz]=sideAt(r,i,tx,tz,sd,gt),jx=ux+(sr()-.5)*5,jz=uz+(sr()-.5)*5,uy=terrainH(jx,jz),sc=.8+sr()*.9,cc=dc?[150+sr()*30,128+sr()*20,66]:[88+sr()*30,126+sr()*26,56];if(!free(jx,jz,Y,gt,3))continue;ptuft(jx,uy-.05,jz,sr()*3,1.5*sc,1.05*sc,cc[0],cc[1],cc[2]);St.tuft++}}}}
      /* wind turbines on the open country, in rows of three */
      if(d>=nx_.turb){nx_.turb=d+800+sr()*900;const sd=sr()<.5?-1:1,g=70+sr()*120,rot=sr()*6,fx=Math.cos(rot),fz=Math.sin(rot);
        for(let k=0;k<3;k++){const[bx,bz]=sideAt(r,i,tx,tz,sd,g),px=bx+tx*k*105+(sr()-.5)*14,pz=bz+tz*k*105+(sr()-.5)*14,ty=terrainH(px,pz);
          if(ty<6||terrainSlope(px,pz)>.14||nearRoadXZ(px,pz,40)||inUrban(px,pz,120))continue;const h=48+sr()*10,hy=ty+h;
          pfrus(1,px,ty-.6,pz,1.7,.95,h+.6,232,234,236,7);pboxR(1,px,pz,1.5,.85,fx,fz,hy-.9,hy+.9,226,228,232,false,.9);
          const hx=px+fx*1.9,hz=pz+fz*1.9,sx=-fz,sz=fx,th0=sr()*TAU;
          for(let b=0;b<3;b++){const th=th0+b*TAU/3,c=Math.cos(th),s=Math.sin(th),L=31,ux=sx*s,uy=c,uz=sz*s,wx=sx*c,wy=-s,wz=sz*c,m=pmb(px,pz,1,8);
            quad2(m,[hx+wx*1.0,hy+wy*1.0,hz+wz*1.0],[hx-wx*1.0,hy-wy*1.0,hz-wz*1.0],[hx+ux*L-wx*.14,hy+uy*L-wy*.14,hz+uz*L-wz*.14],[hx+ux*L+wx*.14,hy+uy*L+wy*.14,hz+uz*L+wz*.14],fx,0,fz,236,238,240)}
          COLC.push(px,pz,1.7,ty-.5,ty+14);St.at.turb.push([px,pz,tx,tz]);St.turb++}}
      /* a farmstead (barn, silo, house) or, in the dry country, an adobe house with a water tower, back from the road */
      if(!hwy&&r.hw<=13&&d>=nx_.home){nx_.home=d+1100+sr()*1700;const sd=sr()<.5?-1:1,g=34+sr()*34,[px,pz,ty]=sideAt(r,i,tx,tz,sd,g),cs=tx,sn=tz,fz=-sd,dry=dryAt(px,pz)>.55;
        const Wd=(lx,lz)=>[px+lx*cs-lz*sn,pz+lx*sn+lz*cs];let ok=!inUrban(px,pz,80);
        for(const c of[[-22,-16],[22,-16],[22,16],[-22,16],[0,0]]){const w=Wd(c[0],c[1]);if(!free(w[0],w[1],Y,g-14,3)){ok=false;break}}
        if(ok){const gy=gmin(px,pz,20,14,cs,sn);let w;
          if(!dry){w=Wd(-9,-fz*3);pboxR(1,w[0],w[1],7.5,5,cs,sn,gy-1,gy+5.5,170,54,46,true,.7);proofR(1,w[0],w[1],7.5,5,cs,sn,gy+5.5,3.2,112,58,50,true);reg2(w[0],w[1],7.5,5,cs,sn,gy+8);
            pboxR(1,...Wd(-9,-fz*3+fz*5.04),2.3,.05,cs,sn,gy,gy+4,64,34,28,false,1);
            w=Wd(-21,-fz*6);pfrus(1,w[0],gy-.4,w[1],2.5,2.4,11,204,204,208,8);pcone(1,w[0],gy+11,w[1],2.8,2.6,168,60,52,8,0);COLC.push(w[0],w[1],2.6,gy-.5,gy+13);
            w=Wd(9,-fz*2);pboxR(1,w[0],w[1],5.2,4.2,cs,sn,gy-1,gy+4.4,236,232,222,true,.7);proofR(1,w[0],w[1],5.2,4.2,cs,sn,gy+4.4,2.4,150,92,78,true);reg2(w[0],w[1],5.2,4.2,cs,sn,gy+6.5);
            w=Wd(12,-fz*13);pboxR(1,w[0],w[1],3.6,2.8,cs,sn,gy-.5,gy+3,160,150,138,false,.7);reg2(w[0],w[1],3.6,2.8,cs,sn,gy+3)}
          else{w=Wd(0,0);pboxR(1,w[0],w[1],6.5,4.2,cs,sn,gy-1,gy+3.6,214,184,146,true,.75);pboxR(1,w[0],w[1],6.8,4.5,cs,sn,gy+3.6,gy+4.1,196,164,128,false,1);reg2(w[0],w[1],6.5,4.2,cs,sn,gy+4.1);
            w=Wd(10,-fz*2);pboxR(1,w[0],w[1],3,3.2,cs,sn,gy-1,gy+2.8,226,200,160,false,.75);reg2(w[0],w[1],3,3.2,cs,sn,gy+2.8);
            w=Wd(-16,-fz*6);for(const sx of[-1,1])for(const sz of[-1,1])ptrunk(1,w[0]+sx*2.1,gy-.3,w[1]+sz*2.1,.26,13,120,118,114);
            pfrus(1,w[0],gy+13,w[1],3.3,3.3,4.6,176,172,168,8);pcone(1,w[0],gy+17.6,w[1],3.5,2.2,150,60,52,8,0);COLC.push(w[0],w[1],3,gy-.5,gy+13)}
          for(let q=0;q<(dry?2:5);q++){const a=sr()*TAU,rr=13+sr()*8,tp=Wd(Math.cos(a)*rr*1.3,Math.sin(a)*rr),ty2=terrainH(tp[0],tp[1]);if(!free(tp[0],tp[1],Y,g-12,4))continue;
            if(dry){ptrunk(2,tp[0],ty2-.2,tp[1],.3,3.4,72,112,66);COLC.push(tp[0],tp[1],.4,ty2-.5,ty2+3.4)}else{ptree(tp[0],tp[1],sr,ty2,true);COLC.push(tp[0],tp[1],.55,ty2-.5,ty2+12)}}
          St.at.farm.push([px,pz,tx,tz]);St.farm++}}
      /* high voltage lines marching along the highways: pairs of tall legs with a cross beam and three wires */
      if(hwy){if(hv.n<=0&&d>=nx_.hv){hv.n=7+((sr()*8)|0);hv.sd=sr()<.5?-1:1;hv.p=null;nx_.hv=d+1e9;nx_.hvn=d}
        if(hv.n>0&&d>=nx_.hvn){nx_.hvn=d+100;const[px,pz,ty]=sideAt(r,i,tx,tz,hv.sd,42+sr()*4);
          if(free(px,pz,Y,36,6)){const L=21,o=3.8;for(const q of[-1,1]){const lx=px+nx*o*q,lz=pz+nz*o*q,t2=terrainH(lx,lz);ptrunk(1,lx,t2-.4,lz,.42,L+.4,150,152,158);COLC.push(lx,lz,.6,t2-.5,t2+20)}
            pbar(1,px-nx*6.2,ty+L,pz-nz*6.2,px+nx*6.2,ty+L,pz+nz*6.2,.5,140,142,148);pbar(1,px-nx*o,ty+L-5,pz-nz*o,px+nx*o,ty+L-5,pz+nz*o,.35,140,142,148);
            if(hv.p&&Math.hypot(px-hv.p[0],pz-hv.p[1])<130)for(const o2 of[-5.6,0,5.6]){const a=[hv.p[0]+hv.p[3]*o2,hv.p[2]+L-.3,hv.p[1]+hv.p[4]*o2],b=[px+nx*o2,ty+L-.3,pz+nz*o2],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2-2.4,(a[2]+b[2])/2];pbar(1,a[0],a[1],a[2],mid[0],mid[1],mid[2],.09,26,26,30);pbar(1,mid[0],mid[1],mid[2],b[0],b[1],b[2],.09,26,26,30)}
            hv.p=[px,pz,ty,nx,nz];hv.n--;St.hv++}else{hv.p=null;hv.n--}
          if(hv.n<=0)nx_.hv=d+2500+sr()*3500}}
      /* a gas station with a canopy, a shop and a tall price sign, beside the highways and the bigger roads */
      if((hwy||r.hw>=9)&&d>=nx_.gas){nx_.gas=d+1800+sr()*2200;const sd=sr()<.5?-1:1,g=26,[px,pz,ty]=sideAt(r,i,tx,tz,sd,g),cs=tx,sn=tz,fz=-sd;
        const Wd=(lx,lz)=>[px+lx*cs-lz*sn,pz+lx*sn+lz*cs];let ok=!inUrban(px,pz,60);
        for(const c of[[-17,-13],[17,-13],[17,13],[-17,13],[0,0]]){const w=Wd(c[0],c[1]);if(!free(w[0],w[1],Y,g-6,2.6)){ok=false;break}}
        if(ok){const gy=gmin(px,pz,17,13,cs,sn);pboxR(1,px,pz,17,13,cs,sn,gy-1.2,gy+.12,62,64,68,false,.9);
          for(const sx of[-1,1])for(const sz of[-1,1]){const w=Wd(-3+sx*6.4,fz*2+sz*2.7);pbox(1,w[0],gy,w[1],.2,gy+4.7,.2,200,200,204,false,.8);COLC.push(w[0],w[1],.3,gy-.5,gy+4.7)}
          let w=Wd(-3,fz*2);pboxR(1,w[0],w[1],8.2,3.6,cs,sn,gy+4.7,gy+5.3,232,232,236,false,.9);pboxR(1,w[0],w[1],8.3,3.7,cs,sn,gy+4.95,gy+5.2,206,50,42,false,1);
          for(const sx of[-1,1]){const p=Wd(-3+sx*3,fz*2);pboxR(1,p[0],p[1],.4,.32,cs,sn,gy+.12,gy+1.4,212,212,216,false,.9);pboxR(1,p[0],p[1],.3,.33,cs,sn,gy+1.0,gy+1.25,40,60,150,false,1);COLC.push(p[0],p[1],.5,gy,gy+1.4)}
          w=Wd(5.5,-fz*7);pboxR(1,w[0],w[1],7.2,3.6,cs,sn,gy+.12,gy+3.7,228,224,212,true,.7);pboxR(1,w[0],w[1],7.5,3.9,cs,sn,gy+3.7,gy+4.15,206,50,42,false,1);reg2(w[0],w[1],7.2,3.6,cs,sn,gy+4.2);
          w=Wd(-14,fz*10.5);ptrunk(1,w[0],gy-.3,w[1],.36,11.5,196,196,202);pboxR(1,w[0],w[1],1.35,.16,nx,nz,gy+9.6,gy+13.4,226,56,40,false,1);
          for(const sg of[-1,1])for(const[yc,c]of[[12.4,[250,244,230]],[11.2,[250,200,50]],[10.1,[250,200,50]]])pboxR(1,w[0]-nz*sg*.17,w[1]+nx*sg*.17,1.0,.012,nx,nz,gy+yc-.28,gy+yc+.28,c[0],c[1],c[2],false,1);
          COLC.push(w[0],w[1],.5,gy-.5,gy+12);NEONS.push(w[0],gy+11.4,w[1],1,.55,.2,6);St.at.gas.push([px,pz,tx,tz]);St.gas++}}
    }});
  return St}
const reg2=(cx,cz,hx,hz,cs,sn,top)=>{COLO.push(cx,cz,hx,hz,cs,sn,top)};
/* finalise prop meshes into plain arrays the GL side uploads */
function finishProps(){const out=[];PSET.forEach((L,k)=>{const cat=k&3;for(const m of L){if(!m.n)continue;out.push({cat,V:m.f.subarray(0,m.n*7),I:m.ix.subarray(0,m.ni),cx:(m.x0+m.x1)/2,cy:(m.y0+m.y1)/2,cz:(m.z0+m.z1)/2,rad:Math.hypot(m.x1-m.x0,m.y1-m.y0,m.z1-m.z0)/2+1})}});return out}
/* ---------- spatial hash for road queries + colliders ---------- */
const QH={cs:64,nc:0,st:null,li:null,segR:null,segI:null,cst:null,cli:null,ccs:32,cnc:0};
function buildRoadHash(){
  const cs=QH.cs,nc=QH.nc=Math.ceil(W.size/cs);let nseg=0;for(const r of ROADS)nseg+=r.closed?r.n:r.n-1;
  QH.segR=new Uint8Array(nseg);QH.segI=new Int32Array(nseg);let g=0;ROADS.forEach((r,ri)=>{const c=r.closed?r.n:r.n-1;for(let i=0;i<c;i++){QH.segR[g]=ri;QH.segI[g]=i;g++}});
  const cnt=new Int32Array(nc*nc+1);
  const each=(fn)=>{for(let s=0;s<nseg;s++){const r=ROADS[QH.segR[s]],i=QH.segI[s],j=(i+1)%r.n,pad=r.hw+Math.max(RSH,r.sw)+2,x0=Math.min(r.X[i],r.X[j])-pad,x1=Math.max(r.X[i],r.X[j])+pad,z0=Math.min(r.Z[i],r.Z[j])-pad,z1=Math.max(r.Z[i],r.Z[j])+pad;
    const c0=Math.max(0,Math.floor((x0+W.half)/cs)),c1=Math.min(nc-1,Math.floor((x1+W.half)/cs)),d0=Math.max(0,Math.floor((z0+W.half)/cs)),d1=Math.min(nc-1,Math.floor((z1+W.half)/cs));for(let b=d0;b<=d1;b++)for(let a=c0;a<=c1;a++)fn(b*nc+a,s)}};
  each(c=>cnt[c+1]++);for(let k=0;k<nc*nc;k++)cnt[k+1]+=cnt[k];QH.st=cnt;QH.li=new Int32Array(cnt[nc*nc]);const fill=cnt.slice(0,nc*nc);each((c,s)=>{QH.li[fill[c]++]=s})}
/* is this spot on or right beside any road (any height, bridges included)? used to keep trees and houses off roads and their ramps */
function nearRepair(x,z,m){for(const p of REPAIRS){const dx=x-p.x,dz=z-p.z,a=dx*p.cs+dz*p.sn,b=-dx*p.sn+dz*p.cs;if(Math.abs(a)<p.L*1.7+m&&Math.abs(b)<p.W+m+4)return true}return false}
function nearRoadXZ(x,z,m){if(REPAIRS.length&&nearRepair(x,z,m))return true;const cs=QH.cs,nc=QH.nc,cx=Math.floor((x+W.half)/cs),cz=Math.floor((z+W.half)/cs);if(!QH.st||cx<0||cz<0||cx>=nc||cz>=nc)return false;const c=cz*nc+cx;
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
const RQ={on:0,y:0,lat:0,hw:0,tx:0,tz:0,nx:0,nz:0,rail:0,ri:0,br:0,ds:0,cb:0};
function roadAt(x,z,yh){
  const cs=QH.cs,nc=QH.nc,cx=Math.floor((x+W.half)/cs),cz=Math.floor((z+W.half)/cs);if(cx<0||cz<0||cx>=nc||cz>=nc)return false;
  const c=cz*nc+cx;let found=false,bestL=1e9,bestF=1e9,fl=false;
  /* two passes of the same rule: nearest road centre-line wins. First only surfaces within 1.3 m of the car's height (its own level); only if there is
     none, anything within 4.5 m. That keeps a hairpin's upper leg or a crossing road from ever stealing the car. */
  for(let pass=0;pass<2;pass++){const tol=pass?4.5:1.3;if(pass&&found)break;
    for(let q=QH.st[c];q<QH.st[c+1];q++){const s=QH.li[q],r=ROADS[QH.segR[s]],i=QH.segI[s],j=i+1<r.n?i+1:0;
      const ax=r.X[i],az=r.Z[i],dx=r.X[j]-ax,dz=r.Z[j]-az,l2=dx*dx+dz*dz||1;let t=((x-ax)*dx+(z-az)*dz)/l2;t=t<0?0:t>1?1:t;
      const px=ax+dx*t,pz=az+dz*t,ex=x-px,ez=z-pz,d=Math.sqrt(ex*ex+ez*ez),sh=r.sw||RSH,hw=r.hw*(r.wk[i]+(r.wk[j]-r.wk[i])*t)+sh;if(d>hw)continue;
      const yy=r.Y[i]+(r.Y[j]-r.Y[i])*t;if(Math.abs(yy-yh)>tol)continue;
      if(d<bestL){bestL=d;found=true;const l=Math.sqrt(l2),tx=dx/l,tz=dz/l;RQ.tx=tx;RQ.tz=tz;RQ.nx=-tz;RQ.nz=tx;RQ.lat=ex*RQ.nx+ez*RQ.nz;RQ.y=yy+RQ.lat*(r.cf[i]+(r.cf[j]-r.cf[i])*t);RQ.hw=hw-sh;RQ.rail=r.rail[i]&r.rail[j];RQ.ri=QH.segR[s];RQ.br=r.br[i];RQ.ds=r.S[i]+l*t}}}
  return found}
/* ground height under a point (road surface if on a road at that level, else terrain) */
/* RQ.cb = 1 when the spot is up on a sidewalk (behind a curb) */
function groundAt(x,z,yh){const ty=terrainH(x,z);RQ.on=0;RQ.cb=0;if(roadAt(x,z,yh)){const over=Math.abs(RQ.lat)-RQ.hw;let y=RQ.y;
    if(over>0){const r=ROADS[RQ.ri];if(r.sw&&swOn(r,RQ.lat>0?1:0,RQ.ds)){y+=CURB_H*Math.min(1,over/.04);RQ.cb=1}else y-=Math.min(over,RSH)/RSH*.12}
    if(y>ty-2.2){RQ.on=1;return y}}return ty}
