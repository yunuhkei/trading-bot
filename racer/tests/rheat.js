// Cops at the start of a run (batch 3): from the real start (traffic and cops on, the default difficulty) the player waits, pulls out and drives normally on the ring for MIN minutes
// (a bot that follows its lane, keeps its distance to the car in front and never blows past a cop): the heat must stay 0, no cop may chase, and every impact is logged with who was at fault.
// MIN=3 by default; SEED changes the traffic.
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
const MIN=+(process.env.MIN||3);
(async()=>{
  const T=await L.launch({q:'go=1&scale=.4&fixed=1'+(process.env.Q||''),w:300,h:200,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const r=await T.ev(([MIN,SEED])=>{const {C,IN,UI,TR,COP}=RACER;UI.paused=true;if(SEED){TR.seedBase=SEED;trInit()}
    const log=[],hits=[];let maxHeat=0,chase=0,patrolsSeen=new Set(),firstHeat=-1,minCop=1e9,dist=0;const n0=IMP.n;
    const lane=()=>{const sn=navSnap(C.x,C.z,30);return sn?navLane(sn,C.x,C.z,Math.sin(C.yaw),-Math.cos(C.yaw)):null};
    for(let s=0;s<MIN*60*120;s++){const t=s/120;
      /* drive: wait 3 s, then follow the lane ahead at up to 27 m/s, slowing for anything in front */
      IN.assist=true;IN.hand=0;IN.nitro=0;let thr=0,brk=0,st=0;
      if(t>3){const ln=lane();if(ln){const e=ln.e;trPt(e,Math.min(e.n-1,ln.u+(e.closed?0:0)+Math.max(2,Math.round(C.speed*.45/e.ds+2))));const want=Math.atan2(_pt.x-C.x,-(_pt.z-C.z));st=clamp(angd(want,C.yaw)*1.6,-1,1)}
        let gap=1e9;for(const c of TR.cars){if(!c.alive)continue;const dx=c.x-C.x,dz=c.z-C.z,f=dx*Math.sin(C.yaw)-dz*Math.cos(C.yaw),l=Math.abs(dx*Math.cos(C.yaw)+dz*Math.sin(C.yaw));if(f>0&&l<2.4&&f<gap)gap=f}
        const vT=Math.min(27,Math.max(0,(gap-8)*.8));thr=C.speed<vT?1:0;brk=C.speed>vT+2?1:0}
      C.steer=st;IN.thr=thr;IN.brk=brk;RACER.worldStep(1/120);dist+=C.speed/120;
      if(COP.heat>maxHeat)maxHeat=COP.heat;if(COP.heat>0&&firstHeat<0)firstHeat=t;
      if(s%30==0)for(const c of TR.cars){if(!c.alive||c.kind!==1)continue;if(c.cm>0)chase++;if(c.cm==0)patrolsSeen.add(c.seed);minCop=Math.min(minCop,Math.hypot(c.x-C.x,c.z-C.z))}}
    for(let k=n0;k<IMP.n;k++){const q=IMP.q[IMP.q.length-(IMP.n-k)];if(q)hits.push({t:+q.t.toFixed(1),src:q.src,E:Math.round(q.E/1000),vn:+q.vn.toFixed(1)})}
    return{maxHeat,chase,patrols:patrolsSeen.size,firstHeat:+firstHeat.toFixed(1),minCop:Math.round(minCop),hits,km:+(dist/1000).toFixed(1),w:COP.w,crimes:COP.crimes||[]}},[MIN,+(process.env.SEED||0)]);
  console.log(JSON.stringify(r));
  ok(r.km>MIN*1.2,'the bot drove '+r.km+' km in '+MIN+' minutes');
  ok(r.maxHeat==0&&r.firstHeat<0,'driving normally the heat stays 0 (highest '+r.maxHeat+(r.firstHeat>=0?', first at '+r.firstHeat+' s':'')+')');
  ok(r.chase==0,'no cop engages ('+r.chase+' chase samples)');
  ok(r.patrols<=4,'patrols are rare: '+r.patrols+' different patrol cars came within the spawn range in '+MIN+' minutes, nearest '+r.minCop+' m');
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
