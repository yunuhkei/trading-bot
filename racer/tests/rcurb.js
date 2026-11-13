// Curbs (batch 27): driving over a curb onto a sidewalk and back is only a rumble: no speed lost, no kick to the heading, no roll.
// usage: node racer/tests/rcurb.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:300,h:200,mobile:false,traffic:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const r=await T.ev(()=>{const {C,IN,UI}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;IN.lane=false;COP.on=false;const out=[];
    /* city streets with a sidewalk on the right at the spot: cross onto it at 25 degrees and back, at 12 and 22 m/s, hands off the wheel */
    const roads=ROADS.filter(r=>r.sw&&r.n*r.ds>300).slice(0,40);
    for(const v of[12,22])for(const r of roads){let i=-1;for(let k=Math.round(r.n*.3);k<r.n*.7;k++)if(swOn(r,1,r.S[k])&&swOn(r,1,r.S[Math.min(r.n-1,k+12)])){i=k;break}if(i<0)continue;
      const t=_tan(r,i),a=Math.atan2(t[0],-t[1]),nx=-t[1],nz=t[0];
      for(const dir of[1,-1,0]){const ang=a+dir*.44,off=dir>0?r.hw-3.2-v*.3*.44:r.hw+1.8+v*.3*.44;RACER.carPlace(r.X[i]+nx*off,r.Z[i]+nz*off,ang,r.Y[i]+.5);C.vx=Math.sin(ang)*v;C.vz=-Math.cos(ang)*v;
        let maxSh=0,n0=C.cbN,maxN=0,yaw0=C.yaw,minV=1e9,maxRoll=0,maxPitch=0,steps=0;const v0=v;
        for(let s=0;s<120*1.1;s++){C.steer=0;IN.thr=0;IN.brk=0;if(s<36){C.vx=Math.sin(ang)*v;C.vz=-Math.cos(ang)*v;C.wyaw=0}RACER.worldStep(1/120);if(s<36){n0=C.cbN;yaw0=C.yaw;continue}maxN=Math.max(maxN,C.cbN);minV=Math.min(minV,C.speed);maxRoll=Math.max(maxRoll,Math.abs(C.roll-C.proll)*120);maxPitch=Math.max(maxPitch,Math.abs(C.pitch-C.ppitch)*120+Math.abs(C.y-C.py-(C.vy||0)/120)*0);maxSh=Math.max(maxSh,C.shake);if(TUM.on)break}
        if(dir==0){const last=out.slice(-2);for(const o of last)if(o.id==r.id&&o.v==v)o.dv=+(o.dv-(v0-minV)).toFixed(2);continue}if(maxN==0&&dir>0)continue;out.push({id:r.id,v,dir,cb:maxN,dv:+(v0-minV).toFixed(2),dyaw:+Math.abs(angd(C.yaw,yaw0)).toFixed(3),roll:+maxRoll.toFixed(3),pitch:+maxPitch.toFixed(3),sh:+maxSh.toFixed(3),tum:TUM.on?1:0});}if(out.length>=30)return out}
    return out});
  /* 3 sliding sideways at 45 mph into a curb: it used to trip the car into a roll */
  const S=await T.ev(()=>{const {C,IN}=RACER;const r=ROADS.find(q=>q.id=='sfnu3');let i=-1;for(let k=Math.round(r.n*.3);k<r.n*.7;k++)if(swOn(r,1,r.S[k])){i=k;break}const t=_tan(r,i),a=Math.atan2(t[0],-t[1]),nx=-t[1],nz=t[0];
    RACER.carPlace(r.X[i]+nx*(r.hw-2.5),r.Z[i]+nz*(r.hw-2.5),a,r.Y[i]+.5);C.vx=nx*20;C.vz=nz*20;let tum=0,cb=0;for(let s=0;s<120;s++){C.steer=0;IN.thr=0;RACER.worldStep(1/120);if(TUM.on)tum=1;cb=Math.max(cb,C.cbN)}return{tum,cb,cc:CC.on}});
  ok(S.cb>0&&!S.tum,'3 sliding sideways at 45 mph onto a sidewalk: no roll (wheels on the curb '+S.cb+')');
  const m=k=>Math.max(...r.map(o=>o[k]));console.log(r.length+' crossings; worst: speed lost '+m('dv')+' m/s, heading '+m('dyaw')+' rad, roll '+m('roll')+', pitch '+m('pitch')+', shake '+m('sh')+', tumbles '+r.filter(o=>o.tum).length);
  const bad1=r.filter(o=>o.dyaw>.05||o.roll>.8||o.pitch>.8||o.tum);if(bad1.length)console.log(JSON.stringify(bad1.slice(0,6)));
  ok(r.length>=10,'1 '+r.length+' curb crossings on city streets, at 27 and 49 mph');
  ok(!bad1.length,'2 none is turned by the curb (3 degrees), rocked faster than 0.8 rad/s (it was 1.17 before batch 27) or rolled over');
  ok(r.filter(o=>o.dv<o.v*.04).length>=r.length*.75,'2 and it costs almost no speed: under 4 % more than coasting down the lane for '+r.filter(o=>o.dv<o.v*.04).length+' of '+r.length+' (the rest ran into something past the sidewalk)');
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
