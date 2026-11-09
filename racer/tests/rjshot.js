const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({q:'go=1&scale=1&fixed=1',w:667,h:375,mobile:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const shots=[['sh',0,.45],['sh',0,.85],['jumpland',0,0]];
  for(let k=0;k<2;k++){
    const info=await T.ev(([k])=>{const {C,IN,UI,ROADS,carStep,carPlace,camStep,renderOnce}=RACER;UI.paused=true;UI.showStats=false;IN.assist=false;const r=ROADS.find(q=>q.id=='sh'),h=r.def.humps[0],s0=h.f*r.len;let a=0;for(let i=0;i<r.n;i++)if(r.S[i]<=s0)a=i;
      const st=a-60,aa=Math.atan2(r.X[st+1]-r.X[st],-(r.Z[st+1]-r.Z[st]));carPlace(r.X[st],r.Z[st],aa,r.Y[st]+.5);const v=44;C.vx=Math.sin(aa)*v;C.vz=-Math.cos(aa)*v;C.nos=0;IN.hand=0;let idx=st,t=0;
      const target=k==0?.55:.95,n=r.n;
      for(let i=0;i<120*20;i++){let bi=idx,bd=1e18;for(let q=-6;q<=30;q++){const j=idx+q;if(j<0||j>=n)continue;const d=(r.X[j]-C.x)**2+(r.Z[j]-C.z)**2;if(d<bd){bd=d;bi=j}}idx=bi;const ti=Math.min(n-1,idx+10),want=Math.atan2(r.X[ti]-C.x,-(r.Z[ti]-C.z));C.steer=Math.max(-1,Math.min(1,angd(want,C.yaw)*2.2));IN.thr=C.speed<v?1:0;carStep(1/120);if(!C.grounded&&C.air>=(k==0?.45:.8))break}
      camStep(0,true);renderOnce(UI.cw,UI.ch);return{air:C.air.toFixed(2),y:C.y.toFixed(1),mph:(C.speed*2.237).toFixed(0)}},[k]);
    await L.sleep(250);await T.page.screenshot({path:L.SP+'/shots/jump'+k+'.png'});console.log(k,JSON.stringify(info));
  }
  // landing shot
  const info=await T.ev(()=>{const {C,IN,carStep,camStep,renderOnce,UI}=RACER;let g=0;for(let i=0;i<120*6&&g<30;i++){IN.thr=1;carStep(1/120);if(C.grounded)g++}camStep(0,true);renderOnce(UI.cw,UI.ch);return{jump:C.jump&&{d:Math.round(C.jump.d*3.281),air:C.jump.air.toFixed(2)}}});
  await L.sleep(250);await T.page.screenshot({path:L.SP+'/shots/jump2.png'});console.log('land',JSON.stringify(info),'errs',T.errs);
  await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
