'use strict';
/* ===== the player's car: build a body from a spec, upload it, give it its handling ===== */
const CD={fo:1.38,ro:1.33,hw:.68};      /* where the four wheels touch the ground (m from the middle, sideways), used by the physics to read the road under the car */
function _mkMesh(gl,B,colFor,keepAb){
  const nv=B.nv,ab=new ArrayBuffer(nv*16),i16=new Int16Array(ab),i8=new Int8Array(ab),b8=new Uint8Array(ab);
  for(let v=0;v<nv;v++){i16[v*8]=Math.round(_cl(B.P[v*3],-3.99,3.99)*8192);i16[v*8+1]=Math.round(_cl(B.P[v*3+1],-3.99,3.99)*8192);i16[v*8+2]=Math.round(_cl(B.P[v*3+2],-3.99,3.99)*8192);i16[v*8+3]=0;
    i8[v*16+8]=Math.round(B.N[v*3]*127);i8[v*16+9]=Math.round(B.N[v*3+1]*127);i8[v*16+10]=Math.round(B.N[v*3+2]*127);i8[v*16+11]=B.M[v];
    const c=colFor(B.M[v]),sh=B.S?B.S[v]:1;b8[v*16+12]=c[0]*sh;b8[v*16+13]=c[1]*sh;b8[v*16+14]=c[2]*sh;b8[v*16+15]=255}
  const idx=new Uint16Array(B.I.length);for(let i=0;i<idx.length;i++)idx[i]=B.I[i];
  return{vb:mkBuf(gl.ARRAY_BUFFER,ab,gl.DYNAMIC_DRAW),ib:mkBuf(gl.ELEMENT_ARRAY_BUFFER,idx),n:idx.length,gf:(B.glassFrom!=null?B.glassFrom:idx.length),pr:B.pr,gpr:B.gpr,ab}}
/* build the mesh of a car definition and make it THE car: body, wheels, materials, paint, light positions, dimensions, wheel contact points */
function carInstall(def,paint){
  const gl=G.gl,B=def.cc?ccBuild(def.cc):cgBuild(def.spec),S=B.S;   /* a Close Call car (73_ccars.js) or a generated supercar */
  for(const m of[CARM.body,...(CARM.wheels||[])])if(m&&m.vb){gl.deleteBuffer(m.vb);gl.deleteBuffer(m.ib)}
  const rim=def.rim||[190,194,200],cal=def.caliper||[205,28,28];
  const inter=def.interior||CGCOL[CGM.inter],col=m=>m==CGM.paint?[255,255,255]:m==CGM.rim?rim:m==CGM.caliper?cal:m==CGM.inter?inter:CGCOL[m];
  CARM.body=_mkMesh(gl,B.body,col);
  CARM.wheels=[Object.assign(_mkMesh(gl,B.wheelF,col),{x:S.fz,R:S.rf,lat:S.tf}),Object.assign(_mkMesh(gl,B.wheelR,col),{x:S.rz,R:S.rr,lat:S.tr})];
  const mat=new Float32Array(160);CGMAT.forEach((m,i)=>{for(let k=0;k<4;k++)mat[i*4+k]=m[k]/255});CARM.mat=mat;
  const pc=paint||def.paint||[200,30,30];CARM.paint=new Float32Array([Math.pow(pc[0]/255,2.2),Math.pow(pc[1]/255,2.2),Math.pow(pc[2]/255,2.2)]);
  CARM.def=def;CARM.hw=S.W/2;CARM.hl=S.L/2;CARM.R=[S.rf,S.rr];
  const L=S._lights;CARL.hx=L.hx;CARL.hy=L.hy;CARL.hz=L.hz;CARL.tx=L.tx;CARL.ty=L.ty;CARL.tz=L.tz;
  const wk=(def.cc?S.wb:def.spec.wb)/2.45;CD.fo=1.38*wk;CD.ro=1.33*wk;CD.hw=.68*(S.tf/.775);
  CARM.parts=S._parts;CARM.zc=S.zs((S.cowl+S.roofR)/2);partsInit();dmgInit();dmgReset();return B}
