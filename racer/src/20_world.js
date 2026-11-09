'use strict';
/* ===== the wider county: towns, industry, farms and the highways that join them to the rest of the network =====
   Called at the end of defineRoads(). H = {ramp,rampIn,tIn}: the junction helpers from 20_map.js. */
/* a small town or industrial area: a street grid clipped to a box, ringed by a boulevard */
function makeTown(id,B,theme,o){o=o||{};
  const us=[],vs=[];for(let x=B.x0+(o.mu||45);x<B.x1-30;x+=o.du||95)us.push(x);for(let z=B.z0+(o.mv||40);z<B.z1-30;z+=o.dv||85)vs.push(z);
  const g=gridStreets({id,kind:o.kind||'town',theme,ox:0,oz:0,ang:0,us,vs,hw:o.hw||5.5,style:3,lift:o.lift||.05,planes:planesBox(B)});
  g.box=B;g.phw=o.phw||7;perimeter(id+'p',B,g.phw,(o.lift||.05)+.005);return g}
/* a spot beside a road: x,z and the road's direction (cs,sn) there; side +1 is to the left of the direction of travel, -1 to the right */
function besideRoad(id,f,side,off){const r=ROADS.find(q=>q.id==id);if(!r)return null;const i=Math.max(1,Math.min(r.n-2,Math.round(f*(r.closed?r.n:r.n-1)))),t=_tan(r,i),nx=-t[1],nz=t[0],d=r.hw+RSH+off;
  return{x:r.X[i]+nx*side*d,z:r.Z[i]+nz*side*d,cs:t[0],sn:t[1]}}
function addSafe(id,name,road,f,side,off){const p=besideRoad(road,f,side,off||14);if(p)SAFEHOUSES.push({id,name,x:p.x,z:p.z,cs:p.cs,sn:p.sn})}
function defineWorld(ring,sh,H){
  const {ramp,rampIn,tIn}=H;
  /* ---------- towns and industrial areas ---------- */
  makeTown('pac',TOWN_PAC,'coast',{du:90,dv:80});
  makeTown('fre',TOWN_FRE,'farm',{du:95,dv:75});
  makeTown('bar',TOWN_BAR,'desert',{du:90,dv:90});
  makeTown('big',TOWN_BIG,'pines',{du:80,dv:80});
  makeTown('har',IND_HAR,'ind',{kind:'ind',du:150,dv:100,hw:8,phw:9,mu:60,mv:50});
  makeTown('moj',IND_MOJ,'ind',{kind:'ind',du:150,dv:90,hw:8,phw:9,mu:60,mv:45});
  const R_=id=>ROADS.find(q=>q.id==id);
  const mp=R_('mp'),cr=R_('cr'),bar=R_('barp'),moj=R_('mojp'),big=R_('bigp'),fre=R_('frep'),pac=R_('pacp'),har=R_('harp'),look=R_('lookout');
  /* ---------- east: the desert highway to Barstow, the refinery, and the loop back along the southern highway ---------- */
  buildCurvy({id:'eh',hw:10,lanes:2,style:1,from:'ring',to:'barp',lift:.085,smooth:100,minR:60,wig:{a1:180,l1:600,a2:50,l2:240,seed:51,fade:220},
    pts:ramp(ring,1680,60,2300,250,10).concat([[2300,250],[2750,520],[3150,800],[3450,1100],[3560,1180]]).concat([tIn(bar,3580,1180)])});
  buildCurvy({id:'sh2',hw:9,lanes:1,style:0,yFrom:'lookout',to:'mojp',lift:.09,smooth:80,minR:50,wig:{a1:60,l1:420,a2:16,l2:160,seed:52,fade:140},
    pts:[tIn(look,2830,2400),[2900,2385],[3030,2340],tIn(moj,3040,2300)]});
  buildCurvy({id:'sh3',hw:10,lanes:2,style:1,yFrom:'mojp',to:'barp',lift:.095,smooth:100,minR:60,wig:{a1:90,l1:480,a2:24,l2:180,seed:53,fade:150},
    pts:[tIn(moj,3380,2080),[3400,1900],[3470,1760],tIn(bar,3520,1650)]});
  /* the canyon road: along the floor of the canyon, up to a turnaround on the rim */
  loopRoad('rim',3600,-2700,40,6,.1);
  buildRoad({id:'cyr',hw:7,lanes:1,style:0,lift:.06,smooth:40,grade:.12,yFrom:'eh',yTo:'rim',
    pts:[tIn(R_('eh'),3040,640),[3030,500]].concat(CANYON).slice(0,-1).concat([tIn(R_('rim'),3600,-2600)])});
  /* ---------- north: from the ring over the mountain pass loop to the village in the foothills ---------- */
  buildCurvy({id:'nh1',hw:10,lanes:2,style:1,from:'ring',to:'mp',lift:.075,smooth:100,minR:60,wig:{a1:140,l1:600,a2:40,l2:240,seed:54,fade:200},
    pts:ramp(ring,-100,-1385,-120,-1900,10).concat([[-120,-1900],[-170,-2200]]).concat([tIn(mp,-190,-2380)])});
  buildCurvy({id:'nh2',hw:10,lanes:2,style:1,yFrom:'mp',to:'bigp',lift:.078,smooth:70,grade:.17,minR:55,wig:{a1:100,l1:420,a2:30,l2:180,seed:55,fade:160},
    pts:[tIn(mp,-170,-2680),[-175,-2780],[-190,-2880],tIn(big,-190,-2950)]});
  /* ---------- north-west: the farm roads ---------- */
  buildCurvy({id:'fr1',hw:7,lanes:1,style:0,yFrom:'mp',to:'frep',lift:.07,smooth:60,minR:40,wig:{a1:40,l1:300,a2:12,l2:120,seed:56,fade:100},
    pts:[tIn(mp,-1150,-2110),[-1250,-2125],[-1300,-2130],tIn(fre,-1330,-2130)]});
  buildCurvy({id:'fr2',hw:7,lanes:1,style:0,yFrom:'frep',to:'mp',lift:.072,smooth:60,minR:40,wig:{a1:60,l1:320,a2:16,l2:130,seed:57,fade:100},
    pts:[tIn(fre,-1500,-1960),[-1520,-1800],[-1470,-1620],[-1400,-1530],tIn(mp,-1330,-1500)]});
  /* ---------- the coast and the harbour ---------- */
  buildRoad({id:'pcl',hw:6,lanes:1,style:0,yFrom:'cr',yTo:'pacp',lift:.07,pts:[tIn(cr,-1840,1500),tIn(pac,-1860,1500)]});
  buildRoad({id:'hb',hw:7,lanes:1,style:0,yFrom:'sh',yTo:'harp',lift:.08,pts:[tIn(sh,1000,2500),tIn(har,1000,2500)]});
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
}
