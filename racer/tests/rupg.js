// Upgrades (batch 20): prices, buying, what each part changes, the garage page.
// usage: node racer/tests/rupg.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.4&fixed=1&env=day',w:667,h:375,mobile:true,traffic:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const r=await T.ev(()=>{const {C,IN,UI}=RACER,o={};UI.paused=true;UPG.lv={};upgSave();const d=CAR_ROSTER[CARSEL.cur],id=d.id;carHandling(d);
    /* 1 prices */
    o.cur=id;o.prices=UPG_DEF.map(D=>upgPrice(id,D.k));const top=CAR_ROSTER[CAR_ROSTER.length-1];o.topEng=upgPrice(top.id,'eng');
    /* 2 buying: no money, then money */
    ECON.money=1000;o.poor=upgBuy(id,'eng');ECON.money=200000;const v0=HND.vmax,a0=HND.accel,g0=HND.grip,b0=HND.brake;
    o.buy=upgBuy(id,'eng');o.vmax=+(HND.vmax/v0).toFixed(3);o.acc=+(HND.accel/a0).toFixed(3);o.spent=200000-ECON.money;
    upgBuy(id,'eng');upgBuy(id,'eng');o.max=upgBuy(id,'eng');o.lvl=upgLv(id,'eng');o.vmax3=+(HND.vmax/v0).toFixed(3);
    upgBuy(id,'tyr');o.grip=+(HND.grip/g0).toFixed(3);upgBuy(id,'brk');o.brake=+(HND.brake/b0).toFixed(3);
    o.saved=JSON.parse(localStorage.getItem('racer.upg'))[id].eng;
    /* 3 nitro lasts longer */
    const ring=ROADS.find(q=>q.id=='ring'),i=Math.round(ring.n*.2),t=_tan(ring,i);const burn=()=>{RACER.carPlace(ring.X[i],ring.Z[i],Math.atan2(t[0],-t[1]),ring.Y[i]+.5);C.nos=1;IN.nitro=1;for(let s=0;s<120;s++){IN.thr=1;RACER.worldStep(1/120)}IN.nitro=0;IN.thr=0;return 1-C.nos};
    const n0=burn();upgBuy(id,'nos');upgBuy(id,'nos');const n2=burn();o.nos=[+n0.toFixed(3),+n2.toFixed(3)];
    /* 4 armour: the same damage costs less health */
    dmgReset();DMG.total=600000;const h0=dmgHp();upgBuy(id,'arm');upgBuy(id,'arm');upgBuy(id,'arm');const h3=dmgHp();o.arm=[+h0.toFixed(3),+h3.toFixed(3)];dmgReset();
    /* 5 the garage page */
    const s=SAFE.pads.find(q=>q.id=='home');RACER.carPlace(s.pad.x,s.pad.z,s.yaw,s.y+.4);SAFE.at=s;C.speed=0;garageEnter();if(DASH.fadeFn)DASH.fadeFn();DASH.fadeFn=null;DASH.fadeDir=0;DASH.fade=0;
    const Lm=menuLayout(UI.w,UI.h,UI.btnU);o.hasUpgKey=Lm.b.some(b=>b.id=='upg');MENU.tab=1;const c=UI.ctx;let err='';try{upgDraw(c,UI.w,UI.h,UI.btnU)}catch(e){err=e.message}o.err=err;o.keys=MENU.btns.map(b=>b.id).join(',');
    const bb=MENU.btns.find(b=>b.id=='buy_tyr'),lv0=upgLv(id,'tyr');menuTap(bb.x+bb.w/2,bb.y+bb.h/2);o.tapBuy=upgLv(id,'tyr')-lv0;menuClose();if(DASH.fadeFn)DASH.fadeFn();
    UPG.lv={};upgSave();carHandling(d);return o});
  console.log(JSON.stringify(r));
  ok(r.prices.join(',')=='2500,2000,1750,2000,1500'&&r.topEng>r.prices[0],'1 stage-1 prices for '+r.cur+': engine, tyres, brakes, nitro, armour '+r.prices.join(' / ')+'; the fastest car\'s engine costs '+r.topEng);
  ok(/^NEED/.test(r.poor)&&r.buy=='OK'&&r.spent==2500,'2 without money: "'+r.poor+'"; with money stage 1 is bought ('+r.spent+')');
  ok(r.vmax==1.04&&r.acc==1.07&&r.vmax3==1.12&&r.lvl==3&&r.max=='MAX','2 the engine: +4 % top speed and +7 % pull per stage (x'+r.vmax3+' at stage 3), a fourth buy says MAX');
  ok(r.grip==1.04&&r.brake==1.09&&r.saved==3,'2 tyres +4 % grip, brakes +9 % braking; saved per car');
  ok(r.nos[1]<r.nos[0]*.7,'3 nitro stage 2: a second of boost burns '+r.nos[1]+' of the tank instead of '+r.nos[0]);
  ok(r.arm[1]>r.arm[0],'4 armour stage 3: the same damage leaves '+r.arm[1]+' health instead of '+r.arm[0]);
  ok(r.hasUpgKey&&!r.err&&r.keys.startsWith('buy_eng,buy_tyr,buy_brk,buy_nos,buy_arm')&&r.tapBuy==1,'5 in the garage: an UPGRADES key; the page draws and its BUY keys work ('+r.keys+')');
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
