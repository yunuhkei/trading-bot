// Events and money (batch 10): the event list, the marker card, a time trial driven by a bot along its route (checkpoints, finish, medal, prize, record, ghost),
// an escape-the-cops event (lost them in time, prize), a failed event (busted), buying a car and a garage, the event list in a garage.
// usage: node racer/tests/revents.js   (EV=t_ring picks the trial)
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:480,h:270,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  await T.ev(()=>{const {C,UI,IN}=RACER;UI.paused=true;IN.assist=true;localStorage.removeItem(EV.key);EV.rec={};ECON.money=5000;ECON.save();COP.on=true;copSetDiff('forgiving');
    /* a bot that follows a route polyline (pure pursuit, slowing for bends ahead) */
    window.follow=(Rt,vmax)=>{const p=Rt.pts,n=Rt.n;let bi=window.__fi||0,bd=1e18;for(let k=Math.max(0,bi-5);k<Math.min(n,bi+80);k++){const d=(p[k*3]-C.x)**2+(p[k*3+2]-C.z)**2;if(d<bd){bd=d;bi=k}}window.__fi=bi;
      const S0=Rt.S[bi],at=(s)=>{let k=bi;while(k<n-1&&Rt.S[k]<s)k++;return k},k1=at(S0+Math.max(9,C.speed*.75)),k2=at(S0+45),k3=at(S0+90);
      const h0=Math.atan2(p[k1*3]-C.x,-(p[k1*3+2]-C.z)),h2=Math.atan2(p[k3*3]-p[k2*3],-(p[k3*3+2]-p[k2*3+2])),h1=Math.atan2(p[k2*3]-p[k1*3],-(p[k2*3+2]-p[k1*3+2])),bend=Math.abs(angd(h2,h1));
      const vt=Math.min(vmax,bend>.05?Math.sqrt(9*45/bend):vmax);C.steer=clamp(angd(h0,C.yaw)*1.8,-1,1);IN.thr=C.speed<vt?1:0;IN.brk=C.speed>vt+3?1:0}});
  /* 1 the list */
  const A=await T.ev(()=>({n:EV.list.length,tr:EV.list.filter(e=>e.type=='trial').map(e=>[e.id,Math.round(e.len),e.cps.length]),es:EV.list.filter(e=>e.type=='escape').length,onRoad:EV.list.every(e=>roadAt(e.s.x,e.s.z,e.s.y+1))}));
  ok(A.n==12&&A.tr.length==8&&A.es==4&&A.tr.every(t=>t[1]>1000&&t[2]>=4)&&A.onRoad,'1 12 events: 8 time trials ('+A.tr.map(t=>t[0]+' '+(t[1]/1000).toFixed(1)+' km').join(', ')+') and 4 escapes, every start on a road');
  /* 2 the marker card */
  const B=await T.ev(()=>{const ev=EV.list[0];RACER.carPlace(ev.s.x,ev.s.z,ev.s.yaw,ev.s.y+.5);for(let s=0;s<30;s++)RACER.worldStep(1/120);const o={title:EV.card&&EV.card.title,sub:EV.card&&EV.card.sub};EV.card.btns[1].act();for(let s=0;s<30;s++)RACER.worldStep(1/120);o.after=!!EV.card;return o});
  ok(B.title=='TIME TRIAL'&&B.sub=='Ring Sprint'&&!B.after,'2 stopping on a marker offers the event ("'+B.title+': '+B.sub+'"); NOT NOW puts it away');
  /* 3 a time trial driven by the bot */
  const id=process.env.EV||'t_ring';
  const C3=await T.ev((id)=>{const ev=EV.list.find(e=>e.id==id);const m0=ECON.money;evStart(ev);const Rt=evRoute(ev.s,ev.cps[ev.cps.length-1].x,ev.cps[ev.cps.length-1].z);window.__fi=0;let cpMax=0,t=0;
    for(let s=0;s<120*240&&(EV.run||t<1);s++){t=s/120;if(EV.run&&EV.run.t>=0)follow(Rt,48);if(!(s%60))for(const c of TR.cars)if(c.alive&&Math.hypot(c.x-C.x,c.z-C.z)<120&&((c.x-C.x)*C.vx+(c.z-C.z)*C.vz)>0)trKill(c,0);RACER.worldStep(1/120);if(EV.run)cpMax=Math.max(cpMax,EV.run.cp);if(!EV.run)break}
    IN.thr=IN.brk=0;const rec=EV.rec[ev.id]||{};return{card:EV.card&&EV.card.title,lines:EV.card&&EV.card.lines.map(l=>l[0]),cpMax,n:ev.cps.length,t:rec.t,medal:rec.m|0,gold:ev.gold,bronze:ev.bronze,paid:ECON.money-m0,ghost:rec.ghost?rec.ghost.s.length/4:0,cops:COP.on}},id);
  console.log('     '+JSON.stringify(C3));
  ok(C3.card=='FINISHED'&&C3.cpMax>=C3.n-1,'3 the bot drives '+id+' through all '+C3.n+' checkpoints to the finish in '+(C3.t||0).toFixed(1)+' s (gold '+C3.gold.toFixed(1)+', bronze '+C3.bronze.toFixed(1)+')');
  ok(C3.medal>=1&&C3.paid>0,'3 it wins '+['no','bronze','silver','gold'][C3.medal]+' and '+C3.paid+' money');
  ok(C3.ghost>C3.t*9&&C3.cops,'3 the run is saved as the record with its ghost ('+C3.ghost+' samples) and the police are back on');
  const D=await T.ev((id)=>{const ev=EV.list.find(e=>e.id==id);const m0=ECON.money;evStart(ev);for(let s=0;s<120*4;s++)RACER.worldStep(1/120);const g=!!(EV.rec[ev.id].ghost&&EV.run);evQuit();return{g,quit:!EV.run,paid:ECON.money-m0}},id);
  ok(D.g&&D.quit&&D.paid==0,'3 a second start shows the ghost; QUIT EVENT ends it without a prize');
  /* 4 escape the cops: two stars; once the chase is on, the car gets away (far off and out of sight); the heat cools down and the event pays. (Whether a human can shake two stars is a feel test.) */
  const E=await T.ev(()=>{const ev=EV.list.find(e=>e.id=='e_2');const m0=ECON.money;evStart(ev);let maxHeat=0,chasers=0;
    for(let s=0;s<120*8;s++){RACER.worldStep(1/120);maxHeat=Math.max(maxHeat,COP.heat);if(s%60==0)chasers=Math.max(chasers,TR.cars.filter(c=>c.alive&&c.kind==1&&c.cm>0).length)}
    const far=evAt('nt2',.5);RACER.carPlace(far.x,far.z,far.yaw,far.y+.5);for(const c of TR.cars)if(c.alive&&c.kind==1)trKill(c,0);COP.sightT=3;let tLost=-1;   /* got away unseen */
    for(let s=0;s<120*60&&EV.run;s++){IN.thr=0;C.vx=C.vz=0;RACER.worldStep(1/120);if(!EV.run&&tLost<0)tLost=s/120}
    return{card:EV.card&&EV.card.title,lines:EV.card&&EV.card.lines.map(l=>l[0]),maxHeat,chasers,paid:ECON.money-m0,tLost}});
  console.log('     '+JSON.stringify(E));
  ok(E.maxHeat==2&&E.chasers>=2&&E.card=='ESCAPED'&&E.paid==4000,'4 escape at two stars: the chase starts ('+E.chasers+' chasers), out of sight the heat is gone after '+E.tLost.toFixed(1)+' s: '+(E.lines||[]).join(', '));
  const E2=await T.ev(()=>{const ev=EV.list.find(e=>e.id=='e_2');evStart(ev);const trig=copTrigger;window.copTrigger=function(){};for(let s=0;s<120*(ev.secs+5)&&EV.run;s++){IN.thr=0;RACER.worldStep(1/120);C.vx=C.vz=0;COP.sightT=0;if(GAME.state){GAME.state=0;GAME.lock=0}COP.bust=0}window.copTrigger=trig;copClear(true);return{card:EV.card&&EV.card.title,why:EV.card&&EV.card.lines[0][0]}});
  ok(E2.card=='FAILED'&&E2.why=='OUT OF TIME','4 still wanted when the clock runs out: "'+E2.why+'"');
  /* 5 a failed event: busted while parked */
  const F=await T.ev(()=>{const ev=EV.list.find(e=>e.id=='e_3');evStart(ev);const m0=ECON.money;let st=0;for(let s=0;s<120*90&&!st;s++){IN.thr=0;RACER.worldStep(1/120);C.vx=C.vz=0;if(GAME.state)st=GAME.state}
    for(let s=0;s<120*8;s++)RACER.worldStep(1/120);return{st,card:EV.card&&EV.card.title,why:EV.card&&EV.card.lines[0][0],fine:m0-ECON.money,run:!!EV.run}});
  ok(F.st==2&&F.card=='FAILED'&&F.why=='BUSTED'&&!F.run&&F.fine>0,'5 busted during an escape: the event is failed ("'+F.why+'") and the fine is '+F.fine);
  /* 6 money: buying a car, a garage; the event list in your garage */
  const G=await T.ev(()=>{const o={};EV.card=null;CAROWN.all=false;const i=CAR_ROSTER.findIndex(d=>d.id=='m1'),p=ECON.carPrice('m1');o.price=p;delete CAROWN.owned.m1;
    ECON.money=p-1;menuOpen();menuPreview(i);menuChoose();o.poor=!CAROWN.owned.m1;ECON.money=p+500;menuChoose();o.bought=!!CAROWN.owned.m1&&ECON.money==500;menuClose();RACER.carSelect(carIndex('k1'));
    o.free=ECON.carPrice('k1');o.cheap=ECON.carPrice(CAR_ROSTER[0].id);o.dear=ECON.carPrice(CAR_ROSTER[CAR_ROSTER.length-1].id);
    const s=SAFE.pads.find(q=>!SAFE.owned[q.id]);ECON.money=20000;RACER.carPlace(s.pad.x,s.pad.z,s.yaw,s.y+.4);for(let k=0;k<120*3;k++){IN.thr=0;IN.brk=0;C.vx=C.vz=0;RACER.worldStep(1/120)}o.garage=SAFE.owned[s.id];o.left=ECON.money;
    SAFE.visit=null;for(let k=0;k<120*3;k++){IN.thr=0;IN.brk=0;C.vx=C.vz=0;RACER.worldStep(1/120)}o.list=EV.card&&EV.card.title;o.dbg=[!!SAFE.at,SAFE.visit,SAFE.at&&SAFE.at.id,C.speed,EV.dismiss&&EV.dismiss.id,GAME.state];o.items=EV.card&&EV.card.btns.length;SAFE.owned[s.id]=false;delete CAROWN.owned.m1;EV.card=null;return o});
  ok(G.poor&&G.bought,'6 a car costs money: the Mac Seven-Twenty is '+G.price+' (one short: still locked; with enough: bought, 500 left)');
  ok(G.free==0&&G.cheap<G.dear,'6 prices follow speed: the starter is free, the slowest car '+G.cheap+', the fastest '+G.dear);
  ok(G.garage&&G.left==5000,'6 stopping on a locked garage with 20,000 buys it for 15,000');
  console.log(JSON.stringify(G.dbg));ok(G.list=='EVENTS'&&G.items==13,'6 parked in your garage, the card lists all 12 events (and CLOSE)');
  console.log('errs',T.errs.length?T.errs.slice(0,3):0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
