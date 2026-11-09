const L=require('./rlib.js');
async function run(w,h,tag){
  const T=await L.launch({q:'go=1&scale=.5&fixed=1',w,h,mobile:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const cdp=await T.page.context().newCDPSession(T.page);
  const tp=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(p=>({x:p[0],y:p[1],id:p[2]}))});
  const ctr=id=>T.ev(i=>{const b=RACER.UI.bn[i];return[b.x+b.w/2,b.y+b.h/2]},id);
  const st=()=>T.ev(()=>({thr:RACER.IN.thr,brk:RACER.IN.brk,hand:RACER.IN.hand,nitro:RACER.IN.nitro,auto:RACER.IN.auto,kmh:RACER.C.kmh|0,map:!!RACER.UI.mapOpen,steer:+RACER.C.steer.toFixed(2)}));
  const lay=await T.ev(()=>{const u=RACER.UI,o={};for(const k of['gas','brake','drift','nitro','map'])o[k]=u.bn[k].x.toFixed(0)+','+u.bn[k].y.toFixed(0)+' '+u.bn[k].w.toFixed(0)+'x'+u.bn[k].h.toFixed(0);o.mm=JSON.stringify(u.mm);return o});
  console.log(tag,'layout',JSON.stringify(lay));
  console.log(tag,'idle (auto off) after 1s:',JSON.stringify(await (async()=>{await L.sleep(1000);return st()})()));
  const g=await ctr('gas');await tp('touchStart',[[g[0],g[1],1]]);await L.sleep(1500);console.log(tag,'gas held:',JSON.stringify(await st()));
  // steer with the other thumb while holding gas
  await tp('touchStart',[[g[0],g[1],1],[120,300,2]]);await tp('touchMove',[[g[0],g[1],1],[180,300,2]]);await L.sleep(300);console.log(tag,'gas + steer:',JSON.stringify(await st()));
  await tp('touchEnd',[]);await L.sleep(200);console.log(tag,'released:',JSON.stringify(await st()));
  const b=await ctr('brake');await tp('touchStart',[[b[0],b[1],3]]);await L.sleep(200);console.log(tag,'brake:',JSON.stringify(await st()));await tp('touchEnd',[]);
  const d=await ctr('drift');await tp('touchStart',[[d[0],d[1],4]]);await L.sleep(150);console.log(tag,'drift:',JSON.stringify(await st()));await tp('touchEnd',[]);
  const m=await ctr('map');await tp('touchStart',[[m[0],m[1],5]]);await tp('touchEnd',[]);await L.sleep(300);console.log(tag,'tapped minimap:',JSON.stringify(await st()));
  await L.sleep(300);await T.page.screenshot({path:L.SP+'/shots/map_'+tag+'.png'});
  await tp('touchStart',[[300,200,6]]);await tp('touchEnd',[]);await L.sleep(300);console.log(tag,'tapped to close:',JSON.stringify(await st()));
  // hold gas again briefly and screenshot the driving HUD
  await tp('touchStart',[[g[0],g[1],7]]);await L.sleep(1200);await T.page.screenshot({path:L.SP+'/shots/hud_'+tag+'.png'});await tp('touchEnd',[]);
  console.log(tag,'errs',T.errs);await T.close();
}
(async()=>{await run(667,375,'a');await run(568,320,'b')})().catch(e=>{console.error(e);process.exit(1)});
