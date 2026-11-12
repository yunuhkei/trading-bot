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
  const A=await T.ev(()=>({n:EV.list.length,tr:EV.list.filter(e=>e.type=='trial').map(e=>[e.id,Math.round(e.len),e.cps.length]),es:EV.list.filter(e=>e.type=='escape').length,rg:EV.list.filter(e=>e.type=='rage').length,onRoad:EV.list.every(e=>roadAt(e.s.x,e.s.z,e.s.y+1))}));
  ok(A.n==20&&A.tr.length==8&&A.es==4&&A.rg==3&&A.tr.every(t=>t[1]>1000&&t[2]>=4)&&A.onRoad,'1 20 events: 8 time trials ('+A.tr.map(t=>t[0]+' '+(t[1]/1000).toFixed(1)+' km').join(', ')+') 4 escapes, 3 road rages, 3 races and 2 death races, every start on a road');
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
  const E=await T.ev(()=>{const ev=EV.list.find(e=>e.id=='e_2');const m0=ECON.money;COP.crimes=[];evStart(ev);let maxHeat=0,chasers=0;
    for(let s=0;s<120*8;s++){if(s%60==0)for(const c of TR.cars)if(c.alive&&c.kind==0&&Math.hypot(c.x-C.x,c.z-C.z)<120)trKill(c,0);   /* (traffic kept off the standing car: only the police count) */
      RACER.worldStep(1/120);maxHeat=Math.max(maxHeat,COP.heat);if(s%60==0)chasers=Math.max(chasers,TR.cars.filter(c=>c.alive&&c.kind==1&&c.cm>0).length)}
    const far=evAt('nt2',.5);RACER.carPlace(far.x,far.z,far.yaw,far.y+.5);for(const c of TR.cars)if(c.alive&&c.kind==1)trKill(c,0);COP.sightT=3;let tLost=-1;   /* got away unseen */
    for(let s=0;s<120*60&&EV.run;s++){IN.thr=0;C.vx=C.vz=0;RACER.worldStep(1/120);if(!EV.run&&tLost<0)tLost=s/120}
    return{card:EV.card&&EV.card.title,lines:EV.card&&EV.card.lines.map(l=>l[0]),maxHeat,chasers,paid:ECON.money-m0,tLost,crimes:(COP.crimes||[]).slice(-4)}});
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
  console.log(JSON.stringify(G.dbg));ok(G.list=='EVENTS'&&G.items==21,'6 parked in your garage, the card lists all 20 events (and CLOSE)');
  /* 7 road rage: a row of parked cars down the ring; every wreck counts and adds 4 s */
  const H=await T.ev(()=>{const ev=EV.list.find(e=>e.id=='r_ring');const m0=ECON.money;evStart(ev);for(let s=0;s<120*3.2;s++)RACER.worldStep(1/120);const r=ROADS.find(q=>q.id=='ring'),e=LG.ofRoad[ROADS.indexOf(r)][0][0];const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw);
    const sn=navSnap(C.x,C.z,30),la=navLane(sn,C.x,C.z,fx,fz);for(let k=0;k<8;k++){const c=trPlace(la.e,Math.min(la.e.n-2,(la.u+10+k*11)%la.e.n),0,1,0,900+k);if(c){c.v0f=0;c.v=0}}   /* standing cars in your lane */
    const row=TR.cars.filter(c=>c.alive&&c.seed>=900&&c.seed<908);const w0=EV.run.wrecks;for(let s=0;s<120*25&&EV.run;s++){const tg=row.find(c=>c.state==0&&((c.x-C.x)*Math.sin(C.yaw)-(c.z-C.z)*Math.cos(C.yaw))>-2);if(tg)C.steer=clamp(angd(Math.atan2(tg.x-C.x,-(tg.z-C.z)),C.yaw)*2,-1,1);IN.thr=C.speed<17?1:0;RACER.worldStep(1/120)}const o={wrecks:EV.run?EV.run.wrecks:-1,bonus:EV.run?EV.run.bonus:-1,cops:COP.on};
    for(let s=0;s<120*120&&EV.run;s++){IN.thr=0;RACER.worldStep(1/120)}IN.thr=0;o.card=EV.card&&EV.card.title;o.lines=EV.card&&EV.card.lines.map(l=>l[0]);o.paid=ECON.money-m0;o.copsAfter=COP.on;return o});
  console.log('     '+JSON.stringify(H));
  ok(H.wrecks>=3&&H.bonus==H.wrecks*4&&!H.cops,'7 road rage: driving down a row of cars wrecks '+H.wrecks+' (+'+H.bonus+' s on the clock), no police');
  ok(H.card=='TIME UP'&&H.copsAfter,'7 at the end: '+(H.lines||[]).join(', ')+', the police are back');
  /* 8 speed trap, jump spot, drift zone */
  const K=await T.ev(()=>{const o={};EV.card=null;for(const sp of SPOTS.list)delete EV.rec[sp.id];const m0=ECON.money;
    const tr=SPOTS.list.find(s=>s.type=='trap');const yaw=Math.atan2(tr.t[0],-tr.t[1]);RACER.carPlace(tr.x-tr.t[0]*120,tr.z-tr.t[1]*120,yaw,tr.y+.5);C.vx=tr.t[0]*50;C.vz=tr.t[1]*50;
    for(let s=0;s<120*4;s++){C.steer=0;IN.thr=1;RACER.worldStep(1/120)}IN.thr=0;o.trap=(EV.rec[tr.id]||{}).v;o.trapMsg=SAFE.msg;
    const jp=SPOTS.list.find(s=>s.type=='jump'),sn=navSnap(jp.x,jp.z,40),r=ROADS[sn.ri];let k0=sn.i-Math.round(260/r.ds);const t0=_tan(r,k0),a0=Math.atan2(t0[0],-t0[1]);RACER.carPlace(r.X[k0]+Math.cos(a0)*5,r.Z[k0]+Math.sin(a0)*5,a0,r.Y[k0]+.5);C.vx=t0[0]*45;C.vz=t0[1]*45;
    for(let s=0;s<120*8;s++){const sn2=navSnap(C.x,C.z,30);if(sn2){const i=Math.min(r.n-1,sn2.i+Math.round(25/r.ds));C.steer=clamp(angd(Math.atan2(r.X[i]+Math.cos(a0)*5-C.x,-(r.Z[i]+Math.sin(a0)*5-C.z)),C.yaw)*1.5,-1,1)}IN.thr=C.speed<45?1:0;RACER.worldStep(1/120)}IN.thr=0;o.jump=(EV.rec[jp.id]||{}).v;o.jumpMsg=SAFE.msg;
    const dz=SPOTS.list.find(s=>s.type=='drift'),R=ROADS[dz.ri];const i0=Math.max(2,dz.i0-8),t2=_tan(R,i0);RACER.carPlace(R.X[i0],R.Z[i0],Math.atan2(t2[0],-t2[1]),R.Y[i0]+.5);
    for(let s=0;s<120*60;s++){const sn3=navSnap(C.x,C.z,30);if(sn3){const i=Math.min(R.n-1,sn3.i+Math.round(14/R.ds));C.steer=clamp(angd(Math.atan2(R.X[i]-C.x,-(R.Z[i]-C.z)),C.yaw)*1.8,-1,1)}IN.thr=C.speed<16?1:0;C.driftScore=(C.driftScore||0)+.5;if(s%60==0)for(const c of TR.cars)if(c.alive&&Math.hypot(c.x-C.x,c.z-C.z)<90)trKill(c,0);RACER.worldStep(1/120);   /* (the bot steers by the centre line only: keep the traffic off it) */if((EV.rec[dz.id]||{}).v!=null)break}
    IN.thr=0;o.drift=(EV.rec[dz.id]||{}).v;o.driftMsg=SAFE.msg;o.paid=ECON.money-m0;return o});
  console.log('     '+JSON.stringify(K));
  ok(K.trap>150,'8 a speed trap records '+K.trap+' km/h ("'+K.trapMsg+'")');
  ok(K.jump>15,'8 a jump spot records a '+K.jump+' m jump ("'+K.jumpMsg+'")');
  ok(K.drift>100,'8 a drift zone adds up the drift points between its gates: '+K.drift+' ("'+K.driftMsg+'")');
  ok(K.paid==1500,'8 each first record pays 500 ('+K.paid+')');
  /* 9 a race: 4 AI racers on the grid; the bot drives the route; racers keep going and the order is kept; the result has a place */
  const Rr=await T.ev(()=>{const ev=EV.list.find(e=>e.id=='x_desert');const m0=ECON.money;EV.card=null;evStart(ev);const n0=EV.run.racers.length;const Rt=ev.R;window.__fi=0;let minV=1e9,racerProg=[],pos=[];
    for(let s=0;s<120*300&&EV.run;s++){if(EV.run.t>=0)follow(Rt,46);if(s%60==0)for(const c of TR.cars)if(c.alive&&c.kind==0&&[C].concat(EV.run.racers).some(q=>Math.hypot(c.x-q.x,c.z-q.z)<80))trKill(c,0);   /* (the bot does not dodge traffic or wrecks: the traffic is kept off the race) */
      RACER.worldStep(1/120);if(s%600==0&&EV.run&&EV.run.t>2){racerProg.push(EV.run.racers.filter(c=>c.race).map(c=>Math.round(c.race.s)).join('/'));pos.push(1+EV.run.racers.filter(q=>q.race&&(q.race.done>=0||q.race.s>EV.run.ps)).length)}}
    IN.thr=IN.brk=0;return{n0,card:EV.card&&EV.card.title,lines:EV.card&&EV.card.lines.map(l=>l[0]),paid:ECON.money-m0,racerProg:racerProg.slice(0,6),pos,len:Math.round(ev.len)}});
  console.log('     '+JSON.stringify(Rr));
  ok(Rr.n0==4&&Rr.card=='FINISHED'&&/OF 5/.test((Rr.lines||[''])[0]),'9 a race against '+Rr.n0+' racers over '+(Rr.len/1000).toFixed(1)+' km finishes: '+(Rr.lines||[]).join(', '));
  ok(Rr.racerProg.length>=3&&Rr.racerProg[2].split('/').every((v,i)=>+v>+Rr.racerProg[0].split('/')[i]+300),'9 the racers drive the route (progress in metres every 5 s: '+Rr.racerProg.slice(0,3).join('  ')+')');
  /* 10 a death race: the racers ram you; a racer you hit hard is wrecked and scores 500 */
  const Dr=await T.ev(()=>{const ev=EV.list.find(e=>e.id=='d_ring');EV.card=null;EV.pending=null;evStart(ev);const Rt=ev.R;window.__fi=0;let hits=0;const imp0=IMP.n;DMG.scale=0;
    for(let s=0;s<120*30&&EV.run;s++){if(EV.run.t>=0)follow(Rt,24);RACER.worldStep(1/120)}for(let k=imp0;k<IMP.n;k++){const q=IMP.q[IMP.q.length-(IMP.n-k)];if(q&&q.src==3)hits++}
    const tgt=EV.run&&EV.run.racers.find(c=>c.race&&c.state==3);let wrecked=0;if(tgt){const fx=Math.sin(tgt.yaw),fz=-Math.cos(tgt.yaw);const ah=tgt.v*.25;RACER.carPlace(tgt.x+fx*ah+Math.cos(tgt.yaw)*9,tgt.z+fz*ah+Math.sin(tgt.yaw)*9,tgt.yaw-Math.PI/2,tgt.y+.5);C.vx=-Math.cos(tgt.yaw)*32;C.vz=-Math.sin(tgt.yaw)*32;for(let s=0;s<120;s++)RACER.worldStep(1/120);wrecked=EV.run?EV.run.wrecks:-1}
    const n=EV.run?EV.run.racers.length:0;DMG.scale=1;evQuit();return{hits,wrecked,n,state:tgt?tgt.state:-1}});
  console.log('     '+JSON.stringify(Dr));
  ok(Dr.n==5&&Dr.hits>=1,'10 a death race: 5 racers, they hit you '+Dr.hits+' times in 30 s (the bot drives at 86 km/h)');
  ok(Dr.wrecked==1&&Dr.state==1,'10 T-boning a racer at 115 km/h wrecks it and counts (+500)');
  /* 11 a street racer: it joins the traffic ahead, drive up beside it and it challenges you; RACE! starts a race to a town */
  const Sr=await T.ev(()=>{EV.card=null;EV.pending=null;if(EV.run)evQuit();const r=ROADS.find(q=>q.id=='ring'),i=Math.round(r.n*.42),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));RACER.carPlace(r.X[i]+Math.cos(a)*5,r.Z[i]+Math.sin(a)*5,a,r.Y[i]+.5);C.vx=Math.sin(a)*25;C.vz=-Math.cos(a)*25;C.speed=25;
    RACE.sr=null;racerStreetSpawn();const c=RACE.sr;if(!c)return{spawn:0};const o={spawn:1,d0:Math.round(Math.hypot(c.x-C.x,c.z-C.z))};RACER.carPlace(c.x-Math.sin(c.yaw)*9+Math.cos(c.yaw)*3,c.z+Math.cos(c.yaw)*9+Math.sin(c.yaw)*3,c.yaw,c.y+.5);
    for(let s=0;s<120*4&&!EV.card;s++){C.vx=Math.sin(c.yaw)*c.v;C.vz=-Math.cos(c.yaw)*c.v;C.speed=c.v;RACER.worldStep(1/120)}o.card=EV.card&&EV.card.title;o.sub=EV.card&&EV.card.sub;if(EV.card)EV.card.btns[0].act();o.run=!!EV.run;o.racers=EV.run?EV.run.racers.length:0;o.going=EV.run&&EV.run.racers[0].race.go;evQuit();return o});
  console.log('     '+JSON.stringify(Sr));
  ok(Sr.spawn&&Sr.card=='STREET RACE'&&Sr.run&&Sr.racers==1&&Sr.going,'11 a street racer appears '+Sr.d0+' m ahead; driving up beside it it offers "'+Sr.sub+'"; RACE! starts it');
  console.log('errs',T.errs.length?T.errs.slice(0,3):0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
