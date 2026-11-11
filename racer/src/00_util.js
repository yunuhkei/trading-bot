'use strict';
/* ===== math, noise, small helpers (no per-frame allocation in anything the game loop calls) ===== */
const TAU=6.283185307179586,PI=Math.PI;
const clamp=(x,a,b)=>x<a?a:x>b?b:x,lerp=(a,b,t)=>a+(b-a)*t;
const sstep=(a,b,x)=>{const t=a===b?(x<a?0:1):clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
const angd=(a,b)=>{let d=(a-b)%TAU;if(d>PI)d-=TAU;else if(d<-PI)d+=TAU;return d};
/* the map must be identical on every device: integer hashing and plain arithmetic only (no Math.sin/pow in generation) */
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function h2(x,y,s){let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,1013904223))|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296}
function vn(x,y,s){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);const a=h2(ix,iy,s),b=h2(ix+1,iy,s),c=h2(ix,iy+1,s),d=h2(ix+1,iy+1,s);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v}
function fbm(x,y,s,o){let a=.5,f=1,t=0,n=0;for(let i=0;i<o;i++){t+=a*vn(x*f,y*f,s+i*17);n+=a;a*=.5;f*=2.03}return t/n}
function ridge(x,y,s,o){let a=.5,f=1,t=0,n=0;for(let i=0;i<o;i++){const v=1-Math.abs(vn(x*f,y*f,s+i*29)*2-1);t+=a*v*v;n+=a;a*=.5;f*=2.07}return t/n}
/* 4x4 matrices, column-major Float32Array, written into a caller-supplied output */
const M4={
 id(o){o.fill(0);o[0]=o[5]=o[10]=o[15]=1;return o},
 persp(o,fov,asp,n,f){const t=1/Math.tan(fov/2);o.fill(0);o[0]=t/asp;o[5]=t;o[10]=(f+n)/(n-f);o[11]=-1;o[14]=2*f*n/(n-f);return o},
 look(o,ex,ey,ez,tx,ty,tz){let fx=tx-ex,fy=ty-ey,fz=tz-ez,l=Math.hypot(fx,fy,fz)||1;fx/=l;fy/=l;fz/=l;
  let sx=fy*0-fz*1,sy=fz*0-fx*0,sz=fx*1-fy*0;/* f x up(0,1,0) */l=Math.hypot(sx,sz)||1;sx/=l;sy=0;sz/=l;
  const ux=sy*fz-sz*fy,uy=sz*fx-sx*fz,uz=sx*fy-sy*fx;
  o[0]=sx;o[4]=sy;o[8]=sz;o[12]=-(sx*ex+sy*ey+sz*ez);
  o[1]=ux;o[5]=uy;o[9]=uz;o[13]=-(ux*ex+uy*ey+uz*ez);
  o[2]=-fx;o[6]=-fy;o[10]=-fz;o[14]=fx*ex+fy*ey+fz*ez;
  o[3]=0;o[7]=0;o[11]=0;o[15]=1;return o},
 mul(o,a,b){for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o},
 /* model matrix from position + yaw (about Y), pitch (about X), roll (about Z): R = Ry(yaw) * Rx(pitch) * Rz(roll) */
 trs(o,x,y,z,yaw,pitch,roll,sx,sy,sz){const cy=Math.cos(yaw),sY=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch),cr=Math.cos(roll),sr=Math.sin(roll);
  /* Rx*Rz */const a00=cr,a01=-sr,a02=0,a10=cp*sr,a11=cp*cr,a12=-sp,a20=sp*sr,a21=sp*cr,a22=cp;
  /* Ry*(Rx*Rz) */const r00=cy*a00+sY*a20,r01=cy*a01+sY*a21,r02=cy*a02+sY*a22,r10=a10,r11=a11,r12=a12,r20=-sY*a00+cy*a20,r21=-sY*a01+cy*a21,r22=-sY*a02+cy*a22;
  sx=sx==null?1:sx;sy=sy==null?1:sy;sz=sz==null?1:sz;
  o[0]=r00*sx;o[1]=r10*sx;o[2]=r20*sx;o[3]=0;o[4]=r01*sy;o[5]=r11*sy;o[6]=r21*sy;o[7]=0;o[8]=r02*sz;o[9]=r12*sz;o[10]=r22*sz;o[11]=0;o[12]=x;o[13]=y;o[14]=z;o[15]=1;return o},
 planes(P,m){/* frustum planes from a view-projection matrix (6 x vec4, normalised) */
  const g=(r,s)=>{const o=[];for(let c=0;c<4;c++)o.push(m[c*4+3]+s*m[c*4+r]);return o};
  const L=[g(0,1),g(0,-1),g(1,1),g(1,-1),g(2,1),g(2,-1)];
  for(let i=0;i<6;i++){const p=L[i],l=Math.hypot(p[0],p[1],p[2])||1;P[i*4]=p[0]/l;P[i*4+1]=p[1]/l;P[i*4+2]=p[2]/l;P[i*4+3]=p[3]/l}return P},
 sphereIn(P,x,y,z,r){for(let i=0;i<6;i++){if(P[i*4]*x+P[i*4+1]*y+P[i*4+2]*z+P[i*4+3]<-r)return false}return true}
};
const $=id=>document.getElementById(id);
function showErr(m){const e=$('err');if(!e)return;e.style.display='block';if(e.textContent.length<2500)e.textContent+=m+'\n'}
window.addEventListener('error',ev=>showErr('JS error: '+ev.message+(ev.lineno?' (line '+ev.lineno+')':'')));
window.addEventListener('unhandledrejection',ev=>showErr('Promise error: '+(ev.reason&&ev.reason.message||ev.reason)));
const nextTick=()=>new Promise(r=>setTimeout(r,0));

/* lane geometry shared by the road shader (painted lines) and the traffic lane graph: from the road's half width and style.
   x0 = where the lanes start (half the centre line gap, or the median edge on a divided road), the edge line sits EDGE_IN m inside the half width */
const LANE_W=3.6,EDGE_IN=.55;
/* city streets have a curb (CURB_H high) and a sidewalk (SWW wide) each side instead of a gravel shoulder */
const CURB_H=.15,SWW=3.6;
function laneInfo(hw,style){const div=style==1||style==4,x0=div?1.35:.2,nl=Math.max(1,Math.round((hw-EDGE_IN-x0)/LANE_W));return{x0,nl,lw:(hw-EDGE_IN-x0)/nl,div}}
