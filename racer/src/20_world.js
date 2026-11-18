'use strict';
/* ===== the wider county: towns, industry, farms and the highways that join them to the rest of the network =====
   Called at the end of defineRoads(). H = {ramp,rampIn,tIn}: the junction helpers from 20_map.js. */
/* a small town or industrial area: a street grid clipped to a box, ringed by a boulevard */
function makeTown(id,B,theme,o){o=o||{};
  const us=[],vs=[];for(let x=B.x0+(o.mu||45);x<B.x1-30;x+=o.du||95)us.push(x);for(let z=B.z0+(o.mv||40);z<B.z1-30;z+=o.dv||85)vs.push(z);
  const g=gridStreets({id,kind:o.kind||'town',theme,ox:0,oz:0,ang:0,us,vs,hw:o.hw||5.5,style:3,lift:o.lift||.05,planes:planesBox(B),uw:o.uw});   /* o.uw: {index: {hw,style}} makes one of the u streets a wide boulevard */
  g.box=B;g.phw=o.phw||7;perimeter(id+'p',B,g.phw,(o.lift||.05)+.005);cityLand();return g}
/* a spot beside a road: x,z and the road's direction (cs,sn) there; side +1 is to the left of the direction of travel, -1 to the right */
function besideRoad(id,f,side,off){const r=ROADS.find(q=>q.id==id);if(!r)return null;const i=Math.max(1,Math.min(r.n-2,Math.round(f*(r.closed?r.n:r.n-1)))),t=_tan(r,i),nx=-t[1],nz=t[0],d=r.hw+RSH+off;
  return{x:r.X[i]+nx*side*d,z:r.Z[i]+nz*side*d,cs:t[0],sn:t[1]}}
function addSafe(id,name,road,f,side,off){const p=besideRoad(road,f,side,off||14);if(p)SAFEHOUSES.push({id,name,x:p.x,z:p.z,cs:p.cs,sn:p.sn,side})}
function defineWorld(ring,sh,H){
  const {ramp,rampIn,tIn,tOut,at}=H;
  /* ---------- towns and industrial areas ---------- */
  /* batch 14: the older towns and the industrial areas are natural too (20_organic.js); a gate's third number is its own arm (Pacifica's west gate stays short: the coast road runs close by) */
  const gPac=makeOrganic('pac',TOWN_PAC,'coast',{du:66,dv:62,gates:[[-1,0,-.04],[1,0]]});
  const gFre=makeOrganic('fre',TOWN_FRE,'farm',{du:68,dv:60,gates:[[1,0],[0,1]]});
  const gBar=makeOrganic('bar',TOWN_BAR,'desert',{du:66,dv:66,gates:[[0,-1],[0,1],[1,0]]});
  const gBig=makeOrganic('big',TOWN_BIG,'pines',{du:62,dv:62,gates:[[0,1],[1,0]]});
  const gHar=makeOrganic('har',IND_HAR,'ind',{kind:'ind',du:95,dv:72,hw:8,phw:7,mhw:8,warp:9,rk:.9,arm:.12,gates:[[0,-1]]});
  const gMoj=makeOrganic('moj',IND_MOJ,'ind',{kind:'ind',du:95,dv:75,hw:8,phw:7,mhw:8,warp:9,rk:.9,arm:.12,gates:[[-1,0],[0,-1],[1,0]]});
  /* the three new cities (world 1c): Las Vegas with the Strip down its middle, Sacramento, San Jose */
  /* batch 15: natural cities (20_organic.js): each split by its main avenue into two neighbourhoods at their own angles; Las Vegas's avenue is the Strip */
  const gVeg=makeOrganicCity('veg',CITY_VEG,'vegas',{kind:'vegas',rk:.97,arm:.1,avenue:{ang:Math.PI/2,hw:12,style:4,off:20},hoods:[{ang:0,du:100,dv:92,on:70},{ang:.42,du:104,dv:94,on:66,oa:30}],gates:[[0,-1],[-1,0]]});
  const gSac=makeOrganicCity('sac',CITY_SAC,'cap',{kind:'cap',rk:.97,arm:.1,avenue:{ang:0,hw:10,style:4,off:-10},hoods:[{ang:0,du:96,dv:80,on:62},{ang:-.3,du:96,dv:80,on:62,oa:20}],gates:[[-1,0],[0,1],[0,-1]]});
  const gSj=makeOrganicCity('sj',CITY_SJ,'tech',{kind:'tech',rk:.97,arm:.1,avenue:{ang:.55,hw:10,style:4},hoods:[{ang:.55,du:118,dv:100,on:72},{ang:.97,du:120,dv:102,on:72}],gates:[[0,1],[-1,0]]});
  /* batch 8: four towns on the empty highways */
  /* batch 13: natural towns (20_organic.js): an irregular outline, bent streets, the main streets out to the gates the roads below join */
  const gGil=makeOrganic('gil',TOWN_GIL,'farm',{du:66,dv:62,gates:[[0,-1],[0,1],[-1,0]]});
  const gInd=makeOrganic('ind',TOWN_IND,'desert',{du:64,dv:64,gates:[[1,0],[0,1],[-1,0]]});
  const gHes=makeOrganic('hes',TOWN_HES,'farm',{du:66,dv:66,gates:[[0,1],[1,0]]});
  const gTah=makeOrganic('tah',TOWN_TAH,'pines',{du:64,dv:60,gates:[[-1,0],[0,1],[1,0]]});
  const gBis=makeOrganic('bis',TOWN_BIS,'pines',{du:62,dv:64,gates:[[-1,0],[1,0]]});
  const R_=id=>ROADS.find(q=>q.id==id);
  const bis=R_('bisp'),gil=R_('gilp'),ind=R_('indp'),hes=R_('hesp'),tah=R_('tahp'),mp=R_('mp'),cr=R_('cr'),bar=R_('barp'),moj=R_('mojp'),big=R_('bigp'),fre=R_('frep'),pac=R_('pacp'),har=R_('harp'),look=R_('lookout'),veg=R_('vegp'),sac=R_('sacp'),sj=R_('sjp'),bv=R_('bv');
  const out=(par,x,z,dx,dz)=>tJoin(par,jn(par,x,z),x+dx*60,z+dz*60),into=(par,x,z,dx,dz)=>out(par,x,z,dx,dz).reverse();
  const gate=(g,dx,dz)=>{const G=townGate(g,dx,dz);return out(g.per,G.x,G.z,G.dx,G.dz)};
  const gateIn=(g,dx,dz)=>gate(g,dx,dz).reverse(),gatePt=(g,dx,dz)=>{const G=townGate(g,dx,dz);return[G.x,G.z]};
  /* ---------- east: the desert highway to Barstow, the refinery, and the loop back along the southern highway ---------- */
  buildCurvy({id:'eh',hw:10,lanes:2,style:1,from:'ring',to:'barp',lift:.085,smooth:100,minR:60,wig:{a1:180,l1:600,a2:50,l2:240,seed:51,fade:220},
    pts:tJoin(ring,jn(ring,1440,50),2300,250).concat([[2300,250],[2750,520],[3150,800],[3450,1100]]).concat(gateIn(gBar,0,-1))});   /* leaves the ring exactly opposite the boulevard road (bv): one crossroads */
  buildCurvy({id:'sh2',hw:9,lanes:1,style:0,yFrom:'lookout',to:'mojp',lift:.09,smooth:80,minR:50,wig:{a1:60,l1:420,a2:16,l2:160,seed:52,fade:140},
    pts:tOut(look,2830,2400).concat([[2900,2385]]).concat(gateIn(gMoj,-1,0))});
  buildCurvy({id:'sh3',hw:10,lanes:2,style:1,yFrom:'mojp',to:'barp',lift:.095,smooth:100,minR:60,wig:{a1:90,l1:480,a2:24,l2:180,seed:53,fade:150},
    pts:gate(gMoj,0,-1).concat([[3400,1900],[3470,1760]]).concat(gateIn(gBar,0,1))});
  /* the canyon road: along the floor of the canyon, up to a turnaround on the rim */
  loopRoad('rim',3600,-2700,40,6,.1);
  buildRoad({id:'cyr',hw:7,lanes:1,style:0,lift:.06,smooth:40,grade:.12,yFrom:'eh',yTo:'rim',
    pts:tOut(R_('eh'),3040,640).concat([[3030,500]]).concat(CANYON).slice(0,-1).concat(tIn(R_('rim'),3600,-2600))});
  /* ---------- north: from the ring over the mountain pass loop to the village in the foothills ---------- */
  buildCurvy({id:'nh1',hw:10,lanes:2,style:1,from:'ring',to:'mp',lift:.075,smooth:100,minR:60,wig:{a1:140,l1:600,a2:40,l2:240,seed:54,fade:200},
    pts:ramp(ring,-100,-1385,-120,-1900,10).concat([[-120,-1900],[-170,-2200]]).concat(tIn(mp,-190,-2380))});
  buildCurvy({id:'nh2',hw:10,lanes:2,style:1,yFrom:'mp',to:'bigp',lift:.078,smooth:70,grade:.17,minR:55,wig:{a1:100,l1:420,a2:30,l2:180,seed:55,fade:160},
    pts:tJoin(mp,jn(mp,-190,-2380),-175,-2780).concat([[-175,-2780],[-190,-2880]]).concat(gateIn(gBig,0,1))});   /* starts where nh1 ends on the pass: one crossroads */
  /* ---------- north-west: the farm roads ---------- */
  buildCurvy({id:'fr1',hw:7,lanes:1,style:0,yFrom:'mp',to:'frep',lift:.07,smooth:60,minR:40,wig:{a1:40,l1:300,a2:12,l2:120,seed:56,fade:100},
    pts:tOut(mp,-1150,-2110).concat([[-1250,-2130]]).concat(gateIn(gFre,1,0))});
  buildCurvy({id:'fr2',hw:7,lanes:1,style:0,yFrom:'frep',to:'mp',lift:.072,smooth:60,minR:40,wig:{a1:60,l1:320,a2:16,l2:130,seed:57,fade:100},
    pts:gate(gFre,0,1).concat([[-1520,-1800],[-1470,-1620],[-1400,-1530]]).concat(tIn(mp,-1330,-1500))});
  /* ---------- the coast and the harbour ---------- */
  buildRoad({id:'pcl',hw:6,lanes:1,style:0,yFrom:'cr',yTo:'pacp',lift:.07,pts:(G=>[at(cr,jn(cr,G[0]-40,G[1])),at(pac,jn(pac,G[0],G[1]))])(gatePt(gPac,-1,0))});
  buildRoad({id:'hb',hw:7,lanes:1,style:0,yFrom:'sh',yTo:'harp',lift:.08,pts:(G=>[at(sh,jn(sh,G[0],G[1]-120)),at(har,jn(har,G[0],G[1]))])(gatePt(gHar,0,-1))});
  /* ---------- the roads to the new cities ---------- */
  /* Las Vegas: a desert highway from Barstow and a road from Mojave Works */
  buildCurvy({id:'vg1',hw:10,lanes:2,style:1,yFrom:'barp',to:'vegp',lift:.09,smooth:90,minR:60,wig:{a1:50,l1:420,a2:14,l2:170,seed:61,fade:120},
    pts:gate(gBar,1,0).concat([[4010,1500],[4150,1680]]).concat(gateIn(gVeg,0,-1))});
  buildCurvy({id:'vg2',hw:9,lanes:1,style:0,yFrom:'mojp',to:'vegp',lift:.092,smooth:70,minR:50,wig:{a1:30,l1:300,a2:8,l2:120,seed:62,fade:90},
    pts:gate(gMoj,1,0).concat([[3790,2200]]).concat(gateIn(gVeg,-1,0))});
  /* Sacramento: west to the north highway, south to the ring, north to the mountain pass */
  buildCurvy({id:'sc1',hw:9,lanes:1,style:0,yFrom:'sacp',to:'nh1',lift:.08,smooth:50,minR:45,wig:{a1:10,l1:200,a2:3,l2:90,seed:63,fade:60,hold:50},pts:gate(gSac,-1,0).concat(tIn(R_('nh1'),-60,-2025))});
  buildCurvy({id:'sc2',hw:10,lanes:2,style:1,yFrom:'sacp',to:'ring',lift:.082,smooth:70,minR:50,wig:{a1:24,l1:260,a2:6,l2:110,seed:64,fade:80,hold:60},pts:gate(gSac,0,1).concat([[320,-1620]]).concat(tIn(ring,330,-1560))});
  buildCurvy({id:'sc3',hw:9,lanes:1,style:0,yFrom:'sacp',to:'mp',lift:.084,smooth:50,grade:.12,minR:40,wig:{a1:10,l1:200,a2:3,l2:90,seed:65,fade:60,hold:50},pts:gate(gSac,0,-1).concat(tIn(mp,300,-2420))});
  /* San Jose: south to the boulevard road, west to the ring */
  buildCurvy({id:'sj1',hw:10,lanes:2,style:1,yFrom:'sjp',to:'bv',lift:.086,smooth:70,minR:50,wig:{a1:30,l1:300,a2:8,l2:120,seed:66,fade:90,hold:60},pts:gate(gSj,0,1).concat([[-60,-240]]).concat(tIn(bv,-50,-120))});
  buildCurvy({id:'sj2',hw:9,lanes:1,style:0,yFrom:'sjp',to:'ring',lift:.088,smooth:60,minR:45,wig:{a1:12,l1:220,a2:4,l2:100,seed:67,fade:60,hold:50},pts:gate(gSj,-1,0).concat(tIn(ring,-560,-860))});
  /* ---------- batch 8: the new towns, each joined at two points ---------- */
  /* out / into: a join that leaves (or reaches) a road towards a given side (dx,dz); tOut / tIn guess the side from the point itself, which on a town's edge can send the road back into town.
     Every join on a town's edge is in line with one of its streets, so it makes a crossroads. */
  const C1={hold:50,fade:60},cw=(a1,l1,seed)=>Object.assign({a1,l1,a2:a1*.3,l2:l1*.45,seed},C1);
  /* Gilroy: north to the ring, south to the coast road */
  buildCurvy({id:'gl1',hw:9,lanes:1,style:0,yFrom:'gilp',to:'ring',lift:.08,smooth:60,minR:45,wig:cw(20,240,81),pts:gate(gGil,0,-1).concat([[-680,1560]]).concat(into(ring,-650,1360,0,1))});
  buildCurvy({id:'gl2',hw:9,lanes:1,style:0,yFrom:'gilp',to:'cr',lift:.08,smooth:60,minR:45,wig:cw(20,240,82),pts:gate(gGil,0,1).concat([[-690,2230]]).concat(into(cr,-695,2400,0,-1))});
  /* batch 13: and west to Pacifica (in line with Pacifica's street pacv2) */
  buildCurvy({id:'gl3',hw:9,lanes:1,style:0,yFrom:'gilp',to:'pacp',lift:.08,smooth:60,minR:45,wig:cw(18,240,91),pts:gate(gGil,-1,0).concat([[-1180,1720]]).concat(gateIn(gPac,1,0))});
  /* Indio: east to the east loop, south to the southern highway */
  buildCurvy({id:'in1',hw:9,lanes:1,style:0,yFrom:'indp',to:'el',lift:.08,smooth:50,minR:40,wig:cw(10,200,83),pts:gate(gInd,1,0).concat(into(R_('el'),2400,2080,-1,0))});
  buildCurvy({id:'in2',hw:9,lanes:1,style:0,yFrom:'indp',to:'sh',lift:.08,smooth:50,minR:40,wig:cw(10,200,84),pts:gate(gInd,0,1).concat(into(sh,2155,2415,0,-1))});
  /* batch 13: and west to Palm Springs (onto its south edge, in line with its street psu2) */
  buildCurvy({id:'in3',hw:9,lanes:1,style:0,yFrom:'indp',to:'psp',lift:.08,smooth:50,minR:40,wig:cw(8,200,92),pts:gate(gInd,-1,0).concat([[1830,2040]]).concat(into(R_('psp'),1800,1900,0,1))});
  /* Hesperia: two roads down to the east highway, so the highway runs through town */
  buildCurvy({id:'hs1',hw:9,lanes:1,style:0,yFrom:'hesp',to:'eh',lift:.08,smooth:50,minR:40,wig:cw(10,200,85),pts:gate(gHes,0,1).concat(into(R_('eh'),2425,230,0,-1))});
  buildCurvy({id:'hs2',hw:9,lanes:1,style:0,yFrom:'hesp',to:'eh',lift:.08,smooth:60,minR:45,wig:cw(16,220,86),pts:gate(gHes,1,0).concat([[2810,-20],[2815,200]]).concat(into(R_('eh'),2800,400,0,-1))});
  /* Tahoe: west to Big Pines along the foothills, south to the mountain pass */
  buildCurvy({id:'th1',hw:9,lanes:1,style:0,yFrom:'tahp',to:'bigp',lift:.08,smooth:60,grade:.14,minR:45,wig:cw(24,240,87),pts:gate(gTah,-1,0).concat([[250,-2950]]).concat(gateIn(gBig,1,0))});
  buildCurvy({id:'th2',hw:9,lanes:1,style:0,yFrom:'tahp',to:'mp',lift:.08,smooth:60,grade:.14,minR:45,wig:cw(16,220,88),pts:gate(gTah,0,1).concat([[610,-2600]]).concat(into(mp,575,-2465,0,-1))});
  /* the northern highway: Tahoe - Bishop - up onto the mesa to the canyon rim, so the canyon road is no longer a dead end but part of a loop round the north and east */
  buildCurvy({id:'nt1',hw:9,lanes:1,style:0,yFrom:'tahp',to:'bisp',lift:.08,smooth:80,grade:.14,minR:55,wig:{a1:60,l1:360,a2:16,l2:150,seed:89,fade:90,hold:60},pts:gate(gTah,1,0).concat([[1150,-2950],[1500,-3010]]).concat(gate(gBis,-1,0).reverse())});
  buildCurvy({id:'nt2',hw:9,lanes:1,style:0,yFrom:'bisp',to:'rim',lift:.08,smooth:80,grade:.15,minR:55,wig:{a1:60,l1:360,a2:16,l2:150,seed:90,fade:90,hold:60},pts:gate(gBis,1,0).concat([[2500,-3000],[2850,-2960],[3150,-2840],[3420,-2740]]).concat(into(R_('rim'),3560,-2700,-1,0))});
  /* ---------- farms along the farm roads, each with a yard and a field behind it ---------- */
  {const FC=[[[.52,.43,.16],[.44,.36,.12]],[[.2,.4,.12],[.17,.34,.1]],[[.4,.27,.14],[.34,.22,.11]]];let k=0;
   const farm=(road,f,side)=>{const p=besideRoad(road,f,side,46);if(!p)return;FARMS.push({x:p.x,z:p.z,cs:p.cs,sn:p.sn});
     const ax=-p.sn*side,az=p.cs*side,fx=p.x+ax*150,fz=p.z+az*150;   /* away from the road */
     FIELDS.push({b:{x0:p.x-45,z0:p.z-45,x1:p.x+45,z1:p.z+45},c:[[.36,.31,.22],[.34,.29,.2]]});
     FIELDS.push({b:{x0:fx-120,z0:fz-85,x1:fx+120,z1:fz+85},c:FC[k++%3]})};
   farm('fr1',.5,1);farm('fr1',.5,-1);farm('fr2',.25,1);farm('fr2',.6,-1);farm('fr2',.85,1);farm('nh1',.3,1);farm('nh1',.55,-1);farm('nh1',.8,1)}
  /* ---------- safe houses (free first one near the start, the rest are earned later) ---------- */
  addSafe('home','Home Garage','ring',.3,-1,18);
  addSafe('down','Downtown Garage','sfp',.1,-1,16);
  addSafe('valley','Valley Garage','lap',.1,-1,16);
  addSafe('santacruz','Santa Cruz Garage','btp',.62,-1,14);
  addSafe('palms','Palm Springs Garage','psp',.1,-1,16);
  addSafe('pacifica','Pacifica Garage','pacp',.1,-1,14);
  addSafe('fresno','Fresno Garage','frep',.1,-1,14);
  addSafe('barstow','Barstow Garage','barp',.1,-1,14);
  addSafe('pines','Big Pines Garage','bigp',.1,-1,14);
  addSafe('harbor','Harbor Garage','harp',.1,-1,16);
  addSafe('works','Mojave Works Garage','mojp',.1,-1,16);
  addSafe('pass','Mountain Pass Garage','mp',.5,1,14);
  addSafe('ridge','Mulholland Garage','mh',.5,1,14);
  addSafe('coast','Coast Road Garage','cr',.72,1,14);
  addSafe('rim','Canyon Rim Garage','rim',.75,-1,16);
  addSafe('lookout','Lookout Garage','lookout',.75,-1,16);
  addSafe('eastgate','East Highway Garage','eh',.45,1,16);
  addSafe('vegas','Las Vegas Garage','vegp',.36,-1,16);addSafe('sacramento','Sacramento Garage','sacp',.1,-1,16);addSafe('sanjose','San Jose Garage','sjp',.1,-1,16);
}
/* (batch 30) DIRT TRAILS through the woods: from the country highways longer than 1.5 km, every 1.1-1.6 km, a narrow dirt road (style 5, 3.4 m half width) leaves the highway, winds 150-300 m out into the
   country and comes back to the same highway 0.7-1 km further on. A way off the highway when the police are on you (they can follow: trails are in the lane graph, but carry no traffic).
   Only where the whole trail is on dry land, away from towns, garages and every other road. */
/* (batch 61) CAPE TRAILS: the new land of batch 56 (the north-west peninsula, the south-west headland, the southern point) gets a dirt loop each: it leaves the
   nearest country highway, runs out over the hill to a lookout near the tip and comes back further along the highway. Checked like the other trails (dry land, clear of
   other roads and towns); a cape whose loop does not fit gets none. */
const CAPES=[{name:'North-west point',tip:[-3260,-1880]},{name:'South-west headland',tip:[-2700,2360]},{name:'Southern point',tip:[2650,3350]}];
const CAPE_DBG=[];function addCapeTrails(){const out=[];CAPE_DBG.length=0;
  const clear=(x,z,m)=>{for(const o of ROADS){if(o.style==5&&o.id.startsWith('cape'))continue;for(let i=0;i<o.n;i+=3){const dx=o.X[i]-x,dz=o.Z[i]-z,l=o.hw+m;if(dx*dx+dz*dz<l*l)return false}}return true};
  for(const cp of CAPES){/* the lookout: the highest dry ground within 900 m of the cape, well back from the shore */let T=cp.tip,th=-1e9;for(let dx=-900;dx<=900;dx+=50)for(let dz=-900;dz<=900;dz+=50){const x=cp.tip[0]+dx,z=cp.tip[1]+dz;if(dx*dx+dz*dz>810000||coastD(x,z)<220)continue;const h=baseH(x,z);if(h>th){th=h;T=[x,z]}}
    /* the parent: the nearest country highway point with a clear run to the lookout (no other road, town or garage in between) */let best=null;
    for(const r of ROADS){if(r.city||!(r.style==0||r.style==1)||r.def.flat||r.n*r.ds<900||r.id=='mp')continue;   /* not the mountain pass: its switchbacks lie side by side */const mg=Math.round(340/r.ds)+12;for(let i=mg;i<r.n-mg;i+=4){const d=Math.hypot(r.X[i]-T[0],r.Z[i]-T[1]);if(d>2600||(best&&d>=best.d))continue;
        let okL=true;const n=Math.ceil(d/25);for(let k=3;k<n&&okL;k++){const x=r.X[i]+(T[0]-r.X[i])*k/n,z=r.Z[i]+(T[1]-r.Z[i])*k/n;if(!clear(x,z,25)||baseH(x,z)<3||DISTRICT_BOXES.some(Bx=>inBox(x,z,Bx,90)))okL=false}if(okL)best={r,i,d}}}
    if(!best||best.d>2600){CAPE_DBG.push([cp.name,'no road',best&&best.d|0]);continue}const par=best.r;CAPE_DBG.push([cp.name,'parent',par.id,best.d|0]);let built=false;
    for(const wf of[1,.4])for(const span of[500,380,640])for(const wob of[1,-1]){if(built)break;const half=Math.round(span/2/par.ds),i0=best.i-half,i1=best.i+half;if(i0<10||i1>par.n-10)continue;
      const A=[par.X[i0],par.Z[i0]],B=[par.X[i1],par.Z[i1]],t0=_tan(par,i0),t1=_tan(par,i1),side=((T[0]-par.X[best.i])*-t0[1]+(T[1]-par.Z[best.i])*t0[0])>0?1:-1;
      const out0=[A[0]-t0[1]*side*(par.hw+30),A[1]+t0[0]*side*(par.hw+30)],out1=[B[0]-t1[1]*side*(par.hw+30),B[1]+t1[0]*side*(par.hw+30)];
      /* out towards the tip along one side, round the lookout, back along the other */const dx=T[0]-(A[0]+B[0])/2,dz=T[1]-(A[1]+B[1])/2,L=Math.hypot(dx,dz)||1,ux=dx/L,uz=dz/L,px=-uz*wob,pz=ux*wob,w=Math.min(150,L*.18)*wf;
      const pts=[A,out0];for(const f of[.3,.6,.85]){const c=[out0[0]+(T[0]-out0[0])*f,out0[1]+(T[1]-out0[1])*f];pts.push([c[0]+px*w*(1-f*.6),c[1]+pz*w*(1-f*.6)])}
      pts.push([T[0]+ux*40+px*30,T[1]+uz*40+pz*30],[T[0]+ux*40-px*30,T[1]+uz*40-pz*30]);for(const f of[.85,.6,.3]){const c=[out1[0]+(T[0]-out1[0])*f,out1[1]+(T[1]-out1[1])*f];pts.push([c[0]-px*w*(1-f*.6),c[1]-pz*w*(1-f*.6)])}pts.push(out1,B);
      const def={id:'cape'+out.length,hw:3.4,lanes:1,style:5,lift:.03,smooth:40,grade:.16,from:par.id,to:par.id,pts},R=buildRoad(def,true);let ok=true;
      let why='';for(let i=0;i<R.n&&ok;i+=3){const x=R.X[i],z=R.Z[i],end=Math.min(i,R.n-1-i)*R.ds;if(baseH(x,z)<3.5){ok=false;why='low '+(x|0)+','+(z|0)}else if(DISTRICT_BOXES.some(Bx=>inBox(x,z,Bx,100))){ok=false;why='town'}else if(SAFEHOUSES.some(h=>Math.hypot(h.x-x,h.z-z)<90)){ok=false;why='garage'}else if(end>par.hw+36&&!clear(x,z,end<80?12:30)){ok=false;why='road '+(x|0)+','+(z|0)}}
      /* and it does not cross itself */if(ok){for(let i=0;i<R.n&&ok;i+=6)for(let j=i+30;j<R.n;j+=6){if(Math.hypot(R.X[i]-R.X[j],R.Z[i]-R.Z[j])<12){ok=false;break}}}
      if(!ok){CAPE_DBG.push([cp.name,span,wob,why||'self-cross']);continue}const rr=buildRoad(def);rr.cape=cp.name;out.push(rr);built=true}}
  return out}
function addTrails(){const out=[],rng=mulberry(4242),boxes=ROADS.map(r=>{let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(let i=0;i<r.n;i+=4){x0=Math.min(x0,r.X[i]);x1=Math.max(x1,r.X[i]);z0=Math.min(z0,r.Z[i]);z1=Math.max(z1,r.Z[i])}return[x0,x1,z0,z1]});
  const clear=(x,z,self,m)=>{for(let q=0;q<ROADS.length;q++){const o=ROADS[q],b=boxes[q];if(!b||o===self||x<b[0]-60||x>b[1]+60||z<b[2]-60||z>b[3]+60)continue;for(let i=0;i<o.n;i+=2){const dx=o.X[i]-x,dz=o.Z[i]-z,l=o.hw+m;if(dx*dx+dz*dz<l*l)return false}}return true};
  const cand=ROADS.filter(r=>!r.city&&(r.style==0||r.style==1)&&r.n*r.ds>1500&&!r.def.flat);let k=0;
  for(const par of cand){const L=par.n*par.ds;for(let s=300+rng()*300;s<L-1000;s+=1100+rng()*500){const span=700+rng()*300,i0=Math.round(s/par.ds),i1=Math.round((s+span)/par.ds);if(i1>par.n-30)break;
      let built=false;const s1=(k++&1)?1:-1;for(const side of[s1,-s1]){if(built)break;const t0=_tan(par,i0),t1=_tan(par,i1),D=150+rng()*150,pts=[];
      pts.push([par.X[i0],par.Z[i0]]);{const o=par.hw+30;pts.push([par.X[i0]-t0[1]*side*o,par.Z[i0]+t0[0]*side*o])}
      for(const f of[.22,.5,.78]){const i=Math.round(i0+(i1-i0)*f),t=_tan(par,i),d=D*(f==.5?1:.75)+(rng()-.5)*60,al=(rng()-.5)*60;pts.push([par.X[i]-t[1]*side*d+t[0]*al,par.Z[i]+t[0]*side*d+t[1]*al])}
      {const o=par.hw+30;pts.push([par.X[i1]-t1[1]*side*o,par.Z[i1]+t1[0]*side*o])}pts.push([par.X[i1],par.Z[i1]]);
      const def={id:'trail'+out.length,hw:3.4,lanes:1,style:5,lift:.03,smooth:40,grade:.16,from:par.id,to:par.id,pts},R=buildRoad(def,true);let ok=true;
      for(let i=0;i<R.n&&ok;i+=3){const x=R.X[i],z=R.Z[i],end=Math.min(i,R.n-1-i)*R.ds;if(baseH(x,z)<4||DISTRICT_BOXES.some(B=>inBox(x,z,B,120))||SAFEHOUSES.some(h=>Math.hypot(h.x-x,h.z-z)<90))ok=false;
        else if(end>par.hw+36&&!clear(x,z,null,end<80?12:40))ok=false}
      if(!ok)continue;out.push(buildRoad(def));built=true}}}
  return out}
