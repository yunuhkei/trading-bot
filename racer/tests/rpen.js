// How far do the visible car parts (wheel bottoms, bumpers, sills) poke below the ground while driving up/over hills?
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({file:process.env.RFILE||L.DEFAULT_FILE,q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const res=await T.ev(()=>{
    const {C,IN,UI,ROADS,carStep,carPlace}=RACER;UI.paused=true;IN.assist=false;const out=[];
    // model-space points: [x,y,z] (forward = -z): wheel bottoms, bumpers, sills
    const PTS=[['FL wheel',-.63,0,-1.42],['FR wheel',.63,0,-1.42],['RL wheel',-.63,0,1.33],['RR wheel',.63,0,1.33],['front bumper',0,.2,-2.2],['rear bumper',0,.2,2.2],['FL sill',-.9,.19,-1.4],['FR sill',.9,.19,-1.4]];
    const world=(p)=>{const a=-C.yaw,cp=Math.cos(C.pitch),sp=Math.sin(C.pitch),cr=Math.cos(C.roll),sr=Math.sin(C.roll),cy=Math.cos(a),sY=Math.sin(a);
      const a00=cr,a01=-sr,a10=cp*sr,a11=cp*cr,a12=-sp,a20=sp*sr,a21=sp*cr,a22=cp;
      const r00=cy*a00+sY*a20,r01=cy*a01+sY*a21,r02=sY*a22,r10=a10,r11=a11,r12=a12,r20=-sY*a00+cy*a20,r21=-sY*a01+cy*a21,r22=cy*a22;
      const x=p[1],y=p[2],z=p[3];return[C.x+r00*x+r01*y+r02*z,C.y+C.bob+r10*x+r11*y+r12*z,C.z+r20*x+r21*y+r22*z]};
    const stat={};let frames=0,bad10=0,bad25=0,worstAt=null,worstV=0;const reset=()=>{frames=0;bad10=0;bad25=0;worstV=0;worstAt=null;for(const p of PTS)stat[p[0]]={max:0,n:0,sum:0}};
    const sample=()=>{let fm=0;frames++;for(const p of PTS){const w=world(p);const g=RACER.groundAt(w[0],w[2],w[1]+.3);const pen=g-w[1];const s=stat[p[0]];s.n++;if(pen>0)s.sum++;if(pen>s.max)s.max=pen;if(pen>fm)fm=pen;if(pen>worstV){worstV=pen;worstAt=[Math.round(w[0]),Math.round(w[2]),RQ.on?ROADS[RQ.ri].id:'terrain']}}if(fm>.10)bad10++;if(fm>.25)bad25++};
    const report=(name)=>{const worst=Object.entries(stat).sort((a,b)=>b[1].max-a[1].max)[0];out.push(name.padEnd(34)+' worst '+worst[0]+' '+(worst[1].max*100|0)+' cm at '+JSON.stringify(worstAt)+'; frames >10 cm below: '+Math.round(100*bad10/Math.max(1,frames))+'%, >25 cm: '+Math.round(100*bad25/Math.max(1,frames))+'%')};
    const drive=(name,setup,steerFn,sec,speed,thr)=>{setup();reset();for(let k=0;k<sec*120;k++){steerFn&&steerFn(k/120);IN.thr=C.speed<speed?1:0;IN.brk=C.speed>speed+3?1:0;carStep(1/120);if(k>60)sample()}report(name)};
    // a) steep SF street up Russian Hill (bot steering along the street)
    const roadBot=(id,spd)=>{const r=ROADS.find(q=>q.id==id);let idx=14;const n=r.n;const a=Math.atan2(r.X[15]-r.X[14],-(r.Z[15]-r.Z[14]));return{r,setup:()=>{carPlace(r.X[14]+Math.cos(a)*2,r.Z[14]+Math.sin(a)*2,a,r.Y[14]+.5);C.vx=Math.sin(a)*spd;C.vz=-Math.cos(a)*spd;idx=14},
      steer:()=>{let bi=idx,bd=1e18;for(let q=-4;q<=25;q++){const i=idx+q;if(i<0||i>=n)continue;const d=(r.X[i]-C.x)**2+(r.Z[i]-C.z)**2;if(d<bd){bd=d;bi=i}}idx=bi;const ti=Math.min(n-1,idx+Math.round(Math.max(6,C.speed*.6)/r.ds)),err=angd(Math.atan2(r.X[ti]-C.x,-(r.Z[ti]-C.z)),C.yaw);C.steer=Math.max(-1,Math.min(1,err*2.2))}}};
    for(const [id,spd] of [['sfnv1',14],['sfsu4',14],['tp',9],['mh',22],['mp',20]]){const b=roadBot(id,spd);drive('road '+id+' @'+Math.round(spd*2.237)+' mph',b.setup,b.steer,Math.min(60,b.r.len/spd),spd)}
    // b) off-road straight up a hill face
    drive('off-road up Twin Peaks @22 mph',()=>{carPlace(-640,560,0,RACER.terrainH(-640,560)+1);C.vx=0;C.vz=-10},()=>{C.steer=0},6,10);
    drive('off-road up Russian Hill @30 mph',()=>{carPlace(-1100,100,0,RACER.terrainH(-1100,100)+1);C.vx=0;C.vz=-13},()=>{C.steer=0},6,13);
    drive('off-road up mountain @45 mph',()=>{carPlace(1500,-700,-.3,RACER.terrainH(1500,-700)+1);C.vx=0;C.vz=-20},()=>{C.steer=0},8,20);
    // c) over a crest and into a dip at speed (Nob Hill, driving straight north across the hill)
    drive('over Nob Hill crest @50 mph',()=>{carPlace(-860,220,0,RACER.terrainH(-860,220)+1);C.vx=0;C.vz=-22},()=>{C.steer=0},10,22);
    return out});
  console.log(res.join('\n'));console.log('errs',T.errs);await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
