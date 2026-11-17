'use strict';
/* (batch 54) RECORDED SOUNDS (OpenGameArt; see racer/assets/sfx/CREDITS.md), embedded by build.py as base64 in SFXB64.
   They are decoded when the audio starts; until then (or if decoding fails) the old synthesised sounds play.
   ENGINE: three loops of one engine recorded at rising revs (43, 65 and 76 Hz), cross-faded by rpm and pitched to it (the playback rate follows the rpm, so the note rises
   smoothly through each gear). TYRES, WIND, RAIL SCRAPE and SIREN: loops, their level (and a little pitch) following the car. HITS: crashes, metal, thuds and glass,
   picked by how hard the hit is, with a little random pitch so no two sound the same. NITRO: a whoosh as it kicks in. */
const SFXB64={/*SFXB64*/};
const SFX={buf:{},ready:false,L:{},prevBoost:0};
function sfxLoad(x){const keys=Object.keys(SFXB64);if(!keys.length)return;let left=keys.length;const done=()=>{if(--left==0)sfxInit(x)};
  for(const k of keys){try{const bin=atob(SFXB64[k]),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
      const p=x.decodeAudioData(u.buffer,b=>{SFX.buf[k]=b;done()},()=>done());if(p&&p.catch)p.catch(()=>{})}catch(e){done()}}}
/* a looping source with its own gain, silent until audioUpdate turns it up */
function sfxLoop(x,name){const b=SFX.buf[name];if(!b)return null;const s=x.createBufferSource();s.buffer=b;s.loop=true;const g=x.createGain();g.gain.value=0;s.connect(g);g.connect(AU.master);s.start();return{s,g}}
function sfxInit(x){if(!SFX.buf.eng0||!AU.master)return;const L=SFX.L;L.eng=['eng0','eng1','eng2'].map(n=>sfxLoop(x,n)).filter(Boolean);
  for(const n of['skid','wind','scrape','siren'])L[n]=sfxLoop(x,n);SFX.ready=L.eng.length==3}
/* a one-shot: name, volume, pitch */
function sfxPlay(name,vol,rate){if(!AU.ready||!SFX.buf[name])return;const x=AU.ctx,s=x.createBufferSource();s.buffer=SFX.buf[name];s.playbackRate.value=rate||1;const g=x.createGain();g.gain.value=vol;s.connect(g);g.connect(AU.master);s.start()}
const sfxPick=a=>a[Math.floor(Math.random()*a.length)];
/* a hit of strength k (0..1): the heavier, the more metal and glass */
function sfxHit(k){const r=()=>.9+Math.random()*.2;
  if(k>.65){sfxPlay('crash1',.9*k,r());sfxPlay(sfxPick(['metal1','metal2','metal3']),.7*k,r());if(k>.85&&Math.random()<.6)sfxPlay(sfxPick(['glass1','glass2']),.55,r())}
  else if(k>.3){sfxPlay(sfxPick(['hit1','hit2','hit3','hit4']),.75*k+.15,r());if(Math.random()<.5)sfxPlay(sfxPick(['metal1','metal2','metal3']),.4*k,r())}
  else sfxPlay(sfxPick(['thud1','thud2']),.35+.8*k,r())}
/* every frame, after the synthesised mix: the recorded loops take over (the synth is silenced) */
function sfxUpdate(t,rpm,sp,mute){if(!SFX.ready)return;const L=SFX.L,set=(o,v,tc)=>{if(o)o.g.gain.setTargetAtTime(v,t,tc||.05)},rate=(o,v)=>{if(o)o.s.playbackRate.setTargetAtTime(v,t,.05)};
  AU.gain.gain.setTargetAtTime(0,t,.05);AU.windG.gain.setTargetAtTime(0,t,.05);AU.tireG.gain.setTargetAtTime(0,t,.05);if(AU.scrG)AU.scrG.gain.setTargetAtTime(0,t,.05);if(AU.sirG)AU.sirG.gain.setTargetAtTime(0,t,.1);
  /* engine: the three takes cross-faded (equal power) and pitched to the rpm */
  const f=40+rpm*150,F0=[43,65,76],w0=1-sstep(.12,.42,rpm),w2=sstep(.5,.85,rpm),w1=Math.max(0,1-w0-w2),W=[w0,w1,w2],vE=mute?0:(.2+.2*rpm+((IN.thr||IN.auto)?.07:0)+(C.boosting?.06:0));
  L.eng.forEach((o,i)=>{set(o,vE*Math.sqrt(W[i]),.04);rate(o,Math.max(.6,Math.min(2.6,f/F0[i])))});
  /* tyres: drifting, sliding, a hard landing */
  const sk=mute?0:((C.grounded&&(C.drift>.3||C.dActive)?.4*Math.max(C.drift,Math.min(1,C.slip*3)):0)+(C.hit>3?.12:0));set(L.skid,sk,.05);rate(L.skid,.85+.3*Math.min(1,(C.slip||0)*2));
  /* wind: with speed, louder in a tow */
  set(L.wind,mute?0:sp*sp*.45*(1+1.2*(C.tow||0)),.1);rate(L.wind,.75+.6*sp);
  /* metal on a guard rail */
  {const on=C.railT>0&&!mute;set(L.scrape,on?.3+.35*Math.min(1,C.speed/45):0,on?.015:.06);rate(L.scrape,.8+Math.min(.6,C.speed/80))}
  /* the siren of the nearest chasing cop */
  set(L.siren,mute?0:COP.sirenVol*.3,.1);
  /* nitro: a whoosh as it kicks in */
  if(C.boosting&&!SFX.prevBoost&&!mute)sfxPlay('whoosh',.55,1);SFX.prevBoost=C.boosting?1:0}
