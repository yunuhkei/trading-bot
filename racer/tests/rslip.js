// (batch 72) slipstream only behind racers, only at 100 mph or more, no HUD; racers' nitro is weaker than yours and not fired in answer to you; the story mission is a map blip.  usage: node racer/tests/rslip.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:300,h:200,mobile:false,traffic:true});
await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});
const S=await T.ev(()=>{const r=ROADS.find(q=>q.id=='ring'),i=Math.round(r.n*.3),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));RACER.carPlace(r.X[i],r.Z[i],a,r.Y[i]+.5);
  const fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw);TR.cars.forEach(c=>{if(c.alive)trKill(c,0)});const c=TR.cars[0];c.alive=1;TR.nAlive++;c.state=3;c.cm=0;c.hl=2.2;c.hw=.95;c.yaw=C.yaw;c.y=C.y;
  const tow=(kind,myV,itsV)=>{c.kind=kind;c.x=C.x+fx*12;c.z=C.z+fz*12;c.vx=fx*itsV;c.vz=fz*itsV;c.v=itsV;C.vx=fx*myV;C.vz=fz*myV;C.speed=myV;SLIP.k=0;for(let s=0;s<240;s++)slipTick(1/120);return +SLIP.k.toFixed(2)};
  const o={traffic:tow(0,50,52),cop:tow(1,50,52),racer90:tow(2,40,52),racer112:tow(2,50,52)};c.alive=0;TR.nAlive--;
  o.hudEmpty=slipHud.toString().replace(/\s/g,'')=='functionslipHud(){}';o.nz=RACER_NZ;return o});
ok(S.traffic==0&&S.cop==0,'1 tucked in 12 m behind a traffic car or a police car at 112 mph: no slipstream ('+S.traffic+', '+S.cop+')');
ok(S.racer90==0&&S.racer112>.5,'1 behind a racer: none at 90 mph ('+S.racer90+'), a full tow at 112 mph ('+S.racer112+')');
ok(S.hudEmpty,'1 no SLIPSTREAM label, bar or screen lines (only the streaks of air off the racer)');
ok(Math.abs(S.nz-1.26)<1e-6,'2 (batch 84) a racer\'s nitro adds '+Math.round((S.nz-1)*100)+' % top speed, as yours does, from a tank it earns');
/* 2 a race: you boost alongside the racers; none of them lights its nitro in answer */
const R=await T.ev(()=>{const ev=EV.list.find(e=>e.type=='race');EV.card=null;evStart(ev);let s=0;for(;s<120*12&&EV.run;s++){IN.thr=1;IN.lane=true;C.shield=1;RACER.worldStep(1/120)}
  let answered=0,fired=0,tries=0;for(let k=0;k<6&&EV.run;k++){C.nos=1;nitroTap();tries++;const before=new Map(EV.run.racers.map(c=>[c,(c.race&&c.race.nzT)>0]));
    for(s=0;s<60&&EV.run;s++){IN.thr=1;C.shield=1;RACER.worldStep(1/120)}
    for(const c of EV.run.racers){const d=Math.hypot(c.x-C.x,c.z-C.z);if(c.race&&c.race.nzT>0&&!before.get(c)&&d<20)answered++}for(s=0;s<120*3&&EV.run;s++){IN.thr=1;C.shield=1;RACER.worldStep(1/120);for(const c of EV.run.racers)if(c.race&&c.race.nzT>0)fired=1}}
  if(EV.run)evQuit&&evQuit();EV.card=null;return{answered,fired,tries}});
ok(R.answered<=1,'2 '+R.tries+' boosts of yours in a race: racers within 20 m that lit their nitro in the next half second: '+R.answered+' (they used to answer every time)');
ok(R.fired==1,'2 the racers still use their nitro on their own');
/* 3 the story mission is a blip on the map */
const B=await T.ev(()=>{storyBegin(true);for(let k=0;k<60&&!(STORY.st&&STORY.st.ev);k++){while(STORY.dlg)storySceneEnd();for(let s=0;s<60;s++)RACER.worldStep(1/120)}const b=mapBlips().find(q=>/STORY/.test(q.tag||''));return b?{title:b.title,tag:b.tag,lines:b.lines}:null});
ok(B&&B.title&&B.lines.length>=2,'3 the story mission is a map blip: '+JSON.stringify(B));
ok(!T.errs.length,'errors: '+T.errs.slice(0,2).join(' | '));
console.log(bad?bad+' FAILED':'all passed');await T.close();process.exit(bad?1:0)})().catch(e=>{console.error(e);process.exit(1)});
