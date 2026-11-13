// Getting away (batch 30): dirt trails through the woods off the long highways (no traffic, in the lane graph); chasers only ever appear behind you; cops follow you onto the grass.
// usage: node racer/tests/rtrail.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:300,h:200,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  const r=await T.ev(()=>{const {C,IN,UI}=RACER;UI.paused=true;IN.assist=true;IN.auto=false;IN.lane=true;const o={};
    o.n=TRAILS.length;o.par=[...new Set(TRAILS.map(t=>(JUNC.find(J=>J.r===t)||{par:{id:'?'}}).par.id))].join(',');o.junc=JUNC.filter(J=>J.r.style==5).length;o.lanes=TRAILS.every(t=>LG.ofRoad[t.ri]);
    o.rails=TRAILS.reduce((a,t)=>a+t.rail.reduce((x,y)=>x+y,0),0);
    /* parked on a trail for 40 s: no traffic on it */
    const t0=TRAILS[0],i=Math.round(t0.n*.5),tt=_tan(t0,i),a0=Math.atan2(tt[0],-tt[1]);RACER.carPlace(t0.X[i],t0.Z[i],a0,t0.Y[i]+.5);COP.on=false;let onTrail=0;
    for(let s=0;s<120*40;s++){C.vx=C.vz=0;RACER.worldStep(1/120);if(s%60==0)for(const c of TR.cars)if(c.alive&&c.kind==0&&trProbe(c.x,c.z)&&ROADS[TRP.ri].style==5&&TRP.d<4)onTrail++}o.onTrail=onTrail;
    /* chasers appear behind you: two stars down the ring for 60 s, then a sharp turn onto a road going the other way */
    COP.on=true;copSetDiff('forgiving');const R=ROADS.find(q=>q.id=='ring');const put=(rd,f,dir)=>{const k=Math.round(f*(rd.n-1)),t=_tan(rd,k),a=Math.atan2(t[0]*dir,-t[1]*dir);RACER.carPlace(rd.X[k]+Math.cos(a)*5,rd.Z[k]+Math.sin(a)*5,a,rd.Y[k]+.5);C.vx=Math.sin(a)*30;C.vz=-Math.cos(a)*30};
    const pin2=()=>{COP.heat=2;COP.w=COP.D.thr[2]+5;copCall()};put(R,.3,1);copClear(true);pin2();const seen=new Set();let ahead=0,total=0,worst=1;
    const watch=()=>{for(const c of TR.cars){if(!c.alive||c.kind!==1||c.cm<1||c.cm==3||seen.has(c.seed))continue;   /* (roadblocks are put ahead of you on purpose, from three stars) */seen.add(c.seed);total++;const dx=c.x-C.x,dz=c.z-C.z,d=Math.hypot(dx,dz)||1,sp=Math.hypot(C.vx,C.vz)||1,cs=(dx*C.vx+dz*C.vz)/(d*sp);worst=Math.min(worst,-cs);if(cs>-.5)ahead++}};
    for(let s=0;s<120*40;s++){IN.thr=C.speed<30?1:0;pin2();COP.bust=0;if(!(s%120))dmgReset();RACER.worldStep(1/120);watch()}
    /* the turn: onto the southern highway, going the other way round */
    const S=ROADS.find(q=>q.id=='sh');put(S,.5,-1);for(let s=0;s<120*30;s++){IN.thr=C.speed<30?1:0;pin2();COP.bust=0;if(!(s%120))dmgReset();RACER.worldStep(1/120);watch()}
    o.spawns=total;o.ahead=ahead;o.worstCos=+(-worst).toFixed(2);
    /* off the road: parked 140 m out in a field with two stars; the cops come across the grass */
    copClear(true);TR.cars.forEach(c=>{if(c.alive)trKill(c,0)});const k=Math.round(R.n*.45),t=_tan(R,k),nx=-t[1],nz=t[0];let fx=0,fz=0;for(const sd of[1,-1])for(let dd=120;dd<=220&&!fx;dd+=20){const x=R.X[k]+nx*dd*sd,z=R.Z[k]+nz*dd*sd;if(terrainH(x,z)>4&&!roadAt(x,z,terrainH(x,z)+1)&&!nearRoadXZ(x,z,25)&&!trStatic(x,z,2,terrainH(x,z))){fx=x;fz=z}}
    RACER.carPlace(fx,fz,0,terrainH(fx,fz)+.5);o.offRoad=!C.onRoad;o.fieldD=Math.round(Math.hypot(fx-R.X[k],fz-R.Z[k]));copTrigger(2,'event');let near=1e9,tNear=-1;
    for(let s=0;s<120*60;s++){C.vx=C.vz=0;COP.bust=0;RACER.worldStep(1/120);for(const c of TR.cars)if(c.alive&&c.kind==1&&c.cm>=1&&c.state!==1){const d=Math.hypot(c.x-C.x,c.z-C.z);if(d<near)near=d}if(near<25&&tNear<0)tNear=s/120}
    o.near=Math.round(near);o.tNear=tNear;return o});
  console.log(JSON.stringify(r));
  ok(r.n>=8&&r.junc==r.n*2&&r.lanes&&r.rails==0,'1 '+r.n+' dirt trails off the highways ('+r.par+'), both ends joined, in the lane graph, no guard rails');
  ok(r.onTrail==0,'2 no traffic drives on the trails (40 s parked on one)');
  ok(r.spawns>=3&&r.ahead==0,'3 '+r.spawns+' chasers turned out in 70 s with a sharp turn onto another highway: none appeared ahead of you (closest to ahead: cos '+r.worstCos+', must be under -0.5)');
  ok(r.offRoad&&r.tNear>0&&r.tNear<45,'4 parked '+r.fieldD+' m out in a field: the cops come across the grass and reach you after '+r.tNear+' s (closest '+r.near+' m)');
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
