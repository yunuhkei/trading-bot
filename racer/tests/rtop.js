// A bird's-eye render of a place (debug camera) to check layouts.
const L=require('./rlib.js');
const [x,z,h,name,span]=[+process.argv[2],+process.argv[3],+process.argv[4]||300,process.argv[5]||'top',+process.argv[6]||0];
(async()=>{
  const T=await L.launch({q:'go=1&scale=1&fixed=1',w:900,h:600,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  await T.ev(([x,z,h])=>{const {C,CAM,UI,carPlace}=RACER;running=false;UI.paused=true;UI.noHud=1;carPlace(x,z,0,0);C.y=-500;window.__shot=1;
    const R=RACER.R;R.carDraw=null;CAM.x=x;CAM.y=h;CAM.z=z+h*.35;CAM.tx=x;CAM.ty=0;CAM.tz=z;CAM.fov=.9;RACER.renderOnce(900,600)},[x,z,h]);
  await L.sleep(300);await T.page.locator('#gl').screenshot({path:L.SP+'/shots/'+name+'.png'});console.log('errs',T.errs);await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
