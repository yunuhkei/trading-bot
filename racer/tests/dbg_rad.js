const fs=require('fs');const R=require('path').join(__dirname,'..','src')+'/';
global.window={addEventListener(){}};global.document={getElementById(){return null}};
const src=['00_util.js','20_map.js','20_organic.js','20_world.js'].map(f=>fs.readFileSync(R+f,'utf8').replace(/^'use strict';/,'')).join('\n');
const f=new Function(src+';defineRoads();return {ROADS,minRadius,landOK,clearOf,baseH,DISTRICT_BOXES,inBox}');const M=f();
for(const r of M.ROADS){if(r.city||r.def.id=='lookout'||r.n<60)continue;const want=r.def.minR==null?60:r.def.minR;const n=r.n,k=5,lo=r.closed?0:Math.max(k,30),hi=r.closed?n:n-Math.max(k,30);
  // list all places where radius < want (merge)
  const bad=[];for(let i=lo;i<hi;i++){const a=(i-k+n)%n,b=(i+k)%n,ax=r.X[a],az=r.Z[a],bx=r.X[i],bz=r.Z[i],cx=r.X[b],cz=r.Z[b];const ab=Math.hypot(bx-ax,bz-az),bc=Math.hypot(cx-bx,cz-bz),ca=Math.hypot(ax-cx,az-cz),A2=Math.abs((bx-ax)*(cz-az)-(bz-az)*(cx-ax));if(A2<1e-6)continue;const rad=ab*bc*ca/(2*A2);if(rad<want)bad.push([i,rad,bx,bz])}
  const lo2=r.closed?0:170;let clr=true;for(let i=0;i<r.n;i+=2){if(!r.closed&&(r.S[i]<lo2||r.len-r.S[i]<lo2))continue;for(const B of M.DISTRICT_BOXES)if(M.inBox(r.X[i],r.Z[i],B,46))clr=false}
  console.log(r.id.padEnd(9),'want',want,'bad samples',bad.length,'landOK',M.landOK(r),'clearOf',clr,'scale',(r.wigScale||1).toFixed(2),bad.slice(0,4).map(b=>b[0]+'@'+Math.round(b[2])+','+Math.round(b[3])+' r'+Math.round(b[1])).join(' '))}
