// Screenshots of a car from several sides on the road (the generated bodies). usage: node racer/tests/rcarshot.js [carIndex ...] ; ANGLES=front34,side,rear34,top ; TIER=1
const L=require('./rlib.js');
const idx=process.argv.slice(2).map(Number);if(!idx.length)idx.push(0);
const angs=(process.env.ANGLES||'front34,side,rear34,top').split(',');
(async()=>{
  const T=await L.launch({q:'go=1&scale=1&tier='+(process.env.TIER||1),w:+(process.env.W||900),h:+(process.env.H||506),mobile:false,traffic:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  const out=[];
  for(const ci of idx){
    for(const an of angs){
      await T.ev(([ci,an])=>{const {C,ROADS,UI,CAM,R}=RACER;UI.paused=true;UI.showStats=false;UI.hud.style.display='none';window.camStep=function(){};
        if(RACER.carSelect)RACER.carSelect(ci);
        const r=ROADS.find(q=>q.id=='ring'),i=Math.round(.3*r.n),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));RACER.carPlace(r.X[i]+Math.cos(a)*r.hw*.5,r.Z[i]+Math.sin(a)*r.hw*.5,a,r.Y[i]+.5);
        const sy=Math.sin(a),cy=Math.cos(a),fwd=[sy,-cy],right=[cy,sy],set=(f,rt,up,dist)=>{CAM.x=C.x+fwd[0]*f+right[0]*rt;CAM.z=C.z+fwd[1]*f+right[1]*rt;CAM.y=C.y+up;CAM.tx=C.x;CAM.ty=C.y+.55;CAM.tz=C.z;CAM.fov=.5};
        if(an=='front34')set(5.8,4.2,1.4);else if(an=='side')set(0,8.2,.9);else if(an=='rear34')set(-5.8,-4.4,1.5);else if(an=='top')set(.1,0,9.5);else if(an=='front')set(8,0,.9);else if(an=='rear')set(-8,0,1.0);
        R.alpha=1;RACER.renderOnce(UI.cw,UI.ch)},[ci,an]);
      await L.sleep(150);const p=L.SP+'/shots/car'+ci+'_'+an+'.png';await T.page.screenshot({path:p});out.push(p)}}
  console.log(T.errs.slice(0,3));
  require('fs').writeFileSync(L.SP+'/sheet_tmp.py',`from PIL import Image\nps=${JSON.stringify(out)}\nims=[Image.open(p) for p in ps]\nw,h=ims[0].size\ncols=${+(process.env.COLS||angs.length)}\nrows=(len(ims)+cols-1)//cols\nS=Image.new('RGB',(w*cols,h*rows))\nfor i,im in enumerate(ims):S.paste(im,((i%cols)*w,(i//cols)*h))\nS.save('${L.SP}/shots/cars_sheet.png')\n`);
  require('child_process').execSync('python3 '+L.SP+'/sheet_tmp.py');await T.close();
})();
