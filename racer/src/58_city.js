'use strict';
/* (batch 54) THINGS TO DO IN TOWN, and out east.
   RAMPS: two or three striped steel kickers on straight streets of every city and town, and a few on the open desert highways of the east: drive up one fast and you fly
   (they are part of the ground: groundAt adds their height, so your car, the racers and the traffic all ride them; the lip drops away, and your car's take-off rule does the rest).
   Each is a JUMP spot (your longest jump off it is kept and paid, as on the jump hills).
   HIDDEN TOKENS: two glowing tokens tucked into the side streets of every town (36 in all), not on the map until found: each pays, a few are easter eggs with a story,
   and finding them all pays a big bonus. Found tokens are kept between games. */
const RAMPS=[],RAMPG=new Map(),RAMP_CELL=64,TOKENS={list:[],got:{},key:'racer.tokens'};
const rampKey=(gx,gz)=>(gx+512)*4096+(gz+512);
/* the height a ramp adds at (x,z) (0 where there is none) */
function rampAt(x,z){if(!RAMPS.length)return 0;const L=RAMPG.get(rampKey(Math.floor(x/RAMP_CELL),Math.floor(z/RAMP_CELL)));if(!L)return 0;let h=0;
  for(const p of L){const dx=x-p.x,dz=z-p.z,u=dx*p.fx+dz*p.fz,v=dx*p.rx+dz*p.rz;if(u<0||u>p.L||Math.abs(v)>p.W/2)continue;
    const k=Math.min(1,(p.W/2-Math.abs(v))/p.side),y=p.H*Math.pow(u/p.L,1.25)*k;if(y>h)h=y}
  return h}
function rampAdd(x,z,fx,fz,o){const p=Object.assign({x,z,fx,fz,rx:-fz,rz:fx,L:13,H:2.3,W:6.2,side:1.4},o||{});RAMPS.push(p);
  const c0x=Math.floor((x-20)/RAMP_CELL),c1x=Math.floor((x+20)/RAMP_CELL),c0z=Math.floor((z-20)/RAMP_CELL),c1z=Math.floor((z+20)/RAMP_CELL);
  for(let a=c0x;a<=c1x;a++)for(let b=c0z;b<=c1z;b++){const k=rampKey(a,b);let L=RAMPG.get(k);if(!L){L=[];RAMPG.set(k,L)}L.push(p)}return p}
/* a straight, junction-free stretch of road around sample i (no bridge, flat enough) */
function cityStraight(r,i,half){if(i<half+2||i>r.n-half-3)return false;const h=k=>{const t=_tan(r,k);return Math.atan2(t[0],t[1])};
  if(Math.abs(angd(h(i-half),h(i)))>.08||Math.abs(angd(h(i+half),h(i)))>.08)return false;for(let k=i-half;k<=i+half;k++)if(r.br&&r.br[k])return false;
  if(Math.abs(r.Y[i+half]-r.Y[i-half])>3)return false;const x=r.X[i],z=r.Z[i];if(JUNC.some(J=>Math.hypot(J.x-x,J.z-z)<45))return false;return true}
const inPlace=(p,x,z)=>{const b=p.box;return x>b.x0&&x<b.x1&&z>b.z0&&z<b.z1};
/* where they go (deterministic: the same in every game) */
function cityInit(){RAMPS.length=0;RAMPG.clear();TOKENS.list.length=0;const rnd=mulberry(77731);
  for(const P of PLACES){const roads=ROADS.filter(r=>{for(let i=0;i<r.n;i+=3)if(inPlace(P,r.X[i],r.Z[i]))return true;return false});
    /* ramps: on the longer straight streets of the town, at least 120 m apart */
    let nr=0;const want=P.name=='Downtown'||P.name=='Las Vegas'||P.name=='The Valley'?3:2;
    for(const r of roads.sort((a,b)=>b.hw-a.hw)){if(nr>=want)break;const st=Math.max(1,Math.round(25/r.ds));for(let tries=0;tries<12&&nr<want;tries++){const i=st+2+Math.floor(rnd()*(r.n-2*st-4));
      if(!inPlace(P,r.X[i],r.Z[i])||!cityStraight(r,i,st))continue;const x=r.X[i],z=r.Z[i];if(RAMPS.some(q=>Math.hypot(q.x-x,q.z-z)<120))continue;
      const t=_tan(r,i),l=Math.hypot(t[0],t[1])||1,sg=rnd()<.5?1:-1,fx=t[0]/l*sg,fz=t[1]/l*sg;rampAdd(x-fx*6.5,z-fz*6.5,fx,fz,{W:Math.min(6.2,r.hw*1.2),town:P.name});nr++}}
    /* tokens: on the narrower streets, off to one side */
    let nt=0;for(let tries=0;tries<60&&nt<2;tries++){const r=roads[Math.floor(rnd()*roads.length)];if(!r)break;const i=2+Math.floor(rnd()*(r.n-4));const x0=r.X[i],z0=r.Z[i];if(!inPlace(P,x0,z0))continue;
      const t=_tan(r,i),l=Math.hypot(t[0],t[1])||1,sd=rnd()<.5?1:-1,o=r.hw*.6,x=x0-t[1]/l*o*sd,z=z0+t[0]/l*o*sd;if(TOKENS.list.some(q=>Math.hypot(q.x-x,q.z-z)<150))continue;
      TOKENS.list.push({id:'tk_'+P.name.replace(/\W/g,'')+'_'+nt,town:P.name,x,z,y:r.Y[i]+1.3,egg:null});nt++}}
  /* desert kickers on the straight highways of the east */
  let nk=0;for(const r of ROADS){if(r.city||nk>=8)continue;const st=Math.round(40/r.ds);for(let i=st+2;i<r.n-st-3&&nk<8;i+=Math.round(260/r.ds)){const x=r.X[i],z=r.Z[i];if(x<2300)continue;
      if(!cityStraight(r,i,st)||RAMPS.some(q=>Math.hypot(q.x-x,q.z-z)<500))continue;const t=_tan(r,i),l=Math.hypot(t[0],t[1])||1,fx=t[0]/l,fz=t[1]/l,lane=r.hw*.45;
      rampAdd(x-fx*7+(-fz)*lane,z-fz*7+fx*lane,fx,fz,{L:15,H:2.6,W:5.4,desert:1});nk++}}
  /* the easter eggs (each a token with its own message and prize) */
  const EGG={'Las Vegas':['JACKPOT! The slot machine in the trunk paid out',25000],'Big Pines':['A large hairy figure waved at you from the trees',5000],'Harbor':['A message in a bottle: "the finish line is a state of mind"',5000],
    'Mojave Works':['You found the test track lunchbox. Still warm.',7500],'Tahoe':['Someone left a snowboard in July',5000],'Downtown':['A cable car ticket from 1962',5000],'Bishop':['The mountain says: brake later',5000],'Barstow':['A pie from the diner, still on the windowsill',5000]};
  for(const tk of TOKENS.list)if(EGG[tk.town]&&tk.id.endsWith('_0'))tk.egg=EGG[tk.town];
  try{TOKENS.got=JSON.parse(localStorage.getItem(TOKENS.key)||'{}')||{}}catch(e){TOKENS.got={}}
}
/* the ramps are jump spots (from the end of spotInit, which builds the spot list) */
function citySpots(){for(const p of RAMPS)SPOTS.list.push({type:'jump',id:'sp_ramp_'+Math.round(p.x)+'_'+Math.round(p.z),name:p.desert?'Desert kicker':'Ramp',x:p.x+p.fx*p.L,z:p.z+p.fz*p.L,y:groundAt(p.x,p.z,99),r:22})}
/* the ramp meshes (from buildFurniture): a striped steel deck, side cheeks and a dark lip face */
function cityBuild(){for(const p of RAMPS){const m=pmb(p.x,p.z,0,120),g=k=>groundAt(p.x+p.fx*k,p.z+p.fz*k,99),y0=g(0),N=8;
    const pt=(u,v,h)=>[p.x+p.fx*u+p.rx*v,y0+(g(u)-y0)*0+h+.02,p.z+p.fz*u+p.rz*v];
    const hu=u=>p.H*Math.pow(u/p.L,1.25);
    for(let k=0;k<N;k++){const u0=p.L*k/N,u1=p.L*(k+1)/N,h0=hu(u0),h1=hu(u1),yel=(k&1)==0,c=yel?[235,190,40]:[40,40,44],w=p.W/2-p.side*.15;
      const a=pt(u0,-w,h0),b=pt(u0,w,h0),cc=pt(u1,w,h1),d=pt(u1,-w,h1),n=[0,1,0];
      const v=q=>m.v(q[0],q[1],q[2],-p.fx*.2,.98,-p.fz*.2,c[0],c[1],c[2],.03,.03,0);m.q(v(a),v(b),v(cc),v(d));
      for(const sd of[-1,1]){const o=pt(u0,sd*p.W/2,0),i0=pt(u0,sd*w,h0),i1=pt(u1,sd*w,h1),o1=pt(u1,sd*p.W/2,0),vv=q=>m.v(q[0],q[1],q[2],p.rx*sd,.5,p.rz*sd,90,92,96,.03,.03,0);if(sd<0)m.q(vv(o),vv(i0),vv(i1),vv(o1));else m.q(vv(o1),vv(i1),vv(i0),vv(o))}}
    {const w=p.W/2-p.side*.15,a=pt(p.L,-w,p.H),b=pt(p.L,w,p.H),c2=pt(p.L,w,0),d=pt(p.L,-w,0),v=q=>m.v(q[0],q[1],q[2],p.fx,0,p.fz,30,30,34,.03,.03,0);m.q(v(a),v(b),v(c2),v(d))}}}
/* picking tokens up (every frame) */
function cityTick(dt){if(GAME.state||TUM.on||!TOKENS.list.length)return;for(const t of TOKENS.list){if(TOKENS.got[t.id])continue;if(Math.abs(C.x-t.x)>5||Math.abs(C.z-t.z)>5||Math.abs(C.y+.8-t.y)>3)continue;
    TOKENS.got[t.id]=1;try{localStorage.setItem(TOKENS.key,JSON.stringify(TOKENS.got))}catch(e){}const n=Object.keys(TOKENS.got).length,N=TOKENS.list.length;
    const pay=t.egg?t.egg[1]:1500;ECON.add(pay);if(typeof evBeep=='function')evBeep(1200,.12);
    safeToast((t.egg?t.egg[0]:'HIDDEN TOKEN')+'  +'+evMoney(pay)+'   ('+n+' / '+N+')',3.2,1);
    if(n==N){ECON.add(100000);setTimeout(()=>safeToast('EVERY TOKEN FOUND  +$100,000',4,1),3300)}}}
/* the tokens glow and spin (from the effects pass) */
function cityFx(sprite,quad,time){for(const t of TOKENS.list){if(TOKENS.got[t.id])continue;const d=Math.hypot(t.x-C.x,t.z-C.z);if(d>260)continue;const al=Math.min(1,(260-d)/80),bob=Math.sin(time*2+t.x)*.25;
    sprite(t.x,t.y+bob,t.z,1.6,.3,1,.9,.75*al);sprite(t.x,t.y+bob,t.z,.6,1,1,1,.9*al);
    const a=time*2.4+t.z,c=Math.cos(a)*.9,s=Math.sin(a)*.9,y=t.y+bob;quad(t.x-c,y-.9,t.z-s,t.x+c,y-.9,t.z+s,t.x+c,y+.9,t.z+s,t.x-c,y+.9,t.z-s,.4,1,.95,.55*al)}}
