'use strict';
/* (batch 54) THINGS TO DO IN TOWN, and out east.
   RAMPS are never on the road. They are SECRET WAYS: a natural mound of earth (a kicker) hidden just off the road on the inside of a bend; leave the road, hit it flat out and you fly
   across the corner and land back on the road further on (a shortcut), or STUNT JUMPS where the ground falls away beside the road. They are part of the ground (groundAt adds
   their height), and your car's own take-off rule does the flying. Every path is checked once the world is built (nothing solid, no water, no hill in the way); a ramp whose path
   is blocked is taken away again. Each is a JUMP spot, hidden from the map until you have jumped it once.
   HIDDEN TOKENS: two glowing tokens tucked into the side streets of every town (36 in all), not on the map until found: each pays, a few are easter eggs with a story,
   and finding them all pays a big bonus. Found tokens are kept between games. */
const RAMPS=[],RAMPG=new Map(),RAMP_CELL=64,TOKENS={list:[],got:{},key:'racer.tokens'};
const rampKey=(gx,gz)=>(gx+512)*4096+(gz+512);
/* the height a ramp adds at (x,z) (0 where there is none) */
let _rampOff=0;const RAMPDBG={cand:0,cuts:0,geo:0,why:{}};
/* (batch 54) a NATURAL jump: a mound of earth. It rises in a curve (a kicker) over L, falls away steeply over B behind the crest (that is what throws you), and its sides roll
   smoothly into the ground over 'side' metres, so it looks like part of the land, not a ramp */
function rampProf(p,u,v){if(u<0||u>p.L+p.B)return 0;const av=Math.abs(v);if(av>p.W/2)return 0;const t=Math.min(1,(p.W/2-av)/p.side),k=t*t*(3-2*t);
  const h=u<=p.L?p.H*Math.pow(u/p.L,1.4):p.H*Math.pow(1-(u-p.L)/p.B,.7);return h*k}
function rampAt(x,z){if(!RAMPS.length||_rampOff)return 0;const L=RAMPG.get(rampKey(Math.floor(x/RAMP_CELL),Math.floor(z/RAMP_CELL)));if(!L)return 0;let h=0;
  for(const p of L){const dx=x-p.x,dz=z-p.z,y=rampProf(p,dx*p.fx+dz*p.fz,dx*p.rx+dz*p.rz);if(y>h)h=y}
  return h}
function rampAdd(x,z,fx,fz,o){const p=Object.assign({x,z,fx,fz,rx:-fz,rz:fx,L:12,B:4.5,H:2.4,W:8.4,side:2.8},o||{});RAMPS.push(p);rampGrid(p);return p}
/* a straight, junction-free stretch of road around sample i (no bridge, flat enough) */
function cityStraight(r,i,half){if(i<half+2||i>r.n-half-3)return false;const h=k=>{const t=_tan(r,k);return Math.atan2(t[0],t[1])};
  if(Math.abs(angd(h(i-half),h(i)))>.08||Math.abs(angd(h(i+half),h(i)))>.08)return false;for(let k=i-half;k<=i+half;k++)if(r.br&&r.br[k])return false;
  if(Math.abs(r.Y[i+half]-r.Y[i-half])>3)return false;const x=r.X[i],z=r.Z[i];if(JUNC.some(J=>Math.hypot(J.x-x,J.z-z)<45))return false;return true}
const inPlace=(p,x,z)=>{const b=p.box;return x>b.x0&&x<b.x1&&z>b.z0&&z<b.z1};
/* where they go (deterministic: the same in every game) */
function cityInit(){RAMPS.length=0;RAMPG.clear();TOKENS.list.length=0;const rnd=mulberry(77731);
  for(const P of PLACES){const roads=ROADS.filter(r=>{for(let i=0;i<r.n;i+=3)if(inPlace(P,r.X[i],r.Z[i]))return true;return false});
    /* tokens: on the narrower streets, off to one side */
    let nt=0;for(let tries=0;tries<60&&nt<2;tries++){const r=roads[Math.floor(rnd()*roads.length)];if(!r)break;const i=2+Math.floor(rnd()*(r.n-4));const x0=r.X[i],z0=r.Z[i];if(!inPlace(P,x0,z0))continue;
      const t=_tan(r,i),l=Math.hypot(t[0],t[1])||1,sd=rnd()<.5?1:-1,o=r.hw*.6,x=x0-t[1]/l*o*sd,z=z0+t[0]/l*o*sd;if(TOKENS.list.some(q=>Math.hypot(q.x-x,q.z-z)<150))continue;
      TOKENS.list.push({id:'tk_'+P.name.replace(/\W/g,'')+'_'+nt,town:P.name,x,z,y:r.Y[i]+1.3,egg:null});nt++}}
  rampsPlace();
  /* the easter eggs (each a token with its own message and prize) */
  const EGG={'Las Vegas':['JACKPOT! The slot machine in the trunk paid out',25000],'Big Pines':['A large hairy figure waved at you from the trees',5000],'Harbor':['A message in a bottle: "the finish line is a state of mind"',5000],
    'Mojave Works':['You found the test track lunchbox. Still warm.',7500],'Tahoe':['Someone left a snowboard in July',5000],'Downtown':['A cable car ticket from 1962',5000],'Bishop':['The mountain says: brake later',5000],'Barstow':['A pie from the diner, still on the windowsill',5000]};
  for(const tk of TOKENS.list)if(EGG[tk.town]&&tk.id.endsWith('_0'))tk.egg=EGG[tk.town];
  try{TOKENS.got=JSON.parse(localStorage.getItem(TOKENS.key)||'{}')||{}}catch(e){TOKENS.got={}}
}
/* the ramps are jump spots (from the end of spotInit, which builds the spot list) */
function citySpots(){for(const p of RAMPS)SPOTS.list.push({type:'jump',secret:1,id:'sp_ramp_'+Math.round(p.x)+'_'+Math.round(p.z),name:p.kind=='cut'?'Secret shortcut':'Stunt jump',x:p.x+p.fx*p.L,z:p.z+p.fz*p.L,y:rampBaseG(p.x,p.z),r:24})}

/* SHORTCUTS: from a point just off the road on the inside of a bend, a straight line across the bend to the road further on; the road round must be at least 1.45 x longer.
   STUNT JUMPS: off the road's edge where the ground drops 6 m or more within 70 m. Candidates are picked best first, at least 300 m apart. */
const rampBaseG=(x,z)=>{_rampOff=1;const g=groundAt(x,z,999);_rampOff=0;return g};
function rampsPlace(){const C2=[],rd=(r,i)=>({x:r.X[i],z:r.Z[i],t:_tan(r,i)});
  for(const r of ROADS){if(r.closed&&r.n<20)continue;const st=Math.max(1,Math.round(12/r.ds));
    for(let i=st*2;i<r.n-st*2;i+=st){const a=rd(r,i),tl=Math.hypot(a.t[0],a.t[1])||1,tx=a.t[0]/tl,tz=a.t[1]/tl;if(r.br&&r.br[i])continue;
      for(let jj=5;jj<=40;jj+=3){const j=i+jj*st;if(j>=r.n-2)break;const b=rd(r,j),S=r.S[j]-r.S[i];
        /* the inside of the bend: the side the far point is on */const side=Math.sign((b.x-a.x)*(-tz)+(b.z-a.z)*tx);if(!side)continue;
        const off=r.hw+(typeof RSH!='undefined'?RSH:1.5)+2.2,ax=a.x-tz*side*off,az=a.z+tx*side*off,dx=b.x-ax,dz=b.z-az,D=Math.hypot(dx,dz);if(D<30||D>60)continue;if(S<D*1.2)continue;
        const fx=dx/D,fz=dz/D;if(fx*tx+fz*tz<.35)continue;   /* you can steer onto it: at most ~70 degrees off the road */
        C2.push({kind:'cut',ax,az,fx,fz,bx:b.x,bz:b.z,D,score:S/D,road:r,i,j})}}
    /* stunt jumps: off the outer edge of a straight-ish stretch, where the ground falls away */
    if(!r.city)for(let i=st*3;i<r.n-st*3;i+=st*4){const a=rd(r,i),tl=Math.hypot(a.t[0],a.t[1])||1,tx=a.t[0]/tl,tz=a.t[1]/tl;if(r.br&&r.br[i])continue;
      for(const side of[-1,1]){const off=r.hw+(typeof RSH!='undefined'?RSH:1.5)+2.2,ax=a.x-tz*side*off,az=a.z+tx*side*off,ang=.55,fx=tx*Math.cos(ang)-tz*side*Math.sin(ang),fz=tz*Math.cos(ang)+tx*side*Math.sin(ang);
        const g0=terrainH(ax,az),g1=terrainH(ax+fx*55,az+fz*55);if(g0-g1<6||g1<.5)continue;C2.push({kind:'stunt',ax,az,fx,fz,bx:ax+fx*55,bz:az+fz*55,D:55,score:1+(g0-g1)/10,road:r,i})}}}
  C2.sort((p,q)=>q.score-p.score);let nc=0,ns=0;RAMPDBG.cand=C2.length;RAMPDBG.cuts=C2.filter(c=>c.kind=='cut').length;
  for(const c of C2){if(c.kind=='cut'?nc>=160:ns>=50)continue;if(RAMPS.some(q=>Math.hypot(q.x-c.ax,q.z-c.az)<150))continue;if(!rampPathOk(c,false)){RAMPDBG.geo++;continue}
    rampAdd(c.ax,c.az,c.fx,c.fz,{kind:c.kind,bx:c.bx,bz:c.bz,D:c.D,score:c.score+(c.kind=='cut'?1:0)});if(c.kind=='cut')nc++;else ns++}}
/* is the way clear? (geometry only; with solid things too once the world exists) */
const rbad=w=>{RAMPDBG.why[w]=(RAMPDBG.why[w]||0)+1;return false};
function rampPathOk(c,solid){const L=12,H=2.4,gA=rampBaseG(c.ax+c.fx*L,c.az+c.fz*L),lip=gA+H;
  for(let u=-2;u<=L+5;u+=1.5)for(const v of[-4,0,4]){const x=c.ax+c.fx*u-c.fz*v,z=c.az+c.fz*u+c.fx*v;if(roadAt(x,z,99)&&Math.abs(RQ.lat)<RQ.hw+.5)return rbad('footRoad');if(terrainH(x,z)<.3)return rbad('footWater');if(solid&&trStatic(x,z,1.4,rampBaseG(x,z)))return rbad('footSolid')}
  const end=c.kind=='cut'?c.D-4:c.D;for(let u=L+1;u<end;u+=2){const x=c.ax+c.fx*u,z=c.az+c.fz*u,k=(u-L)/(c.D-L),gt=terrainH(x,z);
    if(gt<.3)return rbad('pathWater');if(gt>lip-.6+k*(c.kind=='cut'?Math.max(0,rampBaseG(c.bx,c.bz)-lip+.6):0))return rbad('pathHill');
    if(c.kind=='cut'&&u<c.D-8&&roadAt(x,z,99)&&Math.abs(RQ.lat)<RQ.hw+.5)return rbad('pathRoad');if(solid&&trStatic(x,z,1.6,rampBaseG(x,z)))return rbad('pathSolid')}
  if(c.kind=='cut'){const gB=rampBaseG(c.bx,c.bz);if(gB>lip+1||gB<lip-9)return rbad('landH')}
  return true}
/* after the colliders exist (buildQueries): take away every ramp whose way is blocked */
function rampValidate(){for(const p of RAMPS.slice()){if(rampPathOk({ax:p.x,az:p.z,fx:p.fx,fz:p.fz,bx:p.bx,bz:p.bz,D:p.D,kind:p.kind},true))continue;p.dead=1;rampHide(p)}
  /* then the best of the survivors, at least 200 m apart (shortcuts first) */{const keep=[];for(const p of RAMPS.filter(q=>!q.dead).sort((a,b)=>b.score-a.score)){if(keep.some(q=>Math.hypot(q.x-p.x,q.z-p.z)<200)){p.dead=1;rampHide(p)}else keep.push(p)}}
  for(let k=RAMPS.length-1;k>=0;k--)if(RAMPS[k].dead)RAMPS.splice(k,1);RAMPG.clear();for(const p of RAMPS)rampGrid(p)}
function rampGrid(p){const c0x=Math.floor((p.x-20)/RAMP_CELL),c1x=Math.floor((p.x+20)/RAMP_CELL),c0z=Math.floor((p.z-20)/RAMP_CELL),c1z=Math.floor((p.z+20)/RAMP_CELL);
  for(let a=c0x;a<=c1x;a++)for(let b=c0z;b<=c1z;b++){const k=rampKey(a,b);let L=RAMPG.get(k);if(!L){L=[];RAMPG.set(k,L)}L.push(p)}}
function rampFinish(){for(const p of RAMPS)for(const q of(p.pieces||[])){if(!q.m)continue;q.pi=q.m.outIdx;q.cpu=q.m.f.slice(q.a*7,q.b*7);q.m=null}}
function rampHide(p){const gl=G.gl;if(!gl||!R.props)return;for(const q of(p.pieces||[])){const P=R.props[q.pi];if(!P||!q.cpu)continue;const d=q.cpu.slice(),x=d[0],y=d[1]-5,z=d[2];for(let o=0;o<d.length;o+=7){d[o]=x;d[o+1]=y;d[o+2]=z}gl.bindBuffer(gl.ARRAY_BUFFER,P.vb);gl.bufferSubData(gl.ARRAY_BUFFER,q.a*28,d)}}
/* the ramp meshes (from buildFurniture): a striped steel deck, side cheeks and a dark lip face */
/* the mounds' meshes (from buildFurniture): a smooth grid of earth on the ground under it, coloured like the land round it (sand out in the desert, dirt fading into grass elsewhere) */
function cityBuild(){for(const p of RAMPS){const m=pmb(p.x,p.z,0,260),a0=m.n;p.pieces=[];const NU=16,NV=8,UL=p.L+p.B;
    const dry=Math.min(1,sstep(1300,2300,p.z)*.8+sstep(500,1800,p.x)*.15+sstep(2600,3800,p.x)*.9),hs=(a,b)=>{const v=Math.sin(a*12.9898+b*78.233+p.x)*43758.5453;return v-Math.floor(v)};
    const P=(i,j)=>{const u=i<=12?p.L*i/12:p.L+p.B*(i-12)/(NU-12),v=-p.W/2+p.W*j/NV,x=p.x+p.fx*u+p.rx*v,z=p.z+p.fz*u+p.rz*v,h=rampProf(p,u,v);return{x,z,u,v,h,y:rampBaseG(x,z)+h+.03}};
    const G=[];for(let i=0;i<=NU;i++){G.push([]);for(let j=0;j<=NV;j++)G[i].push(P(i,j))}
    const id=[];for(let i=0;i<=NU;i++){id.push([]);for(let j=0;j<=NV;j++){const q=G[i][j],a=G[Math.max(0,i-1)][j],b=G[Math.min(NU,i+1)][j],c=G[i][Math.max(0,j-1)],d=G[i][Math.min(NV,j+1)];
        const du=Math.max(.1,b.u-a.u),dv=Math.max(.1,d.v-c.v),gu=(b.y-a.y)/du,gv=(d.y-c.y)/dv,nl=Math.hypot(gu,gv,1),nU=-gu/nl,nV=-gv/nl,ny=1/nl;
        const nx=p.fx*nU+p.rx*nV,nz=p.fz*nU+p.rz*nV,top=Math.min(1,q.h/p.H),n=hs(i,j)*.18-.09,edge=1-Math.min(1,q.h/.35);
        const dirt=[118+n*80,96+n*60,68+n*40],grass=[82+n*60,94+n*60,56+n*40],sand=[176+n*60,152+n*50,110+n*40],ground=dry>.55?sand:grass,body=dry>.55?[160+n*60,132+n*50,92+n*40]:dirt;
        const k=Math.max(edge,dry>.55?0:.25*(1-top)),col=[0,1,2].map(e=>Math.max(0,Math.min(255,body[e]*(1-k)+ground[e]*k)));
        id[i].push(m.v(q.x,q.y,q.z,nx,ny,nz,col[0],col[1],col[2],.03,.03,0))}}
    for(let i=0;i<NU;i++)for(let j=0;j<NV;j++)m.q(id[i][j],id[i][j+1],id[i+1][j+1],id[i+1][j]);
    p.pieces.push({m,a:a0,b:m.n})}}
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
