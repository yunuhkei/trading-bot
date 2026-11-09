'use strict';
/* ===== damage: crash energy -> five zones (front, rear, left, right, roof) -> effects on the driving, dents in the real car mesh, a small health display ===== */
/* Every impact in IMP (40_car.js) carries its energy in joules and the zone that took it. A zone is destroyed by DZ_CAP joules (a sedan at 24 m/s into a parked car is 182 kJ, into a wall about 400 kJ).
   Effects (all are exactly 1 / 0 on an undamaged car, so the driving feel is untouched until you crash): front = less power and top speed, engine smoke, then fire; rear = nitro leak and a little power; left/right = the car pulls
   towards the damaged side; roof = a little top speed (body flex). Dents: the vertices of the car body near the contact are pushed in along the direction of the hit and crumpled (position, normal, colour) on the CPU, then the
   body buffer is uploaded (105 kB, only when something was hit). Repair puts the pristine buffer back. */
const DZ_CAP=[650e3,520e3,420e3,420e3,320e3];
const DZ_NAME=['front','rear','left','right','roof'];
const DMG={z:[0,0,0,0,0],hp:1,wrecked:0,spd:1,acc:1,pull:0,leak:0,cur:0,scale:1,minE:8000,pend:[],pendT:0,dentN:0,pf16:null,pi8:null,pris:null,ready:0,fire:0,total:0,lastHit:-9,dirty:0};
function dmgInit(){const B=CARM.body;if(!B||!B.ab)return;DMG.pris=new Uint8Array(B.ab.slice(0));DMG.pf16=new Int16Array(DMG.pris.buffer);DMG.pi8=new Int8Array(DMG.pris.buffer);
  B.f16=new Int16Array(B.ab);B.i8=new Int8Array(B.ab);B.u8=new Uint8Array(B.ab);B.nv=B.ab.byteLength/16;DMG.ready=1;DMG.cur=IMP.n}
function dmgHp(){const z=DMG.z;return 1-(.32*z[0]+.22*z[1]+.17*z[2]+.17*z[3]+.12*z[4])}
function dmgEffects(){const z=DMG.z,f=z[0],r=z[1];DMG.hp=dmgHp();
  DMG.spd=Math.max(.4,1-.40*f-.10*r-.08*z[4]);DMG.acc=Math.max(.35,1-.45*f-.15*r);DMG.pull=(z[3]-z[2])*.30;DMG.leak=r>.2?.06*r:0;DMG.fire=f>.82?1:0;
  DMG.wrecked=(f>=1||r>=1||DMG.hp<=.16)?1:0}
function dmgReset(){DMG.z.fill(0);DMG.pend.length=0;DMG.cur=IMP.n;dmgEffects();DMG.wrecked=0;DMG.total=0;
  if(DMG.ready&&DMG.dirty){const B=CARM.body;new Uint8Array(B.ab).set(DMG.pris);dentUpload();DMG.dirty=0}}
/* read the new impacts and turn them into damage */
function dmgConsume(){
  if(IMP.n===DMG.cur)return;const q=IMP.q,k=Math.min(IMP.n-DMG.cur,q.length);
  for(let i=q.length-k;i<q.length;i++)dmgApply(q[i]);DMG.cur=IMP.n;dmgEffects()}
function dmgApply(r){
  let E=r.E*DMG.scale;if(r.src==2){if(r.vn<11)return;E=r.E*.55}else if(r.vn<3.5||E<DMG.minE)return;     /* scrapes do nothing; a landing only hurts above 11 m/s */
  const z=DMG.z;let zone=r.zone;
  if(r.src==2){/* the suspension bottoms out: the axles and the roof take it */z[0]+=E*.3/DZ_CAP[0];z[1]+=E*.3/DZ_CAP[1];z[4]+=E*.4/DZ_CAP[4];zone=4}
  else if(zone>=0){z[zone]+=E/DZ_CAP[zone];
    /* a hit also shakes the neighbours */const sp=E*.14;if(zone<2){z[2]+=sp/DZ_CAP[2];z[3]+=sp/DZ_CAP[3]}else{z[0]+=sp/DZ_CAP[0];z[1]+=sp/DZ_CAP[1]}}
  for(let i=0;i<5;i++)if(z[i]>1)z[i]=1;DMG.total+=E;DMG.lastHit=C.t;
  DMG.pend.push(r);if(DMG.pend.length>12)DMG.pend.shift()}
/* the dents are applied at once for a big hit and at most every 0.2 s for a run of small ones */
function dmgDents(dt){if(!DMG.ready||!DMG.pend.length)return;DMG.pendT-=dt;let big=false;for(const r of DMG.pend)if(r.E>25000)big=true;if(!big&&DMG.pendT>0)return;DMG.pendT=.2;
  for(const r of DMG.pend)dentFromImpact(r);DMG.pend.length=0;dentUpload()}
function dentFromImpact(r){
  const sy=Math.sin(C.yaw),cy=Math.cos(C.yaw);let cx,cy2,cz,dx,dy,dz;
  if(r.src==2){cx=0;cy2=1.2;cz=0;dx=0;dy=-1;dz=0}
  else{/* crush direction = the way the other body pushed the car (the contact normal), in model coordinates (x right, z backwards) */
    const nf=r.nx*sy+r.nz*-cy,nr=r.nx*cy+r.nz*sy,l=Math.hypot(nf,nr)||1;dx=nr/l;dy=0;dz=-nf/l;
    /* where: the point on the car's box in the direction the other body came from */
    let lf,lr;if(r.src==3){const px=r.x-C.x,pz=r.z-C.z;lf=px*sy+pz*-cy;lr=px*cy+pz*sy}else{lf=-(nf/l)*3;lr=-(nr/l)*3}
    const k=Math.max(Math.abs(lr)/.95,Math.abs(lf)/2.2,1e-3);cx=lr/k;cz=-lf/k;cy2=.55}
  dentApply(cx,cy2,cz,dx,dy,dz,Math.max(r.E*DMG.scale,12000))}
function dentApply(cx,cy,cz,dx,dy,dz,E){
  const B=CARM.body,f=B.f16,i8=B.i8,u8=B.u8,pf=DMG.pf16,pn=DMG.pi8,nv=B.nv,sig=.32+.5*Math.min(1,Math.sqrt(E/220e3)),s2=2*sig*sig,R2=(2.4*sig)*(2.4*sig),depth=Math.min(.34,.07+.30*Math.sqrt(E/260e3)),hit=++DMG.dentN;
  for(let v=0;v<nv;v++){const o=v*8,px=pf[o]/8192,py=pf[o+1]/8192,pz=pf[o+2]/8192,ex=px-cx,ey=py-cy,ez=pz-cz,d2=ex*ex+ey*ey+ez*ez;if(d2>R2)continue;
    const nb=v*16+8,w=Math.exp(-d2/s2),hv=trHash(((px*911+py*577)*128)|0,(((pz*733)*128)|0)+hit),amt=depth*w*(.75+.5*hv);   /* a function of the vertex POSITION, so the duplicate vertices of a flat-shaded edge move together and no crack opens */
    let x=f[o]/8192+dx*amt,y=f[o+1]/8192+dy*amt,z=f[o+2]/8192+dz*amt;
    const mx=x-px,my=y-py,mz=z-pz,ml=Math.hypot(mx,my,mz);if(ml>.5){const s=.5/ml;x=px+mx*s;y=py+my*s;z=pz+mz*s}
    f[o]=Math.max(-32767,Math.min(32767,Math.round(x*8192)));f[o+1]=Math.max(-32767,Math.min(32767,Math.round(y*8192)));f[o+2]=Math.max(-32767,Math.min(32767,Math.round(z*8192)));
    /* crumple: the normal is shaken (so the dent catches the light), the paint scuffs */
    const a=trHash(v,hit*3+1)-.5,b=trHash(v,hit*3+2)-.5,c=trHash(v,hit*3+3)-.5,k=Math.min(1,w*1.4);
    let qx=i8[nb]/127+a*.8*k,qy=i8[nb+1]/127+b*.8*k,qz=i8[nb+2]/127+c*.8*k;const ql=Math.hypot(qx,qy,qz)||1;
    i8[nb]=Math.round(qx/ql*127);i8[nb+1]=Math.round(qy/ql*127);i8[nb+2]=Math.round(qz/ql*127);
    const sc=Math.min(.7,w*.8),cb=v*16+12;u8[cb]=u8[cb]*(1-sc)+52*sc;u8[cb+1]=u8[cb+1]*(1-sc)+46*sc;u8[cb+2]=u8[cb+2]*(1-sc)+42*sc}
  DMG.dirty=1}
function dentUpload(){const B=CARM.body;if(!B||!B.vb)return;const gl=G.gl;gl.bindBuffer(gl.ARRAY_BUFFER,B.vb);gl.bufferSubData(gl.ARRAY_BUFFER,0,new Uint8Array(B.ab))}
/* ---- smoke and fire from the engine ---- */
let _dmgCool=0;
function dmgFx(dt){
  const f=DMG.z[0];if(f<.3&&!DMG.wrecked)return;_dmgCool-=dt;
  const rate=DMG.fire||DMG.wrecked?.03:f>.6?.06:.12;
  while(_dmgCool<=0){_dmgCool+=rate;const s=SMOKE[smokeHead++%64],sy=Math.sin(C.yaw),cy=Math.cos(C.yaw);
    s.x=C.x+sy*1.5+cy*(Math.random()-.5)*.6;s.z=C.z-cy*1.5+sy*(Math.random()-.5)*.6;s.y=C.y+.8;s.vx=C.vx*.3+(Math.random()-.5)*.8;s.vz=C.vz*.3+(Math.random()-.5)*.8;s.vy=1.6+Math.random()*1.4;s.age=0;s.life=.9+Math.random()*.7;
    s.sz=.5+f*.6;s.a=.35+f*.3;s.fire=(DMG.fire||DMG.wrecked)&&Math.random()<.45?1:0;s.dark=1}}
/* ---- the small health display (a car seen from above, five zones, and a bar) ---- */
function dmgHud(c,x,y,u){
  const w=u*.52,h=u*1.12,r=w*.22,z=DMG.z,col=d=>{d=Math.min(1,d);const g=d<.5?[75+d*2*170,224,122-d*2*60]:[245,224-(d-.5)*2*160,62-(d-.5)*2*10];return'rgb('+(g[0]|0)+','+(g[1]|0)+','+(g[2]|0)+')'};
  c.save();c.translate(x,y);c.globalAlpha=.92;
  c.fillStyle='rgba(8,10,14,.55)';rr(c,-w*.6,-h*.58,w*1.2,h*1.16,r*1.4);c.fill();
  const part=(px,py,pw,ph,d)=>{c.fillStyle=col(d);rr(c,px,py,pw,ph,r*.6);c.fill()};
  part(-w/2,-h/2,w,h*.28,z[0]);part(-w/2,h/2-h*.28,w,h*.28,z[1]);part(-w/2,-h/2+h*.3,w*.28,h*.4,z[2]);part(w/2-w*.28,-h/2+h*.3,w*.28,h*.4,z[3]);part(-w*.2,-h/2+h*.3,w*.4,h*.4,z[4]);
  c.strokeStyle='rgba(255,255,255,.55)';c.lineWidth=1.2;rr(c,-w/2,-h/2,w,h,r);c.stroke();
  /* a bar to the right: the whole car */
  const bx=w*.85,bw=u*.14,bh=h,hp=Math.max(0,DMG.hp);c.fillStyle='rgba(0,0,0,.5)';c.fillRect(bx,-h/2,bw,bh);c.fillStyle=col(1-hp);c.fillRect(bx,h/2-bh*hp,bw,bh*hp);
  if(DMG.fire&&((C.t*6)|0)%2==0){c.fillStyle='#ff5a1a';c.beginPath();c.arc(0,-h/2-u*.14,u*.1,0,TAU);c.fill()}
  c.restore()}
