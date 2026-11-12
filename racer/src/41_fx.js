'use strict';
/* ===== effects: shadow blob, skid marks, smoke, tyre spray, sparks, and the lights (glow sprites, headlight beams, light pools, sirens) ===== */
/* Everything is camera-facing or ground-lying quads written into one dynamic buffer and drawn in batches (one draw per mode): alpha-blended (shadow, skids, pads, smoke/spray), then additive
   (light pools and beams, glows, sparks). The number of glows, pools and particles scales with the graphics tier (GFX.cur). */
const SKID=[],SKMAX=240;let skidHead=0;
const SMOKE=[];for(let i=0;i<160;i++)SMOKE.push({x:0,y:0,z:0,vx:0,vy:0,vz:0,age:9,life:1,sz:1,a:0,k:0,id:i});let smokeHead=0;
const SPARK=[];for(let i=0;i<96;i++)SPARK.push({x:0,y:0,z:0,vx:0,vy:0,vz:0,age:9,life:1});let sparkHead=0,_spCur=0;
const lastSk=[[0,0,0,0],[0,0,0,0]];let skCool=0,spCool=0;
/* where the lights are on the car model (read from the baked mesh: the emissive material): x right, y up, z backwards, metres */
const CARL={hx:.34,hy:.25,hz:-2.16,tx:.43,ty:.35,tz:2.18},_lp=[0,0,0];
function sparkAt(x,y,z,nx,nz,n,sp){for(let i=0;i<n;i++){const s=SPARK[sparkHead++%SPARK.length],a=Math.random()*6.283,u=Math.random();s.x=x;s.y=y;s.z=z;const v=(sp||6)*(.35+u);
    s.vx=nx*v*.6+Math.cos(a)*v*.7;s.vz=nz*v*.6+Math.sin(a)*v*.7;s.vy=1.5+Math.random()*4;s.age=0;s.life=.25+Math.random()*.4}}
function fxUpdate(dt){
  const T=GFX.cur,q=T.fxq,sy=Math.sin(C.yaw),cy=Math.cos(C.yaw);
  /* tyre smoke + skid marks from the rear wheels while sliding */
  const act=C.grounded&&C.speed>10&&C.slip>.1&&(C.drift>.35||C.dActive);
  for(let w=0;w<2;w++){const sd=w?1:-1,px=C.x-sy*1.3+cy*sd*.8,pz=C.z+cy*1.3+sy*sd*.8;
    if(act){const L=lastSk[w];if(L[3]){const k=SKID[skidHead%SKMAX]=SKID[skidHead%SKMAX]||new Float32Array(8);k[0]=L[0];k[1]=L[1];k[2]=px;k[3]=pz;k[4]=C.y;k[5]=C.t;k[6]=Math.min(1,Math.max(C.drift,C.slip*3));skidHead++}L[0]=px;L[1]=pz;L[3]=1}else lastSk[w][3]=0}
  if(act||C.boosting){skCool-=dt;while(skCool<=0){skCool+=.035/Math.max(.5,q);const s=SMOKE[smokeHead++%SMOKE.length],sd=Math.random()<.5?-1:1;s.x=C.x-sy*1.4+cy*sd*.8;s.z=C.z+cy*1.4+sy*sd*.8;s.y=C.y+.25;s.vx=C.vx*.25+(Math.random()-.5)*1.5;s.vz=C.vz*.25+(Math.random()-.5)*1.5;s.vy=1+Math.random()*1.2;s.age=0;s.life=.9+Math.random()*.6;s.sz=.9;s.a=act?.5:.3;s.fire=!act;s.dark=0;s.k=0}}
  /* spray: the wet road is thrown up behind the tyres at speed (more when sliding) */
  if(C.grounded&&C.onRoad&&C.speed>13&&GFX.wet>.2){const sp=Math.min(1,(C.speed-13)/30);spCool-=dt;
    while(spCool<=0){spCool+=.045/Math.max(.4,q*(.5+sp));for(let w=0;w<2;w++){const sd=w?1:-1,s=SMOKE[smokeHead++%SMOKE.length];s.x=C.x-sy*1.3+cy*sd*.85;s.z=C.z+cy*1.3+sy*sd*.85;s.y=C.y+.12;s.vx=C.vx*.55+cy*sd*(.4+Math.random()*1.2)+(Math.random()-.5);s.vz=C.vz*.55+sy*sd*(.4+Math.random()*1.2)+(Math.random()-.5);s.vy=.5+Math.random()*1.4*(.5+sp);
        s.age=0;s.life=.5+Math.random()*.5;s.sz=.35+sp*.35;s.a=.12+.14*sp;s.fire=0;s.dark=0;s.k=1}}}
  for(const s of SMOKE){if(s.age<s.life){s.age+=dt;s.x+=s.vx*dt;s.y+=s.vy*dt;s.z+=s.vz*dt;s.vy*=Math.max(0,1-dt*(s.k?2.4:1.2));if(s.k){s.vx*=Math.max(0,1-dt*1.6);s.vz*=Math.max(0,1-dt*1.6)}}}
  /* sparks from the rims of burst tyres */
  if(C.flatT>0&&C.speed>4&&C.grounded&&Math.random()<.6){const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw),rx=Math.cos(C.yaw),rz=Math.sin(C.yaw),w=Math.random()<.5?-1:1,f=Math.random()<.5?1.3:-1.3;sparkAt(C.x+fx*f+rx*w*.8,C.y+.1,C.z+fz*f+rz*w*.8,-fx,-fz,1,3+C.speed*.1)}
  /* a stream of sparks while the car scrapes a guard rail */
  if(C.railT>0&&C.railP&&C.speed>3){const k=Math.min(3,1+C.speed/25)*q;for(let i=0;i<Math.round(k+Math.random()*.7);i++){const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw);sparkAt(C.railP[0]+fx*(Math.random()-.3)*2,C.y+.35,C.railP[1]+fz*(Math.random()-.3)*2,C.railP[2]-C.vx*.03,C.railP[3]-C.vz*.03,1,3+C.speed*.12)}}
  /* sparks from every new impact (walls, poles, other cars) */
  if(IMP.n!==_spCur){const k=Math.min(IMP.n-_spCur,IMP.q.length);for(let i=IMP.q.length-k;i<IMP.q.length;i++){const r=IMP.q[i];if(r.src==2||r.E<1500)continue;
      const n=Math.min(26,4+Math.round(Math.sqrt(r.E)/40));sparkAt(r.src==3?(r.x+C.x)/2:C.x-r.nx*1.2,C.y+.45,r.src==3?(r.z+C.z)/2:C.z-r.nz*1.2,r.nx||0,r.nz||0,Math.round(n*q),Math.min(14,2+r.vn*.7))}_spCur=IMP.n}
  for(const s of SPARK){if(s.age<s.life){s.age+=dt;s.vy-=14*dt;s.x+=s.vx*dt;s.y+=s.vy*dt;s.z+=s.vz*dt;if(s.y<C.gs+.03){s.y=C.gs+.03;s.vy*=-.3;s.vx*=.6;s.vz*=.6}}}
  /* damaged cars: smoke from the bonnet (more the worse), fire when nearly finished */
  if(TR.on){const q2=T.fxq;for(const c of TR.cars){if(!c.alive)continue;const dm=c.state==1?Math.max(c.dmg||0,.5):(c.dmg||0);if(dm<.45)continue;const dx=c.x-C.x,dz=c.z-C.z;if(dx*dx+dz*dz>22500)continue;
      c.smk=(c.smk||0)-dt;if(c.smk>0)continue;c.smk=(dm>.85?.05:dm>.65?.1:.2)/Math.max(.5,q2);const s=SMOKE[smokeHead++%SMOKE.length],sy2=Math.sin(c.yaw),cy2=Math.cos(c.yaw);
      s.x=c.x+sy2*c.hl*.7+(Math.random()-.5)*.5;s.z=c.z-cy2*c.hl*.7+(Math.random()-.5)*.5;s.y=c.y+.9;s.vx=(c.vx||0)*.3+(Math.random()-.5)*.7;s.vz=(c.vz||0)*.3+(Math.random()-.5)*.7;s.vy=1.4+Math.random()*1.3;s.age=0;s.life=1+Math.random()*.8;s.sz=.4+dm*.4;s.a=.22+dm*.2;s.fire=dm>.85&&Math.random()<.4;s.dark=1;s.k=0}}
  dmgFx(dt)}
function fxDraw(){
  const dayK=1-.78*Math.min(1,ENV.sunC[0]/2.6);                        /* lamp, head light and neon glows are for gloomy light: in bright sun they nearly vanish */
  const gl=G.gl,P=G.P.fx,F=R.fxF,T=GFX.cur,a=R.alpha;let n=0;
  const quad=(x0,y0,z0,x1,y1,z1,x2,y2,z2,x3,y3,z3,r,g,b,al,uo)=>{if(n>=R.fxMax)return;let o=n*36;uo=uo||0;
    F[o]=x0;F[o+1]=y0;F[o+2]=z0;F[o+3]=r;F[o+4]=g;F[o+5]=b;F[o+6]=al;F[o+7]=uo;F[o+8]=0;o+=9;
    F[o]=x1;F[o+1]=y1;F[o+2]=z1;F[o+3]=r;F[o+4]=g;F[o+5]=b;F[o+6]=al;F[o+7]=uo+1;F[o+8]=0;o+=9;
    F[o]=x2;F[o+1]=y2;F[o+2]=z2;F[o+3]=r;F[o+4]=g;F[o+5]=b;F[o+6]=al;F[o+7]=uo+1;F[o+8]=1;o+=9;
    F[o]=x3;F[o+1]=y3;F[o+2]=z3;F[o+3]=r;F[o+4]=g;F[o+5]=b;F[o+6]=al;F[o+7]=uo;F[o+8]=1;n++};
  const B=[];let bFrom=0,bMode=-1;const batch=m=>{if(bMode>=0&&n>bFrom)B.push(bMode,bFrom,n);bFrom=n;bMode=m};
  const x=C.x,z=C.z,sy=Math.sin(C.yaw),cy=Math.cos(C.yaw),rx=R.rt[0],rz=R.rt[2],ux0=R.up[0],uy0=R.up[1],uz0=R.up[2];
  /* a camera-facing square of half size s */
  const sprite=(px,py,pz,s,r,g,b,al,uo)=>quad(px-rx*s-ux0*s,py-uy0*s,pz-rz*s-uz0*s,px+rx*s-ux0*s,py-uy0*s,pz+rz*s-uz0*s,px+rx*s+ux0*s,py+uy0*s,pz+rz*s+uz0*s,px-rx*s+ux0*s,py+uy0*s,pz-rz*s+uz0*s,r,g,b,al,uo);
  /* a square lying on the ground (size s) */
  const flat=(px,py,pz,sx,sz2,r,g,b,al)=>quad(px-sx,py,pz-sz2,px+sx,py,pz-sz2,px+sx,py,pz+sz2,px-sx,py,pz+sz2,r,g,b,al);
  /* ---- alpha: blob shadow (the soft sun shadow replaces it where the tier has one), skid marks, garage pads, smoke and spray ---- */
  batch(0);
  const gy=C.gs+.04,L=2.6,Wd=1.35;quad(x+sy*-L-cy*Wd,gy,z+cy*L-sy*Wd,x+sy*-L+cy*Wd,gy,z+cy*L+sy*Wd,x+sy*L+cy*Wd,gy,z-cy*L+sy*Wd,x+sy*L-cy*Wd,gy,z-cy*L-sy*Wd,0,0,0,(GFX.shadowOn?.22:.5)/(1+Math.max(0,C.y-C.gs)*.4));
  {const L2=2.0,W2=.92;quad(x+sy*-L2-cy*W2,gy,z+cy*L2-sy*W2,x+sy*-L2+cy*W2,gy,z+cy*L2+sy*W2,x+sy*L2+cy*W2,gy,z-cy*L2+sy*W2,x+sy*L2-cy*W2,gy,z-cy*L2-sy*W2,0,0,0,.34/(1+Math.max(0,C.y-C.gs)*.8))}      /* a tight dark patch right under the body: the car sits on the road */
  trShadows(quad);heliFx(quad,flat,0);
  batch(2);heliFx(quad,flat,2);
  const nsk=Math.min(skidHead,SKMAX);for(let i=0;i<nsk;i++){const q=SKID[i],age=C.t-q[5];if(age>40)continue;const dx=q[2]-q[0],dz=q[3]-q[1],l=Math.hypot(dx,dz)||1,nx=-dz/l*.14,nz=dx/l*.14,y=q[4]+.05,al=.55*(1-age/40)*q[6];if(l>6)continue;
    quad(q[0]-nx,y,q[1]-nz,q[0]+nx,y,q[1]+nz,q[2]+nx,y,q[3]+nz,q[2]-nx,y,q[3]-nz,.02,.02,.02,al)}
  navFx(quad,sprite,R.time);
  batch(3);safePads(quad);
  batch(1);
  for(const s of SMOKE){if(s.age>=s.life||n>=R.fxMax)continue;const t=s.age/s.life,sz=s.sz+t*(s.k?1.3:s.dark?1.5:2.6),dc=Math.hypot(s.x-R.cx,s.y-R.cy,s.z-R.cz),al=s.a*(1-t)*(1-t)*(s.dark?sstep(4,14,dc):sstep(1.2,4,dc));if(al<.004)continue;const ux=R.up[0]*sz,uy=R.up[1]*sz,uz=R.up[2]*sz,hx=rx*sz,hz=rz*sz;
    let cr,cg,cb;if(s.k){cr=.62;cg=.68;cb=.74}else{const dk=s.dark&&!s.fire?.25:1;cr=(s.fire?1:.80)*dk;cg=(s.fire?.55-.4*t:.82)*dk;cb=(s.fire?.2:.86)*dk}
    quad(s.x-hx-ux,s.y-uy,s.z-hz-uz,s.x+hx-ux,s.y-uy,s.z+hz-uz,s.x+hx+ux,s.y+uy,s.z+hz+uz,s.x-hx+ux,s.y+uy,s.z-hz+uz,cr,cg,cb,al,s.id*3)}
  /* ---- additive: light pools and beams on the ground ---- */
  batch(5);
  const gcx=R.cx,gcz=R.cz,fwx=sy,fwz=-cy;
  const lampK=Math.max(T.glow,T.pool),nl=gfxNearLamps(x,z,300,lampK,fwx,fwz);
  const nPool=Math.min(nl,T.pool);
  for(let i=0;i<nPool;i++){const j=_lampPick[i],lx=LAMPS[j],ly=LAMPS[j+1]-6.95,lz=LAMPS[j+2];flat(lx,ly+.03,lz,7.5,7.5,1,.78,.45,.34*dayK)}
  heliFx(quad,flat,5);evFx(quad,flat,sprite,5);spotFx(flat,sprite,5);
  /* red and blue wash on the road round a police car with its siren on */
  if(TR.on)for(const c of TR.cars){if(!c.alive||!c.siren)continue;const px=lerp(c.px,c.x,a),pz=lerp(c.pz,c.z,a),dx=px-gcx,dz=pz-gcz;if(dx*dx+dz*dz>40000)continue;const ph=Math.sin(R.time*12)>0;flat(px,lerp(c.py,c.y,a)+.05,pz,11,11,ph?1:.12,ph?.1:.32,ph?.08:1,.42)}
  if(C.boostK>.04){const hx=sy,hz=-cy;flat(x-hx*3.4,C.gs+.04,z-hz*3.4,3+2*C.boostK,3+2*C.boostK,1,.62,.28,.5*C.boostK*(.4+.6*(1-dayK)))}
  batch(6);
  /* the car's headlights: a pool of light on the road ahead, wider the further it goes (uv runs across, then along: mode 6 is the beam shape) */
  {const hx=sy,hz=-cy,rxc=cy,rzc=sy,gy2=C.gs+.05,x0=x+hx*2.0,z0=z+hz*2.0,len=26;
   const lk=(1-.5*(PDM.head[0]+PDM.head[1]))*(TUM.on?0:1);if(lk>0)quad(x0-rxc*1.0,gy2,z0-rzc*1.0,x0+rxc*1.0,gy2,z0+rzc*1.0,x0+hx*len+rxc*6.5,gy2,z0+hz*len+rzc*6.5,x0+hx*len-rxc*6.5,gy2,z0+hz*len-rzc*6.5,1,.92,.7,.5*lk*dayK)}
  heliFx(quad,flat,6);
  /* beams of the cars that come at us */
  if(TR.on&&T.glow>30){let k=0;for(const c of TR.cars){if(!c.alive||k>=10)continue;const dx=c.x-x,dz=c.z-z,d2=dx*dx+dz*dz;if(d2>14400||d2<100)continue;const hx=Math.sin(c.yaw),hz=-Math.cos(c.yaw);
      if((x-c.x)*hx+(z-c.z)*hz<0)continue;k++;const px=lerp(c.px,c.x,a),pz=lerp(c.pz,c.z,a),py=lerp(c.py,c.y,a)+.06,x0=px+hx*(c.hl-.1),z0=pz+hz*(c.hl-.1),rr=-hz,rs=hx;
      quad(x0-rr*.8,py,z0-rs*.8,x0+rr*.8,py,z0+rs*.8,x0+hx*20+rr*5.5,py,z0+hz*20+rs*5.5,x0+hx*20-rr*5.5,py,z0+hz*20-rs*5.5,1,.92,.72,.32*dayK)}}
  /* ---- additive: glows ---- */
  batch(4);
  const SRN=[];let ng=0;const gMax=T.glow;
  /* lamp heads along the road, shrinking with distance but never to nothing, so a line of lights runs away into the haze */
  for(let i=0;i<nl&&ng<gMax;i++){const j=_lampPick[i],dx=LAMPS[j]-gcx,dy=LAMPS[j+1]-R.cy,dz=LAMPS[j+2]-gcz,d=Math.sqrt(dx*dx+dy*dy+dz*dz);if(dx*R.fw[0]+dy*R.fw[1]+dz*R.fw[2]<-2)continue;
    const s=.9+d*.012,al=Math.min(.95,1.25-d/330);if(al<=.02)continue;sprite(LAMPS[j],LAMPS[j+1]+.1,LAMPS[j+2],s,1,.78,.45,al*dayK);ng++}
  /* neon */
  for(let i=0;i<NEONS.length&&ng<gMax+24;i+=7){const nx=NEONS[i]-gcx,nz=NEONS[i+2]-gcz,d2=nx*nx+nz*nz;if(d2>56000)continue;if(nx*R.fw[0]+nz*R.fw[2]<-3)continue;const d=Math.sqrt(d2),fl=.82+.18*Math.sin(R.time*(3+(i%5))+i),al=Math.min(.95,1.15-d/240)*fl;
    sprite(NEONS[i],NEONS[i+1],NEONS[i+2],NEONS[i+6]*(.6+d*.006),NEONS[i+3],NEONS[i+4],NEONS[i+5],al*(.35+.65*dayK));ng++}
  navBeacon(sprite);spikeFx(sprite,SRN);evFx(quad,flat,sprite,4);spotFx(flat,sprite,4);
  /* the car's own lights */
  /* batch 6: the glows sit ON the lamps: model points put through the very matrix the car was drawn with (so they pitch, roll and tumble with it and are never a physics step behind), moved with the dents */
  {const M=CARM.mf,D=DMG.lampD,P=(bx,by,bz)=>{_lp[0]=M[0]*bx+M[4]*by+M[8]*bz+M[12];_lp[1]=M[1]*bx+M[5]*by+M[9]*bz+M[13];_lp[2]=M[2]*bx+M[6]*by+M[10]*bz+M[14];return _lp};
   for(const sd of[-1,1]){const si=sd<0?0:1;
     if(!PDM.head[si]){const q=P(sd*CARL.hx+D[si*3],CARL.hy+.05+D[si*3+1],CARL.hz-.02+D[si*3+2]);sprite(q[0],q[1],q[2],.36,1,.95,.75,.5*dayK)}
     if(!PDM.tail[si]){const q=P(sd*CARL.tx+D[6+si*3],CARL.ty+.05+D[7+si*3],CARL.tz+.02+D[8+si*3]);sprite(q[0],q[1],q[2],C.braking?.9:.45,1,.12,.07,C.braking?.9:.4)}}
   /* nitro: a jet of flame from each exhaust, a blue-white core fading through yellow to orange, flickering, longer the harder the boost */
   if(C.boostK>.04){const bk=C.boostK;for(const sd of[-1,1]){for(let i=0;i<10;i++){const fl=.78+.22*Math.sin(R.time*83+i*1.9+sd*2.3)+.1*Math.sin(R.time*131+i*3.1),d=(.1+i*.32)*(.6+.4*bk)*fl,sz=(.52-i*.043)*bk*(.85+.15*fl),t=i/9;
       const q=P(sd*.46,.33,CARL.tz+d);sprite(q[0],q[1],q[2],Math.max(.05,sz),.42+.58*Math.min(1,t*1.8),.62-.3*t,1-1.05*t,(.8-.07*i)*Math.min(1,bk*1.4))}}}}
  /* traffic: tail lights, headlights, the siren on a police car */
  if(TR.on){const fx=R.fw;for(const c of TR.cars){if(!c.alive)continue;if(c.air||Math.abs(c.roll)>.6||Math.abs(c.pitch)>.6)continue;   /* a car on its side or roof: its lights are not where an upright car's would be (and are mostly smashed) */const px=lerp(c.px,c.x,a),pz=lerp(c.pz,c.z,a),dx=px-gcx,dz=pz-gcz,d2=dx*dx+dz*dz;if(d2>62500||dx*fx[0]+dz*fx[2]<-6)continue;
      const d=Math.sqrt(d2),py=lerp(c.py,c.y,a),yaw=c.pyaw+angd(c.yaw,c.pyaw)*a,hx=Math.sin(yaw),hz=-Math.cos(yaw),rr=Math.cos(yaw),rs=Math.sin(yaw),k=1-d/250;if(k<=.02)continue;
      for(const sd of[-1,1]){const w=sd*c.hw*.68;
        sprite(px-hx*(c.hl-.12)+rr*w,py+.66,pz-hz*(c.hl-.12)+rs*w,(c.brake?.75:.45)+d*.004,1,.1,.06,(c.brake?.95:.55)*k);
        sprite(px+hx*(c.hl-.12)+rr*w,py+.62,pz+hz*(c.hl-.12)+rs*w,.5+d*.004,1,.93,.74,.5*k*dayK)}
      if(c.siren){const ph=Math.sin(R.time*12)>0;SRN.push(px+rr*(ph?-.45:.45),py+1.6,pz+rs*(ph?-.45:.45),2.6+d*.016,ph?1:.1,ph?.08:.3,ph?.06:1,Math.min(1,k*2.6))}}}
  /* police lights are drawn with plain blending (a saturated red or blue even against the bright sky), the other glows are added */
  /* traffic lights: the lit lamp of every head that faces the camera, within 220 m (plain blending, so red, yellow and green read in bright sun) */
  {let k=0;const H=SIG.heads,cx2=CAM.x,cz2=CAM.z;for(let i=0;i<H.length&&k<64;i+=7){const dx=H[i]-cx2,dz=H[i+2]-cz2,d2=dx*dx+dz*dz;if(d2>48400||dx*H[i+3]+dz*H[i+4]>0)continue;if(dx*R.fw[0]+dz*R.fw[2]<-3)continue;
    const I=SIG.I[H[i+5]],st=sigState({I,ph:H[i+6]}),d=Math.sqrt(d2),dy=st==2?.34:st==1?0:-.34,c=st==2?[1,.07,.04]:st==1?[1,.62,.04]:[.1,1,.45];SRN.push(H[i],H[i+1]+dy,H[i+2],.5+d*.011,c[0],c[1],c[2],Math.min(1,1.25-d/260));k++}}
  batch(8);for(let q=0;q<SRN.length;q+=8)sprite(SRN[q],SRN[q+1],SRN[q+2],SRN[q+3],SRN[q+4],SRN[q+5],SRN[q+6],SRN[q+7]);SRN.length=0;
  /* a lit garage door sign etc. could go here */
  batch(7);
  for(const s of SPARK){if(s.age>=s.life||n>=R.fxMax)continue;const t=s.age/s.life,sp=Math.hypot(s.vx,s.vy,s.vz)||1,l=Math.min(.7,sp*.045)+.05,w=.035*(1-t);
    /* a short streak along the velocity, seen from the camera */
    const dx=s.vx/sp*l,dy=s.vy/sp*l,dz=s.vz/sp*l,qx=-dz,qz=dx,ql=Math.hypot(qx,qz)||1;const px=qx/ql*w,pz=qz/ql*w;
    quad(s.x-px,s.y,s.z-pz,s.x+px,s.y,s.z+pz,s.x+dx*-1+px,s.y-dy,s.z+dz*-1+pz,s.x+dx*-1-px,s.y-dy,s.z+dz*-1-pz,1,.78-.4*t,.3,1-t)}
  batch(-1);
  if(!n)return;
  gl.useProgram(P.p);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);gl.bindBuffer(gl.ARRAY_BUFFER,R.fx);gl.bufferSubData(gl.ARRAY_BUFFER,0,F.subarray(0,n*36));gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,R.fxIx);attrs(3);
  gl.vertexAttribPointer(0,3,gl.FLOAT,false,36,0);gl.vertexAttribPointer(1,4,gl.FLOAT,false,36,12);gl.vertexAttribPointer(2,2,gl.FLOAT,false,36,28);gl.disable(gl.CULL_FACE);
  gl.uniform1f(P.u.uQ,T.hi?1:0);let add=false;
  for(let i=0;i<B.length;i+=3){const m=B[i],f=B[i+1],t=B[i+2],ad=m>=4&&m!=8;
    if(ad!==add){add=ad;gl.blendFunc(gl.SRC_ALPHA,add?gl.ONE:gl.ONE_MINUS_SRC_ALPHA)}
    gl.uniform1f(P.u.uMode,m);gl.drawElements(gl.TRIANGLES,(t-f)*6,gl.UNSIGNED_SHORT,f*12);R.draws++}
  if(add)gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);R.fxN=n}
