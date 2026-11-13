// The dashboard look (batch 19): the HUD controls, the pause console, and changing cars inside a garage.
// usage: node racer/tests/rdash.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.4&fixed=1&env=day',w:667,h:375,mobile:true,traffic:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const r=await T.ev(()=>{const {C,IN,UI}=RACER,o={};
    /* 1 the HUD: hazard pause, pedals, drift, nitro; the old top-right bar is gone */
    o.ids=UI.btn.map(b=>b.id).sort().join(',');
    /* 2 the pause console */
    pauseOpen();o.paused=UI.paused;const L2=pauseLayout(UI.w,UI.h,UI.btnU);o.ctl=L2.b.filter(b=>!b.klabel).map(b=>b.id).join(',');
    const tapB=id=>{const b=L2.b.find(q=>q.id==id);PAUSE.btns=L2.b;return pauseTap(b.round?b.x+b.round:b.knob?b.cx:b.x+b.w/2,b.round?b.y+b.round:b.knob?b.cy:b.y+b.h/2)};
    const f0=UI.showStats;tapB('fps');o.fps=UI.showStats!==f0;tapB('fps');
    const a0=IN.auto;tapB('assist');o.assist=IN.auto!==a0;tapB('assist');
    tapB('gfx_2');o.gfx=GFX.mode;tapB('gfx_0');o.gfx2=GFX.mode;
    tapB('sky_2');o.sky=ENV.name;tapB('sky_0');
    tapB('drive');o.resumed=!UI.paused;
    /* 3 away from a garage, GARAGE sets the route to the nearest one you own */
    const ring=ROADS.find(q=>q.id=='ring'),i=Math.round(ring.n*.5);RACER.carPlace(ring.X[i],ring.Z[i],0,ring.Y[i]+.5);navClear();garageGo();o.route=!!(NAV.wp||NAV.route||NAV.pend);o.toast=SAFE.msg;
    /* 4 on the pad of the home garage: the card, then into the room and back out */
    const s=SAFE.pads.find(q=>q.id=='home');RACER.carPlace(s.pad.x,s.pad.z,s.yaw,s.y+.4);EV.card=null;EV.dismiss=null;SAFE.visit=null;
    for(let k=0;k<120*3;k++){IN.thr=0;C.vx=C.vz=0;RACER.worldStep(1/120)}
    o.card=EV.card&&EV.card.title;o.btns=EV.card&&EV.card.btns.map(b=>b.label).join('/');const px=C.x,pz=C.z;
    garageEnter();if(DASH.fadeFn)DASH.fadeFn();DASH.fadeFn=null;DASH.fadeDir=0;DASH.fade=0;
    o.inMenu=!!MENU.open;o.inRoom=Math.hypot(C.x-GROOM.x,C.z-GROOM.z)<3&&Math.abs(C.y-GROOM.y)<.5;o.env=ENV.name;o.gname=MENU.garage;
    menuClose();if(DASH.fadeFn)DASH.fadeFn();DASH.fadeFn=null;DASH.fadeDir=0;DASH.fade=0;
    o.out=!MENU.open&&Math.hypot(C.x-px,C.z-pz)<1;o.env2=ENV.name;
    /* 5 the car menu cannot be opened on the road: C goes to the garage */
    RACER.carPlace(ring.X[i],ring.Z[i],0,ring.Y[i]+.5);garageEnter();o.roadMenu=!!MENU.open;
    return o});
  console.log(JSON.stringify(r));
  ok(r.ids=='brake,drift,gas,map,nitro,pause','1 the HUD has the hazard pause, the pedals, drift, nitro and the map ('+r.ids+'); the old top-right bar is gone');
  ok(r.paused&&r.ctl=='drive,fps,assist,garage,map,reset,gfx,sky','2 pause opens the console: '+r.ctl);
  ok(r.fps&&r.assist&&r.gfx=='high'&&r.gfx2=='auto'&&r.sky=='sunset'&&r.resumed,'2 the rockers switch FPS and assist, the knobs set graphics ('+r.gfx+') and sky ('+r.sky+'), DRIVE resumes');
  ok(r.route&&/ROUTE SET/.test(r.toast),'3 GARAGE on the road sets the route to the nearest garage ("'+r.toast+'")');
  ok(r.card=='HOME GARAGE'&&r.btns=='ENTER GARAGE/EVENTS/DRIVE ON','4 parked on the home garage pad: '+r.card+' ('+r.btns+')');
  ok(r.inMenu&&r.inRoom&&r.env=='garage'&&r.gname=='Home Garage','4 ENTER GARAGE: the car is inside the garage room with the car menu open ('+r.gname+')');
  ok(r.out&&r.env2=='day','4 leaving puts the car back on the pad and the day back');
  ok(!r.roadMenu,'5 the car menu does not open on the road');
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
