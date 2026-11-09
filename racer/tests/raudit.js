// READ-ONLY audit: which lane markings does each road really get in the shader, and is the road wide enough for how many lanes?
const L=require('./rlib.js');
(async()=>{
  const T=await L.launch({q:'go=1&scale=.4&fixed=1',w:300,h:200,mobile:false});
  await T.page.waitForFunction(()=>window.RACER&&window.RACER.BOOT.genMs,null,{timeout:120000});
  const rows=await T.ev(()=>{
    const out=[];
    for(const r of RACER.ROADS){
      let A=0,B=0,Cn=0;const n=r.n;
      for(let i=0;i<n;i++){const fl=r.lanes*16+r.style+.1+.8*r.mk[i];const st=fl-r.lanes*16;
        const twoWay=(st<.5)||(st>2.5&&st<3.5);const divided=!twoWay&&(st<1.5||st>3.5);
        if(twoWay)A++;else if(divided)B++;else Cn++}
      const intended=r.style==0||r.style==3?'two-way':r.style==1||r.style==4?'divided':'none(patch)';
      const lw=(r.hw-.9)/Math.max(1,r.lanes);
      out.push({id:r.id,style:r.style,city:r.city,lanes:r.lanes,hw:r.hw,len:r.len,A:A/n,B:B/n,C:Cn/n,intended,lw,perDir:Math.round((r.hw-.9)/3.7*10)/10});
    }
    return out});
  const f=x=>Math.round(x*100)+'%';
  const real=rows.filter(r=>!/^(sf[ns][uv]|la[uv]|bt[uv]|ps[uv])/.test(r.id));
  console.log('NON-GRID ROADS (id style lanes hw len | rendered: two-way / divided-style / none | intended | lane width m, lanes per direction the width allows at 3.7 m)');
  for(const r of real)console.log(r.id.padEnd(9),'st'+r.style,'ln'+r.lanes,'hw'+r.hw,String(Math.round(r.len)).padStart(5)+'m |',f(r.A).padStart(4),f(r.B).padStart(4),f(r.C).padStart(4),'|',r.intended.padEnd(12),'|',r.lw.toFixed(1)+' m/lane, fits '+r.perDir);
  // grid streets summarised by group
  const groups={};for(const r of rows.filter(r=>/^(sf[ns][uv]|la[uv]|bt[uv]|ps[uv])/.test(r.id))){const g=r.id.replace(/[0-9~]+$/,'');const o=groups[g]||(groups[g]={n:0,len:0,A:0,B:0,C:0,hw:r.hw,lanes:r.lanes,style:r.style});o.n++;o.len+=r.len;o.A+=r.A*r.len;o.B+=r.B*r.len;o.C+=r.C*r.len}
  console.log('\nGRID STREETS by group (count, km, rendered two-way / divided-style / none, hw, lanes, style)');
  for(const[g,o]of Object.entries(groups))console.log(g.padEnd(6),String(o.n).padStart(3),(o.len/1000).toFixed(1)+'km',f(o.A/o.len),f(o.B/o.len),f(o.C/o.len),'hw'+o.hw,'ln'+o.lanes,'st'+o.style);
  const tot=rows.reduce((s,r)=>s+r.len,0);const none=rows.reduce((s,r)=>s+r.C*r.len,0),bad=rows.reduce((s,r)=>{const want=r.intended;const got=r.A>=r.B&&r.A>=r.C?'two-way':r.B>=r.C?'divided':'none(patch)';return s+(want==got?0:r.len)},0);
  console.log('\nTOTAL road',(tot/1000).toFixed(1),'km; rendered with NO lane markings',(none/1000).toFixed(1),'km; roads whose dominant rendered style differs from the intended one:',(bad/1000).toFixed(1),'km');
  await T.close()})().catch(e=>{console.error(e);process.exit(1)});
