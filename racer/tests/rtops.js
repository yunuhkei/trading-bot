// Several bird's-eye renders in one load: node racer/tests/rtops.js '[[x,z,height,"name"],...]'   (env=day unless ENVQ is set; pictures go to $RACER_OUT/shots)
const L=require('./rlib.js');
const list=JSON.parse(process.argv[2]);
(async()=>{
  const T=await L.launch({q:'go=1&scale=1&fixed=1&env='+(process.env.ENVQ||'day')+(process.env.Q||''),w:900,h:600,mobile:false,traffic:!!process.env.TRAFFIC});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  for(const [x,z,h,name,tilt] of list){
    await T.ev(([x,z,h,tilt])=>{const {C,CAM,UI,carPlace}=RACER;running=false;UI.paused=true;UI.noHud=1;carPlace(x,z,0,0);C.y=-500;window.__shot=1;
      const R=RACER.R;R.carDraw=null;R.carGlass=null;CAM.x=x;CAM.y=RACER.terrainH(x,z)+h;CAM.z=z+h*(tilt==null?.35:tilt);CAM.tx=x;CAM.ty=RACER.terrainH(x,z);CAM.tz=z;CAM.fov=.9;RACER.renderOnce(900,600);RACER.renderOnce(900,600)},[x,z,h,tilt]);
    await L.sleep(250);await T.page.locator('#gl').screenshot({path:L.SP+'/shots/'+name+'.png'})}
  console.log('errs',T.errs.length);await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
