'use strict';
/* ===== traffic: cars that follow the lane graph (23_lanes.js) ===== */
/* A car drives on a path: a lane EDGE (index u) or a turn LINK (index lu). Every tick it builds a HORIZON (12 points, 6 to 10 m apart, 66 to 110 m ahead, following the turn it has chosen at the next junction),
   then thinks: IDM car following (a 'leader' is anything inside its corridor), a speed profile from the lane speed limits (curves, turns, hills), and a yield test against the horizons of the cars around it
   (priority: road class and turn type, then who is nearer the crossing). It steers by pure pursuit and drives a kinematic bicycle. A car that is hit becomes a WRECK (a free body, mass, restitution, friction).
   Impact energy goes to IMP (40_car.js) for the damage system. Everything runs at a fixed 60 Hz from the same fixed-step loop as the player and uses one seeded generator, so a run is repeatable. */
const TRN=100,HN=12,NSM=21,DTS=.2;                             /* the horizon has HN points; their spacing c.hs grows with speed (6 m in town, 10 m on the highway: 66 to 110 m) */
const TTYPES=[{n:'sedan',hl:2.25,hw:.9,m:1300},{n:'hatch',hl:2.0,hw:.88,m:1100},{n:'suv',hl:2.4,hw:.95,m:1900},{n:'van',hl:2.7,hw:1.0,m:2300},{n:'cop',hl:2.25,hw:.9,m:1600},
 /* batch 2: working vehicles with their own behaviour (beh), a taxi and a pickup; col forces a livery colour; far: whose far body they share (saves draw calls) */
 {n:'bus',cc:'t_bus',hl:5.3,hw:1.16,m:12000,beh:'bus',col:15,v0:.8,far:-1},{n:'garbage',box:'garbage',hl:4.0,hw:1.25,m:14000,beh:'garbage',col:14,v0:.6,far:-1},
 {n:'delivery',box:'boxvan',hl:3.1,hw:1.08,m:3500,beh:'delivery',col:16,v0:.97,far:3},{n:'taxi',cc:'n_cruiser',hl:2.33,hw:.96,m:1600,beh:'taxi',col:13,v0:1.1,far:0,sign:1},{n:'pickup',box:'pickup',hl:2.7,hw:1.0,m:2200,v0:.95,far:2}];
/* (TTYPES 10-19: the Close Call civilians, then 20-22 the police vehicles of batch 3, added by 73_ccars.js once the car generator is loaded) */
/* (the civilian cars ported from Close Call are added to TTYPES by 73_ccars.js, which loads after the car generator) */
/* paint albedos like real paint: white about .6, silver .42, black .04, a deep red, dark blue; nothing near 1 so the sun does not clip it */
const TCOLS=[[.60,.60,.62],[.045,.045,.05],[.42,.43,.46],[.40,.045,.05],[.04,.08,.2],[.64,.64,.62],[.05,.13,.08],[.40,.34,.24],[.52,.38,.05],[.2,.07,.18],[.12,.2,.3],[.28,.28,.26],[.58,.58,.6],
  [.6,.42,.03],[.07,.2,.08],[.6,.6,.62],[.62,.62,.6]];   /* 13 taxi yellow, 14 refuse-truck green, 15 bus white, 16 delivery white */
const TCOL_FREE=13;   /* the colours a private car picks from */
const TR={cars:[],on:true,prof:true,ms:0,max:76,base:76,t:0,sub:0,rng:null,boot:1,nAlive:0,target:0,head:new Int32Array(4096),stamp:0,P:null,seedBase:20240601,acc:0,visMin:140,visFar:380,rSpawn:430,rDespawn:540,
  stat:{spawn:0,despawn:0,hits:0,wrecks:0,aiCrash:0,msSum:0,ticks:0,msMax:0,stuck:0,turns:0,lc:0,ign:0,forced:0}};
function trNewCar(i){return{i,alive:0,state:0,kind:0,type:0,col:0,m:1300,I:1,hl:2.25,hw:.9,e:null,u:0,L:null,lu:0,x:0,z:0,y:0,yaw:0,v:0,vx:0,vz:0,om:0,px:0,pz:0,py:0,pyaw:0,pitch:0,roll:0,seed:0,v0f:1,A:2.2,T:1.3,off:0,offT:0,offHold:0,brake:0,wait:0,ign:0,age:0,hitT:0,stamp:0,nxt:-1,
  acc:0,think:0,crT:-9,hold:0,yHold:0,yGap:0,yWho:-9,yAt:0,stopT:0,yPrev:-1,pl:null,pjid:-1,lcCool:0,prio:0,hn:0,hend:0,hnTrue:0,hs:6,bg:99,yTo:-1,ns:0,vS:2.5,sx:new Float32Array(NSM),sz:new Float32Array(NSM),sdx:new Float32Array(NSM),sdz:new Float32Array(NSM),hx:new Float32Array(HN+2),hz:new Float32Array(HN+2),hv:new Float32Array(HN+2),vlim:0,flags:0,wt:0,cm:0,siren:0,block:0,life:0,pickJ:-1,pickL:null,role:0,ramCd:0,los:null,stk:0}}
for(let i=0;i<TRN;i++)TR.cars.push(trNewCar(i));
/* the player as a pseudo car (for the AI's corridor and conflict tests) and as a body for collisions */
TR.P={i:-1,state:2,x:0,z:0,vx:0,vz:0,v:0,yaw:0,om:0,hl:2.2,hw:.95,m:1400,I:1400*(2.2*2.2+.95*.95)/3,hn:HN,hs:8,hx:new Float32Array(HN),hz:new Float32Array(HN),prio:1000,e:null,ns:0,vS:0,sx:new Float32Array(NSM),sz:new Float32Array(NSM),sdx:new Float32Array(NSM),sdz:new Float32Array(NSM)};
function trInit(){TR.rng=mulberry(TR.seedBase);TR.t=0;TR.sub=0;TR.boot=1;for(const c of TR.cars)c.alive=0;TR.nAlive=0;for(const k in TR.stat)TR.stat[k]=0}
/* ---------------- small helpers ---------------- */
function trHash(a,b){let h=(Math.imul(a|0,374761393)+Math.imul(b|0,668265263))|0;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296}
const trCell=(x,z)=>((Math.imul(Math.floor(x/48)+4096,73856093)^Math.imul(Math.floor(z/48)+4096,19349663))&4095);
/* S (arc length) at a possibly unwrapped index of an edge or link */
function trSu(o,x){const n=o.n;if(!o.closed){const j=x|0;if(j>=n-1)return o.S[n-1];return o.S[j]+(o.S[j+1]-o.S[j])*(x-j)}
  const k=Math.floor(x/n),xm=x-k*n,j=xm|0,s0=o.S[j],s1=j<n-1?o.S[j+1]:o.len;return k*o.len+s0+(s1-s0)*(xm-j)}
/* advance an index by a distance along an edge/link; sets _a.i (new index, unwrapped for closed edges) and _a.rest (distance not used because the end was reached) */
const _a={i:0,rest:0};
function trAdv(o,i,dist,closed){const n=o.n,S=o.S;
  if(!closed){let j=i|0;if(j>=n-1){_a.i=n-1;_a.rest=dist;return}
    for(let g=0;g<64&&dist>0;g++){const seg=S[j+1]-S[j];if(seg<1e-6){j++;i=j;if(j>=n-1){_a.i=n-1;_a.rest=dist;return}continue}
      const avail=seg*(j+1-i);if(avail>=dist){i+=dist/seg;dist=0}else{dist-=avail;j++;i=j;if(j>=n-1){_a.i=n-1;_a.rest=dist;return}}}
    _a.i=i;_a.rest=dist>0?dist:0;return}
  for(let g=0;g<64&&dist>0;g++){const j=Math.floor(i),jm=((j%n)+n)%n,seg=(jm<n-1?S[jm+1]-S[jm]:o.len-S[n-1])||1e-6,avail=seg*(j+1-i);if(avail>=dist){i+=dist/seg;dist=0}else{dist-=avail;i=j+1}}
  _a.i=i;_a.rest=0}
const _pt={x:0,z:0,y:0,v:0,tx:0,tz:0};
/* point, speed limit and tangent at an index of an edge/link */
function trPt(o,i){const n=o.n;let j=Math.floor(i),f=i-j;if(o.closed){j=((j%n)+n)%n}else{if(j>=n-1){j=n-2;f=1}if(j<0){j=0;f=0}}
  const k=(j+1<n)?j+1:(o.closed?0:j),X=o.X,Z=o.Z,Y=o.Y;_pt.x=X[j]+(X[k]-X[j])*f;_pt.z=Z[j]+(Z[k]-Z[j])*f;_pt.y=Y[j]+(Y[k]-Y[j])*f;_pt.v=Math.min(o.V[j],o.V[k]);
  const dx=X[k]-X[j],dz=Z[k]-Z[j],l=Math.hypot(dx,dz)||1;_pt.tx=dx/l;_pt.tz=dz/l}
/* link weights for the turn a car picks at a junction (the pick is a stateless hash of the car's seed and the junction, so it never changes while the car is deciding) */
function trLW(l,g){const k=l.kind;if(k==3)return g.through?.07:2;return(k==1?1.5:k==2?1.2:1.2)*(l.to.cls>=l.from.cls?1.15:.8)}
function trPick(c,g,e){if(c.cm===1)return copPick(c,g,e);const L=g.links;let own=false;
  if(!g.through)for(let q=0;q<L.length;q++)if(L[q].from===e){own=true;break}       /* at the end of a road a car takes a turn from the lane it is in, if there is one */
  let wS=g.through?5:0,tot=wS;for(let q=0;q<L.length;q++)if(!own||L[q].from===e)tot+=trLW(L[q],g);
  let r=trHash(c.seed,g.id)*tot;if(r<wS)return null;r-=wS;let last=null;for(let q=0;q<L.length;q++){if(own&&L[q].from!==e)continue;const w=trLW(L[q],g);last=L[q];if(r<w)return L[q];r-=w}return last}
/* plan at index i of edge o: _pl = {l: the link to take (from THIS lane) or null, fu/foot: where it starts / the junction is (unwrapped like i)} */
const _pl={l:null,fu:1e9,foot:1e9,g:null,want:null};
function trPlan(c,o,i){const n=o.n,iw=o.closed?i-Math.floor(i/n)*n:i,g=lgNextJ(o,iw);_pl.l=null;_pl.fu=_pl.foot=1e9;_pl.g=g;_pl.want=null;if(!g)return;
  const base=i-iw,foot=base+g.foot+(o.closed&&g.foot<iw?n:0);_pl.foot=foot;
  const pk=trPick(c,g,o);if(!pk)return;_pl.want=pk;if(pk.from!==o)return;                       /* the pick leaves from another lane: this lane carries on straight until the car has changed lane */
  const fu=base+pk.fu+(o.closed&&pk.fu<iw-4?n:0);if(fu<i-4)return;_pl.l=pk;_pl.fu=fu}    /* a car that has just overshot the start of its turn (progress is a projection and can jump) still takes it */
/* the horizon: where the car's path goes over the next 72 m */
function trHorizon(c){
  const hx=c.hx,hz=c.hz,hv=c.hv,hs=c.hs=Math.min(10,Math.max(6,2+c.v*.33));let isL=c.L!==null,o=isL?c.L:c.e,i=isL?c.lu:c.u,hn=0,end=0;
  _pl.l=null;_pl.fu=_pl.foot=1e9;if(!isL)trPlan(c,o,i);
  for(;;){
    trPt(o,i);hx[hn]=_pt.x;hz[hn]=_pt.z;hv[hn]=_pt.v;hn++;if(hn>=HN)break;
    let rest=hs,guard=0;
    while(rest>.001&&guard++<8){
      if(isL){trAdv(o,i,rest,false);i=_a.i;rest=_a.rest;if(rest>.001){const tu=o.tu;o=o.to;i=tu;isL=false;trPlan(c,o,i)}}
      else{
        if(_pl.l!==null){const dfu=trSu(o,_pl.fu)-trSu(o,i);if(dfu<=rest){rest-=Math.max(0,dfu);o=_pl.l;isL=true;i=0;continue}}
        trAdv(o,i,rest,o.closed);i=_a.i;rest=_a.rest;
        if(rest>.001){end=1;break}
        if(i>_pl.foot)trPlan(c,o,i)}}
    if(end)break}
  c.hn=hn;c.hend=end;c.hnTrue=hn;
  if(end&&hn>=2){/* the path ends: pretend it goes straight on for two more points, so cars queueing behind see a car stopped at the end */const ex=hx[hn-1]-hx[hn-2],ez=hz[hn-1]-hz[hn-2],l=Math.hypot(ex,ez)||1;for(let q=0;q<2;q++){hx[hn]=hx[hn-1]+ex/l*hs;hz[hn]=hz[hn-1]+ez/l*hs;hv[hn]=hv[hn-1];hn++}c.hn=hn}}
/* where will this car be 0.15, 0.30 ... s from now if it keeps its speed (min 2.5 m/s, so a car waiting at a line counts as about to move)? positions and headings, computed once per tick per car */
function trSamples(c,stat){
  const hx=c.hx,hz=c.hz,hn=c.hn,hs=c.hs,vS=stat?0:(c.v<2.5?2.5:c.v);c.vS=vS;
  if(stat||hn<2){c.ns=NSM;const dx=Math.sin(c.yaw),dz=-Math.cos(c.yaw);for(let k=0;k<NSM;k++){c.sx[k]=c.x;c.sz[k]=c.z;c.sdx[k]=dx;c.sdz[k]=dz}return}
  const reach=(hn-1)*hs-3;let ns=Math.min(NSM,Math.floor(reach/vS/DTS));if(ns<1)ns=1;c.ns=ns;
  let seg=0,sA=0;                                   /* walk along the horizon once */
  for(let k=0;k<ns;k++){const d=vS*DTS*(k+1),f=d/hs;let ki=f|0,w=f-ki;if(ki>=hn-1){ki=hn-2;w=1}
    const ex=hx[ki+1]-hx[ki],ez=hz[ki+1]-hz[ki],l=Math.hypot(ex,ez)||1;c.sx[k]=hx[ki]+ex*w;c.sz[k]=hz[ki]+ez*w;c.sdx[k]=ex/l;c.sdz[k]=ez/l}}
/* ---------------- the player as a body / pseudo car ---------------- */
function trPlayerSync(){const P=TR.P;P.x=C.x;P.z=C.z;P.vx=C.vx;P.vz=C.vz;P.v=C.speed;P.yaw=C.yaw;P.om=C.wyaw;
  let ux=C.vx,uz=C.vz,l=Math.hypot(ux,uz);if(l<1.5){ux=Math.sin(C.yaw);uz=-Math.cos(C.yaw)}else{ux/=l;uz/=l}
  P.hs=Math.min(12,Math.max(6,2+C.speed*.33));for(let k=0;k<HN;k++){P.hx[k]=C.x+ux*k*P.hs;P.hz[k]=C.z+uz*k*P.hs}trSamples(P,C.speed<1)}
/* ---------------- thinking: speed, interaction, steering ---------------- */
let _term=0,_emerg=0,_swerve=0,_swSide=0,_minPd=1e9,_yGap=1e9;
const SQAB=2*Math.sqrt(2.4*3.2);
function trTerm(c,v,gap,vl){const ss=2+Math.max(0,v*c.T+v*(v-vl)/SQAB),g=gap<.15?.15:gap,t=ss/g;if(t*t>_term)_term=t*t;if(gap<.5&&v>vl+.3)_emerg=1}
/* how a neighbour j (a car, a wreck, or the player) affects car c: corridor blockers (leaders) and crossing conflicts that c has to give way to */
function trInteract(c,j,v,fx,fz){
  const hn=c.hn,hx=c.hx,hz=c.hz,dx=j.x-c.x,dz=j.z-c.z,d2=dx*dx+dz*dz,lim=(hn-1)*c.hs+8+(j===TR.P?Math.min(70,j.v*2.5):0);if(d2>lim*lim)return;   /* (the player is seen from further away: a fast player comes from beyond a slow car's path) */
  const jw=j.state==1||j.state==2;
  /* corridor: is j's centre inside my path ahead? */
  let cum=0,found=false;const CW=c.hw*.8+j.hw*.8+.1;
  for(let k=0;k<hn-1;k++){const sx=hx[k+1]-hx[k],sz=hz[k+1]-hz[k],sl=Math.hypot(sx,sz);if(sl<1e-3)continue;const rx=j.x-hx[k],rz=j.z-hz[k],t=(rx*sx+rz*sz)/(sl*sl);
    if(t>=(k==0?-.3:0)&&t<=1){const lat=Math.abs(rx*sz-rz*sx)/sl;if(lat<CW){const along=cum+t*sl,gap=along-(c.hl+j.hl),vl=(j.vx*sx+j.vz*sz)/sl;found=true;
        if(along>-.5){trTerm(c,v,gap,vl>-60?vl:-60);if(!jw&&gap<34&&vl<c.hv[0]*(c.cm>0&&c.kind===1?c.v0f:1)*.65){c.flags|=4;c.bg=gap}}break}}
    cum+=sl}
  if(found)return;
  /* crossing conflicts: where will j be when I get to each point of my path? */
  const ux=j.vx,uz=j.vz,ul=Math.hypot(ux,uz);
  if(ul>.5){const lon=(dx*fx+dz*fz);if(lon<-1&&(ux*fx+uz*fz)>0)return}     /* behind me and heading the same way: it is its job to keep clear of me */
  /* conflicts, sampled in TIME (0.15 s): my rectangle against its rectangle at the same moment, both heading the way their paths go then */
  const jS=j.state==1||(j.state==2&&j.v<1),ns=c.ns<j.ns||jS?c.ns:j.ns,mhw=c.hw+.35,mhl=c.hl+.7,vE=c.vS;
  for(let k=0;k<ns;k++){
    const mdx=c.sdx[k],mdz=c.sdz[k],ex=j.sx[k]-c.sx[k],ez=j.sz[k]-c.sz[k],lz=ex*mdx+ez*mdz,lx=ex*-mdz+ez*mdx,cd=j.sdx[k]*mdx+j.sdz[k]*mdz,sd=j.sdx[k]*-mdz+j.sdz[k]*mdx,ac=cd<0?-cd:cd,as=sd<0?-sd:sd,
      extx=j.hw*ac+j.hl*as,extz=j.hw*as+j.hl*ac;
    if((lx<0?-lx:lx)<mhw+extx&&(lz<0?-lz:lz)<mhl+extz){
      const t=(k+1)*DTS,dI=vE*t,sj=j.vS*t;let yield_=false;
      if(jw)yield_=true;
      else if(j===TR.P&&c.L&&c.L.kind!=0)yield_=true;                    /* a car turning out of a junction gives way to the player */
      else if(t<.95&&v>3.5)yield_=true;                                  /* about to touch while still moving: whatever the priorities, brake (a car that is already slow follows the priorities) */
      else if(c.ign>0)yield_=false;
      else if(j.yTo===c.i)yield_=false;                                  /* it is already giving way to me */
      else if(c.yPrev===j.i)yield_=true;                                 /* I was giving way to it: keep doing so (no flip-flopping at a crossing) */
      else if(c.prio<j.prio)yield_=true;else if(c.prio>j.prio)yield_=false;
      else yield_=dI>sj+1.5||(dI>sj-1.5&&c.i>j.i);
      if(yield_){const gap=dI-c.hl-.8;if(!jw&&c.L!==null&&t>=.95&&v*v/(2*Math.max(gap,.05))>9)return;     /* already in the junction and cannot stop any more: go on, the other car sees me and gives way */
        trTerm(c,v,gap,0);_swerve|=jw?1:0;if(jw)c.flags|=1;c.flags|=2;c.yWho=j.i;c.yAt=dI;if(gap<_yGap)_yGap=gap;if(!jw)c.yTo=j.i}
      return}}}
function trThink(c,dt){
  const hn=c.hn,v=c.v,sy=Math.sin(c.yaw),cy=Math.cos(c.yaw),fx=sy,fz=-cy;
  /* priority: class of the road, then the kind of manoeuvre; a car already in a junction goes first */
  {let cls=c.L?c.L.from.cls:c.e.cls,mv=3;if(c.L){mv=[3,2,1,0][c.L.kind]+15}else if(c.pl&&c.pl.from===c.e){const dd=(c.pl.fu-c.u)*c.e.ds;if(dd>-5&&dd<50)mv=[3,2,1,0][c.pl.kind]}c.prio=cls*4+mv+(c.kind===1&&c.cm>0?8:0)}
  let vd=1e9;for(let k=0;k<hn;k++){const d=k*c.hs,s=c.hv[k],vk=Math.sqrt(s*s+5*d);if(vk<vd)vd=vk}   /* braking to the speed limits ahead at about 2.5 m/s^2 */
  vd=Math.max(2,vd*c.v0f);if(c.cm>0&&c.kind===1){const tp=copTop(c);if(vd>tp)vd=tp}
  _term=0;_emerg=0;_swerve=0;_yGap=1e9;c.flags=0;c.yPrev=c.yTo;c.yTo=-1;
  if(c.hend){/* the path ends (the lane has to be changed first): stop at its end */const gap=(c.hnTrue-1)*c.hs-c.hl-.8;trTerm(c,v,gap,0)}
  /* TRAFFIC LIGHTS: on red stop at the line (unless it is too late to stop: then it is a late yellow and the car goes), on yellow stop only if it can do so comfortably. A chasing cop ignores them.
     Every car within 160 m of a red line is flagged (8) as waiting at a light, so a queue is not taken for a jam (stopT) and does not try to pass the car in front. */
  if(!c.L&&c.e&&!(c.kind===1&&c.cm>0)){const e=c.e,g=lgNextJ(e,c.u);if(g&&g.sig){let su=g.minFu;if(e.closed&&su<c.u-1e-6)su+=e.n;const d=trSu(e,su)-trSu(e,c.u);
    if(d>-.5&&d<160){const st=sigState(g.sig);if(st>0){c.flags|=8;const gap=d-c.hl-.3,need=v*v/(2*Math.max(gap,.1));if(gap>-.3&&(st==2?need<7.5:need<3.2))trTerm(c,v,gap<.15?.15:gap,0)}}}}
  /* (batch 15) on a turn: a light just after it (a street that crosses another a few metres after leaving the edge street) is seen from the turn already */
  else if(c.L&&!(c.kind===1&&c.cm>0)){const L=c.L,e=L.to,g=lgNextJ(e,L.tu);if(g&&g.sig){let su=g.minFu;if(e.closed&&su<L.tu-1e-6)su+=e.n;const d=L.len-trSu(L,c.lu||0)+trSu(e,su)-trSu(e,L.tu);
    if(d>-.5&&d<60){const st=sigState(g.sig);if(st>0){c.flags|=8;const gap=d-c.hl-.3,need=v*v/(2*Math.max(gap,.1));if(gap>-.3&&(st==2?need<7.5:need<3.2))trTerm(c,v,gap<.15?.15:gap,0)}}}}
  /* neighbours */
  const st=++TR.stamp,cx=Math.floor(c.x/48),cz=Math.floor(c.z/48),cars=TR.cars;
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const k=((Math.imul(cx+a+4096,73856093)^Math.imul(cz+b+4096,19349663))&4095);
    for(let q=TR.head[k];q>=0;q=cars[q].nxt){const j=cars[q];if(j===c||j.stamp===st)continue;j.stamp=st;trInteract(c,j,v,fx,fz)}}
  if(!(TR.noPlayer)){trInteract(c,TR.P,v,fx,fz)}
  /* swerve away from the player when it is going to hit us */
  {const P=TR.P,dx=P.x-c.x,dz=P.z-c.z,d=Math.hypot(dx,dz);
   if(d<45&&d>1){const rvx=P.vx-c.vx,rvz=P.vz-c.vz,cl=-(dx*rvx+dz*rvz)/d;               /* closing speed */
     if(cl>6){const tca=d/cl,mx=dx+rvx*tca,mz=dz+rvz*tca;if(tca<2&&Math.hypot(mx,mz)<3.4&&(dx*fx+dz*fz)>-2){const side=dx*cy+dz*sy;c.offT=side>0?-1.1:1.1;c.offHold=1.2}}}}
  /* giving way has a memory: for a second after the conflict was last seen the car keeps braking for the same stop point (no brake/gas flicker at a junction) */
  if(c.flags&2){c.yHold=1;c.yGap=_yGap}
  else if(c.yHold>0){c.yHold-=dt;c.yGap-=v*dt;trTerm(c,v,c.yGap,0);c.flags|=2;if(c.yPrev>=0)c.yTo=c.yPrev}
  /* BUSES stop at the bus stops of their lane (7-11 s); REFUSE TRUCKS on city streets stop every 30-70 m for 4 s to empty the bins. Both count as waiting (flag 8) while they stand. */
  if(c.beh&&c.state==0&&!c.L&&c.e){const e=c.e;
    if(c.dwell>0){c.dwell-=dt;trTerm(c,v,.15,0);c.flags|=8;if(c.dwell<=0)c.dwell=-1}
    else if(c.beh=='bus'){const B=trBusStops(e);for(const us of B){if(us<=c.u-.5||us==c.lastStop)continue;const d=e.S[us]-trSu(e,c.u);if(d>90)break;trTerm(c,v,Math.max(.15,d-.4),0);if(d<2.5&&v<.6){c.dwell=7+trHash(c.seed,us)*4;c.lastStop=us}break}}
    else if(c.beh=='garbage'&&e.road.city){c.odo+=v*dt;if(c.odo>c.halt){const g=lgNextJ(e,c.u),dj=g?e.S[Math.min(e.n-1,g.minFu)]-trSu(e,c.u):1e9;if(dj>25&&!c.hend){trTerm(c,v,.15,0);if(v<.4){c.dwell=4;c.nh++;c.odo=0;c.halt=30+trHash(c.seed,c.nh*7+3)*40}}else c.odo=c.halt-12}}}
  if(c.v<.3&&!(c.flags&8))c.stopT+=dt;else c.stopT=0;
  if(c.offHold>0){c.offHold-=dt}else c.offT=0;
  const rate=c.offHold>0?3:1.1;c.off+=(c.offT-c.off)*Math.min(1,dt*rate);
  /* IDM */
  const r=v/vd,r2=r*r;let a=c.A*(1-r2*r2-_term);if(a<-9)a=-9;if(_emerg&&a>-6)a=-6;
  c.acc=a;
  c.v=Math.max(0,v+a*dt);c.brake=(a<-1.1||(c.v<.6&&_term>.3))?1:0;
  if(c.v<.5&&(c.flags&2))c.wait+=dt;else c.wait=0;if(c.wait>(c.L?1.2:2.5)&&c.ign<=0){c.ign=3;c.wait=0;TR.stat.ign++}              /* stuck giving way: after a few seconds (sooner in the middle of a junction) go anyway */
  if(c.ign>0)c.ign-=dt}
/* steer by pure pursuit towards the horizon, move, and keep track of where we are on the path */
function trMove(c,dt){
  c.px=c.x;c.pz=c.z;c.py=c.y;c.pyaw=c.yaw;
  const v=c.v,hn=c.hn,Ld=Math.min(Math.max(2.8+v*.32,4),c.hs*(hn-1)||4),f=Ld/c.hs,fi=Math.min(f|0,hn-2),w=Math.min(1,f-fi);
  if(hn>=2){const hx=c.hx,hz=c.hz;let tx=hx[fi]+(hx[fi+1]-hx[fi])*w,tz=hz[fi]+(hz[fi+1]-hz[fi])*w;
    if(c.off!==0){const sx=hx[fi+1]-hx[fi],sz=hz[fi+1]-hz[fi],l=Math.hypot(sx,sz)||1;tx+=-sz/l*c.off;tz+=sx/l*c.off}
    const dx=tx-c.x,dz=tz-c.z,dist=Math.max(2,Math.hypot(dx,dz)),err=angd(Math.atan2(dx,-dz),c.yaw);
    let del=Math.atan(2*2.7*Math.sin(err)/dist);del=del>.6?.6:del<-.6?-.6:del;const yr=v/2.7*Math.tan(del);c.om=yr;c.yaw+=yr*dt}
  c.vx=Math.sin(c.yaw)*v;c.vz=-Math.cos(c.yaw)*v;c.x+=c.vx*dt;c.z+=c.vz*dt;
  /* progress along the path */
  let o=c.L||c.e,i=c.L?c.lu:c.u;
  for(let g=0;g<6;g++){const n=o.n,j0=Math.floor(i),jm=o.closed?((j0%n)+n)%n:Math.min(j0,n-2),jn=o.closed?(jm+1)%n:jm+1,ax=o.X[jm],az=o.Z[jm],sx=o.X[jn]-ax,sz=o.Z[jn]-az,sl=sx*sx+sz*sz||1e-6,t=((c.x-ax)*sx+(c.z-az)*sz)/sl;
    if(t>=1&&(o.closed||jm+1<n-1)){i=j0+1;continue}
    const ni=j0+(t<0?0:t>1?1:t);if(ni>i)i=ni;break}
  if(c.L){c.lu=i;if(i>=c.L.n-1-.001){const L=c.L;c.e=L.to;c.u=L.tu;c.L=null;c.pjid=-1}}
  else{if(c.e.closed){const n=c.e.n;if(i>=n)i-=n;c.u=i}else c.u=i;
    /* time to take the turn we planned? */
    const e=c.e;trPlan(c,e,c.u);c.pl=_pl.want;
    if(_pl.l!==null&&_pl.l.from===e&&(c.u>=_pl.fu-.001||((c.x-_pl.l.X[0])**2+(c.z-_pl.l.Z[0])**2<20&&c.u>_pl.fu-3))){const L=c.L=_pl.l;c.lu=0;c.pjid=_pl.g?_pl.g.id:-1;TR.stat.turns++;
      if(c.u>_pl.fu+.5){/* we are already past the start of the curve: join it at the point nearest to us */let bd=1e9,bi=0;for(let k=0;k<L.n-1;k++){const d=(c.x-L.X[k])**2+(c.z-L.Z[k])**2;if(d<bd){bd=d;bi=k}}c.lu=bi}}    /* at the start of the turn, or already next to it (a car that cuts the corner early still takes it) */
    else if(!e.closed&&c.u>=e.n-1.2){/* the lane ran out with no way on from this lane: change to a lane that has one, or give up */
      if(trForceLane(c))TR.stat.forced++;else trKill(c,2)}}
  /* height, pitch and roll from the path */
  const op=c.L||c.e,ii=c.L?c.lu:c.u;trPt(op,ii);const dyaw=c.om;
  c.y+=(_pt.y-c.y)*Math.min(1,dt*30);
  {const p0=_pt.y;trPt(op,ii+.8);const dy=_pt.y-p0,ds=2.6;c.pitch+=(Math.atan2(dy,ds)-c.pitch)*Math.min(1,dt*10)}
  c.roll+=(clamp(-dyaw*v*.0035,-.06,.06)-c.roll)*Math.min(1,dt*8);
  c.age+=dt}
/* the car reached the end of a lane with no turn from it: use a neighbouring lane that has one */
function trForceLane(c){const e=c.e,o=LG.ofRoad[e.ri][lgDirI(e.dir)];
  if(c.pl&&c.pl.from!==e&&c.pl.from.ri===e.ri&&c.pl.from.dir===e.dir){trSwitchLane(c,c.pl.from);return true}
  for(const e2 of o){if(e2===e)continue;for(const l of e2.out)if(l.foot>=e2.n-4){trSwitchLane(c,e2);return true}}return false}
function trSwitchLane(c,e2){const i=Math.min(Math.floor(c.u),e2.n-2),t=lgTan(e2,i),dx=c.x-e2.X[i],dz=c.z-e2.Z[i];c.off=clamp(dx*(-t[1])+dz*t[0],-8,8);c.e=e2;TR.stat.lc++}
/* lane changes: to get into the lane that has the turn we want, and to pass a slow car */
function trLaneChange(c,dt){
  if(c.L||c.lcCool>0||c.hold>0){c.lcCool-=dt;return}
  const e=c.e,o=LG.ofRoad[e.ri][lgDirI(e.dir)];if(o.length<2)return;
  let want=-1;
  _pl.want=null;const iw=c.u;const g=lgNextJ(e,iw);
  if(g){const pk=trPick(c,g,e);if(pk&&pk.from!==e){const dist=(e.closed?((pk.fu-iw+e.n)%e.n):(pk.fu-iw))*e.ds;if((dist>32&&dist<190)||c.hend)want=pk.from.k}}
  if(want<0){/* a dead-end lane (no turn from it, no straight) */ if(g&&!g.through){let has=false;for(const l of e.out)if(l.jg===g)has=true;if(!has){for(const l of g.links){want=l.from.k;break}}}}
  if(want<0){/* pass a slow car: only on multi-lane roads, only if we are blocked */
    if(c.flags&4&&!(c.flags&8)&&c.bg>=10&&c.v<c.vlim*(c.cm>0&&c.kind===1?c.v0f:1)*.72&&c.offHold<=0){want=e.k>0?e.k-1:e.k+1;if(want>=o.length)want=-1}}
  if(want<0||want===e.k)return;
  if(c.hend&&c.stopT>2.5){trSwitchLane(c,o[want]);c.lcCool=2;c.stopT=0;TR.stat.forced++;return}      /* stuck at the end of a lane: just take the lane */
  const k2=e.k+(want>e.k?1:-1),e2=o[k2],st=++TR.stamp,cars=TR.cars,cx=Math.floor(c.x/48),cz=Math.floor(c.z/48);let ok=true;
  for(let a=-1;a<=1&&ok;a++)for(let b=-1;b<=1&&ok;b++){const k=((Math.imul(cx+a+4096,73856093)^Math.imul(cz+b+4096,19349663))&4095);
    for(let q=TR.head[k];q>=0;q=cars[q].nxt){const j=cars[q];if(j===c||j.stamp===st)continue;j.stamp=st;
      if(j.state==0&&(j.e===e2||(j.L&&j.L.to===e2))){const jd=(j.L?(j.L.tu-c.u):(j.u-c.u))*e.ds,bold=c.cm>0&&c.kind===1,beh=(bold?6:10)+Math.max(0,j.v-c.v)*(bold?1:1.8);if(jd>-beh&&jd<(bold?8:12)+Math.max(0,c.v-j.v)*(bold?.7:1.2)){ok=false;break}}
      else if(j.state==1&&Math.hypot(j.x-c.x,j.z-c.z)<14){ok=false;break}}}
  if(!ok){c.lcCool=.5;return}
  trSwitchLane(c,e2);c.lcCool=want!==k2?.8:(c.cm>0&&c.kind===1?1:2.5)}
/* ---------------- wrecks and collisions ---------------- */
let _sx=0,_sz=0;
/* push a circle out of the static colliders (buildings, poles, trees); returns the summed push in _sx,_sz */
function trStatic(cx,cz,r,y){_sx=_sz=0;const cs=QH.ccs,cn=QH.cnc,a=Math.floor((cx+W.half)/cs),b=Math.floor((cz+W.half)/cs);if(a<1||b<1||a>=cn-1||b>=cn-1)return false;let hit=false;
  for(let bb=b-1;bb<=b+1;bb++)for(let aa=a-1;aa<=a+1;aa++){const c=bb*cn+aa;for(let q=QH.cst[c];q<QH.cst[c+1];q++){const k=QH.cli[q];let nx=0,nz=0,pen=0;
    if(k<QH.nR){const x0=QH.CR[k*5],z0=QH.CR[k*5+1],x1=QH.CR[k*5+2],z1=QH.CR[k*5+3],top=QH.CR[k*5+4];if(y>top+.5)continue;const px=cx<x0?x0:cx>x1?x1:cx,pz=cz<z0?z0:cz>z1?z1:cz,dx=cx-px,dz=cz-pz,d2=dx*dx+dz*dz;if(d2>=r*r)continue;
      if(d2>1e-6){const d=Math.sqrt(d2);nx=dx/d;nz=dz/d;pen=r-d}else{const l=cx-x0,rr=x1-cx,t=cz-z0,bt=z1-cz,m=Math.min(l,rr,t,bt);if(m==l)nx=-1;else if(m==rr)nx=1;else if(m==t)nz=-1;else nz=1;pen=r+m}}
    else if(k<QH.nR+QH.nC){const j=k-QH.nR,x=QH.CC[j*5],z=QH.CC[j*5+1],rr=QH.CC[j*5+2]+r*.6,dx=cx-x,dz=cz-z,d2=dx*dx+dz*dz;if(d2>=rr*rr||d2<1e-8)continue;if(y>QH.CC[j*5+4]+.2||y+1.2<QH.CC[j*5+3])continue;const d=Math.sqrt(d2);nx=dx/d;nz=dz/d;pen=rr-d}
    else{const j=k-QH.nR-QH.nC,ox=QH.CO[j*7],oz=QH.CO[j*7+1],hx=QH.CO[j*7+2],hz=QH.CO[j*7+3],c2=QH.CO[j*7+4],s2=QH.CO[j*7+5],top=QH.CO[j*7+6];if(y>top+.5)continue;
      const ddx=cx-ox,ddz=cz-oz,lx=ddx*c2+ddz*s2,lz=-ddx*s2+ddz*c2,px=lx<-hx?-hx:lx>hx?hx:lx,pz=lz<-hz?-hz:lz>hz?hz:lz,ex=lx-px,ez=lz-pz,d2=ex*ex+ez*ez;let nlx=0,nlz=0;
      if(d2>=r*r)continue;if(d2>1e-6){const d=Math.sqrt(d2);nlx=ex/d;nlz=ez/d;pen=r-d}else{const a1=lx+hx,a2=hx-lx,a3=lz+hz,a4=hz-lz,m=Math.min(a1,a2,a3,a4);if(m==a1)nlx=-1;else if(m==a2)nlx=1;else if(m==a3)nlz=-1;else nlz=1;pen=r+m}
      nx=nlx*c2-nlz*s2;nz=nlx*s2+nlz*c2}
    _sx+=nx*pen;_sz+=nz*pen;hit=true}}
  return hit}
function trWreck(c,dt){
  c.px=c.x;c.pz=c.z;c.py=c.y;c.pyaw=c.yaw;c.age+=dt;c.wt+=dt;c.brake=0;
  c.x+=c.vx*dt;c.z+=c.vz*dt;c.yaw+=c.om*dt;
  const sp=Math.hypot(c.vx,c.vz);if(sp>0){const fr=6.5*dt;if(sp>fr){const k=1-fr/sp;c.vx*=k;c.vz*=k}else{c.vx=c.vz=0}}
  c.om*=Math.exp(-dt*(sp>4?.45:2.2));if(sp<.05&&Math.abs(c.om)<.03)c.om=0;
  c.v=sp;
  /* static things stop it */
  const sy=Math.sin(c.yaw),cy=Math.cos(c.yaw);
  for(const o of[-1,1]){const cx=c.x+sy*o*c.hl*.55,cz=c.z-cy*o*c.hl*.55;if(trStatic(cx,cz,c.hw+.1,c.y)){c.x+=_sx;c.z+=_sz;const l=Math.hypot(_sx,_sz)||1,nx=_sx/l,nz=_sz/l,vn=c.vx*nx+c.vz*nz;if(vn<0){c.vx-=1.2*vn*nx;c.vz-=1.2*vn*nz;c.om*=.7}}}
  const flipped=trTumble(c,dt);
  if(c.rec&&!flipped&&!c.air&&c.wt>2.4&&sp<3&&trReattach(c))return;
  if(c.block){c.life-=dt;if(c.life<=0)trKill(c,1)}else if(c.wt>TR.wreckLife){trKill(c,1)}}
/* a knocked car gets back onto the nearest lane and drives on, slower and weaker the more it is damaged */
function trReattach(c){
  if(!trProbe(c.x,c.z))return false;const ri=TRP.ri,r=ROADS[ri],o=LG.ofRoad[ri],i=TRP.i,j=i+1<r.n?i+1:i,tx=r.X[j]-r.X[i],tz=r.Z[j]-r.Z[i],hx=Math.sin(c.yaw),hz=-Math.cos(c.yaw),dir=(tx*hx+tz*hz)>=0?0:1,lanes=o[dir];
  const u=Math.max(3,Math.min(r.n-6,dir==0?i:r.n-1-i));let bk=0,bd=1e18;for(let k=0;k<lanes.length;k++){const e=lanes[k],q=Math.min(Math.floor(u),e.n-2),d=(e.X[q]-c.x)**2+(e.Z[q]-c.z)**2;if(d<bd){bd=d;bk=k}}
  const e=lanes[bk];c.e=e;c.u=Math.min(Math.floor(u),e.n-2);c.L=null;c.lu=0;c.state=0;c.pjid=-1;c.pickJ=-1;c.hn=0;c.stk=0;c.v=0;c.vx=c.vz=c.om=0;c.rec=0;c.v0f=Math.max(.4,c.v0f*(1-.55*(c.dmg||0)));c.A=Math.max(.8,c.A*(1-.4*(c.dmg||0)));
  const t=lgTan(e,c.u|0);c.off=Math.max(-8,Math.min(8,(c.x-e.X[c.u|0])*(-t[1])+(c.z-e.Z[c.u|0])*t[0]));return true}
TR.wreckLife=30;
function trKill(c,why){if(!c.alive)return;c.alive=0;TR.nAlive--;TR.stat.despawn++;if(why==2)TR.stat.stuck++}
/* two bodies hit (a: car, wreck or the player proxy; b: car or wreck). Returns the impact energy (J) or 0. a and b have x,z,yaw,vx,vz,om,m,I,hl,hw; normal points from b to a. */
const HIT={nx:0,nz:0,cx:0,cz:0,pen:0,vn:0,E:0,jn:0};
function trObb(a,b){
  const ca=Math.cos(a.yaw),sa=Math.sin(a.yaw),cb=Math.cos(b.yaw),sb=Math.sin(b.yaw);   /* forward = (sin,-cos), right = (cos,sin) */
  const ax=[ca,sa],az=[sa,-ca],bx=[cb,sb],bz=[sb,-cb],dx=a.x-b.x,dz=a.z-b.z;
  let best=1e9,bnx=0,bnz=0;
  const axes=[[ca,sa,a.hw,a.hl],[sa,-ca,a.hl,a.hw]];
  const test=(ux,uz)=>{const ra=Math.abs(ux*ca+uz*sa)*a.hw+Math.abs(ux*sa-uz*ca)*a.hl,rb=Math.abs(ux*cb+uz*sb)*b.hw+Math.abs(ux*sb-uz*cb)*b.hl,dd=dx*ux+dz*uz,ov=ra+rb-Math.abs(dd);if(ov<best){best=ov;if(dd>=0){bnx=ux;bnz=uz}else{bnx=-ux;bnz=-uz}}return ov>0};
  if(!test(ca,sa)||!test(sa,-ca)||!test(cb,sb)||!test(sb,-cb))return false;
  HIT.nx=bnx;HIT.nz=bnz;HIT.pen=best;
  /* contact point: the middle of the corners of one box that lie inside the other (for a head-on hit, the middle of the face that touches) */
  let sx=0,sz=0,cnt=0;
  for(const[s1,s2]of[[1,1],[1,-1],[-1,1],[-1,-1]]){
    let qx=a.x+ca*s1*a.hw+sa*s2*a.hl,qz=a.z+sa*s1*a.hw-ca*s2*a.hl,lx=(qx-b.x)*cb+(qz-b.z)*sb,lz=(qx-b.x)*sb-(qz-b.z)*cb;
    if(Math.abs(lx)<=b.hw+.05&&Math.abs(lz)<=b.hl+.05){sx+=qx;sz+=qz;cnt++}
    qx=b.x+cb*s1*b.hw+sb*s2*b.hl;qz=b.z+sb*s1*b.hw-cb*s2*b.hl;lx=(qx-a.x)*ca+(qz-a.z)*sa;lz=(qx-a.x)*sa-(qz-a.z)*ca;
    if(Math.abs(lx)<=a.hw+.05&&Math.abs(lz)<=a.hl+.05){sx+=qx;sz+=qz;cnt++}}
  let px,pz;if(cnt){px=sx/cnt;pz=sz/cnt}else{px=(a.x+b.x)/2;pz=(a.z+b.z)/2}
  HIT.cx=px;HIT.cz=pz;return true}
const BA={x:0,z:0,yaw:0,vx:0,vz:0,om:0,m:1,I:1,hl:1,hw:1},BB={x:0,z:0,yaw:0,vx:0,vz:0,om:0,m:1,I:1,hl:1,hw:1};
/* resolve one contact between two bodies with an impulse (restitution e, friction mu); moves them apart; returns the energy lost in the crash (J) */
function trResolve(a,b,e,mu){
  const nx=HIT.nx,nz=HIT.nz,pen=HIT.pen,ima=1/a.m,imb=1/b.m,tot=ima+imb;
  /* positions apart, the lighter one moves more */
  const ka=ima/tot,kb=imb/tot;a.x+=nx*pen*ka;a.z+=nz*pen*ka;b.x-=nx*pen*kb;b.z-=nz*pen*kb;
  const rax=HIT.cx-a.x,raz=HIT.cz-a.z,rbx=HIT.cx-b.x,rbz=HIT.cz-b.z;
  const vax=a.vx-a.om*raz,vaz=a.vz+a.om*rax,vbx=b.vx-b.om*rbz,vbz=b.vz+b.om*rbx,rvx=vax-vbx,rvz=vaz-vbz,vn=rvx*nx+rvz*nz;
  if(vn>=0){HIT.vn=0;HIT.E=0;HIT.jn=0;return 0}
  const rna=rax*nz-raz*nx,rnb=rbx*nz-rbz*nx,den=tot+rna*rna/a.I+rnb*rnb/b.I,j=-(1+e)*vn/den;
  a.vx+=j*nx*ima;a.vz+=j*nz*ima;a.om+=(rax*(j*nz)-raz*(j*nx))/a.I;b.vx-=j*nx*imb;b.vz-=j*nz*imb;b.om-=(rbx*(j*nz)-rbz*(j*nx))/b.I;
  /* friction along the contact */
  const tx=-nz,tz=nx,vt=rvx*tx+rvz*tz,rta=rax*tz-raz*tx,rtb=rbx*tz-rbz*tx,dt_=tot+rta*rta/a.I+rtb*rtb/b.I;let jt=-vt/dt_;const lim=mu*j;jt=jt>lim?lim:jt<-lim?-lim:jt;
  a.vx+=jt*tx*ima;a.vz+=jt*tz*ima;a.om+=(rax*(jt*tz)-raz*(jt*tx))/a.I;b.vx-=jt*tx*imb;b.vz-=jt*tz*imb;b.om-=(rbx*(jt*tz)-rbz*(jt*tx))/b.I;
  const mu_=a.m*b.m/(a.m+b.m);HIT.vn=-vn;HIT.jn=j;HIT.E=.5*mu_*(1-e*e)*vn*vn;return HIT.E}
function trBody(B,c){B.x=c.x;B.z=c.z;B.yaw=c.yaw;if(c.state==0){B.vx=Math.sin(c.yaw)*c.v;B.vz=-Math.cos(c.yaw)*c.v;B.om=0}else{B.vx=c.vx;B.vz=c.vz;B.om=c.om}B.m=c.m;B.I=c.m*(c.hl*c.hl+c.hw*c.hw)/3;B.hl=c.hl;B.hw=c.hw}
/* write a body back into a car: a hard hit (or any hit on a wreck) makes it a wreck, a light bump just changes its speed */
/* a crash leaves a dent in the car: where (on its body), how deep and how wide; two dents are kept per car and a new one near an old one deepens it. The shader (trV) pushes the metal in. */
const TDCAP=[170000,150000,230000,280000,250000,900000,900000,400000,170000,260000,170000,170000,170000,150000,260000,170000,170000,260000,170000,170000,230000,300000,900000];      /* energy that finishes a sedan / hatch / SUV / van / police car (J) */
function trDent(c,wx,wz,E){
  if(E<4000)return;c.dmg=Math.min(1,(c.dmg||0)+E/(TDCAP[c.type]||180000));const sy=Math.sin(c.yaw),cy=Math.cos(c.yaw),dx=wx-c.x,dz=wz-c.z;let lr=dx*cy+dz*sy,lf=dx*sy-dz*cy;const k=Math.max(Math.abs(lr)/c.hw,Math.abs(lf)/c.hl,1e-3);lr/=k;lf/=k;
  const q=Math.sqrt(E/180000),dep=Math.min(.42,.05+.33*q),rad=.42+.4*q,d=c.dn||(c.dn=new Float32Array(12));let slot=-1;
  for(let s=0;s<3;s++)if(d[s*4+2]>0&&Math.hypot(d[s*4]-lr,d[s*4+1]-lf)<.8){slot=s;break}
  if(slot<0){slot=d[2]<=0?0:d[6]<=0?1:d[10]<=0?2:(d[2]<=d[6]&&d[2]<=d[10]?0:d[6]<=d[10]?1:2)}
  if(d[slot*4+2]>0&&Math.hypot(d[slot*4]-lr,d[slot*4+1]-lf)<.8){d[slot*4+2]=Math.min(.5,d[slot*4+2]+dep*.7);d[slot*4+3]=Math.max(d[slot*4+3],rad)}else{d[slot*4]=lr;d[slot*4+1]=lf;d[slot*4+2]=dep;d[slot*4+3]=rad}
  /* the panel nearest the hit springs open once the car is hurt: bonnet (front), boot (rear), doors (sides) */
  const pm=(typeof TRM!=='undefined'&&TRM.pm)?TRM.pm[c.type]:0;if(pm&&(E>=50000||c.dmg>.3)){const side=Math.abs(lr)/c.hw,fr=Math.abs(lf)/c.hl,rd=trHash((c.x*31)|0,(c.z*17)|0);
    if(fr>=side){if(lf>0){if(pm&1)c.pf|=16}else if(pm&2)c.pf|=32}else if(lr>0){if(pm&4)c.pf|=64}else if(pm&8)c.pf|=128;
    if(c.dmg>.75&&rd<.6){if(pm&4)c.pf|=64;if(pm&8&&rd<.35)c.pf|=128}}}
function trBack(B,c,E){
  trDent(c,HIT.cx,HIT.cz,E);
  if(c.state==3){/* a chasing cop: it keeps driving, with the new velocity */const hx=Math.sin(c.yaw),hz=-Math.cos(c.yaw);c.x=B.x;c.z=B.z;c.v=Math.max(0,B.vx*hx+B.vz*hz);c.vx=B.vx;c.vz=B.vz;c.yaw+=Math.max(-.6,Math.min(.6,B.om*.08));if(E>110000&&c.kind==1){c.state=1;c.siren=0;c.wt=0;c.block=0;TR.stat.wrecks++;trFlipKick(c,E)}if(E>(TR.hitP?70000:220000)&&c.kind==2){c.state=1;c.wt=0;TR.stat.wrecks++;trFlipKick(c,E)}return}   /* a racer wrecked by a big hit is out of the race */
  if(c.state==0&&E<2500){const hx=Math.sin(c.yaw),hz=-Math.cos(c.yaw);c.v=Math.max(0,B.vx*hx+B.vz*hz);c.x=B.x;c.z=B.z;return}
  if(c.state==0){c.state=1;c.wt=0;c.brake=0;c.L=null;TR.stat.wrecks++;c.rec=(c.kind==0&&E<32000&&(c.dmg||0)<.72)?1:0}      /* a knock spins it round and it drives on, limping; a big hit finishes it */
  c.x=B.x;c.z=B.z;c.vx=B.vx;c.vz=B.vz;c.om=B.om>5?5:B.om<-5?-5:B.om;c.v=Math.hypot(c.vx,c.vz);trFlipKick(c,E)}   /* batch 6: a big hit throws it up and rolls it */
/* the player against every car near it (called from the fixed-step loop, 120 Hz) */
function trPlayerCollide(){
  if(!TR.on||!TR.nAlive)return;const P=TR.P;trPlayerSync();
  const cx=Math.floor(C.x/48),cz=Math.floor(C.z/48),cars=TR.cars,st=++TR.stamp;
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const k=((Math.imul(cx+a+4096,73856093)^Math.imul(cz+b+4096,19349663))&4095);
    for(let q=TR.head[k];q>=0;q=cars[q].nxt){const c=cars[q];if(c.stamp===st||!c.alive)continue;c.stamp=st;
      const dx=c.x-C.x,dz=c.z-C.z;if(dx*dx+dz*dz>36||Math.abs(c.y-C.y)>2.2)continue;
      trBody(BA,{x:C.x,z:C.z,yaw:C.yaw,state:1,vx:C.vx,vz:C.vz,om:C.wyaw,m:P.m,hl:P.hl,hw:P.hw});trBody(BB,c);
      if(!trObb(BA,BB))continue;
      const e=trResolve(BA,BB,.26,.32);if(HIT.vn>0){
        /* the player: velocity and a share of the spin (the driving model keeps its own yaw) */
        C.vx=BA.vx;C.vz=BA.vz;C.wyaw+=clamp((BA.om-C.wyaw),-1.6,1.6)*.55;C.x=BA.x;C.z=BA.z;
        const vn=HIT.vn;C.hit=Math.max(C.hit,vn);C.shake=Math.min(1,C.shake+vn*.04);C.flash=Math.max(C.flash,Math.min(.25,vn*.01));
        impactAdd(3,vn,e,c.m,HIT.cx,HIT.cz,HIT.nx,HIT.nz);if(C.t-c.hitT>.5)TR.stat.hits++;const hnx=HIT.nx,hnz=HIT.nz;
        /* WHO WAS AT FAULT: only a crash YOU drive into is a crime. The normal points from the car to you: your speed into it against its speed into you (being rear-ended, or a patrol nudging you at a standstill, used to make you wanted) */
        const pin=-(C.vx*HIT.nx+C.vz*HIT.nz)+0,cin=c.state==0?(Math.sin(c.yaw)*c.v*HIT.nx-Math.cos(c.yaw)*c.v*HIT.nz):(c.vx*HIT.nx+c.vz*HIT.nz),fault=pin>2.5&&pin>cin&&!(c.state==0&&c.L&&c.L.kind!=0);   /* (a car caught turning across you, pulling out of a side road, is to blame, not you: after the batch 13-16 towns' new junctions) */
        const was=c.state;if(c.kind==1)copRammed(c,e,fault);else if(fault&&e>5000)copTrigger(e>70000?2:1,'crash');                 /* crashing into a car is a crime */
        TR.hitP=1;trBack(BB,c,e);TR.hitP=0;c.hitT=C.t;if(was!==1&&c.state==1)evTakedown(c);if(fault&&c.kind==0&&was==0&&c.state==1)copTrigger(2,'wreck');if(!PHYS.classic)tumbleFromCar(hnx,hnz,vn,e,c.m)}
      else{C.x=BA.x;C.z=BA.z;c.x=BB.x;c.z=BB.z}}}}
/* wreck against car / wreck against wreck (not the player) */
function trCarCollide(){
  const cars=TR.cars;
  for(let i=0;i<TRN;i++){const a=cars[i];if(!a.alive)continue;
    const cx=Math.floor(a.x/48),cz=Math.floor(a.z/48),st=++TR.stamp;a.stamp=st;
    for(let p=-1;p<=1;p++)for(let q=-1;q<=1;q++){const k=((Math.imul(cx+p+4096,73856093)^Math.imul(cz+q+4096,19349663))&4095);
      for(let n=TR.head[k];n>=0;n=cars[n].nxt){const b=cars[n];if(b.stamp===st||!b.alive||b.i<=a.i)continue;b.stamp=st;
        const dx=b.x-a.x,dz=b.z-a.z;if(dx*dx+dz*dz>40||Math.abs(a.y-b.y)>2.2)continue;
        trBody(BA,a);trBody(BB,b);if(!trObb(BA,BB))continue;
        if(a.state==0&&b.state==0&&(TR.t-a.crT>1.5||TR.t-b.crT>1.5)){a.crT=b.crT=TR.t;TR.stat.aiCrash++;if(TR.onCrash)TR.onCrash(a,b)}
        const e=trResolve(BA,BB,.25,.3);
        /* a bump at walking pace between two cars that are both driving (one creeping out of a side road into one waiting on the main road): they are eased apart, slow to the speed the bump leaves them and carry on.
           It used to count as a wreck whenever a van or a bus was involved (the rule went by energy, and a heavy vehicle has a lot of it at 2 m/s) */
        if(HIT.vn>0&&HIT.vn<4&&a.state==0&&b.state==0&&a.kind==0&&b.kind==0){for(const[c,B]of[[a,BA],[b,BB]]){const hx=Math.sin(c.yaw),hz=-Math.cos(c.yaw);c.x=B.x;c.z=B.z;c.v=Math.max(0,Math.min(c.v,B.vx*hx+B.vz*hz))}}
        else if(HIT.vn>0){trBack(BA,a,e);trBack(BB,b,e);if(e>2500){a.hitT=b.hitT=TR.t}}else{a.x=BA.x;a.z=BA.z;b.x=BB.x;b.z=BB.z}}}}}
/* ---------------- spawning ---------------- */
const TRP={ri:-1,i:0,t:0,d:0};
/* nearest road segment to a point (uses the road hash of 22_build.js) */
function trProbe(x,z){TRP.ri=-1;const cs=QH.cs,nc=QH.nc,cx=Math.floor((x+W.half)/cs),cz=Math.floor((z+W.half)/cs);if(cx<0||cz<0||cx>=nc||cz>=nc)return false;const c=cz*nc+cx;let bd=1e9;
  for(let q=QH.st[c];q<QH.st[c+1];q++){const s=QH.li[q],r=ROADS[QH.segR[s]],ri=QH.segR[s];if(!LG.ofRoad[ri])continue;const i=QH.segI[s],j=i+1<r.n?i+1:0,ax=r.X[i],az=r.Z[i],dx=r.X[j]-ax,dz=r.Z[j]-az,l2=dx*dx+dz*dz||1;let t=((x-ax)*dx+(z-az)*dz)/l2;t=t<0?0:t>1?1:t;
    const d=Math.hypot(x-ax-dx*t,z-az-dz*t);if(d<bd){bd=d;TRP.ri=ri;TRP.i=i;TRP.t=t;TRP.d=d}}
  return TRP.ri>=0&&bd<ROADS[TRP.ri].hw*.8}
/* how busy the roads are at a place (0..1) */
function trDens(x,z,cls){
  if(inBox(x,z,CITY,60))return 1;if(inBox(x,z,VALLEY,60))return .9;if(inBox(x,z,BEACH,60)||inBox(x,z,RESORT,60))return .65;
  for(const zn of ZONES)if(inZone(x,z,zn,60))return zn.d||.6;
  return cls>=3?.55:cls==2?.45:.36}   /* batch 5: more traffic out of town (was .4 / .3 / .22) */
function trSeen(x,z){const dx=x-C.x,dz=z-C.z,d=Math.hypot(dx,dz);if(d<TR.visMin)return true;if(d>TR.visFar)return false;
  const hx=Math.sin(C.yaw),hz=-Math.cos(C.yaw);return(dx*hx+dz*hz)/d>.4}
/* which vehicle: on highways mostly the family cars and the Close Call cars, some vans and pickups; in town also taxis (more downtown and in Las Vegas), buses on the
   lanes that have bus stops, refuse trucks on the streets, delivery vans; pickups in the small towns. r1, r2: two draws of the traffic generator */
function trPickType(r1,r2,e,x,z){const civ=TTYPES.map((T,i)=>T.civ?i:-1).filter(i=>i>=0),cc=()=>civ[Math.floor(r2*civ.length)%civ.length],city=e.road.city,cls=e.cls;
  const old=r=>r<.4?0:r<.7?1:r<.9?2:3;
  if(!city){if(cls>=3)return r1<.06?7:r1<.12?9:r1<.42?cc():(r1<.6?3:r1<.75?2:r1<.9?0:1);return r1<.12?9:r1<.18?7:r1<.48?cc():old(r2)}
  const big=inBox(x,z,CITY,40)||inBox(x,z,CITY_VEG,40),town=ZONES.some(zn=>zn.b!==CITY_VEG&&zn.b!==CITY_SAC&&zn.b!==CITY_SJ&&inZone(x,z,zn,40));
  if(r1<.05&&trBusStops(e).length)return 5;if(r1<.08)return 6;if(r1<.14)return 7;if(r1<(big?.32:.2))return 8;if(r1<(town?.38:.25))return 9;if(r1<.6)return cc();return old(r2)}
/* bus stops: on the kerb lane of city streets and boulevards, about every 220 m, never within 35 m of a junction (u indices on the edge, made once) */
function trBusStops(e){if(e.bstops)return e.bstops;const o=[];e.bstops=o;if(!e.road.city||e.closed&&false||e.k!=e.nl-1)return o;const G=LG.jg[e.ri*2+lgDirI(e.dir)]||[];
  for(let s=70;s<e.len-60;s+=220){let u=0;while(u<e.n-1&&e.S[u]<s)u++;let ok=true;for(const g of G){if(Math.abs(e.S[Math.min(e.n-1,g.foot)]-e.S[u])<35){ok=false;break}}if(ok)o.push(u)}return o}
/* the bus stops you can see: a shelter (roof, glass back, bench) and a pole with a blue sign on the sidewalk next to each stop (props, built once) */
function trStopProps(){let n=0;for(const e of LG.edges){const B=trBusStops(e);if(!B.length)continue;const r=e.road;
  for(const u of B){const i=e.dir>0?u:r.n-1-u,t=lgTan(e,u),nx=-t[1],nz=t[0],o=r.hw+(r.sw||RSH)*.62,px=r.X[i]+nx*o,pz=r.Z[i]+nz*o,y=r.Y[i]+(r.sw?CURB_H:0);if(otherAsphalt(px,pz,r,r.Y[i],.5))continue;
    const cs=t[0],sn=t[1];pboxR(0,px,pz,1.9,.75,cs,sn,y+2.35,y+2.5,60,90,140,false,1);pboxR(0,px+nx*.68,pz+nz*.68,1.85,.04,cs,sn,y+.15,y+2.35,150,190,210,false,1);
    for(const q of[-1.8,1.8])pboxR(0,px+cs*q,pz+sn*q,.05,.05,cs,sn,y,y+2.35,150,152,158,false,1);pboxR(0,px+nx*.35,pz+nz*.35,1.4,.22,cs,sn,y+.45,y+.55,110,80,60,false,1);
    const sx=px-cs*3.2-nx*.4,sz=pz-sn*3.2-nz*.4;pboxR(0,sx,sz,.05,.05,cs,sn,y,y+2.9,150,152,158,false,1);pboxR(0,sx,sz,.35,.03,-sn,cs,y+2.3,y+2.9,40,90,200,false,1);
    COLO.push(px,pz,1.9,.75,cs,sn,y+2.5);COLC.push(sx,sz,.2,y-.5,y+2.9);n++}}return n}
/* put a car on lane edge e at index u */
function trPlace(e,u,type,col,v,seed){
  let c=null;for(const q of TR.cars)if(!q.alive){c=q;break}if(!c)return null;
  const T=TTYPES[type];c.alive=1;c.state=0;c.kind=0;if(c.dn)c.dn.fill(0);c.dmg=0;c.pf=0;c.rec=0;c.type=type;c.col=col;c.m=T.m;c.hl=T.hl;c.hw=T.hw;c.I=T.m*(T.hl*T.hl+T.hw*T.hw)/3;c.e=e;c.u=u;c.L=null;c.lu=0;c.seed=seed|0;
  trPt(e,u);c.x=_pt.x;c.z=_pt.z;c.y=_pt.y;c.yaw=Math.atan2(_pt.tx,-_pt.tz);c.px=c.x;c.pz=c.z;c.py=c.y;c.pyaw=c.yaw;c.v=v;c.vx=Math.sin(c.yaw)*v;c.vz=-Math.cos(c.yaw)*v;c.om=0;c.pitch=c.roll=0;
  c.acc=0;c.v0f=(.86+trHash(seed,7)*.22)*(T.v0||1);c.A=(1.9+trHash(seed,11)*.9)*(T.m>5000?.6:1);c.T=(1.0+trHash(seed,13)*.7)*(T.beh=='taxi'?.75:1);c.beh=T.beh||'';c.dwell=0;c.odo=0;c.halt=40+trHash(seed,19)*30;c.lastStop=-1e9;c.nh=0;c.off=c.offT=c.offHold=0;c.brake=0;c.wait=0;c.ign=0;c.age=0;c.hitT=0;c.pl=null;c.pjid=-1;c.lcCool=1+trHash(seed,17)*2;c.hn=0;c.hend=0;c.wt=0;c.flags=0;c.nxt=-1;c.stamp=0;c.cm=0;c.siren=0;c.block=0;c.pickJ=-1;c.pickL=null;c.role=0;c.ramCd=0;c.los=null;c.stk=0;
  TR.nAlive++;TR.stat.spawn++;return c}
/* a red or yellow light too close ahead to stop for (the next two junctions: a T just before a light, as where two streets meet an avenue a few metres apart, used to hide it; batch 15) */
function trLightAhead(e,u,v){let g=lgNextJ(e,u);for(let q=0;q<2&&g;q++){if(g.sig&&sigState(g.sig)>0){let su=g.minFu;if(e.closed&&su<u)su+=e.n;const d=trSu(e,su)-trSu(e,u);if(d>-2&&d<v*v/5+12)return true}
    const g2=lgNextJ(e,g.foot+1);if(!g2||g2===g)break;g=g2}return false}
function trSpawn(){
  const rng=TR.rng,P=C;
  for(let tries=0;tries<10;tries++){
    const ang=rng()*TAU,r=Math.sqrt(TR.visMin*TR.visMin*.4+rng()*(TR.rSpawn*TR.rSpawn-TR.visMin*TR.visMin*.4)),x=P.x+Math.cos(ang)*r,z=P.z+Math.sin(ang)*r;
    if(!trProbe(x,z)){continue}
    const ri=TRP.ri,o=LG.ofRoad[ri],di=rng()<.5?0:1,k=Math.min(o[di].length-1,Math.floor(rng()*o[di].length)),e=o[di][k];
    const dens=trDens(x,z,e.cls);if(rng()>dens)continue;
    const r0=ROADS[ri],i=TRP.i+(TRP.t>.5?1:0);let u=e.dir>0?i:r0.n-1-i;if(e.closed)u=((u%e.n)+e.n)%e.n;else if(u<6||u>e.n-8)continue;
    trPt(e,u);const sx=_pt.x,sz=_pt.z;
    const d=Math.hypot(sx-P.x,sz-P.z);if(d<(TR.boot?90:TR.visMin*.7))continue;
    if(!TR.boot&&trSeen(sx,sz))continue;
    /* room: nobody within 18 m (and not under the player) */
    let ok=true;for(const c of TR.cars)if(c.alive&&Math.abs(c.x-sx)<18&&Math.abs(c.z-sz)<18&&Math.hypot(c.x-sx,c.z-sz)<18){ok=false;break}if(!ok)continue;
    const type=trPickType(rng(),rng(),e,x,z),T=TTYPES[type],col=T.col!=null?T.col:Math.floor(rng()*TCOL_FREE),seed=Math.floor(rng()*1e9);
    /* start no faster than the car in front */
    let v=Math.min(e.V[Math.min(u|0,e.n-1)],e.lim)*.85;
    for(const c of TR.cars)if(c.alive&&c.e===e&&!c.L){const dd=(c.u-u)*e.ds;if(dd>0&&dd<45&&c.v<v)v=c.v}
    /* never put a car where it could not stop for a red (or soon red) light ahead */
    if(trLightAhead(e,u,v))continue;
    const c=trPlace(e,u,type,col,v,seed);return c}
  return null}
/* the graphics tier scales how many cars the player sees (a stronger phone gets more) */
function trSetMul(m){TR.max=Math.min(TRN-4,Math.round(TR.base*m))}
function trTarget(){trProbe(C.x,C.z);let cls=1;if(TRP.ri>=0&&TRP.d<60){const r=ROADS[TRP.ri];cls=lgLimit(r)[1]}else TRP.ri=-1;
  const d=trDens(C.x,C.z,cls);return Math.round(lerp(14,TR.max,d))}
/* ---------------- the tick ---------------- */
function trTick(dt){
  if(!TR.on||!LG.ready||!TR.rng)return;
  const t0=TR.prof?performance.now():0;
  TR.t+=dt;const cars=TR.cars;
  trPlayerSync();
  /* spatial hash */
  TR.head.fill(-1);for(let i=0;i<TRN;i++){const c=cars[i];if(!c.alive)continue;const k=trCell(c.x,c.z);c.nxt=TR.head[k];TR.head[k]=i}
  /* each car thinks every other tick (30 Hz, half of the cars on each tick); it steers and moves every tick */
  const par=(TR.tk=(TR.tk|0)+1)&1;
  for(let i=0;i<TRN;i++){const c=cars[i];if(!c.alive)continue;if(c.state==0){if((i&1)===par||c.hn===0){c.think=1;trHorizon(c);trSamples(c,(c.flags&8)!==0&&c.v<1.5)}else c.think=0}   /* a car waiting at a red light is a parked obstacle for the conflict test, not a car about to move into the junction */else if(c.state==3){copHorizon(c);trSamples(c,false)}else trSamples(c,true)}
  for(let i=0;i<TRN;i++){const c=cars[i];if(!c.alive)continue;
    if(c.state==0){if(c.think){trThink(c,dt*2);if((c.flags&2)==0&&c.e)trLaneChange(c,dt*2)}else c.v=Math.max(0,c.v+c.acc*dt);trMove(c,dt);c.vlim=c.hv[0]}
    else if(c.state==3){if(c.kind==2)racerStep(c,dt);else copFree(c,dt)}
    else trWreck(c,dt)}
  trCarCollide();
  /* spawn and despawn */
  TR.target=Math.min(TR.max,trTarget());
  const pyx=Math.sin(C.yaw),pyz=-Math.cos(C.yaw);
  for(let i=0;i<TRN;i++){const c=cars[i];if(!c.alive)continue;const dx=c.x-C.x,dz=c.z-C.z,d=Math.hypot(dx,dz);
    if(c.kind==2&&c.race)continue;   /* racers stay until the race ends */
    if(d>(c.kind==1&&c.cm>0?760:TR.rDespawn)||(d>300&&c.cm<1&&(dx*pyx+dz*pyz)/d<.2)||(c.state==0&&(c.wait>40||c.stopT>45)))trKill(c,0);
    else if(c.state==0&&c.stopT>12&&d>30&&!trSeen(c.x,c.z))trKill(c,2);                  /* a jam out of sight dissolves */
    else if(c.state==0&&c.stopT>22&&d>60)trKill(c,2);                                     /* and a jam that stays for 22 s dissolves even in view, if it is not right next to the player */
    else if(c.state==1&&!c.block&&c.wt>14&&d>35&&!trSeen(c.x,c.z))trKill(c,1)}
  const nSp=TR.boot?10:1;
  for(let s=0;s<nSp&&TR.nAlive<TR.target;s++)trSpawn();
  if(TR.boot&&(TR.nAlive>=TR.target||TR.t>1.5))TR.boot=0;
  copTick(dt);
  if(TR.prof){const ms=performance.now()-t0;TR.ms+=(ms-TR.ms)*.03;TR.stat.msSum+=ms;TR.stat.ticks++;if(ms>TR.stat.msMax)TR.stat.msMax=ms}}
/* the fixed-step world: the player at 120 Hz (collisions with traffic included), traffic at 60 Hz */
function worldStep(dt){SIG.t+=dt;lampTick(dt);if(GAME.lock)gameLockInputs();carStep(dt);crashTick(dt);if(TR.on&&TR.nAlive&&!(C.shield>0))trPlayerCollide();dmgConsume();dmgDents(dt);partsStep(dt);safeStep(dt);gameStep(dt);evTick(dt);spotTick(dt);racerTick(dt);if(!(++TR.sub&1))trTick(dt*2)}
