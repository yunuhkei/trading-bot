// Drive the jump hills with a pure-pursuit bot at several speeds: air time, distance, landing speed, burying, crashes.
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({file:process.env.RFILE||L.DEFAULT_FILE,q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const log=await T.ev(()=>{
    const {C,IN,UI,ROADS,carStep,carPlace}=RACER;UI.paused=true;IN.assist=false;IN.auto=false;const out=[];
    for(const[id,gi]of[['sh',0],['sh',1],['el',0],['ring',0]]){const r=ROADS.find(q=>q.id==id),h=r.def.humps[gi],s0=h.f*r.len,s1=s0+h.n*h.len;let a=0,b=0;for(let i=0;i<r.n;i++){if(r.S[i]<=s0)a=i;if(r.S[i]<=s1)b=i}
      for(const v of [22,30,36,45,60]){
        const start=Math.max(10,a-90),n=r.n;const aa=Math.atan2(r.X[start+1]-r.X[start],-(r.Z[start+1]-r.Z[start]));
        carPlace(r.X[start],r.Z[start],aa,r.Y[start]+.5);C.vx=Math.sin(aa)*v;C.vz=-Math.cos(aa)*v;C.steer=0;C.wyaw=0;C.nos=0;IN.nitro=0;IN.hand=0;IN.brk=0;C.airMax=0;
        let idx=start,t=0,airT=0,airN=0,maxAir=0,buried=0,hit=0,minGap=9,fell=0,vBefore=0,vAfter=0,landings=0,maxVy=0,wasAir=false,peakY=0,dist0=0,airDist=0,ax0=0,az0=0,flights=0;
        while(t<40){let bi=idx,bd=1e18;for(let k=-6;k<=30;k++){const i=idx+k;if(i<0||i>=n)continue;const d=(r.X[i]-C.x)**2+(r.Z[i]-C.z)**2;if(d<bd){bd=d;bi=i}}idx=bi;if(idx>=Math.min(n-8,b+60))break;
          const look=Math.max(8,C.speed*.7),ti=Math.min(n-1,idx+Math.round(look/r.ds)),tj=Math.min(n-1,ti+1),ta=Math.atan2(r.X[tj]-r.X[ti],-(r.Z[tj]-r.Z[ti])),want=Math.atan2(r.X[ti]-C.x,-(r.Z[ti]-C.z)),err=angd(want,C.yaw);C.steer=Math.max(-1,Math.min(1,err*2.2));
          IN.thr=C.speed<v?1:0;IN.brk=0;
          const wasG=C.grounded;const fBefore=C.speed;carStep(1/120);t+=1/120;
          if(!C.grounded){if(wasG){flights++;ax0=C.x;az0=C.z}airT+=1/120;peakY=Math.max(peakY,C.y)}else if(!wasG){const d=Math.hypot(C.x-ax0,C.z-az0);if(d>airDist)airDist=d;landings++}
          if(C.air>maxAir)maxAir=C.air;
          const rg=roadAt(C.x,C.z,C.y)?RQ.y:null;if(rg!=null&&C.grounded){const gap=C.y-rg;if(gap<minGap)minGap=gap;if(gap<-.45)buried++}
          if(C.vy<-30)fell++;if(C.hit>4)hit++}
        out.push(id+' humps#'+gi+' @'+Math.round(v*2.237)+'mph: flights '+flights+', longest air '+maxAir.toFixed(2)+' s, farthest flight '+airDist.toFixed(0)+' m, peak height above road '+(peakY?(peakY-r.Y[Math.min(n-1,idx)]).toFixed(1):'-')+' m, buried frames '+buried+', hard hits '+hit+', fast falls '+fell+', speed at end '+Math.round(C.speed*2.237)+' mph')}}
    return out});
  log.forEach(l=>console.log(l));console.log('errs',T.errs);await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
