// Story mode (batch 58): plays Chapter 1 with a route-following bot. The prologue scene runs and is skipped, every event is started from its card and driven,
// and the story must move on after each one; at the end the Magnet Muscle is the car and the chapter card shows.  usage: node racer/tests/rstory.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};const LAT=+(process.env.LAT||6.5),VMAX=+(process.env.VMAX||99);
(async()=>{const T=await L.launch({q:'go=1&scale=.3&fixed=1&story=new',w:300,h:200,mobile:false,traffic:true});
await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});
const out=await T.ev(([LAT,VMAX])=>{const log=[];const W=n=>{for(let i=0;i<n;i++)RACER.worldStep(1/120)};
  const skip=()=>{let k=0;while(STORY.dlg&&k++<50)storySceneEnd()};
  const drive=(maxS)=>{const r0=EV.run;if(!r0)return'norun';const ev=r0.ev,Rt=ev.R;let fi=0,t=0;
    while(EV.run&&t<maxS){skip();const r=EV.run;if(!r)break;if(Rt&&r.t>=0){const p=Rt.pts;let bd=1e18;for(let k=Math.max(0,fi-5);k<Math.min(Rt.n,fi+60);k++){const d=(p[k*3]-C.x)**2+(p[k*3+2]-C.z)**2;if(d<bd){bd=d;fi=k}}
        let k=fi;while(k<Rt.n-1&&Rt.S[k]<Rt.S[fi]+Math.max(12,C.speed*.55))k++;C.steer=clamp(angd(Math.atan2(p[k*3]-C.x,-(p[k*3+2]-C.z)),C.yaw)*2.2,-1,1);
        /* speed the next 120 m of bends allow */let vt=VMAX;for(let d=6;d<Math.max(60,C.speed*3);d+=6){const a=_ra(Rt,fi,Rt.S[fi]+d),b=_ra(Rt,fi,Rt.S[fi]+d+8),c=_ra(Rt,fi,Rt.S[fi]+d+16);
          const h1=Math.atan2(p[b*3]-p[a*3],-(p[b*3+2]-p[a*3+2])),h2=Math.atan2(p[c*3]-p[b*3],-(p[c*3+2]-p[b*3+2])),kc=Math.abs(angd(h2,h1))/8;if(kc>1e-3){const vc=Math.sqrt(LAT/kc);vt=Math.min(vt,Math.sqrt(vc*vc+2*7*d))}}
        IN.thr=C.speed<vt?1:0;IN.brk=C.speed>vt+3?1:0;IN.auto=false}
      else if(!Rt){/* escape: drive away fast along whatever road */IN.thr=1;IN.brk=0;C.steer=0;if(r.t>4)COP.heat=Math.max(0,COP.heat);}
      if(EV.run&&EV.run.racers){window.__ord=EV.run.racers.map(c=>[c.race&&c.race.name,c.race?+(c.race.done>=0?c.race.done.toFixed(1):-1):-2,c.race?c.race.s|0:0])}W(12);t+=.1}
    return t};
  skip();W(240);log.push('after prologue: step '+STORY.step+' radio '+STORY.radio.length);
  for(let guard=0;guard<6;guard++){const step=storyStep();if(!step)break;if(step.k!='ev'){W(60);continue}
    STORY.radio=[];STORY.rcur=null;
    if(!step.here){W(10);const e=STORY.st.ev;if(!e){log.push(step.id+': NO ROUTE');break}carPlace(e.s.x,e.s.z,e.s.yaw,e.s.y+.5);C.vx=C.vz=0;W(60);if(!EV.card){log.push(step.id+': no card');break}EV.card.btns[0].act()}
    else{W(30);if(!EV.run&&EV.card&&EV.card.btns)EV.card.btns[0].act()}
    if(!EV.run){log.push(step.id+': did not start');break}
    const ev=EV.run.ev;window.__ord=null;skip();
    if(step.def.type=='escape'){/* the escape: let the cops come, then drop the heat as if they lost you */W(120*6);COP.heat=0;W(240)}else drive(400);
    const card=EV.card||EV.pending;log.push(step.id+': racers '+JSON.stringify(window.__ord||[])+' | '+(card?card.title+' | '+card.lines.map(l=>l[0]).join(' / '):'no card')+' | len '+(ev.len|0)+' | step now '+STORY.step);
    if(card&&card.title!='YOU WON'&&card.title!='ESCAPED'){if(STORY.step==STORY_CH[1].steps.indexOf(step)){/* failed: cheat past it so the rest gets tested */log.push('  (failed: advancing by hand)');EV.card=null;EV.pending=null;storyAdvance()}}
    else if(card){card.btns[0].act();skip();W(120)}}
  W(240);skip();W(240);log.push('end: step '+STORY.step+' car '+CAR_ROSTER[CARSEL.cur].name+' card '+(EV.card&&EV.card.title)+' done '+STORY.done);return log},[LAT,VMAX]);
for(const l of out)if(!/racers/.test(l))console.log('     '+l);
  const g=k=>out.find(l=>l.startsWith(k+':'))||'';
  ok(/step 1/.test(out[0]),'1 the prologue scene plays and the story moves on to the first race');
  ok(/YOU WON/.test(g('fennec')),'2 Fennec Run (race, Warden vs three Fennec Hatches and Jules) can be won by a careful driver');
  ok(/YOU WON/.test(g('test')),"3 Deacon's Test (time trial up the coast) gets a medal");
  ok(/ESCAPED/.test(g('heat')),'4 Heat Check (escape) starts where you are and moves the story on when the cops lose you');
  ok(/YOU WON/.test(g('deacon')),"5 Deacon's Run (the boss race) can be won");
  ok(/Magnet Muscle/.test(out[out.length-1])&&/CHAPTER 1 COMPLETE/.test(out[out.length-1]),'6 the chapter ends with the Magnet Muscle and the CHAPTER 1 COMPLETE card');
  ok(!T.errs.length,'errors: '+T.errs.slice(0,2).join(' | '));
  console.log(bad?bad+' FAILED':'all passed');await T.close();process.exit(bad?1:0)})().catch(e=>{console.error(e);process.exit(1)});
