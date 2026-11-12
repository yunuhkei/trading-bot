'use strict';
/* ===== the Close Call cars, ported (batch 2) =====
   Close_Call.html describes each of its cars as a short table (its DZN designs): stations along the car [x, half width, height] in decimetres (front is +x), the ground clearance y0, the cabin
   [rear base x, front base x, rear roof x, front roof x, roof height, half width at the base, half width at the top], the wheels {fx, rx, r, w, hr (rim / tyre)}, the roof (rc: G glass, k black),
   open cars (op) and armoured ones (gl 0). ccBuild() turns a table into this game's car mesh: the same loft as Close Call (a monotone spline through the stations, a section with a flat top,
   a shoulder and a tucked sill, rounded nose and tail, the sill lifted over each wheel into an arch), a glass cabin with a body-colour, glass or black roof and dark pillars, lamps, a grille,
   plates and mirrors, and the game's own wheels; materials are this game's (CGM), so the cars take the same paint, glass and lights as the rest. About 1.5-2.5k triangles a body.
   They are used for traffic (60_traffic / 61_trafficgl) and as cars you can drive (added to the roster below, names marked CC: working names to be decided). */
const CC_DES={
 coupe:{n:'Pebble Coupe',ty:'coupe',col:[194,69,45],st:[[-24.3,5.6,6],[-22,7.8,7.2],[-18.4,9,8],[-15.5,9.6,8.2],[7.5,9.6,8.2],[13.5,9.3,7.6],[20,8.2,6.7],[24.3,5.8,5.9]],cb:[-15.5,7.5,-10.5,1.2,14.6,8.9,7.7],wh:{fx:14.2,rx:-14.2,r:3.9,w:1.8,hr:.62},hd:'r',tl:'r'},
 hyper:{n:'Lumen Hyper',ty:'hyper',col:[242,242,242],st:[[-28.3,5.5,4.4],[-26,8.8,5.6],[-21,10.8,6.5],[-12,11.1,7.2],[8,11.1,7.2],[16,10,5.8],[24,8.2,4.8],[28.3,5.5,4.2]],y0:2,cb:[-11,8,-6,2,11.2,8.6,5.6],rc:'G',wh:{fx:17.5,rx:-16.5,r:4.8,w:2.3,hr:.62},hd:'s',tl:'b'},
 gt:{n:'Longroad GT',ty:'gt',col:[31,63,143],st:[[-27.3,6.6,6.2],[-25,9,7.2],[-20.5,10.1,7.5],[2.5,10.1,7.5],[11,10,7],[21,9.1,6],[27.3,6.8,5.2]],y0:2.5,cb:[-19,2.5,-9,-1,13,9.3,7.4],wh:{fx:17,rx:-16,r:4.4,w:2,hr:.74},hd:'r',tl:'r'},
 super:{n:'Stiletto Super',ty:'super',col:[217,191,43],st:[[-27.3,8.4,6.8],[-23,10.6,8],[-16,10.6,8.2],[-8,10.6,6.4],[10,10.4,6.4],[16,9,4.6],[22,7,3.2],[27.3,3.6,2.6]],y0:1.7,cb:[-6,11,1,6,10.8,8.6,5.4],rc:'k',wh:{fx:18,rx:-17.5,r:[4.4,5],w:[2,2.7],hr:.6},hd:'s',tl:'s'},
 sport:{n:'Jackal Sport',ty:'sport',col:[214,54,43],st:[[-26.3,7.6,5.4],[-23.5,9.6,6.4],[-18,10.1,7],[-14,10.1,7.2],[-1,10.1,7.2],[8,10,6.6],[19,9.2,5.6],[26.3,6.4,4.6]],cb:[-14,-1,-11,-4.5,12.8,9.2,7.6],wh:{fx:16,rx:-15.5,r:4.3,w:2.1,hr:.66},hd:'s',tl:'b'},
 roadster:{n:'Halcyon Roadster',ty:'roadster',col:[47,159,214],st:[[-24.3,6.7,5.4],[-21.5,8.8,6.4],[-12.5,9.6,6.8],[10,9.6,6.8],[18,9,6.4],[24.3,6.9,5.6]],cb:[3.5,7.5,1,5,10.6,9.2,8.6],op:1,wh:{fx:14.5,rx:-14,r:4,w:1.7,hr:.82},hd:'r',tl:'r'},
 rally:{n:'Mudlark Rally',ty:'rally',col:[240,192,32],st:[[-20.3,7.2,6.4],[-18,9,7.8],[-9.5,9.1,8],[3,9.1,8],[10,9.1,7.4],[17,8.4,6.6],[20.3,6.9,6]],y0:3.4,cb:[-9.5,3,-7.5,.5,14.2,8.8,7.8],wh:{fx:12.5,rx:-12.5,r:4.5,w:2.1,hr:.55},hd:'r',tl:'r'},
 phantom:{n:'Umbra Turbo',ty:'hyper',col:[20,22,28],st:[[-28.3,7.5,4.8],[-24,11.1,5.4],[-14,11.1,5.6],[8,7.4,5.6],[14,5.6,4.8],[22,3.4,3.8],[28.3,1.6,3.2]],y0:1.8,cb:[-12,8,-6,3,9.8,5.6,3.2],rc:'k',wh:{fx:17.5,rx:-17,r:4.6,w:2.2,hr:.72},hd:'s',tl:'b'},
 n_cruiser:{n:'Parkway Cruiser',ty:'sedan',col:[174,182,189],st:[[-23.3,8.4,7.4],[-22,9.6,8.2],[-16,9.6,8.4],[-13,9.6,8.4],[5,9.6,8.4],[12,9.6,8.4],[19,9.4,8.2],[23.3,8.4,7.6]],cb:[-13,5,-10.5,1.5,15.2,9,8.1],wh:{fx:15,rx:-14.5,r:4.2,w:1.9,hr:.85},hd:'w',tl:'w'},
 n_magnet:{n:'Magnet Muscle',ty:'muscle',col:[47,159,214],st:[[-24.3,8.5,6.8],[-22.5,9.9,7.8],[-17,10.1,8.2],[0,10.1,8.2],[7,10.1,8.2],[16,9.8,8],[21.5,9.2,7.7],[24.3,8.2,6.8]],cb:[-15,0,-6,-1,12.8,9.5,7.5],wh:{fx:14.5,rx:-14.5,r:[4.2,4.8],w:[2,2.8],hr:.55},hd:'r',tl:'b'},
 n_courier:{n:'Fennec Hatch',ty:'hatch',col:[139,212,90],st:[[-19.3,7.8,7],[-18.2,9.1,8],[-17.5,9.1,8.4],[6,9.1,8.4],[8,9.1,8.4],[14,8.5,7.8],[19.3,6.6,6.2]],cb:[-17.5,6,-15.5,2,14.8,8.7,7.8],wh:{fx:12,rx:-11.5,r:3.9,w:1.9,hr:.6},hd:'w',tl:'r'},
 n_bruiser:{n:'Bruiser SUV',ty:'suv',col:[107,116,128],st:[[-24.3,11.2,9.4],[-18,11.6,9.8],[-14.5,11.6,9.8],[-14,11.6,11.8],[8,11.6,11.8],[10,11.6,11.4],[19,11.4,10.6],[24.3,10.4,10.2]],y0:4.4,cb:[-14,8.5,-13.6,8,19.4,11.2,10.8],wh:{fx:15.5,rx:-15.5,r:5.4,w:2.8,hr:.42},hd:'w',tl:'w'},
 n_drifter:{n:'Drifter Roadster',ty:'roadster',col:[240,138,36],st:[[-24.3,7.6,6.2],[-21.5,9.4,7],[-12,9.6,7.2],[10,9.6,7.2],[18.5,8.9,6.2],[24.3,6.7,5.2]],cb:[2.5,6.5,-1,2,11,9.2,8.6],op:1,wh:{fx:15,rx:-14.5,r:[4.2,4.6],w:[2.6,3],hr:.72},hd:'s',tl:'r'},
 n_nitro:{n:'Surge Sport',ty:'sport',col:[47,111,214],st:[[-26.3,8.2,6.6],[-22,10.1,7.6],[-14,10.1,7.8],[-6,10.1,7.4],[10,10.1,7.2],[16,9.5,5.4],[22,8,4.2],[26.3,6,3.6]],cb:[-6,10,-1.5,5.5,12.4,9.4,7.2],rc:'k',wh:{fx:17,rx:-16,r:[4.3,4.8],w:[2.2,3],hr:.62},hd:'s',tl:'b'},
 n_banker:{n:'Banker GT',ty:'gt',col:[31,63,143],st:[[-27.3,7.8,7],[-25,9.6,7.6],[-22,10.1,7.8],[-13,10.1,7.8],[3,10.1,7.8],[9,10.1,7.6],[20,9.4,6.8],[27.3,7.5,6]],cb:[-13,3,-11,-.5,15.8,9.4,8.4],rc:'G',wh:{fx:17,rx:-16.5,r:4.8,w:2,hr:.78},hd:'w',tl:'b'},
 n_mercury:{n:'Argent Super',ty:'super',col:[185,199,214],st:[[-27.3,6,5.4],[-24,9.4,6.8],[-17,10.6,7.8],[-8,10.6,7.6],[7,10.4,7.4],[15,9.8,5.6],[22,8,4.2],[27.3,5.5,3.4]],y0:2,cb:[-6,7,-1,3.5,10.8,8.8,5.8],rc:'G',wh:{fx:17.5,rx:-17,r:[4.4,5],w:[2,2.6],hr:.7},hd:'s',tl:'s'},
 h_outlaw:{n:'Outlaw',ty:'muscle',col:[90,60,40],st:[[-24.3,9,8],[-23,10.1,9],[-14,10.1,9.2],[6,10.1,9.2],[15,10,9],[21,9.7,8.2],[24.3,8.8,7.6]],y0:3,cb:[-13,2,-11.5,-.5,16.6,8.8,7.8],wh:{fx:15,rx:-14.5,r:[3.4,5.8],w:[1.3,3.4],hr:[.6,.35]},hd:'r',tl:'r'},
 h_jammer:{n:'Jammer Rally',ty:'rally',col:[106,77,214],st:[[-20.3,8,7],[-18.5,9.1,8.6],[-14,9.1,9],[5,9.1,9],[8,9.1,8.6],[14,8.8,8],[20.3,7.4,6.8]],y0:3.2,cb:[-14,5,-10,.5,14.2,8.4,7.2],wh:{fx:12.5,rx:-12.5,r:4.7,w:2.6,hr:.5},hd:'r',tl:'r'},
 h_warden:{n:'Warden SUV',ty:'suv',col:[58,74,58],st:[[-24.3,11.4,11],[-23,11.6,11.6],[6,11.6,11.6],[9,11.6,11.2],[20,11.4,10.6],[24.3,11,10.2]],y0:4,cb:[-21,5.5,-20.5,5,18.4,11.4,11],wh:{fx:15.5,rx:-15.5,r:5,w:2.7,hr:.5},hd:'w',tl:'w'},
 h_widow:{n:'Nightshade Super',ty:'super',col:[27,27,34],st:[[-27.3,8.2,4.6],[-26,10.4,4.8],[-22,10.6,5],[22,10.6,5],[25.5,10,4.2],[27.3,7.6,3.6]],y0:1.8,cb:[-6,6,-2.5,2,8.8,7.4,5.4],rc:'k',wh:{fx:18,rx:-17.5,r:[4.4,5],w:[2,2.7],hr:.55},hd:'s',tl:'b'},
 h_scorch:{n:'Scorch Roadster',ty:'roadster',col:[232,84,30],st:[[-24.3,6.8,6.2],[-21,8.8,7.2],[-12,9.6,7.4],[1,9.6,7.4],[5,8.6,7.2],[11,7,6.8],[19,6,6.2],[24.3,5,5.8]],cb:[-2,1.5,-4,0,11,9,8.4],op:1,wh:{fx:16.5,rx:-14.5,r:[3.4,5.4],w:[1.2,3.4],hr:.6},hd:'r',tl:'r'},
 h_reaper:{n:'Reaper Hyper',ty:'hyper',col:[122,16,34],st:[[-28.3,6,5],[-26,9.8,6.2],[-21,11.1,6.8],[-14,10,6.6],[-9,9,6.4],[5,9,6.4],[17,9.9,4.8],[25,8.4,3.8],[28.3,5,3.4]],y0:2,cb:[-9,5,-5,0,11,7,4.4],rc:'k',wh:{fx:17.8,rx:-17.5,r:[4.6,5.2],w:[2.2,2.8],hr:.5},hd:'s',tl:'b'},
 h_wraith:{n:'Nightjar GT',ty:'gt',col:[75,79,92],st:[[-27.3,8.6,7.6],[-25.5,10.1,8],[2.5,10.1,8],[9,9.9,7.2],[19,8.8,6.2],[27.3,6.2,5.2]],cb:[-26,2.5,-25,-1.5,12.6,9.7,8.9],wh:{fx:17,rx:-16.5,r:4.4,w:2,hr:.75},hd:'r',tl:'w'},
 h_hellfire:{n:'Cinder Hyper',ty:'hyper',col:[42,13,13],st:[[-28.3,8.4,5.6],[-25,10.4,6.8],[-17,11.1,7.4],[-9,11.1,7.2],[6.5,11.1,7.2],[17,10.8,5.4],[25,9.6,4.6],[28.3,7.6,4.1]],y0:2.2,cb:[-9,6.5,-4,1.5,11.4,8.6,6],rc:'k',wh:{fx:17.8,rx:-17,r:[4.8,5.2],w:[2.6,3.2],hr:.58},hd:'s',tl:'b'},
 /* road-only designs */
 t_bus:{n:'City bus',ty:'bus',col:[232,232,232],st:[[-53.3,10.4,8.6],[-52,11.6,9.4],[-47,11.6,9.6],[47,11.6,9.6],[52,11.6,9.4],[53.3,10.2,8.8]],y0:3,cb:[-51.5,49.5,-50,45.5,30,11.4,11.2],wh:{fx:36,rx:-33,r:5.2,w:2.4,hr:.55},hd:'w',tl:'w',bus:1},
 t_cop:{n:'Police cruiser',ty:'sedan',col:[35,39,47],st:[[-23.3,8.4,7],[-22,9.6,7.8],[-16,9.6,8],[-12,9.6,8],[6,9.6,8],[13,9.6,8],[19,9.4,7.8],[23.3,8.4,7.2]],cb:[-12,6,-9.5,2,14.4,9,7.8],rc:'k',wh:{fx:15,rx:-14.5,r:4.1,w:1.9,hr:.7},hd:'w',tl:'w'}};
/* the section of the body (right half) from the top centre to the sill, as in Close Call (hqSec): flat-ish top, shoulder, widest point, tucked sill. Catmull-Rom, k samples a span. */
function ccCR(P,k){const n=P.length,Q=[],G=i=>i<0?[-P[1][0],P[1][1]]:i>=n?[2*P[n-1][0]-P[n-2][0],2*P[n-1][1]-P[n-2][1]]:P[i];
  for(let i=0;i<n-1;i++){const p0=G(i-1),p1=P[i],p2=P[i+1],p3=G(i+2);for(let s=0;s<k;s++){const t=s/k,t2=t*t,t3=t2*t,f=a=>.5*(2*p1[a]+(-p0[a]+p2[a])*t+(2*p0[a]-5*p1[a]+4*p2[a]-p3[a])*t2+(-p0[a]+3*p1[a]-3*p2[a]+p3[a])*t3);Q.push([f(0),f(1)])}}
  Q.push(P[n-1].slice());return Q}
/* (this game's version: the whole crown rises with the fenders over each wheel, so the bonnet never sinks between two raised fenders or shows the wheel through it; the shoulder and the sill are rounder) */
function ccSec(w,hc,bp,yb,k){const top=hc+bp,r2=Math.min(3.4,Math.max(.25,(top-yb)*.48));return ccCR([[0,hc+bp*.92],[w*.42,hc+bp*.95],[w*.7,hc+bp-.05],[w*.88,top-r2*.45],[w*.985,top-r2*1.15],[w,(yb+top)/2+.1],[w*.975,yb+Math.min(1.4,(top-yb)*.24)],[w*.9,yb+.03]],k)}
/* build a car from a design: returns {S (the spec the game reads: sizes, axles, lights), body, wheelF, wheelR} in the generator's frame (metres, x right, y up, front at -z) */
function ccBuild(key,opt){
  opt=opt||{};const d=CC_DES[key],K=.1,st=d.st,y0=d.y0||2.6,lo=!!opt.lo,body=new CGB();
  const fw=cgCurve(st.map(s=>[s[0],s[1]])),fh=cgCurve(st.map(s=>[s[0],s[2]])),xe0=st[0][0],xe1=st[st.length-1][0],xc=(xe0+xe1)/2,rl=Math.min(d.bus?2.4:4.6,(xe1-xe0)*.09);
  const Z=x=>-(x-xc)*K,ar=(v,i)=>Array.isArray(v)?v[i]:v,W=d.wh,WL=[0,1].map(i=>{const x=i?W.rx:W.fx,r0=ar(W.r,i),top=fh(x),R=Math.max(2.6,Math.min(r0,(top+3.2-1.05)/2));return{x,R,w:ar(W.w,i),hr:ar(W.hr||.6,i),ra:R+.5,bump:Math.max(0,2*R+1.05-top)}});
  /* the fenders rise over the wheels where a tyre would stand above the bodywork (Close Call's hqWI) */
  const bump=x=>{let b=0;for(const q of WL){const t=Math.abs(x-q.x)/(q.ra+2.1);if(t<1)b=Math.max(b,q.bump*Math.pow((1+Math.cos(Math.PI*t))/2,1.25))}return b};
  /* rows along the car: an even spacing, more round the wheel arches and at the rounded ends */
  const X=[],step=d.bus?6:lo?3.2:2.2;for(let x=xe0;x<xe1;x+=step)X.push(x);X.push(xe1);
  for(let k=0;k<=(lo?4:8);k++){const t=Math.sin(k/(lo?4:8)*1.5708);X.push(xe1-rl+rl*t,xe0+rl-rl*t)}
  for(const q of WL){const n=lo?6:10;for(let k=0;k<=n;k++)X.push(q.x+q.ra*Math.cos(k/n*Math.PI));X.push(q.x-q.ra-.05,q.x+q.ra+.05)}
  X.sort((a,b)=>a-b);const XS=[];for(let x of X){x=Math.max(xe0,Math.min(xe1,x));if(!XS.length||x-XS[XS.length-1]>.04)XS.push(x)}
  const rows=[],kk=lo?2:3;
  for(const x of XS){let sp=1;if(x>xe1-rl){const t=(x-(xe1-rl))/rl;sp=Math.pow(Math.max(0,1-t*t*t),1/3)}else if(x<xe0+rl){const t=(xe0+rl-x)/rl;sp=Math.pow(Math.max(0,1-t*t*t),1/3)}
    const w=Math.max(.05,fw(x)*sp),hc0=fh(x),hc=hc0-(hc0-y0)*.42*Math.pow(1-sp,1.6),bp=bump(x)*Math.min(1,sp*1.6);let yb=y0;   /* (the fender keeps its height into the rounded nose and tail, so a wheel near the end never pokes through) */
    for(const q of WL){const dx=x-q.x;if(Math.abs(dx)<=q.ra+1e-6)yb=Math.max(yb,Math.min(q.R+Math.sqrt(Math.max(0,q.ra*q.ra-dx*dx)),hc+bp-.55))}yb=Math.min(yb,hc+bp*.92-.8);   /* the arch never cuts above the middle of the bonnet (it used to, over a low nose, and the dark underbody showed through the bonnet) */
    const sec=ccSec(w,hc,bp,yb,kk),L=sec.slice(1).reverse().map(p=>[-p[0],p[1]]);rows.push({x,hc:hc+bp,yb,w,ring:L.concat(sec)})}
  /* the body skin: paint, darker towards the sill (the shade S: under .4 is read as the dark lower body by the traffic) */
  const ni=rows.length,nj=rows[0].ring.length,P=new Float32Array(ni*nj*3),ctr=new Float32Array(ni*3);
  rows.forEach((r,i)=>{ctr[i*3+1]=Math.min(r.yb,(y0+r.hc)/2)*K;   /* the point the normals face away from: low in the section (over a wheel the section's bottom is high up, and normals on the bonnet used to point down) */ctr[i*3+2]=Z(r.x);r.ring.forEach((p,j)=>{const o=(i*nj+j)*3;P[o]=p[0]*K;P[o+1]=p[1]*K;P[o+2]=Z(r.x)})});
  const Nn=cgGridNormals(P,ni,nj,false,ctr),ids=[];
  const half=(nj-1)/2;for(let i=0;i<ni;i++){const row=[],r=rows[i];for(let j=0;j<nj;j++){const o=(i*nj+j)*3,kk2=Math.abs(j-half),low=P[o+1]/K<y0+1.6,sh=low&&kk2>=half-.5?.32:low&&kk2>=half-1.5?.7:1;   /* only the sill low on the car is dark (over a wheel the section's bottom is high up: it stays paint) */row.push(body.v(P[o],P[o+1],P[o+2],Nn[o],Nn[o+1],Nn[o+2],CGM.paint,sh))}ids.push(row)}
  for(let i=0;i<ni-1;i++)for(let j=0;j<nj-1;j++)body.q(ids[i][j],ids[i+1][j],ids[i+1][j+1],ids[i][j+1]);
  /* nose and tail caps, the underbody (it follows the sill, so it rises into each wheel arch) */
  for(const[i,sg]of[[0,1],[ni-1,-1]]){const r=rows[i],c=body.v(0,(r.yb+r.hc)/2*K,Z(r.x),0,0,sg,CGM.paint,.9);for(let j=0;j<nj-1;j++){const a=(i*nj+j)*3,b=(i*nj+j+1)*3,va=body.v(P[a],P[a+1],P[a+2],0,0,sg,CGM.paint,.9),vb=body.v(P[b],P[b+1],P[b+2],0,0,sg,CGM.paint,.9);body.t(c,va,vb)}}
  /* the underbody: flat at the ground clearance (it used to follow the arches up and could show through a low bonnet) */
  for(let i=0;i<ni-1;i++){const p=(ii,j)=>{const o=(ii*nj+j)*3;return body.v(P[o]*.97,y0*K,P[o+2],0,-1,0,CGM.under)};body.q(p(i,0),p(i,nj-1),p(i+1,nj-1),p(i+1,0))}
  /* the cabin */
  const cb=d.cb;let roofH=Math.max(...st.map(s=>s[2])),cowlX=xe1,roofRX=xe0;
  if(cb&&d.op){/* open car: a framed windscreen and a dark cockpit sunk into the deck */const[x0,x1,t0,t1,H,wb,wt]=cb,g1=fh(x1)-.1;
    const q=[[-wb,g1,x1],[wb,g1,x1],[wt,H,t1],[-wt,H,t1]].map(p=>body.v(p[0]*K,p[1]*K,Z(p[2]),0,.6,-.8,CGM.glass));body.q(q[0],q[1],q[2],q[3]);
    for(const sd of[-1,1])cgBox(body,sd*(wb+wt)/2*K,(g1+H)/2*K,(Z(x1)+Z(t1))/2,.025,(H-g1)/2*K,.03,CGM.gloss,0);
    const c0=x0-13,c1=x0+.3,cm=(c0+c1)/2;cgBox(body,0,(fh(cm)+.05)*K,Z(cm),fw(cm)*.68*K,.035,(c1-c0)/2*K,CGM.inter,0);
    for(const sd of[-1,1])cgBox(body,sd*fw(cm)*.33*K,(fh(cm)+2.2)*K,Z(c0+3),.2,.24,.05,CGM.inter,0);roofH=H;cowlX=x1;roofRX=c0}
  else if(cb){const[x0,x1,t0,t1,H,wb,wt]=cb,Hr=H-.4,seg=(a,b,n,out)=>{for(let i=0;i<n;i++)out.push([a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n,a[2]])};
    const prof=[],A=[x0,fh(x0)-.15,0],B=[t0,Hr,1],C=[t1,Hr,2],D=[x1,fh(x1)-.15,2];const n=lo?2:4;seg(A,B,n,prof);seg(B,C,lo?3:5,prof);seg(C,D,n,prof);prof.push(D);
    const roofM=d.gl===0?CGM.paint:d.rc=='G'?CGM.glass:d.rc=='k'?CGM.gloss:CGM.paint,glassM=d.gl===0?CGM.paint:CGM.glass,cr=[],cc=new Float32Array(prof.length*3);
    prof.forEach(([xs,Hs,seg_],i)=>{const u=Math.max(0,Math.min(1,(xs-x0)/(x1-x0))),sp=Math.pow(Math.max(0,1-Math.pow(Math.abs(2*u-1),6)),.25),gb=fh(xs)-.15,wbR=wb*sp,wtR=wbR+(wt-wb)*sp*Math.max(0,Hs-gb)/Math.max(.01,Hr-gb),Hc=Math.max(gb,Hs);
      const half=[[0,Hc+.35],[wtR*.5,Hc+.3],[wtR*.82,Hc+.16],[wtR*.98,Hc-.18],[(wtR+wbR)/2,(Hc-.3+gb)/2],[wbR,gb]],ring=half.slice(1).reverse().map(p=>[-p[0],p[1]]).concat(half);cr.push({ring,seg:seg_,gb});cc[i*3+1]=(gb+Hc)/2*K;cc[i*3+2]=Z(xs);
      cr[i].P=ring.map(p=>[p[0]*K,p[1]*K,Z(xs)])});
    const mi=cr.length,mj=cr[0].ring.length,PP=new Float32Array(mi*mj*3);cr.forEach((r,i)=>r.P.forEach((p,j)=>{PP.set(p,(i*mj+j)*3)}));const NN=cgGridNormals(PP,mi,mj,false,cc),cid=[];
    for(let i=0;i<mi;i++){const row=[];for(let j=0;j<mj;j++){const o=(i*mj+j)*3,c=Math.abs(j-(mj-1)/2),top=cr[i].seg==1&&!(i>0&&cr[i-1].seg==0&&false);let m=glassM;
        if(c>=4)m=glassM;else if(c==3||c==2&&(cr[i].seg!=1))m=c==3?CGM.gloss:glassM;if(cr[i].seg==1&&c<=2)m=roofM;if(c==3)m=CGM.gloss;
        row.push(body.v(PP[o],PP[o+1],PP[o+2],NN[o],NN[o+1],NN[o+2],m))}cid.push(row)}
    for(let i=0;i<mi-1;i++)for(let j=0;j<mj-1;j++)body.q(cid[i][j],cid[i+1][j],cid[i+1][j+1],cid[i][j+1]);
    /* pillars: dark bars up the edges of the windscreen and the rear glass, mirrors at the base of the windscreen */
    for(const sd of[-1,1]){if(!d.bus)cgBox(body,sd*(wb+.6)*K,(fh(x1)+1.3)*K,Z(x1-1),.05,.035,.08,CGM.gloss,0)}
    roofH=H;cowlX=x1;roofRX=t0}
  /* lamps, indicators, grille, plates: they sit on the rounded nose and tail */
  const surf=(sg,lat)=>{const xe=sg>0?xe1:xe0,we=Math.max(.1,fw(sg>0?xe1-rl:xe0+rl)),u=Math.min(1,Math.abs(lat)/we),t=Math.pow(Math.max(0,1-u*u*u),1/3);return sg>0?xe-rl+rl*t:xe+rl-rl*t};
  const front=xe1-rl*.5,rear=xe0+rl*.5,wf=fw(front),wr=fw(rear),hf=fh(xe1-rl),hr=fh(xe0+rl),ly=y0+(hf-y0)*.66,ty=y0+(hr-y0)*.7;
  const lamp=(sg,lat,y,hx,hy,m)=>{const x=surf(sg,lat)+(sg>0?-.06:.06);cgBox(body,lat*K,y*K,Z(x),hx*K,hy*K,.05,m,0)};
  for(const s of[-1,1]){const hd=d.hd||'r',tl=d.tl||'r';
    if(hd=='s')lamp(1,s*wf*.62,ly+.4,wf*.22,.22,CGM.head);else if(hd=='w')lamp(1,s*wf*.64,ly,wf*.2,.55,CGM.head);else{lamp(1,s*wf*.72,ly,.55,.55,CGM.head);lamp(1,s*wf*.5,ly,.45,.45,CGM.head)}
    lamp(1,s*wf*.86,ly-.75,.4,.2,CGM.amber);
    if(tl!='b'){if(tl=='s')lamp(-1,s*wr*.66,ty,wr*.2,.22,CGM.tail);else if(tl=='w')lamp(-1,s*wr*.64,ty,wr*.18,.6,CGM.tail);else{lamp(-1,s*wr*.74,ty,.55,.55,CGM.tail);lamp(-1,s*wr*.52,ty,.5,.5,CGM.tail)}}}
  if((d.tl||'r')=='b')lamp(-1,0,ty,wr*.82,.24,CGM.tail);
  lamp(1,0,y0+(hf-y0)*.28,wf*.36,Math.max(.35,(hf-y0)*.12),CGM.grille);lamp(1,0,y0+1.5,1.6,.4,CGM.plate);lamp(-1,0,y0+1.7,1.6,.4,CGM.plate);
  if(d.bus){/* a bus: a dark band of side windows is in the cabin; add a destination board and doors on the right side */lamp(1,0,roofH-1.6,wf*.6,.7,CGM.amber);
    for(const xd of[xe1-6,xc-2])cgBox(body,(fw(xd)+.02)*K,(y0+12.5)*K,Z(xd),.01,.95,.55,CGM.gloss,0)}
  /* wheels: the game's own (tyre, rim, spokes, disc, caliper), one per axle; the track puts the tyre's outer face at the body side */
  const wl=WL.map(q=>{const R=q.R*K,w=Math.min(.34,q.w*K*1.1);return{R,w,rim:Math.max(.12,R*Math.min(.8,q.hr+.08)),tf:Math.max(.5,fw(q.x)*K-w*.75),z:Z(q.x)}});
  const lw=2,wF=cgWheel(wl[0].R,wl[0].w,wl[0].rim,5,'spoke',null,lw,1),wR=cgWheel(wl[1].R,wl[1].w,wl[1].rim,5,'spoke',null,lw,1);
  const L=(xe1-xe0)*K,Wd=2*Math.max(...st.map(s=>s[1]))*K,S={L,W:Wd,H:roofH*K,wb:(W.fx-W.rx)*K,fo:(xe1-W.fx)*K,fz:wl[0].z,rz:wl[1].z,rf:wl[0].R,rr:wl[1].R,wf:wl[0].w,wr:wl[1].w,tf:wl[0].tf,tr:wl[1].tf,
    cowl:(xe1-cowlX)*K,roofR:(xe1-roofRX)*K,roofF:(xe1-cowlX)*K+.3,zs:s=>-L/2+s,_parts:{},cc:key,
    _lights:{hx:wf*.62*K,hy:ly*K-.12,hz:Z(surf(1,wf*.62))-.02,tx:wr*.66*K,ty:ty*K-.12,tz:Z(surf(-1,wr*.66))+.02}};
  S.curves={half:s=>fw(xe1-s/K)*K};
  return{S,body,wheelF:wF,wheelR:wR}}
/* the low-poly far body of a design for the traffic (5 sections, TRSHAPE format: z front +, bottom, shoulder, roof, half widths) */
function ccFar(key){const d=CC_DES[key],K=.1,st=d.st,y0=(d.y0||2.6)*K,fw=cgCurve(st.map(s=>[s[0],s[1]])),fh=cgCurve(st.map(s=>[s[0],s[2]])),xe0=st[0][0],xe1=st[st.length-1][0],xc=(xe0+xe1)/2,cb=d.cb||[0,0,0,0,0,0,0],op=d.op;
  const xs=op?[xe1,xe1-(xe1-xe0)*.2,xe0+(xe1-xe0)*.5,xe0+(xe1-xe0)*.2,xe0]:[xe1,cb[1],cb[3],cb[2],cb[0],xe0].filter((v,i,a)=>i==0||Math.abs(v-a[i-1])>.5).sort((a,b)=>b-a);
  const sec=xs.map(x=>{const inR=!op&&x<=cb[3]+.01&&x>=cb[2]-.01,top=inR?cb[4]*K:fh(x)*K;return[(x-xc)*K,y0,fh(x)*K,top,fw(x)*K*.96,inR?cb[6]*K:fw(x)*K*.86]});
  return{gz:[(cb[0]-xc)*K,(cb[1]-xc)*K],wheel:(Array.isArray(d.wh.r)?d.wh.r[0]:d.wh.r)*K,sec}}
/* the Close Call cars you can drive: their working names end in "CC" (the final names are to be picked). The driving figures come from the kind of car each one is. */
const CC_REAL={coupe:{hp:260,kg:1300,drive:'FR',top:240,t100:5.8,lat:.92,brk:37},hyper:{hp:900,kg:1300,drive:'MR',top:350,t100:2.4,lat:1.25,brk:31},gt:{hp:600,kg:1700,drive:'FR',top:315,t100:3.5,lat:1.02,brk:35},
  super:{hp:640,kg:1450,drive:'MR',top:325,t100:2.9,lat:1.15,brk:32},sport:{hp:450,kg:1450,drive:'FR',top:300,t100:3.9,lat:1.05,brk:34},roadster:{hp:330,kg:1150,drive:'FR',top:260,t100:4.4,lat:1.0,brk:35},
  rally:{hp:380,kg:1350,drive:'AWD',top:250,t100:3.6,lat:1.0,brk:35},sedan:{hp:300,kg:1600,drive:'RWD',top:250,t100:5.5,lat:.9,brk:38},muscle:{hp:480,kg:1700,drive:'FR',top:280,t100:4.3,lat:.95,brk:37},
  hatch:{hp:230,kg:1250,drive:'AWD',top:240,t100:5.6,lat:.95,brk:36},suv:{hp:400,kg:2200,drive:'AWD',top:240,t100:5.3,lat:.85,brk:39}};
const CC_CLS={coupe:'Compact coupe',hyper:'Hypercar',gt:'Grand tourer',super:'Supercar',sport:'Sports coupe',roadster:'Roadster',rally:'Rally hatch',sedan:'Saloon',muscle:'Muscle car',hatch:'Hot hatch',suv:'Off-roader'};
for(const key of Object.keys(CC_DES)){const d=CC_DES[key];if(d.ty=='bus'||key=='t_cop')continue;const S=ccBuild(key,{lo:1}).S;
  CAR_ROSTER.push({id:'cc_'+key,name:d.n+' CC',cls:CC_CLS[d.ty]+'  (from Close Call, working name)',cc:key,paint:d.col.slice(),rim:[190,194,200],caliper:[205,28,28],
    spec:{L:S.L,W:S.W,H:S.H,wb:S.wb,cowl:S.cowl,roofR:S.roofR},real:Object.assign({},CC_REAL[d.ty])})}
/* the civilian traffic bodies ported from Close Call (TTYPES 10 and up): sizes from their bodies */
for(const k of['coupe','n_cruiser','n_magnet','n_courier','n_bruiser','n_banker','rally','h_warden','gt','h_outlaw']){const S=ccBuild(k,{lo:1}).S,ty=CC_DES[k].ty;
  TTYPES.push({n:'cc_'+k,cc:k,hl:S.L/2-.05,hw:S.W/2-.04,m:ty=='suv'?2100:ty=='hatch'?1150:1450,far:ty=='suv'?2:ty=='hatch'||ty=='rally'?1:0,v0:ty=='muscle'||ty=='gt'?1.05:1,civ:1})}
/* the police vehicles (TTYPES 20-22, batch 3): an interceptor on the Surge Sport body, a police SUV on the Bruiser, and a SWAT truck (a black armoured box). All get the livery, a light bar and a push bar. */
{const S1=ccBuild('n_nitro',{lo:1}).S,S2=ccBuild('n_bruiser',{lo:1}).S;
 TTYPES.push({n:'interceptor',cc:'n_nitro',cop:1,hl:S1.L/2-.05,hw:S1.W/2-.04,m:1700,far:0},{n:'police SUV',cc:'n_bruiser',cop:1,hl:S2.L/2-.05,hw:S2.W/2-.04,m:2600,far:2},{n:'SWAT truck',box:'swat',cop:1,hl:3.2,hw:1.2,m:9000,far:-1})}
TTYPES[4].cop=1;TTYPES[4].cc='t_cop';   /* the patrol car: Close Call's police cruiser body (it used to be the plain sedan) */
