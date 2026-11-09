'use strict';
/* ===== traffic rendering: four low-poly body types built in code (about 200 triangles each), drawn instanced (one draw per type; if the GPU has no instancing, one draw per car) ===== */
const TRM={ready:false,types:[],pal:null,mat:null,inst:null,ibuf:null,off:[0,0,0,0,0],cnt:[0,0,0,0,0],vis:new Int16Array(TRN)};
/* body sections along the car, front to back: [z, bottom y, shoulder y, roof y, half width at the shoulder, half width at the roof]; side glass only where the middle of a pair lies in [gz0,gz1] */
const TRSHAPE=[
 {gz:[-1.25,.95],wheel:.33,sec:[[2.25,.30,.62,.62,.86,.76],[1.65,.28,.80,.80,.90,.80],[.75,.28,.84,1.38,.90,.70],[-.80,.28,.84,1.38,.90,.70],[-1.55,.28,.84,.90,.90,.80],[-2.25,.30,.78,.78,.86,.76]]},     /* sedan */
 {gz:[-1.7,.85],wheel:.32,sec:[[2.0,.30,.60,.60,.85,.75],[1.4,.28,.78,.78,.88,.78],[.5,.28,.82,1.36,.88,.70],[-1.1,.28,.82,1.36,.88,.70],[-2.0,.30,.76,1.0,.85,.75]]},                                /* hatch */
 {gz:[-2.0,1.0],wheel:.38,sec:[[2.4,.36,.80,.80,.90,.82],[1.75,.34,1.0,1.0,.95,.86],[.85,.34,1.04,1.62,.95,.78],[-1.9,.34,1.04,1.62,.95,.78],[-2.4,.36,.98,1.45,.92,.80]]},                             /* suv */
 {gz:[1.2,2.1],wheel:.36,sec:[[2.7,.34,.70,.70,.92,.82],[2.0,.32,.95,.95,.97,.90],[1.3,.32,1.0,1.9,.97,.88],[-2.7,.34,1.0,1.9,.97,.88]]},                                                             /* van */
 {gz:[-1.25,.95],wheel:.33,cop:1,sec:[[2.25,.30,.62,.62,.86,.76],[1.65,.28,.80,.80,.90,.80],[.75,.28,.84,1.38,.90,.70],[-.80,.28,.84,1.38,.90,.70],[-1.55,.28,.84,.90,.90,.80],[-2.25,.30,.78,.78,.86,.76]]}   /* police car: a sedan, black below the beltline, with a light bar */
];
/* tiny mesh builder: flat shaded quads/triangles, normals made to point away from the body axis */
function TMB(){this.P=[];this.N=[];this.M=[];this.I=[]}
TMB.prototype.poly=function(pts,mat,ax){/* pts: array of [x,y,z] (3 or 4), ax: [x,y,z] a point inside, to orient the normal */
  const a=pts[0],b=pts[1],c=pts[2];let ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
  let mx=0,my=0,mz=0;for(const p of pts){mx+=p[0];my+=p[1];mz+=p[2]}mx/=pts.length;my/=pts.length;mz/=pts.length;
  if((mx-ax[0])*nx+(my-ax[1])*ny+(mz-ax[2])*nz<0){nx=-nx;ny=-ny;nz=-nz}
  const base=this.P.length/3;for(const p of pts){this.P.push(p[0],p[1],p[2]);this.N.push(nx,ny,nz);this.M.push(mat)}
  for(let k=1;k<pts.length-1;k++)this.I.push(base,base+k,base+k+1)};
function trBuildType(S,hw){
  const B=new TMB(),sec=S.sec,ns=sec.length,ax=(z,y)=>[0,y,z];
  const ring=s=>[[-s[4],s[1],s[0]],[-s[4],s[2],s[0]],[-s[5],s[3],s[0]],[s[5],s[3],s[0]],[s[4],s[2],s[0]],[s[4],s[1],s[0]]];
  for(let i=0;i<ns-1;i++){const A=ring(sec[i]),Bq=ring(sec[i+1]),zm=(sec[i][0]+sec[i+1][0])/2,ym=(sec[i][1]+sec[i][3]+sec[i+1][1]+sec[i+1][3])/4,axp=[0,ym,zm];
    const cab=Math.min(sec[i][3]-sec[i][2],sec[i+1][3]-sec[i+1][2])>.25&&zm>=S.gz[0]&&zm<=S.gz[1];
    const slope=Math.abs(sec[i][3]-sec[i+1][3])>.2&&(sec[i][3]!=sec[i][2]||sec[i+1][3]!=sec[i+1][2]);
    for(let e=0;e<6;e++){const e2=(e+1)%6;if(e==5&&false)continue;
      /* edges: 0 left lower side, 1 left upper side, 2 roof/top, 3 right upper side, 4 right lower side, 5 bottom */
      let mat=0;if(e==1||e==3)mat=cab?1:0;else if(e==2)mat=slope?1:0;else if(e==5)mat=6;else if(S.cop&&(e==0||e==4))mat=9;
      B.poly([A[e],A[e2],Bq[e2],Bq[e]],mat,axp)}}
  /* front and rear fascia */
  const cap=(s,zo)=>{const R=ring(s);B.poly([R[0],R[1],R[2],R[3],R[4],R[5]].map(p=>[p[0],p[1],p[2]]),0,[0,(s[1]+s[3])/2,s[0]-zo*2])};
  cap(sec[0],1);cap(sec[ns-1],-1);
  const zf=sec[0][0],zr=sec[ns-1][0],yh=(sec[0][1]+sec[0][2])/2;
  /* headlights (front, +z), grille, tail lights (back), plate */
  for(const sd of[-1,1]){B.poly([[sd*.52,yh-.02,zf+.012],[sd*.84,yh-.02,zf+.012],[sd*.84,yh+.1,zf+.012],[sd*.52,yh+.1,zf+.012]],3,[0,yh,zf-1]);
    const yt=(sec[ns-1][1]+sec[ns-1][2])/2+.04;B.poly([[sd*.5,yt-.06,zr-.012],[sd*.84,yt-.06,zr-.012],[sd*.84,yt+.08,zr-.012],[sd*.5,yt+.08,zr-.012]],4,[0,yt,zr+1])}
  B.poly([[-.4,yh-.14,zf+.012],[.4,yh-.14,zf+.012],[.4,yh-.02,zf+.012],[-.4,yh-.02,zf+.012]],2,[0,yh,zf-1]);
  B.poly([[-.25,sec[ns-1][1]+.12,zr-.012],[.25,sec[ns-1][1]+.12,zr-.012],[.25,sec[ns-1][1]+.24,zr-.012],[-.25,sec[ns-1][1]+.24,zr-.012]],5,[0,.5,zr+1]);
  /* wheels */
  const R=S.wheel,seg=8;
  for(const zc of[zf-.78,zr+.78])for(const sd of[-1,1]){const x0=sd*(hw-.3),x1=sd*(hw+.02),ac=[sd*(hw-.6),R,zc];
    const pt=(x,r,a)=>[x,R+Math.sin(a)*r,zc+Math.cos(a)*r];
    for(let k=0;k<seg;k++){const a0=k/seg*TAU,a1=(k+1)/seg*TAU;B.poly([pt(x0,R,a0),pt(x0,R,a1),pt(x1,R,a1),pt(x1,R,a0)],2,ac);
      B.poly([[x1,R,zc],pt(x1,R,a0),pt(x1,R,a1)],2,[sd*(hw-.6),R,zc]);
      B.poly([[x1+sd*.008,R,zc],pt(x1+sd*.008,R*.55,a0),pt(x1+sd*.008,R*.55,a1)],5,[sd*(hw-.6),R,zc])}}
  if(S.cop){/* light bar on the roof: left half red, right half blue (they flash when the siren flag is on) */
    const yt=sec[2][3]+.01,zc0=(sec[2][0]+sec[3][0])/2;
    const box=(x0,x1,y0,y1,z0,z1,mat)=>{const c=[(x0+x1)/2,(y0+y1)/2,(z0+z1)/2],q=[[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]];B.poly(q,mat,c);B.poly([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],mat,c);B.poly([[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]],mat,c);B.poly([[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]],mat,c);B.poly([[x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0]],mat,c)};
    box(-.55,-.02,yt,yt+.14,zc0-.22,zc0+.22,7);box(.02,.55,yt,yt+.14,zc0-.22,zc0+.22,8);box(-.55,.55,yt-.04,yt,zc0-.24,zc0+.24,2)}
  return B}
function trGLInit(){
  const gl=G.gl;TRM.pal=new Float32Array(TCOLS.length*3);TCOLS.forEach((c,i)=>{TRM.pal[i*3]=c[0];TRM.pal[i*3+1]=c[1];TRM.pal[i*3+2]=c[2]});
  /* materials: rgb albedo, alpha = glow (-1: the body colour of the car) */
  TRM.mat=new Float32Array([0,0,0,-1, .03,.045,.06,0, .015,.015,.017,0, .85,.8,.62,1.5, .5,.02,.02,.5, .5,.5,.52,0, .015,.015,.015,0, .8,.1,.05,0, .1,.2,.9,0, .035,.035,.04,0, 0,0,0,0, 0,0,0,0]);
  TRM.types=TRSHAPE.map((S,i)=>{const B=trBuildType(S,TTYPES[i].hw),nv=B.P.length/3,ab=new ArrayBuffer(nv*16),f=new Float32Array(ab),b=new Int8Array(ab);
    for(let v=0;v<nv;v++){f[v*4]=B.P[v*3];f[v*4+1]=B.P[v*3+1];f[v*4+2]=B.P[v*3+2];b[v*16+12]=Math.round(B.N[v*3]*127);b[v*16+13]=Math.round(B.N[v*3+1]*127);b[v*16+14]=Math.round(B.N[v*3+2]*127);b[v*16+15]=B.M[v]}
    return{vb:mkBuf(gl.ARRAY_BUFFER,ab),ib:mkBuf(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(B.I)),n:B.I.length,nv}});
  TRM.inst=new Float32Array(TRN*8);TRM.ibuf=mkBuf(gl.ARRAY_BUFFER,TRM.inst.byteLength,gl.DYNAMIC_DRAW);
  R.trDraw=trDraw;TRM.ready=true}
/* soft blob shadows under the cars (added to the effects batch by fxDraw) */
function trShadows(quad){
  if(!TR.on)return;const a=R.alpha;
  for(const c of TR.cars){if(!c.alive)continue;const dx=c.x-C.x,dz=c.z-C.z;if(dx*dx+dz*dz>25600)continue;
    const x=lerp(c.px,c.x,a),z=lerp(c.pz,c.z,a),yaw=c.pyaw+angd(c.yaw,c.pyaw)*a,sy=Math.sin(yaw),cy=Math.cos(yaw),L=c.hl+.5,Wd=c.hw+.35,y=lerp(c.py,c.y,a)+.05;
    quad(x+sy*-L-cy*Wd,y,z+cy*L-sy*Wd,x+sy*-L+cy*Wd,y,z+cy*L+sy*Wd,x+sy*L+cy*Wd,y,z-cy*L+sy*Wd,x+sy*L-cy*Wd,y,z-cy*L-sy*Wd,0,0,0,.42)}}
/* collect the visible cars into the instance buffer (once per frame; the colour pass and the shadow pass both draw from it) */
function trPrep(){
  TRM.nv=0;if(!TR.on||!TRM.ready||!TR.nAlive)return 0;
  const gl=G.gl,a=R.alpha,I=TRM.inst,cnt=TRM.cnt,off=TRM.off,vis=TRM.vis,cars=TR.cars;cnt[0]=cnt[1]=cnt[2]=cnt[3]=cnt[4]=0;let nv=0;
  for(let i=0;i<TRN;i++){const c=cars[i];if(!c.alive)continue;const x=lerp(c.px,c.x,a),y=lerp(c.py,c.y,a),z=lerp(c.pz,c.z,a),dx=x-R.cx,dz=z-R.cz;if(dx*dx+dz*dz>490000||!M4.sphereIn(R.PL,x,y+1,z,3.6))continue;vis[nv++]=i;cnt[c.type]++}
  if(!nv)return 0;
  off[0]=0;off[1]=cnt[0];off[2]=off[1]+cnt[1];off[3]=off[2]+cnt[2];off[4]=off[3]+cnt[3];const fill=[off[0],off[1],off[2],off[3],off[4]];
  for(let q=0;q<nv;q++){const c=cars[vis[q]],o=fill[c.type]++*8;
    I[o]=lerp(c.px,c.x,a);I[o+1]=lerp(c.py,c.y,a);I[o+2]=lerp(c.pz,c.z,a);I[o+3]=c.pyaw+angd(c.yaw,c.pyaw)*a;I[o+4]=c.pitch;I[o+5]=c.roll;I[o+6]=c.col;I[o+7]=(c.brake?1:0)+(c.siren?2:0)}
  gl.bindBuffer(gl.ARRAY_BUFFER,TRM.ibuf);gl.bufferSubData(gl.ARRAY_BUFFER,0,I.subarray(0,nv*8));TRM.nv=nv;TR.drawn=nv;return nv}
/* issue the draws of the collected cars with whatever program is bound (the attribute layout is shared by the colour and the shadow program) */
function trIssue(){
  const gl=G.gl,I=TRM.inst,cnt=TRM.cnt,off=TRM.off,ext=G.ext.inst;
  if(ext){attrs(4);ext.vertexAttribDivisorANGLE(2,1);ext.vertexAttribDivisorANGLE(3,1)}else attrs(2);
  for(let t=0;t<5;t++){if(!cnt[t])continue;const M=TRM.types[t];
    gl.bindBuffer(gl.ARRAY_BUFFER,M.vb);gl.vertexAttribPointer(0,3,gl.FLOAT,false,16,0);gl.vertexAttribPointer(1,4,gl.BYTE,true,16,12);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,M.ib);
    if(ext){gl.bindBuffer(gl.ARRAY_BUFFER,TRM.ibuf);gl.vertexAttribPointer(2,4,gl.FLOAT,false,32,off[t]*32);gl.vertexAttribPointer(3,4,gl.FLOAT,false,32,off[t]*32+16);ext.drawElementsInstancedANGLE(gl.TRIANGLES,M.n,gl.UNSIGNED_SHORT,0,cnt[t]);R.draws++}
    else{for(let k=0;k<cnt[t];k++){const o=(off[t]+k)*8;gl.vertexAttrib4f(2,I[o],I[o+1],I[o+2],I[o+3]);gl.vertexAttrib4f(3,I[o+4],I[o+5],I[o+6],I[o+7]);gl.drawElements(gl.TRIANGLES,M.n,gl.UNSIGNED_SHORT,0);R.draws++}}
    R.tris+=M.n/3*cnt[t]}
  if(ext){ext.vertexAttribDivisorANGLE(2,0);ext.vertexAttribDivisorANGLE(3,0)}}
function trDraw(){
  if(!TRM.nv)return;const gl=G.gl,P=G.P.tr;
  gl.useProgram(P.p);setEnvU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);gl.uniform3fv(P.u.uPal,TRM.pal);gl.uniform4fv(P.u.uMat,TRM.mat);gl.uniform1f(P.u.uT,R.time);gl.disable(gl.CULL_FACE);
  trIssue()}
