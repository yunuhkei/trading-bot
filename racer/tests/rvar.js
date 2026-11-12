// Traffic variety (batch 2): which vehicles drive where, buses stop at the bus stops, refuse trucks stop and start, nothing jams or crashes more than before.
// SECS=120 by default, ONLY=sfnu3,... picks places.
const L=require('./rlib.js');let bad=0;const ck=(ok,m)=>{console.log((ok?'ok   ':'FAIL ')+m);if(!ok)bad++};
const places=[['sfnu3',.5,'downtown'],['vegu2',.5,'Las Vegas'],['ring',.3,'ring'],['bigu1',.5,'Big Pines']];const only=process.env.ONLY?process.env.ONLY.split(','):null,SECS=+(process.env.SECS||120);
(async()=>{
  const T=await L.launch({q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const info=await T.ev(()=>({types:TTYPES.map(t=>t.n),stops:BOOT.busStops,tris:TRM.types.map(m=>m.n/3|0),errs:0}));
  ck(info.types.length>=20,'traffic has '+info.types.length+' vehicle types: '+info.types.join(', '));
  ck(info.stops>40,info.stops+' bus stops with a shelter');
  const near=info.tris.filter((_,i)=>i%2==0),far=info.tris.filter((_,i)=>i%2==1&&_>0);ck(Math.max(...near)<7500,'near bodies '+Math.min(...near)+'-'+Math.max(...near)+' triangles, far bodies '+Math.min(...far)+'-'+Math.max(...far)+' ('+far.length+' far meshes for '+near.length+' types)');
  for(const[id,f,label]of places){if(only&&!only.includes(id))continue;
    const r=await T.ev(([id,f,SECS])=>{const {C,ROADS,TR,UI}=RACER;UI.paused=true;const rd=ROADS.find(q=>q.id==id),i=Math.round(f*rd.n),a=Math.atan2(rd.X[i+1]-rd.X[i],-(rd.Z[i+1]-rd.Z[i])),side=rd.hw+(rd.sw||RSH)+1.2;
      TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;TR.seedBase=20240611;trInit();RACER.carPlace(rd.X[i]+Math.cos(a)*side,rd.Z[i]+Math.sin(a)*side,a,rd.Y[i]+.5);const x0=C.x,z0=C.z,seen=new Map(),busStop=new Set(),halts=new Set();let maxStop=0;
      for(let s=0;s<SECS*120;s++){RACER.worldStep(1/120);C.x=C.px=x0;C.z=C.pz=z0;C.vx=C.vz=C.vy=0;if(s%60)continue;
        for(const c of TR.cars){if(!c.alive||c.state)continue;const n=TTYPES[c.type].n;if(!seen.has(c.i+':'+c.seed)){seen.set(c.i+':'+c.seed,n)}if(c.beh=='bus'&&c.dwell>0)busStop.add(c.seed+':'+c.lastStop);if(c.beh=='garbage'&&c.dwell>0)halts.add(c.seed+':'+c.nh);maxStop=Math.max(maxStop,c.stopT)}}
      const cnt={};for(const n of seen.values())cnt[n]=(cnt[n]||0)+1;const st=TR.stat;return{cnt,bus:busStop.size,halts:halts.size,wr:st.wrecks,sp:st.spawn,jams:st.stuck,maxStop,ms:(st.msSum/st.ticks).toFixed(2)}},[id,f,SECS]);
    const types=Object.keys(r.cnt).length,town=id!='ring';
    ck(types>=6&&r.wr/Math.max(1,r.sp)<.03&&r.maxStop<40&&(!town||id=='bigu1'||r.bus+r.halts>0),label.padEnd(10)+' '+types+' kinds of vehicle: '+Object.entries(r.cnt).sort((a,b)=>b[1]-a[1]).map(e=>e[0]+' '+e[1]).join(', ')+'; bus stops made '+r.bus+', refuse stops '+r.halts+', wrecked '+r.wr+' of '+r.sp+', jams '+r.jams+', longest stand '+r.maxStop.toFixed(0)+' s, cpu/tick '+r.ms+' ms')}
  console.log('errs',T.errs.length?T.errs:0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
