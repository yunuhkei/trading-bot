const fs=require('fs');const R=require('path').join(__dirname,'..','src')+'/';
global.window={addEventListener(){}};global.document={getElementById(){return null}};
const src=['00_util.js','20_map.js','20_organic.js','20_world.js'].map(f=>fs.readFileSync(R+f,'utf8').replace(/^'use strict';/,'')).join('\n');
const f=new Function(src+';defineRoads();return {ROADS}');const M=f();
const [id,step]=process.argv.slice(2);const A=M.ROADS.find(r=>r.id==id);const s=+step||10;let o=[];
for(let i=0;i<A.n;i+=s)o.push(i+':'+A.X[i].toFixed(0)+','+A.Z[i].toFixed(0));console.log(id,'n',A.n,'\n'+o.join('  '));
