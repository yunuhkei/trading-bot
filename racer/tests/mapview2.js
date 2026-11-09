// Build the whole map in Node: stats per road (length, min curve radius, land), crossing check, overview picture.
const fs=require('fs');const R=require('path').join(__dirname,'..','src')+'/';
global.window={addEventListener(){}};global.document={getElementById(){return null}};
const files=['00_util.js','20_map.js','21_terrain.js'];
const src=files.map(f=>fs.readFileSync(R+f,'utf8').replace(/^'use strict';/,'')).join('\n');
const f=new Function(src+';return (async()=>{const t0=Date.now();defineRoads();console.log("roads built",Date.now()-t0,"ms,",ROADS.length,"roads");await genHeight();await carveRoads();railPass();genColors();return {W,ROADS,baseH,terrainH,minRadius,CITY,PARK,VALLEY,MARKET,GRIDS,fixed:BRIDGES_ADDED}})()');
(async()=>{
  const M=await f();const tot={len:0};
  for(const r of M.ROADS){tot.len+=r.len}
  console.log('bridges added:',M.fixed.join(' | '));console.log('total road km',(tot.len/1000).toFixed(1));
  const main=M.ROADS.filter(r=>!r.city);
  for(const r of main){let mn=1e9,mx=-1e9,gmax=0;for(let i=0;i<r.n;i++){mn=Math.min(mn,r.Y[i]);mx=Math.max(mx,r.Y[i]);if(i)gmax=Math.max(gmax,Math.abs(r.Y[i]-r.Y[i-1])/r.ds)}
    console.log(r.id.padEnd(8),'len',String(Math.round(r.len)).padStart(5),'m  minR',String(Math.round(M.minRadius(r,5))).padStart(5),'m  y',mn.toFixed(0)+'..'+mx.toFixed(0),' maxgrade',(gmax*100).toFixed(1)+'%',r.wigScale!=null?' wiggle x'+r.wigScale.toFixed(2):'')}
  {const g=M.ROADS.filter(r=>r.city).map(r=>{let m=0;for(let i=1;i<r.n;i++)m=Math.max(m,Math.abs(r.Y[i]-r.Y[i-1])/r.ds);return[r.id,m]}).sort((a,b)=>b[1]-a[1]).slice(0,6);console.log('steepest city streets:',g.map(x=>x[0]+' '+(x[1]*100).toFixed(0)+'%').join(', '))}console.log('city streets',M.ROADS.filter(r=>r.city).length,'grids',M.GRIDS.map(g=>g.kind+':'+g.roads.length).join(' '));
  // crossings between roads that are not meant to cross (ignore city streets among themselves and endpoint joins)
  const segs=[];for(const r of M.ROADS){const c=r.closed?r.n:r.n-1;for(let i=0;i<c;i+=1){const j=(i+1)%r.n;segs.push([r.X[i],r.Z[i],r.X[j],r.Z[j],r.id,i,r])}}
  const X=(a,b)=>{const d=(a[2]-a[0])*(b[3]-b[1])-(a[3]-a[1])*(b[2]-b[0]);if(Math.abs(d)<1e-9)return null;const t=((b[0]-a[0])*(b[3]-b[1])-(b[1]-a[1])*(b[2]-b[0]))/d,u=((b[0]-a[0])*(a[3]-a[1])-(b[1]-a[1])*(a[2]-a[0]))/d;return(t>=0&&t<=1&&u>=0&&u<=1)?[a[0]+t*(a[2]-a[0]),a[1]+t*(a[3]-a[1])]:null};
  const cross=new Map();
  // grid cells for speed
  const cell=200,grid=new Map();segs.forEach((s,k)=>{const x0=Math.min(s[0],s[2]),x1=Math.max(s[0],s[2]),z0=Math.min(s[1],s[3]),z1=Math.max(s[1],s[3]);for(let cx=Math.floor(x0/cell);cx<=Math.floor(x1/cell);cx++)for(let cz=Math.floor(z0/cell);cz<=Math.floor(z1/cell);cz++){const key=cx+','+cz;(grid.get(key)||grid.set(key,[]).get(key)).push(k)}});
  const seen=new Set();for(const L of grid.values())for(let a=0;a<L.length;a++)for(let b=a+1;b<L.length;b++){const A=segs[L[a]],B=segs[L[b]];if(A[4]==B[4])continue;const key=Math.min(L[a],L[b])+'-'+Math.max(L[a],L[b]);if(seen.has(key))continue;seen.add(key);const p=X(A,B);if(!p)continue;
    const ca=A[6].city,cb=B[6].city;if(ca&&cb)continue; // city streets cross each other on purpose
    // near an end of either road = a junction
    const nearEnd=(r,i)=>(!r.closed&&(i<25||i>r.n-27));if(nearEnd(A[6],A[5])||nearEnd(B[6],B[5]))continue;
    const ya=A[6].Y[A[5]],yb=B[6].Y[B[5]];const key2=[A[4],B[4]].sort().join('x');const e=cross.get(key2)||{n:0,dy:0,at:null};e.n++;e.dy=Math.max(e.dy,Math.abs(ya-yb));e.at=e.at||[Math.round(p[0]),Math.round(p[1])];cross.set(key2,e)}
  console.log('crossings (non-junction):');for(const[k,e]of cross)console.log('  ',k,'x'+e.n,'at',e.at.join(','),'height difference',e.dy.toFixed(1)+' m');
  // picture
  const N=900,S=M.W.size/N,img=Buffer.alloc(N*N*3);
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){const x=-M.W.half+i*S,z=-M.W.half+j*S,h=M.terrainH(x,z),hx=M.terrainH(x+10,z)-M.terrainH(x-10,z),hz=M.terrainH(x,z+10)-M.terrainH(x,z-10);const sh=Math.max(.35,Math.min(1.4,1-(hx+hz)*.05));
    const ci=Math.floor(i/N*M.W.CN),cj=Math.floor(j/N*M.W.CN),o=(cj*M.W.CN+ci)*4;let r=M.W.col[o]/255,g=M.W.col[o+1]/255,b=M.W.col[o+2]/255;r*=r*sh;g*=g*sh;b*=b*sh;if(h<0){r=.08;g=.2;b=.35}
    const o2=(j*N+i)*3;img[o2]=Math.min(255,Math.sqrt(r)*255);img[o2+1]=Math.min(255,Math.sqrt(g)*255);img[o2+2]=Math.min(255,Math.sqrt(b)*255)}
  const col=id=>({ring:[255,70,70],mh:[255,0,255],mp:[255,0,255],cr:[0,255,255],sh:[255,255,0],el:[0,255,0],bv:[255,160,0],dc:[255,160,0],market:[255,255,255],lombard:[255,100,255],tp:[255,200,255],jfk:[120,255,120],lan:[255,160,0],lae:[255,160,0]})[id]||(/^(sf|la)/.test(id)?[235,235,235]:[255,255,255]);
  for(const r of M.ROADS){const c=col(r.id),w=r.city?0:1;for(let i=0;i<r.n;i++){const px=Math.round((r.X[i]+M.W.half)/S),pz=Math.round((r.Z[i]+M.W.half)/S);for(let a=-w;a<=w;a++)for(let b=-w;b<=w;b++){const x=px+a,y=pz+b;if(x>=0&&y>=0&&x<N&&y<N){const o=(y*N+x)*3;img[o]=c[0];img[o+1]=c[1];img[o+2]=c[2]}}}}
  const OUT=process.env.RACER_OUT||require('path').join(require('os').tmpdir(),'racer-tests');fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(OUT+'/mapview2.rgb',img);
  try{require('child_process').execSync(`python3 -c "from PIL import Image;Image.frombytes('RGB',(${N},${N}),open('${OUT}/mapview2.rgb','rb').read()).save('${OUT}/mapview.png')"`);console.log('overview image:',OUT+'/mapview.png')}catch(e){console.log('raw overview image:',OUT+'/mapview2.rgb (needs python3 + PIL to make a PNG)')}
})().catch(e=>{console.error(e);process.exit(1)});
