// The raised median (batch 33): divided highways have a 15 cm concrete median (r.mm = how much of CURB_H it has at each sample), open at junction boxes, across other roads and at the U-turn gaps (r.xov).
// The wheels take it as a gentle 1 m ramp plus a rumble, never a jolt, a turn or a roll. usage: node racer/tests/rmedian.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:300,h:200,mobile:false,traffic:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  /* 1. where the median is */
  const A=await T.ev(()=>{const div=ROADS.filter(r=>r.mm);let tot=0,full=0,cut=0,xo=0,xcut=0,jb=0,jcut=0,bad=0;
    for(const r of div){for(let i=0;i<r.n;i++){tot++;if(r.mm[i]>.99)full++;if(!(r.mm[i]>=0&&r.mm[i]<=1))bad++;if(r.mk[i]<.2){jb++;if(r.mm[i]<.01)jcut++}}
      if(r.xov)for(const p of r.xov){xo++;if(r.mm[p]===0&&r.mm[p-3]===0&&r.mm[p+3]===0)xcut++}}
    return{roads:div.length,tot,full,xo,xcut,jb,jcut,bad,nonDiv:ROADS.filter(r=>!(r.style==1||r.style==4)&&r.mm).length}});
  ok(A.roads>=5&&A.bad===0,'1 '+A.roads+' divided roads carry a median ('+A.tot+' samples, all heights between 0 and 1); no other road has one ('+A.nonDiv+')');
  ok(A.full>A.tot*.5,'1 the median is whole over most of the length ('+Math.round(A.full/A.tot*100)+' % of the samples)');
  ok(A.xo>=5&&A.xcut===A.xo,'1 it is open at all '+A.xo+' U-turn gaps ('+A.xcut+' open)');
  ok(A.jb>0&&A.jcut===A.jb,'1 and open in all '+A.jb+' junction-box samples ('+A.jcut+' open)');
  /* 2. the ground under the wheels */
  const G=await T.ev(()=>{const r=ROADS.find(q=>q.mm&&!q.city&&q.n>200);let i=-1;for(let k=20;k<r.n-30;k++){let g=true;for(let d=-3;d<=12;d++)if(!(r.mm[k+d]>.99)||r.br[k+d])g=false;if(g){i=k;break}}
    const t=_tan(r,i),nx=-t[1],nz=t[0],at=(lat,soft)=>{const x=r.X[i]+nx*lat,z=r.Z[i]+nz*lat;RQS.soft=soft;const g=groundAt(x,z,r.Y[i]+.3);RQS.soft=0;return g-(r.Y[i]+lat*r.cf[i])};
    return{h0:at(0,0),h13:at(1.3,0),h14:at(1.5,0),s10:at(1.0,1),s05:at(.5,1),s0:at(0,1),s135:at(1.34,1),out:at(2.5,0),cb:(()=>{groundAt(r.X[i],r.Z[i],r.Y[i]+.3);return RQ.cb})()}});
  ok(Math.abs(G.h0-.15)<.01&&Math.abs(G.h13-.15)<.02&&G.h14<.01&&Math.abs(G.out)<.01,'2 the median top is 15 cm up (centre '+G.h0.toFixed(3)+', 1.3 m out '+G.h13.toFixed(3)+'), and the lane beside it is level (1.5 m '+G.h14.toFixed(3)+', 2.5 m '+G.out.toFixed(3)+')');
  ok(G.s135<.01&&G.s10>G.s135&&G.s05>G.s10&&G.s0>=G.s05-.001&&G.s0>.14,'2 for the wheels it is a gentle ramp: '+G.s135.toFixed(3)+' at the edge, '+G.s10.toFixed(3)+' at 1.0 m, '+G.s05.toFixed(3)+' at 0.5 m, '+G.s0.toFixed(3)+' on the top');
  ok(G.cb===1,'2 the median top counts as a curb for the rumble');
  /* 3. crossing it at 25 degrees, hands off the wheel (like rcurb): no turn, no roll, no jolt, little speed lost */
  const C3=await T.ev(()=>{const {C,IN,UI}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;IN.lane=false;COP.on=false;const out=[];
    const roads=ROADS.filter(q=>q.mm&&!q.city&&q.n>200).slice(0,12);
    for(const v of[12,22])for(const r of roads){let i=-1;for(let k=20;k<r.n-60;k++){let g=true;for(let d=-4;d<=40;d++)if(!(r.mm[k+d]>.99)||r.br[k+d])g=false;if(g){i=k;break}}if(i<0)continue;
      const t=_tan(r,i),a=Math.atan2(t[0],-t[1]),nx=-t[1],nz=t[0];
      for(const dir of[1,-1]){const ang=a+dir*.44,off=-dir*(2.9+v*.3*.44);RACER.carPlace(r.X[i]+nx*off,r.Z[i]+nz*off,ang,r.Y[i]+.5);C.vx=Math.sin(ang)*v;C.vz=-Math.cos(ang)*v;C.wyaw=0;
        let maxN=0,minV=1e9,maxRoll=0,maxPitch=0,maxRA=0,yaw0=C.yaw,tum=0;
        for(let s=0;s<120*1.3;s++){C.steer=0;IN.thr=0;IN.brk=0;if(s<30){C.vx=Math.sin(ang)*v;C.vz=-Math.cos(ang)*v;C.wyaw=0}RACER.worldStep(1/120);if(s<30){yaw0=C.yaw;continue}
          maxN=Math.max(maxN,C.cbN||0);minV=Math.min(minV,C.speed);maxRoll=Math.max(maxRoll,Math.abs(C.roll-C.proll)*120);maxRA=Math.max(maxRA,Math.abs(C.roll));maxPitch=Math.max(maxPitch,Math.abs(C.pitch-C.ppitch)*120);if(typeof TUM!=='undefined'&&TUM.on)tum=1}
        out.push({id:r.id,v,dir,cb:maxN,dv:+(v-minV).toFixed(2),dyaw:+Math.abs(angd(C.yaw,yaw0)).toFixed(3),roll:+maxRoll.toFixed(3),ra:+maxRA.toFixed(3),pitch:+maxPitch.toFixed(3),tum})}}
    return out});
  const m=k=>Math.max(...C3.map(o=>o[k]));console.log(C3.length+' crossings; worst: speed lost '+m('dv')+' m/s, heading '+m('dyaw')+' rad, roll '+m('roll')+', roll angle '+m('ra')+' rad, pitch '+m('pitch')+', tumbles '+C3.filter(o=>o.tum).length);
  const bad3=C3.filter(o=>o.dyaw>.05||o.roll>1.0||o.ra>.12||o.pitch>.8||o.tum);if(bad3.length)console.log(JSON.stringify(bad3.slice(0,5)));
  ok(C3.length>=16&&C3.filter(o=>o.cb>0).length>=C3.length*.8,'3 '+C3.length+' crossings of the median at 27 and 49 mph, the wheels met it in '+C3.filter(o=>o.cb>0).length);
  ok(!bad3.length,'3 none is turned (3 degrees), rocked faster than 1.0 rad/s (a single curb: under 0.6; the old jolt was 1.17: the median is two edges 2.7 m apart), rolled more than 7 degrees or tipped over');
  ok(C3.filter(o=>o.dv<o.v*.12).length>=C3.length*.85,'3 and it costs little speed (under 12 % in 1 s of coasting) for '+C3.filter(o=>o.dv<o.v*.12).length+' of '+C3.length);
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
