// Cops and racers wear down (batch 24): repeated medium hits add up and destroy them, as one big hit does.
// usage: node racer/tests/rwear.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:300,h:200,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const r=await T.ev(()=>{const {C,UI}=RACER;UI.paused=true;COP.on=true;const o={};
    const wear=(mk)=>{const c=mk();if(!c)return null;c.state=3;let n=0;const B={};while(c.state==3&&n<20){trBody(B,c);HIT.cx=c.x+Math.sin(c.yaw)*c.hl;HIT.cz=c.z-Math.cos(c.yaw)*c.hl;TR.hitP=1;TR.hitF=1;trBack(B,c,60000);TR.hitP=0;TR.hitF=0;n++}return{hits:n,state:c.state,dmg:+(c.dmg||0).toFixed(2),cm:c.cm}};
    o.cop=wear(()=>{const c=trSpawnCop(true);if(c){c.cm=1}return c});
    o.racer=wear(()=>{const c=TR.cars.find(q=>q.alive&&q.kind==0);if(c){c.kind=2;c.race=null}return c});
    /* a cop that keeps ramming you wears only from the hard rams */
    {const c=TR.cars.find(q=>q.alive&&q.kind==0&&q.state==0);if(c){c.kind=1;c.dmg=0;c.state=3;c.cm=1;const B={};for(let k=0;k<10;k++){trBody(B,c);HIT.cx=c.x;HIT.cz=c.z;TR.hitP=1;TR.hitF=0;trBack(B,c,30000);TR.hitP=0}o.pin={state:c.state,dmg:+(c.dmg||0).toFixed(2)}}}
    /* one light tap does not */
    const c2=TR.cars.find(q=>q.alive&&q.kind==0&&q.state==0);if(c2){c2.kind=1;c2.dmg=0;c2.state=3;c2.cm=1;const B={};trBody(B,c2);HIT.cx=c2.x;HIT.cz=c2.z;trBack(B,c2,20000);o.tap=c2.state}
    return o});
  console.log(JSON.stringify(r));
  ok(r.cop&&r.cop.state==1&&r.cop.hits>=2&&r.cop.hits<=8,'1 a chasing cop is destroyed by '+(r.cop&&r.cop.hits)+' hits of 60 kJ (damage '+(r.cop&&r.cop.dmg)+')');
  ok(r.racer&&r.racer.state==1&&r.racer.hits<=8,'2 a racer the same: '+(r.racer&&r.racer.hits)+' hits');
  ok(r.pin&&r.pin.state==3&&r.pin.dmg==0,'3 a cop pushing you ten times at 30 kJ (pinning you for a bust) does not wear (damage '+(r.pin&&r.pin.dmg)+')');
  ok(r.tap==3,'3 one light tap leaves a cop chasing');
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
