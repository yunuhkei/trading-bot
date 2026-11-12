'use strict';
/* ===== the cars: 30 made-up supercars, each in the spirit of a real one ===== */
/* None of these is a real car or carries a real name. Each is a body made by cgBuild (70_carmesh.js) from a few numbers, and each drives like the kind of car it is inspired by:
   `real` holds the figures of that kind of car (power hp, mass kg, which wheels drive, top speed km/h, 0-100 km/h seconds, best lateral g, braking distance from 100 km/h in m) and carHandling()
   turns them into the handling numbers (see below). The first car is the reference: every number in HND (40_car.js) is exactly what it was, so it drives as before. */
const CARSEL={cur:0};
const CARARCH={
 /* rear-engined coupe: short bonnet, fastback roof, wide hips */
 rr:{L:4.52,W:1.86,H:1.30,wb:2.45,fo:.90,nose:.60,hood:.88,cowl:1.36,roofF:2.08,roofR:2.55,rearS:3.95,deck:.98,tail:.88,hw0:.80,hwMax:.945,hwMaxS:3.1,hwTail:.84,crown:.085,rf:.33,rr:.345,wf:.245,wr:.31,rimF:.235,rimR:.245,tf:.76,tr:.79,head:'round',tail_:'bar',wing:'lip',exh:2,sideIntake:.2,intake:'mid',spoke:5,capR:.6},
 /* mid-engined wedge: cab forward, low, big intakes, engine cover */
 mid:{L:4.55,W:1.95,H:1.19,wb:2.66,fo:.94,nose:.46,hood:.86,cowl:1.52,roofF:2.30,roofR:2.58,rearS:3.50,deck:.96,tail:.84,hw0:.82,hwMax:.98,hwMaxS:3.0,hwTail:.88,crown:.07,rf:.335,rr:.355,wf:.255,wr:.32,rimF:.24,rimR:.255,tf:.80,tr:.82,head:'led',tail_:'wide',wing:'lip',exh:2,sideIntake:.34,intake:'wide',louvres:3,rearGlass:0,spoke:5,capR:.55},
 /* front-engined grand tourer: long bonnet, cabin set back, short tail */
 gt:{L:4.72,W:1.93,H:1.29,wb:2.76,fo:.95,nose:.60,hood:.94,cowl:1.98,roofF:2.74,roofR:3.20,rearS:4.12,deck:.98,tail:.90,hw0:.85,hwMax:.96,hwMaxS:3.4,hwTail:.9,crown:.08,rf:.34,rr:.355,wf:.275,wr:.315,rimF:.245,rimR:.255,tf:.80,tr:.81,head:'oval',tail_:'quad',wing:'lip',exh:4,exhS:'twin',intake:'wide',duct:1,spoke:5,capR:.45},
 /* hypercar: very wide and low, big wing, big intakes */
 hyper:{L:4.62,W:2.02,H:1.13,wb:2.72,fo:.96,nose:.44,hood:.82,cowl:1.50,roofF:2.30,roofR:2.55,rearS:3.56,deck:.98,tail:.86,hw0:.86,hwMax:1.0,hwMaxS:3.0,hwTail:.91,crown:.07,rf:.34,rr:.365,wf:.275,wr:.33,rimF:.25,rimR:.265,tf:.82,tr:.84,head:'slit',tail_:'slit',wing:'big',exh:4,exhS:'center',sideIntake:.4,intake:'wide',louvres:4,rearGlass:0,diff:1,wheelStyle:'mesh',spoke:14,capR:.55},
 /* lightweight: short, narrow, simple */
 light:{L:3.95,W:1.78,H:1.16,wb:2.36,fo:.80,nose:.50,hood:.80,cowl:1.32,roofF:1.98,roofR:2.28,rearS:3.26,deck:.86,tail:.78,hw0:.76,hwMax:.89,hwMaxS:2.8,hwTail:.8,crown:.075,rf:.31,rr:.325,wf:.2,wr:.255,rimF:.21,rimR:.22,tf:.72,tr:.74,head:'round',tail_:'round',wing:'duck',exh:1,exhS:'center',sideIntake:.25,intake:'mid',rearGlass:0,louvres:2,spoke:6,capR:.4},
 /* angular classic wedge / 80s-90s supercar: sharp edges, pop-up lamps, boxy cabin */
 retro:{L:4.45,W:1.92,H:1.12,wb:2.5,fo:.92,nose:.44,hood:.76,cowl:1.40,roofF:2.20,roofR:2.52,rearS:3.46,deck:.94,tail:.88,hw0:.85,hwMax:.96,hwMaxS:3.0,hwTail:.92,crown:.03,tum:.09,rf:.325,rr:.35,wf:.24,wr:.3,rimF:.235,rimR:.25,tf:.78,tr:.8,head:'pop',tail_:'wide',wing:'big',exh:2,sideIntake:.3,intake:'wide',louvres:4,rearGlass:0,spoke:6,wheelStyle:'disc',capF:.3,capR:.35},
 /* muscle supercar: long, wide, bonnet vent, dual stripes */
 muscle:{L:4.88,W:1.97,H:1.28,wb:2.76,fo:.98,nose:.66,hood:.97,cowl:1.94,roofF:2.64,roofR:3.2,rearS:4.2,deck:1.0,tail:.96,hw0:.88,hwMax:.98,hwMaxS:3.4,hwTail:.93,crown:.06,tum:.07,rf:.35,rr:.36,wf:.29,wr:.34,rimF:.25,rimR:.26,tf:.82,tr:.83,head:'oval',tail_:'bar',wing:'duck',exh:2,exhS:'twin',duct:1,intake:'wide',stripe:.16,spoke:5,capR:.4},
 /* boxy road-and-track coupe (hot hatch of supercars) */
 coupe:{L:4.68,W:1.93,H:1.37,wb:2.78,fo:.9,nose:.66,hood:.92,cowl:1.62,roofF:2.40,roofR:3.20,rearS:4.05,deck:1.02,tail:.98,hw0:.86,hwMax:.96,hwMaxS:3.4,hwTail:.9,crown:.07,tum:.06,rf:.34,rr:.35,wf:.255,wr:.285,rimF:.24,rimR:.25,tf:.8,tr:.81,head:'slit',tail_:'round',wing:'gt',exh:4,exhS:'twin',intake:'wide',spoke:7,capR:.4},
 /* open speedster / track car */
 speed:{L:3.85,W:1.75,H:.98,wb:2.38,fo:.74,nose:.46,hood:.70,cowl:1.20,roofF:1.62,roofR:1.8,rearS:2.7,deck:.80,tail:.76,hw0:.74,hwMax:.86,hwMaxS:2.7,hwTail:.78,crown:.07,rf:.32,rr:.335,wf:.22,wr:.28,rimF:.22,rimR:.23,tf:.70,tr:.72,head:'round',tail_:'round',wing:'big',exh:2,exhS:'high',intake:'mid',rearGlass:0,mirror:1,spoke:6,capR:.35}};
const _C=(arch,over)=>Object.assign({},CARARCH[arch],over||{});
/* paint, rim, caliper colours */
const P=(r,g,b)=>[r,g,b];
const CAR_ROSTER=[
 /* 1 rear-engine coupe (reference: everything else is measured against it) */
 {id:'k1',name:'Kestrel S',cls:'Rear-engine coupe',paint:P(196,28,36),rim:P(200,204,210),caliper:P(205,28,28),spec:_C('rr'),real:{hp:443,kg:1530,drive:'RR',top:308,t100:3.7,lat:1.05,brk:34}},
 {id:'k2',name:'Kestrel Turbo',cls:'Rear-engine coupe, all-wheel drive',paint:P(30,44,70),rim:P(60,64,70),caliper:P(30,30,34),spec:_C('rr',{W:1.90,hwMax:.96,wing:'duck',tf:.77,tr:.8,rr:.35,wr:.315}),real:{hp:640,kg:1640,drive:'AWD',top:330,t100:2.7,lat:1.12,brk:33}},
 {id:'k3',name:'Kestrel RS',cls:'Track-bred rear-engine coupe',paint:P(236,236,232),rim:P(30,30,34),caliper:P(240,190,30),spec:_C('rr',{wing:'big',W:1.89,hwMax:.96,H:1.28,stripe:.12,duct:1,tf:.77,tr:.80,wf:.255,wr:.32,louvres:0,diff:1}),real:{hp:520,kg:1450,drive:'RR',top:296,t100:3.2,lat:1.28,brk:32}},
 /* Cavallo: Italian red-blooded mid- and front-engined cars */
 {id:'c1',name:'Cavallo Otto',cls:'Mid-engine V8',paint:P(210,16,24),rim:P(190,194,200),caliper:P(30,30,34),spec:_C('mid',{head:'led',tail_:'wide'}),real:{hp:710,kg:1435,drive:'MR',top:340,t100:2.9,lat:1.15,brk:32}},
 {id:'c2',name:'Cavallo Dodici',cls:'Front-engine V12 GT',paint:P(24,60,110),rim:P(36,38,44),caliper:P(210,30,30),spec:_C('gt',{L:4.78,nose:.66,hood:.9,head:'led',tail_:'round',exh:4}),real:{hp:789,kg:1630,drive:'FR',top:340,t100:2.9,lat:1.1,brk:34}},
 {id:'c3',name:'Cavallo Erede',cls:'Hybrid hypercar',paint:P(220,18,30),rim:P(30,30,34),caliper:P(240,190,30),spec:_C('hyper',{wing:'lip',H:1.12,L:4.7}),real:{hp:963,kg:1255,drive:'MR',top:350,t100:2.4,lat:1.28,brk:31}},
 {id:'c4',name:'Cavallo Quaranta',cls:'Classic turbo supercar',paint:P(190,14,20),rim:P(180,184,190),caliper:P(30,30,34),spec:_C('retro',{wing:'big',head:'slit',intake:'wide',W:1.97}),real:{hp:478,kg:1250,drive:'MR',top:324,t100:4.1,lat:1.0,brk:36}},
 /* Toro: sharp-edged wedges */
 {id:'t1',name:'Toro Diez',cls:'Mid-engine V10, all-wheel drive',paint:P(255,200,0),rim:P(30,30,34),caliper:P(255,200,0),spec:_C('mid',{head:'slit',tail_:'slit',tum:.07,crown:.05,louvres:2}),real:{hp:640,kg:1422,drive:'AWD',top:325,t100:2.9,lat:1.15,brk:31}},
 {id:'t2',name:'Toro Doce',cls:'Mid-engine V12, all-wheel drive',paint:P(240,120,10),rim:P(30,30,34),caliper:P(30,30,34),spec:_C('mid',{L:4.78,W:2.03,H:1.14,wb:2.7,head:'slit',tail_:'quad',exh:4,tum:.08,crown:.05,louvres:4,wing:'lip'}),real:{hp:740,kg:1575,drive:'AWD',top:350,t100:2.9,lat:1.12,brk:33}},
 {id:'t3',name:'Toro Muro',cls:'Classic wedge',paint:P(230,230,224),rim:P(190,194,200),caliper:P(30,30,34),spec:_C('retro',{head:'pop',wing:'big',L:4.14,W:2.0,hwMax:1.0}),real:{hp:455,kg:1490,drive:'MR',top:295,t100:4.9,lat:.95,brk:38}},
 {id:'t4',name:'Toro Sesto',cls:'Hybrid hypercar, all-wheel drive',paint:P(40,150,90),rim:P(30,30,34),caliper:P(40,40,44),spec:_C('hyper',{head:'led',tail_:'bar',wing:'lip',W:2.0}),real:{hp:808,kg:1595,drive:'AWD',top:350,t100:2.8,lat:1.2,brk:32}},
 /* Stag: British front-engine grand tourers */
 {id:'s1',name:'Stag Vantage',cls:'Front-engine V8 GT',paint:P(50,90,70),rim:P(36,38,44),caliper:P(205,160,40),spec:_C('gt',{head:'oval',tail_:'bar',exh:2}),real:{hp:510,kg:1530,drive:'FR',top:314,t100:3.6,lat:1.05,brk:34}},
 {id:'s2',name:'Stag Zero',cls:'Front-engine V12 hyper GT',paint:P(180,180,186),rim:P(30,30,34),caliper:P(30,30,34),spec:_C('gt',{L:4.8,W:1.95,H:1.22,nose:.6,hood:.84,head:'slit',tail_:'wide',exh:4}),real:{hp:750,kg:1740,drive:'FR',top:355,t100:3.5,lat:1.1,brk:35}},
 /* Union: American cars */
 {id:'u1',name:'Union GT',cls:'Mid-engine twin-turbo',paint:P(24,70,150),rim:P(230,230,234),caliper:P(230,230,234),spec:_C('mid',{H:1.12,L:4.76,W:1.99,wb:2.7,head:'led',tail_:'quad',exh:2,stripe:.11,wing:'lip',sideIntake:.4}),real:{hp:647,kg:1385,drive:'MR',top:347,t100:3.0,lat:1.2,brk:31}},
 {id:'u2',name:'Union Viper',cls:'Front-engine V10 muscle',paint:P(20,20,24),rim:P(190,194,200),caliper:P(200,30,30),spec:_C('muscle',{stripe:.18,head:'oval',tail_:'round',exh:2,exhS:'twin',L:4.5,wb:2.5,W:1.92}),real:{hp:645,kg:1560,drive:'FR',top:330,t100:3.3,lat:1.1,brk:35}},
 {id:'u3',name:'Union ZR',cls:'Front-engine V8 supercharged',paint:P(240,200,20),rim:P(36,38,44),caliper:P(30,30,34),spec:_C('gt',{W:1.97,hwMax:.99,head:'slit',tail_:'quad',exh:4,wing:'gt',duct:1,L:4.7}),real:{hp:755,kg:1560,drive:'FR',top:340,t100:2.85,lat:1.12,brk:33}},
 {id:'u4',name:'Union Mid',cls:'Mid-engine V8',paint:P(236,120,20),rim:P(36,38,44),caliper:P(30,30,34),spec:_C('mid',{H:1.2,head:'slit',tail_:'slit',wing:'duck',louvres:2}),real:{hp:495,kg:1530,drive:'MR',top:312,t100:3.0,lat:1.1,brk:33}},
 {id:'u5',name:'Union Hellion',cls:'Drag-strip muscle',paint:P(150,24,24),rim:P(36,38,44),caliper:P(30,30,34),spec:_C('muscle',{H:1.34,L:5.0,wb:2.95,stripe:.2,head:'oval',tail_:'bar',duct:1,wing:'lip',tf:.82,wf:.3,wr:.37}),real:{hp:840,kg:1950,drive:'FR',top:270,t100:2.3,lat:.95,brk:40}},
 /* Mac: lightweight British carbon cars */
 {id:'m1',name:'Mac Seven-Twenty',cls:'Mid-engine carbon supercar',paint:P(240,100,20),rim:P(36,38,44),caliper:P(30,30,34),spec:_C('mid',{H:1.14,L:4.54,W:1.96,head:'slit',tail_:'slit',tum:.06,wing:'lip',sideIntake:.42,louvres:0}),real:{hp:710,kg:1283,drive:'MR',top:341,t100:2.9,lat:1.2,brk:30}},
 {id:'m2',name:'Mac P One',cls:'Hybrid hypercar',paint:P(250,250,252),rim:P(30,30,34),caliper:P(240,100,20),spec:_C('hyper',{wing:'big',head:'slit',tail_:'slit',W:2.02}),real:{hp:903,kg:1395,drive:'MR',top:350,t100:2.8,lat:1.32,brk:30}},
 {id:'m3',name:'Mac Eff One',cls:'Lightweight V12 road car',paint:P(180,150,20),rim:P(200,204,210),caliper:P(30,30,34),spec:_C('mid',{L:4.29,W:1.82,H:1.14,wb:2.72,fo:.8,head:'round',tail_:'round',wing:'duck',exh:2,louvres:0,intake:'mid',sideIntake:.2,hwMax:.9,hw0:.78,cowl:1.4,roofF:1.95,roofR:2.3}),real:{hp:618,kg:1138,drive:'MR',top:386,t100:3.2,lat:1.05,brk:33}},
 /* lightweights */
 {id:'l1',name:'Lumen Exa',cls:'Lightweight mid-engine',paint:P(250,200,10),rim:P(30,30,34),caliper:P(30,30,34),spec:_C('light',{}),real:{hp:345,kg:1100,drive:'MR',top:274,t100:3.9,lat:1.22,brk:31}},
 {id:'l2',name:'Alder Quattro',cls:'Compact carbon sports car',paint:P(190,20,24),rim:P(190,194,200),caliper:P(30,30,34),spec:_C('light',{L:3.99,W:1.87,head:'led',tail_:'round',wing:'lip',tf:.76,tr:.78}),real:{hp:237,kg:895,drive:'MR',top:258,t100:4.5,lat:1.1,brk:33}},
 {id:'l3',name:'Sprite Zero',cls:'Open track car',paint:P(255,110,10),rim:P(30,30,34),caliper:P(30,30,34),spec:_C('speed'),real:{hp:350,kg:600,drive:'MR',top:260,t100:2.7,lat:1.5,brk:24}},
 /* Japan */
 {id:'j1',name:'Godzilla R',cls:'Twin-turbo, all-wheel drive coupe',paint:P(176,180,186),rim:P(30,30,34),caliper:P(205,28,28),spec:_C('coupe',{head:'slit',tail_:'round',wing:'gt',exh:4}),real:{hp:565,kg:1740,drive:'AWD',top:315,t100:2.9,lat:1.15,brk:33}},
 {id:'j2',name:'Nova X',cls:'Hybrid mid-engine, all-wheel drive',paint:P(20,60,160),rim:P(30,30,34),caliper:P(205,28,28),spec:_C('mid',{L:4.5,W:1.94,H:1.2,wb:2.63,head:'led',tail_:'bar',wing:'lip',sideIntake:.34,louvres:0}),real:{hp:573,kg:1725,drive:'AWD',top:307,t100:2.9,lat:1.1,brk:33}},
 {id:'j3',name:'Lyra F',cls:'High-revving front-engine V10',paint:P(236,236,232),rim:P(190,194,200),caliper:P(30,30,34),spec:_C('gt',{L:4.56,W:1.9,H:1.25,wb:2.6,cowl:1.8,roofF:2.3,roofR:2.95,rearS:3.9,head:'led',tail_:'round',exh:3,exhS:'center',wing:'duck'}),real:{hp:553,kg:1480,drive:'FR',top:325,t100:3.6,lat:1.1,brk:34}},
 /* hypercars */
 {id:'h1',name:'Zonda H',cls:'Mid-engine V12 hypercar',paint:P(170,174,180),rim:P(200,204,210),caliper:P(30,30,34),spec:_C('hyper',{head:'round',tail_:'quad',exh:4,exhS:'center',wing:'lip',tum:.06,wheelStyle:'spoke',spoke:5}),real:{hp:730,kg:1350,drive:'MR',top:370,t100:3.3,lat:1.3,brk:31}},
 {id:'h2',name:'Veyra',cls:'Quad-turbo all-wheel-drive hypercar',paint:P(20,24,36),rim:P(200,204,210),caliper:P(240,100,20),spec:_C('gt',{W:2.0,H:1.2,L:4.55,wb:2.7,cowl:1.8,roofF:2.3,roofR:2.9,rearS:3.8,hwMax:1.0,head:'led',tail_:'wide',exh:2,wing:'lip',stripe:.05}),real:{hp:1500,kg:1995,drive:'AWD',top:420,t100:2.4,lat:1.1,brk:35}},
 {id:'h3',name:'Agate',cls:'Twin-turbo mid-engine hypercar',paint:P(240,240,236),rim:P(30,30,34),caliper:P(30,30,34),spec:_C('hyper',{head:'slit',tail_:'slit',wing:'big',exh:4,H:1.12}),real:{hp:1360,kg:1400,drive:'MR',top:440,t100:2.8,lat:1.3,brk:30}}];
/* what makes each car look like the kind of car it is (on top of its proportions): grilles, running lights, vents, scoops, buttresses, fins, trim, the interior colour */
const CAR_EXTRA={
 k1:{drl:1,grille:'none',int:[58,40,32]},k2:{drl:1,grille:'slit',int:[24,26,34]},k3:{drl:1,canards:1,scoop:1,grille:'slit',int:[20,20,22]},
 c1:{drl:1,buttress:1,gills:2,grille:'slit',int:[70,50,40]},c2:{gills:3,scoop:1,grille:'slit',int:[60,44,36]},c3:{drl:1,buttress:1,canards:1,gills:2,int:[22,22,26]},c4:{grille:'none',gills:0,int:[60,60,64]},
 t1:{drl:1,grille:'slit',gills:1,int:[24,24,28]},t2:{drl:1,canards:1,gills:2,grille:'slit',int:[24,24,28]},t3:{scoop:1,grille:'none',int:[70,60,50]},t4:{drl:1,buttress:1,grille:'slit',int:[22,22,24]},
 s1:{grille:'wide',gills:2,chromeTrim:1,int:[84,60,44]},s2:{grille:'wide',gills:3,chromeTrim:1,drl:1,int:[76,54,40]},
 u1:{buttress:1,drl:1,canards:1,grille:'slit',int:[22,22,26]},u2:{scoop:1,gills:2,grille:'wide',int:[28,28,30]},u3:{scoop:1,gills:2,grille:'wide',canards:1,int:[30,30,32]},u4:{gills:2,drl:1,grille:'slit',int:[40,34,30]},u5:{scoop:1,grille:'wide',int:[30,30,32]},
 m1:{drl:1,canards:1,grille:'slit',int:[28,28,32]},m2:{canards:1,buttress:1,drl:1,gills:2,int:[22,22,24]},m3:{seat:'centre',grille:'slit',int:[60,52,40]},
 l1:{gills:1,grille:'slit',int:[40,40,44]},l2:{drl:1,grille:'slit',int:[34,28,26]},l3:{canards:1,int:[26,26,28]},
 j1:{scoop:1,grille:'wide',shark:1,int:[26,26,30]},j2:{drl:1,grille:'slit',gills:1,int:[30,30,34]},j3:{grille:'wide',gills:2,int:[44,34,28]},
 h1:{canards:1,gills:2,chromeTrim:1,int:[84,62,44]},h2:{grille:'horseshoe',chromeTrim:1,shark:1,gills:1,int:[34,28,24]},h3:{drl:1,canards:1,buttress:1,int:[22,22,24]}};
/* BATCH 4: A FACE AND A TAIL OF ITS OWN FOR EVERY CAR. No two cars share the pair (head lamps, tail lamps), and each has its own nose and tail SHAPE and its own amount of crease:
   h head lamps (round, oval, slit, led, pop, twin, blade, tri, box), t tail lamps (bar, round, quad, slit, wide, ring, vert, dots, slim, slash, block),
   n = [noseP, capF, noseDrop]: how the nose closes in plan (1.3 a pointed wedge ... 8 a blunt brick), how far back the closing starts, how thin the tip is; r = the same three for the tail (a big tailP with a short cap is a
   cut-off Kamm tail), q the shoulder (4.5 soft and round ... 11 a box section), k how hard the creases are shaded (0-1), c the depth of the character line on the flank, sp a spine down the bonnet (m),
   f the paint finish (0 solid, 1 metallic, 2 pearl, 3 matte) and p2 the second colour of a pearl. */
const CAR_STYLE={
 k1:{h:'round',t:'slim',n:[2.8,.42,.3],r:[2.6,.7,.3],q:4.6,k:.5,c:.6,f:0},k2:{h:'oval',t:'bar',n:[3.0,.4,.34],r:[2.8,.66,.32],q:4.8,k:.55,c:.8,f:1},k3:{h:'twin',t:'dots',n:[2.6,.45,.28],r:[3.2,.55,.4],q:5,k:.6,c:1,f:0},
 c1:{h:'blade',t:'ring',n:[2.0,.55,.22],r:[4,.4,.4],q:5.5,k:.75,c:1.4,f:0},c2:{h:'led',t:'round',n:[2.4,.6,.28],r:[3,.5,.32],q:5,k:.6,c:1,f:1},c3:{h:'slit',t:'wide',n:[1.7,.7,.18],r:[5,.35,.45],q:6,k:.9,c:1.8,sp:.025,f:2,p2:[255,120,40]},c4:{h:'box',t:'quad',n:[4.5,.5,.45],r:[9,.22,.7],q:9,k:1,c:2.2,f:0},
 t1:{h:'tri',t:'slash',n:[1.5,.7,.2],r:[6,.3,.5],q:8,k:1,c:2.4,sp:.03,f:2,p2:[255,140,10]},t2:{h:'blade',t:'vert',n:[1.4,.8,.15],r:[7,.28,.55],q:9,k:1,c:2.6,sp:.04,f:2,p2:[255,50,90]},t3:{h:'pop',t:'block',n:[1.25,.9,.12],r:[10,.18,.8],q:11,k:1,c:2.8,f:0},t4:{h:'tri',t:'slim',n:[2.6,.5,.3],r:[8,.24,.7],q:7.5,k:1,c:2.2,sp:.03,f:1},
 s1:{h:'oval',t:'slit',n:[3.4,.4,.4],r:[2.6,.6,.3],q:4.4,k:.45,c:.7,f:1},s2:{h:'led',t:'vert',n:[2.8,.5,.3],r:[3.6,.45,.36],q:5,k:.6,c:1.2,f:1},
 u1:{h:'oval',t:'ring',n:[2.2,.55,.22],r:[8,.22,.7],q:6,k:.8,c:1.6,f:1},u2:{h:'slit',t:'round',n:[3,.5,.35],r:[4,.4,.4],q:5,k:.6,c:1,sp:.02,f:1},u3:{h:'tri',t:'quad',n:[2,.6,.24],r:[6,.3,.55],q:7,k:.9,c:2,sp:.035,f:0},u4:{h:'blade',t:'block',n:[1.8,.6,.22],r:[6,.3,.5],q:7,k:.9,c:1.9,f:2,p2:[255,210,60]},u5:{h:'twin',t:'wide',n:[8,.22,.75],r:[8,.22,.75],q:7.5,k:.85,c:1.5,f:3},
 m1:{h:'oval',t:'slim',n:[2.1,.6,.2],r:[3.2,.5,.3],q:5,k:.65,c:1.2,f:0},m2:{h:'slit',t:'dots',n:[1.9,.65,.18],r:[3,.55,.25],q:5.5,k:.8,c:1.6,f:2,p2:[140,190,255]},m3:{h:'twin',t:'round',n:[2.6,.5,.3],r:[3.6,.4,.36],q:4.8,k:.5,c:.8,f:1},
 l1:{h:'round',t:'quad',n:[2.4,.45,.3],r:[5,.3,.5],q:5.5,k:.7,c:1.3,f:0},l2:{h:'led',t:'ring',n:[3,.4,.35],r:[3,.45,.32],q:4.6,k:.5,c:.9,f:1},l3:{h:'round',t:'dots',n:[1.8,.5,.24],r:[4,.35,.4],q:6,k:.8,c:1.5,f:3},
 j1:{h:'box',t:'ring',n:[5.5,.3,.6],r:[8,.24,.75],q:8.5,k:1,c:2,f:1},j2:{h:'tri',t:'bar',n:[2,.6,.24],r:[5,.32,.45],q:6.5,k:.9,c:1.8,f:2,p2:[120,40,200]},j3:{h:'blade',t:'slash',n:[2.3,.55,.26],r:[6,.3,.6],q:6,k:.85,c:1.7,sp:.02,f:2,p2:[255,190,215]},
 h1:{h:'twin',t:'quad',n:[2.2,.6,.2],r:[3,.5,.3],q:5,k:.6,c:1.1,f:1},h2:{h:'box',t:'wide',n:[3.6,.4,.4],r:[2.8,.55,.32],q:4.6,k:.5,c:.8,f:1},h3:{h:'led',t:'slit',n:[2,.6,.2],r:[4.5,.35,.42],q:5.5,k:.75,c:1.4,f:3}};
for(const d of CAR_ROSTER){const e=CAR_EXTRA[d.id]||{};Object.assign(d.spec,e);if(e.int)d.interior=e.int;delete d.spec.int;d.spec._name=d.name;
  const y=CAR_STYLE[d.id];if(y){Object.assign(d.spec,{head:y.h,tail_:y.t,noseP:y.n[0],capF:y.n[1],noseDrop:y.n[2],tailP:y.r[0],capR:y.r[1],tailDrop:y.r[2],sq:y.q,hard:y.k,crease:y.c,spine:y.sp||0});d.fin=y.f|0;if(y.p2)d.paint2=y.p2}}
/* ---------------- handling from the real figures ---------------- */
/* Everything is measured against the first car, so it keeps exactly the old numbers. Top speed, acceleration, grip, braking and agility come from the figures; the drive layout changes how the tail behaves:
   all-wheel drive grips more and slides less, front-engine rear-drive cars light up the rear tyres under power (the more power for the weight, the more), mid-engine cars turn in sharply and let go suddenly. */
const HND0=Object.assign({},HND,{vmax:80,vmaxG:62,powerOS:0,mass:1530});
const CAR_REF={hp:443,kg:1530,top:308,t100:3.7,lat:1.05,brk:34,wb:2.45};
function carHandling(def){
  const r=def.real,B=HND0,S=def.spec,wb=S.wb||2.45;Object.assign(HND,B);
  const comp=x=>1+(x-1)*.75,vm=comp(r.top/CAR_REF.top),ac=Math.pow(CAR_REF.t100/r.t100,.8),gr=Math.pow(r.lat/CAR_REF.lat,.9),br=Math.pow(CAR_REF.brk/r.brk,.9),ag=Math.pow(CAR_REF.kg/r.kg,.35)*Math.pow(CAR_REF.wb/wb,.5);
  HND.vmax=B.vmax*vm;HND.vmaxG=B.vmaxG*Math.sqrt(vm);HND.accel=B.accel*ac;HND.accelLow=B.accelLow*Math.pow(ac,.8);
  HND.aBase=B.aBase*gr;HND.aAero=B.aAero*_cl(1+(r.lat-CAR_REF.lat)*2.2,.7,2);HND.grip=B.grip*Math.sqrt(gr);HND.brake=B.brake*br;
  HND.omLow=B.omLow*Math.pow(ag,.7);HND.respond=B.respond*Math.pow(ag,.5);HND.respondDrift=B.respondDrift*Math.pow(ag,.5);HND.mass=r.kg;
  const hpkg=r.hp/r.kg,ref=CAR_REF.hp/CAR_REF.kg;
  if(r.drive=='AWD'){HND.aBase*=1.03;HND.betaFast=B.betaFast*.85;HND.betaSlow=B.betaSlow*.9;HND.gripDrift=B.gripDrift*1.2;HND.driftFric=B.driftFric*1.08;HND.powerOS=0}
  else if(r.drive=='FR'||r.drive=='RWD'){HND.betaFast=B.betaFast*.95;HND.powerOS=_cl((hpkg-ref)*1.0,0,.22)}
  else if(r.drive=='MR'){HND.betaFast=B.betaFast*1.08;HND.gripDrift=B.gripDrift*.92;HND.omLow=HND.omLow*1.04;HND.powerOS=_cl((hpkg-ref)*.6,0,.15)}
  return HND}
/* make car number i the car: body and handling */
function carSelect(i){i=_cl(i|0,0,CAR_ROSTER.length-1);CARSEL.cur=i;const def=CAR_ROSTER[i];carHandling(def);if(G.gl){carInstall(def,carPaintOf(i));CARM.idx=i}
  TR.P.hl=def.spec.L/2-.05;TR.P.hw=def.spec.W/2;TR.P.m=def.real.kg;TR.P.I=def.real.kg*(TR.P.hl*TR.P.hl+TR.P.hw*TR.P.hw)/3;return def}
