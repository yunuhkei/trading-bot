'use strict';
/* ===== (batch 75, made safe in batch 86) CLOUD SAVE: your progress is kept in your Claude account, not only in the browser =====
   Inside claude.ai the page asks for its private database (the artifact's `db` capability, documents only you can read: data/users/<your id>/save and .../save_best) and keeps a copy of
   every 'racer.*' save there: the story, cars, money, garages, events, upgrades, tokens and settings. Browser storage can be wiped (the app clears it, a private window has none);
   the cloud copy is not. Every 8 s (and when the page is hidden) a CHANGED save is sent (one write at a time).
   (batch 86) SAFETY, after a fresh game overwrote a real one:
   - nothing is written until the cloud copy has been READ (a failed read used to look like "no save yet", and the fresh game was sent over the real one); a failed read is retried every 20 s;
   - a save is never sent if it has LESS progress than the cloud copy (story chapter and step, races won, cars, money), unless you deliberately started a new story;
   - the best save ever sent is kept as well (save_best); a cloud copy with less progress than it is replaced by it when the game opens;
   - while the cloud copy is being written back into the browser (before the page reloads to load it), the game's own saves are held, so the old game cannot write over it.
   Opening the game with a newer or better cloud copy writes it into browser storage and reloads once. Outside claude.ai (a plain file, the tests) nothing changes. */
const CLOUD={db:null,ref:null,best:null,last:'',busy:false,ok:false,lsOK:true,read:false,freeze:false,status:'',key:'racer.cloudT',cloudScore:0,bestScore:0};
/* hold the game's saves while a cloud copy is being restored */
try{const SP=Storage.prototype,si=SP.setItem,ri=SP.removeItem;SP.setItem=function(k,v){if(CLOUD.freeze&&this===window.localStorage&&String(k).indexOf('racer.')==0&&!CLOUD.own)return;return si.call(this,k,v)};
  SP.removeItem=function(k){if(CLOUD.freeze&&this===window.localStorage&&String(k).indexOf('racer.')==0&&!CLOUD.own)return;return ri.call(this,k)}}catch(e){}
function cloudSnap(){const k={};try{for(let i=0;i<localStorage.length;i++){const n=localStorage.key(i);if(n&&n.indexOf('racer.')==0&&n!==CLOUD.key)k[n]=localStorage.getItem(n)}}catch(e){CLOUD.lsOK=false}return k}
function cloudPack(k){let s=JSON.stringify(k);if(s.length>240000&&k['racer.events']){try{const ev=JSON.parse(k['racer.events']);for(const id in ev)if(ev[id]&&ev[id].ghost)delete ev[id].ghost;k=Object.assign({},k,{'racer.events':JSON.stringify(ev)});s=JSON.stringify(k)}catch(e){}}return{k,s}}
/* how far a save has got: the story first, then races won, cars, money */
function cloudScore(k){if(!k)return 0;const J=n=>{try{return JSON.parse(k[n]||'null')}catch(e){return null}};let sc=0;
  const st=J('racer.story');if(st)sc+=(st.done?6:(st.ch|0))*1000+(st.step|0)*20;
  const ev=J('racer.events');if(ev)for(const id in ev){const r=ev[id];if(r&&((r.m|0)>=3||(r.done|0)>0))sc+=15}
  const cs=J('racer.cars');if(cs&&cs.owned)sc+=Object.keys(cs.owned).filter(x=>cs.owned[x]).length*10;
  const mo=J('racer.money');if(mo)sc+=Math.min(1e6,+(mo.money!=null?mo.money:mo)||0)/1e4;return sc}
const cloudReset=k=>+(k&&k['racer.reset']||0);   /* when you last deliberately started a new story */
async function cloudWrite(force){if(!CLOUD.ref||!CLOUD.read||CLOUD.busy||!CLOUD.lsOK||CLOUD.freeze)return;const p=cloudPack(cloudSnap());if(!CLOUD.lsOK)return;if(!force&&p.s===CLOUD.last)return;if(p.s.length>250000)return;
  const sc=cloudScore(p.k),resetNew=cloudReset(p.k)>(CLOUD.cloudT||0);
  if(sc+.5<CLOUD.cloudScore&&!resetNew){CLOUD.status='held: less progress than your account copy';return}   /* never send a save that has got less far, unless you started over yourself */
  CLOUD.busy=true;const t=Date.now();try{await CLOUD.ref.set({t,v:2,score:sc,keys:p.k});CLOUD.last=p.s;CLOUD.cloudScore=sc;CLOUD.cloudT=t;try{CLOUD.own=1;localStorage.setItem(CLOUD.key,String(t))}catch(e){}finally{CLOUD.own=0}
    if(CLOUD.best&&(sc>=CLOUD.bestScore||resetNew)){await CLOUD.best.set({t,v:2,score:sc,keys:p.k});CLOUD.bestScore=sc}CLOUD.ok=true;CLOUD.status='saved'}
  catch(e){CLOUD.status='error '+((e&&e.code)||'')}finally{CLOUD.busy=false}}
async function cloudRead(){let a=null,b=null,ok=false;for(let i=0;i<2&&!ok;i++){try{a=await CLOUD.ref.get();b=await CLOUD.best.get();ok=true}catch(e){if(i==0)await new Promise(r=>setTimeout(r,800+Math.random()*700))}}return ok?{a,b}:null}
async function cloudSync(){const R=await cloudRead();if(!R){CLOUD.status='could not read your account copy: retrying';setTimeout(cloudSync,20000);return}   /* (batch 86) no writes until it has been read */
  const local=cloudSnap();if(!CLOUD.lsOK){CLOUD.status='no browser storage';return}
  let localT=0;try{localT=+(localStorage.getItem(CLOUD.key)||0)}catch(e){}
  let d=R.a&&R.a.exists?R.a.data():null;const bd=R.b&&R.b.exists?R.b.data():null;
  if(d&&!d.keys)d=null;CLOUD.bestScore=bd&&bd.keys?cloudScore(bd.keys):0;
  /* the account copy fell behind the best one (and you did not start over): use the best one */
  if(bd&&bd.keys&&(!d||cloudScore(d.keys)+.5<CLOUD.bestScore)&&!(d&&cloudReset(d.keys)>(bd.t||0)))d=bd;
  CLOUD.cloudScore=d?cloudScore(d.keys):0;CLOUD.cloudT=d?(+d.t||0):0;
  if(d){const cloudS=JSON.stringify(d.keys),localS=cloudPack(local).s,ls=cloudScore(local),resetNew=cloudReset(local)>(+d.t||0);
    const take=cloudS!==localS&&!resetNew&&((+d.t||0)>localT||ls+.5<CLOUD.cloudScore);
    if(take){/* load the account copy: hold the game's saves, write it in, reload */
      CLOUD.freeze=true;let wrote=false;try{CLOUD.own=1;for(const n of Object.keys(local))if(!(n in d.keys))localStorage.removeItem(n);for(const n in d.keys)localStorage.setItem(n,String(d.keys[n]));localStorage.setItem(CLOUD.key,String(d.t||Date.now()));
        wrote=localStorage.getItem('racer.story')===(d.keys['racer.story']==null?null:String(d.keys['racer.story']))}catch(e){wrote=false}finally{CLOUD.own=0}
      let again=false;try{again=sessionStorage.getItem('racer.cloudReload')==String(d.t)}catch(e){}
      if(wrote&&!again){try{sessionStorage.setItem('racer.cloudReload',String(d.t))}catch(e){}location.reload();return}
      CLOUD.last=cloudS;CLOUD.lsOK=false;CLOUD.status='could not load your account copy here';return}   /* never overwrite it from this browser */
    CLOUD.last=cloudS===localS?cloudS:''}
  CLOUD.read=true;CLOUD.ok=true;CLOUD.status='on';if(typeof safeToast=='function')safeToast('PROGRESS SAVES TO YOUR ACCOUNT',2.6);
  await cloudWrite(false);
  if(!CLOUD.timer){CLOUD.timer=setInterval(()=>{cloudWrite(false)},8000);const flush=()=>{cloudWrite(false)};document.addEventListener('visibilitychange',()=>{if(document.visibilityState=='hidden')flush()});window.addEventListener('pagehide',flush)}}
async function cloudStart(){if(typeof window=='undefined'||!window.claude||typeof window.claude.use!='function')return;
  let db=null,user=null;try{db=await window.claude.use('db');user=await window.claude.use('user')}catch(e){return}if(!db||!user)return;
  let id=null;try{id=await user.id()}catch(e){}if(!id)return;
  try{CLOUD.ref=db.doc('data/users/'+id+'/save');CLOUD.best=db.doc('data/users/'+id+'/save_best')}catch(e){return}CLOUD.db=db;
  await cloudSync()}
if(typeof window!='undefined')setTimeout(()=>{cloudStart()},0);
