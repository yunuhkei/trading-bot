// Network sanity: (1) roads lying on top of each other along their length, (2) dead ends, (3) disconnected pieces.
const fs=require('fs');const R=require('path').join(__dirname,'..','src')+'/';
global.window={addEventListener(){}};global.document={getElementById(){return null}};
const src=['00_util.js','20_map.js','20_world.js'].map(f=>fs.readFileSync(R+f,'utf8').replace(/^'use strict';/,'')).join('\n');
const f=new Function(src+';defineRoads();return {ROADS,CITY,GRIDS}');
const M=f();const roads=M.ROADS;const RSH=2.2;
// samples grid
const cell=40,grid=new Map();roads.forEach((r,ri)=>{for(let i=0;i<r.n;i++){const k=Math.floor(r.X[i]/cell)+','+Math.floor(r.Z[i]/cell);(grid.get(k)||grid.set(k,[]).get(k)).push([ri,i])}});
const near=(x,z,rad,fn)=>{const c=Math.ceil(rad/cell);const cx=Math.floor(x/cell),cz=Math.floor(z/cell);for(let a=-c;a<=c;a++)for(let b=-c;b<=c;b++){const L=grid.get((cx+a)+','+(cz+b));if(L)for(const [ri,i] of L)fn(ri,i)}};
// 1. overlaps
const ov=new Map();
roads.forEach((A,ai)=>{for(let i=0;i<A.n;i+=1){const ha=A.hw*A.wk[i];let hit=new Set();near(A.X[i],A.Z[i],30,(bi,j)=>{if(bi===ai)return;const B=roads[bi];const d=Math.hypot(A.X[i]-B.X[j],A.Z[i]-B.Z[j]);if(d<(ha+B.hw*B.wk[j])*.7&&Math.abs(A.Y[i]-B.Y[j])<3){hit.add(bi)}});
  for(const bi of hit){const B=roads[bi];if(A.city&&B.city)continue;const key=ai<bi?ai+'-'+bi:bi+'-'+ai;const e=ov.get(key)||{n:0,at:[A.X[i],A.Z[i]],a:A.id,b:B.id};e.n++;ov.set(key,e)}}});
const list=[...ov.values()].filter(e=>e.n*4>50).sort((a,b)=>b.n-a.n);
console.log('roads overlapping along >50 m (pairs):',list.length);list.slice(0,25).forEach(e=>console.log('  ',e.a,'on',e.b,Math.round(e.n*4)+' m near',Math.round(e.at[0])+','+Math.round(e.at[1])));
// 2. dead ends
const dead=[];roads.forEach((A,ai)=>{if(A.closed)return;for(const e of[0,A.n-1]){let ok=false;near(A.X[e],A.Z[e],40,(bi,j)=>{if(bi===ai)return;const B=roads[bi];if(Math.hypot(A.X[e]-B.X[j],A.Z[e]-B.Z[j])<B.hw*B.wk[j]+A.hw*A.wk[e==0?0:A.n-1]+RSH+2.5)ok=true});if(!ok)dead.push(A.id+(e?' end':' start')+' ('+Math.round(A.X[e])+','+Math.round(A.Z[e])+')')}});
console.log('dead ends:',dead.length);console.log('  '+dead.join('\n  '));
// 3. connectivity (roads connected if an end touches another)
const adj=roads.map(()=>new Set());roads.forEach((A,ai)=>{if(A.closed){}for(const e of A.closed?[]:[0,A.n-1]){near(A.X[e],A.Z[e],40,(bi,j)=>{if(bi===ai)return;const B=roads[bi];if(Math.hypot(A.X[e]-B.X[j],A.Z[e]-B.Z[j])<B.hw*B.wk[j]+A.hw*A.wk[e==0?0:A.n-1]+RSH+2.5){adj[ai].add(bi);adj[bi].add(ai)}})}});
const seen=new Set(),comps=[];roads.forEach((r,i)=>{if(seen.has(i))return;const q=[i],c=[];seen.add(i);while(q.length){const k=q.pop();c.push(roads[k].id);for(const m of adj[k])if(!seen.has(m)){seen.add(m);q.push(m)}}comps.push(c)});
console.log('connected groups:',comps.length);comps.sort((a,b)=>b.length-a.length).forEach(c=>console.log('  ',c.length,'roads:',c.slice(0,10).join(','),c.length>10?'…':''));
