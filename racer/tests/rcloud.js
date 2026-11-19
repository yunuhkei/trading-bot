// (batch 75) cloud save with a fake account database: progress is uploaded, comes back after the browser is wiped, and nothing is written when nothing changed.  usage: RFILE=<built file> node racer/tests/rcloud.js
const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl']});
const store={};   // the fake cloud, kept in the test process
const ctx=await browser.newContext({viewport:{width:300,height:200}});
await ctx.exposeFunction('__cget',k=>store[k]?JSON.stringify(store[k]):null);await ctx.exposeFunction('__cset',(k,v)=>{store[k]=JSON.parse(v);return 1});
await ctx.addInitScript(()=>{window.__noAudio=1;window.__noTraffic=1;window.__writes=0;
  const db={doc:p=>({get:async()=>{const v=await window.__cget(p);return{exists:!!v,data:()=>v?JSON.parse(v):undefined}},set:async(d)=>{window.__writes++;await window.__cset(p,JSON.stringify(d))}})};
  window.claude={use:async n=>{await new Promise(r=>setTimeout(r,50));return n=='db'?db:n=='user'?{id:async()=>'u1'}:null}}});
const page=await ctx.newPage();const url='file://'+process.env.RFILE+'?go=1&scale=.3&fixed=1';
const boot=async()=>{await page.goto(url);await page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});await page.waitForTimeout(1500)};
// 1 first run: progress made, uploaded
await boot();await page.evaluate(()=>{ECON.money=12345;ECON.save&&ECON.save();localStorage.setItem('racer.money',JSON.stringify({money:12345}));storyLoad();STORY.ch=3;STORY.step=2;storySave()});await page.waitForTimeout(9500);
const up=store['data/users/u1/save'];console.log('1 uploaded:',!!up,up&&Object.keys(up.keys).join(','),'story',up&&up.keys['racer.story']);
// 2 the browser is wiped: the cloud copy comes back after one reload
await page.evaluate(()=>localStorage.clear());await boot();await page.waitForTimeout(3000);await page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});
const back=await page.evaluate(()=>{storyLoad();return{ch:STORY.ch,step:STORY.step,story:localStorage.getItem('racer.story'),reload:sessionStorage.getItem('racer.cloudReload')}});console.log('2 after wipe:',JSON.stringify(back));
// 3 no change: no extra writes in 10 s
const w0=await page.evaluate(()=>window.__writes);await page.waitForTimeout(10000);const w1=await page.evaluate(()=>window.__writes);console.log('3 writes with no change in 10 s:',w1-w0);
await browser.close()})();
