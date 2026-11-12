'use strict';
/* ===== batch 10: events, records and money =====
   EVENTS start from markers on the map (drive into one and stop: a card offers it) or from a garage (park on your garage's pad: the card lists every event; choosing one takes you to its start).
   TIME TRIALS: a route between two places along the roads, checkpoints every 300 m (gates of light), the route drawn on the road and the minimap, a 3-2-1 start, bronze / silver / gold times,
     the ghost of your best run (the same car only), no police while it runs.
   ESCAPE THE COPS: you start with 2 to 5 stars and a clock; lose them (heat back to 0) before it runs out. Busted, wrecked or out of time: failed.
   MONEY (ECON in 63_safe.js): events pay (a medal pays its full prize the first time it is won, then the difference when you beat it, and a tenth of the prize for a repeat), it buys cars (the car menu) and
   garages (park on a locked garage's pad), and BUSTED costs 8 % of it (at most 10,000). Records (best times, medals, the ghost) are saved in localStorage. */
const EV={list:[],run:null,card:null,btns:[],dismiss:null,rec:{},key:'racer.events',t:0,res:null,pending:null};
const EV_DEF=[
 {id:'t_ring',type:'trial',name:'Ring Sprint',from:['ring',.30],to:['ring',.62]},
 {id:'t_desert',type:'trial',name:'Desert Dash',from:['eh',.08],to:['barp',.5]},
 {id:'t_canyon',type:'trial',name:'Canyon Climb',from:['cyr',.04],to:['rim',.5]},
 {id:'t_north',type:'trial',name:'Northern Line',from:['nt1',.06],to:['nt2',.94]},
 {id:'t_coast',type:'trial',name:'Coast Highway',from:['cr',.08],to:['btp',.5]},
 {id:'t_pass',type:'trial',name:'Mountain Pass',from:['nh1',.08],to:['bigp',.5]},
 {id:'t_vegas',type:'trial',name:'Vegas Run',from:['vg1',.12],to:['vegp',.6]},
 {id:'t_south',type:'trial',name:'Southern Cross',from:['sh',.12],to:['sh',.88]},
 {id:'e_2',type:'escape',name:'Hot Pursuit',stars:2,secs:100,from:['ring',.55]},
 {id:'e_3',type:'escape',name:'Roadblocks',stars:3,secs:130,from:['bv',.5]},
 {id:'e_4',type:'escape',name:'Eye in the Sky',stars:4,secs:160,from:['eh',.55]},
 {id:'e_5',type:'escape',name:'Most Wanted',stars:5,secs:200,from:['sfp',.3]}];
const EV_ESC_PAY=[0,0,4000,8000,15000,25000],EV_MEDAL=['','BRONZE','SILVER','GOLD'],EV_MCOL=['#aaa','#d08a4a','#cfd6e0','#ffd23a'];
function evLoad(){try{EV.rec=JSON.parse(localStorage.getItem(EV.key)||'{}')||{}}catch(e){EV.rec={}}}
function evSave(){try{localStorage.setItem(EV.key,JSON.stringify(EV.rec))}catch(e){}}
const evFmt=t=>{t=Math.max(0,t);const m=Math.floor(t/60),s=t-m*60;return m+':'+(s<10?'0':'')+s.toFixed(2)};
const evMoney=n=>'$'+Math.round(n).toLocaleString('en-US');
/* a point on a road (fraction f along it), the heading along it, a little to the right of the centre (the lane you drive in) */
function evAt(id,f){const r=ROADS.find(q=>q.id==id);if(!r)return null;const i=Math.max(2,Math.min(r.n-3,Math.round(f*(r.closed?r.n:r.n-1)))),t=_tan(r,i),yaw=Math.atan2(t[0],-t[1]),o=r.style==1||r.style==4?r.hw*.55:r.hw*.4;
  return{x:r.X[i]+Math.cos(yaw)*o,z:r.Z[i]+Math.sin(yaw)*o,y:r.Y[i],yaw,ri:ROADS.indexOf(r),i}}
/* a route along the roads from a start (position and heading) to a point */
function evRoute(s,gx,gz){const sn=navSnap(s.x,s.z,40);if(!sn)return null;const la=navLane(sn,s.x,s.z,Math.sin(s.yaw),-Math.cos(s.yaw));if(!la)return null;const g=navSnap(gx,gz,80);if(!g)return null;
  const e=la.e,u0=e.closed?(la.u+2)%e.n:Math.min(e.n-1,la.u+2),ch=navAStar(e,u0,{ri:g.ri,i:g.i,x:g.x,z:g.z},60000);return ch?navPolyline(ch):null}
/* the medal times come from the route itself: the time of a good driver who takes every bend at 9.5 m/s2 of grip, never goes over 72 m/s, pulls away at 6 m/s2 and brakes at 11 */
function evRefTime(R){const n=R.n,p=R.pts,v=new Float32Array(n);for(let i=0;i<n;i++){const a=Math.max(0,i-4),b=Math.min(n-1,i+4),c=Math.min(n-1,i+8);const h1=Math.atan2(p[b*3]-p[a*3],p[b*3+2]-p[a*3+2]),h2=Math.atan2(p[c*3]-p[b*3],p[c*3+2]-p[b*3+2]),ds=Math.max(1,R.S[c]-R.S[a]),k=Math.abs(angd(h2,h1))/ds;v[i]=Math.min(72,k>1e-4?Math.sqrt(9.5/k):72)}
  v[0]=0;for(let i=1;i<n;i++){const ds=R.S[i]-R.S[i-1];v[i]=Math.min(v[i],Math.sqrt(v[i-1]*v[i-1]+2*6*ds))}for(let i=n-2;i>=0;i--){const ds=R.S[i+1]-R.S[i];v[i]=Math.min(v[i],Math.sqrt(v[i+1]*v[i+1]+2*11*ds))}
  let t=0;for(let i=1;i<n;i++){const ds=R.S[i]-R.S[i-1];t+=ds/Math.max(2,(v[i]+v[i-1])/2)}return t}
function evInit(){EV.list.length=0;evLoad();
  for(const d of EV_DEF){const s=evAt(d.from[0],d.from[1]);if(!s)continue;const ev=Object.assign({},d,{s});
    if(d.type=='trial'){const t=evAt(d.to[0],d.to[1]);if(!t)continue;const R=evRoute(s,t.x,t.z);if(!R||R.len<500)continue;ev.len=R.len;ev.cps=[];
      const n=Math.max(2,Math.round(R.len/300));for(let k=1;k<=n;k++){const S=R.len*k/n;let j=0;while(j<R.n-2&&R.S[j+1]<S)j++;const a=Math.min(R.n-2,j),x=R.pts[a*3],y=R.pts[a*3+1],z=R.pts[a*3+2],dx=R.pts[a*3+3]-x,dz=R.pts[a*3+5]-z,l=Math.hypot(dx,dz)||1;
        ev.cps.push({x,y,z,nx:-dz/l,nz:dx/l})}
      ev.ref=evRefTime(R);ev.gold=ev.ref*1.06+2;ev.silver=ev.ref*1.2+3;ev.bronze=ev.ref*1.4+4;ev.prize=Math.max(1500,Math.round(ev.len/1000*2600/100)*100)}
    else ev.prize=EV_ESC_PAY[d.stars];
    EV.list.push(ev)}}
const evMedal=(ev,t)=>t<=ev.gold?3:t<=ev.silver?2:t<=ev.bronze?1:0;
/* ---- start, run, finish ---- */
function evStart(ev){EV.card=null;EV.res=null;navClear();GAME.state=0;GAME.lock=0;
  const s=ev.s;for(const c of TR.cars)if(c.alive&&Math.hypot(c.x-s.x,c.z-s.z)<40&&c.kind!==1)trKill(c,0);copClear(true);for(const c of TR.cars)if(c.alive&&c.kind==1)trKill(c,0);
  carPlace(s.x,s.z,s.yaw,s.y+.5);C.camYaw=s.yaw;camStep(0,true);dmgReset();C.nos=1;
  EV.run={ev,t:-3,cp:0,ghost:[],gt:0,copsWas:COP.on,best:(EV.rec[ev.id]||{}).t,lastBeep:4};
  if(ev.type=='trial'){COP.on=false;navSetPt(ev.cps[0])}else{COP.on=true}
  evBeep(440,.12)}
function navSetPt(p){navSet(p.x,p.z)}
function evQuit(){const r=EV.run;if(!r)return;COP.on=r.copsWas;navClear();EV.run=null;safeToast('EVENT ABANDONED',2)}
function evTick(dt){EV.t+=dt;const r=EV.run;
  if(!r){if(EV.pending&&!GAME.state){EV.card=EV.pending;EV.pending=null}evMarkers();return}
  if(GAME.state){/* busted or wrecked: the event is lost */COP.on=r.copsWas;navClear();EV.run=null;EV.pending=evResultCard(r.ev,false,GAME.state==2?'BUSTED':'WRECKED');return}
  const ev=r.ev;
  if(r.t<0){r.t+=dt;C.vx=C.vz=0;C.x=C.px=ev.s.x;C.z=C.pz=ev.s.z;C.yaw=C.pyaw=ev.s.yaw;C.wyaw=0;const k=Math.ceil(-r.t);if(k<r.lastBeep&&k>0){r.lastBeep=k;evBeep(440,.12)}
    if(r.t>=0){evBeep(880,.25);if(ev.type=='escape'){const t=COP.D.thr,L=ev.stars;COP.w=t[L]+(L<5?(t[L+1]-t[L])*.3:20);COP.heat=L;COP.heatT=99;COP.sightT=0;(COP.crimes||(COP.crimes=[])).push({t:+C.t.toFixed(1),why:'event',level:L})}}return}
  r.t+=dt;
  if(ev.type=='trial'){r.gt+=dt;if(r.gt>=.1){r.gt-=.1;r.ghost.push(+C.x.toFixed(1),+C.y.toFixed(2),+C.z.toFixed(1),+C.yaw.toFixed(3))}
    const p=ev.cps[r.cp],R=Math.max(14,(ROADS[navSnap(p.x,p.z,40)?.ri]||{hw:9}).hw+5);if(Math.hypot(C.x-p.x,C.z-p.z)<R&&Math.abs(C.y-p.y)<6){r.cp++;
      if(r.cp>=ev.cps.length){evFinish(true);return}evBeep(660,.08);navSetPt(ev.cps[r.cp])}
    if(r.t>Math.max(ev.bronze*2.2,ev.bronze+120))evFinishFail('TOO SLOW')}
  else{if(COP.heat==0&&r.t>1){evFinish(true);return}if(r.t>=ev.secs)evFinishFail('OUT OF TIME')}}
function evFinishFail(why){const r=EV.run;COP.on=r.copsWas;navClear();EV.run=null;copClear(true);EV.card=evResultCard(r.ev,false,why)}
function evFinish(ok){const r=EV.run,ev=r.ev;COP.on=r.copsWas;navClear();EV.run=null;const rec=EV.rec[ev.id]||(EV.rec[ev.id]={});let pay=0,medal=0,best=false;
  if(ev.type=='trial'){medal=evMedal(ev,r.t);const was=rec.m|0,val=m=>m==3?ev.prize:m==2?ev.prize*.6:m==1?ev.prize*.35:0;pay=Math.round(Math.max(val(medal)-val(was),medal?val(medal)*.1:0)/50)*50;
    if(!rec.t||r.t<rec.t){best=!!rec.t;rec.t=r.t;rec.ghost={car:CARM.def.id,s:r.ghost}}if(medal>was)rec.m=medal}
  else{medal=3;pay=rec.done?Math.round(ev.prize*.25/50)*50:ev.prize;rec.done=(rec.done|0)+1;if(!rec.t||r.t<rec.t){best=!!rec.t;rec.t=r.t}copClear(true)}
  rec.n=(rec.n|0)+1;evSave();if(pay>0)ECON.add(pay);evBeep(990,.3);EV.card=evResultCard(ev,true,null,{t:r.t,medal,pay,best})}
function evResultCard(ev,ok,why,o){const lines=[];o=o||{};
  if(ok&&ev.type=='trial'){lines.push(['TIME '+evFmt(o.t)+(o.best?'   NEW BEST':''),'#fff']);lines.push([o.medal?EV_MEDAL[o.medal]+' MEDAL':'NO MEDAL  (bronze '+evFmt(ev.bronze)+')',EV_MCOL[o.medal]])}
  else if(ok){lines.push(['LOST THEM IN '+evFmt(o.t),'#fff'])}
  else lines.push([why,'#ff7a5a']);
  if(ok)lines.push([o.pay>0?'+'+evMoney(o.pay):'no prize this time','#7dffb0']);
  return{title:ok?(ev.type=='trial'?'FINISHED':'ESCAPED'):'FAILED',sub:ev.name,lines,btns:[{label:'RETRY',col:'#ff7a1a',act:()=>evStart(ev)},{label:'OK',col:'#8a94a6',act:()=>{EV.card=null}}]}}
/* ---- markers on the map: stop in one and a card offers the event ---- */
function evMarkers(){if(GAME.state||MENU.open)return;let near=null;for(const ev of EV.list){const d=Math.hypot(C.x-ev.s.x,C.z-ev.s.z);if(d<10&&Math.abs(C.y-ev.s.y)<5){near=ev;break}}
  if(EV.dismiss&&(!near||near!==EV.dismiss))EV.dismiss=null;
  if(near&&C.speed<6&&!EV.card&&EV.dismiss!==near)EV.card=evOfferCard(near,false);
  if(EV.card&&EV.card.offer&&!near&&!EV.card.garage)EV.card=null;
  /* a garage you own: the list of every event */
  if(!EV.card&&SAFE.at&&SAFE.owned[SAFE.at.id]&&SAFE.visit===SAFE.at.id&&C.speed<2&&EV.dismiss!==SAFE.at)EV.card=evListCard();
  if(EV.card&&EV.card.garage&&!SAFE.at)EV.card=null}
function evInfo(ev){const rec=EV.rec[ev.id]||{};if(ev.type=='trial')return[(ev.len/1000).toFixed(1)+' km  ·  gold '+evFmt(ev.gold)+'  ·  prize '+evMoney(ev.prize),rec.t?'best '+evFmt(rec.t)+(rec.m?'  ·  '+EV_MEDAL[rec.m]:''):'not run yet'];
  return[ev.stars+' stars  ·  lose them within '+evFmt(ev.secs).replace(/\.00$/,'')+'  ·  prize '+evMoney(ev.prize),rec.done?'escaped '+rec.done+'x, best '+evFmt(rec.t):'not done yet']}
function evOfferCard(ev,fromGarage){const inf=evInfo(ev);return{offer:1,title:ev.type=='trial'?'TIME TRIAL':'ESCAPE THE COPS',sub:ev.name,lines:[[inf[0],'#fff'],[inf[1],'#9cc8ff']],
  btns:[{label:'START',col:'#ff7a1a',act:()=>evStart(ev)},{label:fromGarage?'BACK':'NOT NOW',col:'#8a94a6',act:()=>{if(fromGarage)EV.card=evListCard();else{EV.card=null;EV.dismiss=ev}}}]}}
function evListCard(){const b=EV.list.map(ev=>{const rec=EV.rec[ev.id]||{};return{label:ev.name+(ev.type=='trial'?(rec.m?'  '+'★'.repeat(rec.m):''):'  '+ev.stars+'★'),col:ev.type=='trial'?'#d9a020':'#d04848',act:()=>{EV.card=Object.assign(evOfferCard(ev,true),{garage:1})},small:1}});
  b.push({label:'CLOSE',col:'#8a94a6',act:()=>{EV.card=null;EV.dismiss=SAFE.at},small:1});return{garage:1,title:'EVENTS',sub:'your money: '+evMoney(ECON.money),lines:[],btns:b,grid:1}}
/* ---- the card and the event HUD ---- */
function evHud(c,W_,H_,u){const fs=(k,w)=>(w||700)+' '+Math.round(u*k)+'px -apple-system,Roboto,sans-serif';c.save();
  /* money, under the minimap */
  if(!MENU.open){c.textAlign='left';c.font=fs(.3,800);c.fillStyle='#7dffb0';c.shadowColor='rgba(0,0,0,.7)';c.shadowBlur=4;c.fillText(evMoney(ECON.money),UI.mm.cx-UI.mm.r,UI.mm.cy+UI.mm.r+u*.62);c.shadowBlur=0}
  EV.btns.length=0;const r=EV.run;
  if(r){const ev=r.ev;c.textAlign='center';c.shadowColor='rgba(0,0,0,.75)';c.shadowBlur=6;
    if(r.t<0){c.font=fs(1.6,900);c.fillStyle='#fff';c.fillText(String(Math.ceil(-r.t)),W_/2,H_*.42)}
    else if(r.t<.8){c.font=fs(1.3,900);c.fillStyle='#7dffb0';c.fillText('GO!',W_/2,H_*.42)}
    c.font=fs(.55,800);c.fillStyle='#fff';
    if(ev.type=='trial'){c.fillText(evFmt(Math.max(0,r.t)),W_/2,u*1.35);c.font=fs(.24,700);c.fillStyle='rgba(255,255,255,.85)';c.fillText(ev.name+'  ·  checkpoint '+Math.min(r.cp+1,ev.cps.length)+' / '+ev.cps.length+(r.best?'  ·  best '+evFmt(r.best):''),W_/2,u*1.7);
      const m=evMedal(ev,Math.max(0,r.t));c.fillStyle=EV_MCOL[m];c.fillText(m?EV_MEDAL[m]+' PACE':'NO MEDAL PACE',W_/2,u*2.0)}
    else{const left=ev.secs-Math.max(0,r.t);c.fillStyle=left<20?'#ff6a4a':'#fff';c.fillText(evFmt(left),W_/2,u*1.35);c.font=fs(.24,700);c.fillStyle='rgba(255,255,255,.85)';c.fillText(ev.name+'  ·  lose the police before the clock runs out',W_/2,u*1.7)}
    c.shadowBlur=0;const bw=u*1.2,bh=u*.42,bx=W_/2-bw/2,by=u*2.25;c.fillStyle='rgba(20,24,32,.6)';rr(c,bx,by,bw,bh,u*.1);c.fill();c.fillStyle='#fff';c.font=fs(.2,800);c.fillText('QUIT EVENT',W_/2,by+bh*.66);EV.btns.push({x:bx,y:by,w:bw,h:bh,act:evQuit})}
  const k=EV.card;if(k&&!GAME.state){const cw=Math.min(W_*.62,u*9.5),nb=k.btns.length,rows=k.grid?Math.ceil(nb/2):1,ch=u*(1.35+k.lines.length*.42+(k.grid?rows*.62:.8)),cx=W_/2-cw/2,cy=Math.max(u*.6,H_*.5-ch/2);
    c.fillStyle='rgba(12,16,24,.88)';rr(c,cx,cy,cw,ch,u*.2);c.fill();c.textAlign='left';c.fillStyle='#ffd23a';c.font=fs(.22,800);c.fillText(k.title,cx+u*.35,cy+u*.45);c.fillStyle='#fff';c.font=fs(.42,900);c.fillText(k.sub,cx+u*.35,cy+u*.95);
    let y=cy+u*1.38;for(const [t,col] of k.lines){c.fillStyle=col;c.font=fs(.24,700);c.fillText(t,cx+u*.35,y);y+=u*.42}y+=u*.05;
    if(k.grid){const bw=(cw-u*.9)/2,bh=u*.5;k.btns.forEach((b,i)=>{const bx=cx+u*.35+(i%2)*(bw+u*.2),by=y+Math.floor(i/2)*u*.62;c.fillStyle=b.col;c.globalAlpha=.9;rr(c,bx,by,bw,bh,u*.1);c.fill();c.globalAlpha=1;c.fillStyle='#111';c.font=fs(.21,800);c.textAlign='center';c.fillText(b.label,bx+bw/2,by+bh*.66);c.textAlign='left';EV.btns.push({x:bx,y:by,w:bw,h:bh,act:b.act})})}
    else{const bw=(cw-u*.9-u*.2*(nb-1))/nb,bh=u*.55;k.btns.forEach((b,i)=>{const bx=cx+u*.35+i*(bw+u*.2);c.fillStyle=b.col;rr(c,bx,y,bw,bh,u*.12);c.fill();c.fillStyle='#111';c.font=fs(.26,900);c.textAlign='center';c.fillText(b.label,bx+bw/2,y+bh*.66);c.textAlign='left';EV.btns.push({x:bx,y,w:bw,h:bh,act:b.act})})}}
  c.restore()}
function evTap(x,y){for(const b of EV.btns)if(x>=b.x-6&&x<=b.x+b.w+6&&y>=b.y-6&&y<=b.y+b.h+6){b.act();return true}return false}
/* ---- in the world: the start markers (a glowing ring and a tall beam), the checkpoint gates ---- */
function evFx(quad,flat,sprite,stage){const r=EV.run;
  if(stage==5){if(!r)for(const ev of EV.list){const d=Math.hypot(ev.s.x-C.x,ev.s.z-C.z);if(d>700)continue;const tr=ev.type=='trial';flat(ev.s.x,ev.s.y+.06,ev.s.z,6,6,tr?1:1,tr?.75:.2,tr?.2:.2,.8)}
    else if(r.ev.type=='trial'&&r.t>=0){const p=r.ev.cps[r.cp];if(p)flat(p.x,p.y+.06,p.z,9,9,.3,1,.6,.7)}}
  else if(stage==4){const pulse=.75+.25*Math.sin(EV.t*4);
    if(!r)for(const ev of EV.list){const d=Math.hypot(ev.s.x-C.x,ev.s.z-C.z);if(d>900)continue;const tr=ev.type=='trial';for(let k=0;k<10;k++)sprite(ev.s.x,ev.s.y+1.5+k*3.4,ev.s.z,1.8+d*.008,tr?1:1,tr?.78:.25,tr?.25:.2,(.9-k*.06)*pulse)}
    else if(r.ev.type=='trial'){for(let q=r.cp;q<Math.min(r.cp+2,r.ev.cps.length);q++){const p=r.ev.cps[q],last=q==r.ev.cps.length-1,w=Math.max(9,(ROADS[navSnap(p.x,p.z,40)?.ri]||{hw:9}).hw+2.5),d=Math.hypot(p.x-C.x,p.z-C.z),al=q==r.cp?pulse:.35;
      for(const sd of[-1,1])for(let k=0;k<5;k++)sprite(p.x+p.nx*w*sd,p.y+1+k*1.4,p.z+p.nz*w*sd,.7+d*.004,last?1:.3,last?.85:1,last?.3:.6,al)}}}}
/* the ghost of your best run (the same car only), drawn see-through */
const _gm=new Float32Array(16);
function evGhostDraw(){const r=EV.run;if(!r||r.ev.type!='trial'||r.t<0||!CARM.body)return;const g=(EV.rec[r.ev.id]||{}).ghost;if(!g||g.car!==CARM.def.id||!g.s.length)return;
  const f=r.t*10,i=Math.min(Math.floor(f),g.s.length/4-2);if(i<0)return;const a=f-i,o=i*4,x=lerp(g.s[o],g.s[o+4],a),y=lerp(g.s[o+1],g.s[o+5],a),z=lerp(g.s[o+2],g.s[o+6],a),yaw=g.s[o+3]+angd(g.s[o+7],g.s[o+3])*a;
  if(Math.hypot(x-C.x,z-C.z)<2.5)return;const gl=G.gl,P=G.P.car,S=1/8192;gl.useProgram(P.p);setEnvU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);gl.uniform4fv(P.u.uMat,CARM.mat);gl.uniform1f(P.u.uGl,0);carPaintU(P,CARM.paint,CARM.paint2,CARM.fin,CARM.seam);attrs(3);
  gl.uniform3f(P.u.uBr,0,y,0);gl.uniform1f(P.u.uAlpha,.3);gl.uniform3f(P.u.uWh,0,1,0);gl.uniform4f(P.u.uArch,0,0,0,0);gl.uniform4f(P.u.uDm,0,0,0,0);gl.uniform4f(P.u.uCr,0,0,0,0);gl.uniform1f(P.u.uZc,0);
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);M4.trs(_gm,x,y,z,-yaw,0,0,S,S,S);drawCarMesh(CARM.body,_gm,CARM.body.gf);gl.depthMask(true);gl.disable(gl.BLEND)}
function evBeep(f,d){if(!AU.ready)return;const x=AU.ctx,t=x.currentTime,o=x.createOscillator(),g=x.createGain();o.frequency.value=f;o.type='square';g.gain.setValueAtTime(.12,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g);g.connect(AU.master);o.start(t);o.stop(t+d+.02)}
/* the map: a chequered flag (trials) or a siren (escapes) at each start */
function evMapIcons(ctx,px,pz,r){for(const ev of EV.list){const x=px(ev.s.x),z=pz(ev.s.z);ctx.fillStyle=ev.type=='trial'?'#ffb000':'#e03030';ctx.beginPath();ctx.arc(x,z,r,0,TAU);ctx.fill();ctx.fillStyle='#111';ctx.fillRect(x-r*.45,z-r*.45,r*.45,r*.45);ctx.fillRect(x,z,r*.45,r*.45)}
  const run=EV.run;if(run&&run.ev.type=='trial'){const p=run.ev.cps[run.cp];if(p){ctx.strokeStyle='#4dffa0';ctx.lineWidth=Math.max(2,r*.4);ctx.beginPath();ctx.arc(px(p.x),pz(p.z),r*1.3,0,TAU);ctx.stroke()}}}
