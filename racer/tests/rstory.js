// Story mode (batch 58): plays Chapter 1 with a route-following bot. The prologue scene runs and is skipped, every event is started from its card and driven,
// and the story must move on after each one; at the end the Drifter Roadster is the car and the chapter card shows.  usage: node racer/tests/rstory.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};const LAT=+(process.env.LAT||7.5)   /* (batch 67) 7.5 m/s² of cornering, no nitro: at 6.5 the boss won some runs on Easy by a few metres */,VMAX=+(process.env.VMAX||99);
(async()=>{const T=await L.launch({q:'go=1&scale=.3&fixed=1&story=new'+'&diff='+(process.env.DIFFQ||'0'),w:300,h:200,mobile:false,traffic:true});
await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});
const out=await T.ev(([LAT,VMAX])=>{window.__storySkTest=.52;   /* (batch 92) the story's rivals are now meant to need an upgraded car; this test checks the story's FLOW with a slow bot, so it turns them down (tests/rstorydiff.js measures the real difficulty) */const log=[];const W=n=>{for(let i=0;i<n;i++)RACER.worldStep(1/120)};
  const skip=()=>{let k=0;while(STORY.dlg&&k++<50)storySceneEnd()};
  const drive=(maxS)=>{const r0=EV.run;if(!r0)return'norun';const ev=r0.ev,Rt=ev.R;let fi=0,t=0;
    while(EV.run&&t<maxS){skip();const r=EV.run;if(!r)break;if(Rt&&r.t>=0){const p=Rt.pts;let bd=1e18;for(let k=Math.max(0,fi-5);k<Math.min(Rt.n,fi+60);k++){const d=(p[k*3]-C.x)**2+(p[k*3+2]-C.z)**2;if(d<bd){bd=d;fi=k}}
        let k=fi;while(k<Rt.n-1&&Rt.S[k]<Rt.S[fi]+Math.max(12,C.speed*.55))k++;let tx=p[k*3],tz=p[k*3+2];{/* (batch 65) overtake: a car in the way ahead, aim 3.5 m to the side with more room */const hx=Math.sin(C.yaw),hz=-Math.cos(C.yaw);let blk=null,bd2=1e9;for(const o of TR.cars){if(!o.alive||o.state==1)continue;const dx=o.x-C.x,dz=o.z-C.z,f=dx*hx+dz*hz,lt=dx*-hz+dz*hx;if(f>2&&f<32&&Math.abs(lt)<2.6&&f<bd2){bd2=f;blk={lt}}}if(blk){const sd=blk.lt>0?-1:1;tx+=sd*Math.cos(C.yaw)*3.5;tz+=sd*Math.sin(C.yaw)*3.5}}C.steer=clamp(angd(Math.atan2(tx-C.x,-(tz-C.z)),C.yaw)*2.2,-1,1);
        /* speed the next 120 m of bends allow */let vt=VMAX;for(let d=6;d<Math.max(60,C.speed*3);d+=6){const a=_ra(Rt,fi,Rt.S[fi]+d),b=_ra(Rt,fi,Rt.S[fi]+d+8),c=_ra(Rt,fi,Rt.S[fi]+d+16);
          const h1=Math.atan2(p[b*3]-p[a*3],-(p[b*3+2]-p[a*3+2])),h2=Math.atan2(p[c*3]-p[b*3],-(p[c*3+2]-p[b*3+2])),kc=Math.abs(angd(h2,h1))/8;if(kc>1e-3){const vc=Math.sqrt(LAT/kc);vt=Math.min(vt,Math.sqrt(vc*vc+2*7*d))}}
        IN.thr=C.speed<vt?1:0;IN.brk=C.speed>vt+3?1:0;IN.auto=false;C.shield=Math.max(C.shield||0,.2)}   /* (batch 66) the racers can take a non-dodging bot down now: this test is about the story's flow, so the bot is shielded */
      else if(!Rt){/* escape: drive away fast along whatever road */IN.thr=1;IN.brk=0;C.steer=0;if(r.t>4)COP.heat=Math.max(0,COP.heat);}
      if(EV.run&&EV.run.racers){window.__ord=EV.run.racers.map(c=>[c.race&&c.race.name,c.race?+(c.race.done>=0?c.race.done.toFixed(1):-1):-2,c.race?c.race.s|0:0,+(c.dmg||0).toFixed(2),c.hitN|0])}W(12);t+=.1}
    return t};
  W(30);skip();W(240);log.push('after prologue: step '+STORY.step+' radio '+STORY.radio.length);const CH=+(window.__choice||0);
  /* (batch 73) the whole story: five chapters, the choice in the desert, the ending */
  for(let guard=0;guard<120;guard++){const step=storyStep();if(!step)break;const tag='c'+STORY.ch+'_'+(step.id||step.k);
    if(step.k=='choice'){W(30);skip();W(30);if(EV.card&&EV.card.btns&&EV.card.btns[CH]){log.push(tag+': choice "'+EV.card.btns[CH].label+'"');EV.card.btns[CH].act()}else{log.push(tag+': NO CHOICE CARD');break}continue}
    if(step.k=='end'){W(60);skip();W(60);const c=EV.card;log.push(tag+': end card '+(c&&c.title)+' | '+(c?c.lines.map(l=>l[0]).join(' / '):'')+' | car '+CAR_ROSTER[CARSEL.cur].name);if(c&&/THE END/.test(c.title)){c.btns[0].act();break}if(c&&c.btns)c.btns[0].act();else break;W(60);skip();continue}
    if(step.k!='ev'){W(60);skip();continue}   /* a scene, a radio step, an unlock: let it run, skip the scene */
    STORY.radio=[];STORY.rcur=null;
    if(!step.here){W(10);let e=STORY.st.ev;for(let k=0;k<20&&!e;k++){W(30);e=STORY.st.ev}if(!e){log.push(tag+': NO ROUTE (card '+(EV.card&&EV.card.title)+', run '+!!EV.run+', dlg '+!!STORY.dlg+', st '+JSON.stringify(Object.keys(STORY.st))+')');STORY.st={};storyAdvance();continue}carPlace(e.s.x,e.s.z,e.s.yaw,e.s.y+.5);C.vx=C.vz=0;for(let k=0;k<8&&!(EV.card&&EV.card.offer&&EV.card.story);k++){IN.thr=0;IN.brk=1;W(60);IN.brk=0;if(EV.card&&EV.card.offer&&!EV.card.story){EV.card=null;EV.dismiss=null}if(!EV.card||!EV.card.offer){C.vx=C.vz=0;if(EV.card&&!EV.card.offer&&EV.card.btns&&EV.card.btns.length==1)EV.card.btns[0].act()}}if(!EV.card||!EV.card.offer||!EV.card.story){log.push(tag+': no card (card '+(EV.card&&EV.card.title)+', d '+Math.hypot(C.x-e.s.x,C.z-e.s.z).toFixed(1)+', v '+C.speed.toFixed(1)+', dismiss '+STORY.st.dismiss+', dlg '+!!STORY.dlg+', radio '+(STORY.rcur?1:0)+')');break}EV.card.btns[0].act()}
    else{W(30);if(!EV.run&&EV.card&&EV.card.btns)EV.card.btns[0].act()}
    if(!EV.run){log.push(tag+': did not start');break}
    const ev=EV.run.ev;window.__ord=null;skip();
    if(step.def.type=='escape'){/* the escape: let the cops come, then drop the heat as if they lost you */W(120*6);COP.heat=0;W(240)}else drive(400);
    const card=EV.card||EV.pending;log.push(tag+': racers '+JSON.stringify(window.__ord||[])+' | '+(card?card.title+' | '+card.lines.map(l=>l[0]).join(' / '):'no card')+' | len '+(ev.len|0)+' | step now '+STORY.step);
    let cd=card,tries=1;while(cd&&cd.title=='TRY AGAIN'&&tries<3&&cd.btns&&cd.btns[0]){/* retry, like a player would */tries++;cd.btns[0].act();if(!EV.run)break;skip();if(step.def.type=='escape'){W(120*6);COP.heat=0;W(240)}else drive(400);cd=EV.card||EV.pending;log.push(tag+': retry '+tries+' | '+(cd?cd.title+' | '+cd.lines.map(l=>l[0]).join(' / '):'no card'))}
    if(tries>1&&cd&&cd.title!='TRY AGAIN')log.push('  (won on try '+tries+')');
    if(cd&&cd.title!='YOU WON'&&cd.title!='ESCAPED'){if(STORY.step==STORY_CH[STORY.ch].steps.indexOf(step)){/* failed: cheat past it so the rest gets tested */log.push('  (failed: advancing by hand)');EV.card=null;EV.pending=null;storyAdvance()}}
    else if(cd){cd.btns[0].act();skip();W(120)}}
  W(240);skip();W(240);log.push('end: ch '+STORY.ch+' step '+STORY.step+' car '+CAR_ROSTER[CARSEL.cur].name+' card '+(EV.card&&EV.card.title)+' done '+STORY.done+' flags '+JSON.stringify(STORY.flags));return log},[LAT,VMAX]);
for(const l of out)console.log('     '+(process.env.RFULL?l:l.replace(/racers \[.*?\]\] \| /,'')));
  const g=k=>out.find(l=>l.startsWith(k+':'))||'',ga=k=>out.filter(l=>l.startsWith(k+':')).join(' || ');const evs=out.filter(l=>/^c\d_\w+: racers/.test(l)),failed=out.filter(l=>/failed: advancing/.test(l)).length,noroute=out.filter(l=>/NO ROUTE|no card|did not start/.test(l));
  ok(/step 1/.test(out[0]),'1 the prologue scene plays and the story moves on to the first race');
  ok(/YOU WON/.test(ga('c1_fennec')),'2 Fennec Run (race, Warden vs three Fennec Hatches and Jules) can be won by a careful driver');
  ok(/YOU WON/.test(ga('c1_test')),"3 Deacon's Test (time trial up the coast) gets a medal");
  ok(/ESCAPED/.test(ga('c1_heat')),'4 Heat Check (escape) starts where you are and moves the story on when the cops lose you');
  ok(/YOU WON/.test(ga('c1_deacon')),"5 Deacon's Run (the boss race) can be won (within 3 tries)");
  ok(/CHAPTER 1 COMPLETE/.test(g('c1_end'))&&/Surge Sport/.test(g('c1_end')),'6 chapter 1 ends with the Surge Sport and the CHAPTER 1 COMPLETE card, and goes on to chapter 2');
  ok(!noroute.length,'7 every story event has a route and starts ('+evs.length+' events'+(noroute.length?'; '+noroute.join(' | '):'')+')');
  for(const c of [2,3,4,5])ok(/COMPLETE|THE END/.test(g('c'+c+'_end')),'8 chapter '+c+' ends: '+g('c'+c+'_end').replace(/^c\d_end: /,''));
  ok(/choice/.test(g('c4_helped')),'9 the choice in the desert: '+g('c4_helped'));
  ok(/THE END/.test(g('c5_end'))&&/done true/.test(out[out.length-1])&&/Veyra/.test(out[out.length-1]),'10 the story ends: '+out[out.length-1]);
  {const retried=out.filter(l=>/won on try/.test(l)).length;ok(failed<=Number(process.env.FAILOK||0),'11 a careful bot (no nitro, cannot dodge) wins every event within 3 tries on this difficulty: '+(evs.length-retried-failed)+' first time, '+retried+' on a retry, '+failed+' not in 3 ('+out.filter((l,i)=>/failed: advancing/.test(l)).map((l,i,a)=>'').length+(failed?': '+out.map((l,i)=>/failed: advancing/.test(l)?(out.slice(0,i).reverse().find(q=>/^c\d_\w+: (racers|\[)/.test(q))||'?').split(':')[0]:null).filter(Boolean).join(', '):'')+')')}
  ok(!T.errs.length,'errors: '+T.errs.slice(0,2).join(' | '));
  console.log(bad?bad+' FAILED':'all passed');await T.close();process.exit(bad?1:0)})().catch(e=>{console.error(e);process.exit(1)});
