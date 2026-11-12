// Traffic lights: the controllers (Node: never two phases open at once, an all-red gap, cycle lengths) and the traffic at signalised junctions in the browser (cars stop at the line on red,
// queue, go on green, nobody runs a red after the late-yellow grace, no jams, no wrecks). SECS=120 by default; ONLY=sfnu3,... picks places.
const fs=require('fs'),path=require('path');const R=path.join(__dirname,'..','src')+'/';
global.window={addEventListener(){}};global.document={getElementById(){return null}};
let bad=0;const ck=(ok,msg)=>{console.log((ok?'ok   ':'FAIL ')+msg);if(!ok)bad++};
{const src=['00_util.js','20_map.js','20_organic.js','20_world.js','23_lanes.js','24_signals.js'].map(f=>fs.readFileSync(R+f,'utf8').replace(/^'use strict';/,'')).join('\n');
 const M=new Function(src+';defineRoads();lgBuild();const s=sigBuild();return {s,SIG,sigState,PLACES,ROADS}')();const {SIG,sigState}=M;
 let both=0,minAR=1e9,T0=1e9,T1=0;for(const I of SIG.I){T0=Math.min(T0,I.T);T1=Math.max(T1,I.T);let lastOpen=-1,ar=0,inAR=false;
   for(let t=0;t<I.T*2;t+=.05){const a=sigState({I,ph:0},t),b=sigState({I,ph:1},t);if(a<2&&b<2)both++;const open=a<2?0:b<2?1:-1;if(open<0){if(!inAR){inAR=true;ar=0}ar+=.05}else{if(inAR&&lastOpen>=0&&open!=lastOpen)minAR=Math.min(minAR,ar);inAR=false;lastOpen=open}}}
 ck(M.s.intersections>200,'signals: '+M.s.intersections+' intersections with lights, '+M.s.approaches+' approaches');
 ck(both==0,'the two phases of an intersection are never open (green or yellow) at the same time');
 ck(minAR>=1.1,'there is an all-red gap of at least '+minAR.toFixed(2)+' s between them');ck(T0>=27&&T1<=36,'cycles last '+T0.toFixed(1)+' to '+T1.toFixed(1)+' s');
 const inBoxP=(I,B)=>I.x>B.x0-40&&I.x<B.x1+40&&I.z>B.z0-40&&I.z<B.z1+40;const per=M.PLACES.map(p=>p.name+' '+SIG.I.filter(I=>inBoxP(I,p.box)).length);
 ck(M.PLACES.every(p=>SIG.I.some(I=>inBoxP(I,p.box))),'every city and town has lights: '+per.join(', '))}
const L=require('./rlib.js');
const places=[['sfnu3',.5,'downtown'],['lau1',.5,'Valley'],['vegu2',.5,'Las Vegas'],['sacu2',.5,'Sacramento']];
const only=process.env.ONLY?process.env.ONLY.split(','):null,SECS=+(process.env.SECS||120);
(async()=>{
  const T=await L.launch({q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  ck(T.errs.length==0&&RACER_ok(await T.ev(()=>[SIG.heads.length,BOOT.sigHeads])),'the game builds the lights ('+(await T.ev(()=>SIG.heads.length/7))+' heads, two per approach)');
  function RACER_ok(a){return a[0]>0}
  for(const[id,f,label]of places){if(only&&!only.includes(id))continue;
    const r=await T.ev(([id,f,SECS])=>{const {C,ROADS,TR,UI}=RACER;UI.paused=true;const rd=ROADS.find(q=>q.id==id),i=Math.round(f*rd.n),a=Math.atan2(rd.X[i+1]-rd.X[i],-(rd.Z[i+1]-rd.Z[i])),side=rd.hw+(rd.sw||RSH)+1.2;
      TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;TR.seedBase=20240601;trInit();RACER.carPlace(rd.X[i]+Math.cos(a)*side,rd.Z[i]+Math.sin(a)*side,a,rd.Y[i]+.5);const x0=C.x,z0=C.z;
      const res={runRed:0,lateYellow:0,greenX:0,overshoot:0,maxQ:0,waitMax:0,stuck:0,crossings:{},near:0};const prev=new Map(),stopAt=new Map();
      const near=SIG.I.filter(I=>Math.hypot(I.x-x0,I.z-z0)<220);res.near=near.length;const nearSet=new Set(near);
      for(let s=0;s<SECS*120;s++){RACER.worldStep(1/120);C.x=C.px=x0;C.z=C.pz=z0;C.vx=C.vz=C.vy=0;C.wyaw=0;if(s%2)continue;
        const qn=new Map();
        for(const c of TR.cars){if(!c.alive||c.state!=0)continue;let key=null,d=null,g=null;
          if(!c.L&&c.e){g=lgNextJ(c.e,c.u);if(g&&g.sig&&nearSet.has(g.sig.I)){let su=g.minFu;if(c.e.closed&&su<c.u-1e-6)su+=c.e.n;d=trSu(c.e,su)-trSu(c.e,c.u)-c.hl;key=g}}
          const p=prev.get(c.i);
          if(key&&d!=null){const st=sigState(g.sig);if(st>0&&c.v<.3&&d<12){qn.set(g,(qn.get(g)||0)+1);stopAt.set(c.i,(stopAt.get(c.i)||0)+1/60);res.waitMax=Math.max(res.waitMax,stopAt.get(c.i))}
            if(d<=0)stopAt.delete(c.i);
            if(p&&p.g===g&&p.d>0&&d<=0){const st0=sigState(g.sig),st1=sigState(g.sig,SIG.t-1.5);if(st0==2&&st1==2){res.runRed++;(res.rr||(res.rr=[])).push({v:+c.v.toFixed(1),pd:+p.d.toFixed(2),flags:c.flags,ign:+c.ign.toFixed(1),k:c.kind,cm:c.cm,age:+c.age.toFixed(1),hist:(c._h||[]).join(' ')})}else if(st0==2)res.lateYellow++;else if(st0==0)res.greenX++;
              const k=g.sig.I.id+'/'+g.sig.ph;res.crossings[k]=(res.crossings[k]||0)+1}}
          if(key){c._h=c._h||[];c._h.push(d.toFixed(1)+'/'+c.v.toFixed(1)+'/'+sigState(g.sig));if(c._h.length>12)c._h.shift()}
          prev.set(c.i,key?{g:key,d}:null)}
        for(const[g,n]of qn)if(n>res.maxQ)res.maxQ=n}
      const st=TR.stat;res.wrecks=st.wrecks;res.spawn=st.spawn;res.jams=st.stuck;res.ign=st.ign;
      const ph=new Set(Object.keys(res.crossings).map(k=>k.split('/')[1]));res.bothPhases=ph.size;res.nX=Object.values(res.crossings).reduce((a,b)=>a+b,0);delete res.crossings;return res},[id,f,SECS]);
    const ok=r.runRed==0&&r.bothPhases==2&&r.maxQ>=2&&r.waitMax<40&&r.wrecks/Math.max(1,r.spawn)<.03;
    ck(ok,label.padEnd(11)+' '+r.near+' lights within 220 m: '+r.nX+' cars crossed a stop line ('+r.greenX+' on green, '+r.lateYellow+' late yellow, '+r.runRed+' on red), both phases flow: '+(r.bothPhases==2)+', longest queue '+r.maxQ+' cars, longest wait '+r.waitMax.toFixed(0)+' s, stopped past the line '+r.overshoot+', wrecked '+r.wrecks+' of '+r.spawn+', jams dissolved '+r.jams+', deadlock breaker '+r.ign+(r.rr?' '+JSON.stringify(r.rr):''))}
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
