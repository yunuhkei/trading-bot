'use strict';
/* ===== batch 11: things on the map you can just drive through: SPEED TRAPS, JUMP SPOTS, DRIFT ZONES =====
   SPEED TRAPS: on the long straights of the highways (up to 10, 1.5 km apart): drive past and the camera flashes your speed; the best is kept.
   JUMP SPOTS: the jump humps of the ring, the southern highway and the east loop: the length of your jump off them is measured; the best is kept.
   DRIFT ZONES: twisty stretches of the mountain roads (purple gates at both ends): every drift point you score between the gates counts; the best is kept.
   A new record pays: 500 the first time, then 250 + a share of how much better it is. Records live with the event records (EV.rec, key 'sp_...'). */
const SPOTS={list:[],flash:0,zone:null,zpts:0,lastJump:-1};
const SPOT_COL={trap:[.3,.6,1],jump:[.3,1,.45],drift:[.8,.35,1]};
function spotInit(){SPOTS.list.length=0;
  /* speed traps: straight stretches of the divided highways */
  for(const r of ROADS){if((r.style!=1&&r.hw<9)||r.city||r.n*r.ds<1200)continue;const st=Math.round(120/r.ds);for(let i=st*2;i<r.n-st*2;i+=st){const h=k=>{const t=_tan(r,k);return Math.atan2(t[0],t[1])};
      if(Math.abs(angd(h(i-st*2),h(i)))>.12||Math.abs(angd(h(i+st*2),h(i)))>.12||r.br[i])continue;const x=r.X[i],z=r.Z[i];if(SPOTS.list.some(s=>Math.hypot(s.x-x,s.z-z)<1100))continue;if(JUNC.some(J=>Math.hypot(J.x-x,J.z-z)<150))continue;
      SPOTS.list.push({type:'trap',id:'sp_trap_'+SPOTS.list.length,name:'Speed trap',x,z,y:r.Y[i],ri:ROADS.indexOf(r),i,hw:r.hw,t:_tan(r,i)});if(SPOTS.list.filter(s=>s.type=='trap').length>=10)break}}
  /* jump spots: the humps */
  for(const j of JUMPZ){const sn=navSnap(j[0],j[1],40);SPOTS.list.push({type:'jump',id:'sp_jump_'+Math.round(j[0])+'_'+Math.round(j[1]),name:'Jump',x:j[0],z:j[1],y:sn?ROADS[sn.ri].Y[sn.i]:terrainH(j[0],j[1]),r:j[2]})}
  /* drift zones: the twistiest 500 m of some mountain roads */
  for(const id of['mh','mp','cyr','nh2','th1','nt2','sc3','fr2','lombard']){const r=ROADS.find(q=>q.id==id);if(!r||r.n*r.ds<600)continue;const w=Math.round(500/r.ds);let best=-1,bi=0;
    for(let i=4;i<r.n-w-4;i+=4){let t=0;for(let k=i;k<i+w;k+=2){const a=_tan(r,k),b=_tan(r,k+2);t+=Math.abs(angd(Math.atan2(a[0],a[1]),Math.atan2(b[0],b[1])))}if(t>best){best=t;bi=i}}
    SPOTS.list.push({type:'drift',id:'sp_drift_'+id,name:'Drift zone',ri:ROADS.indexOf(r),i0:bi,i1:bi+w,x:r.X[bi],z:r.Z[bi],y:r.Y[bi],x1:r.X[bi+w],z1:r.Z[bi+w],y1:r.Y[bi+w]})}}
function spotRecord(s,val,unit,better){const rec=EV.rec[s.id]||(EV.rec[s.id]={});const prev=rec.v;let pay=0;
  if(prev==null||better(val,prev)){pay=prev==null?500:Math.round((250+Math.abs(val-prev)*(unit=='pts'?.05:unit=='m'?20:10))/50)*50;rec.v=val;evSave();ECON.add(pay)}
  return{prev,pay}}
function spotTick(dt){if(GAME.state||TUM.on){SPOTS.zone=null;return}if(SPOTS.flash>0)SPOTS.flash-=dt;const run=EV.run;
  for(const s of SPOTS.list){
    if(s.type=='trap'){const dx=C.x-s.x,dz=C.z-s.z;if(dx*dx+dz*dz>(s.hw+6)**2||Math.abs(C.y-s.y)>5){s.inside=0;continue}if(s.inside)continue;s.inside=1;if(C.speed<8)continue;
      const k=Math.round(C.kmh),o=spotRecord(s,k,'kmh',(a,b)=>a>b);SPOTS.flash=.25;s.flashT=EV.t;
      if(!run)safeToast('SPEED TRAP  '+fmtKmh(k)+(o.pay?(o.prev!=null?'  NEW BEST':'')+'  +'+evMoney(o.pay):'  (best '+fmtKmh(o.prev)+')'),2.4)}
    else if(s.type=='drift'){const r=ROADS[s.ri];const sn=Math.hypot(C.x-s.x,C.z-s.z)<r.hw+8;
      if(!SPOTS.zone&&sn&&!run){SPOTS.zone=s;SPOTS.zpts=C.driftScore||0;SPOTS.zstart=EV.t}
      if(SPOTS.zone===s){const at=Math.hypot(C.x-s.x1,C.z-s.z1)<r.hw+8,sn2=navSnap(C.x,C.z,30);
        if(at&&EV.t-SPOTS.zstart>3){const pts=Math.round((C.driftScore||0)-SPOTS.zpts),o=spotRecord(s,pts,'pts',(a,b)=>a>b);SPOTS.zone=null;safeToast('DRIFT ZONE  '+pts.toLocaleString('en-US')+' pts'+(o.pay?(o.prev!=null?'  NEW BEST':'')+'  +'+evMoney(o.pay):'  (best '+o.prev.toLocaleString('en-US')+')'),2.8)}
        else if(!sn2||sn2.ri!==s.ri||EV.t-SPOTS.zstart>120)SPOTS.zone=null}}}
  /* a jump: C.jump is set on landing; was the take-off on a jump spot? */
  if(C.jump&&C.jump.t!==SPOTS.lastJump){SPOTS.lastJump=C.jump.t;for(const s of SPOTS.list){if(s.type!='jump')continue;if(Math.hypot((C.jx||0)-s.x,(C.jz||0)-s.z)>s.r)continue;const d=Math.round(C.jump.d);if(d<8)break;
      const o=spotRecord(s,d,'m',(a,b)=>a>b);if(!run)safeToast('JUMP  '+fmtShort(d)+(o.pay?(o.prev!=null?'  NEW BEST':'')+'  +'+evMoney(o.pay):'  (best '+fmtShort(o.prev)+')'),2.6);break}}}
function spotFx(flat,sprite,stage){if(EV.run)return;const t=EV.t;
  for(const s of SPOTS.list){const d=Math.hypot(s.x-C.x,s.z-C.z);if(d>600)continue;const c=SPOT_COL[s.type];
    if(stage==5){if(s.type!='drift')flat(s.x,s.y+.07,s.z,s.type=='trap'?4:7,s.type=='trap'?4:7,c[0],c[1],c[2],.45)}
    else if(s.type=='trap'){const fl=EV.t-(s.flashT||-9)<.25;sprite(s.x+s.t[1]*0,s.y+6.5,s.z,fl?3:.6+d*.004,fl?1:c[0],fl?1:c[1],fl?1:c[2],fl?1:.75)}
    else if(s.type=='drift'){const r=ROADS[s.ri];for(const [x,y,z,i] of[[s.x,s.y,s.z,s.i0],[s.x1,s.y1,s.z1,s.i1]]){const tt=_tan(r,i);for(const sd of[-1,1])for(let k=0;k<4;k++)sprite(x-tt[1]*sd*(r.hw+1),y+1+k*1.5,z+tt[0]*sd*(r.hw+1),.6+d*.004,c[0],c[1],c[2],.7)}}
    else sprite(s.x,s.y+3+Math.sin(t*3)*.4,s.z,1+d*.004,c[0],c[1],c[2],.7)}}
function spotMapIcons(ctx,px,pz,r){for(const s of SPOTS.list){const c=SPOT_COL[s.type];ctx.fillStyle='rgb('+(c[0]*255|0)+','+(c[1]*255|0)+','+(c[2]*255|0)+')';ctx.beginPath();ctx.arc(px(s.x),pz(s.z),r*.6,0,TAU);ctx.fill()}}
