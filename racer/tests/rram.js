// Ramming (batch 29): driving into a racer or a police car costs you nothing at any speed (no damage, no roll, no crash movie); a civilian car still damages you, and a cop ramming you still hurts.
// usage: node racer/tests/rram.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:300,h:200,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const r=await T.ev(()=>{const {C,IN,UI}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;IN.lane=false;COP.on=false;const R=ROADS.find(q=>q.id=='ring');
    const hit=(kind,type,v)=>{TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;dmgReset();CC.on=0;const i=Math.round(R.n*.2),t=_tan(R,i),a=Math.atan2(t[0],-t[1]),o=5.5,x=R.X[i]+Math.cos(a)*o,z=R.Z[i]+Math.sin(a)*o;
      RACER.carPlace(x,z,a,R.Y[i]+.5);const sn=navSnap(x,z,30),la=navLane(sn,x,z,Math.sin(a),-Math.cos(a)),c=trPlace(la.e,la.u,type,1,0,55);c.x=c.px=x+Math.sin(a)*30;c.z=c.pz=z-Math.cos(a)*30;c.yaw=a;c.v=0;
      c.kind=kind;if(kind){c.state=3;c.cm=kind==1?2:0;c.vx=c.vz=0;if(kind==2){c.race={Rt:{n:2,S:[0,1],pts:[c.x,c.y,c.z,c.x,c.y,c.z],len:1},fi:0,s:0,go:false,done:-1,skill:{grip:9,vmax:60,acc:6},aggr:0,off:0,offT:0,ramCd:9}}}
      const imp0=IMP.n;let tum=0,cc=0;for(let s=0;s<120*1.5;s++){C.vx=s<60?Math.sin(a)*v:C.vx;C.vz=s<60?-Math.cos(a)*v:C.vz;C.steer=0;IN.thr=0;RACER.worldStep(1/120);if(TUM.on)tum=1;if(CC.on)cc=1;if(c.hitT>0&&s>=60)break}
      dmgConsume();const res={dmg:Math.round(DMG.total/1000),hp:+DMG.hp.toFixed(2),imp:IMP.n-imp0,tum,cc,hit:c.hitT>0?1:0,state:c.state};CC.on=0;TUM.on=0;return res};
    return{cop:hit(1,4,40),racer:hit(2,10,40),swat:hit(1,22,40),civ:hit(0,0,25)}});
  console.log(JSON.stringify(r));
  ok(r.cop.hit&&r.cop.dmg==0&&r.cop.hp==1&&!r.cop.tum&&!r.cop.cc,'1 ramming a police car at 90 mph: no damage, no roll, no crash movie');
  ok(r.racer.hit&&r.racer.dmg==0&&!r.racer.tum&&!r.racer.cc,'2 ramming a racer at 90 mph: no damage');
  ok(r.swat.hit&&r.swat.dmg==0&&!r.swat.tum&&!r.swat.cc,'3 even a 9 t SWAT truck: no damage');
  ok(r.civ.hit&&r.civ.dmg>0,'4 a civilian car still damages you ('+r.civ.dmg+' kJ at 56 mph)');
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
