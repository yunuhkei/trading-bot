// The High-only detail (batch 45): prop categories 3 (piers, bands, crowns, extra leaf cards) and 4 (window fins, doors, fire escapes, street props) are recorded at load and built the first time
// the High tier is used, so Low and Medium phones never hold their buffers; only High draws them; nothing about the world changes.
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1',w:240,h:160,mobile:false,traffic:false});await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  const cnt=()=>T.ev(()=>{const t=[0,0,0,0,0],m=[0,0,0,0,0];for(const p of RACER.R.props){t[p.cat]+=p.n/3;m[p.cat]++}return{t,m,det:RACER.BOOT.detMs,dp:RACER.R.drawProp.slice(),tier:RACER.GFX.tier,sprops:RACER.BOOT.sprops,facades:RACER.BOOT.facades}});
  let a=await cnt();
  ok(a.t[3]==0&&a.t[4]==0&&a.det==null,'1 at load (fixed tier 0) there are no detail meshes: '+a.t.map(x=>Math.round(x/1000)+'k').join(' / '));
  ok(a.dp[3]==0&&a.dp[4]==0,'2 Low draws no detail (ranges '+a.dp.join(', ')+')');
  await T.ev(()=>{RACER.UI.paused=true;RACER.gfxSetMode('auto');RACER.gfxSetTier(1);RACER.renderOnce(RACER.UI.cw,RACER.UI.ch)});a=await cnt();
  ok(a.tier==1&&a.t[3]==0&&a.dp[3]==0&&a.dp[4]==0,'3 Medium builds and draws none either');
  await T.ev(()=>{RACER.gfxSetMode('high');RACER.gfxSetTier(2);RACER.renderOnce(RACER.UI.cw,RACER.UI.ch)});a=await cnt();
  ok(a.tier==2&&a.det!=null&&a.t[3]>800000&&a.t[4]>100000,'4 High builds them once: '+Math.round(a.t[3]/1000)+'k and '+Math.round(a.t[4]/1000)+'k triangles in '+a.det+' ms (software GL box)');
  ok(a.dp[3]>0&&a.dp[4]>0&&a.dp[4]<a.dp[3],'5 only High draws them, the fine detail nearer (ranges '+a.dp.join(', ')+')');
  ok(a.sprops>2000&&a.facades>100,'6 '+a.sprops+' sidewalk props and '+a.facades+' building facades were recorded');
  const n1=a.t[3];await T.ev(()=>{RACER.gfxSetTier(1);RACER.gfxSetTier(2);RACER.renderOnce(RACER.UI.cw,RACER.UI.ch)});a=await cnt();
  ok(a.t[3]==n1,'7 switching tiers again builds nothing twice');
  console.log('errs',T.errs.length?T.errs:0);await T.close();process.exit(bad||T.errs.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
