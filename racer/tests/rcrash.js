// Crashes (batch 6): the player's car rolls and flips (rigid-body tumble), lands on wheels / side / roof, is righted, takes damage where it hits (roof included);
// traffic cars are thrown onto their side or roof; the light glows stay on the lamps; lamp posts can be knocked down. Normal driving never tumbles.
// usage: node racer/tests/rcrash.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:240,h:160,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  await T.ev(()=>{const {C,UI,IN,TR}=RACER;UI.paused=true;IN.assist=false;
    window.place=(id,f,spd,lat)=>{TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;dmgReset();const r=ROADS.find(q=>q.id==id),i=Math.round(r.n*f),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));RACER.carPlace(r.X[i]+Math.cos(a)*(lat||0),r.Z[i]+Math.sin(a)*(lat||0),a,r.Y[i]+.5);C.vx=Math.sin(a)*spd;C.vz=-Math.cos(a)*spd;C.steer=0;C.wyaw=0;IN.thr=0;IN.brk=0;return a};
    window.parked=(a,dx,dz)=>{const e=LG.ofRoad[ROADS.findIndex(q=>q.id=='ring')][0][0],c=trPlace(e,5,0,1,0,78);c.state=1;c.x=c.px=C.x+dx;c.z=c.pz=C.z+dz;c.yaw=c.pyaw=a+Math.PI/2;c.vx=c.vz=0;c.v=0;c.y=c.py=groundAt(c.x,c.z,C.y+1);return c};
    window.watch=(secs,c)=>{const o={start:-1,end:-1,right:-1,tilt:0,below:0,nan:0,imp0:IMP.n,hp0:dmgHp(),cRoll:0,cAir:0};
      for(let s=0;s<secs*120;s++){RACER.worldStep(1/120);const t=s/120;if(TUM.on&&o.start<0)o.start=t;if(o.start>=0&&!TUM.on&&o.end<0)o.end=t;if(TUM.rightT>0&&o.right<0)o.right=t;if(TUM.on)o.tilt=Math.max(o.tilt,TUM.maxTilt);
        if(!isFinite(C.x+C.y+C.z+TUM.p[1]))o.nan++;if(TUM.on){const g=groundAt(TUM.p[0],TUM.p[2],TUM.p[1]+.35);if(TUM.p[1]<g)o.below++}
        if(c){o.cRoll=Math.max(o.cRoll,Math.abs(c.roll),Math.abs(c.pitch));o.cAir=Math.max(o.cAir,c.y-groundAt(c.x,c.z,c.y+1))}}
      o.tilt=Math.round(o.tilt*57.3);o.hpLost=+((o.hp0-dmgHp())*100).toFixed(1);o.roof=+DMG.z[4].toFixed(2);o.impacts=IMP.n-o.imp0;o.upright=TUM.on?0:1;o.endYawOk=isFinite(C.yaw);if(c){o.cRoll=Math.round(o.cRoll*57.3);o.cEnd=Math.round(c.roll*57.3)}return o}});
  if(process.env.ONLY4){}
  /* 1 a car slams into your side at 32 m/s */
  const A=await T.ev(()=>{const a=place('ring',.42,0,5);const c=parked(a,-Math.cos(a)*6,-Math.sin(a)*6);c.yaw=c.pyaw=a+Math.PI/2;c.vx=Math.cos(a)*32;c.vz=Math.sin(a)*32;c.v=32;return watch(14)});
  console.log('     side hit '+JSON.stringify(A));
  ok(A.start>=0&&A.start<.5&&A.tilt>=90,'1 hit in the side by a car at 115 km/h, the car rolls (up to '+A.tilt+' degrees)');
  ok(A.end>0&&A.upright&&A.nan==0,'1 it comes to rest and is a car again after '+A.end+' s'+(A.right>0?' (righted at '+A.right+' s)':' (landed on its wheels)'));
  ok(A.hpLost>8&&A.impacts>=3,'1 the roll does real damage: '+A.hpLost+' % of the health in '+A.impacts+' hits (roof zone '+A.roof+')');
  ok(A.below<6,'1 the body stays on top of the ground ('+A.below+' steps a little under)');
  /* 2 forced onto its roof: it lies there and is righted */
  const B=await T.ev(()=>{place('ring',.42,26,5);tumbleStart(0,0,-9,5,'test');return watch(16)});
  console.log('     roll     '+JSON.stringify(B));
  ok(B.tilt>150&&B.end>0&&B.end<14&&B.upright,'2 a roll at 26 m/s ends upside down or on a side (up to '+B.tilt+' degrees) and the car is a car again after '+B.end+' s');
  /* 3 sliding sideways onto a kerb downtown at 24 m/s trips the car */
  const Cc=await T.ev(()=>{const a=place('sfnu3',.5,0,4.5);C.vx=Math.cos(a)*24;C.vz=Math.sin(a)*24;return watch(12)});
  ok(Cc.start>=0&&Cc.tilt>60&&Cc.end>0,'3 sliding sideways at 86 km/h into a kerb rolls the car ('+Cc.tilt+' degrees), it recovers after '+Cc.end+' s');
  /* 4 normal driving does not tumble: flat out on the ring, braking hard, a hard drift */
  const D=await T.ev(()=>{const o={};const lane=()=>{const sn=navSnap(C.x,C.z,30);return sn?navLane(sn,C.x,C.z,Math.sin(C.yaw),-Math.cos(C.yaw)):null};
    const drive=(id,f,vmax,secs,drift)=>{place(id,f,15,5);const n0=TUM.n;let dist=0;for(let s=0;s<secs*120;s++){const ln=lane();let st=0;if(ln){const e=ln.e;trPt(e,Math.min(e.n-1,ln.u+Math.max(2,Math.round(C.speed*.5/e.ds+2))));st=clamp(angd(Math.atan2(_pt.x-C.x,-(_pt.z-C.z)),C.yaw)*1.6,-1,1)}
        C.steer=st;IN.thr=C.speed<vmax?1:0;IN.brk=C.speed>vmax+3?1:0;IN.hand=drift&&(s%(120*8))<40&&C.speed>15?1:0;if(!(s%60))for(const c of TR.cars)if(c.alive)trKill(c,0);RACER.worldStep(1/120);dist+=C.speed/120}IN.thr=IN.brk=IN.hand=0;return{tumbles:TUM.n-n0,why:TUM.n>n0?TUM.why:'',km:+(dist/1000).toFixed(1)}};
    o.ring=drive('ring',.42,42,60,1);o.city=drive('sfnu3',.3,20,40,0);o.hills=drive('mh',.3,30,50,1);return o});console.log('     '+JSON.stringify(D));
  ok(D.ring.tumbles+D.city.tumbles+D.hills.tumbles==0,'4 normal driving never tumbles (a bot on its lane, with a drift tap every 8 s on the ring and the hills: the ring at 150 km/h '+D.ring.km+' km, downtown '+D.city.km+' km, Mulholland '+D.hills.km+' km)');
  /* 5 you T-bone a parked car at 30 m/s: it is thrown onto its side or roof */
  const E=await T.ev(()=>{const a=place('ring',.42,30,5);const c=parked(a,Math.sin(a)*12,-Math.cos(a)*12);return watch(6,c)});
  ok(E.cRoll>=80&&E.cAir>.8,'5 a car you T-bone at 108 km/h is thrown '+E.cAir.toFixed(1)+' m up and rolls '+E.cRoll+' degrees (rests at '+E.cEnd+')');
  const E2=await T.ev(()=>{const a=place('ring',.42,12,5);const c=parked(a,Math.sin(a)*8,-Math.cos(a)*8);return watch(4,c)});
  ok(E2.cRoll<30,'5 at 43 km/h it is only knocked about (roll '+E2.cRoll+' degrees)');
  /* 6 the light glows sit on the lamps: the head lamp glow is at the front of the car as drawn, tumbling or not */
  const F=await T.ev(()=>{place('ring',.42,0,5);RACER.worldStep(1/120);carPose(CARM.mf,1,1);const M=CARM.mf,P=(x,y,z)=>[M[0]*x+M[4]*y+M[8]*z+M[12],M[1]*x+M[5]*y+M[9]*z+M[13],M[2]*x+M[6]*y+M[10]*z+M[14]];const h=P(CARL.hx,CARL.hy,CARL.hz),fx=Math.sin(C.yaw),fz=-Math.cos(C.yaw);
    const ahead=(h[0]-C.x)*fx+(h[2]-C.z)*fz;tumbleStart(0,0,-9,5,'t');for(let s=0;s<60;s++)RACER.worldStep(1/120);carPose(CARM.mf,1,1);const h2=P(CARL.hx,CARL.hy,CARL.hz),up=TUM.R[4],dy=h2[1]-C.y;
    return{ahead:+ahead.toFixed(2),hl:CARM.hl,up:+up.toFixed(2),dy:+dy.toFixed(2)}});
  ok(F.ahead>F.hl*.8&&Math.abs(F.dy-(F.up*.3))<1.2,'6 the head lamp glow is on the nose ('+F.ahead+' m ahead of the middle, the car is '+(F.hl*2).toFixed(1)+' m long) and turns with the body when it rolls');
  /* 7 lamp posts: driving into one at 58 km/h knocks it over, its light goes out, the car carries on */
  const G=await T.ev(()=>{TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;lampReset();dmgReset();let lid=-1;for(let i=0;i<LPOST.length;i++){const P=LPOST[i];if(P&&inBox(P[0],P[1],CITY,-100)){lid=i;break}}const P=LPOST[lid];roadAt(P[0],P[1],P[2]+1);const ang=Math.atan2(RQ.tx,-RQ.tz),sx=P[0]-Math.sin(ang)*25,sz=P[1]+Math.cos(ang)*25;
    RACER.carPlace(sx,sz,Math.atan2(P[0]-sx,-(P[1]-sz)),P[2]+.5);const a=C.yaw;C.vx=Math.sin(a)*16;C.vz=-Math.cos(a)*16;let knocked=-1,vAfter=0;for(let s=0;s<120*3;s++){RACER.worldStep(1/120);if(knocked<0&&KO.list.length){knocked=s/120;vAfter=C.speed}}
    const q=KO.list[0],o={knocked,vAfter:+vAfter.toFixed(1),angle:q?Math.round(q.a*57.3):-1,dark:KO.dark[lid],coll:QH.CC[P[3]*5+4]<-100,posts:LPOST.filter(Boolean).length};
    /* slow: it is a solid post */lampReset();RACER.carPlace(sx,sz,a,P[2]+.5);C.vx=Math.sin(a)*3.5;C.vz=-Math.cos(a)*3.5;IN.thr=1;for(let s=0;s<120*9;s++){RACER.worldStep(1/120);if(C.speed>3.9){C.vx*=3.5/C.speed;C.vz*=3.5/C.speed}}IN.thr=0;o.slowKnocked=KO.list.length;o.stopped=Math.hypot(C.x-P[0],C.z-P[1]);lampReset();return o});
  ok(G.knocked>0&&G.angle>=80&&G.dark&&G.coll&&G.vAfter>11,'7 a lamp post hit at 58 km/h falls over ('+G.angle+' degrees), its light goes out and it no longer blocks; the car carries on at '+G.vAfter+' m/s ('+G.posts+' posts can fall)');
  ok(G.slowKnocked==0,'7 nudged at 13 km/h it stays standing (the car stops '+G.stopped.toFixed(1)+' m from it)');
  console.log('errs',T.errs.length?T.errs.slice(0,3):0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
