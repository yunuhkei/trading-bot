const L=require('./rlib.js');
const views=JSON.parse(process.argv[2]||'[["ring",0.3],["mp",0.15],["mp",0.3],["mp",0.55],["cr",0.4],["sh",0.6],["bv",0.5],["ns3",0.5]]');
const name=process.argv[3]||'gal';const W=+(process.argv[4]||667),H=+(process.argv[5]||375);const back=+(process.argv[6]||0);
(async()=>{
  const T=await L.launch({q:'go=1&scale=1&fixed=1',w:W,h:H,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  await T.ev(()=>{RACER.UI.paused=true;RACER.UI.showStats=false});
  const out=[];
  for(let k=0;k<views.length;k++){
    const v=views[k];
    const r=await T.ev(([id,f,off,run])=>{const {C,ROADS,R}=RACER;const r=ROADS.find(q=>q.id==id);if(!r)return 'noroad '+id;const i=Math.max(1,Math.min(r.n-3,Math.round(f*r.n)));
      const a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));const side=(off==null?r.hw*.5:off);
      const x=r.X[i]+Math.cos(a)*side,z=r.Z[i]+Math.sin(a)*side;RACER.carPlace(x,z,a,r.Y[i]+.5);
      for(let s=0;s<(run||0)*120;s++){C.vx=Math.sin(C.yaw)*30;C.vz=-Math.cos(C.yaw)*30;RACER.carStep(1/120)}
      RACER.camStep(0,true);RACER.renderOnce(RACER.UI.cw,RACER.UI.ch);return {x:Math.round(C.x),z:Math.round(C.z),y:C.y.toFixed(1),draws:R.draws,tris:R.tris}},[v[0],v[1],v[2],v[3]||0]);
    await L.sleep(120);
    const p=L.SP+'/shots/'+name+k+'.png';await T.page.screenshot({path:p});out.push(p);console.log(k,JSON.stringify(v),JSON.stringify(r));
  }
  if(T.errs.length)console.log('ERRS',T.errs.slice(0,5));
  const py=`from PIL import Image\nps=${JSON.stringify(out)}\nims=[Image.open(p) for p in ps]\nw,h=ims[0].size\ncols=2\nrows=(len(ims)+cols-1)//cols\nS=Image.new('RGB',(w*cols,h*rows))\nfor i,im in enumerate(ims):S.paste(im,((i%cols)*w,(i//cols)*h))\nS.save('${L.SP}/shots/${name}_sheet.png')`;
  require('fs').writeFileSync(L.SP+'/sheet_tmp.py',py);require('child_process').execSync('python3 '+L.SP+'/sheet_tmp.py');
  await T.close();
})().catch(e=>{console.error(e);process.exit(1)});
