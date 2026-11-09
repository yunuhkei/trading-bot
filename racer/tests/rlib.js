// Playwright helper for the racer (software GL in this headless browser)
const path=require('path'),fs=require('fs'),os=require('os');
let chromium;try{({chromium}=require('playwright'))}catch(e){({chromium}=require('/opt/node22/lib/node_modules/playwright'))}
/* SP = where screenshots and temporary output go (RACER_OUT to change); DEFAULT_FILE = the built game (RFILE to test another build) */
const SP=process.env.RACER_OUT||path.join(os.tmpdir(),'racer-tests');fs.mkdirSync(path.join(SP,'shots'),{recursive:true});
const DEFAULT_FILE=process.env.RFILE||path.resolve(__dirname,'..','..','Racer_Prototype.html');
async function launch(o){
  o=Object.assign({file:DEFAULT_FILE,w:667,h:375,q:'go=1&scale=1&fixed=1',dpr:1,mobile:true},o||{});
  const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl']});
  const ctx=await browser.newContext({viewport:{width:o.w,height:o.h},deviceScaleFactor:o.dpr,hasTouch:o.mobile,isMobile:o.mobile});
  await ctx.addInitScript('window.__noAudio=1;window.__keepBuf=1;window.__shot=1');
  const page=await ctx.newPage();const errs=[],logs=[];
  page.on('console',m=>{const t=m.type();if(/GL Driver Message|GPU stall|swiftshader/i.test(m.text()))return;if(t=='error'||t=='warning')errs.push(t+': '+m.text());else logs.push(m.text())});
  page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await page.goto('file://'+o.file+(o.q?'?'+o.q:''));
  return{browser,page,errs,logs,ev:(s,a)=>page.evaluate(s,a),close:()=>browser.close(),o};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
module.exports={launch,sleep,SP,DEFAULT_FILE};
