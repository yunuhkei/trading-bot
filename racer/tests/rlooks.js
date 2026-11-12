// Supercars and looks (batch 4): every car has a nose and a tail of its own (lamp pair, shape), creases, a paint finish, a plate you can read; shut lines are drawn by the shader;
// white and silver are not flat (pixels read back from a render); the triangle count of the bodies.
// usage: node racer/tests/rlooks.js
const L=require('./rlib.js');let bad=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)bad++};
(async()=>{
  const T=await L.launch({q:'go=1&scale=1&fixed=1&env=day&tier=2',w:480,h:270,mobile:false,traffic:false,keep:true});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  /* ---- 1 style table and shapes ---- */
  const A=await T.ev(()=>{const out=[];for(const d of CAR_ROSTER){if(d.cc)continue;const B=cgBuild(d.spec,{}),S=B.S,t=S._tub,b=B.body;
      /* the outline of the nose and of the tail seen from above and from the side: half width and top height at 12 stations over the first and the last 0.9 m */
      const prof=(from)=>{const o=[];for(let q=0;q<12;q++){const s=from?S.L-.02-q*.08:.02+q*.08;let bi=0,bd=1e9;for(let i=0;i<t.ni;i++){const dd=Math.abs(t.ss[i]-s);if(dd<bd){bd=dd;bi=i}}let w=0,h=0;for(let j=0;j<t.nj;j++){const k=(bi*t.nj+j)*3;w=Math.max(w,Math.abs(t.P[k]));h=Math.max(h,t.P[k+1])}o.push(w,h)}return o};
      let ink=0,nanN=0;for(let v=0;v<b.nv;v++){if(b.M[v]==CGM.ink)ink++;const l=Math.hypot(b.N[v*3],b.N[v*3+1],b.N[v*3+2]);if(!(l>.95&&l<1.05))nanN++}
      out.push({id:d.id,name:d.name,head:S.head,tail:S.tail_,fin:d.fin|0,p2:!!d.paint2,plate:S._plate,ink,nanN,tris:b.I.length/3,nose:prof(0),tailP:prof(1),hard:S.hard,sq:S.sq,seam:S._seam&&Array.from(S._seam).every(isFinite)&&S._seam[1]>S._seam[0]&&S._seam[3]>S._seam[2]&&S._seam[5]>S._seam[4],paint:d.paint})}
    return out});
  ok(A.length==30,'30 generated cars');
  const pairs=new Set(A.map(a=>a.head+'/'+a.tail));
  ok(pairs.size==30,'no two cars share their pair of head lamps and tail lamps ('+pairs.size+' different pairs; '+new Set(A.map(a=>a.head)).size+' kinds of head lamp, '+new Set(A.map(a=>a.tail)).size+' kinds of tail lamp)');
  const dist=(p,q)=>{let s=0;for(let k=0;k<p.length;k++)s=Math.max(s,Math.abs(p[k]-q[k]));return s};
  let close=[],minN=9,minT=9;for(let i=0;i<30;i++)for(let j=i+1;j<30;j++){const dn=dist(A[i].nose,A[j].nose),dt=dist(A[i].tailP,A[j].tailP);minN=Math.min(minN,dn);minT=Math.min(minT,dt);if(dn<.025&&dt<.025)close.push(A[i].id+'='+A[j].id)}
  ok(close.length==0,'no two cars have both the same nose and the same tail outline (within 2.5 cm at every station); closest noses '+(minN*100).toFixed(1)+' cm apart, closest tails '+(minT*100).toFixed(1)+' cm'+(close.length?': '+close.join(' '):''));
  const fins=[0,1,2,3].map(f=>A.filter(a=>a.fin==f).length);
  ok(fins.every(n=>n>=2)&&A.filter(a=>a.fin==2).every(a=>a.p2),'paint finishes: '+fins[0]+' solid, '+fins[1]+' metallic, '+fins[2]+' pearl (each with a second colour), '+fins[3]+' matte');
  const plates=new Set(A.map(a=>a.plate));
  ok(plates.size==30&&A.every(a=>/^[A-Z]{3} [0-9]{3}$/.test(a.plate)&&a.ink>=2*4*20),'every car has its own plate, three letters and three digits in block letters ('+A.slice(0,6).map(a=>a.plate).join(', ')+' ...)');
  ok(A.every(a=>a.seam),'every car hands the shader its door, bonnet and engine lid lines');
  ok(A.every(a=>a.nanN==0),'all normals are unit length (the creases included)');
  const hs=A.map(a=>a.hard),qs=A.map(a=>a.sq);
  ok(Math.min(...hs)<=.5&&Math.max(...hs)==1&&Math.min(...qs)<5&&Math.max(...qs)>=10,'creases from soft ('+Math.min(...hs)+') to fully hard (1), shoulders from round ('+Math.min(...qs)+') to a box section ('+Math.max(...qs)+')');
  const tr=A.map(a=>a.tris);ok(Math.max(...tr)<17000,'body triangles '+Math.min(...tr)+' - '+Math.max(...tr)+' (limit 17,000)');
  /* ---- 2 the paint on screen: white and silver are not flat, a solid red is a deep red ---- */
  const px=async(id,paintK)=>{await T.ev(([id,paintK])=>{const {C,ROADS,UI,CAM,R}=RACER;UI.paused=true;UI.hud.style.display='none';window.camStep=function(){};const d=CAR_ROSTER.find(q=>q.id==id);carInstall(d,paintK>=0?CAR_PAINTS[paintK]:null);
      const rd=ROADS.find(q=>q.id=='ring'),k=Math.round(rd.n*.6),t=_tan(rd,k);RACER.carPlace(rd.X[k]-t[1]*6,rd.Z[k]+t[0]*6,Math.atan2(t[0],-t[1]));for(let s=0;s<30;s++)RACER.worldStep(1/120);
      const a=C.yaw,rx=Math.cos(a),rz=Math.sin(a);CAM.x=C.x+rx*5.2+Math.sin(a)*.4;CAM.z=C.z+rz*5.2-Math.cos(a)*.4;CAM.y=C.y+1.15;CAM.tx=C.x;CAM.ty=C.y+.6;CAM.tz=C.z;CAM.fov=.6;R.alpha=1;RACER.renderOnce(UI.cw,UI.ch)},[id,paintK]);
    await L.sleep(80);const buf=await T.page.screenshot({clip:{x:150,y:118,width:180,height:44}});   /* the door and rear wing of the car, side on */
    return await T.page.evaluate(async b64=>{const im=new Image();im.src='data:image/png;base64,'+b64;await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const g=c.getContext('2d');g.drawImage(im,0,0);const d=g.getImageData(0,0,c.width,c.height).data;
      let n=0,sl=0,sl2=0,mx=0,mn=255,sr=0,sg=0,sb=0,clip=0;for(let k=0;k<d.length;k+=4){const l=.3*d[k]+.59*d[k+1]+.11*d[k+2];n++;sl+=l;sl2+=l*l;mx=Math.max(mx,l);mn=Math.min(mn,l);sr+=d[k];sg+=d[k+1];sb+=d[k+2];if(l>250)clip++}
      const m=sl/n;return{mean:+m.toFixed(0),sd:+Math.sqrt(sl2/n-m*m).toFixed(1),mn:+mn.toFixed(0),mx:+mx.toFixed(0),r:+(sr/n).toFixed(0),g:+(sg/n).toFixed(0),b:+(sb/n).toFixed(0),clip:+(clip/n*100).toFixed(1)}},buf.toString('base64'))};
  const wh=await px('k3',-1),si=await px('s2',-1),rd=await px('k1',-1),mt=await px('k1',10);
  console.log('     white '+JSON.stringify(wh)+'\n     silver '+JSON.stringify(si)+'\n     red '+JSON.stringify(rd)+'\n     matte grey '+JSON.stringify(mt));
  ok(wh.mean>150&&wh.clip<25&&wh.sd>12,'white reads white with form in it: mean brightness '+wh.mean+' of 255, '+wh.clip+' % of the flank burnt out, spread '+wh.sd);
  ok(si.sd>14&&si.mean>70&&si.mean<215,'silver has depth: brightness from '+si.mn+' to '+si.mx+' across the flank (spread '+si.sd+')');
  ok(rd.r>rd.g*2.2&&rd.r>rd.b*2.2,'a solid red is a deep red, not a pink (average colour '+rd.r+','+rd.g+','+rd.b+')');
  ok(mt.sd<si.sd,'matte is flatter than metallic (spread '+mt.sd+' against '+si.sd+')');
  console.log('errs',T.errs.length?T.errs.slice(0,3):0);await T.close();console.log(bad?bad+' FAILED':'all passed');process.exit(bad||T.errs.length?1:0)})().catch(e=>{console.error(e);process.exit(1)});
