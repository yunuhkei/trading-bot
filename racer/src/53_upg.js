'use strict';
/* ===== upgrades (batch 20): bought in the garage, per car, three stages each =====
   ENGINE  +4 % top speed and +7 % pull per stage        TYRES   +4 % grip per stage        BRAKES  +9 % braking per stage
   NITRO   +25 % tank (it lasts longer) and +12 % push    ARMOUR  +20 % health per stage (damage still never changes how the car drives)
   Prices follow the car's value (a tenth of it, at least 2,500, for stage 1; stage 2 costs twice that, stage 3 three and a half times), tyres, brakes, nitro and armour cost less
   than the engine. The levels are saved per car (localStorage 'racer.upg'); carHandling() applies them to the car you drive (upgApply). In the garage the car menu has an
   UPGRADES page: a row per part with its stage lights and a BUY key; the figures on the page show the gain. */
const UPG_DEF=[{k:'eng',name:'ENGINE',per:'+4 % top speed, +7 % pull',m:1},{k:'tyr',name:'TYRES',per:'+4 % grip',m:.8},{k:'brk',name:'BRAKES',per:'+9 % braking',m:.7},
  {k:'nos',name:'NITRO',per:'+25 % tank, +12 % push',m:.8},{k:'arm',name:'ARMOUR',per:'+20 % health',m:.6}];
const UPG={lv:{},key:'racer.upg',nosDrain:1,boost:1,arm:1};
function upgLoad(){try{const j=JSON.parse(localStorage.getItem(UPG.key)||'null');if(j&&typeof j=='object')UPG.lv=j}catch(e){}}
function upgSave(){try{localStorage.setItem(UPG.key,JSON.stringify(UPG.lv))}catch(e){}}
const upgLv=(id,k)=>((UPG.lv[id]||{})[k]|0);
function upgPrice(id,k){const L=upgLv(id,k)+1;if(L>3)return null;const d=UPG_DEF.find(q=>q.k==k),val=Math.max(8000,ECON.carPrice(id)||0),base=Math.max(2500,val*.1);
  return Math.round(base*[1,2,3.5][L-1]*d.m/250)*250}
function upgBuy(id,k){const p=upgPrice(id,k);if(p==null)return 'MAX';if(ECON.money<p)return 'NEED '+evMoney(p);ECON.add(-p);(UPG.lv[id]||(UPG.lv[id]={}))[k]=upgLv(id,k)+1;upgSave();
  const cur=CAR_ROSTER[CARSEL.cur];if(cur&&cur.id==id)carHandling(cur);return 'OK'}
/* the levels of a car as the multipliers carHandling uses */
function upgApply(def){const id=def.id,e=upgLv(id,'eng'),t=upgLv(id,'tyr'),b=upgLv(id,'brk'),n=upgLv(id,'nos'),a=upgLv(id,'arm');
  HND.vmax*=1+.04*e;HND.vmaxG*=1+.03*e;HND.accel*=1+.07*e;HND.accelLow*=1+.05*e;HND.aBase*=1+.04*t;HND.grip*=1+.04*t;HND.brake*=1+.09*b;
  UPG.nosDrain=1/(1+.25*n);UPG.boost=1+.12*n;UPG.arm=1+.2*a}
/* the car's figures with its upgrades (for the stat bars) */
function upgReal(d){const r=d.real,id=d.id,e=upgLv(id,'eng'),t=upgLv(id,'tyr'),b=upgLv(id,'brk');return Object.assign({},r,{top:r.top*(1+.04*e),t100:r.t100/Math.pow(1+.07*e,.9),lat:r.lat*(1+.04*t),brk:r.brk/(1+.09*b)})}

/* ---------- the UPGRADES page of the car menu ---------- */
function upgLayout(W_,H_,u){const b=[],m=u*.3,pw=Math.min(W_*.5,u*8.8),px=W_-pw-m,py=m,ph=H_-m*2,x0=px+m,iw=pw-m*2,add=(id,x,y,w,h,act)=>b.push({id,x,y,w,h,act});
  const L={px,py,pw,ph,m,x0,iw,b};let y=py+u*1.25;L.rows=[];const rh=Math.min(u*.66,(ph-u*2.35)/5);
  UPG_DEF.forEach((d,i)=>{const ry=y+i*rh;L.rows.push({d,y:ry,h:rh});add('buy_'+d.k,x0+iw-u*1.9,ry+rh*.12,u*1.9,rh*.76,()=>upgTap(d.k))});
  y+=rh*5+u*.12;L.money=y;const bw=(iw-m)/2,by=py+ph-m-u*.5;add('cars',x0,by,bw,u*.5,()=>{MENU.tab=0});add('close',x0+bw+m,by,bw,u*.5,()=>menuClose());L.by=by;return L}
function upgTap(k){const d=CAR_ROSTER[MENU.i];if(!carOwned(MENU.i)){safeToast('BUY THIS CAR FIRST',2);return}const r=upgBuy(d.id,k);const D=UPG_DEF.find(q=>q.k==k);
  if(r=='OK')safeToast(D.name+'  STAGE '+upgLv(d.id,k),2.2);else if(r=='MAX')safeToast(D.name+'  FULLY UPGRADED',2);else safeToast(r+'  (YOU HAVE '+evMoney(ECON.money)+')',2.4)}
function upgDraw(c,W_,H_,u){const L=upgLayout(W_,H_,u),d=CAR_ROSTER[MENU.i],own=carOwned(MENU.i);MENU.btns=L.b;
  c.save();{const g=c.createLinearGradient(0,L.py,0,L.py+L.ph);g.addColorStop(0,'rgba(42,43,46,.96)');g.addColorStop(1,'rgba(24,25,27,.96)');c.fillStyle=g}rr(c,L.px,L.py,L.pw,L.ph,u*.24);c.fill();
  c.strokeStyle='rgba(255,255,255,.07)';c.lineWidth=1;rr(c,L.px+.5,L.py+.5,L.pw-1,L.ph-1,u*.24);c.stroke();
  if(MENU.garage){c.font=dLcd(u*.3);const gt=MENU.garage.toUpperCase(),gw=c.measureText(gt).width+u*.6;dLcdBox(c,u*.3,u*.3,gw,u*.55,u*.08);dLcdText(c,gt,u*.6,u*.3+u*.39,u*.3);
    c.font=dLcd(u*.26);const mt=evMoney(ECON.money),mw=c.measureText(mt).width+u*.5;dLcdBox(c,u*.3,u*.95,mw,u*.46,u*.07);dLcdText(c,mt,u*.55,u*.95+u*.33,u*.26)}   /* (batch 21: your money under the garage name) */
  c.textAlign='left';c.fillStyle='#fff';c.font=dFont(u*.44,700);{const wmax=L.iw-u*2.2,wn=c.measureText(d.name).width;if(wn>wmax)c.font=dFont(u*.44*wmax/wn,700)}c.fillText(d.name,L.x0,L.py+u*.6);
  c.textAlign='right';c.font=dLcd(u*.24);dLcdText(c,'UPGRADES',L.px+L.pw-L.m,L.py+u*.55,u*.24,'right');
  c.textAlign='left';c.fillStyle='#9b9ea4';c.font=dFont(u*.19,600);c.fillText(own?'Three stages per part. Bought for this car only.':'Buy this car first, then upgrade it.',L.x0,L.py+u*.95);
  for(const R of L.rows){const D=R.d,lv=upgLv(d.id,D.k),p=upgPrice(d.id,D.k),yy=R.y+R.h*.5;
    c.strokeStyle='rgba(255,255,255,.06)';c.beginPath();c.moveTo(L.x0,R.y+R.h-.5);c.lineTo(L.x0+L.iw,R.y+R.h-.5);c.stroke();
    c.fillStyle=DASH.ink;c.font=dFont(u*.24,700);c.fillText(D.name,L.x0,yy-u*.02);c.fillStyle='#8f8c84';c.font=dFont(u*.16,600);c.fillText(D.per,L.x0,yy+u*.2);
    for(let s=0;s<3;s++){const lx=L.x0+L.iw*.47+s*u*.34,on=s<lv;c.fillStyle=on?'#5dff7a':'#24342a';if(on){c.shadowColor='#5dff7a';c.shadowBlur=u*.18}c.beginPath();c.arc(lx,yy,u*.08,0,TAU);c.fill();c.shadowBlur=0}
    const bt=L.b.find(q=>q.id=='buy_'+D.k),can=own&&p!=null&&ECON.money>=p,pr=DASH.press[bt.id]&&performance.now()-DASH.press[bt.id]<160;
    const dd=dKey(c,bt.x,bt.y,bt.w,bt.h,u*.1,pr,can?'#ffb83a':'#34363a',can?'#d98a10':'#202226');c.textAlign='center';c.fillStyle=can?'#1b1406':(p==null?'#5dff7a':'#8f8c84');c.font=dFont(u*.19,700);
    c.fillText(p==null?'MAX':'STAGE '+(lv+1)+'  ·  '+evMoney(p),bt.x+bt.w/2,bt.y+bt.h*.64+dd);c.textAlign='left'}
  c.font=dLcd(u*.24);dLcdText(c,'YOU HAVE '+evMoney(ECON.money),L.x0,L.money+u*.3,u*.24);
  for(const id of['cars','close']){const bt=L.b.find(q=>q.id==id),pr=DASH.press[id]&&performance.now()-DASH.press[id]<160,dd=dKey(c,bt.x,bt.y,bt.w,bt.h,u*.12,pr);c.textAlign='center';c.fillStyle=DASH.ink;c.font=dFont(u*.24,700);c.fillText(id=='cars'?'CARS & PAINT':'BACK',bt.x+bt.w/2,bt.y+bt.h*.66+dd)}
  c.restore()}
