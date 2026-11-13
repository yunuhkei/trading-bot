// Crash cam and reset (batch 17): a wild crash plays a slow-motion cinematic, then the car is put back on the road where it was about 1.5 s before, with a 3 s spawn shield.
// usage: node racer/tests/rcrashcam.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const r=await T.ev(()=>{const {C,IN,UI}=RACER;UI.paused=true;IN.assist=true;const o={};
    const ring=ROADS.find(q=>q.id=='ring'),i0=Math.round(ring.n*.2),drive=(secs)=>{for(let s=0;s<secs*120;s++){const sn=navSnap(C.x,C.z,30);if(sn){const R_=ROADS[sn.ri],k=(sn.i+6)%R_.n;C.steer=clamp(angd(Math.atan2(R_.X[k]-C.x,-(R_.Z[k]-C.z)),C.yaw)*1.6,-1,1)}IN.thr=C.speed<30?1:0;
        if(s%60==0)for(const c of TR.cars)if(c.alive&&Math.hypot(c.x-C.x,c.z-C.z)<60)trKill(c,0);RACER.worldStep(1/120)}};
    const place=()=>{const t=_tan(ring,i0);RACER.carPlace(ring.X[i0]+Math.cos(Math.atan2(t[0],-t[1]))*4,ring.Z[i0]+Math.sin(Math.atan2(t[0],-t[1]))*4,Math.atan2(t[0],-t[1]),ring.Y[i0]+.5);C.vx=t[0]*28;C.vz=t[1]*28};
    /* 1 a hard roll at speed: the cinematic starts, the world slows down, then the car is back on the road, upright, moving, shielded */
    place();drive(4);const crashX=C.x,crashZ=C.z,ct=C.t;tumbleStart(0,0,9,7,'test roll');let tOn=-1,minScale=1,steps=0,camFixed=true,cam0=null;
    for(let s=0;s<120*6&&(CC.on||s<60);s++){RACER.worldStep(1/120);if(CC.on){if(tOn<0){tOn=s/120;cam0=CC.cam.slice()}minScale=Math.min(minScale,CC.scale);steps++;RACER.camStep(1/60,false);if(Math.hypot(CAM.x-cam0[0],CAM.z-cam0[2])>.01)camFixed=false}}
    {const B=CARM.body;let md=0,mdF=0;if(B&&B.f16&&DMG.pf16)for(let v=0;v<B.nv;v++){const q=v*8,d=Math.hypot(B.f16[q]-DMG.pf16[q],B.f16[q+1]-DMG.pf16[q+1],B.f16[q+2]-DMG.pf16[q+2])/8192;if(DMG.pf16[q+2]/8192<-(CARM.hl||2.2)*.35)mdF=Math.max(mdF,d);else md=Math.max(md,d)}
     o.after={md:+md.toFixed(3),mdF:+mdF.toFixed(3),off:PP.slice(1).filter(p=>p&&p.off).length,doors:[PP[3]&&+PP[3].min.toFixed(2),PP[4]&&+PP[4].min.toFixed(2)]}}
    const sn=navSnap(C.x,C.z,20);o.roll={tOn,minScale,camFixed,on:CC.on,tum:TUM.on,shield:+(C.shield||0).toFixed(2),speed:+C.speed.toFixed(1),onRoad:!!sn&&sn.d<ROADS[sn.ri].hw,back:Math.round(Math.hypot(C.x-crashX,C.z-crashZ)),realSec:+(steps/120).toFixed(2)};
    /* 2 the shield: no damage, no tumble, through traffic; it runs out after 3 s */
    const n0=IMP.n;impactAdd(0,30,0,1400,C.x,C.z,1,0);const tum=tumbleStart(0,0,9,7,'x');o.shield={imp:IMP.n-n0,tum,blinks:0};for(let s=0;s<120*3.2;s++){RACER.worldStep(1/120);if(crashBlink())o.shield.blinks++}o.shield.after=+(C.shield||0).toFixed(2);
    /* 3 a head-on hit flat out starts it too; 4 a slow roll onto the side does not */
    place();drive(2);impactAdd(0,40,0,1400,C.x,C.z,1,0);o.wall=CC.on;for(let s=0;s<120*4&&CC.on;s++)RACER.worldStep(1/120);
    place();drive(1);C.vx*=.15;C.vz*=.15;tumbleStart(0,0,1.6,1.2,'slow');let wild=false;for(let s=0;s<120*3;s++){RACER.worldStep(1/120);if(CC.on)wild=true}o.slow={wild,tum:TUM.on||TUM.rightT>0};
    /* 5 off: the old righting only */
    CC.enabled=false;place();drive(2);tumbleStart(0,0,9,7,'off');let on5=false;for(let s=0;s<120*2;s++){RACER.worldStep(1/120);if(CC.on)on5=true}o.off=on5;CC.enabled=true;
    return o});
  console.log(JSON.stringify(r));
  ok(r.roll.tOn>=0&&r.roll.tOn<.8&&r.roll.minScale<=.31&&r.roll.camFixed,'1 a hard roll at 100 km/h starts the cinematic after '+r.roll.tOn+' s: slow motion x'+r.roll.minScale+', the camera stays at its spot');
  ok(!r.roll.on&&!r.roll.tum&&r.roll.onRoad&&r.roll.speed>=8&&r.roll.shield>2.5&&r.roll.back>15&&r.roll.back<90,'1 then the car is back on the road '+r.roll.back+' m back, upright, at '+r.roll.speed+' m/s, shield '+r.roll.shield+' s ('+r.roll.realSec+' s of world time)');
  ok(r.after.mdF<=.061&&r.after.md<=.031&&r.after.off==0,'1 and it comes back lightly knocked about: front dents '+r.after.mdF+' m, elsewhere '+r.after.md+' m, no part missing, doors ajar '+r.after.doors.join(' / '));
  ok(r.shield.imp==0&&!r.shield.tum&&r.shield.blinks>20&&r.shield.after==0,'2 the shield: no damage, no tumble, the car blinks ('+r.shield.blinks+' hidden steps), gone after 3 s');
  ok(r.wall,'3 a head-on hit flat out starts the cinematic');
  ok(!r.slow.wild,'4 a slow roll onto the side does not (it rights itself as before)');
  ok(!r.off,'5 CC.enabled=false keeps the old behaviour');
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
