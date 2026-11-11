// Car looks: every player car and every traffic body is built with its lamps, mesh grilles, plates with characters, window trim, mirrors and wheels; the shader gives the glass a reflection and the grille a mesh.
// usage: node racer/tests/rcarlook.js
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({q:'go=1&scale=.3&fixed=1&tier=2&env=day',w:320,h:200,mobile:false,traffic:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:180000});
  let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
  const G=await T.ev(()=>{const rows=[];for(const def of RACER.CAR_ROSTER.filter(d=>!d.cc)){const B=RACER.cgBuild(def.spec),b=B.body;let c={};for(let v=0;v<b.nv;v++)c[b.M[v]]=(c[b.M[v]]||0)+1;
      rows.push({n:def.name,tris:b.I.length/3,grille:c[CGM.grille]||0,amber:c[CGM.amber]||0,plate:c[CGM.plate]||0,carbon:c[CGM.carbon]||0,head:c[CGM.head]||0,tail:c[CGM.tail]||0,chrome:c[CGM.chrome]||0})}return rows});
  ok(G.every(r=>r.grille>0&&r.amber>0&&r.plate>0&&r.head>0&&r.tail>0),'1 all '+G.length+' player cars have a mesh grille, amber indicators, a number plate, head lights and tail lights');
  ok(G.every(r=>r.carbon>150),'1 and characters on the plates (dark quads: fewest '+Math.min(...G.map(r=>r.carbon))+' vertices)');
  ok(G.every(r=>r.tris>9000&&r.tris<17000),'1 triangle counts stay sane: '+Math.min(...G.map(r=>r.tris))+'-'+Math.max(...G.map(r=>r.tris)));
  const Tr=await T.ev(()=>{const out=[];for(let i=0;i<5;i++){const m=trGenType(i);let c={};for(let v=0;v<m.M.length;v++){const id=m.M[v]&15;c[id]=(c[id]||0)+1}out.push({i,tris:m.I.length/3,white:c[12]||0,amber:c[13]||0,tail:c[4]||0,head:c[3]||0,chrome:c[5]||0,glass:c[1]||0,pm:m.pm})}return out});
  ok(Tr.every(t=>t.tris>3500&&t.tris<8000),'2 traffic bodies (sedan, hatch, SUV, van, police) are '+Tr.map(t=>Math.round(t.tris)).join(', ')+' triangles each');
  ok(Tr.every(t=>t.amber>0&&t.tail>0&&t.head>0&&t.glass>0),'2 each has indicators, tail lights, head lights and glass');
  ok(Tr.every(t=>t.white>0),'2 and a number plate (traffic material 12)');
  /* the colours of traffic paint are like real paint: nothing near 1 */
  const P=await T.ev(()=>TCOLS.map(c=>Math.max(...c)));
  ok(Math.max(...P)<=.66,'3 traffic paint albedo is realistic (brightest '+Math.max(...P).toFixed(2)+')');
  /* the shader: the glass reflects the sky and the grille has a mesh (the programs compile; a frame draws with no GL error) */
  const R=await T.ev(()=>{const {C,UI,ROADS,carPlace,camStep,renderOnce,worldStep}=RACER;UI.paused=true;const r=ROADS.find(q=>q.id=='ring'),i=Math.round(.1*r.n),a=Math.atan2(r.X[i+1]-r.X[i],-(r.Z[i+1]-r.Z[i]));carPlace(r.X[i],r.Z[i],a,r.Y[i]+.5);C.vx=Math.sin(a)*35;C.vz=-Math.cos(a)*35;for(let s=0;s<240;s++)worldStep(1/120);camStep(0,true);camStep(0,true);for(let k=0;k<3;k++)renderOnce(UI.cw,UI.ch);return{err:G.gl.getError(),ph:!!G.P.car.u.uWh,pc:!!G.P.car.u.uCr}});
  ok(R.err===0&&R.ph&&R.pc,'4 a frame at speed draws with no GL error (wheel lettering and blur uniform, crack uniform present)');
  /* daylight dims the glows of lamps and head lights */
  const D=await T.ev(()=>{envApply('day');const a=1-.78*Math.min(1,ENV.sunC[0]/2.6);envApply('overcast');const b=1-.78*Math.min(1,ENV.sunC[0]/2.6);return{day:a,over:b}});
  ok(D.day<.35&&D.over>.6,'5 lamp and head light glows are dimmed in daylight (x'+D.day.toFixed(2)+' in the day, x'+D.over.toFixed(2)+' overcast)');
  /* batch K: gloss black and carbon on every car, the showroom environment in the menu and back */
  const K=await T.ev(()=>{const rows=[];for(const def of RACER.CAR_ROSTER.filter(d=>!d.cc)){const b=RACER.cgBuild(def.spec).body;let g=0,w=0;for(let v=0;v<b.nv;v++){if(b.M[v]==CGM.gloss)g++;if(b.M[v]==CGM.rim||b.M[v]==CGM.chrome)w++}rows.push({g,w})}return rows});
  ok(K.every(r=>r.g>40),'6 every car has gloss black pillars / panels (fewest '+Math.min(...K.map(r=>r.g))+' vertices)');
  const Mn=await T.ev(()=>{const {UI,MENU}=RACER;UI.paused=false;envApply('day');const before=ENV.name;RACER.menuOpen();const inMenu={name:ENV.name,stu:ENV.stu,fog:ENV.fog};let err=0;try{renderOnce();const gl=G.gl;err=gl.getError()}catch(e){err=-1}
    RACER.menuClose();return{before,inMenu,after:ENV.name,stuAfter:ENV.stu||0,err}});
  ok(Mn.inMenu.name==='studio'&&Mn.inMenu.stu===1&&Mn.inMenu.fog>1/30,'7 the car menu switches to the studio look (near fog, soft boxes)');
  ok(Mn.after===Mn.before&&!Mn.stuAfter,'8 closing the menu brings back the weather you had ('+Mn.before+' -> '+Mn.inMenu.name+' -> '+Mn.after+')');
  ok(Mn.err===0,'9 the showroom frame draws with no GL error');
  console.log('errs',T.errs.slice(0,3));ok(T.errs.length===0,'no page errors');
  await T.close();process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
