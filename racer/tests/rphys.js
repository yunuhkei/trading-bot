// Driving physics review: measures the things a thumb feels, on the real physics, as the game is PLAYED (road assist on unless a section says otherwise).
//   node racer/tests/rphys.js            the current handling (checks its numbers)
//   HNDMODE=classic node racer/tests/rphys.js   the old handling (?hnd=classic), numbers only
// Sections: A steering response, B pivot point, C grip / slide transitions, D braking + reverse, E throttle, F walls (collision response), G jump landings, H ground following, I guard rails, J curbs.
const L=require('./rlib.js');
const MODE=process.env.HNDMODE||'';
(async()=>{
  const T=await L.launch({file:process.env.RFILE||L.DEFAULT_FILE,q:'go=1&scale=.4&fixed=1'+(MODE?'&hnd='+MODE:''),w:300,h:200,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const res=await T.ev(()=>{
    const {C,IN,UI,ROADS,carStep,carPlace,HND}=RACER;UI.paused=true;const M={},log=[];
    const cst0=QH.cst.slice(),cli0=QH.cli,nR0=QH.nR,nC0=QH.nC,CR0=QH.CR,rails0=ROADS.map(r=>r.rail.slice());
    const noCol=()=>{QH.cst.fill(0);ROADS.forEach(r=>r.rail.fill(0))};
    const restore=()=>{QH.cst.set(cst0);QH.cli=cli0;QH.nR=nR0;QH.nC=nC0;QH.CR=CR0;ROADS.forEach((r,i)=>r.rail.set(rails0[i]))};
    const sh=ROADS.find(q=>q.id=='sh'),i0=Math.round(.64*sh.n),a0=Math.atan2(sh.X[i0+1]-sh.X[i0],-(sh.Z[i0+1]-sh.Z[i0]));
    /* a flat test pad: the car is put on the long straight of the southern highway, in its right-hand carriageway */
    const place=(v,assist,lat)=>{const o=lat==null?-sh.hw*.45:lat;carPlace(sh.X[i0]+Math.cos(a0)*o,sh.Z[i0]+Math.sin(a0)*o,a0,sh.Y[i0]+.5);C.vx=Math.sin(a0)*v;C.vz=-Math.cos(a0)*v;C.steer=0;C.wyaw=0;C.nos=.5;C.drift=0;C.slideT=0;C.tapN=0;C.tapT=0;C.dbK=0;C.ax=0;IN.hand=0;IN.nitro=0;IN.brk=0;IN.thr=0;IN.auto=false;IN.assist=assist!==false};
    const hold=v=>{const s=Math.hypot(C.vx,C.vz)||1;C.vx*=v/s;C.vz*=v/s};       /* keep the speed fixed while a steering number is measured */
    const run=(sec,fn)=>{for(let i=0;i<Math.round(sec*120);i++){fn&&fn(i/120,i);carStep(1/120)}};
    noCol();
    /* ---------- A. steering: what the stick does ---------- */
    /* A1 yaw rate against stick position, speed held, assist ON (as played): a stick should be a RATE control everywhere. gain = yaw rate / stick, relative to the full-stick gain. */
    M.A1={};for(const v of[20,40,65]){const row=[];let full=0;for(const st of[1,.5,.25,.12,.06]){place(v,true,st<.2?0:null);let w=0,n=0;run(st<.2?2:.6,(t)=>{C.steer=st;hold(v);if(t>(st<.2?1.2:.35)){w+=C.wyaw;n++}});const om=w/n;if(st==1)full=om;row.push(+(om/st/full).toFixed(2))}M.A1[v]={gainRelToFull:row,fullYaw:+full.toFixed(3),latG:+(full*v/9.81).toFixed(2)}}
    /* A2 hold a small stick (12 %) for 3 s on the straight, assist on: how far does the heading go? (a rate control keeps turning; the old assist stopped it at a fixed angle) */
    M.A2={};for(const v of[30,60]){place(v,true,0);const y0=C.yaw;let h1=0;run(3,(t)=>{C.steer=.12;hold(v);if(Math.abs(t-1.5)<.005)h1=(C.yaw-y0)*57.3});M.A2[v]={deg1_5s:+h1.toFixed(1),deg3s:+((C.yaw-y0)*57.3).toFixed(1)}}
    /* A3 step response: stick from 0 to full (through the game's own input smoothing), time to 63 % and 90 % of the final yaw rate */
    M.A3={};for(const v of[20,40,65]){place(v,false);run(.3,()=>hold(v));let st=0,t63=-1,t90=-1,fin=0;const tr=[];run(.6,(t)=>{st+=(1-st)*Math.min(1,(1/120)*20);C.steer=st;hold(v);tr.push(C.wyaw)});fin=tr[tr.length-1];for(let i=0;i<tr.length;i++){if(t63<0&&tr[i]>=.63*fin)t63=i/120;if(t90<0&&tr[i]>=.9*fin)t90=i/120}
      /* and the body roll that shows it (visual only): time to 63 % of the final lean */
      place(v,false);run(.3,()=>hold(v));const rl=[];run(.6,()=>{C.steer=1;hold(v);rl.push(C.roll)});let r63=-1;for(let i=0;i<rl.length;i++)if(r63<0&&Math.abs(rl[i])>=.63*Math.abs(rl[rl.length-1]))r63=i/120;M.A3[v]={t63:+t63.toFixed(3),t90:+t90.toFixed(3),roll63:+r63.toFixed(3),rollDeg:+(rl[rl.length-1]*57.3).toFixed(1)}}
    /* A4 a quick dab: 30 % stick for 0.2 s then centre, assist on: sideways move after 1 s (m). Too much at speed = twitchy. */
    M.A4={};for(const v of[30,60,80]){place(v,true);run(.2,()=>hold(v));const x0=C.x,z0=C.z;run(1,(t)=>{C.steer=t<.2?.3:0;hold(v)});M.A4[v]=+(((C.x-x0)*Math.cos(a0)+(C.z-z0)*Math.sin(a0))).toFixed(2)}
    /* A5 hands off on the straight, 2 m off the lane centre and 3 degrees off the road direction: what does the car do by itself? (assist on) */
    {place(40,true,2);C.yaw+=.052;C.vx=Math.sin(C.yaw)*40;C.vz=-Math.cos(C.yaw)*40;run(2.5,()=>hold(40));M.A5={headingErrDeg:+(angd(C.yaw,a0)*57.3).toFixed(2)}}
    /* ---------- B. pivot: where does the car turn about? ---------- */
    /* full lock at walking speed and at 15 m/s: sideways speed of the REAR axle in the car's frame. 0 = the rear follows the front like a real car; a car that spins about its middle swings its tail out at yawrate x 1.33 m. */
    M.B={};for(const v of[5,15,40]){place(v,false);let sl=0,n=0,w=0;run(1.5,(t)=>{C.steer=1;hold(v);if(t>.8){sl+=C.lat;w+=C.wyaw;n++}});sl/=n;w/=n;M.B[v]={rearSlide:+(sl-w*1.33).toFixed(2),yaw:+w.toFixed(2),radius:+(v/w).toFixed(1),pivotAheadOfRearAxle:+(1.33-sl/w).toFixed(2)}}
    /* ---------- C. grip and slide ---------- */
    {place(100/3.6,false);run(.2);let ml=0,ms=0;run(.9,()=>{C.steer=1;IN.thr=1;ml=Math.max(ml,Math.abs(C.wyaw)*C.speed);ms=Math.max(ms,Math.atan2(Math.abs(C.lat),Math.abs(C.fwd)+1)*57.3)});M.C1={limitG:+(ml/9.81).toFixed(2),slipDeg:+ms.toFixed(1)};
     /* a drift tap at 28 m/s, stick centred: peak slide and time until it is under 3 degrees again */
     place(28,false);run(.3,()=>{IN.thr=1});let pk=0,tEnd=-1;run(.25,()=>{IN.hand=1;IN.thr=1});IN.hand=0;run(2.5,(t)=>{IN.thr=1;const s=Math.atan(C.slip)*57.3;pk=Math.max(pk,s);if(tEnd<0&&t>.1&&s<3)tEnd=t});M.C2={tapPeakDeg:+pk.toFixed(1),recover:+tEnd.toFixed(2)};
     /* lift off the stick mid-corner: the slide must die away, never grow (no snap) */
     place(45,false);run(.3);let mx=0;run(1,()=>{C.steer=1;IN.thr=1});run(1,()=>{C.steer=0;IN.thr=1;mx=Math.max(mx,Math.atan(C.slip)*57.3)});M.C3={slipAfterReleaseDeg:+mx.toFixed(1)};
     /* road to grass: speed kept over 1 s of coasting on grass at 30 m/s, and the cornering limit there */
     const gx=sh.X[i0]+Math.cos(a0)*(sh.hw+30),gz=sh.Z[i0]+Math.sin(a0)*(sh.hw+30);carPlace(gx,gz,a0);C.vx=Math.sin(a0)*30;C.vz=-Math.cos(a0)*30;IN.assist=true;IN.thr=1;let gl=0;run(1,()=>{C.steer=1;gl=Math.max(gl,Math.abs(C.wyaw)*C.speed)});M.C4={grassLimitG:+(gl/9.81).toFixed(2),onRoad:C.onRoad?1:0}}
    /* ---------- D. brakes and reverse ---------- */
    {place(100/3.6,false);run(.1);const x0=C.x,z0=C.z;let t=0;IN.brk=1;for(let i=0;i<1200;i++){carStep(1/120);if(C.speed<.3){t=i/120;break}}M.D1={stop100:+Math.hypot(C.x-x0,C.z-z0).toFixed(1),t:+t.toFixed(2)};
     /* keep the brake down for 8 more seconds: how fast does it go backwards? */
     let vr=0;run(8,()=>{IN.brk=1;vr=Math.min(vr,C.fwd)});M.D2={reverseTop:+(-vr).toFixed(1)};IN.brk=0;
     /* brake while turning at 40 m/s: deceleration and lateral g together (how much the tyres give in total) */
     place(40,false);run(.2);let dec=0,lat=0,n=0,v0=C.speed;run(.6,()=>{C.steer=1;IN.brk=1;lat+=Math.abs(C.wyaw)*C.speed;n++});M.D3={decel:+((v0-C.speed)/.6).toFixed(1),latG:+(lat/n/9.81).toFixed(2)};IN.brk=0}
    /* ---------- E. throttle: the push must not step ---------- */
    {const ie=Math.round((sh.def.humps[0].f+.085)*sh.n),ae=Math.atan2(sh.X[ie+1]-sh.X[ie],-(sh.Z[ie+1]-sh.Z[ie])),pe=()=>{carPlace(sh.X[ie]+Math.cos(ae)*5,sh.Z[ie]+Math.sin(ae)*5,ae,sh.Y[ie]+.5);C.steer=0;C.wyaw=0;IN.assist=true;IN.brk=0;IN.hand=0};
     pe();const v=[];run(5.5,(t,i)=>{IN.thr=1;if(i%6==0)v.push(C.fwd)});let jmax=0,at=0;const acc=[];for(let i=1;i<v.length;i++)acc.push((v[i]-v[i-1])/.05);for(let i=3;i<acc.length;i++){const j=Math.abs(acc[i]-acc[i-1]);if(j>jmax){jmax=j;at=v[i]}}
     let t100=-1;pe();for(let i=0;i<1200;i++){IN.thr=1;carStep(1/120);if(C.kmh>=100){t100=i/120;break}}
     /* lifting off the gas at 40 m/s: the engine braking (m/s2) */
     place(40,false,0);run(.1);const vl=C.speed;run(.5);M.E={biggestStepInAccel:+jmax.toFixed(2),atSpeed:+at.toFixed(1),t0_100:+t100.toFixed(2),a0:+acc[4].toFixed(1),liftOffDecel:+((vl-C.speed)/.5).toFixed(1),len:Math.round(sh.len)}}
    /* ---------- F. walls: a long wall hit at an angle, gas held, stick centred. Speed kept after 1.5 s and whether the car ends up running along the wall ---------- */
    M.F={};{const cn=QH.cnc,CO0=QH.CO,fwx=Math.sin(a0),fwz=-Math.cos(a0),rtx=Math.cos(a0),rtz=Math.sin(a0);
      /* the wall: 800 m long, along the road, its face 6 m right of the centre line; the car starts 6 m left of the centre line, pointed `deg` towards it (assist off so nothing but the wall turns the car) */
      QH.nR=0;QH.nC=0;QH.CO=new Float32Array([sh.X[i0]+rtx*10+fwx*150,sh.Z[i0]+rtz*10+fwz*150,400,4,fwx,fwz,1e4]);for(let c=0;c<cn*cn;c++)QH.cst[c]=c;QH.cst[cn*cn]=cn*cn;QH.cli=new Int32Array(cn*cn);
      for(const deg of[8,15,25,40,60,90])for(const v of[30,55]){
        place(v,false,-6);C.yaw=C.pyaw=a0+deg/57.2958;C.vx=Math.sin(C.yaw)*v;C.vz=-Math.cos(C.yaw)*v;const n1=IMP.n,E0=IMP.total;let t1=-1,sp=0,along=0,vmin=1e9;
        for(let i=0;i<120*7;i++){IN.thr=1;C.steer=0;carStep(1/120);if(t1<0&&IMP.n>n1)t1=i;if(t1>=0){vmin=Math.min(vmin,C.speed);if(i-t1==180){sp=C.speed;along=Math.abs(angd(C.yaw,a0))*57.3;break}}}
        M.F[deg+'deg@'+v]={kept:t1<0?null:+(sp/v).toFixed(2),lowest:+(vmin/v).toFixed(2),noseToWallDeg:+along.toFixed(0),impacts:IMP.n-n1,kJ:+((IMP.total-E0)/1000).toFixed(0)}}
      QH.CO=CO0;restore();noCol()}
    /* ---------- G. jumps: the three hills on the southern highway at 45 m/s, assist on; then the same with the stick held over at take-off ---------- */
    {const f=sh.def.humps[1].f,ih=Math.round((f-.03)*sh.n),ah=Math.atan2(sh.X[ih+1]-sh.X[ih],-(sh.Z[ih+1]-sh.Z[ih]));
     const go=(k0)=>{carPlace(sh.X[ih]+Math.cos(ah)*5,sh.Z[ih]+Math.sin(ah)*5,ah,sh.Y[ih]+.5);C.vx=Math.sin(ah)*45;C.vz=-Math.cos(ah)*45;C.steer=0;C.wyaw=0;IN.assist=true;IN.brk=0;IN.hand=0;
       let air=0,flights=0,was=1,vLand=[],bur=0,maxSlipLand=0,landT=-1,first=-1,yTake=0,yawAir=0,done=false;
       for(let i=0;i<120*7;i++){IN.thr=1;C.steer=(k0>=0&&i>=k0-18&&!done)?.6:0;carStep(1/120);if(!C.grounded)air++;
         if(was&&!C.grounded){flights++;if(first<0){first=i;yTake=C.yaw}}if(!was&&C.grounded){vLand.push(+C.speed.toFixed(1));landT=i;if(!done){yawAir=angd(C.yaw,yTake)*57.3;done=true}}if(landT>=0&&i-landT<40)maxSlipLand=Math.max(maxSlipLand,Math.atan(C.slip)*57.3);
         if(C.grounded&&C.y<groundAt(C.x,C.z,C.y)-.25)bur++;was=C.grounded}
       return{flights,first,airS:+(air/120).toFixed(2),vAfterLanding:vLand,turnedInAirDeg:+yawAir.toFixed(1),slipAfterLandingDeg:+maxSlipLand.toFixed(1),buriedFrames:bur,headingDriftDeg:+(angd(C.yaw,ah)*57.3).toFixed(1)}};
     M.G1=go(-1);M.G2=go(M.G1.first);delete M.G1.first;delete M.G2.first}
    /* ---------- H. ground following: a twisty hill road at 25 m/s driven by a simple follower; how far the body is from the ground and how much the pitch chatters ---------- */
    {const r=ROADS.find(q=>q.id=='mh'),n=r.n;let i=40;carPlace(r.X[i],r.Z[i],Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i])),r.Y[i]+.5);IN.assist=false;let sum=0,cnt=0,mx=0,pj=0,pp=C.pitch,ppv=0,air=0;
     for(let k=0;k<120*25&&i<n-30;k++){while(i<n-2&&((r.X[i]-C.x)**2+(r.Z[i]-C.z)**2)<144)i++;const want=Math.atan2(r.X[i]-C.x,-(r.Z[i]-C.z));C.steer=clamp(angd(want,C.yaw)*2.2,-1,1);IN.thr=C.speed<25?1:0;IN.brk=C.speed>27?1:0;carStep(1/120);
       if(C.grounded){const d=Math.abs(C.y-groundAt(C.x,C.z,C.y));sum+=d;cnt++;if(d>mx)mx=d}else air++;const pv=(C.pitch-pp)*120;pj=Math.max(pj,Math.abs(pv-ppv)*120);ppv=pv;pp=C.pitch}
     M.H={meanGapCm:+(sum/cnt*100).toFixed(1),maxGapCm:+(mx*100).toFixed(0),airFrames:air,maxPitchAccel:+pj.toFixed(0),reached:+(i/n).toFixed(2)}}
    restore();
    /* ---------- I. guard rails (only where the map has them) ---------- */
    M.I=null;{let rr=null,ri=0,side=0;for(const r of ROADS){if(r.city||r.closed)continue;for(let i=40;i<r.n-40;i+=4){let ok=r.rail[i]&2;for(let k=-25;k<=25&&ok;k++)if(!(r.rail[i+k]&2)||r.br[i+k])ok=0;if(ok){const t0=Math.atan2(r.X[i+20]-r.X[i],r.Z[i+20]-r.Z[i]),t1=Math.atan2(r.X[i]-r.X[i-20],r.Z[i]-r.Z[i-20]);if(Math.abs(angd(t0,t1))<.03){rr=r;ri=i;break}}}if(rr)break}
      if(rr){M.I={road:rr.id};const r=rr,a=Math.atan2(r.X[ri+1]-r.X[ri],-(r.Z[ri+1]-r.Z[ri]));QH.cst.fill(0);
        for(const deg of[6,12,25,45,75])for(const v of[35,60]){const lat=r.hw-3.2-(deg>30?1.5:0);carPlace(r.X[ri]+Math.cos(a)*lat,r.Z[ri]+Math.sin(a)*lat,a+deg/57.2958,r.Y[ri]+.5);C.vx=Math.sin(C.yaw)*v;C.vz=-Math.cos(C.yaw)*v;C.steer=0;C.wyaw=0;IN.assist=true;IN.brk=0;IN.hand=0;
          const n1=IMP.n,E1=IMP.total;let t1=-1,sp=0,hd=0,vmin=1e9,sparks=(typeof SPARK!=='undefined'&&SPARK.made)||0;
          for(let i=0;i<120*4;i++){IN.thr=1;C.steer=0;carStep(1/120);const cont=(C.railT||0)>0||IMP.n>n1;if(t1<0&&cont)t1=i;if(t1>=0){vmin=Math.min(vmin,C.speed);if(i-t1==120){sp=C.speed;hd=Math.abs(angd(C.yaw,a))*57.3;break}}}
          M.I[deg+'deg@'+v]={kept1s:t1<0?null:+(sp/v).toFixed(2),lowest:+(vmin/v).toFixed(2),noseToRailDeg:+hd.toFixed(0),kJ:+((IMP.total-E1)/1000).toFixed(0),insideRoad:Math.abs((C.x-r.X[roadNear(r,C.x,C.z)])*Math.cos(a)+(C.z-r.Z[roadNear(r,C.x,C.z)])*Math.sin(a))<r.hw+1.2?1:0}}
        restore()}}
    /* ---------- J. curbs (only where the map has them) ---------- */
    M.J=null;if(typeof swOn==='function'){const r=ROADS.find(q=>q.id=='lau1');if(r){const i=Math.round(r.n*.5),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i])),rx=Math.cos(a),rz=Math.sin(a);QH.cst.fill(0);
      M.J={road:r.id,curbCm:+((groundAt(r.X[i]+rx*(r.hw+1),r.Z[i]+rz*(r.hw+1),r.Y[i])-groundAt(r.X[i]+rx*(r.hw-1),r.Z[i]+rz*(r.hw-1),r.Y[i]))*100).toFixed(1)};
      /* the car coasts at the curb at 20 degrees: the speed it loses in the quarter second in which the wheels climb, less what coasting costs anyway (the quarter second before) */
      for(const v of[9,15,30]){carPlace(r.X[i]+rx*(r.hw-2.2),r.Z[i]+rz*(r.hw-2.2),a+.35,r.Y[i]+.5);C.vx=Math.sin(C.yaw)*v;C.vz=-Math.cos(C.yaw)*v;C.steer=0;IN.assist=false;IN.thr=0;IN.brk=0;C.shake=0;const sp=[];let k0=-1,sh0=0,up=0,wmax=0;const y0=C.y;
        for(let k=0;k<120*2.2;k++){carStep(1/120);sp.push(C.speed);if(k0<0&&C.cbN>0)k0=k;if(k0>=0&&k-k0<40)sh0=Math.max(sh0,C.shake);up=Math.max(up,C.y-y0);wmax=Math.max(wmax,C.cbN)}
        const pre=k0>=30?sp[k0-30]-sp[k0-1]:0,post=k0>=0?sp[k0-1]-sp[Math.min(sp.length-1,k0+29)]:0;
        M.J['at'+v]={climbCm:+(up*100).toFixed(0),shake:+sh0.toFixed(2),curbLossPct:k0<1?null:+((post-pre)/sp[k0-1]*100).toFixed(1),wheelsUp:wmax}}
      restore()}}
    return M});
  const M=res;const P=(k,v)=>console.log(k.padEnd(4),JSON.stringify(v));
  console.log('handling mode: '+(MODE||'current'));
  for(const k of Object.keys(M))P(k,M[k]);
  /* ---- checks (the current handling only) ---- */
  let bad=0;const ck=(ok,msg)=>{console.log((ok?'  ok   ':'  FAIL ')+msg);if(!ok)bad++};
  if(MODE!='classic'&&process.env.CHECK!='0'){
    for(const v of[20,40,65])ck(Math.min(...M.A1[v].gainRelToFull)>=.85,'A1 the stick is a rate control down to 6 % at '+v+' m/s (gain relative to full stick never under 0.85): '+M.A1[v].gainRelToFull.join(' '));
    ck(M.A2[30].deg3s>1.7*M.A2[30].deg1_5s&&M.A2[30].deg3s>12,'A2 a small stick held keeps turning the car (3 s gives about twice 1.5 s): '+M.A2[30].deg1_5s+' then '+M.A2[30].deg3s+' deg');
    for(const v of[20,40,65])ck(M.A3[v].t90<.3&&M.A3[v].t63>.04,'A3 step response at '+v+' m/s: 63 % in '+M.A3[v].t63+' s, 90 % in '+M.A3[v].t90+' s (quick, not instant)');
    ck(M.A4[80]<M.A4[30]*1.6,'A4 a quick dab does not move the car much more at 80 m/s ('+M.A4[80]+' m) than at 30 ('+M.A4[30]+' m)');
    ck(Math.abs(M.A5.headingErrDeg)<1.2,'A5 hands off, the car straightens along the road (heading error '+M.A5.headingErrDeg+' deg after 2.5 s)');
    ck(Math.abs(M.B[5].rearSlide)<.35&&M.B[5].radius>=3.5,'B at walking speed the tail follows the nose (rear axle slides '+M.B[5].rearSlide+' m/s) and the turning circle is a car\'s ('+M.B[5].radius+' m radius)');
    ck(M.C1.limitG>1.9&&M.C1.limitG<2.9&&M.C1.slipDeg<4,'C1 cornering limit at 100 km/h '+M.C1.limitG+' g with '+M.C1.slipDeg+' deg of slip (grip first)');
    ck(M.C2.tapPeakDeg>8&&M.C2.tapPeakDeg<30&&M.C2.recover>0&&M.C2.recover<1.3,'C2 a drift tap slides '+M.C2.tapPeakDeg+' deg and is over in '+M.C2.recover+' s');
    ck(M.C3.slipAfterReleaseDeg<4,'C3 letting go of the stick mid-corner never snaps ('+M.C3.slipAfterReleaseDeg+' deg)');
    ck(M.C4.grassLimitG<M.C1.limitG*.8,'C4 grass has less grip ('+M.C4.grassLimitG+' g)');
    ck(M.D1.stop100>13&&M.D1.stop100<20,'D1 100 km/h to 0 in '+M.D1.stop100+' m');
    ck(M.D2.reverseTop>6&&M.D2.reverseTop<16,'D2 reverse tops out at '+M.D2.reverseTop+' m/s');
    ck(M.E.biggestStepInAccel<1.2,'E the push never steps (biggest change of acceleration between two 0.05 s windows '+M.E.biggestStepInAccel+' m/s2 at '+M.E.atSpeed+' m/s)');
    ck(M.E.t0_100>2.1&&M.E.t0_100<2.6,'E 0-100 km/h in '+M.E.t0_100+' s');
    for(const k of['8deg@30','8deg@55','15deg@30','15deg@55'])ck(M.F[k].kept>=.8&&M.F[k].noseToWallDeg<=6,'F a shallow wall hit ('+k+') keeps '+M.F[k].kept+' of the speed and the car runs along the wall (nose '+M.F[k].noseToWallDeg+' deg off it)');
    ck(M.F['25deg@55'].kept>=.55,'F 25 degrees keeps '+M.F['25deg@55'].kept);
    ck(M.F['90deg@55'].kept<.35,'F head-on stops the car ('+M.F['90deg@55'].kept+')');
    ck(M.F['60deg@55'].kept<M.F['25deg@55'].kept,'F steeper hits cost more');
    ck(M.G1.flights>=2&&M.G1.buriedFrames==0&&Math.abs(M.G1.headingDriftDeg)<3,'G1 jumps: '+M.G1.flights+' flights, '+M.G1.airS+' s in the air, no buried frames, heading kept ('+M.G1.headingDriftDeg+' deg)');
    ck(M.G2.slipAfterLandingDeg<14,'G2 steering in the air does not land the car sideways (slide after landing '+M.G2.slipAfterLandingDeg+' deg)');
    ck(M.H.meanGapCm<6&&M.H.maxGapCm<15&&M.H.airFrames<30,'H ground following on Mulholland: mean gap '+M.H.meanGapCm+' cm, worst '+M.H.maxGapCm+' cm');
    if(M.I){for(const v of[35,60]){ck(M.I['6deg@'+v].kept1s>=.9&&M.I['12deg@'+v].kept1s>=.85,'I rail at 6 / 12 degrees, '+v+' m/s: keeps '+M.I['6deg@'+v].kept1s+' / '+M.I['12deg@'+v].kept1s+' of the speed');ck(M.I['12deg@'+v].noseToRailDeg<=5,'I the car is turned along the rail ('+M.I['12deg@'+v].noseToRailDeg+' deg)');ck(M.I['75deg@'+v].kept1s<.5,'I a steep rail hit stops or bounces ('+M.I['75deg@'+v].kept1s+')');ck(M.I['25deg@'+v].kJ>M.I['6deg@'+v].kJ,'I damage grows with the angle ('+M.I['6deg@'+v].kJ+' kJ at 6, '+M.I['25deg@'+v].kJ+' at 25, '+M.I['75deg@'+v].kJ+' at 75)')}
      for(const k of Object.keys(M.I))if(M.I[k]&&M.I[k].insideRoad===0)ck(false,'I the car went through the rail at '+k)}
    if(M.J){ck(M.J.curbCm>=12&&M.J.curbCm<=18,'J the sidewalk is a curb above the street ('+M.J.curbCm+' cm)');ck(M.J.at9.climbCm>=8&&M.J.at9.wheelsUp>=2,'J the car climbs it ('+M.J.at9.climbCm+' cm, '+M.J.at9.wheelsUp+' wheels up at 9 m/s)');
      ck(M.J.at15.shake>.05,'J climbing it jolts the car (shake '+M.J.at9.shake+' / '+M.J.at15.shake+' / '+M.J.at30.shake+' at 9 / 15 / 30 m/s)');ck(M.J.at30.curbLossPct>=1&&M.J.at30.curbLossPct<=10&&M.J.at15.curbLossPct>=1,'J and costs a little speed ('+M.J.at15.curbLossPct+' % at 15 m/s, '+M.J.at30.curbLossPct+' % at 30 m/s)')}
  }
  console.log('errs',T.errs.length?T.errs:0);await T.close();process.exit(bad||T.errs.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
