// Drive a pure-pursuit bot along every road with REAL collisions; report stuck / buried / falling / off-road events.
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({file:process.env.RFILE||L.DEFAULT_FILE,q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const only=process.env.ONLY?process.env.ONLY.split(','):null,speed=+(process.env.SPD||24);
  const res=await T.ev(([only,spd])=>{
    const {C,IN,UI,ROADS,carStep,carPlace}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;const out=[];
    for(const r of ROADS){if(only&&!only.includes(r.id))continue;if(!only&&r.city&&Math.random()<.0)continue;
      const n=r.n,start=r.closed?20:12,a=Math.atan2(r.X[start+1]-r.X[start],-(r.Z[start+1]-r.Z[start]));
      const off=r.hw*.35;carPlace(r.X[start]+Math.cos(a)*off,r.Z[start]+Math.sin(a)*off,a,r.Y[start]+.5);C.vx=Math.sin(a)*spd;C.vz=-Math.cos(a)*spd;C.steer=0;C.wyaw=0;C.nos=0;IN.nitro=0;IN.hand=0;IN.brk=0;
      let flights=0,airN=0,maxAir=0,wasG2=true,idx=start,stuckT=0,offT=0,buried=0,fell=0,hits=0,maxHit=0,minGap=9,steps=0,stuckAt=null,t=0,laps=0,lastIdx=start,distAcc=0,hitAt=null;
      const maxT=Math.min(700,r.len/(spd*.5)+20),target=r.closed?r.len*.35:r.len-40;let travelled=0;
      while(t<maxT){
        // nearest index near previous idx
        let bi=idx,bd=1e18;for(let k=-6;k<=30;k++){let i=idx+k;if(r.closed)i=((i%n)+n)%n;else if(i<0||i>=n)continue;const d=(r.X[i]-C.x)**2+(r.Z[i]-C.z)**2;if(d<bd){bd=d;bi=i}}
        const adv=r.closed?((bi-idx+n)%n):(bi-idx);if(adv>=0&&adv<40)travelled+=adv*r.ds;idx=bi;
        if(!r.closed&&idx>=n-8)break;if(r.closed&&travelled>=target)break;
        // pure pursuit to a point ahead, lane offset to the right
        const look=Math.max(6,C.speed*.7),k2=Math.round(look/r.ds);let ti=idx+k2;if(r.closed)ti%=n;else ti=Math.min(n-1,ti);
        const tj=r.closed?(ti+1)%n:Math.min(n-1,ti+1),ta=Math.atan2(r.X[tj]-r.X[ti],-(r.Z[tj]-r.Z[ti])),tx=r.X[ti]+Math.cos(ta)*off,tz=r.Z[ti]+Math.sin(ta)*off;
        const want=Math.atan2(tx-C.x,-(tz-C.z)),err=angd(want,C.yaw);C.steer=Math.max(-1,Math.min(1,err*2.2));
        // speed control: curvy/hairpin roads need lower speed
        const tgt=r.id=='lombard'?7:r.id=='tp'?9:(r.id=='mp'?18:spd);IN.thr=C.speed<tgt?1:0;IN.brk=C.speed>tgt+4?1:0;
        carStep(1/120);t+=1/120;steps++;if(!C.grounded){airN++;if(wasG2)flights++;if(C.air>maxAir)maxAir=C.air}wasG2=C.grounded;
        if(C.speed<2.5&&t>3){stuckT+=1/120;if(stuckT>2.5&&!stuckAt)stuckAt=[Math.round(C.x),Math.round(C.z),idx]}else stuckT=0;
        if(!C.onRoad)offT+=1/120;
        const rg=roadAt(C.x,C.z,C.y)?RQ.y:null;if(rg!=null){const gap=C.y-rg;if(gap<minGap)minGap=gap;if(gap<-.45)buried++}
        if(C.vy<-18)fell++;if(C.hit>4){if(maxHit<C.hit)maxHit=C.hit;if(!hitAt)hitAt=[Math.round(C.x),Math.round(C.z)];hits++;C.hit=0}
        if(stuckAt&&stuckT>8)break}
      out.push(r.id.padEnd(8)+' '+(idx>=n-10||(r.closed&&travelled>=target)?'done':'STOPPED at '+Math.round(travelled)+'/'+Math.round(r.closed?target:r.len)+' m')+'  time '+t.toFixed(0)+'s  off-road '+offT.toFixed(1)+'s  below-road-frames '+buried+'  big-falls '+fell+'  hits '+hits+'  flights '+flights+(flights?' (longest '+maxAir.toFixed(2)+'s)':'')+(hitAt?' (first '+hitAt+', max '+maxHit.toFixed(0)+')':'')+(stuckAt?'  STUCK at '+stuckAt:''))}
    return out},[only,speed]);
  console.log(res.join('\n'));console.log('errs',T.errs);await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
