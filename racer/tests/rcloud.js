// (batch 86) cloud save safety with a fake account database: upload + best copy, a wiped browser gets it back, failed reads write nothing, a browser with less progress cannot overwrite the account copy, a reset main copy is replaced by the best one.  usage: RFILE=<built file> node racer/tests/rcloud.js
const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl']});
const store={};let failReads=false,writes=0;
const ctx=await browser.newContext({viewport:{width:300,height:200}});
await ctx.exposeFunction('__cget',k=>{if(failReads)throw new Error('net');return store[k]?JSON.stringify(store[k]):null});await ctx.exposeFunction('__cset',(k,v)=>{writes++;store[k]=JSON.parse(v);return 1});
await ctx.addInitScript(()=>{window.__noAudio=1;window.__noTraffic=1;
  const db={doc:p=>({get:async()=>{const v=await window.__cget(p);return{exists:!!v,data:()=>v?JSON.parse(v):undefined}},set:async(d)=>{await window.__cset(p,JSON.stringify(d))}})};
  window.claude={use:async n=>{await new Promise(r=>setTimeout(r,50));return n=='db'?db:n=='user'?{id:async()=>'u1'}:null}}});
const page=await ctx.newPage();const url='file://'+process.env.RFILE+'?go=1&scale=.3&fixed=1';
const boot=async()=>{await page.goto(url);await page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});await page.waitForTimeout(2500)};
const story=()=>store['data/users/u1/save']&&JSON.parse(store['data/users/u1/save'].keys['racer.story']||'null');
// 1 progress made and uploaded
await boot();await page.evaluate(()=>{storyLoad();STORY.ch=3;STORY.step=4;storySave()});await page.waitForTimeout(9500);
console.log('1 uploaded: ch',story()&&story().ch,'step',story()&&story().step,'| best:',!!store['data/users/u1/save_best']);
// 2 wiped browser: comes back
await page.evaluate(()=>localStorage.clear());await boot();await page.waitForTimeout(3000);await page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});
console.log('2 after wipe:',await page.evaluate(()=>{storyLoad();return STORY.ch+'/'+STORY.step}));
// 3 read fails on a wiped browser: nothing written
await page.evaluate(()=>localStorage.clear());failReads=true;const w0=writes;await boot();await page.waitForTimeout(12000);
console.log('3 reads failing, wiped browser: writes',writes-w0,'| cloud still ch',story().ch);failReads=false;
// 4 a browser whose save went backwards (as if the old game wrote over it) but whose clock says it is up to date: not sent; the account copy comes back
await page.waitForTimeout(21000);await page.evaluate(()=>{const t=localStorage.getItem('racer.cloudT');localStorage.setItem('racer.story',JSON.stringify({ch:1,step:1,car:'cc_h_warden',cars:{cc_h_warden:1},done:false,open:false,flags:{}}))});
const w1=writes;await page.waitForTimeout(9500);console.log('4 lower progress in this browser: writes',writes-w1,'| cloud ch',story().ch);
await boot();await page.waitForTimeout(3000);await page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});console.log('4 reopened:',await page.evaluate(()=>{storyLoad();return STORY.ch+'/'+STORY.step}));
// 5 the main copy got overwritten with a fresh game somehow: the best copy wins
store['data/users/u1/save']={t:Date.now()+5000,v:2,score:1000,keys:{'racer.story':JSON.stringify({ch:1,step:0,car:'cc_h_warden',cars:{cc_h_warden:1},done:false,open:false,flags:{}})}};
await page.evaluate(()=>localStorage.clear());await boot();await page.waitForTimeout(3000);await page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});console.log('5 main copy reset, best kept:',await page.evaluate(()=>{storyLoad();return STORY.ch+'/'+STORY.step}));
await browser.close()})();
