'use strict';
/* ===== (batch 58) STORY MODE: "Nobody's Car", told through KZRO 88.8 =====
   You roll into the county in the slowest car there is (a Warden SUV) and take the regions from the crews one by one. DJ Static (pirate radio, KZRO 88.8) narrates everything;
   Margo (the gas station on the coast) is your mentor; Jules Marrow (a beat-up Kestrel S) is the rival who has been trying for three years.
   A CHAPTER is a list of steps: SCENES (the car stops, letterbox bars, the camera cuts between shots, dialogue line by line; tap to go on, SKIP to skip) and EVENTS (a gold beam on the map:
   drive into it and a card offers it; the story's own races / time trials / escapes, run by the event code with named racers in fixed cars; pass to move on, or RETRY as often as you like).
   Between steps the RADIO talks over your driving (a panel at the top, never stops the game). Progress is saved after every step (localStorage 'racer.story').
   VOICES: every line has an id (c1_prologue_03 ...); a recorded line in VOXB64 (racer/assets/vox/<id>.mp3, embedded by build.py) is played with it, radio lines through a radio filter;
   without one the text alone shows, timed by its length. tools/story_lines.js lists every line for recording (racer/story/lines.csv). */
const STORY={on:false,open:false,prevCar:null,ch:1,step:0,car:'cc_h_warden',cars:{cc_h_warden:1},pos:null,key:'racer.story',
  dlg:null,radio:[],rcur:null,camOn:false,shot:'front',shotT:0,actor:null,st:{},curEv:null,title:0,done:false,vox:{},voxSrc:null};
const VOXB64={/*VOXB64*/};
const STORY_WHO={STATIC:{n:'DJ STATIC',c:'#ff8a2a',radio:1},MARGO:{n:'MARGO',c:'#5fd4c4'},JULES:{n:'JULES',c:'#ff5a6a'},DEACON:{n:'DEACON',c:'#ffc23d'},YOU:{n:'YOU',c:'#e8eef2'},FENNEC:{n:'FENNEC BOYS',c:'#9be070'},'':{n:'',c:'#cfe9f5'}};
/* Chapter 1: THE COAST (Pacifica, Santa Cruz, Gilroy). Lines: [who, text, {s: camera shot, a: action, r: on the radio}] */
const STORY_CH={1:{name:'THE COAST',steps:[
 {k:'scene',id:'prologue',at:'gas',actor:{car:'k1',name:'JULES',place:'behind'},obj:'',lines:[
  ['STATIC',"Gooood morning, county. KZRO 88.8, the frequency the cops can't find.",{s:'wide'}],
  ['STATIC',"Scanner says a fresh face just rolled up the coast highway in a... hold up. A Warden?"],
  ['STATIC',"Somebody check on this person.",{s:'front'}],
  ['MARGO',"That thing still runs?",{s:'side'}],
  ['YOU',"Barely."],
  ['MARGO',"Then you're in the wrong county. Out here they don't race for pink slips. They race for turf."],
  ['MARGO',"Five crews. Five regions. You wanna eat, you win."],
  ['',"A beat-up Kestrel pulls in hard.",{s:'actor',a:'actorGo'}],
  ['JULES',"Margo. Fill it. I'll pay Friday."],
  ['MARGO',"You said that last Friday.",{s:'side'}],
  ['JULES',"...Who's the tourist?",{s:'two'}],
  ['MARGO',"New driver."],
  ['JULES',"In THAT? Ha. Coast crew's gonna eat you alive."],
  ['',"Jules leaves. Without paying.",{s:'actor',a:'actorLeave'}],
  ['MARGO',"Don't mind Jules. Three years racing the crews. Never beat one.",{s:'front'}],
  ['MARGO',"Start with the Fennec boys down the 1. They drive hatchbacks. Even you can handle hatchbacks."],
  ['STATIC',"Here's how it works, Nobody. Every win, I play you on the air.",{s:'wide'}],
  ['STATIC',"Every loss? I play you on the air louder. Let's ride."]]},
 {k:'ev',id:'fennec',obj:'Race the Fennec boys to Santa Cruz',need:'win',
  def:{type:'race',name:'Fennec Run',diff:1,from:['cr',.42],to:['btp',.5],prize:3000,
   lineup:[{car:'cc_n_courier',name:'TY',sk:.78,aggr:0},{car:'cc_n_courier',name:'DUKE',sk:.76,aggr:0},{car:'cc_n_courier',name:'SKIP',sk:.74,aggr:0},{car:'k1',name:'JULES',who:'JULES',sk:.62}]},
  drive:[['STATIC',"The coast belongs to the Surfboard Mafia. Deacon's crew."],
   ['STATIC',"Their little brothers, the Fennec boys, race the 1 every morning. Start there."],
   ['STATIC',"Oh, and Jules signed up too. That Kestrel's held together with zip ties. But Jules can drive."]],
  pre:[['FENNEC',"Yo Static! Put us on! New kid showed up in a MAILBOX!",{s:'grid',r:1}],
   ['STATIC',"You heard 'em, county. Fennec boys, Jules, and... the Warden. Lights out in three."]],
  winScene:{lines:[['JULES',"...Lucky.",{s:'front',r:1}],
   ['MARGO',"Heard you beat the Fennec boys. Don't let it go to your head. They drive hatchbacks.",{r:1}],
   ['STATIC',"First W on the board! In a Warden, county. Write that down.",{s:'high'}]]},
  lose:[['STATIC',"Ooh. That one's going on the air all week. Run it back, Nobody."]]},
 {k:'open',id:'open',lines:[['STATIC',"Okay, Nobody. The county's yours now. Story jobs show up gold on your map."],
   ['STATIC',"Everything else out there? Races, time trials, cops. Go get paid."],
   ['MARGO',"And buy yourself a real car when you can afford one, kid.",{r:1}]]},
 {k:'ev',id:'test',obj:"Beat Deacon's time up the coast",need:'medal',
  def:{type:'trial',name:"Deacon's Test",diff:1,from:['cr',.95],to:['cr',.3]},
  drive:[['DEACON',"Yo Static, put me on.",{r:1}],
   ['STATIC',"Live on the air, it's Deacon! Runs the Surfboard Mafia. Talks like a tide chart."],
   ['DEACON',"Hey, Warden. You wanna race the Mafia? Cool. Run the 1 back up to Pacifica under my time first. Brah.",{r:1}]],
  win:[['DEACON',"...Okay. Okay, that's a time. Not bad for a mailbox.",{r:1}],
   ['STATIC',"Uh oh. Hold on. Scanner's lighting up. Coast cops clocked that run, Nobody."]],
  lose:[['DEACON',"Bro. My grandma runs it faster. Again.",{r:1}]]},
 {k:'ev',id:'heat',obj:'Lose the cops',need:'escape',here:1,
  def:{type:'escape',name:'Heat Check',stars:2,secs:180},
  pre:[['STATIC',"You got heat! Two stars and climbing.",{s:'high'}],
   ['STATIC',"Lose 'em before Deacon sees you sweat. Break line of sight. They go where they last saw you."]],
  win:[['STATIC',"Clean getaway! The scanner's crying. I love it."],
   ['DEACON',"Aight, Warden. The 1, down to the southern highway. You and me. Bring the mailbox.",{r:1}]],
  lose:[['STATIC',"Busted. In a Warden. That's a new low for this county. Try again."]]},
 {k:'ev',id:'deacon',obj:'Beat Deacon',need:'win',
  def:{type:'race',name:"Deacon's Run",diff:1,from:['cr',.5],to:['sh',.15],prize:8000,
   lineup:[{car:'cc_n_drifter',name:'DEACON',who:'DEACON',sk:.79},{car:'cc_coupe',name:'LOOSE',sk:.75},{car:'cc_coupe',name:'KAHUNA',sk:.73}]},   /* (batch 71) Deacon drives the Drifter Roadster: the prize is one rung above your Warden (it was the Magnet Muscle, eight rungs up) */
  drive:[['MARGO',"Deacon's been racing the 1 since before you had a license. He'll lean on you in the corners.",{r:1}],
   ['MARGO',"Lean back.",{r:1}]],
  pre:[['DEACON',"You came up the 1 in a Warden? That's not a car, that's a mailbox.",{s:'grid',r:1}],
   ['STATIC',"Main event, county! Deacon versus Nobody. Winner runs the coast!"]],
  winScene:{actor:{car:'k1',name:'JULES',place:'ahead'},lines:[['DEACON',"...Take the Drifter. Keys are in it.",{s:'front',r:1}],
   ['DEACON',"And tell Margo she still owes me twenty bucks.",{r:1}],
   ['DEACON',"Funny. Jules has been trying to take my car for two years. You did it in a week.",{r:1}],
   ['',"Up the road, a beat-up Kestrel sits idling. Then it pulls away.",{s:'actor',a:'actorLeave'}],
   ['STATIC',"THE MAFIA IS SINKING! Nobody takes the coast!",{s:'high'}],
   ['MARGO',"Not bad, kid. The Valley's next. They don't drive hatchbacks.",{s:'front',r:1}]]},
  lose:[['DEACON',"Hang ten, brah. Come back when that mailbox learns to turn.",{r:1}]]},
 {k:'unlock',car:'cc_n_drifter',name:'DRIFTER ROADSTER'},
 {k:'end',next:'Chapter 2: The Valley'}]}};
/* line ids for voices: c<chapter>_<step id>_<part>_<nn> */
for(const ch in STORY_CH)for(const s of STORY_CH[ch].steps){const tag=(k,L)=>{if(L)L.forEach((l,i)=>{l[2]=l[2]||{};l[2].id='c'+ch+'_'+(s.id||s.k)+'_'+k+'_'+String(i+1).padStart(2,'0')})};
  tag('l',s.lines);tag('drive',s.drive);tag('pre',s.pre);tag('win',s.win);tag('lose',s.lose);if(s.winScene)tag('ws',s.winScene.lines)}
/* ---- saving ---- */
function storyLoad(){try{const j=JSON.parse(localStorage.getItem(STORY.key)||'null');if(j){STORY.ch=j.ch||1;STORY.step=j.step|0;STORY.car=j.car||'cc_h_warden';STORY.cars=j.cars||{cc_h_warden:1};if(STORY.cars.cc_n_magnet){delete STORY.cars.cc_n_magnet;STORY.cars.cc_n_drifter=1;if(STORY.car=='cc_n_magnet')STORY.car='cc_n_drifter'}   /* (batch 71) the old prize */STORY.pos=j.pos||null;STORY.done=!!j.done;STORY.open=!!j.open}}catch(e){}}
function storySave(){try{localStorage.setItem(STORY.key,JSON.stringify({ch:STORY.ch,step:STORY.step,car:STORY.car,cars:STORY.cars,pos:STORY.pos,done:STORY.done,open:STORY.open}))}catch(e){}}
function storyReset(){STORY.ch=1;STORY.step=0;STORY.car='cc_h_warden';STORY.cars={cc_h_warden:1};STORY.pos=null;STORY.done=false;STORY.open=false;storySave()}
const storyStep=()=>{const ch=STORY_CH[STORY.ch];return ch&&ch.steps[STORY.step]};
function storyLabel(){storyLoad();const ch=STORY_CH[STORY.ch];if(!ch)return'STORY';const n=ch.steps.filter(s=>s.k=='ev').length,d=ch.steps.slice(0,STORY.step).filter(s=>s.k=='ev').length;
  return STORY.step==0?'Drive':'Continue'}
/* ---- places ---- */
function storyRoadPt(x,z){/* the nearest point of a drivable road, and its direction */let best=null,bd=1e18;for(const r of ROADS){if(r.style==2||r.style==5)continue;for(let i=1;i<r.n-1;i+=2){const d=(r.X[i]-x)**2+(r.Z[i]-z)**2;if(d<bd){bd=d;best={r,i}}}}return best}
function storyAlong(rp,dist,dir){/* a point dist metres along the road from rp, in direction dir (+1 / -1 in sample order) */const r=rp.r,ds=r.ds||(r.len/r.n),i=Math.max(1,Math.min(r.n-2,Math.round(rp.i+dir*dist/ds))),t=_tan(r,i);
  return{x:r.X[i],z:r.Z[i],y:r.Y[i],yaw:Math.atan2(t[0]*dir,-t[1]*dir)}}
function storyGas(){/* Margo's: the gas station on the coast road just south of Pacifica */let best=null;for(const s of RSTOPS){if(s.kind!==0)continue;const d=Math.hypot(s.x+1794,s.z-2027);if(!best||d<best.d)best={s,d}}
  const s=best?best.s:{x:-1794,z:2027},rp=storyRoadPt(s.x,s.z),t=_tan(rp.r,rp.i);let yaw=Math.atan2(t[0],-t[1]);
  /* face south-east, down the coast towards the first race */const a=storyAlong(rp,200,1);if(Math.hypot(a.x+1464,a.z-2317)>Math.hypot(storyAlong(rp,200,-1).x+1464,storyAlong(rp,200,-1).z-2317))yaw+=Math.PI;
  /* on the forecourt, between the pumps and the road */const px=s.x+(rp.r.X[rp.i]-s.x)*.42,pz=s.z+(rp.r.Z[rp.i]-s.z)*.42;return{x:px,z:pz,y:terrainH(px,pz),yaw}}
function storyPlace(p){carPlace(p.x,p.z,p.yaw,p.y+.5);C.vx=C.vz=0;C.camYaw=p.yaw;camStep(0,true)}
/* ---- begin / continue ---- */
function storyBegin(fresh){storyLoad();if(fresh)storyReset();if(!STORY.on)STORY.freeCar=CARSEL.cur;STORY.on=true;STORY.radio=[];STORY.rcur=null;STORY.dlg=null;STORY.st={};
  if(!STORY.open){const i=CAR_ROSTER.findIndex(d=>d.id==STORY.car);if(i>=0)carSelect(i)}
  if(STORY.step==0||!STORY.pos)storyPlace(storyGas());else storyPlace(STORY.pos);
  STORY.title=3.2;COP.on=true}
/* (batch 61) back to free roam from the pause menu: the story is saved where it is; your free-roam car comes back */
function storyLeave(){if(!STORY.on)return;if(EV.run&&EV.run.ev.story)evQuit();if(STORY.dlg){STORY.dlg=null;STORY.camOn=false;storyActorKill();voxStop()}STORY.radio=[];STORY.rcur=null;STORY.curEv=null;
  if(EV.card&&EV.card.story)EV.card=null;STORY.pos={x:C.x,z:C.z,y:C.y,yaw:C.yaw};storySave();STORY.on=false;navClear();if(STORY.freeCar!=null)carSelect(STORY.freeCar);safeToast('FREE ROAM  ·  story saved',2.5)}
function storyAdvance(){STORY.step++;STORY.st={};STORY.pos={x:C.x,z:C.z,y:C.y,yaw:C.yaw};storySave()}
/* ---- the radio: lines over your driving ---- */
function storyRadio(lines){if(!lines)return;for(const l of lines)STORY.radio.push(l)}
const storyDur=l=>{const v=STORY.vox[l[2]&&l[2].id];return v&&v.duration?v.duration+.35:Math.max(2.2,Math.min(6.5,1.3+l[1].length*.052))};
/* ---- scenes ---- */
function storyScene(sc,onDone){const rp=storyRoadPt(C.x,C.z),rx=Math.cos(C.yaw),rz=Math.sin(C.yaw);/* the cameras stay on the road side (buildings and pumps are on the other) */const side=rp&&Math.hypot(rp.r.X[rp.i]-C.x,rp.r.Z[rp.i]-C.z)>3?((rp.r.X[rp.i]-C.x)*rx+(rp.r.Z[rp.i]-C.z)*rz>=0?1:-1):1;
  STORY.dlg={lines:sc.lines,i:-1,t:0,onDone,anchor:{x:C.x,z:C.z,y:C.y,yaw:C.yaw,side}};STORY.camOn=true;STORY.shot='front';STORY.shotT=0;STORY.radio=[];STORY.rcur=null;
  if(sc.actor)storyActorSpawn(sc.actor);storyLine(0)}
function storyLine(i){const D=STORY.dlg;if(!D)return;D.i=i;D.t=0;const l=D.lines[i];if(!l){storySceneEnd();return}const o=l[2]||{};if(o.s){STORY.shot=o.s;STORY.shotT=0}
  if(o.a=='actorGo')storyActorGo();else if(o.a=='actorLeave')storyActorLeave();voxPlay(l)}
function storySceneEnd(){const D=STORY.dlg;STORY.dlg=null;STORY.camOn=false;storyActorKill();IN.brk=0;voxStop();camStep(0,true);if(D&&D.onDone)D.onDone()}
/* the actor: a racer car driven along a short route (Jules pulling in, Jules leaving) */
function storyActorSpawn(a){storyActorKill();const pc=RACER_POOL.find(p=>p.id==a.car);if(!pc)return;const A={x:C.x,z:C.z,yaw:C.yaw},rp=storyRoadPt(A.x,A.z);if(!rp)return;
  const t=_tan(rp.r,rp.i),dir=(t[0]*Math.sin(A.yaw)-t[1]*Math.cos(A.yaw))>=0?1:-1,sk={grip:12,vmax:17,vtop:17,acc:6,brk:10,type:pc.type,col:pc.col,car:pc.id,nitro:0};
  let s,g;if(a.place=='behind'){s=storyAlong(rp,120,-dir);s.yaw+=Math.PI;g={x:A.x,z:A.z}}   /* behind you, facing you */else{s=storyAlong(rp,46,dir);g=storyAlong(rp,52,dir)}
  const Rt=evRoute(s,g.x,g.z);if(!Rt)return;const c=racerSpawn(Rt,0,0,0,sk,0);if(!c)return;c.race.name=a.name;c.race.who='JULES';STORY.actor={c,sk,dir,rp}}
function storyActorGo(){const A=STORY.actor;if(A&&A.c.alive&&A.c.race)A.c.race.go=true}
function storyActorLeave(){const A=STORY.actor;if(!A||!A.c.alive)return;const c=A.c,rp=storyRoadPt(c.x,c.z);if(!rp)return;const t=_tan(rp.r,rp.i),dir=(t[0]*Math.sin(c.yaw)-t[1]*Math.cos(c.yaw))>=0?1:-1,g=storyAlong(rp,420,dir);
  const Rt=evRoute({x:c.x,z:c.z,yaw:c.yaw},g.x,g.z);if(!Rt)return;trKill(c,0);c.race=null;const sk=Object.assign({},A.sk,{vmax:24,vtop:24,acc:8});const n=racerSpawn(Rt,0,0,0,sk,0);if(n){n.race.go=true;n.race.name='JULES';n.race.who='JULES';A.c=n;A.leaving=1}}
function storyActorKill(){const A=STORY.actor;if(A&&A.c&&A.c.alive){A.c.race=null;trKill(A.c,0)}STORY.actor=null}
/* the scene camera: a few framings round your car, the actor, or both */
function storyCam(){const D=STORY.dlg,A=D?D.anchor:{x:C.x,z:C.z,y:C.y,yaw:C.yaw},t=STORY.shotT,fx=Math.sin(A.yaw),fz=-Math.cos(A.yaw),rx=Math.cos(A.yaw)*(A.side||1),rz=Math.sin(A.yaw)*(A.side||1);
  const P={x:lerp(C.px,C.x,R.alpha),y:lerp(C.py,C.y,R.alpha),z:lerp(C.pz,C.z,R.alpha)},ac=STORY.actor&&STORY.actor.c&&STORY.actor.c.alive?STORY.actor.c:null,Q=ac?{x:lerp(ac.px,ac.x,R.alpha),y:lerp(ac.py,ac.y,R.alpha),z:lerp(ac.pz,ac.z,R.alpha),yaw:ac.yaw}:null;
  const set=(x,y,z,tx,ty,tz,fov)=>{CAM.x=x;CAM.y=Math.max(y,terrainH(x,z)+.6);CAM.z=z;CAM.tx=tx;CAM.ty=ty;CAM.tz=tz;CAM.fov=fov||.8};const sh=STORY.shot;
  if(sh=='actor'&&Q){const qx=Math.sin(Q.yaw),qz=-Math.cos(Q.yaw),qrx=Math.cos(Q.yaw),qrz=Math.sin(Q.yaw);set(Q.x+qx*6.5+qrx*3.2,Q.y+1.3,Q.z+qz*6.5+qrz*3.2,Q.x,Q.y+.7,Q.z,.85);return}
  if(sh=='two'&&Q){const mx=(P.x+Q.x)/2,mz=(P.z+Q.z)/2,dx=Q.x-P.x,dz=Q.z-P.z,l=Math.hypot(dx,dz)||1,nx=-dz/l,nz=dx/l,d=Math.max(9,l*.9);set(mx+nx*d,P.y+2.4,mz+nz*d,mx,P.y+.8,mz,.9);return}
  if(sh=='side'){set(P.x+rx*(7-t*.15),P.y+1.25,P.z+rz*(7-t*.15),P.x+fx*.6,P.y+.75,P.z+fz*.6,.8);return}
  if(sh=='wide'){set(P.x+rx*15+fx*12,P.y+3.2,P.z+rz*15+fz*12,P.x-fx*2,P.y+1,P.z-fz*2,.85);return}
  if(sh=='high'){const a=A.yaw+.6+t*.05;set(P.x-Math.sin(a)*15,P.y+8.5,P.z+Math.cos(a)*15,P.x,P.y+.5,P.z,.9);return}
  if(sh=='grid'){set(P.x+fx*(19-t*.4)-rx*2.4,P.y+2.0,P.z+fz*(19-t*.4)-rz*2.4,P.x-fx*8,P.y+.8,P.z-fz*8,.85);return}
  if(sh=='rear'){set(P.x-fx*7+rx*1.2,P.y+1.7,P.z-fz*7+rz*1.2,P.x+fx*6,P.y+.9,P.z+fz*6,.85);return}
  /* front: a low three-quarter on the nose, drifting slowly */set(P.x+fx*(5.6+t*.12)+rx*3.1,P.y+1.05,P.z+fz*(5.6+t*.12)+rz*3.1,P.x,P.y+.65,P.z,.78)}
/* ---- voices (when recorded lines exist) ---- */
function voxPlay(l){voxStop();const id=l[2]&&l[2].id;if(!id||!VOXB64[id]||!AU.ready)return;const x=AU.ctx,go=b=>{const s=x.createBufferSource();s.buffer=b;let n=s;
    if(l[0]=='STATIC'||(l[2]&&l[2].r)){const f=x.createBiquadFilter();f.type='bandpass';f.frequency.value=1700;f.Q.value=.7;s.connect(f);n=f}const g=x.createGain();g.gain.value=1.4;n.connect(g);g.connect(AU.master);s.start();STORY.voxSrc=s};
  const v=STORY.vox[id];if(v&&v.buf){go(v.buf);return}try{const bin=atob(VOXB64[id]),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);x.decodeAudioData(u.buffer,b=>{STORY.vox[id]={buf:b,duration:b.duration};go(b)},()=>{})}catch(e){}}
function voxStop(){if(STORY.voxSrc){try{STORY.voxSrc.stop()}catch(e){}STORY.voxSrc=null}}
/* ---- events ---- */
function storyStartEv(step,retry){const d=Object.assign({id:'story_c'+STORY.ch+'_'+step.id,story:1,minLen:300},step.def);if(step.here)d.at={x:C.x,z:C.z,y:C.y,yaw:C.yaw};if(typeof DIFF!='undefined'&&d.type=='escape')d.stars=Math.min(5,d.stars+(DIFF.lv==2?1:0));
  const ev=evBuild(d);if(!ev){safeToast('ROUTE NOT FOUND',2);return}{const si=CAR_ROSTER.findIndex(q=>q.id==STORY.car);if(si>=0&&si!=CARSEL.cur){if(STORY.prevCar==null)STORY.prevCar=CARSEL.cur;carSelect(si)}}   /* (batch 63) story jobs are driven in your story car */if(d.medalK){ev.gold*=d.medalK;ev.silver*=d.medalK;ev.bronze*=d.medalK}STORY.curEv=ev;EV.card=null;evStart(ev);
  if(step.pre&&!retry&&EV.run){EV.run.hold=true;storyScene({lines:step.pre},()=>{if(EV.run)EV.run.hold=false})}}
function storyEvDone(ev,ok,o){const step=storyStep();if(!STORY.on||!step||step.k!='ev'||ev!==STORY.curEv)return;STORY.curEv=null;if(STORY.prevCar!=null&&STORY.open){carSelect(STORY.prevCar);STORY.prevCar=null}const card=EV.card||EV.pending;
  const pass=ok&&(step.need=='win'?o.place==1:step.need=='medal'?o.medal>=1:true);
  if(pass){storyAdvance();if(card){card.title=step.need=='escape'?'ESCAPED':'YOU WON';card.btns=[{label:'CONTINUE',col:'#ff7a1a',act:()=>{EV.card=null;storyAfterWin(step)}}]}else storyAfterWin(step)}
  else{if(card){if(ok)card.lines.unshift([step.need=='win'?'WIN THE RACE TO MOVE ON':'GET A MEDAL TO MOVE ON','#ffc23d']);card.title='TRY AGAIN';
      card.btns=[{label:'RETRY',col:'#ff7a1a',act:()=>{EV.card=null;storyStartEv(step,true)}},{label:'LATER',col:'#8a94a6',act:()=>{EV.card=null}}]}storyRadio(step.lose)}}
function storyAfterWin(step){if(step.winScene)storyScene(step.winScene,()=>{});else storyRadio(step.win)}
function storyBrief(step){const t={race:'RACE',trial:'TIME TRIAL',escape:'ESCAPE'}[step.def.type]||'EVENT',need={win:'Finish first',medal:'Get a medal (bronze or better)',escape:'Lose the cops'}[step.need]||'';
  const lines=[[step.obj,'#fff'],['To move on: '+need,'#ffc23d']];if(step.def.lineup)lines.push(['Racers: '+step.def.lineup.map(l=>l.name).join(', '),'rgba(233,230,220,.75)']);
  return{offer:1,story:1,title:'STORY  ·  '+t,sub:step.def.name,lines,btns:[{label:'START',col:'#ff7a1a',act:()=>storyStartEv(step,false)},{label:'NOT NOW',col:'#8a94a6',act:()=>{EV.card=null;STORY.st.dismiss=1}}]}}
/* ---- every step of the world ---- */
function storyTick(dt){if(!STORY.on)return;if(STORY.title>0)STORY.title-=dt;
  /* the radio */if(!STORY.dlg){if(!STORY.rcur&&STORY.radio.length){STORY.rcur={l:STORY.radio.shift(),t:0};voxPlay(STORY.rcur.l)}if(STORY.rcur){STORY.rcur.t+=dt;if(STORY.rcur.t>storyDur(STORY.rcur.l))STORY.rcur=null}}
  /* a scene: the car rolls to a stop, the lines play */const D=STORY.dlg;if(D){STORY.shotT+=dt;IN.thr=0;IN.brk=1;IN.nitro=0;if(!EV.run||EV.run.t<0){C.vx*=Math.exp(-dt*2.5);C.vz*=Math.exp(-dt*2.5);if(C.speed<3){C.vx=C.vz=0;C.wyaw=0}}D.t+=dt;{const ac=STORY.actor&&STORY.actor.c&&STORY.actor.c.alive?STORY.actor.c:null,l=D.lines[D.i],o=l&&l[2]||{};if(ac&&!STORY.actor.leaving){const dd=Math.hypot(ac.x-D.anchor.x,ac.z-D.anchor.z);if(dd<20&&ac.race){ac.race.done=EV.t;ac.v*=Math.exp(-dt*3.5)}if(o.a=='actorGo'&&dd>20&&D.t<9)D.t=Math.min(D.t,storyDur(l)-.05)}}
    if(D.i>=0&&D.t>storyDur(D.lines[D.i]))storyLine(D.i+1);return}
  if(EV.run||GAME.state||MENU.open)return;if(EV.card&&!EV.card.offer&&!EV.card.garage)return;   /* a result card is open: wait for CONTINUE */const step=storyStep();if(!step)return;const st=STORY.st;
  if(step.k=='scene'){if(!st.started){st.started=1;if(step.at=='gas')storyPlace(storyGas());storyScene(step,()=>storyAdvance())}return}
  if(step.k=='open'){STORY.open=true;storySave();storyRadio(step.lines);safeToast('FREE ROAM OPEN  ·  story jobs are gold on the map',4);storyAdvance();return}
  if(step.k=='unlock'){STORY.cars[step.car]=1;STORY.car=step.car;if(typeof carUnlock=='function')carUnlock(step.car);const i=CAR_ROSTER.findIndex(d=>d.id==step.car);if(i>=0)carSelect(i);safeToast('NEW CAR  ·  '+step.name,3.5);storyAdvance();return}
  if(step.k=='end'){if(!st.shown){st.shown=1;STORY.done=true;storySave();EV.card={story:1,title:'CHAPTER '+STORY.ch+' COMPLETE',sub:STORY_CH[STORY.ch].name,lines:[['You run the coast now. The '+((STORY_CH[STORY.ch].steps.find(q=>q.k=='unlock')||{}).name||'new car').toLowerCase().replace(/\b\w/g,m=>m.toUpperCase())+' is yours.','#fff'],['Next: '+step.next+'  (coming soon)','#ffc23d'],['Keep driving: the map events are still open.','rgba(233,230,220,.75)']],btns:[{label:'OK',col:'#ff7a1a',act:()=>{EV.card=null}}]}}return}
  if(step.k=='ev'){if(!st.init){st.init=1;storyRadio(step.drive)}
    if(step.here){if(!st.go&&!STORY.rcur&&!STORY.radio.length&&!EV.card){st.go=1;storyStartEv(step,false)}else if(st.go&&!STORY.curEv){if(C.speed>15)st.dismiss=0;if(!EV.card&&C.speed<2&&!st.dismiss)EV.card=storyBrief(step)}return}   /* failed and closed: stop anywhere and the card offers it again */
    if(!st.ev){st.ev=evBuild(Object.assign({id:'story_c'+STORY.ch+'_'+step.id,story:1,minLen:300},step.def))}const e=st.ev;if(!e)return;
    const d=Math.hypot(C.x-e.s.x,C.z-e.s.z);st.navT=(st.navT||0)-dt;if(st.navT<=0&&d>40&&(!NAV.wp||Math.hypot(NAV.wp.x-e.s.x,NAV.wp.z-e.s.z)>5)&&(!STORY.open||!st.navOnce)){st.navT=2;st.navOnce=1;navSet(e.s.x,e.s.z)}
    if(d>30)st.dismiss=0;if(d<14&&C.speed<7&&!EV.card&&!st.dismiss)EV.card=storyBrief(step);if(EV.card&&EV.card.story&&EV.card.offer&&d>30)EV.card=null}}
/* the beam over the next story event */
function storyFx(sprite){if(!STORY.on||EV.run)return;const e=STORY.st.ev;if(!e)return;const d=Math.hypot(e.s.x-C.x,e.s.z-C.z);if(d>1500)return;const pulse=.75+.25*Math.sin(EV.t*4);
  for(let k=0;k<52;k++){const y=e.s.y+4+k*5,f=1-k/52;sprite(e.s.x,y,e.s.z,1.6+d*.005,1,.82,.3,(.3+.35*f)*pulse);if(k%4==0)sprite(e.s.x,y,e.s.z,5+d*.012,1,.6,.1,.12*f)}sprite(e.s.x,e.s.y+1.2,e.s.z,4,1,.75,.2,.5)}
/* ---- taps ---- */
function storyTap(x,y){if(!STORY.on)return false;const D=STORY.dlg;if(D){const sk=STORY.skipBtn;if(sk&&x>=sk.x&&x<=sk.x+sk.w&&y>=sk.y&&y<=sk.y+sk.h){voxStop();storySceneEnd();return true}
    const l=D.lines[D.i],shown=l?Math.min(l[1].length,D.t*48):0;if(l&&shown<l[1].length)D.t=l[1].length/48+.01;else storyLine(D.i+1);return true}
  const rb=STORY.radioBox;if(STORY.rcur&&rb&&x>=rb.x&&x<=rb.x+rb.w&&y>=rb.y&&y<=rb.y+rb.h){voxStop();STORY.rcur=null;return true}return false}
/* ---- the screen ---- */
function storyWrap(c,t,maxW){const w=t.split(' '),out=[];let line='';for(const s of w){const tr=line?line+' '+s:s;if(c.measureText(tr).width>maxW&&line){out.push(line);line=s}else line=tr}if(line)out.push(line);return out}
function storyHud(c,W_,H_,u){if(!STORY.on)return;const D=STORY.dlg;c.save();
  /* named racers: a tag over each */if(EV.run&&EV.run.racers){const V=R.VP;for(const q of EV.run.racers){if(!q.alive||!q.race||!q.race.name)continue;const d=Math.hypot(q.x-C.x,q.z-C.z);if(d>160||d<4)continue;const wy=q.y+2.1,cw=V[3]*q.x+V[7]*wy+V[11]*q.z+V[15];if(cw<1)continue;
      const sx=((V[0]*q.x+V[4]*wy+V[8]*q.z+V[12])/cw*.5+.5)*W_,sy=(-(V[1]*q.x+V[5]*wy+V[9]*q.z+V[13])/cw*.5+.5)*H_,who=STORY_WHO[q.race.who]||null;c.globalAlpha=Math.min(1,(160-d)/40);
      c.font='italic 800 '+Math.round(u*(who?.3:.22))+'px '+UIF;c.textAlign='center';c.lineWidth=u*.06;c.strokeStyle='rgba(0,0,0,.75)';c.strokeText(q.race.name,sx,sy);c.fillStyle=who?who.c:'#e8eef2';c.fillText(q.race.name,sx,sy)}c.globalAlpha=1}
  if(D){/* letterbox, the line, SKIP */const bh=H_*.11;c.fillStyle='rgba(0,0,0,.92)';c.fillRect(0,0,W_,bh);c.fillRect(0,H_-bh,W_,bh);
    const sw=u*1.5,sh=u*.5;STORY.skipBtn={x:W_-sw-u*.35,y:(bh-sh)/2,w:sw,h:sh};c.strokeStyle='rgba(207,233,245,.6)';c.lineWidth=1.5;rr(c,STORY.skipBtn.x,STORY.skipBtn.y,sw,sh,u*.08);c.stroke();
    c.fillStyle='#cfe9f5';c.font='700 '+Math.round(u*.22)+'px '+UIF;c.textAlign='center';c.fillText('SKIP  ▸▸',STORY.skipBtn.x+sw/2,STORY.skipBtn.y+sh*.68);
    const l=D.lines[D.i];if(l)storyLineBox(c,W_,H_,u,l,D.t,true,bh);c.restore();return}
  if(STORY.rcur)storyLineBox(c,W_,H_,u,STORY.rcur.l,STORY.rcur.t,false,0);else STORY.radioBox=null;
  /* the objective, and the chapter title */const step=storyStep();if(step&&step.obj&&!EV.run&&!STORY.rcur&&!EV.card){c.font='600 '+Math.round(u*.2)+'px '+UIF;c.textAlign='center';const t='CH '+STORY.ch+'  ·  '+step.obj.toUpperCase(),tw=c.measureText(t).width+u*.9;
    const oy=H_-u*.72,ox=W_*.56;holoPanel(c,ox-tw/2,oy,tw,u*.42,u*.08,.4);c.fillStyle='#ffd27a';c.fillText('◆ ',ox-tw/2+u*.3,oy+u*.28);c.fillStyle='#e8eef2';c.fillText(t,ox+u*.1,oy+u*.28)}
  if(STORY.title>0){const k=Math.min(1,STORY.title*1.5,(3.2-STORY.title)*3);c.globalAlpha=k;fxText(c,'CHAPTER '+STORY.ch,W_/2,H_*.5,u*.55,'#ffc23d','center');fxText(c,STORY_CH[STORY.ch].name,W_/2,H_*.5+u*1.0,u*1.0,'#fff','center')}
  c.restore()}
function storyLineBox(c,W_,H_,u,l,t,scene,bh){const who=STORY_WHO[l[0]]||STORY_WHO[''],o=l[2]||{},radio=!scene||who.radio||o.r,bw=Math.min(W_*(scene?.74:.42),u*(scene?13:8.6)),fs=u*(scene?.31:.25);
  c.font='600 '+Math.round(fs)+'px '+UIF;const lines=storyWrap(c,l[1],bw-u*.8),lh=fs*1.25,h=u*.5+lines.length*lh+u*.3,x=scene?(W_-bw)/2:W_*.56-bw/2,y=scene?H_-bh-h-u*.25:H_-h-u*.22;   /* the radio sits at the bottom, between the gauges and the pedals (the GPS card is at the top) */
  if(!scene)STORY.radioBox={x,y,w:bw,h};holoPanel(c,x,y,bw,h,u*.12,scene?.62:.5);
  /* the speaker: a slanted tag; KZRO 88.8 with a moving level meter when it comes over the radio */
  if(who.n){c.font='italic 800 '+Math.round(u*.24)+'px '+UIF;c.textAlign='left';c.fillStyle=who.c;c.fillText(who.n,x+u*.35,y+u*.36)}
  if(radio){const bx=x+bw-u*1.9;c.font='400 '+Math.round(u*.17)+'px '+LCDF;c.fillStyle='rgba(207,233,245,.65)';c.textAlign='left';c.fillText(l[0]=='STATIC'?'KZRO 88.8':'ON AIR',bx,y+u*.34);
    for(let k=0;k<6;k++){const a=.25+.75*Math.abs(Math.sin(t*9+k*1.7))*(t<storyDur(l)-.3?1:.2);c.fillStyle=who.c;c.fillRect(bx+u*1.05+k*u*.11,y+u*.36-a*u*.22,u*.07,a*u*.22)}}
  /* the line types itself out */const n=Math.floor(Math.min(l[1].length,t*48));let left=n;c.font=(who.n?'600 ':'italic 600 ')+Math.round(fs)+'px '+UIF;c.textAlign='left';c.fillStyle=who.n?'#f1f4f6':'#cfe9f5';
  lines.forEach((s,i)=>{const part=s.slice(0,Math.max(0,left));left-=s.length+1;c.fillText(part,x+u*.35,y+u*.5+lh*(i+.8))});
  if(scene&&n>=l[1].length&&((t*2.2)|0)%2==0){c.fillStyle='rgba(207,233,245,.7)';c.font='700 '+Math.round(u*.18)+'px '+UIF;c.textAlign='right';c.fillText('TAP ▸',x+bw-u*.3,y+h-u*.15)}}

/* (batch 63) while the story is guiding you (until the first race is won) the map events, garages' event lists and street racers stay hidden */
const storyGuided=()=>typeof STORY!='undefined'&&STORY.on&&!STORY.open;
/* the next story job on the world map and the minimap: a gold diamond */
function storyMapIcons(ctx,px,pz,r){if(!STORY.on)return;const e=STORY.st&&STORY.st.ev;if(!e)return;const x=px(e.s.x),z=pz(e.s.z),k=r*1.6;ctx.save();ctx.fillStyle=((EV.t*3|0)&1)?'#ffd23a':'#ffb000';ctx.strokeStyle='#000';ctx.lineWidth=Math.max(1,r*.25);
  ctx.beginPath();ctx.moveTo(x,z-k);ctx.lineTo(x+k,z);ctx.lineTo(x,z+k);ctx.lineTo(x-k,z);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore()}
