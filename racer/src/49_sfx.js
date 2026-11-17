'use strict';
/* (batch 54/55) RECORDED SOUNDS, embedded by build.py as base64 in SFXB64 (sources and licences: racer/assets/sfx/CREDITS.md; all CC0).
   They are decoded when the audio starts; until then (or if decoding fails) the old synthesised sounds play.
   ENGINE (batch 55): four loops cross-faded by rpm and pitched to it: a real V8 (an AC Cobra, BigSoundBank) at idle and under load for the low and middle revs,
   then two racing-engine takes (OpenGameArt) for the top. Louder than before, and everything goes through a compressor so the engine sits up front without clipping.
   TYRES (real screeching tyres), WIND (strong wind), RAIL SCRAPE and SIREN: loops, their level (and a little pitch) following the car.
   HITS (batch 55): layered crashes (a low boom + falling sheet steel + glass or debris) with a sub thump under the big ones, so a crash has weight instead of a knock.
   MUSIC (batch 55): four CC0 tracks (racer/assets/music/CREDITS.md) streamed from <audio> elements, a shuffled playlist, ducked under big crashes, on/off in the pause menu. */
const SFXB64={/*SFXB64*/};
const SFX={buf:{},ready:false,L:{},prevBoost:0};
function sfxLoad(x){const keys=Object.keys(SFXB64);if(!keys.length)return;let left=keys.length;const done=()=>{if(--left==0)sfxInit(x)};
  for(const k of keys){try{const bin=atob(SFXB64[k]),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
      const p=x.decodeAudioData(u.buffer,b=>{SFX.buf[k]=b;done()},()=>done());if(p&&p.catch)p.catch(()=>{})}catch(e){done()}}}
/* a looping source with its own gain, silent until audioUpdate turns it up */
function sfxLoop(x,name){const b=SFX.buf[name];if(!b)return null;const s=x.createBufferSource();s.buffer=b;s.loop=true;const g=x.createGain();g.gain.value=0;s.connect(g);g.connect(AU.master);s.start();return{s,g}}
const SFX_ENG=['v8idle','v8load','eng1','eng2'],SFX_F0=[65.2,70.9,64.9,76.3],SFX_EG=[2.4,1,.85,.85],SFX_EC=[.22,.5,.78,1.02];
function sfxInit(x){if(!SFX.buf.v8idle||!AU.master)return;const L=SFX.L;L.eng=SFX_ENG.map(n=>sfxLoop(x,n)).filter(Boolean);
  for(const n of['skid','wind','scrape','siren'])L[n]=sfxLoop(x,n);SFX.ready=L.eng.length==SFX_ENG.length}
/* a one-shot: name, volume, pitch */
function sfxPlay(name,vol,rate){if(!AU.ready||!SFX.buf[name])return;const x=AU.ctx,s=x.createBufferSource();s.buffer=SFX.buf[name];s.playbackRate.value=rate||1;const g=x.createGain();g.gain.value=vol;s.connect(g);g.connect(AU.master);s.start()}
const sfxPick=a=>a[Math.floor(Math.random()*a.length)];
/* a low sub thump (felt more than heard): the weight of a big hit */
function sfxThump(k){try{const x=AU.ctx,t=x.currentTime,o=x.createOscillator(),g=x.createGain();o.type='sine';o.frequency.setValueAtTime(70,t);o.frequency.exponentialRampToValueAtTime(32,t+.35);
  g.gain.setValueAtTime(1.1*k,t);g.gain.exponentialRampToValueAtTime(.001,t+.45);o.connect(g);g.connect(AU.master);o.start(t);o.stop(t+.5)}catch(e){}}
/* a hit of strength k (0..1): small = a dull metal thud, middle = a sheet-metal crunch, big = a full crash with glass */
function sfxHit(k){const r=()=>.88+Math.random()*.2;
  if(k>.6){sfxPlay(sfxPick(['crashA','crashB','crashC']),1.1+.5*k,r()*.95);sfxThump(k);if(k>.8&&Math.random()<.7)sfxPlay(sfxPick(['glassA','glassB']),.5,r());musDuck(.35)}
  else if(k>.28){sfxPlay(sfxPick(['hitA','hitB','hitC']),.6+1.1*k,r());sfxThump(.5*k);musDuck(.6)}
  else sfxPlay(sfxPick(['thud1','thud2']),.4+1.2*k,r()*.9)}
/* every frame, after the synthesised mix: the recorded loops take over (the synth is silenced) */
function sfxUpdate(t,rpm,sp,mute){if(!SFX.ready)return;const L=SFX.L,set=(o,v,tc)=>{if(o)o.g.gain.setTargetAtTime(v,t,tc||.05)},rate=(o,v)=>{if(o)o.s.playbackRate.setTargetAtTime(v,t,.05)};
  AU.gain.gain.setTargetAtTime(0,t,.05);AU.windG.gain.setTargetAtTime(0,t,.05);AU.tireG.gain.setTargetAtTime(0,t,.05);if(AU.scrG)AU.scrG.gain.setTargetAtTime(0,t,.05);if(AU.sirG)AU.sirG.gain.setTargetAtTime(0,t,.1);
  /* engine: the four takes cross-faded (equal power) by rpm and pitched to it */
  const f=55+rpm*110,thr=(IN.thr||IN.auto)?1:0,vE=mute?0:(.5+.35*rpm+.14*thr+(C.boosting?.1:0));let ws=0;const W=SFX_EC.map(c=>{const w=Math.exp(-Math.pow((rpm-c)/.17,2));ws+=w;return w});
  L.eng.forEach((o,i)=>{set(o,vE*SFX_EG[i]*Math.sqrt(W[i]/ws),.04);rate(o,Math.max(.6,Math.min(2.6,f/SFX_F0[i])))});
  /* tyres: drifting, sliding, a hard landing */
  const sk=mute?0:((C.grounded&&(C.drift>.3||C.dActive)?.4*Math.max(C.drift,Math.min(1,C.slip*3)):0)+(C.hit>3?.12:0));set(L.skid,sk*1.3,.05);rate(L.skid,.85+.3*Math.min(1,(C.slip||0)*2));
  /* wind: with speed, louder in a tow */
  set(L.wind,mute?0:sp*sp*.4*(1+1.2*(C.tow||0)),.1);rate(L.wind,.75+.6*sp);
  /* metal on a guard rail */
  {const on=C.railT>0&&!mute;set(L.scrape,on?.3+.35*Math.min(1,C.speed/45):0,on?.015:.06);rate(L.scrape,.8+Math.min(.6,C.speed/80))}
  /* the siren of the nearest chasing cop */
  set(L.siren,mute?0:COP.sirenVol*.3,.1);
  /* nitro: a whoosh as it kicks in */
  if(C.boosting&&!SFX.prevBoost&&!mute)sfxPlay('whoosh',.8,1);SFX.prevBoost=C.boosting?1:0}
/* ---------- music: a shuffled playlist of streamed tracks ---------- */
const MUSB64=[/*MUSB64*/];
const MUS={on:true,el:null,g:null,i:-1,order:[],urls:[],duck:1,vol:.32};
try{MUS.on=localStorage.getItem('racer.music')!='off'}catch(e){}
function musStart(x){if(MUS.el||!MUSB64.length||!AU.master)return;try{
    MUS.urls=MUSB64.map(b=>{const bin=atob(b),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return URL.createObjectURL(new Blob([u],{type:'audio/mpeg'}))});
    MUS.order=MUS.urls.map((_,i)=>i).sort(()=>Math.random()-.5);const el=MUS.el=new Audio();el.preload='auto';el.addEventListener('ended',()=>musNext());
    try{const src=x.createMediaElementSource(el);MUS.g=x.createGain();MUS.g.gain.value=0;src.connect(MUS.g);MUS.g.connect(x.destination)}catch(e){MUS.g=null}
    document.addEventListener('visibilitychange',()=>{if(document.hidden)el.pause();else if(MUS.on)el.play().catch(()=>{})});
    musNext()}catch(e){MUS.el=null}}
function musNext(){if(!MUS.el)return;MUS.i=(MUS.i+1)%MUS.order.length;MUS.el.src=MUS.urls[MUS.order[MUS.i]];if(MUS.on)MUS.el.play().catch(()=>{})}
function musSet(v){MUS.on=!!v;try{localStorage.setItem('racer.music',MUS.on?'on':'off')}catch(e){}if(!MUS.el)return;if(MUS.on)MUS.el.play().catch(()=>{});else MUS.el.pause()}
function musDuck(d){MUS.duck=Math.min(MUS.duck,d)}
/* the music sits under the car; quieter in the pause menu, ducked under a crash and recovering over a second or two */
function musUpdate(t,mute){if(!MUS.el)return;MUS.duck=Math.min(1,MUS.duck+.012);const v=MUS.on?MUS.vol*(mute?.6:1)*MUS.duck:0;
  if(MUS.g)MUS.g.gain.setTargetAtTime(v,t,.08);else MUS.el.volume=Math.min(1,v)}
