// Screenshots of the traffic: park the car beside a road (on the shoulder), let the traffic run for a while, take a picture from the chase camera.
// usage: node racer/tests/rtrshot.js '[["sfnu3",0.5],["ring",0.3]]' name [seconds=30] [W=667] [H=375]
const L=require('./rlib.js');
const views=JSON.parse(process.argv[2]||'[["ring",0.3],["sfnu3",0.5],["lau1",0.5],["sh",0.4]]');const name=process.argv[3]||'tr';const secs=+(process.argv[4]||30),W=+(process.argv[5]||667),H=+(process.argv[6]||375);
(async()=>{
  const T=await L.launch({q:'go=1&scale=1&fixed=1',w:W,h:H,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  await T.ev(()=>{RACER.UI.paused=true;RACER.UI.showStats=true});const out=[];
  for(let k=0;k<views.length;k++){const v=views[k];
    const r=await T.ev(([id,f,secs])=>{const {C,ROADS,R,TR}=RACER;const r=ROADS.find(q=>q.id==id);const i=Math.max(3,Math.min(r.n-4,Math.round(f*r.n)));
      const a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));const side=r.hw+RSH+1.2;
      TR.cars.forEach(c=>c.alive=0);TR.nAlive=0;TR.boot=1;TR.t=0;RACER.carPlace(r.X[i]+Math.cos(a)*side,r.Z[i]+Math.sin(a)*side,a,r.Y[i]+.5);
      for(let s=0;s<secs*120;s++)RACER.worldStep(1/120);
      RACER.camStep(0,true);R.alpha=1;RACER.renderOnce(RACER.UI.cw,RACER.UI.ch);return {alive:TR.nAlive,drawn:TR.drawn,draws:R.draws,tris:R.tris,ms:TR.ms.toFixed(2)}},[v[0],v[1],secs]);
    await L.sleep(150);const p=L.SP+'/shots/'+name+k+'.png';await T.page.screenshot({path:p});out.push(p);console.log(k,JSON.stringify(v),JSON.stringify(r))}
  if(T.errs.length)console.log('ERRS',T.errs.slice(0,5));
  const py=`from PIL import Image\nps=${JSON.stringify(out)}\nims=[Image.open(p) for p in ps]\nw,h=ims[0].size\ncols=2\nrows=(len(ims)+cols-1)//cols\nS=Image.new('RGB',(w*cols,h*rows))\nfor i,im in enumerate(ims):S.paste(im,((i%cols)*w,(i//cols)*h))\nS.save('${L.SP}/shots/${name}_sheet.png')\nprint('sheet')`;
  require('fs').writeFileSync(L.SP+'/sheet_tmp.py',py);try{console.log(require('child_process').execSync('python3 '+L.SP+'/sheet_tmp.py').toString())}catch(e){console.log('no PIL')}
  await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
