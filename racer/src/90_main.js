'use strict';
/* ===== boot: generate the county, upload it, then run the loop ===== */
const BOOT={};
function loadMsg(p,t){const b=$('lb');if(b)b.style.width=Math.round(p*100)+'%';const e=$('lt');if(e&&t)e.textContent=t}
const QS=new URLSearchParams(location.search);
async function boot(){
  try{
    loadMsg(.02,'Shaping the land…');
    const t0=performance.now();defineRoads();BOOT.lgMs=0;{const t1=performance.now();lgBuild();BOOT.lgMs=performance.now()-t1;BOOT.sig=sigBuild()}await genHeight(p=>loadMsg(.02+p*.18));
    loadMsg(.2,'Laying roads…');await nextTick();await carveRoads(p=>loadMsg(.2+p*.15));flattenGarages();railPass();
    loadMsg(.38,'Painting the ground…');await nextTick();genColors();
    loadMsg(.45,'Starting the graphics…');await nextTick();
    const cv=$('gl'),isTouch=('ontouchstart' in window)||navigator.maxTouchPoints>0,ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
    Q.aa=QS.has('aa')?QS.get('aa')=='1':ios;Q.scale=QS.has('scale')?parseFloat(QS.get('scale')):(ios?.85:.8);if(QS.has('fixed'))Q.min=Q.max=Q.scale;
    glInit(cv,false);cv.addEventListener('webglcontextlost',e=>{e.preventDefault();running=false;showErr('The graphics context was lost (the phone reclaimed memory). Reload the page.')});uiInit();uiResize();
    loadMsg(.5,'Building the city and trees…');await nextTick();
    renderInit();await nextTick();
    loadMsg(.92,'Almost there…');mapInit();
    const sp=roadById('ring'),i0=Math.floor(sp.n*.3);let sx=sp.X[i0],sz=sp.Z[i0],a=Math.atan2(sp.X[i0+1]-sp.X[i0],-(sp.Z[i0+1]-sp.Z[i0]));
    if(QS.has('start')){const q=QS.get('start').split(',').map(Number);sx=q[0];sz=q[1];a=(q[2]||0)}
    else{/* start on the ring, in the right-hand carriageway */const nx=-Math.cos(a+0),nz=Math.sin(a);sx+=Math.cos(a)*5.6;sz+=Math.sin(a)*5.6}
    let sy=sp.Y[i0]+.5;unitsLoad();if(!QS.has('fixed'))laneLoad();
    if(!QS.has('start')&&!QS.has('fixed')){const q=randomStart();if(q){sx=q.x;sz=q.z;a=q.yaw;sy=q.y}}   /* (batch 21: a random start, until there is a story for where you begin) */
    carPlace(sx,sz,a,sy);camStep(0,true);
    TR.on=!(window.__noTraffic||QS.get('traffic')=='0');if(QS.has('tmax'))TR.base=TR.max=Math.min(TRN-4,parseInt(QS.get('tmax'))||0);trInit();safeInit();ECON.load();upgLoad();carHandling(CAR_ROSTER[CARSEL.cur]);evInit();spotInit();
    if(QS.has('cops')){const q=QS.get('cops');if(q=='off')COP.on=false;else copSetDiff(q)}if(QS.get('safe')=='all')for(const k in SAFE.owned)SAFE.owned[k]=true;
    if(QS.get('cars')=='all')CAROWN.all=true;if(QS.has('car')){const n=parseInt(QS.get('car'));if(n>=0&&n<CAR_ROSTER.length){CAROWN.all=true;carSelect(n)}}
    BOOT.genMs=performance.now()-t0;
    loadMsg(1,'Ready  ('+Math.round(BOOT.genMs/100)/10+' s, '+R.stats.buildings+' buildings, '+R.stats.trees+' trees)');
    if(QS.has('go')||window.__autoGo){startRun()}else{const go=$('go');go.style.display='block';go.onclick=()=>{audioStart();startRun()}}
    window.RACER={SIG,sigState,sigBuild,PHYS,physSetClassic,deflect,ENV,ENVP,envApply,envCycle,PP,DEB,PDM,partDetach,partsHit,partsStep,partsReset,partHinge,NAV,MAPV,navSet,navClear,navSnap,navAStar,navLane,navPolyline,mapOpenNow,mapDown,mapMove,mapUp,mapWheel,copTrigger,COP,trGenType,trDent,TTYPES,MENU,CAROWN,menuOpen,menuClose,menuPreview,menuChoose,carUnlock,carSelect,CAR_ROSTER,CARSEL,HND,HND0,CARM,CD,cgBuild,GFX,GFXT,GOV,SHD,SMOKE,SPARK,LAMPS,NEONS,CARL,gfxGovern,gfxSetTier,gfxSetMode,C,IN,R,Q,W,ROADS,UI,CAM,G,TR,LG,IMP,TRM,DMG,SAFE,COP,COPD,GAME,ECON,worldStep,trTick,trPlace,trInit,groundAt,roadAt,terrainH,carStep,camStep,frame,renderOnce,respawn,carPlace,startRun,BOOT,ENV};
  }catch(e){showErr('Startup failed: '+(e&&e.message||e));console.error(e)}}
let last=0,acc=0,running=false;const DT=1/120;
function startRun(){$('load').classList.add('off');running=true;last=performance.now();requestAnimationFrame(loop)}
function renderOnce(w,h){R.alpha=1;viewSet(CAM.x,CAM.y,CAM.z,CAM.tx,CAM.ty,CAM.tz,CAM.fov,w||UI.cw,h||UI.ch);renderFrame(w||UI.cw,h||UI.ch)}
function frame(ms){
  gfxFrameStart();uiInputs(ms/1000);gfxUpdate(ms/1000);
  const halt=UI.paused||UI.mapOpen||MENU.open;if(!halt)navUpdate(ms/1000);
  if(!halt){crashFrame(ms/1000);acc+=Math.min(ms/1000,.1)*CC.scale;let n=0;while(acc>=DT&&n<14){worldStep(DT);acc-=DT;n++}if(n==14)acc=0;fxUpdate(ms/1000)}
  R.alpha=halt?1:acc/DT;if(R.alpha>1)R.alpha=1;
  /* camera follows the interpolated state */
  camStep(halt?0:ms/1000,false);if(MENU.open)menuCam(ms/1000);
  R.time+=halt?0:ms/1000;
  if(!UI.mapOpen){viewSet(CAM.x,CAM.y,CAM.z,CAM.tx,CAM.ty,CAM.tz,CAM.fov,UI.cw,UI.ch);renderFrame(UI.cw,UI.ch)}
  if((UI.hf=(UI.hf|0)+1)&1||UI.paused||UI.mapOpen||UI.ms>24)hudDraw();audioUpdate()}
function loop(now){if(!running)return;const ms=Math.min(100,now-last);last=now;if(ms>0){Q.frame(ms);try{frame(ms);gfxFrameEnd(ms)}catch(e){showErr('Frame error: '+(e&&e.message||e));running=false;console.error(e);return}}requestAnimationFrame(loop)}
window.addEventListener('resize',()=>{if(UI.hud){uiResize()}});
window.addEventListener('load',boot);
