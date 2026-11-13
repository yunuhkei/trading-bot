'use strict';
/* ===== batch 21: units, the map's legend and its clickable icons, a random start =====
   UNITS: miles (mph, miles, feet, pounds) by default; the MPH rocker in the pause console switches to kilometres (km/h, km, metres, kg). Saved ('racer.units').
   Everything the player reads goes through fmtSpd / fmtKmh / fmtLen / fmtShort / fmtMass; what the game stores (records, physics) stays metric.
   MAP: a legend of every kind of icon (bottom left); tapping an icon opens a card with what it is and a SET ROUTE key.
   START: a random spot on the road network each time the game starts (until there is a story for where you begin); ?start=x,z and ?fixed keep the old ring start for the tests. */
const UNITS={imp:true,key:'racer.units'};
function unitsLoad(){try{const v=localStorage.getItem(UNITS.key);if(v)UNITS.imp=v!=='metric'}catch(e){}}
function unitsSet(imp){UNITS.imp=!!imp;try{localStorage.setItem(UNITS.key,imp?'imperial':'metric')}catch(e){}}
const spdK=()=>UNITS.imp?2.23694:3.6,spdU=()=>UNITS.imp?'mph':'km/h';
const fmtSpd=mps=>Math.round(mps*spdK())+' '+spdU();
const fmtKmh=kmh=>UNITS.imp?Math.round(kmh/1.609344)+' mph':Math.round(kmh)+' km/h';
/* a distance: miles (feet below a tenth of a mile) or km (metres below 1 km) */
const fmtLen=m=>UNITS.imp?(m>=161?(m/1609.344).toFixed(1)+' mi':Math.round(m*3.281/10)*10+' ft'):(m>=1000?(m/1000).toFixed(1)+' km':Math.round(m/10)*10+' m');
const fmtShort=m=>UNITS.imp?Math.round(m*3.281)+' ft':Math.round(m)+' m';
const fmtMass=kg=>UNITS.imp?Math.round(kg*2.20462)+' lb':Math.round(kg)+' kg';

/* ---------------- the map: what each icon is ---------------- */
const MAPKEY=[['GARAGE (YOURS)','#3cf08c','dot'],['GARAGE (FOR SALE)','#8d97a3','dot'],['REPAIR SHOP','#2a6be0','cross'],['TIME TRIAL','#ffb000','flag'],['RACE','#2a9be0','flag'],['DEATH RACE','#e04a2a','flag'],
  ['TAKEDOWN','#a050e0','flag'],['ESCAPE','#e03030','flag'],['SPEED TRAP','rgb(76,153,255)','dot'],['JUMP','rgb(76,255,115)','dot'],['DRIFT ZONE','rgb(204,89,255)','dot'],['STREET RACER','#ffd23a','dot']];
function mapKeyIcon(c,x,y,r,col,shape){c.fillStyle=col;c.beginPath();c.arc(x,y,r,0,TAU);c.fill();if(shape=='flag'){c.fillStyle='#111';c.fillRect(x-r*.45,y-r*.45,r*.45,r*.45);c.fillRect(x,y,r*.45,r*.45)}
  else if(shape=='cross'){c.fillStyle='#fff';c.fillRect(x-r*.62,y-r*.18,r*1.24,r*.36);c.fillRect(x-r*.18,y-r*.62,r*.36,r*1.24)}}
function mapLegend(c,W_,H_,u){const fs=u*.17,row=u*.27,cols=2,rows=Math.ceil(MAPKEY.length/cols),cw=u*2.15,pw=cw*cols+u*.3,ph=rows*row+u*.5,x=u*.3,y=H_-ph-u*.3;
  c.save();c.fillStyle='rgba(20,21,23,.86)';rr(c,x,y,pw,ph,u*.14);c.fill();c.strokeStyle='rgba(255,255,255,.08)';c.lineWidth=1;c.stroke();
  c.font=dLcd(u*.18);dLcdText(c,'MAP KEY',x+u*.18,y+u*.27,u*.18);
  MAPKEY.forEach(([t,col,sh],i)=>{const cx=x+u*.28+Math.floor(i/rows)*cw,cy=y+u*.5+(i%rows)*row;mapKeyIcon(c,cx,cy,u*.075,col,sh);c.fillStyle='rgba(233,230,220,.88)';c.font=dFont(fs,600);c.textAlign='left';c.fillText(t,cx+u*.16,cy+fs*.35)});
  c.restore()}
/* every icon on the map as {x,z,title,lines} (built each time the map is drawn) */
function mapBlips(){const B=[];
  for(const h of SAFEHOUSES){const own=SAFE.owned[h.id];B.push({x:h.x,z:h.z,col:own?'#3cf08c':'#8d97a3',title:h.name,lines:own?['Your garage. Stop on the pad: repaired and saved,','then go inside to change cars and buy upgrades.']:['For sale: '+evMoney(SAFE.price[h.id]||0)+'. Stop on its pad to buy it.']})}
  for(const p of REPAIRS)B.push({x:p.x,z:p.z,col:'#2a6be0',title:p.name||'Repair shop',lines:['Drive straight through the bay: the car is fixed','at once, for free.']});
  const TN={trial:'TIME TRIAL',race:'RACE',death:'DEATH RACE',rage:'TAKEDOWN',escape:'ESCAPE'};
  for(const ev of EV.list)B.push({x:ev.s.x,z:ev.s.z,col:{trial:'#ffb000',rage:'#a050e0',race:'#2a9be0',death:'#e04a2a'}[ev.type]||'#e03030',title:ev.name,tag:TN[ev.type]||'EVENT',lines:evInfo(ev).concat(['Stop in the ring at the start to begin.'])});
  for(const s of SPOTS.list){const rec=(EV.rec[s.id]||{}).v;
    if(s.type=='trap')B.push({x:s.x,z:s.z,col:'rgb(76,153,255)',title:'Speed trap',lines:['Drive past it as fast as you can: your best speed is kept.',rec!=null?'Best '+fmtKmh(rec):'Not set yet']});
    else if(s.type=='jump')B.push({x:s.x,z:s.z,col:'rgb(76,255,115)',title:'Jump',lines:['Take off here: your longest jump is kept.',rec!=null?'Best '+fmtShort(rec):'Not set yet']});
    else B.push({x:s.x,z:s.z,col:'rgb(204,89,255)',title:'Drift zone',lines:['Drift between the purple gates: every point counts.',rec!=null?'Best '+rec.toLocaleString('en-US')+' pts':'Not set yet']})}
  const sr=typeof RACE!='undefined'&&RACE.sr;if(sr&&sr.alive)B.push({x:sr.x,z:sr.z,col:'#ffd23a',title:'Street racer',lines:['Drive up behind it for a moment and it challenges you.']});
  return B}
/* a tap on the map: the nearest icon within reach opens its card */
function mapPick(sx,sy,u){const S=UI.mapCv.width,pxm=S/W.size,k=MAPV.k,toS=(x,z)=>[UI.w/2+((x+W.half)*pxm-(MAPV.x+W.half)*pxm)*k,UI.h/2+((z+W.half)*pxm-(MAPV.z+W.half)*pxm)*k];
  let best=null,bd=Math.max(18,u*.38);for(const b of mapBlips()){const p=toS(b.x,b.z),d=Math.hypot(p[0]-sx,p[1]-sy);if(d<bd){bd=d;best=b}}MAPV.pop=best;return!!best}
function mapPopDraw(c,W_,H_,u,btns){const b=MAPV.pop;if(!b)return;const S=UI.mapCv.width,pxm=S/W.size,k=MAPV.k,sx=W_/2+((b.x+W.half)*pxm-(MAPV.x+W.half)*pxm)*k,sy=H_/2+((b.z+W.half)*pxm-(MAPV.z+W.half)*pxm)*k;
  c.save();c.font=dFont(u*.2,600);let tw=0;for(const l of b.lines)tw=Math.max(tw,c.measureText(l).width);c.font=dFont(u*.32,700);tw=Math.max(tw,c.measureText(b.title).width+u*1.6);
  const pw=Math.min(W_*.62,tw+u*.6),ph=u*(1.0+b.lines.length*.3+.7);let px=sx+u*.35,py=sy-ph/2;if(px+pw>W_-u*.2)px=sx-u*.35-pw;py=Math.max(u*.2,Math.min(H_-ph-u*.2,py));
  c.strokeStyle='rgba(255,255,255,.5)';c.lineWidth=1.5;c.beginPath();c.moveTo(sx,sy);c.lineTo(px<sx?px+pw:px,py+ph/2);c.stroke();
  {const g=c.createLinearGradient(0,py,0,py+ph);g.addColorStop(0,'rgba(42,43,46,.97)');g.addColorStop(1,'rgba(24,25,27,.97)');c.fillStyle=g}rr(c,px,py,pw,ph,u*.18);c.fill();c.strokeStyle='rgba(255,255,255,.08)';c.lineWidth=1;c.stroke();
  c.fillStyle=b.col;c.fillRect(px,py+u*.2,u*.07,ph-u*.4);
  c.textAlign='left';c.fillStyle='#fff';c.font=dFont(u*.32,700);c.fillText(b.title,px+u*.3,py+u*.48);if(b.tag){c.font=dLcd(u*.17);dLcdText(c,b.tag,px+pw-u*.25,py+u*.44,u*.17,'right')}
  c.font=dFont(u*.2,600);c.fillStyle='rgba(233,230,220,.85)';b.lines.forEach((l,i)=>c.fillText(l,px+u*.3,py+u*.82+i*u*.3));
  const by=py+ph-u*.55,bw=u*1.7;const kx=px+u*.3;const d1=dKey(c,kx,by,bw,u*.42,u*.08,false,'#ffb83a','#d98a10');c.textAlign='center';c.fillStyle='#1b1406';c.font=dFont(u*.19,700);c.fillText('SET ROUTE',kx+bw/2,by+u*.28+d1);
  btns.push({x:kx,y:by,w:bw,h:u*.42,label:'',col:'',act:()=>{const r=navSet(b.x,b.z);MAPV.pop=null;if(r&&r.ok){UI.mapOpen=false;MAPV.g.clear();safeToast('ROUTE SET  ·  '+fmtLen(r.len),2.6)}else NAV.pendMsg=(r&&r.msg)||''},own:1});
  const cx=kx+bw+u*.2;dKey(c,cx,by,u*1.1,u*.42,u*.08);c.fillStyle=DASH.ink;c.fillText('CLOSE',cx+u*.55,by+u*.28);btns.push({x:cx,y:by,w:u*1.1,h:u*.42,label:'',col:'',act:()=>{MAPV.pop=null},own:1});
  c.restore()}

/* ---------------- a random start ---------------- */
function randomStart(){const ok=ROADS.filter(r=>r.style!=2&&r.len>300&&!/^(pier|lombard|lookout|rim)/.test(r.id));let tot=0;for(const r of ok)tot+=r.len;
  for(let t=0;t<60;t++){let pick=Math.random()*tot,r=ok[0];for(const q of ok){if(pick<q.len){r=q;break}pick-=q.len}
    const i=Math.max(10,Math.min(r.n-11,Math.floor(Math.random()*r.n)));if(r.br&&r.br[i])continue;const x=r.X[i],z=r.Z[i];if(JUNC.some(J=>Math.hypot(J.x-x,J.z-z)<50))continue;if(r.Y[i]<2)continue;
    const tg=_tan(r,i),li=laneInfo(r.hw,r.style),off=li.x0+li.lw*.5,nx=-tg[1],nz=tg[0];return{x:x+nx*off,z:z+nz*off,yaw:Math.atan2(tg[0],-tg[1]),y:r.Y[i]+.5,road:r.id}}
  return null}
/* lane assist on or off (batch 22), saved; the game starts with it on */
function laneSet(on){IN.lane=!!on;try{localStorage.setItem('racer.lane',on?'1':'0')}catch(e){}}
function laneLoad(){let v=null;try{v=localStorage.getItem('racer.lane')}catch(e){}IN.lane=v==null?true:v==='1'}
