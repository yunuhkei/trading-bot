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
  makeTown('pac',TOWN_PAC,'coast',{du:90,dv:80});
  makeTown('fre',TOWN_FRE,'farm',{du:95,dv:75});
  makeTown('bar',TOWN_BAR,'desert',{du:90,dv:90});
  makeTown('big',TOWN_BIG,'pines',{du:80,dv:80});
  makeTown('har',IND_HAR,'ind',{kind:'ind',du:150,dv:100,hw:8,phw:9,mu:60,mv:50});
  makeTown('moj',IND_MOJ,'ind',{kind:'ind',du:150,dv:90,hw:8,phw:9,mu:60,mv:45});
  /* the three new cities (world 1c): Las Vegas with the Strip down its middle, Sacramento, San Jose */
  makeTown('veg',CITY_VEG,'vegas',{kind:'vegas',du:130,dv:110,hw:7.5,phw:10,mu:65,mv:60,uw:{2:{hw:12,style:4}}});
  makeTown('sac',CITY_SAC,'cap',{kind:'cap',du:120,dv:95,hw:7.5,phw:10,mu:55,mv:50});
  makeTown('sj',CITY_SJ,'tech',{kind:'tech',du:150,dv:125,hw:7.5,phw:10,mu:85,mv:60});
  const R_=id=>ROADS.find(q=>q.id==id);
  const mp=R_('mp'),cr=R_('cr'),bar=R_('barp'),moj=R_('mojp'),big=R_('bigp'),fre=R_('frep'),pac=R_('pacp'),har=R_('harp'),look=R_('lookout'),veg=R_('vegp'),sac=R_('sacp'),sj=R_('sjp'),bv=R_('bv');
  /* ---------- east: the desert highway to Barstow, the refinery, and the loop back along the southern highway ---------- */
  buildCurvy({id:'eh',hw:10,lanes:2,style:1,from:'ring',to:'barp',lift:.085,smooth:100,minR:60,wig:{a1:180,l1:600,a2:50,l2:240,seed:51,fade:220},
    pts:tJoin(ring,jn(ring,1440,50),2300,250).concat([[2300,250],[2750,520],[3150,800],[3450,1100]]).concat(tIn(bar,3580,1180))});   /* leaves the ring exactly opposite the boulevard road (bv): one crossroads */
  buildCurvy({id:'sh2',hw:9,lanes:1,style:0,yFrom:'lookout',to:'mojp',lift:.09,smooth:80,minR:50,wig:{a1:60,l1:420,a2:16,l2:160,seed:52,fade:140},
    pts:tOut(look,2830,2400).concat([[2900,2385]]).concat(tIn(moj,3040,2285))});
  buildCurvy({id:'sh3',hw:10,lanes:2,style:1,yFrom:'mojp',to:'barp',lift:.095,smooth:100,minR:60,wig:{a1:90,l1:480,a2:24,l2:180,seed:53,fade:150},
    pts:tOut(moj,3360,2080).concat([[3400,1900],[3470,1760]]).concat(tIn(bar,3545,1650))});
  /* the canyon road: along the floor of the canyon, up to a turnaround on the rim */
  loopRoad('rim',3600,-2700,40,6,.1);
  buildRoad({id:'cyr',hw:7,lanes:1,style:0,lift:.06,smooth:40,grade:.12,yFrom:'eh',yTo:'rim',
    pts:tOut(R_('eh'),3040,640).concat([[3030,500]]).concat(CANYON).slice(0,-1).concat(tIn(R_('rim'),3600,-2600))});
  /* ---------- north: from the ring over the mountain pass loop to the village in the foothills ---------- */
  buildCurvy({id:'nh1',hw:10,lanes:2,style:1,from:'ring',to:'mp',lift:.075,smooth:100,minR:60,wig:{a1:140,l1:600,a2:40,l2:240,seed:54,fade:200},
    pts:ramp(ring,-100,-1385,-120,-1900,10).concat([[-120,-1900],[-170,-2200]]).concat(tIn(mp,-190,-2380))});
  buildCurvy({id:'nh2',hw:10,lanes:2,style:1,yFrom:'mp',to:'bigp',lift:.078,smooth:70,grade:.17,minR:55,wig:{a1:100,l1:420,a2:30,l2:180,seed:55,fade:160},
    pts:tJoin(mp,jn(mp,-190,-2380),-175,-2780).concat([[-175,-2780],[-190,-2880]]).concat(tIn(big,-190,-2950))});   /* starts where nh1 ends on the pass: one crossroads */
  /* ---------- north-west: the farm roads ---------- */
  buildCurvy({id:'fr1',hw:7,lanes:1,style:0,yFrom:'mp',to:'frep',lift:.07,smooth:60,minR:40,wig:{a1:40,l1:300,a2:12,l2:120,seed:56,fade:100},
    pts:tOut(mp,-1150,-2110).concat([[-1250,-2130]]).concat(tIn(fre,-1330,-2135))});
  buildCurvy({id:'fr2',hw:7,lanes:1,style:0,yFrom:'frep',to:'mp',lift:.072,smooth:60,minR:40,wig:{a1:60,l1:320,a2:16,l2:130,seed:57,fade:100},
    pts:tOut(fre,-1510,-1960).concat([[-1520,-1800],[-1470,-1620],[-1400,-1530]]).concat(tIn(mp,-1330,-1500))});
  /* ---------- the coast and the harbour ---------- */
  buildRoad({id:'pcl',hw:6,lanes:1,style:0,yFrom:'cr',yTo:'pacp',lift:.07,pts:[at(cr,jn(cr,-1840,1500)),at(pac,jn(pac,-1860,1500))]});
  buildRoad({id:'hb',hw:7,lanes:1,style:0,yFrom:'sh',yTo:'harp',lift:.08,pts:(q=>[at(sh,q),[sh.X[q],IND_HAR.z0]])(jn(sh,1000,2420))});
  /* ---------- the roads to the new cities ---------- */
  /* Las Vegas: a desert highway from Barstow and a road from Mojave Works */
  buildCurvy({id:'vg1',hw:10,lanes:2,style:1,yFrom:'barp',to:'vegp',lift:.09,smooth:90,minR:60,wig:{a1:50,l1:420,a2:14,l2:170,seed:61,fade:120},
    pts:tOut(bar,3930,1380).concat([[4010,1500],[4150,1680]]).concat(tIn(veg,4220,1700))});
  buildCurvy({id:'vg2',hw:9,lanes:1,style:0,yFrom:'mojp',to:'vegp',lift:.092,smooth:70,minR:50,wig:{a1:30,l1:300,a2:8,l2:120,seed:62,fade:90},
    pts:tOut(moj,3660,2285).concat([[3790,2200]]).concat(tIn(veg,3900,2100))});
  /* Sacramento: west to the north highway, south to the ring, north to the mountain pass */
  buildCurvy({id:'sc1',hw:9,lanes:1,style:0,yFrom:'sacp',to:'nh1',lift:.08,smooth:50,minR:45,wig:{a1:10,l1:200,a2:3,l2:90,seed:63,fade:60,hold:50},pts:tOut(sac,0,-2025).concat(tIn(R_('nh1'),-60,-2025))});
  buildCurvy({id:'sc2',hw:10,lanes:2,style:1,yFrom:'sacp',to:'ring',lift:.082,smooth:70,minR:50,wig:{a1:24,l1:260,a2:6,l2:110,seed:64,fade:80,hold:60},pts:tOut(sac,310,-1700).concat([[320,-1620]]).concat(tIn(ring,330,-1560))});
  buildCurvy({id:'sc3',hw:9,lanes:1,style:0,yFrom:'sacp',to:'mp',lift:.084,smooth:50,grade:.12,minR:40,wig:{a1:10,l1:200,a2:3,l2:90,seed:65,fade:60,hold:50},pts:tOut(sac,310,-2320).concat(tIn(mp,300,-2420))});
  /* San Jose: south to the boulevard road, west to the ring */
  buildCurvy({id:'sj1',hw:10,lanes:2,style:1,yFrom:'sjp',to:'bv',lift:.086,smooth:70,minR:50,wig:{a1:30,l1:300,a2:8,l2:120,seed:66,fade:90,hold:60},pts:tOut(sj,-70,-380).concat([[-60,-240]]).concat(tIn(bv,-50,-120))});
  buildCurvy({id:'sj2',hw:9,lanes:1,style:0,yFrom:'sjp',to:'ring',lift:.088,smooth:60,minR:45,wig:{a1:12,l1:220,a2:4,l2:100,seed:67,fade:60,hold:50},pts:tOut(sj,-450,-690).concat(tIn(ring,-560,-860))});
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
  addSafe('vegas','Las Vegas Garage','vegp',.1,-1,16);addSafe('sacramento','Sacramento Garage','sacp',.1,-1,16);addSafe('sanjose','San Jose Garage','sjp',.1,-1,16);
}
