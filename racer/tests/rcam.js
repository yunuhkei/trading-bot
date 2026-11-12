// Camera smoothness: drives with the game's own loop timing (frames of 14-19 ms, physics at 120 Hz with interpolation) and measures how steadily the car sits in the picture.
// A smooth camera keeps the car at a steady place on screen; a glitch shows as a jump in the car's screen position from one frame to the next, relative to its running average.
// Metrics per scenario: the largest frame-to-frame change of the car's position in the view (metres along the view and sideways, camera space) and of the camera yaw / fov / distance.
const L=require('./rlib.js');
let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:480,h:270,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  const run=async(name,script)=>T.ev(([name,script])=>{
    const {C,IN,ROADS,UI,CAM,R,GFX}=RACER;UI.paused=true;GFX.fixed=true;IN.assist=true;IN.auto=false;
    const r=ROADS.find(q=>q.id=='ring'),i0=Math.round(r.n*.3),a=Math.atan2(r.X[i0+1]-r.X[i0],-(r.Z[i0+1]-r.Z[i0]));
    RACER.carPlace(r.X[i0]+Math.cos(a)*5.6,r.Z[i0]+Math.sin(a)*5.6,a,r.Y[i0]+.5);C.vx=Math.sin(a)*45;C.vz=-Math.cos(a)*45;C.nos=1;IN.thr=1;IN.nitro=0;IN.hand=0;C.steer=0;
    let seed=12345;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
    const DT=1/120;let acc=0;const rec=[];
    for(let k=0;k<140;k++){
      const ms=14+rnd()*5;acc+=ms/1000;let n=0;while(acc>=DT&&n<14){/* steer along the road like the player would */
        const sc=script(k,C,IN);RACER.worldStep(DT);acc-=DT;n++}
      R.alpha=acc/DT;if(R.alpha>1)R.alpha=1;RACER.camStep(ms/1000,false);
      /* where is the car (as drawn: interpolated) in camera space? */
      const x=C.px+(C.x-C.px)*R.alpha,z=C.pz+(C.z-C.pz)*R.alpha,dx=x-CAM.x,dz=z-CAM.z,fx=CAM.tx-CAM.x,fz=CAM.tz-CAM.z,fl=Math.hypot(fx,fz)||1;
      const along=(dx*fx+dz*fz)/fl,side=(dx*-fz+dz*fx)/fl;rec.push([along,side,CAM.fov,Math.atan2(fx,-fz),C.camDist||0,C.speed])}
    /* second differences = jerk of the car's place in the view */
    let jA=0,jS=0,jF=0,jY=0,aMin=1e9,aMax=-1e9;for(let k=2;k<rec.length;k++){const d2=(i)=>Math.abs(rec[k][i]-2*rec[k-1][i]+rec[k-2][i]);jA=Math.max(jA,d2(0));jS=Math.max(jS,d2(1));jF=Math.max(jF,d2(2));
      let dy=rec[k][3]-2*rec[k-1][3]+rec[k-2][3];dy=Math.abs(Math.atan2(Math.sin(dy),Math.cos(dy)));jY=Math.max(jY,dy);aMin=Math.min(aMin,rec[k][0]);aMax=Math.max(aMax,rec[k][0])}
    return{jA,jS,jF,jY,aMin,aMax,v0:rec[0][5],v1:rec[rec.length-1][5]}},[name,script.toString?script.toString():script]);
  void run;
  // scripts are passed as source text, so build them inside the page
  const scen={
    straight:'(k,C,IN)=>{}',
    nitro:'(k,C,IN)=>{if(k==30)IN.nitro=1}',
    nitro2:'(k,C,IN)=>{if(k==30)IN.nitro=1;if(k==80)IN.nitro=0}',
    drift:'(k,C,IN)=>{if(k==30){IN.hand=1;C.steer=.6}if(k==48){IN.hand=0;C.steer=0}}',
    driftHold:'(k,C,IN)=>{if(k==30){IN.hand=1;C.steer=-.8}if(k==100){IN.hand=0;C.steer=0}}',
    lift:'(k,C,IN)=>{if(k==30)IN.thr=0;if(k==60)IN.thr=1}'};
  const out={};
  for(const [name,src] of Object.entries(scen)){
    /* the two long slides cross the whole road: with the guard rails of world 1e they would end scraping along a rail, and this test is about the camera in a clean slide, so the ring's rails are lifted for them */
    if(/^drift/.test(name))await T.ev(()=>{const r=ROADS.find(q=>q.id=='ring');window.__rail=r.rail.slice();r.rail.fill(0)});
    out[name]=await T.ev(([name,src])=>{
      const {C,IN,ROADS,UI,CAM,R,GFX}=RACER;UI.paused=true;GFX.fixed=true;IN.assist=true;IN.auto=false;const script=eval(src);
      const r=ROADS.find(q=>q.id=='ring'),i0=Math.round(r.n*.3),a=Math.atan2(r.X[i0+1]-r.X[i0],-(r.Z[i0+1]-r.Z[i0]));
      RACER.carPlace(r.X[i0]+Math.cos(a)*5.6,r.Z[i0]+Math.sin(a)*5.6,a,r.Y[i0]+.5);C.vx=Math.sin(a)*45;C.vz=-Math.cos(a)*45;C.nos=1;IN.thr=1;IN.nitro=0;IN.hand=0;C.steer=0;RACER.camStep(0,true);
      let seed=12345;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
      const DT=1/120;let acc=0;const rec=[];
      for(let k=0;k<140;k++){const ms=14+rnd()*5;acc+=ms/1000;let n=0;script(k,C,IN);while(acc>=DT&&n<14){RACER.worldStep(DT);acc-=DT;n++}
        R.alpha=acc/DT;if(R.alpha>1)R.alpha=1;RACER.camStep(ms/1000,false);
        const x=C.px+(C.x-C.px)*R.alpha,z=C.pz+(C.z-C.pz)*R.alpha,dx=x-CAM.x,dz=z-CAM.z,fx=CAM.tx-CAM.x,fz=CAM.tz-CAM.z,fl=Math.hypot(fx,fz)||1;
        rec.push([(dx*fx+dz*fz)/fl,(dx*-fz+dz*fx)/fl,CAM.fov,Math.atan2(fx,-fz),Math.hypot(CAM.x-x,CAM.z-z),C.speed])}
      let jA=0,jS=0,jF=0,jY=0,jD=0;for(let k=2;k<rec.length;k++){const d2=i=>Math.abs(rec[k][i]-2*rec[k-1][i]+rec[k-2][i]);jA=Math.max(jA,d2(0));jS=Math.max(jS,d2(1));jF=Math.max(jF,d2(2));jD=Math.max(jD,d2(4));
        let dy=rec[k][3]-2*rec[k-1][3]+rec[k-2][3];dy=Math.abs(Math.atan2(Math.sin(dy),Math.cos(dy)));jY=Math.max(jY,dy)}
      return{jA,jS,jF,jY,jD,v1:rec[rec.length-1][5]}},[name,src]);
    if(/^drift/.test(name))await T.ev(()=>{ROADS.find(q=>q.id=='ring').rail.set(window.__rail)});
    const o=out[name];console.log(name.padEnd(10),`car-in-view jerk: along ${o.jA.toFixed(3)} m, sideways ${o.jS.toFixed(3)} m, distance ${o.jD.toFixed(3)} m; camera yaw ${(o.jY*57.3).toFixed(2)} deg, fov ${(o.jF*57.3).toFixed(2)} deg; end speed ${o.v1.toFixed(0)} m/s`)}
  const lim={A:+(process.env.LIMA||.1),S:+(process.env.LIMS||.05),Y:+(process.env.LIMY||.004),F:+(process.env.LIMF||.014)};
  for(const [n,o] of Object.entries(out))ok(o.jA<lim.A&&o.jS<lim.S&&o.jD<lim.A&&o.jY<lim.Y&&o.jF<lim.F,`${n}: the car stays steady in the picture (jerk along ${o.jA.toFixed(3)} / side ${o.jS.toFixed(3)} m, yaw ${(o.jY*57.3).toFixed(2)} deg, fov ${(o.jF*57.3).toFixed(2)} deg)`);
  /* framing: the car must fill a good part of the picture (a console racer, not a toy in the distance) and never be cut off by the bottom edge, standing still, at 30 m/s and at 70 m/s */
  const FR=await T.ev(()=>{const {C,IN,ROADS,UI,CAM,CARM}=RACER;UI.paused=true;const out=[];const r=ROADS.find(q=>q.id=='ring'),i0=Math.round(r.n*.3),a=Math.atan2(r.X[i0+1]-r.X[i0],-(r.Z[i0+1]-r.Z[i0]));
    for(const sp of [0,30,70]){RACER.carPlace(r.X[i0]+Math.cos(a)*5.6,r.Z[i0]+Math.sin(a)*5.6,a,r.Y[i0]+.5);C.vx=Math.sin(a)*sp;C.vz=-Math.cos(a)*sp;C.speed=sp;C.boostK=0;RACER.camStep(0,true);RACER.camStep(0,true);
      const asp=480/270,th=Math.tan(CAM.fov/2);let fx=CAM.tx-CAM.x,fy=CAM.ty-CAM.y,fz=CAM.tz-CAM.z;const fl=Math.hypot(fx,fy,fz);fx/=fl;fy/=fl;fz/=fl;
      let rx=-fz,rz=fx;const rl=Math.hypot(rx,rz);rx/=rl;rz/=rl;const ux=-fy*rz,uy=rz*fx-rx*fz,uz=fy*rx;   /* up = right x forward */
      const pr=(x,y,z)=>{const dx=x-CAM.x,dy=y-CAM.y,dz=z-CAM.z,zc=dx*fx+dy*fy+dz*fz,xc=dx*rx+dz*rz,yc=dx*ux+dy*uy+dz*uz;return[.5+.5*xc/(zc*th*asp),.5-.5*yc/(zc*th)]};
      const sy=Math.sin(C.yaw),cy=Math.cos(C.yaw),hl=CARM.hl||2.2,hw=CARM.hw||.95,bx=C.x+sy*hl*-1,bz=C.z-cy*hl*-1;   /* behind the car */
      const L1=pr(bx-cy*hw,C.y,bz-sy*hw),R1=pr(bx+cy*hw,C.y,bz+sy*hw),T1=pr(C.x,C.y+1.2,C.z);
      out.push({sp,w:Math.abs(R1[0]-L1[0]),bottom:Math.max(L1[1],R1[1]),top:T1[1]})}return out});
  for(const f of FR)ok(f.w>.14&&f.w<.42&&f.bottom<.93&&f.top>.2,`framing at ${f.sp} m/s: the car is ${(f.w*100).toFixed(0)} % of the picture width, its tyres touch the road at ${(f.bottom*100).toFixed(0)} % of the height, its roof at ${(f.top*100).toFixed(0)} %`);
  console.log('errs',T.errs.slice(0,3));await T.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
