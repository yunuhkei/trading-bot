const L=require('./rlib.js');
(async()=>{
  for(const [w,h] of [[667,375],[568,320]]){
    const T=await L.launch({file:L.DEFAULT_FILE,q:'scale=.5&fixed=1',w,h,mobile:true});
    await T.page.waitForSelector('#go',{state:'visible',timeout:120000});
    const before=await T.ev(()=>({load:!document.getElementById('load').classList.contains('off'),btn:getComputedStyle(document.getElementById('go')).display}));
    await T.page.tap('#go');await L.sleep(1800);
    const after=await T.ev(()=>({off:document.getElementById('load').classList.contains('off'),kmh:RACER.C.kmh|0,err:document.getElementById('err').textContent}));
    console.log(w+'x'+h,'before',JSON.stringify(before),'after',JSON.stringify(after),'errs',T.errs);
    await T.close();}
})().catch(e=>{console.error(e);process.exit(1)});
