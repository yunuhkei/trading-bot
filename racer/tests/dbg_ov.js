const fs=require('fs');const R=require('path').join(__dirname,'..','src')+'/';
global.window={addEventListener(){}};global.document={getElementById(){return null}};
const src=['00_util.js','20_map.js'].map(f=>fs.readFileSync(R+f,'utf8').replace(/^'use strict';/,'')).join('\n');
const f=new Function(src+';defineRoads();return {ROADS}');const M=f();
const [ia,ib]=process.argv.slice(2);const A=M.ROADS.find(r=>r.id==ia),B=M.ROADS.find(r=>r.id==ib);
let runs=[],cur=null;
for(let i=0;i<A.n;i++){let best=1e9,bj=0;for(let j=0;j<B.n;j++){const d=Math.hypot(A.X[i]-B.X[j],A.Z[i]-B.Z[j]);if(d<best){best=d;bj=j}}
  const lim=(A.hw*A.wk[i]+B.hw*B.wk[bj])*.7,hit=best<lim&&Math.abs(A.Y[i]-B.Y[bj])<3;
  if(hit){if(!cur)cur={i0:i,i1:i,d:[]};cur.i1=i;cur.d.push(best)}else if(cur){runs.push(cur);cur=null}}
if(cur)runs.push(cur);
console.log(ia,'n',A.n,'hw',A.hw,'closed',A.closed,'|',ib,'n',B.n,'hw',B.hw);
for(const r of runs)console.log(' run samples',r.i0,'-',r.i1,'len',(r.i1-r.i0+1)*4,'m from',A.X[r.i0].toFixed(0)+','+A.Z[r.i0].toFixed(0),'to',A.X[r.i1].toFixed(0)+','+A.Z[r.i1].toFixed(0),'mind',Math.min(...r.d).toFixed(1));
console.log(' ends',A.X[0].toFixed(0),A.Z[0].toFixed(0),'->',A.X[A.n-1].toFixed(0),A.Z[A.n-1].toFixed(0));
