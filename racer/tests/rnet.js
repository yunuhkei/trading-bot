// Road network audit (Node, no browser): every road end sits on another road (no gaps, no steps, no roads ending in the air), no unplanned dead ends, no same-level crossing without a junction,
// nothing lying on top of something else, the lane graph is one strongly connected piece, and there is a driveable A* route between every pair of cities (both ways).
const fs=require('fs');const R=require('path').join(__dirname,'..','src')+'/';
global.window={addEventListener(){}};global.document={getElementById(){return null}};
const rd=f=>fs.readFileSync(R+f,'utf8').replace(/^'use strict';/,'');
const nav=rd('65_nav.js'),navSrc=nav.slice(nav.indexOf('class NavHeap'),nav.indexOf('/* the road sample nearest'))+nav.slice(nav.indexOf('/* A*: the chain'),nav.indexOf('/* the turn links of a chain'));
const src=['00_util.js','20_map.js','20_world.js','23_lanes.js'].map(rd).join('\n')+'\n'+navSrc;
const M=new Function(src+';defineRoads();const st=lgBuild();return {ROADS,LG,st,JUNC,PLACES,DEAD_OK,RSH,navAStar,navPolyline,_tan}')();
const {ROADS,LG,JUNC,PLACES,DEAD_OK,RSH}=M;let bad=0;const ck=(ok,msg)=>{console.log((ok?'ok   ':'FAIL ')+msg);if(!ok)bad++};
const proj=(r,x,z)=>{let bd=1e18,o=null;const c=r.closed?r.n:r.n-1;for(let k=0;k<c;k++){const j=(k+1)%r.n,ax=r.X[k],az=r.Z[k],ex=r.X[j]-ax,ez=r.Z[j]-az,l2=ex*ex+ez*ez||1;let t=((x-ax)*ex+(z-az)*ez)/l2;t=t<0?0:t>1?1:t;const d=Math.hypot(x-ax-ex*t,z-az-ez*t);if(d<bd){bd=d;const l=Math.sqrt(l2);o={d,k,j,t,y:r.Y[k]+(r.Y[j]-r.Y[k])*t,hw:r.hw*(r.wk[k]+(r.wk[j]-r.wk[k])*t),tx:ex/l,tz:ez/l,cf:r.cf[k]+(r.cf[j]-r.cf[k])*t}}}return o};
const surf=(r,x,z)=>{const q=proj(r,x,z),lat=(x-(r.X[q.k]+(r.X[q.j]-r.X[q.k])*q.t))*(-q.tz)+(z-(r.Z[q.k]+(r.Z[q.j]-r.Z[q.k])*q.t))*q.tx;return q.y+lat*q.cf};
/* ---- 1. road ends ---- */
const open=ROADS.filter(r=>!r.closed),ends=open.length*2,jset=new Set(JUNC.map(J=>J.r.id+':'+J.e));
const dead=[];for(const r of open)for(const e of[0,1])if(!jset.has(r.id+':'+e))dead.push(r.id+(e?' end':' start'));
const unplanned=dead.filter(d=>!DEAD_OK.includes(d.split(' ')[0]));
ck(unplanned.length==0,'1 every road end sits on another road: '+ends+' ends, '+JUNC.length+' junction ends, planned dead ends: '+(dead.filter(d=>!unplanned.includes(d)).join(', ')||'none')+(unplanned.length?'  UNPLANNED: '+unplanned.join(', '):''));
let gapN=[],stepN=[],angN=[],tiltN=[],worstStep=0,worstTilt=0;const ANG_OK=['bv:0','cr:0','lae:0','psl:0','pss:0','lombard:0','lombard:1','hb:1','lan:0'];
for(const J of JUNC){const r=J.r,ie=J.e?r.n-1:0,q=proj(J.par,r.X[ie],r.Z[ie]),tag=r.id+(J.e?' end':' start')+' on '+J.par.id;
  if(q.d>q.hw-.5&&r.style!=2)gapN.push(tag+' ('+(q.d-q.hw).toFixed(1)+' m short of the asphalt edge)');
  const dy=Math.abs(r.Y[ie]-q.y);worstStep=Math.max(worstStep,dy);if(dy>.16)stepN.push(tag+' '+dy.toFixed(2)+' m');
  if(J.city||r.style==2||J.par.style==2)continue;
  const i2=J.e?r.n-4:3,dx=r.X[ie]-r.X[i2],dz=r.Z[ie]-r.Z[i2],l=Math.hypot(dx,dz)||1,ang=Math.acos(Math.min(1,Math.abs(dx/l*q.tx+dz/l*q.tz)))*57.2958;
  if(ang<60&&!ANG_OK.includes(r.id+':'+J.e))angN.push(tag+' '+ang.toFixed(0)+' deg');
  /* the mouth: across the branch, at the parent's edge and 6 m outside it, the branch's surface and the parent's (or the branch's own centre) must agree: no step where the parent climbs */
  for(let k=0;k<r.n;k++){const i=J.e?r.n-1-k:k,sd=J.e?r.len-r.S[i]:r.S[i];if(sd<q.hw-2)continue;if(sd>q.hw+RSH)break;const t=M._tan(r,i);
    for(const lat of[-r.hw*.85,r.hw*.85]){const x=r.X[i]-t[1]*lat,z=r.Z[i]+t[0]*lat,pq=proj(J.par,x,z);if(pq.d>pq.hw+RSH)continue;const dd=Math.abs((r.Y[i]+lat*r.cf[i]-r.lift)-(surf(J.par,x,z)-J.par.lift));worstTilt=Math.max(worstTilt,dd);if(dd>.2)tiltN.push(tag+' '+dd.toFixed(2)+' m at the mouth corner')}}}
ck(gapN.length==0,'1 no gap between a road end and the road it joins'+(gapN.length?': '+gapN.join('; '):''));
ck(stepN.length==0,'1 no height step at a road end (worst '+worstStep.toFixed(2)+' m, lifts included)'+(stepN.length?': '+stepN.join('; '):''));
ck(angN.length==0,'1 roads join at 60 degrees or more'+(angN.length?': '+angN.join('; '):''));
ck([...new Set(tiltN)].length==0,'1 the mouth of every junction lies on the parent road even where it climbs (worst '+worstTilt.toFixed(2)+' m)'+(tiltN.length?': '+[...new Set(tiltN)].slice(0,6).join('; '):''));
/* ---- 2. crossings in the middle of two roads ---- */
{const segs=[];for(const r of ROADS){const c=r.closed?r.n:r.n-1;for(let i=0;i<c;i++){const j=(i+1)%r.n;segs.push([r.X[i],r.Z[i],r.X[j],r.Z[j],r,i])}}
 const cell=200,grid=new Map();segs.forEach((s,k)=>{for(let cx=Math.floor(Math.min(s[0],s[2])/cell);cx<=Math.floor(Math.max(s[0],s[2])/cell);cx++)for(let cz=Math.floor(Math.min(s[1],s[3])/cell);cz<=Math.floor(Math.max(s[1],s[3])/cell);cz++){const key=cx+','+cz;(grid.get(key)||grid.set(key,[]).get(key)).push(k)}});
 const X=(a,b)=>{const d=(a[2]-a[0])*(b[3]-b[1])-(a[3]-a[1])*(b[2]-b[0]);if(Math.abs(d)<1e-9)return null;const t=((b[0]-a[0])*(b[3]-b[1])-(b[1]-a[1])*(b[2]-b[0]))/d,u=((b[0]-a[0])*(a[3]-a[1])-(b[1]-a[1])*(a[2]-a[0]))/d;return(t>=0&&t<=1&&u>=0&&u<=1)?[a[0]+t*(a[2]-a[0]),a[1]+t*(a[3]-a[1])]:null};
 const seen=new Set(),flat=[],over=[];for(const L of grid.values())for(let a=0;a<L.length;a++)for(let b=a+1;b<L.length;b++){const A=segs[L[a]],B=segs[L[b]];if(A[4]===B[4]||(A[4].city&&B[4].city))continue;const key=Math.min(L[a],L[b])+'-'+Math.max(L[a],L[b]);if(seen.has(key))continue;seen.add(key);const p=X(A,B);if(!p)continue;
   if(JUNC.some(J=>Math.hypot(J.x-p[0],J.z-p[1])<J.rad+30))continue;const dy=Math.abs(A[4].Y[A[5]]-B[4].Y[B[5]]),t=A[4].id+' x '+B[4].id+' at '+Math.round(p[0])+','+Math.round(p[1]);if(dy<6)flat.push(t+' ('+dy.toFixed(1)+' m apart)');else if(!over.some(o=>o.startsWith(A[4].id+' x '+B[4].id)))over.push(t+' ('+dy.toFixed(1)+' m)')}
 ck(flat.length==0,'2 no two roads cross at the same level away from a junction'+(flat.length?': '+flat.join('; '):'')+'; overpasses: '+(over.join('; ')||'none'))}
/* ---- 3. roads lying on top of each other (outside the junction boxes) ---- */
{const cell=40,grid=new Map();ROADS.forEach((r,ri)=>{for(let i=0;i<r.n;i++){const k=Math.floor(r.X[i]/cell)+','+Math.floor(r.Z[i]/cell);(grid.get(k)||grid.set(k,[]).get(k)).push([ri,i])}});
 const ov=new Map();ROADS.forEach((A,ai)=>{for(let i=0;i<A.n;i++){const x=A.X[i],z=A.Z[i];if(JUNC.some(J=>Math.hypot(J.x-x,J.z-z)<J.rad+24))continue;const cx=Math.floor(x/cell),cz=Math.floor(z/cell),hit=new Set();
   for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const L=grid.get((cx+a)+','+(cz+b));if(L)for(const[bi,j]of L){if(bi===ai)continue;const B=ROADS[bi];if(A.city&&B.city)continue;if(Math.hypot(x-B.X[j],z-B.Z[j])<(A.hw+B.hw)*.7&&Math.abs(A.Y[i]-B.Y[j])<3)hit.add(bi)}}
   for(const bi of hit){const key=Math.min(ai,bi)+'-'+Math.max(ai,bi),e=ov.get(key)||{n:0,a:A.id,b:ROADS[bi].id,at:[Math.round(x),Math.round(z)]};e.n++;ov.set(key,e)}}});
 const list=[...ov.values()].filter(e=>e.n*4>40&&!(e.a=='lombard'||e.b=='lombard'));
 ck(list.length==0,'3 no road lies on top of another for more than 40 m outside a junction'+(list.length?': '+list.map(e=>e.a+' on '+e.b+' '+e.n*4+' m near '+e.at).join('; '):''))}
/* ---- 4. the lane graph ---- */
{const st=M.st;let nan=0;for(const e of LG.edges)for(let j=0;j<e.n;j++)if(!isFinite(e.X[j]+e.Z[j]+e.Y[j]+e.V[j]))nan++;for(const l of LG.links)for(let j=0;j<l.n;j++)if(!isFinite(l.X[j]+l.Z[j]+l.Y[j]+l.V[j]))nan++;
 const noexit=[];for(const e of LG.edges){if(e.closed)continue;let has=false;for(const l of e.out)if(l.foot>=e.n-4){has=true;break}if(!has)noexit.push(e.road.id+(e.dir>0?'+':'-')+e.k)}
 ck(nan==0&&noexit.length==0,'4 lane graph: '+st.edges+' lane edges, '+st.links+' turns ('+st.left+' left, '+st.right+' right, '+st.straight+' straight, '+st.crossovers+' median crossovers), every lane that reaches a road end has a way on'+(noexit.length?'  WITHOUT: '+noexit.join(', '):''));
 ck(st.uturns==0,'4 no lane has to turn round at a dead end ('+st.uturns+' u-turns made for dead ends)');
 const nodeOf=e=>e.ri*2+(e.dir>0?0:1),N=ROADS.length*2,adj=Array.from({length:N},()=>new Set()),radj=Array.from({length:N},()=>new Set()),has=new Uint8Array(N);for(const e of LG.edges)has[nodeOf(e)]=1;
 for(const l of LG.links){adj[nodeOf(l.from)].add(nodeOf(l.to));radj[nodeOf(l.to)].add(nodeOf(l.from))}
 const reach=(A,s)=>{const seen=new Uint8Array(N),q=[s];seen[s]=1;while(q.length){const v=q.pop();for(const w of A[v])if(!seen[w]){seen[w]=1;q.push(w)}}return seen};
 let s0=0;while(!has[s0])s0++;const f=reach(adj,s0),b=reach(radj,s0);const out=[];let tot=0;for(let i=0;i<N;i++)if(has[i]){tot++;if(!f[i]||!b[i])out.push(ROADS[i>>1].id+(i&1?'-':'+'))}
 ck(out.length==0,'4 the lanes are one strongly connected piece: '+(tot-out.length)+' of '+tot+' road directions'+(out.length?'  OUTSIDE: '+out.slice(0,20).join(', '):''))}
/* ---- 5. a route between every pair of cities ---- */
{const P=PLACES.map(p=>{const r=ROADS.find(q=>q.id==p.road);return r?{name:p.name,r,i:Math.floor(r.n/2)}:null});ck(P.every(Boolean),'5 every place has its boulevard: '+PLACES.map(p=>p.name).join(', '));
 let n=0,fail=[],worst=0,wn='',maxGap=0,t0=Date.now(),maxIt=0;
 for(const a of P)for(const b of P){if(!a||!b||a===b)continue;n++;const e0=LG.ofRoad[a.r.ri][0][0],goal={ri:b.r.ri,i:b.i,x:b.r.X[b.i],z:b.r.Z[b.i]},ch=M.navAStar(e0,a.i,goal,60000);
   if(!ch){fail.push(a.name+' -> '+b.name);continue}const pl=M.navPolyline(ch),crow=Math.hypot(a.r.X[a.i]-goal.x,a.r.Z[a.i]-goal.z),ratio=pl.len/(crow+300);if(ratio>worst){worst=ratio;wn=a.name+' -> '+b.name+' '+Math.round(pl.len)+' m for '+Math.round(crow)+' m'}
   for(let k=1;k<pl.n;k++){const g=Math.hypot(pl.pts[k*3]-pl.pts[k*3-3],pl.pts[k*3+2]-pl.pts[k*3-1]);if(g>maxGap)maxGap=g}}
 ck(fail.length==0,'5 A* finds a route between every pair of the '+P.length+' places, both ways ('+n+' routes, '+((Date.now()-t0)/n).toFixed(1)+' ms each)'+(fail.length?'  NONE: '+fail.join('; '):''));
 ck(worst<2.6,'5 no route is a silly detour (worst: '+wn+')');ck(maxGap<14,'5 every route is one continuous line (biggest step between two points '+maxGap.toFixed(1)+' m)')}
console.log(bad?bad+' FAILED':'all passed');process.exit(bad?1:0);
