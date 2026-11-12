// Lane graph in Node: builds every road, then the lane graph, and checks it:
//  - lanes sit where the road shader paints them (lane centre = x0 + (k+.5)*lw from the centre line, right-hand side of travel)
//  - every lane edge has an exit (a link, or a road end that leads somewhere), no NaN
//  - the links (the directed graph between lane edges) form one big strongly connected piece, so a car can never get trapped
//  - lane count and link counts, build time
const fs=require('fs');const R=require('path').join(__dirname,'..','src')+'/';
global.window={addEventListener(){}};global.document={getElementById(){return null}};
const src=['00_util.js','20_map.js','20_organic.js','20_world.js','23_lanes.js'].map(f=>fs.readFileSync(R+f,'utf8').replace(/^'use strict';/,'')).join('\n');
const f=new Function(src+';defineRoads();const t0=Date.now();const st=lgBuild();return {ROADS,LG,st,ms:Date.now()-t0,laneInfo,LANE_W}');
const M=f();const {ROADS,LG,st}=M;let bad=0;
console.log('lane graph: '+st.edges+' lane edges, '+st.links+' links ('+st.crossovers+' median crossovers, '+st.straight+' straight/merge, '+st.right+' right, '+st.left+' left, '+st.uturns+' u-turns), '+st.laneKm.toFixed(0)+' lane-km, '+st.points+' points, '+(st.points*16/1e6).toFixed(1)+' MB, built in '+M.ms+' ms (node)');
console.log('junctions: '+st.touches+' road ends touching a road, '+st.crossings+' crossings');
console.log('road ends near another road but at a different height (a step in the world): '+st.mismatch.length+(st.mismatch.length?'\n   '+st.mismatch.join('\n   '):''));if(st.mismatch.length)bad++;
// 1. lane geometry: the centre of each lane is exactly where laneInfo puts it
let geo=0,nanN=0;
for(const e of LG.edges){const r=e.road,li=M.laneInfo(r.hw,r.style),off=li.x0+(e.k+.5)*li.lw;
  for(const j of[0,(e.n>>1),e.n-1]){const i=e.dir>0?j:e.n-1-j,a=Math.max(0,i-1),b=Math.min(r.n-1,i+1);let tx=r.X[b]-r.X[a],tz=r.Z[b]-r.Z[a];const l=Math.hypot(tx,tz)||1;tx/=l;tz/=l;
    const lat=(e.X[j]-r.X[i])*(-tz)+(e.Z[j]-r.Z[i])*tx;if(Math.abs(lat-off*e.dir)>.6){geo++}}
  for(let j=0;j<e.n;j++)if(!isFinite(e.X[j]+e.Z[j]+e.Y[j]+e.V[j]))nanN++}
for(const l of LG.links)for(let j=0;j<l.n;j++)if(!isFinite(l.X[j]+l.Z[j]+l.Y[j]+l.V[j]))nanN++;
console.log('lane centres off from laneInfo: '+geo+'  NaN points: '+nanN);if(geo||nanN)bad++;
// 2. exits: a lane edge that ends in the middle of nowhere
const noexit=[];for(const e of LG.edges){if(e.closed)continue;let has=false;for(const l of e.out)if(l.foot>=e.n-4){has=true;break}if(!has)noexit.push(e.road.id+' dir'+e.dir+' lane'+e.k)}
console.log('lane edges that end without a link: '+noexit.length+(noexit.length?'  e.g. '+noexit.slice(0,8).join(', '):''));
// 3. strong connectivity (Tarjan, iterative) between ROAD DIRECTIONS (cars change lane inside a road direction, so all its lanes are one node)
const nodeOf=e=>e.ri*2+(e.dir>0?0:1),N=ROADS.length*2,adj=Array.from({length:N},()=>new Set());
for(const l of LG.links)adj[nodeOf(l.from)].add(nodeOf(l.to));const A=adj.map(s=>[...s]);
const has=new Uint8Array(N);for(const e of LG.edges)has[nodeOf(e)]=1;
let idx=0;const ix=new Int32Array(N).fill(-1),low=new Int32Array(N),on=new Uint8Array(N),stack=[],comp=new Int32Array(N).fill(-1);let nc=0;
for(let s=0;s<N;s++){if(!has[s]||ix[s]>=0)continue;const cs=[[s,0]];ix[s]=low[s]=idx++;stack.push(s);on[s]=1;
  while(cs.length){const top=cs[cs.length-1],v=top[0];if(top[1]<A[v].length){const w=A[v][top[1]++];if(ix[w]<0){ix[w]=low[w]=idx++;stack.push(w);on[w]=1;cs.push([w,0])}else if(on[w])low[v]=Math.min(low[v],ix[w])}
    else{if(low[v]==ix[v]){let w;do{w=stack.pop();on[w]=0;comp[w]=nc}while(w!=v);nc++}cs.pop();if(cs.length){const u=cs[cs.length-1][0];low[u]=Math.min(low[u],low[v])}}}}
const sizes=new Map();let total=0;for(let i=0;i<N;i++)if(has[i]){total++;sizes.set(comp[i],(sizes.get(comp[i])||0)+1)}
const big=[...sizes.entries()].sort((a,b)=>b[1]-a[1])[0];
const outside=[];for(let i=0;i<N;i++)if(has[i]&&comp[i]!=big[0])outside.push(ROADS[i>>1].id+(i&1?'-':'+'));
console.log('strongly connected: largest piece has '+big[1]+' of '+total+' road directions ('+(big[1]/total*100).toFixed(1)+'%), '+outside.length+' outside it'+(outside.length?': '+outside.slice(0,40).join(', '):''));
if(big[1]/total<.97)bad++;
// 4. every road (except patches) has lanes; list patches skipped
const skipped=ROADS.filter((r,i)=>!LG.ofRoad[i]).map(r=>r.id);console.log('roads without lanes (patches): '+skipped.join(', '));
// 5. speed limits sanity
const mn=Math.min(...LG.edges.map(e=>Math.min(...e.V))),mx=Math.max(...LG.edges.map(e=>Math.max(...e.V)));console.log('lane speed limit range '+mn.toFixed(1)+' .. '+mx.toFixed(1)+' m/s');
process.exit(bad?1:0);
