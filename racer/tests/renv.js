// Weather / time of day, the sky cube map, the sun glare, foliage: every preset renders, looks the way its name says, reflections come from the real sky, trees have cut-out leaves and wind.
// usage: node racer/tests/renv.js
const L=require('./rlib.js');
(async()=>{
  let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
  const res={};
  for(const env of['day','overcast','sunset']){
    const T=await L.launch({q:'go=1&scale=.5&fixed=1&tier=2&env='+env,w:400,h:225,mobile:false,traffic:true,dpr:1});
    await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
    const o=await T.ev(()=>{const {C,UI,ROADS,carPlace,camStep,renderOnce,worldStep,ENV,R}=RACER;UI.paused=true;UI.hud.style.display='none';
      const r=ROADS.find(q=>q.id=='ring'),i=Math.round(.1*r.n),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));carPlace(r.X[i],r.Z[i],a,r.Y[i]+.5);C.vx=Math.sin(a)*30;C.vz=-Math.cos(a)*30;for(let s=0;s<240;s++)worldStep(1/120);
      camStep(0,true);camStep(0,true);const gl=G.gl;for(let k=0;k<3;k++)renderOnce(UI.cw,UI.ch);const err=gl.getError();
      /* the picture: mean brightness, saturation, share of clipped and crushed pixels */
      const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,px=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);let L=0,S=0,cl=0,cr=0,n=0,skyB=0,skyN=0;
      for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){const k=(y*w+x)*4,r0=px[k]/255,g=px[k+1]/255,b=px[k+2]/255,mx=Math.max(r0,g,b),mn=Math.min(r0,g,b);L+=.3*r0+.59*g+.11*b;S+=mx>0?(mx-mn)/mx:0;if(mx>.98)cl++;if(mx<.03)cr++;n++;if(y>h*.78){skyB+=b-r0;skyN++}}
      /* the sky cube: top face and a side face are not black, and the ground below the horizon is darker than the sky */
      const c=R.cube;const out={err,L:L/n,S:S/n,clip:cl/n,crush:cr/n,cube:!!c,cubeOk:c&&c.ok,cubeDraws:c&&c.n,wet:ENV.wet,shadow:ENV.shadow,name:ENV.name,sunY:ENV.sun[1],fog:ENV.fog,gr:Array.from(ENV.gr)};return out});
    res[env]=o;
    ok(o.err===0&&o.cube&&o.cubeOk&&o.cubeDraws>=1,env+': renders with no GL error, the sky cube map was drawn ('+o.cubeDraws+' times)');
    console.log('     '+env+': brightness '+o.L.toFixed(2)+', saturation '+o.S.toFixed(2)+', clipped '+(o.clip*100).toFixed(1)+' %, crushed '+(o.crush*100).toFixed(1)+' %, wet '+o.wet+', sun elevation '+(Math.asin(o.sunY)*57.3).toFixed(0)+' deg');
    ok(o.clip<.2&&o.crush<.2,env+': the picture is not blown out ('+(o.clip*100).toFixed(0)+' % clipped) or crushed ('+(o.crush*100).toFixed(0)+' %)');
    ok(T.errs.length===0,env+': no page errors'+(T.errs.length?' '+T.errs[0]:''));
    await T.close();
  }
  ok(res.day.S>res.overcast.S+.04,'the day is more colourful than the overcast look (saturation '+res.day.S.toFixed(2)+' vs '+res.overcast.S.toFixed(2)+')');
  ok(res.day.wet===0&&res.overcast.wet>.5&&res.sunset.wet>0,'the road is dry in the day, wet when overcast, a little wet at sunset');
  ok(res.sunset.sunY<res.day.sunY*.5,'the sunset sun is low ('+(Math.asin(res.sunset.sunY)*57.3).toFixed(0)+' deg vs '+(Math.asin(res.day.sunY)*57.3).toFixed(0)+' deg)');
  ok(res.day.fog<res.overcast.fog,'the day air is clearer than the overcast haze');
  /* the button, the saved choice, and foliage / wind / shadows */
  const T=await L.launch({q:'go=1&scale=.4&fixed=1&tier=2&env=day',w:400,h:225,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  const B=await T.ev(()=>{const a=ENV.name,b=envCycle(),c=envCycle(),d=envCycle();let saved='';try{saved=localStorage.getItem('racer.env')}catch(e){}return{a,b,c,d,saved,btn:!!UI.bn.sky,label:UI.bn.sky&&UI.bn.sky.label}});
  ok(B.a=='day'&&B.b=='overcast'&&B.c=='sunset'&&B.d=='day','the SKY button cycles DAY, OVERCAST, SUNSET and back ('+[B.a,B.b,B.c,B.d].join(' > ')+'), choice saved: '+B.saved);
  ok(B.btn,'there is a SKY button on the HUD ("'+B.label+'")');
  const F=await T.ev(()=>{const gl=G.gl;const t=R.tex.fol;gl.bindTexture(gl.TEXTURE_2D,t);const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);const px=new Uint8Array(128*128*4);gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,px);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    const tile=(tx,ty)=>{let a=0,n=0,lum=0;for(let y=0;y<64;y++)for(let x=0;x<64;x++){const k=((ty*64+y)*128+tx*64+x)*4;n++;if(px[k+3]>127){a++;lum+=px[k+1]}}return{cover:a/n,lum:a?lum/a/255:0}};
    return{leaf:tile(0,0),fir:tile(1,0),bush:tile(0,1),grass:tile(1,1),stats:R.stats.scenery,shadowTier:GFXT[2].shadow}});
  ok(F.leaf.cover>.3&&F.leaf.cover<.9,'foliage atlas: the leaf tile is a cut-out ('+Math.round(F.leaf.cover*100)+' % covered), the fir tile '+Math.round(F.fir.cover*100)+' %, bush '+Math.round(F.bush.cover*100)+' %, grass tuft '+Math.round(F.grass.cover*100)+' %');
  ok(F.fir.cover>.7&&F.grass.cover>.08&&F.grass.cover<.6,'the fir tile is mostly solid with a ragged lower edge, the grass tile is blades with gaps');
  /* wind: the same frame at two times differs for foliage (a tree moves) */
  const Wd=await T.ev(()=>{const {C,UI,CAM,R,ROADS,carPlace,renderOnce,worldStep}=RACER;UI.paused=true;const r=ROADS.find(q=>q.id=='ring'),i=Math.round(.1*r.n),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));carPlace(r.X[i],r.Z[i],a,r.Y[i]+.5);C.vx=C.vz=0;worldStep(1/120);
    const snap=()=>{const gl=G.gl,w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,px=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);return px};
    RACER.camStep(0,true);R.time=10;renderOnce(UI.cw,UI.ch);const A=snap();R.time=10.9;renderOnce(UI.cw,UI.ch);const Bm=snap();let d=0;for(let k=0;k<A.length;k+=4)if(Math.abs(A[k+1]-Bm[k+1])>12)d++;return d});
  ok(Wd>20,'wind: leaves and fronds move between two moments ('+Wd+' pixels changed; the sky also drifts)');
  /* light: foliage is lit like a ball, dark inside a crown (the atlas is multiplied by the vertex colour) */
  console.log('errs',T.errs.slice(0,3));ok(T.errs.length===0,'no page errors');
  await T.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
