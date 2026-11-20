// (batch 77) your car and garage survive leaving and coming back: an unlocked story car stays your car, a bought car stays owned, an old save gets its story car, a save from batches 71-76 is kept, one from before the ladder is reset.  usage: RFILE=<built file> node racer/tests/rsave.js
const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl']});
const url='file://'+process.env.RFILE+'?go=1&scale=.3&fixed=1';
const boot=async(page)=>{await page.goto(url);await page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});await page.waitForTimeout(500)};
const car=page=>page.evaluate(()=>CAR_ROSTER[CARSEL.cur].name);
// A: an old save with the bug (story car Surge, saved car Drifter)
{const ctx=await browser.newContext({viewport:{width:300,height:200}});await ctx.addInitScript(()=>{window.__noAudio=1;window.__noTraffic=1;if(!localStorage.getItem('racer.story'))localStorage.setItem('racer.story',JSON.stringify({ch:2,step:1,car:'cc_n_nitro',cars:{cc_h_warden:1,cc_n_drifter:1,cc_n_nitro:1},done:false,open:true}));if(!localStorage.getItem('racer.cars'))localStorage.setItem('racer.cars',JSON.stringify({prog:2,owned:{cc_h_warden:true,cc_n_drifter:true,cc_n_nitro:true},curId:'cc_n_drifter'}))});
 const page=await ctx.newPage();const seq=[];for(let k=0;k<3;k++){await boot(page);seq.push(await car(page));await page.evaluate(()=>{storyBegin(false);for(let s=0;s<240;s++)RACER.worldStep(1/120)});seq.push('story:'+await car(page))}
 console.log('A old save, 3 visits:',seq.join(' > '));await ctx.close()}
// B: fresh player wins a story car, leaves, comes back
{const ctx=await browser.newContext({viewport:{width:300,height:200}});await ctx.addInitScript(()=>{window.__noAudio=1;window.__noTraffic=1});
 const page=await ctx.newPage();await boot(page);await page.evaluate(()=>{storyBegin(true);STORY.open=true;STORY.ch=1;STORY.step=STORY_CH[1].steps.findIndex(q=>q.k=='unlock');STORY.st={};for(let s=0;s<120;s++)RACER.worldStep(1/120)});const a=await car(page);
 const seq=[a];for(let k=0;k<3;k++){await boot(page);seq.push(await car(page));await page.evaluate(()=>{storyBegin(false);for(let s=0;s<240;s++)RACER.worldStep(1/120)});seq.push('story:'+await car(page))}
 console.log('B unlock then 3 visits:',seq.join(' > '));await ctx.close()}
await browser.close()})();
// C: a bought car survives coming back
(async()=>{const {chromium}=require('playwright');const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl']});
const url='file://'+process.env.RFILE+'?go=1&scale=.3&fixed=1';const ctx=await browser.newContext({viewport:{width:300,height:200}});await ctx.addInitScript(()=>{window.__noAudio=1;window.__noTraffic=1});const page=await ctx.newPage();
const boot=async()=>{await page.goto(url);await page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});await page.waitForTimeout(500)};
await boot();await page.evaluate(()=>{EV.rec.__t={m:3};evSave();ECON.money=99999;const i=carRanks().indexOf(1);menuOpen();menuPreview(i);menuChoose()});const seq=[];
for(let k=0;k<2;k++){await boot();seq.push(await page.evaluate(()=>CAR_ROSTER[CARSEL.cur].name+' owned '+Object.keys(CAROWN.owned).filter(k=>CAROWN.owned[k]).join('+')))}
console.log('C bought a car, 2 visits:',seq.join(' > '));await browser.close()})();
(async()=>{const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl']});
const url='file://'+process.env.RFILE+'?go=1&scale=.3&fixed=1';
for(const [name,cars] of [['buggy 71-76 save',{owned:{cc_h_warden:true,cc_n_drifter:true,cc_coupe:true},allv2:false,curId:'cc_coupe'}],['pre-ladder save',{owned:{k1:true,h2:true},all:false,curId:'h2'}]]){
 const ctx=await browser.newContext({viewport:{width:300,height:200}});await ctx.addInitScript((cars)=>{window.__noAudio=1;window.__noTraffic=1;if(!sessionStorage.getItem('x')){sessionStorage.setItem('x',1);localStorage.setItem('racer.cars',JSON.stringify(cars))}},cars);
 const page=await ctx.newPage();const seq=[];for(let k=0;k<2;k++){await page.goto(url);await page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:300000});seq.push(await page.evaluate(()=>CAR_ROSTER[CARSEL.cur].name+' owned '+Object.keys(CAROWN.owned).filter(k=>CAROWN.owned[k]).join('+')))}
 console.log(name+':',seq.join(' > '));await ctx.close()}
await browser.close()})();
