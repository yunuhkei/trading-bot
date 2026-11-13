'use strict';
/* ===== navigation: route finding on the lane graph, a waypoint you set on the touchable map, the path drawn on the road, and the same routes for the cops ===== */
/* Routes are found with A* over the LANE GRAPH (23_lanes.js), so they follow the way traffic really drives (one-way lanes, turns that exist, median crossovers on highways).
   A state is "on lane edge e, entered at sample u"; from there you can drive on to any turn link that leaves later on the same edge, and a link puts you on another edge. */
class NavHeap{constructor(){this.a=[];this.n=0}
  push(v,k){const a=this.a;let i=this.n++;a[i]=[v,k];while(i>0){const p=(i-1)>>1;if(a[p][1]<=a[i][1])break;const t=a[p];a[p]=a[i];a[i]=t;i=p}}
  pop(){const a=this.a,top=a[0];this.n--;if(this.n>0){a[0]=a[this.n];let i=0;for(;;){let l=i*2+1,r=l+1,m=i;if(l<this.n&&a[l][1]<a[m][1])m=l;if(r<this.n&&a[r][1]<a[m][1])m=r;if(m==i)break;const t=a[m];a[m]=a[i];a[i]=t;i=m}}return top[0]}}
/* the road sample nearest to a point within R metres: {ri, i, t, d, x, z} (t is how far along the segment i..i+1) */
function navSnap(x,z,R){
  const cs=QH.cs,nc=QH.nc,cx=Math.floor((x+W.half)/cs),cz=Math.floor((z+W.half)/cs),rr=Math.max(1,Math.ceil(R/cs));let bd=1e18,best=null;
  for(let b=-rr;b<=rr;b++)for(let a=-rr;a<=rr;a++){const gx=cx+a,gz=cz+b;if(gx<0||gz<0||gx>=nc||gz>=nc)continue;const c=gz*nc+gx;
    for(let q=QH.st[c];q<QH.st[c+1];q++){const s=QH.li[q],ri=QH.segR[s];if(!LG.ofRoad[ri])continue;const r=ROADS[ri],i=QH.segI[s],j=i+1<r.n?i+1:0,ax=r.X[i],az=r.Z[i],dx=r.X[j]-ax,dz=r.Z[j]-az,l2=dx*dx+dz*dz||1;
      let t=((x-ax)*dx+(z-az)*dz)/l2;t=t<0?0:t>1?1:t;const d=Math.hypot(x-ax-dx*t,z-az-dz*t);if(d<bd){bd=d;best={ri,i,t,d,x:ax+dx*t,z:az+dz*t}}}}
  return best&&bd<=R?best:null}
/* the lane edge and sample for a snapped point, in the direction you are heading (hx, hz), or the nearest lane of either direction when no heading is given */
function navLane(sn,x,z,hx,hz){
  const o=LG.ofRoad[sn.ri];if(!o)return null;const r=ROADS[sn.ri],j=sn.i+1<r.n?sn.i+1:sn.i;let dirs=[0,1];
  if(hx!=null){const tx=r.X[j]-r.X[sn.i],tz=r.Z[j]-r.Z[sn.i];dirs=[(tx*hx+tz*hz)>=0?0:1]}
  let best=null,bd=1e18;for(const di of dirs)for(const e of o[di]){const u=e.dir>0?Math.min(e.n-1,sn.i+(sn.t>.5?1:0)):Math.max(0,e.n-1-sn.i-(sn.t>.5?1:0)),d=(e.X[u]-x)**2+(e.Z[u]-z)**2;if(d<bd){bd=d;best={e,u}}}
  return best}
/* A*: the chain of states from (e0,u0) to the road sample goal {ri,i,x,z}, or null */
function navAStar(e0,u0,goal,maxIt){
  const open=new NavHeap(),st=[],best=new Map();
  const push=(e,u,g,prev,link)=>{const key=e.id*8192+u,old=best.get(key);if(old!==undefined&&old<=g)return;best.set(key,g);st.push({e,u,g,prev,link});open.push(st.length-1,g+Math.hypot(e.X[u]-goal.x,e.Z[u]-goal.z))};
  push(e0,u0,0,-1,null);let it=0,gn=-1;const lim=maxIt||9000;
  while(open.n&&it++<lim){const k=open.pop(),s=st[k];if(s.goal){gn=k;break}if(s.g>best.get(s.e.id*8192+s.u)+1e-6)continue;
    const e=s.e,u=s.u;
    if(e.ri===goal.ri){const ug=e.dir>0?goal.i:e.n-1-goal.i;let d=-1;if(ug>=u)d=e.S[ug]-e.S[u];else if(e.closed)d=e.len-e.S[u]+e.S[ug];if(d>=0){st.push({e,u:ug,g:s.g+d,prev:k,link:null,goal:1});open.push(st.length-1,s.g+d)}}
    /* a car may change lane (the traffic does), so every lane of this road direction offers its turns from the same sample onwards */
    const lanes=LG.ofRoad[e.ri][e.dir>0?0:1];for(const e2 of lanes)for(const l of e2.out){let d;if(l.fu>=u)d=e2.S[l.fu]-e2.S[u];else if(e2.closed)d=e2.len-e2.S[u]+e2.S[l.fu];else continue;push(l.to,l.tu,s.g+d+l.len+(e2===e?0:2.5),k,l)}}
  if(gn<0)return null;const chain=[];for(let k=gn;k>=0;k=st[k].prev)chain.push(st[k]);chain.reverse();return chain}
/* the chain as a polyline (x,y,z per point, about 4 m apart) with the distance along it */
function navPolyline(chain){
  const P=[];const addEdge=(e,a,b)=>{if(b>=a){for(let i=a;i<=b;i++)P.push(e.X[i],e.Y[i],e.Z[i])}else{for(let i=a;i<e.n;i++)P.push(e.X[i],e.Y[i],e.Z[i]);for(let i=0;i<=b;i++)P.push(e.X[i],e.Y[i],e.Z[i])}};
  for(let k=0;k<chain.length-1;k++){const s=chain[k],nx=chain[k+1];if(nx.link){addEdge(nx.link.from,s.u,nx.link.fu);const l=nx.link;for(let j=1;j<l.n;j++)P.push(l.X[j],l.Y[j],l.Z[j])}else addEdge(s.e,s.u,nx.u)}
  const n=P.length/3,pts=new Float32Array(P),S=new Float32Array(n);for(let i=1;i<n;i++)S[i]=S[i-1]+Math.hypot(pts[i*3]-pts[i*3-3],pts[i*3+2]-pts[i*3-1]);
  return{pts,n,S,len:S[n-1]||0}}
/* the turn links of a chain, in order */
const navLinksOf=chain=>{const L=[];for(const s of chain)if(s.link)L.push(s.link);return L};
/* ---------------- the waypoint ---------------- */
const NAV={wp:null,route:null,prog:0,pend:null,pendMsg:'',t:0,routeT:-9,off:0,len:0,remain:0,arrivedT:-9,hist:[]};
/* a route from where the player is (heading with the car) to a road sample goal */
function navRouteFromPlayer(goal){
  const sp=C.speed,hx=sp>3?C.vx/sp:Math.sin(C.yaw),hz=sp>3?C.vz/sp:-Math.cos(C.yaw);
  const sn=navSnap(C.x,C.z,70);if(!sn)return null;const la=navLane(sn,C.x,C.z,hx,hz);if(!la)return null;
  const e=la.e,u0=e.closed?(la.u+2)%e.n:Math.min(e.n-1,la.u+2),chain=navAStar(e,u0,goal);if(!chain)return null;return navPolyline(chain)}
function navSet(x,z){
  const sn=navSnap(x,z,Math.max(60,NAV.pickR||60));if(!sn)return{ok:false,msg:'No road near there'};
  const goal={ri:sn.ri,i:sn.i,x:sn.x,z:sn.z},rt=navRouteFromPlayer(goal);if(!rt)return{ok:false,msg:'No way to get there from here'};
  NAV.wp={x:sn.x,z:sn.z,ri:sn.ri,i:sn.i,y:ROADS[sn.ri].Y[sn.i]};NAV.route=rt;NAV.prog=0;NAV.routeT=NAV.t;NAV.len=rt.len;NAV.remain=rt.len;NAV.pend=null;return{ok:true,len:rt.len}}
function navClear(){NAV.wp=null;NAV.route=null;NAV.pend=null}
/* every frame: how far along the route you are, reroute when you leave it, arrive */
function navUpdate(dt){
  NAV.t+=dt;if(!NAV.wp||!NAV.route)return;const R=NAV.route,p=R.pts,n=R.n;
  /* progress: the nearest route point in a window ahead of the last one */
  let bi=NAV.prog,bd=1e18;const a=Math.max(0,NAV.prog-6),b=Math.min(n-1,NAV.prog+60);for(let i=a;i<=b;i++){const d=(p[i*3]-C.x)**2+(p[i*3+2]-C.z)**2;if(d<bd){bd=d;bi=i}}
  NAV.prog=bi;NAV.off=Math.sqrt(bd);NAV.remain=R.len-R.S[bi];
  const dw=Math.hypot(NAV.wp.x-C.x,NAV.wp.z-C.z);
  if(dw<26||(NAV.remain<18&&dw<60)){navClear();NAV.arrivedT=NAV.t;safeToast('You have arrived',3);return}
  if(NAV.off>24&&NAV.t-NAV.routeT>1.2){                       /* only when you have left the route (a wrong turn): a new route from where you are */NAV.routeT=NAV.t;const rt=navRouteFromPlayer({ri:NAV.wp.ri,i:NAV.wp.i,x:NAV.wp.x,z:NAV.wp.z});if(rt){NAV.route=rt;NAV.prog=0;NAV.len=rt.len}}}
/* the path on the road, drawn by fxDraw: a glowing ribbon with light running along it, and a pillar of light at the waypoint */
function navFx(quad,sprite,time){
  if(!NAV.wp||!NAV.route)return 0;const R=NAV.route,p=R.pts,n=R.n,start=Math.max(0,NAV.prog-1);let drawn=0;const maxS=R.S[start]+420;
  for(let i=start;i<n-1&&R.S[i]<maxS&&drawn<130;i++){
    const x0=p[i*3],y0=p[i*3+1]+.1,z0=p[i*3+2],x1=p[i*3+3],y1=p[i*3+4]+.1,z1=p[i*3+5],dx=x1-x0,dz=z1-z0,l=Math.hypot(dx,dz)||1,nx=-dz/l*.8,nz=dx/l*.8;
    const s=R.S[i],fade=Math.min(1,(maxS-s)/120),pulse=.55+.35*Math.sin(s*.22-time*7);
    quad(x0-nx,y0,z0-nz,x0+nx,y0,z0+nz,x1+nx,y1,z1+nz,x1-nx,y1,z1-nz,.15,.8,1,.62*pulse*fade);drawn++}
  return drawn}
function navBeacon(sprite){
  if(!NAV.wp)return;const w=NAV.wp,gy=w.y;for(let k=0;k<9;k++)sprite(w.x,gy+1.5+k*7,w.z,3.2+k*.25,.2,.85,1,.55-.04*k)}
/* ---------------- HUD: distance to the waypoint and a pointer ---------------- */
function navHud(c,W_,H_,u){
  if(!NAV.wp)return;const w=NAV.wp,dx=w.x-C.x,dz=w.z-C.z,d=Math.hypot(dx,dz),rel=angd(Math.atan2(dx,-dz),C.camYaw),km=fmtLen(NAV.remain);
  c.save();const x=UI.mm.cx-UI.mm.r,y=UI.mm.cy+UI.mm.r+u*.98,wd=u*2.3,h=u*.34;c.fillStyle='rgba(8,20,32,.7)';rr(c,x,y,wd,h,h/2);c.fill();c.strokeStyle='rgba(60,210,255,.8)';c.lineWidth=1.5;c.stroke();
  c.fillStyle='#7fe3ff';c.font='800 '+Math.round(u*.22)+'px -apple-system,Roboto,sans-serif';c.textAlign='left';c.fillText('WAYPOINT  '+km,x+h*.6,y+h*.68);
  /* an arrow along the top edge when it is not in front of you */
  if(Math.abs(rel)>.55){const ax=W_*.5+Math.max(-1,Math.min(1,rel/1.5))*W_*.34,ay=u*2.2;c.translate(ax,ay);c.rotate(Math.abs(rel)>1.9?PI:rel>0?PI/2:-PI/2);c.fillStyle='#7fe3ff';c.shadowColor='rgba(0,0,0,.7)';c.shadowBlur=4;c.beginPath();c.moveTo(0,-u*.26);c.lineTo(u*.2,u*.2);c.lineTo(0,u*.1);c.lineTo(-u*.2,u*.2);c.closePath();c.fill()}
  c.restore()}
/* drawn on the minimap and the world map (canvas 2D, in map pixels): the route and the flag */
function navMapOverlay(ctx,pxm,s){
  if(NAV.route){const R=NAV.route,p=R.pts;ctx.beginPath();for(let i=Math.max(0,NAV.prog-2);i<R.n;i+=2){const px=(p[i*3]+W.half)*pxm,pz=(p[i*3+2]+W.half)*pxm;i==Math.max(0,NAV.prog-2)?ctx.moveTo(px,pz):ctx.lineTo(px,pz)}ctx.lineJoin='round';ctx.lineCap='round';ctx.lineWidth=3.4/s;ctx.strokeStyle='rgba(0,0,0,.6)';ctx.stroke();ctx.lineWidth=2.2/s;ctx.strokeStyle='#38d3ff';ctx.stroke()}
  const flag=(w,col)=>{const px=(w.x+W.half)*pxm,pz=(w.z+W.half)*pxm,r=5/s;ctx.beginPath();ctx.arc(px,pz,r,0,TAU);ctx.fillStyle=col;ctx.fill();ctx.lineWidth=1.6/s;ctx.strokeStyle='#fff';ctx.stroke();ctx.beginPath();ctx.moveTo(px,pz-r*.2);ctx.lineTo(px,pz-r*2.6);ctx.lineWidth=1.8/s;ctx.stroke()};
  if(NAV.wp)flag(NAV.wp,'#38d3ff');if(NAV.pend)flag(NAV.pend,'#ffd24a')}
/* ---------------- the touchable world map ---------------- */
const MAPV={x:0,z:0,k:1,k0:1,kMax:2.6,g:new Map(),mt:0,btns:[],moved:0,t0:0,sx:0,sy:0};
function mapFit(W_,H_){const S=UI.mapCv.width;MAPV.k0=Math.min(W_,H_)*.98/S;if(!MAPV.k||MAPV.k<MAPV.k0)MAPV.k=MAPV.k0}
function mapOpenNow(){UI.mapOpen=true;MAPV.pop=null;const W_=UI.w,H_=UI.h;mapFit(W_,H_);MAPV.k=Math.max(MAPV.k0,Math.min(MAPV.kMax,MAPV.k0*2.4));MAPV.x=C.x;MAPV.z=C.z;MAPV.g.clear();NAV.pend=null;NAV.pendMsg=''}
const mapToWorld=(sx,sy)=>{const S=UI.mapCv.width,pxm=S/W.size;return[(sx-UI.w/2)/MAPV.k/pxm+MAPV.x,(sy-UI.h/2)/MAPV.k/pxm+MAPV.z]};
function mapClamp(){const h=W.half;MAPV.x=Math.max(-h,Math.min(h,MAPV.x));MAPV.z=Math.max(-h,Math.min(h,MAPV.z));MAPV.k=Math.max(MAPV.k0,Math.min(MAPV.kMax,MAPV.k))}
function mapDown(id,x,y){
  for(const b of MAPV.btns){if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h){b.act();MAPV.g.set(id,{btn:1});return}}
  MAPV.g.set(id,{x,y,x0:x,y0:y,t0:performance.now(),moved:0});MAPV.mt=MAPV.g.size}
function mapMove(id,x,y){const g=MAPV.g.get(id);if(!g||g.btn)return;
  const pts=[...MAPV.g.values()].filter(q=>!q.btn);
  if(pts.length>=2){/* pinch: zoom about the middle of the two fingers, and drag with it */
    const o=pts.find(q=>q!==g)||pts[0],ox=o.x,oy=o.y,d0=Math.hypot(g.x-ox,g.y-oy),d1=Math.hypot(x-ox,y-oy);
    if(d0>8){const mx=(x+ox)/2,my=(y+oy)/2,wb=mapToWorld(mx,my);MAPV.k*=d1/d0;mapClamp();const wa=mapToWorld(mx,my);MAPV.x+=wb[0]-wa[0];MAPV.z+=wb[1]-wa[1]}g.moved=99}
  else{const S=UI.mapCv.width,pxm=S/W.size;MAPV.x-=(x-g.x)/MAPV.k/pxm;MAPV.z-=(y-g.y)/MAPV.k/pxm;g.moved+=Math.hypot(x-g.x,y-g.y)}
  g.x=x;g.y=y;mapClamp()}
function mapUp(id){const g=MAPV.g.get(id);MAPV.g.delete(id);if(!g||g.btn)return;
  /* a tap (little movement, short) puts a pin; navSet snaps it to a road when you choose SET */
  if(g.moved<14&&performance.now()-g.t0<450){if(mapPick(g.x0,g.y0,UI.btnU)){NAV.pend=null;NAV.pendMsg='';return}   /* (batch 21: an icon opens its card) */
    const w=mapToWorld(g.x0,g.y0);NAV.pickR=Math.max(40,60/MAPV.k/(UI.mapCv.width/W.size)*.7);const sn=navSnap(w[0],w[1],NAV.pickR);
    if(sn){NAV.pend={x:sn.x,z:sn.z};NAV.pendMsg=''}else{NAV.pend=null;NAV.pendMsg='No road near there - tap closer to a road'}}}
function mapWheel(x,y,dy){const wb=mapToWorld(x,y);MAPV.k*=dy<0?1.18:1/1.18;mapClamp();const wa=mapToWorld(x,y);MAPV.x+=wb[0]-wa[0];MAPV.z+=wb[1]-wa[1];mapClamp()}
function drawWorldMap(c,W_,H_,u){
  mapFit(W_,H_);const S=UI.mapCv.width,pxm=S/W.size,k=MAPV.k;
  c.fillStyle='#050a12';c.fillRect(0,0,W_,H_);
  c.save();c.translate(W_/2,H_/2);c.scale(k,k);c.translate(-(MAPV.x+W.half)*pxm,-(MAPV.z+W.half)*pxm);c.imageSmoothingEnabled=true;c.drawImage(UI.mapCv,0,0);
  /* named areas, the garages and the jumps, kept the same size on screen at every zoom */
  const sc=1/k;c.textAlign='center';c.font='800 '+Math.max(9,Math.round(u*.24))+'px -apple-system,Roboto,sans-serif';c.lineJoin='round';
  const wpx=x=>(x+W.half)*pxm,wpz=z=>(z+W.half)*pxm;
  for(const L of MAPLBL.concat(JUMPZ.map(j=>['JUMPS',j[0],j[1]-75,1]))){c.save();c.translate(wpx(L[1]),wpz(L[2]));c.scale(sc,sc);c.textAlign=L[4]=='r'?'right':'center';c.strokeStyle='rgba(0,0,0,.85)';c.lineWidth=3.5;c.strokeText(L[0],0,0);c.fillStyle=L[3]?'#fff':'#8fb8e0';c.fillText(L[0],0,0);c.restore()}
  evMapIcons(c,wpx,wpz,Math.max(3,u*.13)*sc);spotMapIcons(c,wpx,wpz,Math.max(3,u*.13)*sc);
  for(const p of REPAIRS){const r=Math.max(3,u*.12)*sc,x=wpx(p.x),z=wpz(p.z);c.beginPath();c.arc(x,z,r,0,TAU);c.fillStyle='#2a6be0';c.fill();c.fillStyle='#fff';c.fillRect(x-r*.62,z-r*.18,r*1.24,r*.36);c.fillRect(x-r*.18,z-r*.62,r*.36,r*1.24)}
  for(const h of SAFEHOUSES){c.beginPath();c.arc(wpx(h.x),wpz(h.z),Math.max(3,u*.11)*sc,0,TAU);c.fillStyle=SAFE.owned[h.id]?'#3cf08c':'#8d97a3';c.fill();c.lineWidth=1.5*sc;c.strokeStyle='#071018';c.stroke()}
  navMapOverlay(c,pxm,k);
  /* you */
  c.save();c.translate(wpx(C.x),wpz(C.z));c.scale(sc,sc);c.strokeStyle='rgba(255,122,26,'+(.75-.4*Math.sin(C.t*6))+')';c.lineWidth=2;c.beginPath();c.arc(0,0,9+3*Math.sin(C.t*6),0,TAU);c.stroke();c.rotate(C.yaw);c.fillStyle='#ff7a1a';c.strokeStyle='#fff';c.lineWidth=1.8;c.beginPath();c.moveTo(0,-10);c.lineTo(7,8);c.lineTo(0,3);c.lineTo(-7,8);c.closePath();c.fill();c.stroke();c.restore();
  c.restore();
  /* the screen furniture: title, hint, buttons */
  c.textAlign='left';c.fillStyle='#fff';c.font='800 '+Math.round(u*.4)+'px -apple-system,Roboto,sans-serif';c.shadowColor='rgba(0,0,0,.8)';c.shadowBlur=5;c.fillText('COUNTY MAP',u*.35,u*.75);
  c.font='700 '+Math.round(u*.22)+'px -apple-system,Roboto,sans-serif';c.fillStyle='rgba(255,255,255,.8)';c.fillText('drag to move  ·  pinch to zoom  ·  tap an icon to see what it is  ·  tap a road for a waypoint',u*.35,u*1.1);
  if(NAV.pendMsg){c.fillStyle='#ffb36b';c.fillText(NAV.pendMsg,u*.35,u*1.4)}c.shadowBlur=0;
  const b=[],bw=u*2.5,bh=u*.62,bx=W_-bw-u*.3;let by=H_-bh-u*.3;const add=(label,col,act,show)=>{if(show===false)return;b.push({x:bx,y:by,w:bw,h:bh,label,col,act});by-=bh+u*.16};
  add('CLOSE MAP','rgba(255,255,255,.2)',()=>{UI.mapOpen=false;MAPV.g.clear()});
  add('MY CAR','rgba(255,255,255,.2)',()=>{MAPV.x=C.x;MAPV.z=C.z;MAPV.k=Math.max(MAPV.k,MAPV.k0*2)});
  add('CLEAR WAYPOINT','rgba(255,90,70,.7)',()=>{navClear()},!!NAV.wp);
  add('SET WAYPOINT','#ff7a1a',()=>{if(!NAV.pend)return;const r=navSet(NAV.pend.x,NAV.pend.z);if(r.ok){UI.mapOpen=false;MAPV.g.clear();safeToast('WAYPOINT SET  ·  '+fmtLen(r.len),3)}else NAV.pendMsg=r.msg},!!NAV.pend);
  mapLegend(c,W_,H_,u);mapPopDraw(c,W_,H_,u,b);
  MAPV.btns=b;for(const q of b){if(q.own)continue;c.fillStyle=q.col;rr(c,q.x,q.y,q.w,q.h,u*.14);c.fill();c.fillStyle=q.col=='#ff7a1a'?'#111':'#fff';c.textAlign='center';c.font='800 '+Math.round(u*.25)+'px -apple-system,Roboto,sans-serif';c.fillText(q.label,q.x+q.w/2,q.y+q.h*.66)}
  if(NAV.pend){const d=Math.hypot(NAV.pend.x-C.x,NAV.pend.z-C.z);c.textAlign='center';c.fillStyle='#ffd24a';c.font='800 '+Math.round(u*.26)+'px -apple-system,Roboto,sans-serif';c.shadowColor='rgba(0,0,0,.8)';c.shadowBlur=5;c.fillText('Pin: '+fmtLen(d)+' away (straight line) - tap SET WAYPOINT',W_*.5-u*1.2,H_-u*.4);c.shadowBlur=0}
  else if(NAV.wp&&NAV.route){c.textAlign='center';c.fillStyle='#7fe3ff';c.font='800 '+Math.round(u*.26)+'px -apple-system,Roboto,sans-serif';c.shadowColor='rgba(0,0,0,.8)';c.shadowBlur=5;c.fillText('Route: '+fmtLen(NAV.remain)+' to go',W_*.5-u*1.2,H_-u*.4);c.shadowBlur=0}}
