'use strict';
/* ===== visible damage on the player's car: bonnet, boot lid, doors, bumpers and mirrors hang, flap, come off and bounce away; windows crack; lights die =====
   LOOKS ONLY. Nothing in this file is read by the driving code. The parts are runs of the car's index buffer (see cgParts in 70_carmesh.js); each is drawn with its own hinge matrix.
   What happens when depends on the five damage zones (DMG.z) plus a few random thresholds that change after every repair, so no two wrecks look the same:
   bonnet: lifts as the front is hurt, flutters at speed, may tear off; boot lid: the same for the rear; doors: hang open on the side that was hit, swing, may tear off;
   bumpers: sag and swing, then fall; mirrors: fold, then fly off; windows: cracks spread from the zones next to them; head and tail lights: go dark one side at a time. */
const PP=[];                      /* per part id 1..8: {d: definition from the generator, a: angle, v: angular speed, off: 1 once it has come off, side, min: latch broken, r: thresholds} */
const DEB=[];                     /* pieces that have come off and tumble on the road */
const PDM={cr:[0,0,0,0],head:[0,0],tail:[0,0],seed:1,n:0,zc:0};
const _ph=new Float32Array(16),_pq=new Float32Array(16),_pr=new Float32Array(16);
const _prn=k=>trHash(k*7919+PDM.seed*131,PDM.seed*17+k*3);
function partsInit(){
  PP.length=0;DEB.length=0;PDM.seed=(Math.imul(PDM.seed,1103515245)+12345)>>>0;PDM.n=0;PDM.cr=[0,0,0,0];PDM.head=[0,0];PDM.tail=[0,0];
  const defs=CARM.parts||{};
  for(let p=0;p<=8;p++)PP[p]={d:p?defs[p]||null:null,a:0,v:0,off:0,side:_prn(p+40)<.5?-1:1,min:0,r:[_prn(p*3),_prn(p*3+1),_prn(p*3+2)]}}
/* the hinge matrix of a part: pivot, axis, angle (+ a small drop for bumpers) */
function partHinge(out,k,a,drop){
  const P=PP[k],d=P.d,ax=d.a;let px=d.p[0];const py=d.p[1],pz=d.p[2];
  if(k==5||k==6){const bx=d.box,w=Math.max(Math.abs(bx[0]),Math.abs(bx[3]))*.86;px=P.side*w}
  const c=Math.cos(a),s=Math.sin(a);out.fill(0);out[15]=1;
  if(ax[0]){out[0]=1;out[5]=c;out[6]=s;out[9]=-s;out[10]=c}else{out[0]=c;out[2]=-s;out[5]=1;out[8]=s;out[10]=c}
  /* translation = pivot - R * pivot (+ drop) */
  out[12]=px-(out[0]*px+out[4]*py+out[8]*pz);out[13]=py-(out[1]*px+out[5]*py+out[9]*pz)-(drop||0);out[14]=pz-(out[2]*px+out[6]*py+out[10]*pz);return out}
/* how far a part can swing, per direction: [lowest, highest] angle */
/* (batch 23) on the road the parts hang but the car still looks drivable: the bonnet and the lid lift a little, the doors stand ajar, the bumpers sag a little; the full range is for the crash cam */
const _PROAD=[0,.28,.28,.42,.42,.2,.2,9,9];
function _plim(k,P){const L=_plim0(k,P);if(typeof CC!='undefined'&&CC.on)return L;const m=_PROAD[k];return[Math.max(L[0],-m),Math.min(L[1],m)]}
function _plim0(k,P){switch(k){case 1:return[0,1.1];case 2:return[-1,0];case 3:return[0,1.4];case 4:return[-1.4,0];case 5:return P.side>0?[0,.55]:[-.55,0];case 6:return P.side>0?[-.55,0]:[0,.55];case 7:return[-1.35,0];default:return[0,1.35]}}
/* where each part wants to be, from the damage so far */
function partTarget(k){
  const z=DMG.z,P=PP[k],r=P.r,sp=Math.min(1,C.speed/45);let t=0;
  switch(k){
   case 1:t=sstep(.2+.12*r[0],.85,z[0])*.95*(1-.1*sp);break;
   case 2:t=-sstep(.24+.12*r[0],.85,z[1])*.8;break;
   case 3:t=sstep(.18+.12*r[0],.9,z[3])*1.15*(1-.35*sp);break;
   case 4:t=-sstep(.18+.12*r[0],.9,z[2])*1.15*(1-.35*sp);break;
   case 5:t=P.side*sstep(.18+.12*r[0],.75,z[0])*.45;break;
   case 6:t=-P.side*sstep(.18+.12*r[0],.75,z[1])*.45;break;
   case 7:t=-(z[3]>.1+.2*r[0]?1.3:0);break;
   case 8:t=(z[2]>.1+.2*r[0]?1.3:0);break}
  /* a latch that broke in a hit holds the part a little open */
  if(P.min&&Math.abs(t)<P.min)t=P.min*Math.sign(P.min);
  return t}
/* an impact: kick the parts nearest the hit, and tear some off */
function partsHit(zone,E,src){
  if(!PP.length||src==2||zone<0)return;const z=DMG.z,kj=Math.min(1,E/200e3),big=E>40e3;
  const kick=(k,dir)=>{const P=PP[k];if(P&&P.d&&!P.off)P.v+=dir*(2+9*kj)*(.6+.8*_prn(k+(PDM.n++)))};
  const latch=(k,m)=>{const P=PP[k];if(P&&P.d&&!P.off&&big&&Math.abs(P.min)<Math.abs(m))P.min=m};
  const maybe=(k,cond)=>{const P=PP[k];if(P&&P.d&&!P.off&&cond&&(k>=7||(typeof CC!='undefined'&&CC.on)))partDetach(k)};   /* (batch 23: only mirrors come off on the road; the bonnet, lid, doors and bumpers hang, and come off only in the crash cam) */
  if(zone==0){kick(1,1);kick(5,PP[5].side);latch(1,.2);maybe(1,z[0]>.9||(E>300e3&&z[0]>.6));maybe(5,(z[0]>.55+.2*PP[5].r[1]&&E>60e3)||E>300e3||z[0]>.96);maybe(7+(PP[7].side>0?0:1),E>120e3&&_prn(PDM.n++)<.4)}
  else if(zone==1){kick(2,-1);kick(6,-PP[6].side);latch(2,-.2);maybe(2,z[1]>.9||(E>300e3&&z[1]>.6));maybe(6,(z[1]>.55+.2*PP[6].r[1]&&E>60e3)||E>300e3||z[1]>.96)}
  else if(zone==3){kick(3,1);latch(3,.14);maybe(3,z[3]>.85||(E>300e3&&z[3]>.7));maybe(7,E>25e3&&_prn(PDM.n++)<.55)}
  else if(zone==2){kick(4,-1);latch(4,-.14);maybe(4,z[2]>.85||(E>300e3&&z[2]>.7));maybe(8,E>25e3&&_prn(PDM.n++)<.55)}}
/* a part comes off: it keeps the car's motion (a little less), gets thrown, spins */
function partDetach(k){
  const P=PP[k];if(!P||!P.d||P.off)return;P.off=1;
  carPose(_pq,1,1);partHinge(_ph,k,P.a,Math.abs(P.a)*(k>=5&&k<=6?.1:0));M4.mul(_pr,_pq,_ph);
  const c=P.d.c,wx=_pr[0]*c[0]+_pr[4]*c[1]+_pr[8]*c[2]+_pr[12],wy=_pr[1]*c[0]+_pr[5]*c[1]+_pr[9]*c[2]+_pr[13],wz=_pr[2]*c[0]+_pr[6]*c[1]+_pr[10]*c[2]+_pr[14];
  const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw),rx=Math.cos(C.yaw),rz=Math.sin(C.yaw),rn=()=>_prn(k*11+(PDM.n++))*2-1;let ux=0,uy=3,uz=0,kk=.6;
  if(k==1){uy=6+3*Math.abs(rn());ux=-fx*3+rx*rn()*3;uz=-fz*3+rz*rn()*3;kk=.5}                                       /* the bonnet: up and back over the roof */
  else if(k==2){uy=5+2*Math.abs(rn());ux=fx*2+rx*rn()*3;uz=fz*2+rz*rn()*3;kk=.55}
  else if(k==3||k==4){const sg=k==3?1:-1;uy=2.5+Math.abs(rn())*2;ux=rx*sg*5;uz=rz*sg*5;kk=.7}
  else if(k==5){uy=2+Math.abs(rn())*2;ux=fx*4+rx*rn()*4;uz=fz*4+rz*rn()*4;kk=.8}
  else if(k==6){uy=2+Math.abs(rn())*2;ux=-fx*1+rx*rn()*4;uz=-fz*1+rz*rn()*4;kk=.8}
  else{uy=3;ux=rx*(k==7?1:-1)*4;uz=rz*(k==7?1:-1)*4;kk=.7}
  const R=[_pr[0],_pr[1],_pr[2],_pr[4],_pr[5],_pr[6],_pr[8],_pr[9],_pr[10]],sz=Math.max(P.d.box[3]-P.d.box[0],P.d.box[5]-P.d.box[2]);
  if(DEB.length>=10)DEB.shift();
  DEB.push({k,R,x:wx,y:wy,z:wz,vx:C.vx*kk+ux,vy:C.vy+uy,vz:C.vz*kk+uz,wx:rn()*7,wy:rn()*7,wz:rn()*7,t:0,rest:0,hr:Math.max(.1,Math.min(.35,sz*.12))});
  if(typeof sparkAt==='function')sparkAt(wx,wy,wz,0,0,10,6)}
function _rot(R,wx,wy,wz,dt){const w=Math.hypot(wx,wy,wz);if(w<1e-5)return;const a=w*dt,x=wx/w,y=wy/w,z=wz/w,c=Math.cos(a),s=Math.sin(a),t=1-c;
  const m=[t*x*x+c,t*x*y+s*z,t*x*z-s*y, t*x*y-s*z,t*y*y+c,t*y*z+s*x, t*x*z+s*y,t*y*z-s*x,t*z*z+c],o=R.slice();
  for(let col=0;col<3;col++)for(let r=0;r<3;r++)R[col*3+r]=m[r]*o[col*3]+m[3+r]*o[col*3+1]+m[6+r]*o[col*3+2]}
/* every frame: parts follow their targets on a spring, the pieces that came off fall and bounce, windows and lights follow the zones */
function partsStep(dt){
  if(!PP.length||!CARM.parts)return;const z=DMG.z,sp=Math.min(1,C.speed/45);
  for(let k=1;k<=8;k++){const P=PP[k];if(!P.d||P.off)continue;const tg=partTarget(k);
    let acc=(tg-P.a)*(k>=7?120:k>=5?90:60)-P.v*(k>=7?9:7.5);
    if(k<=4&&Math.abs(P.a)>.08)acc+=Math.sin(C.t*(14+k*3)+k)*sp*(k<=2?22:9);                            /* wind flutter */
    P.v+=acc*dt;P.a+=P.v*dt;
    const lim=_plim(k,P);if(P.a>lim[1]){P.a=lim[1];P.v=-Math.abs(P.v)*.2}else if(P.a<lim[0]){P.a=lim[0];P.v=Math.abs(P.v)*.2}}
  /* pieces on the road */
  for(let i=DEB.length-1;i>=0;i--){const d=DEB[i];d.t+=dt;if(d.t>19){DEB.splice(i,1);continue}if(d.rest)continue;
    d.vy-=20*dt;d.x+=d.vx*dt;d.y+=d.vy*dt;d.z+=d.vz*dt;const drag=Math.exp(-dt*.25);d.vx*=drag;d.vz*=drag;_rot(d.R,d.wx,d.wy,d.wz,dt);
    const g=groundAt(d.x,d.z,d.y+1.5)+d.hr;if(d.y<g){d.y=g;if(d.vy<-1.5)d.vy=-d.vy*.32;else d.vy=0;d.vx*=.86;d.vz*=.86;d.wx*=.7;d.wy*=.7;d.wz*=.7;
      if(Math.hypot(d.vx,d.vz)<.6&&Math.abs(d.vy)<.3&&d.t>.6){d.rest=1;d.vx=d.vz=d.vy=0}}}
  /* windows: cracks from the zone beside them; the roof adds to all */
  const cr=PDM.cr;cr[0]=sstep(.08,.95,z[0]*.9+z[4]*.4);cr[1]=sstep(.08,.95,z[1]*.9+z[4]*.4);cr[2]=sstep(.1,1,z[2]+z[4]*.3);cr[3]=sstep(.1,1,z[3]+z[4]*.3);if(!(typeof CC!='undefined'&&CC.on))for(let i=0;i<4;i++)cr[i]=Math.min(cr[i],.45);   /* (batch 23: on the road the glass is cracked, never shattered) */
  /* lights go out one side at a time; they are in the bumper, so they leave with it */
  PDM.head[0]=z[0]>.38+.25*PP[1].r[1]||PP[5].off?1:0;PDM.head[1]=z[0]>.5+.25*PP[1].r[2]||PP[5].off?1:0;PDM.tail[0]=z[1]>.38+.25*PP[2].r[1]||PP[6].off?1:0;PDM.tail[1]=z[1]>.5+.25*PP[2].r[2]||PP[6].off?1:0}
function partsReset(){partsInit()}
/* ---- drawing ---- */
function _scaleCols(o,s){for(let i=0;i<12;i++)o[i]*=s}
/* the parts of the car: base run, then every part still on the car with its hinge; glass=true draws the glass runs (the doors carry their windows) */
function partsDrawCar(mf,sc,glass){
  const B=CARM.body,runs=glass?B.gpr:B.pr;if(!runs)return;
  for(let i=0;i<16;i++)_pr[i]=mf[i];_scaleCols(_pr,sc);
  if(runs[0].n)drawCarMesh(B,_pr,runs[0].n,runs[0].f);
  for(let k=1;k<=8;k++){const P=PP[k],r=runs[k];if(!r||!r.n||!P||!P.d||P.off)continue;
    partHinge(_ph,k,P.a,k==5||k==6?Math.abs(P.a)*.1:0);M4.mul(_pq,mf,_ph);_scaleCols(_pq,sc);drawCarMesh(B,_pq,r.n,r.f)}
  /* the pieces lying on the road */
  for(const d of DEB){const r=runs[d.k];if(!r||!r.n)continue;const c=CARM.parts[d.k].c,R=d.R,s=d.t>17.5?Math.max(0,(19-d.t)/1.5):1,o=_pq;
    o[0]=R[0]*sc*s;o[1]=R[1]*sc*s;o[2]=R[2]*sc*s;o[3]=0;o[4]=R[3]*sc*s;o[5]=R[4]*sc*s;o[6]=R[5]*sc*s;o[7]=0;o[8]=R[6]*sc*s;o[9]=R[7]*sc*s;o[10]=R[8]*sc*s;o[11]=0;
    o[12]=d.x-s*(R[0]*c[0]+R[3]*c[1]+R[6]*c[2]);o[13]=d.y-s*(R[1]*c[0]+R[4]*c[1]+R[7]*c[2]);o[14]=d.z-s*(R[2]*c[0]+R[5]*c[1]+R[8]*c[2]);o[15]=1;drawCarMesh(B,o,r.n,r.f)}}
