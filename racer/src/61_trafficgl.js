'use strict';
/* ===== traffic rendering: four low-poly body types built in code (about 200 triangles each), drawn instanced (one draw per type; if the GPU has no instancing, one draw per car) ===== */
const TRM={ready:false,types:[],pal:null,mat:null,inst:null,ibuf:null,off:null,cnt:null,vis:new Int16Array(TRN),nv:0};
/* body sections along the car, front to back: [z, bottom y, shoulder y, roof y, half width at the shoulder, half width at the roof]; side glass only where the middle of a pair lies in [gz0,gz1] */
const TRSHAPE=[
 {gz:[-1.25,.95],wheel:.33,sec:[[2.25,.30,.62,.62,.86,.76],[1.65,.28,.80,.80,.90,.80],[.75,.28,.84,1.38,.90,.70],[-.80,.28,.84,1.38,.90,.70],[-1.55,.28,.84,.90,.90,.80],[-2.25,.30,.78,.78,.86,.76]]},     /* sedan */
 {gz:[-1.7,.85],wheel:.32,sec:[[2.0,.30,.60,.60,.85,.75],[1.4,.28,.78,.78,.88,.78],[.5,.28,.82,1.36,.88,.70],[-1.1,.28,.82,1.36,.88,.70],[-2.0,.30,.76,1.0,.85,.75]]},                                /* hatch */
 {gz:[-2.0,1.0],wheel:.38,sec:[[2.4,.36,.80,.80,.90,.82],[1.75,.34,1.0,1.0,.95,.86],[.85,.34,1.04,1.62,.95,.78],[-1.9,.34,1.04,1.62,.95,.78],[-2.4,.36,.98,1.45,.92,.80]]},                             /* suv */
 {gz:[1.2,2.1],wheel:.36,sec:[[2.7,.34,.70,.70,.92,.82],[2.0,.32,.95,.95,.97,.90],[1.3,.32,1.0,1.9,.97,.88],[-2.7,.34,1.0,1.9,.97,.88]]},                                                             /* van */
 {gz:[-1.25,.95],wheel:.33,cop:1,sec:[[2.25,.30,.62,.62,.86,.76],[1.65,.28,.80,.80,.90,.80],[.75,.28,.84,1.38,.90,.70],[-.80,.28,.84,1.38,.90,.70],[-1.55,.28,.84,.90,.90,.80],[-2.25,.30,.78,.78,.86,.76]]}   /* police car: a sedan, black below the beltline, with a light bar */
];
/* tiny mesh builder: flat shaded quads/triangles, normals made to point away from the body axis */
function TMB(){this.P=[];this.N=[];this.M=[];this.I=[]}
TMB.prototype.poly=function(pts,mat,ax){/* pts: array of [x,y,z] (3 or 4), ax: [x,y,z] a point inside, to orient the normal */
  const a=pts[0],b=pts[1],c=pts[2];let ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
  let mx=0,my=0,mz=0;for(const p of pts){mx+=p[0];my+=p[1];mz+=p[2]}mx/=pts.length;my/=pts.length;mz/=pts.length;
  if((mx-ax[0])*nx+(my-ax[1])*ny+(mz-ax[2])*nz<0){nx=-nx;ny=-ny;nz=-nz}
  const base=this.P.length/3;for(const p of pts){this.P.push(p[0],p[1],p[2]);this.N.push(nx,ny,nz);this.M.push(mat)}
  for(let k=1;k<pts.length-1;k++)this.I.push(base,base+k,base+k+1)};
function trBuildType(S,hw){
  const B=new TMB(),sec=S.sec,ns=sec.length,ax=(z,y)=>[0,y,z];
  const ring=s=>[[-s[4],s[1],s[0]],[-s[4],s[2],s[0]],[-s[5],s[3],s[0]],[s[5],s[3],s[0]],[s[4],s[2],s[0]],[s[4],s[1],s[0]]];
  for(let i=0;i<ns-1;i++){const A=ring(sec[i]),Bq=ring(sec[i+1]),zm=(sec[i][0]+sec[i+1][0])/2,ym=(sec[i][1]+sec[i][3]+sec[i+1][1]+sec[i+1][3])/4,axp=[0,ym,zm];
    const cab=Math.min(sec[i][3]-sec[i][2],sec[i+1][3]-sec[i+1][2])>.25&&zm>=S.gz[0]&&zm<=S.gz[1];
    const slope=Math.abs(sec[i][3]-sec[i+1][3])>.2&&(sec[i][3]!=sec[i][2]||sec[i+1][3]!=sec[i+1][2]);
    for(let e=0;e<6;e++){const e2=(e+1)%6;if(e==5&&false)continue;
      /* edges: 0 left lower side, 1 left upper side, 2 roof/top, 3 right upper side, 4 right lower side, 5 bottom */
      let mat=0;if(e==1||e==3)mat=cab?1:0;else if(e==2)mat=slope?1:0;else if(e==5)mat=6;else if(S.cop&&(e==0||e==4))mat=9;
      B.poly([A[e],A[e2],Bq[e2],Bq[e]],mat,axp)}}
  /* front and rear fascia */
  const cap=(s,zo)=>{const R=ring(s);B.poly([R[0],R[1],R[2],R[3],R[4],R[5]].map(p=>[p[0],p[1],p[2]]),0,[0,(s[1]+s[3])/2,s[0]-zo*2])};
  cap(sec[0],1);cap(sec[ns-1],-1);
  const zf=sec[0][0],zr=sec[ns-1][0],yh=(sec[0][1]+sec[0][2])/2;
  /* headlights (front, +z), grille, tail lights (back), plate */
  for(const sd of[-1,1]){B.poly([[sd*.52,yh-.02,zf+.012],[sd*.84,yh-.02,zf+.012],[sd*.84,yh+.1,zf+.012],[sd*.52,yh+.1,zf+.012]],3,[0,yh,zf-1]);
    const yt=(sec[ns-1][1]+sec[ns-1][2])/2+.04;B.poly([[sd*.5,yt-.06,zr-.012],[sd*.84,yt-.06,zr-.012],[sd*.84,yt+.08,zr-.012],[sd*.5,yt+.08,zr-.012]],4,[0,yt,zr+1])}
  B.poly([[-.4,yh-.14,zf+.012],[.4,yh-.14,zf+.012],[.4,yh-.02,zf+.012],[-.4,yh-.02,zf+.012]],2,[0,yh,zf-1]);
  B.poly([[-.25,sec[ns-1][1]+.12,zr-.012],[.25,sec[ns-1][1]+.12,zr-.012],[.25,sec[ns-1][1]+.24,zr-.012],[-.25,sec[ns-1][1]+.24,zr-.012]],5,[0,.5,zr+1]);
  /* wheels */
  const R=S.wheel,seg=8;
  for(const zc of[zf-.78,zr+.78])for(const sd of[-1,1]){const x0=sd*(hw-.3),x1=sd*(hw+.02),ac=[sd*(hw-.6),R,zc];
    const pt=(x,r,a)=>[x,R+Math.sin(a)*r,zc+Math.cos(a)*r];
    for(let k=0;k<seg;k++){const a0=k/seg*TAU,a1=(k+1)/seg*TAU;B.poly([pt(x0,R,a0),pt(x0,R,a1),pt(x1,R,a1),pt(x1,R,a0)],2,ac);
      B.poly([[x1,R,zc],pt(x1,R,a0),pt(x1,R,a1)],2,[sd*(hw-.6),R,zc]);
      B.poly([[x1+sd*.008,R,zc],pt(x1+sd*.008,R*.55,a0),pt(x1+sd*.008,R*.55,a1)],5,[sd*(hw-.6),R,zc])}}
  if(S.cop){/* light bar on the roof: left half red, right half blue (they flash when the siren flag is on) */
    const yt=sec[2][3]+.01,zc0=(sec[2][0]+sec[3][0])/2;
    const box=(x0,x1,y0,y1,z0,z1,mat)=>{const c=[(x0+x1)/2,(y0+y1)/2,(z0+z1)/2],q=[[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]];B.poly(q,mat,c);B.poly([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],mat,c);B.poly([[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]],mat,c);B.poly([[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]],mat,c);B.poly([[x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0]],mat,c)};
    box(-.55,-.02,yt,yt+.14,zc0-.22,zc0+.22,7);box(.02,.55,yt,yt+.14,zc0-.22,zc0+.22,8);box(-.55,.55,yt-.04,yt,zc0-.24,zc0+.24,2)}
  return B}
/* the smooth bodies (near cars): the same loft generator as the player's cars, a plain family car's proportions. Materials are mapped to the traffic material table:
   0 body (palette), 1 glass, 2 trim, 3 headlight, 4 tail light (brake), 5 plate/rim, 6 dark, 7 / 8 siren red / blue, 9 black lower body (police) */
const TRGEN=[
 {L:4.62,W:1.82,H:1.46,wb:2.75,fo:.95,nose:.72,hood:.90,cowl:1.25,roofF:2.08,roofR:2.9,rearS:3.62,deck:1.0,tail:.96,hw0:.78,hwMax:.89,hwMaxS:2.4,hwTail:.83,crown:.07,tum:.07,rf:.31,rr:.31,wf:.215,wr:.215,rimF:.2,rimR:.2,tf:.72,tr:.72,sill:.2,gw:.84,gt:.74,head:'oval',tail_:'bar',intake:'mid',wing:'none',exh:0,diff:0,splitter:0,sideIntake:0,mirror:1,capR:.35,grille:'wide',chromeTrim:1,exh:1,exhOff:.55},   /* sedan */
 {L:4.0,W:1.76,H:1.5,wb:2.52,fo:.78,nose:.68,hood:.85,cowl:1.05,roofF:1.78,roofR:3.15,rearS:3.78,deck:1.06,tail:1.0,hw0:.76,hwMax:.86,hwMaxS:2.4,hwTail:.8,crown:.07,tum:.07,rf:.3,rr:.3,wf:.2,wr:.2,rimF:.19,rimR:.19,tf:.7,tr:.7,sill:.2,gw:.84,gt:.74,head:'oval',tail_:'bar',intake:'mid',wing:'none',exh:0,diff:0,splitter:0,sideIntake:0,mirror:1,capR:.3,grille:'wide',wing:'lip',exh:1,exhOff:.5},       /* hatchback */
 {L:4.75,W:1.92,H:1.76,wb:2.85,fo:.95,nose:.86,hood:1.06,cowl:1.34,roofF:2.12,roofR:3.62,rearS:4.12,deck:1.16,tail:1.1,hw0:.84,hwMax:.95,hwMaxS:2.5,hwTail:.9,crown:.06,tum:.07,rf:.37,rr:.37,wf:.25,wr:.25,rimF:.24,rimR:.24,tf:.8,tr:.8,sill:.27,gw:.86,gt:.78,head:'oval',tail_:'bar',intake:'mid',wing:'none',exh:0,diff:0,splitter:0,sideIntake:0,mirror:1,capR:.3,grille:'wide',roofRails:1,cladding:.33,exh:1,exhOff:.6},     /* SUV */
 {L:5.2,W:1.98,H:2.06,wb:3.2,fo:.88,nose:1.0,hood:1.08,cowl:1.05,roofF:1.45,roofR:4.2,rearS:5.0,deck:1.5,tail:1.5,hw0:.88,hwMax:.96,hwMaxS:2.5,hwTail:.94,crown:.05,tum:.05,rf:.36,rr:.36,wf:.23,wr:.23,rimF:.22,rimR:.22,tf:.82,tr:.82,sill:.28,gw:.9,gt:.88,head:'oval',tail_:'bar',intake:'mid',wing:'none',exh:0,diff:0,splitter:0,sideIntake:0,mirror:1,capR:.25,grille:'wide',cladding:.22},       /* van */
 null];                                                                                                                                                                                                                                                                               /* police: the sedan with a dark lower body */
const TRMATMAP=[0,1,2,2,5,3,4,6,5,2,2,12,0,6,2,6,5,13,6,2,2];      /* generator material -> traffic material (11 plate -> white, 17 amber, 18 grille -> dark) */
/* the working vehicles (generator frame: metres, front at -z): a refuse truck, a box van, a pickup. A cab, a body, lamps, plates, the game's wheels. */
function trBoxVehicle(kind){
  const b=new CGB(),M=CGM,box=(x,y,z,hx,hy,hz,m)=>cgBox(b,x,y,z,hx,hy,hz,m,0);let S;
  if(kind=='swat'){/* a black armoured truck: a high cab, a windowless body with slits, a ram bar, a light bar */S={L:6.6,W:2.4,H:2.75,fz:-2.1,rz:2.0,rf:.5,rr:.5,wf:.32,wr:.32,tf:.98,tr:.98,cowl:1.0,roofF:1.4,roofR:5.8,curves:{half:()=>1.1}};
    box(0,.75,0,1.12,.2,3.2,M.under);box(0,1.55,-2.6,1.18,.8,.7,M.paint);box(0,1.55,.6,1.2,1.2,2.6,M.paint);box(0,2.05,-3.25,1.08,.32,.02,M.glass);for(const sd of[-1,1]){box(sd*1.19,2.05,-2.65,.02,.3,.5,M.glass);box(sd*1.21,1.95,.6,.02,.08,1.8,M.trim);box(sd*1.21,1.25,.6,.02,.1,2.4,M.plate)}
    box(0,.95,-3.4,1.15,.28,.1,M.trim);for(const sd of[-1,1]){box(sd*.85,1.25,-3.32,.16,.08,.03,M.head);box(sd*1.0,1.1,3.22,.1,.18,.03,M.tail)}box(0,.95,-3.5,.26,.07,.02,M.plate)}
  else if(kind=='garbage'){S={L:8.1,W:2.5,H:3.4,fz:-2.75,rz:2.45,rf:.52,rr:.52,wf:.32,wr:.36,tf:1.02,tr:1.0};
    box(0,.62,-.2,1.1,.16,3.8,M.under);box(0,1.75,-3.15,1.2,1.05,.9,M.plate);box(0,2.35,-4.04,1.1,.42,.02,M.glass);for(const sd of[-1,1])box(sd*1.21,2.3,-3.3,.02,.38,.55,M.glass);box(0,.95,-4.08,1.18,.3,.06,M.trim);box(0,1.15,-4.1,.6,.18,.03,M.grille);
    box(0,2.05,.95,1.25,1.25,3.0,M.paint);box(0,2.0,3.95,1.2,1.15,.08,M.trim);box(0,3.32,.95,1.27,.06,3.02,M.paint);for(let k=0;k<3;k++)box(0,2.05,-1.2+k*1.35,1.27,1.15,.04,M.trim);
    for(const sd of[-1,1]){box(sd*.8,1.05,-4.1,.18,.08,.03,M.head);box(sd*1.0,1.0,4.04,.12,.18,.03,M.tail);box(sd*1.15,3.25,-3.0,.05,.06,.05,M.amber)}box(0,.85,-4.11,.26,.07,.02,M.plate);box(0,.75,4.05,.26,.07,.02,M.plate)}
  else if(kind=='boxvan'){S={L:6.2,W:2.16,H:3.0,fz:-1.95,rz:1.85,rf:.38,rr:.4,wf:.22,wr:.24,tf:.9,tr:.88};
    box(0,.52,0,.95,.12,2.9,M.under);box(0,1.2,-2.35,1.0,.62,.75,M.paint);box(0,2.02,-2.15,.98,.4,.55,M.paint);box(0,1.98,-2.71,.92,.33,.02,M.glass);for(const sd of[-1,1])box(sd*1.0,1.95,-2.25,.02,.3,.4,M.glass);
    box(0,1.85,.75,1.08,1.15,2.35,M.plate);box(0,1.0,.75,1.09,.12,2.36,M.paint);box(0,1.85,3.11,1.05,1.1,.02,M.trim);
    for(const sd of[-1,1]){box(sd*.72,1.08,-3.1,.16,.08,.03,M.head);box(sd*.95,1.0,3.12,.08,.2,.03,M.tail);box(sd*.85,.92,-3.1,.08,.05,.03,M.amber);box(sd*1.06,1.85,-1.75,.05,.08,.12,M.gloss)}box(0,.85,-3.11,.25,.07,.02,M.plate);box(0,.82,3.13,.25,.07,.02,M.plate)}
  else{/* pickup: the SUV body with a short cab and an open bed */const base=Object.assign({},TRGEN[2],{L:5.4,roofF:1.95,roofR:2.75,rearS:2.85,deck:1.05,tail:1.05,roofRails:0,noSkirt:1}),R=cgBuild(base,{lo:1,mid:1});
    const bb=R.body;for(const sd of[-1,1])cgBox(bb,sd*.86,1.13,1.62,.06,.12,1.05,M.paint,0);cgBox(bb,0,1.13,2.66,.92,.12,.05,M.paint,0);cgBox(bb,0,.98,1.62,.82,.02,1.0,M.under,0);return R}
  S.zs=s=>-S.L/2+s;S._parts={};const lw=2;return{S,body:b,wheelF:cgWheel(S.rf,S.wf,S.rf*.6,6,'disc',null,lw,1),wheelR:cgWheel(S.rr,S.wr,S.rr*.6,6,'disc',null,lw,1)}}
/* the near body of traffic type i: the generator's family cars, a Close Call body, or a working vehicle */
function trBodyOf(i){const T=TTYPES[i];
  if(T.cc){const R=ccBuild(T.cc,{lo:1});if(T.sign){const S=R.S;cgBox(R.body,0,S.H+.12,S.zs(S.roofR-.35),.36,.11,.12,CGM.amber,0);cgBox(R.body,0,S.H+.02,S.zs(S.roofR-.35),.4,.02,.14,CGM.trim,0)}return R}
  if(T.box)return trBoxVehicle(T.box);
  const base=TRGEN[i==4?0:i],spec=Object.assign({noSkirt:1},base);if(i==4)spec.lowerDark=.66;return cgBuild(spec,{lo:1,mid:1})}
/* the far body: TRSHAPE for the first five, a Close Call body's own low-poly loft, or boxes for the trucks */
function trFarOf(i){const T=TTYPES[i];if(i<5)return trBuildType(TRSHAPE[i],T.hw);
  if(T.cc)return trBuildType(ccFar(T.cc),T.hw);
  if(T.box=='garbage')return trBuildType({gz:[2.6,3.9],wheel:.52,sec:[[4.05,.5,2.5,2.9,1.2,1.1],[2.2,.5,2.5,2.9,1.2,1.1],[2.1,.5,3.3,3.3,1.25,1.25],[-3.95,.5,3.3,3.3,1.25,1.25]]},T.hw);
  return trBuildType(TRSHAPE[3],T.hw)}
function trGenType(i){
  const spec=Object.assign({noSkirt:1},TRGEN[i==4?0:i]||{});if(TTYPES[i].cop)spec.lowerDark=.66;
  const R=trBodyOf(i),S=R.S,P=[],N=[],M=[],I=[];let o=0;
  /* the police livery: white doors, roof and pillars, black bonnet, wings and boot (x, y, z in generator coordinates, front negative) */
  const swat=TTYPES[i].box=='swat',copLivery=(x,y,z,S)=>{if(swat)return 9;const belt=S.H*.62,door=z>S.zs(S.cowl+.1)&&z<S.zs(S.roofR+.25)&&Math.abs(x)>.5&&y<belt+.1&&y>.3,upper=y>belt+.12;return(door||upper)?12:9};
  const add=(mb,dx,dy,dz,mirX,mapM)=>{const n=mb.nv;for(let v=0;v<n;v++){const x=mb.P[v*3]*(mirX?-1:1)+dx,y=mb.P[v*3+1]+dy,z=-(mb.P[v*3+2]+dz);P.push(x,y,z);N.push(mb.N[v*3]*(mirX?-1:1),mb.N[v*3+1],-mb.N[v*3+2]);const m=TRMATMAP[mb.M[v]];
      /* the black lower body of a police car: the shade ramp of the generator marks it; the paint of the upper part stays the palette colour */
      const mm=m==0&&mb.S&&mb.S[v]<.4?(spec.lowerDark?9:6):(m==0&&spec.lowerDark&&mb===R.body?copLivery(P[P.length-3],P[P.length-2],-P[P.length-1],S):m),pt=mb===R.body?(mb.Pt[v]||0):0;
      M.push(mm+(pt>=1&&pt<=4?pt*16:0))}
    for(let k=0;k<mb.I.length;k++)I.push(mb.I[k]+o);o+=n};
  add(R.body,0,0,0,false);
  for(const[wz,wr,wheel,tx]of[[S.fz,S.rf,R.wheelF,S.tf],[S.rz,S.rr,R.wheelR,S.tr]])for(const sd of[-1,1])add(wheel,sd*tx,wr,wz,sd<0);
  if(TTYPES[i].cop){/* a police car: the light bar (red, clear, blue segments on a black base), a push bar, A-pillar spotlights, an aerial, a rear deck light */
    const bb=new CGB(),yt=S.H+.005,zc=S.zs((S.roofF+S.roofR)/2),T=(m)=>m;
    cgBox(bb,0,yt+.025,zc,.62,.025,.22,CGM.trim,0);
    for(let k=0;k<3;k++){cgBox(bb,-.5+k*.17,yt+.085,zc,.075,.045,.19,CGM.paint,0);cgBox(bb,.5-k*.17,yt+.085,zc,.075,.045,.19,CGM.glass,0)}
    cgBox(bb,0,yt+.085,zc,.075,.045,.19,CGM.head,0);                                                                                    /* the clear middle segment */
    cgBox(bb,0,.5,-S.L/2-.05,.55,.018,.03,CGM.trim,0);cgBox(bb,0,.62,-S.L/2-.05,.5,.018,.03,CGM.trim,0);for(const sd of[-1,1])cgBox(bb,sd*.5,.55,-S.L/2-.04,.02,.11,.025,CGM.trim,0);     /* push bar */
    for(const sd of[-1,1]){cgBox(bb,sd*(S.curves.half(S.cowl)*S.gw+.07),S.H-.32,S.zs(S.cowl+.18),.025,.025,.05,CGM.chrome,0)}                          /* spotlights */
    cgBox(bb,.35,S.H+.14,S.zs(S.roofR+.25),.006,.12,.006,CGM.trim,0);                                                                    /* aerial */
    for(const sd of[-1,1]){const x=sd*(S.curves.half(S.cowl+1.2)+.006),z0=S.zs(S.cowl+.2),z1=S.zs(S.roofR+.2),zc=(z0+z1)/2,hz=Math.abs(z1-z0)/2;cgBox(bb,x,.74,zc,.004,.045,hz,CGM.plate,0);cgBox(bb,x,.66,zc,.004,.022,hz,CGM.stripe,0);cgBox(bb,x,.80,zc+hz*.35,.004,.035,hz*.4,CGM.disc,0)}      /* door stripes: blue, gold, and a badge block */
    const map2={[CGM.paint]:7,[CGM.glass]:8,[CGM.trim]:2,[CGM.head]:3,[CGM.chrome]:5,[CGM.plate]:10,[CGM.stripe]:11,[CGM.disc]:5};
    const nv0=P.length/3;for(let v=0;v<bb.nv;v++){P.push(bb.P[v*3],bb.P[v*3+1],-bb.P[v*3+2]);N.push(bb.N[v*3],bb.N[v*3+1],-bb.N[v*3+2]);M.push(map2[bb.M[v]]||2)}for(const k of bb.I)I.push(k+nv0)}
  /* where the bonnet, boot lid and doors hinge (this mesh has the front at +z), and which of them this body has */
  const pd=R.S._parts||{},H=new Float32Array(16);let pm=0;
  const hh=(slot,p,kind,ang)=>{const d=pd[p];if(!d||d.n<12)return;pm|=1<<slot;H[slot*4]=kind?d.p[0]:0;H[slot*4+1]=kind?0:d.p[1];H[slot*4+2]=-d.p[2];H[slot*4+3]=ang};
  hh(0,1,0,.95);hh(1,2,0,-.8);hh(2,3,1,-1.0);hh(3,4,1,1.0);
  return{P,N,M,I,H,pm}}
function trGLInit(){
  const gl=G.gl;TRM.pal=new Float32Array(TCOLS.length*3);TCOLS.forEach((c,i)=>{TRM.pal[i*3]=c[0];TRM.pal[i*3+1]=c[1];TRM.pal[i*3+2]=c[2]});
  /* materials: rgb albedo, alpha = glow (-1: the body colour of the car) */
  TRM.mat=new Float32Array([0,0,0,-1, .03,.045,.06,0, .015,.015,.017,0, .85,.8,.62,1.9, .5,.02,.02,.6, .55,.56,.6,0, .015,.015,.015,0, .8,.1,.05,0, .1,.2,.9,0, .035,.035,.04,0, .04,.09,.45,0, .62,.5,.12,0, .72,.72,.74,0, .95,.52,.08,1.3, .7,.72,.76,0, 0,0,0,0]);   /* 3 head lamps and 4 tail lamps glow brighter, 5 rims, 14 chrome */
  const upload=(B)=>{const nv=B.P.length/3,ab=new ArrayBuffer(nv*16),f=new Float32Array(ab),b=new Int8Array(ab);
    for(let v=0;v<nv;v++){f[v*4]=B.P[v*3];f[v*4+1]=B.P[v*3+1];f[v*4+2]=B.P[v*3+2];b[v*16+12]=Math.round(B.N[v*3]*127);b[v*16+13]=Math.round(B.N[v*3+1]*127);b[v*16+14]=Math.round(B.N[v*3+2]*127);b[v*16+15]=B.M[v]}
    return{vb:mkBuf(gl.ARRAY_BUFFER,ab),ib:mkBuf(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(B.I)),n:B.I.length,nv}};
  /* groups: type * 2 + lod (0 smooth body for the cars near the camera, 1 the 200-triangle body for the rest) */
  const NT=TTYPES.length;TRM.types=[];TRM.hg=[];TRM.pm=[];TRM.far=[];for(let i=0;i<NT;i++){const g=trGenType(i),f=TTYPES[i].far;TRM.hg.push(g.H);TRM.pm.push(g.pm);TRM.types.push(upload(g));TRM.far.push(f==null||f<0?i:f);TRM.types.push(f==null||f<0?upload(trFarOf(i)):{n:0})}
  TRM.inst=new Float32Array(TRN*20);TRM.ibuf=mkBuf(gl.ARRAY_BUFFER,TRM.inst.byteLength,gl.DYNAMIC_DRAW);TRM.cnt=new Int16Array(NT*2);TRM.off=new Int16Array(NT*2);
  R.trDraw=trDraw;TRM.ready=true}
/* soft blob shadows under the cars (added to the effects batch by fxDraw) */
function trShadows(quad){
  if(!TR.on)return;const a=R.alpha;
  for(const c of TR.cars){if(!c.alive)continue;const dx=c.x-C.x,dz=c.z-C.z;if(dx*dx+dz*dz>25600)continue;
    const x=lerp(c.px,c.x,a),z=lerp(c.pz,c.z,a),yaw=c.pyaw+angd(c.yaw,c.pyaw)*a,sy=Math.sin(yaw),cy=Math.cos(yaw),L=c.hl+.5,Wd=c.hw+.35,y=lerp(c.py,c.y,a)+.05;
    quad(x+sy*-L-cy*Wd,y,z+cy*L-sy*Wd,x+sy*-L+cy*Wd,y,z+cy*L+sy*Wd,x+sy*L+cy*Wd,y,z-cy*L+sy*Wd,x+sy*L-cy*Wd,y,z-cy*L-sy*Wd,0,0,0,.42)}}
/* collect the visible cars into the instance buffer (once per frame; the colour pass and the shadow pass both draw from it). 16 floats per car: x y z yaw | pitch roll colour flags | dent 1 | dent 2 */
function trPrep(){
  TRM.nv=0;if(!TR.on||!TRM.ready||!TR.nAlive)return 0;
  const gl=G.gl,a=R.alpha,I=TRM.inst,cnt=TRM.cnt,off=TRM.off,vis=TRM.vis,cars=TR.cars,lod2=Math.pow(GFX.cur.name=='Low'?30:46,2);cnt.fill(0);let nv=0;
  for(let i=0;i<TRN;i++){const c=cars[i];if(!c.alive)continue;const x=lerp(c.px,c.x,a),y=lerp(c.py,c.y,a),z=lerp(c.pz,c.z,a),dx=x-R.cx,dz=z-R.cz,d2=dx*dx+dz*dz;if(d2>490000||!M4.sphereIn(R.PL,x,y+1,z,3.6))continue;c.gi=d2<lod2?c.type*2:TRM.far[c.type]*2+1;vis[nv++]=i;cnt[c.gi]++}   /* far bodies are shared between similar types (fewer draw calls) */
  if(!nv)return 0;
  const NG=cnt.length;let s0=0;const fill=new Int16Array(NG);for(let g=0;g<NG;g++){off[g]=s0;fill[g]=s0;s0+=cnt[g]}
  for(let q=0;q<nv;q++){const c=cars[vis[q]],o=fill[c.gi]++*20;
    I[o]=lerp(c.px,c.x,a);I[o+1]=lerp(c.py,c.y,a);I[o+2]=lerp(c.pz,c.z,a);I[o+3]=c.pyaw+angd(c.yaw,c.pyaw)*a;I[o+4]=c.pitch;I[o+5]=c.roll;I[o+6]=c.col;I[o+7]=(c.brake?1:0)+(c.siren?2:0)+(c.kind===1&&c.cm===0&&c.type===4&&!c.siren?4:0)+((c.dmg||0)>.45?8:0)+(c.pf||0);
    const d=c.dn;if(d){for(let k=0;k<12;k++)I[o+8+k]=d[k]}else for(let k=8;k<20;k++)I[o+k]=0}
  gl.bindBuffer(gl.ARRAY_BUFFER,TRM.ibuf);gl.bufferSubData(gl.ARRAY_BUFFER,0,I.subarray(0,nv*20));TRM.nv=nv;TR.drawn=nv;return nv}
/* issue the draws of the collected cars with whatever program is bound (the attribute layout is shared by the colour and the shadow program) */
function trIssue(hinge){
  const gl=G.gl,I=TRM.inst,cnt=TRM.cnt,off=TRM.off,ext=G.ext.inst;
  if(ext){attrs(7);for(let k=2;k<7;k++)ext.vertexAttribDivisorANGLE(k,1)}else attrs(2);
  for(let g=0;g<cnt.length;g++){if(!cnt[g])continue;const M=TRM.types[g];
    if(hinge)gl.uniform4fv(G.P.tr.u.uHg,TRM.hg[g>>1]);
    gl.bindBuffer(gl.ARRAY_BUFFER,M.vb);gl.vertexAttribPointer(0,3,gl.FLOAT,false,16,0);gl.vertexAttribPointer(1,4,gl.BYTE,true,16,12);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,M.ib);
    if(ext){gl.bindBuffer(gl.ARRAY_BUFFER,TRM.ibuf);const b=off[g]*80;for(let k=0;k<5;k++)gl.vertexAttribPointer(2+k,4,gl.FLOAT,false,80,b+k*16);ext.drawElementsInstancedANGLE(gl.TRIANGLES,M.n,gl.UNSIGNED_SHORT,0,cnt[g]);R.draws++}
    else{for(let k=0;k<cnt[g];k++){const o=(off[g]+k)*20;for(let q=0;q<5;q++)gl.vertexAttrib4f(2+q,I[o+q*4],I[o+q*4+1],I[o+q*4+2],I[o+q*4+3]);gl.drawElements(gl.TRIANGLES,M.n,gl.UNSIGNED_SHORT,0);R.draws++}}
    R.tris+=M.n/3*cnt[g]}
  if(ext){for(let k=2;k<7;k++)ext.vertexAttribDivisorANGLE(k,0)}}
function trDraw(){
  if(!TRM.nv)return;const gl=G.gl,P=G.P.tr;
  gl.useProgram(P.p);setEnvU(P);gl.uniformMatrix4fv(P.u.uVP,false,R.VP);gl.uniform3fv(P.u.uPal,TRM.pal);gl.uniform4fv(P.u.uMat,TRM.mat);gl.uniform1f(P.u.uT,R.time);gl.disable(gl.CULL_FACE);
  trIssue(true)}
