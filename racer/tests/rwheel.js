// The steering wheel setting (batch 48): the WHEEL rocker in the pause console switches the thumb-stick for an on-screen wheel. The wheel sits clear of the other instruments, follows a thumb
// that turns it (up to 120 degrees each way), springs back on release, creates no stick, does not break the keyboard, and the choice is saved.
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.5&fixed=1&wheel=1',w:667,h:375,mobile:true});await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const cdp=await T.page.context().newCDPSession(T.page);const tp=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts.map(p=>({x:p[0],y:p[1],id:p[2]}))});
  const S=()=>T.ev(()=>({on:WHL.on,rot:+WHL.rot.toFixed(2),steer:+RACER.C.steer.toFixed(2),stick:!!UI.stickT,grab:!!WHL.grab}));
  const W=await T.ev(()=>({...UI.wh,sp:UI.sp,mm:UI.mm,gg:UI.gg,w:UI.w,h:UI.h}));
  ok(W&&W.R>40,'1 the wheel exists, radius '+(W.R|0)+' px at '+(W.cx|0)+','+(W.cy|0));
  const d=(a,b)=>Math.hypot(a.cx-b.cx,a.cy-b.cy);
  ok(d(W,W.sp)>=W.R+W.sp.R-2&&d(W,W.mm)>=W.R+W.mm.r-2&&W.cy+W.R<=W.gg.y1+2,'2 it does not overlap the speedometer, the minimap or the gauges ('+d(W,W.sp).toFixed(0)+' / '+d(W,W.mm).toFixed(0)+' px apart)');
  let s=await S();ok(s.on==1&&!s.stick,'3 wheel mode is on and no thumb-stick exists');
  const pt=a=>[W.cx+Math.cos(a)*W.R*.9,W.cy+Math.sin(a)*W.R*.9];
  await tp('touchStart',[[...pt(0),1]]);await L.sleep(80);s=await S();ok(s.grab&&!s.stick,'4 touching the wheel grabs it (no stick)');
  for(let k=1;k<=7;k++){await tp('touchMove',[[...pt(k*10*Math.PI/180),1]]);await L.sleep(30)}await L.sleep(250);s=await S();
  ok(s.rot>1&&s.rot<1.4&&s.steer>.3,'5 70 degrees clockwise turns the wheel '+s.rot+' rad and steers right ('+s.steer+')');
  for(let k=8;k<=18;k++){await tp('touchMove',[[...pt(k*10*Math.PI/180),1]]);await L.sleep(30)}await L.sleep(250);s=await S();
  ok(s.rot<=2.11&&s.rot>2&&s.steer>.8,'6 it stops at full lock ('+s.rot+' rad, steering '+s.steer+')');
  await tp('touchEnd',[]);for(let k=0;k<30;k++){await L.sleep(150);s=await S();if(Math.abs(s.rot)<.05&&Math.abs(s.steer)<.08)break}ok(Math.abs(s.rot)<.05&&Math.abs(s.steer)<.08&&!s.grab,'7 let go and it springs back to centre (wheel '+s.rot+', steering '+s.steer+')');
  await tp('touchStart',[[...pt(Math.PI),2]]);for(let k=1;k<=7;k++){await tp('touchMove',[[...pt(Math.PI-k*10*Math.PI/180),2]]);await L.sleep(30)}await L.sleep(250);s=await S();
  ok(s.rot<-1&&s.steer<-.3,'8 turning the other way steers left (wheel '+s.rot+', steering '+s.steer+')');await tp('touchEnd',[]);await L.sleep(600);
  await tp('touchStart',[[30,235,3]]);await L.sleep(80);await tp('touchMove',[[100,235,3]]);await L.sleep(250);s=await S();ok(Math.abs(s.steer)<.05&&!s.stick,'9 a drag on the left away from the wheel does not steer (steering '+s.steer+')');await tp('touchEnd',[]);
  await T.ev(()=>{UI.keys.ArrowRight=1});await L.sleep(300);s=await S();ok(s.steer>.5,'10 the keyboard still steers in wheel mode ('+s.steer+')');await T.ev(()=>{UI.keys.ArrowRight=0});await L.sleep(300);
  /* the pause console switch */
  await T.ev(()=>{UI.paused=true;DASH.pT0=performance.now()-2000;pauseDraw(UI.ctx,UI.w,UI.h,UI.btnU)});await L.sleep(150);   /* (the pause console is laid out when it is drawn) */
  const P=await T.ev(()=>{const L2=pauseLayout(UI.w,UI.h,UI.btnU),r=L2.b.filter(b=>b.rocker),w=L2.b.find(b=>b.id=='wheel');return{n:r.length,ids:r.map(b=>b.id),w:w&&{x:w.x,y:w.y,w:w.w,h:w.h},gaps:r.slice(1).map((b,i)=>+(b.x-(r[i].x+r[i].w)).toFixed(1)),inside:r.every(b=>b.x>=L2.left.x&&b.x+b.w<=L2.left.x+L2.left.w+1)}});
  ok(P.n==5&&P.ids.includes('wheel')&&P.gaps.every(g=>g>=2)&&P.inside,'11 the pause console has a WHEEL switch beside the other four, with room between them (gaps '+P.gaps.join(', ')+' px)');
  const tap=await T.ev(p=>{const before=WHL.on;pauseTap(p.x+p.w/2,p.y+p.h/2);return{before,after:WHL.on,saved:localStorage.getItem('racer.wheel')}},P.w);
  ok(tap.before==1&&tap.after==0&&tap.saved==='0','12 tapping the switch turns the wheel off and saves it (was '+tap.before+', now '+tap.after+', saved '+tap.saved+')');
  const back=await T.ev(p=>{pauseTap(p.x+p.w/2,p.y+p.h/2);return{on:WHL.on,saved:localStorage.getItem('racer.wheel')}},P.w);ok(back.on==1&&back.saved==='1','13 and on again ('+back.on+', saved '+back.saved+')');
  await T.ev(()=>{pauseDraw(UI.ctx,UI.w,UI.h,UI.btnU)});await T.page.screenshot({path:L.SP+'/shots/wheel_pause.png'});
  await T.ev(()=>{UI.paused=false;WHL.rot=.9});await L.sleep(120);await T.page.screenshot({path:L.SP+'/shots/wheel_hud.png'});
  /* stick mode is unchanged */
  await T.ev(()=>wheelSet(false));await tp('touchStart',[[120,300,5]]);await L.sleep(80);await tp('touchMove',[[190,300,5]]);await L.sleep(300);s=await S();ok(s.stick&&s.steer>.3,'14 with the wheel off the thumb-stick works as before (steering '+s.steer+')');await tp('touchEnd',[]);
  console.log('errs',T.errs.length?T.errs:0);await T.close();process.exit(bad||T.errs.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
