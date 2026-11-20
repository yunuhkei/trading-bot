// (batch 78) which hits on a racer arm an aftertouch takedown: taps and bumps up to 22 mph do not, a 34 mph shunt (68 kJ) does.  usage: RFILE=<built file> node racer/tests/raft.js
const L=require('./rlib.js');
(async()=>{const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:300,h:200,mobile:false,traffic:true});
await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});
const res=await T.ev(()=>{const out=[];const ev=EV.list.find(e=>e.id=='x_north');
  for(const [kind,n] of [['side',2],['side',4],['side',6],['side',9],['rear',3],['rear',6],['rear',10],['rear',15]]){EV.card=null;evStart(ev);for(let s=0;s<120*4&&EV.run&&EV.run.t<.5;s++){IN.thr=0;RACER.worldStep(1/120)}const r=EV.run;
    for(const q of TR.cars)if(q.alive&&q.kind==0)trKill(q,0);const c=r.racers[0];for(const o of r.racers)if(o!==c){o.x+=500;o.px=o.x}
    const Rt=ev.R,p=Rt.pts,k=40,ux=p[(k+5)*3]-p[k*3],uz=p[(k+5)*3+2]-p[k*3+2],ul=Math.hypot(ux,uz),fx=ux/ul,fz=uz/ul,rx=-fz,rz=fx,yaw=Math.atan2(fx,-fz),bx=p[k*3],bz=p[k*3+2],by=p[k*3+1];
    c.x=c.px=bx+rx*1.8;c.z=c.pz=bz+rz*1.8;c.yaw=c.pyaw=yaw;c.vx=fx*30;c.vz=fz*30;c.v=30;c.state=3;c.pHitT=-99;c.pHitE=0;c.race.fi=k;c.race.s=Rt.S[k];
    if(kind=='side'){RACER.carPlace(bx-rx*1.2,bz-rz*1.2,yaw,by+.5);C.vx=fx*30+rx*n;C.vz=fz*30+rz*n}else{RACER.carPlace(bx+rx*1.8-fx*7,bz+rz*1.8-fz*7,yaw,by+.5);C.vx=fx*(30+n);C.vz=fz*(30+n)}
    let maxE=0;for(let s=0;s<120;s++){IN.thr=0;C.steer=0;RACER.worldStep(1/120);if(c.pHitE>maxE)maxE=c.pHitE;if(c.hitT>0&&!(c.hitE0>0))c.hitE0=1}
    out.push(kind+' '+n+' m/s ('+Math.round(n*2.237)+' mph): '+(c.hitT>0?'contact':'no contact')+', armed for a takedown: '+(c.pHitT>0?'YES ('+Math.round(c.pHitE/1000)+' kJ)':'no'));if(EV.run)evQuit();EV.card=null}
  return out});
console.log(res.join('\n'));await T.close()})();
