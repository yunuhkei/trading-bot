'use strict';
/* ===== (batch 75) CLOUD SAVE: your progress is kept in your Claude account, not only in the browser =====
   Inside claude.ai the page asks for its private database (the artifact's `db` capability, a document only you can read: data/users/<your id>/save) and keeps a copy of
   every 'racer.*' save there: the story, cars, money, garages, events, upgrades, tokens and settings. Browser storage can be wiped (the app clears it, a private window has none);
   the cloud copy is not. HOW: every 8 s (and when the page is hidden) the saves are compared with the last copy sent, and only a change is written (one write at a time).
   On opening, a cloud copy newer than this browser's is written back into browser storage and the page reloads once to load it; a browser with nothing saved takes the
   cloud copy too. Outside claude.ai (a plain file, the tests) there is no database and nothing changes. Trial ghosts are left out if the copy would be too big (256 KiB a document). */
const CLOUD={db:null,ref:null,last:'',busy:false,t:0,ok:false,lsOK:true,status:'',key:'racer.cloudT'};
function cloudSnap(){const k={};try{for(let i=0;i<localStorage.length;i++){const n=localStorage.key(i);if(n&&n.indexOf('racer.')==0&&n!==CLOUD.key)k[n]=localStorage.getItem(n)}}catch(e){CLOUD.lsOK=false}return k}
function cloudPack(k){let s=JSON.stringify(k);if(s.length>240000&&k['racer.events']){try{const ev=JSON.parse(k['racer.events']);for(const id in ev)if(ev[id]&&ev[id].ghost)delete ev[id].ghost;k=Object.assign({},k,{'racer.events':JSON.stringify(ev)});s=JSON.stringify(k)}catch(e){}}return{k,s}}
const cloudHasProgress=k=>!!(k['racer.story']||k['racer.cars']||k['racer.events']||k['racer.money']);
async function cloudWrite(force){if(!CLOUD.ref||CLOUD.busy||!CLOUD.lsOK)return;const p=cloudPack(cloudSnap());if(!CLOUD.lsOK)return;if(!force&&p.s===CLOUD.last)return;if(p.s.length>250000)return;
  if(CLOUD.hadStory&&!p.k['racer.story'])return;   /* never replace a saved story with a browser that lost it */
  CLOUD.busy=true;const t=Date.now();try{await CLOUD.ref.set({t,v:1,keys:p.k});CLOUD.last=p.s;try{localStorage.setItem(CLOUD.key,String(t))}catch(e){}if(!CLOUD.ok){CLOUD.ok=true}CLOUD.status='saved'}
  catch(e){CLOUD.status='error '+((e&&e.code)||'')}finally{CLOUD.busy=false}}
async function cloudStart(){if(typeof window=='undefined'||!window.claude||typeof window.claude.use!='function')return;
  let db=null,user=null;try{db=await window.claude.use('db');user=await window.claude.use('user')}catch(e){return}if(!db||!user)return;
  let id=null;try{id=await user.id()}catch(e){}if(!id)return;
  try{CLOUD.ref=db.doc('data/users/'+id+'/save')}catch(e){return}CLOUD.db=db;
  let snap=null;for(let a=0;a<2&&!snap;a++){try{snap=await CLOUD.ref.get()}catch(e){if(a==0)await new Promise(r=>setTimeout(r,800+Math.random()*700))}}
  const local=cloudSnap();let localT=0;try{localT=+(localStorage.getItem(CLOUD.key)||0)}catch(e){}
  const d=snap&&snap.exists?snap.data():null;
  if(!CLOUD.lsOK){CLOUD.status='no browser storage';return}   /* nothing can be kept here: leave the cloud copy alone */
  CLOUD.hadStory=!!(d&&d.keys&&d.keys['racer.story']);
  if(d&&d.keys&&typeof d.keys=='object'){
    const cloudS=JSON.stringify(d.keys),localS=cloudPack(local).s;
    if(cloudS!==localS&&((+d.t||0)>localT||!cloudHasProgress(local))){
      /* the cloud copy is newer (or this browser has nothing): load it */
      let wrote=false;try{for(const n of Object.keys(local))if(!(n in d.keys))localStorage.removeItem(n);for(const n in d.keys)localStorage.setItem(n,String(d.keys[n]));localStorage.setItem(CLOUD.key,String(d.t||Date.now()));wrote=localStorage.getItem('racer.story')===(d.keys['racer.story']==null?null:String(d.keys['racer.story']))}catch(e){wrote=false}
      let again=false;try{again=sessionStorage.getItem('racer.cloudReload')==String(d.t)}catch(e){}
      if(wrote&&!again){try{sessionStorage.setItem('racer.cloudReload',String(d.t))}catch(e){}location.reload();return}
      CLOUD.last=cloudS;CLOUD.lsOK=false;return}   /* it could not be written here: never overwrite it from this browser */
    else CLOUD.last=cloudS===localS?cloudS:'';   /* the same: nothing to send; this browser newer: sent below */
  }
  CLOUD.ok=true;CLOUD.status='on';if(typeof safeToast=='function')safeToast('PROGRESS SAVES TO YOUR ACCOUNT',2.6);
  await cloudWrite(false);
  setInterval(()=>{cloudWrite(false)},8000);
  const flush=()=>{cloudWrite(false)};document.addEventListener('visibilitychange',()=>{if(document.visibilityState=='hidden')flush()});window.addEventListener('pagehide',flush)}
if(typeof window!='undefined')setTimeout(()=>{cloudStart()},0);
