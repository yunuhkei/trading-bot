// (batch 76) stress: random actions (map, pause, garage, events, story, cars, cops, nitro, respawns) for ROUNDS x 45 s of game time, drawing now and then; reports page errors and NaN.  usage: SEED=1 ROUNDS=8 node racer/tests/rchaos.js
// random actions for N seconds of game time, rendering and drawing the HUD now and then; reports page errors and NaN
const L=require('./rlib.js');
(async()=>{const T=await L.launch({q:'go=1&scale=.4&fixed=1',w:420,h:260,mobile:true,traffic:true});
await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});
const seed=+(process.env.SEED||1);
for(let round=0;round<+(process.env.ROUNDS||8);round++){
const o=await T.ev(([seed,round])=>{let x=(seed*9301+round*49297)%233280;const rnd=()=>(x=(x*9301+49297)%233280)/233280;const log=[];let nan=0;
  const acts=[
   ()=>{mapOpenNow();log.push('map')},()=>{UI.mapOpen=false},()=>{pauseOpen();log.push('pause')},()=>{pauseClose()},
   ()=>{menuOpen();log.push('menu');if(rnd()<.5)menuPreview((rnd()*CAR_ROSTER.length)|0)},()=>{menuClose()},
   ()=>{const e=EV.list[(rnd()*EV.list.length)|0];EV.card=null;if(!EV.run){evStart(e);log.push('ev '+e.id)}},()=>{if(EV.run){evQuit();log.push('quit')}EV.card=null},
   ()=>{if(!STORY.on){storyBegin(false);log.push('story')}else{storyLeave();log.push('leave')}},()=>{while(STORY.dlg)storySceneEnd()},
   ()=>{CAROWN.all=true;carSelect((rnd()*CAR_ROSTER.length)|0);log.push('car')},()=>{C.nos=1;nitroTap()},()=>{IN.hand=1},()=>{IN.hand=0},
   ()=>{heatAdd(80+rnd()*300);log.push('heat')},()=>{copClear(true)},()=>{IN.respawn=1},()=>{if(EV.card&&EV.card.btns&&EV.card.btns.length)EV.card.btns[(rnd()*EV.card.btns.length)|0].act()},
   ()=>{const S=SAFE.pads[(rnd()*SAFE.pads.length)|0];if(S)RACER.carPlace(S.pad.x,S.pad.z,S.yaw,S.y+.4);log.push('garage pad')},()=>{garageGo&&garageGo()},
   ()=>{DIFF.lv=(rnd()*3)|0},()=>{envCycle&&envCycle()}];
  for(let s=0;s<120*45;s++){if(s%90==0){const a=acts[(rnd()*acts.length)|0];try{a()}catch(e){log.push('ACT ERR '+e.message)}}
    IN.thr=rnd()<.85?1:0;IN.brk=rnd()<.05?1:0;C.steer=Math.sin(s/90)*.5;RACER.worldStep(1/120);
    if(s%240==0){try{R.alpha=1;RACER.renderOnce(UI.cw,UI.ch);hudDraw()}catch(e){log.push('DRAW ERR '+e.message)}}
    if(!isFinite(C.x+C.y+C.z+C.vx+C.vz)){nan++;if(nan==1)log.push('PLAYER NaN')}
    for(const c of TR.cars)if(c.alive&&!isFinite(c.x+c.y+c.z)){nan++;log.push('CAR NaN kind '+c.kind);c.alive=0;break}}
  return{log:log.slice(-40),nan}},[seed,round]);
console.log('round',round,'nan',o.nan,'| '+o.log.filter(l=>/ERR|NaN/.test(l)).join(' | '))}
console.log('page errors:',JSON.stringify(T.errs.slice(0,15)));await T.close()})();
