try{const world=WORLD;
const D={
 "Brazil":{icon:"tree",type:"Deforestation",signal:"L-band backscatter drops after clearing",product:"GCOV",text:"Cleared forest returns less radar energy. L-band passes through cloud, so the Amazon can be watched all year."},
 "United States of America":{icon:"fire",type:"Wildfire",signal:"Backscatter change in burned canopy",product:"GCOV",text:"Burn scars change how radar bounces off vegetation. Compare passes before and after a fire to map its extent."},
 "Japan":{icon:"mountains",type:"Earthquake",signal:"Ground motion from interferograms",product:"GUNW",text:"Two passes on either side of a quake show how far the ground moved toward or away from the satellite."},
 "Turkey":{icon:"mountains",type:"Earthquake",signal:"Fault displacement from interferograms",product:"GUNW",text:"Interferograms show fringes where a fault slipped, so the rupture can be traced across the surface."},
 "India":{icon:"plant",type:"Farming activity",signal:"Backscatter cycle through the crop season",product:"GCOV",text:"Planting, growth and harvest each change the radar return. The repeating pattern maps crop stage."},
 "Greenland":{icon:"snowflake",type:"Glacier movement",signal:"Ice velocity from pixel offsets",product:"GOFF",text:"Tracking features between passes shows how fast ice flows toward the sea."},
 "Bangladesh":{icon:"waves",type:"Wetland and flood extent",signal:"Open water lowers radar return",product:"GCOV",text:"Standing water looks dark to radar. Repeated passes track wetland extent and seasonal flooding."}
};
const feats=topojson.feature(world,world.objects.countries).features;
const $=s=>document.querySelector(s), C={};
const colors=()=>{const s=getComputedStyle(document.documentElement);for(const k of["ocean","land","land-data","line","bg","accent"])C[k]=s.getPropertyValue("--"+k).trim()};
colors();matchMedia("(prefers-color-scheme:light)").addEventListener("change",colors);
const app=$("#app"),cv=$("#globe"),ctx=cv.getContext("2d"),box=$("#box"),L=$("#l"),M=$("#m");
const proj=d3.geoOrthographic().clipAngle(90).precision(.5),path=d3.geoPath(proj,ctx);
const grat=d3.geoGraticule10(),sph={type:"Sphere"};
let W,H,narrow,rot=[10,-20],sel=null,cen=null,shown=false,drag=null,tw=null,zoom=1,last=0,pinch=null;
const pts=new Map(),mark=()=>{last=performance.now()};
const setStatus=n=>$("#status").innerHTML=ICONS["cursor-click"]+(n?n:"No country selected");
setStatus();

function size(){
  W=app.clientWidth;H=app.clientHeight;const d=devicePixelRatio||1;
  cv.width=W*d;cv.height=H*d;ctx.setTransform(d,0,0,d,0,0);
  narrow=W<600&&H>W;
  proj.translate([W/2,narrow?H*.4:H/2]);setZoom(zoom);
}
function setZoom(z){zoom=Math.max(.6,Math.min(6,z));proj.scale(Math.min(W,H)*(narrow?.42:.4)*zoom)}
addEventListener("resize",size);size();

function draw(){
  proj.rotate(rot);ctx.clearRect(0,0,W,H);
  ctx.beginPath();path(sph);ctx.fillStyle=C.ocean;ctx.fill();
  ctx.beginPath();path(grat);ctx.strokeStyle=C.line;ctx.lineWidth=.5;ctx.globalAlpha=.5;ctx.stroke();ctx.globalAlpha=1;
  for(const f of feats){
    ctx.beginPath();path(f);
    ctx.fillStyle=f===sel?C.accent:D[f.properties.name]?C["land-data"]:C.land;ctx.fill();
  }
  ctx.beginPath();for(const f of feats)path(f);
  ctx.strokeStyle=C.bg;ctx.lineWidth=.5;ctx.stroke();
  ctx.beginPath();path(sph);ctx.strokeStyle=C.line;ctx.lineWidth=1;ctx.stroke();
}

function place(){
  const back=!cen||d3.geoDistance(cen,[-rot[0],-rot[1]])>Math.PI/2-.05;
  if(!sel||!shown||back){box.hidden=true;$("#line").style.display="none";return}
  box.hidden=false;$("#line").style.display="";
  const p=proj(cen),bw=box.offsetWidth,bh=box.offsetHeight;
  let bx,by;
  if(narrow){bx=(W-bw)/2;by=Math.max(16,H-bh-$(".legend").offsetHeight-32)}
  else{bx=p[0]+160;if(bx+bw>W-16)bx=p[0]-160-bw;bx=Math.max(16,Math.min(W-bw-16,bx));by=Math.max(16,Math.min(H-bh-16,p[1]-bh-70))}
  box.style.transform=`translate(${bx}px,${by}px)`;
  L.setAttribute("x1",p[0]);L.setAttribute("y1",p[1]);
  L.setAttribute("x2",Math.max(bx,Math.min(bx+bw,p[0])));L.setAttribute("y2",Math.max(by,Math.min(by+bh,p[1])));
  M.setAttribute("x",p[0]-4);M.setAttribute("y",p[1]-4);
}

function frame(now){
  if(!sel&&!drag&&!tw&&!pts.size&&now-last>2000)rot[0]+=.06;
  if(tw){
    const t=Math.min(1,(now-tw.t0)/700),e=d3.easeCubicInOut(t);
    rot=[tw.a[0]+(tw.b[0]-tw.a[0])*e,tw.a[1]+(tw.b[1]-tw.a[1])*e];
    if(t===1){tw=null;shown=true}
  }
  draw();place();requestAnimationFrame(frame);
}

function render(f){
  const n=f.properties.name,r=D[n],x=`<button id="x" aria-label="Close">${ICONS.x}</button>`;
  box.innerHTML=r
   ?`<div class="top">${ICONS[r.icon]}${x}</div><h2>${n}</h2><p class="tag">Sample record, not NISAR data</p>
     <dl><dt>Change</dt><dd>${r.type}</dd><dt>Signal</dt><dd>${r.signal}</dd><dt>Product</dt><dd>${r.product}</dd></dl><p>${r.text}</p>`
   :`<div class="top">${ICONS.info}${x}</div><h2>${n}</h2><p class="tag">No record yet</p>
     <p>No surface change has been logged for this country.</p>
     <p class="muted">Countries in lighter blue have sample records.</p>`;
  $("#x").onclick=clear;
}
function select(f){
  sel=f;cen=d3.geoCentroid(f);shown=false;render(f);setStatus(f.properties.name);
  const a=[...rot];let b0=-cen[0];b0=a[0]+((b0-a[0]+540)%360)-180;
  tw={a,b:[b0,Math.max(-70,Math.min(70,-cen[1]))],t0:performance.now()};
}
function clear(){sel=cen=tw=null;shown=false;mark();setStatus()}

const dist=()=>{const[a,b]=[...pts.values()];return Math.hypot(a[0]-b[0],a[1]-b[1])};
cv.onpointerdown=e=>{
  pts.set(e.pointerId,[e.clientX,e.clientY]);try{cv.setPointerCapture(e.pointerId)}catch{}
  mark();cv.style.cursor="grabbing";if(tw){tw=null;shown=true}
  if(pts.size===1)drag={x:e.clientX,y:e.clientY,r:[...rot],m:0};
  else if(pts.size===2){drag=null;pinch={d:dist(),z:zoom}}
};
cv.onpointermove=e=>{
  if(!pts.has(e.pointerId))return;pts.set(e.pointerId,[e.clientX,e.clientY]);mark();
  if(pts.size===2&&pinch)return setZoom(pinch.z*dist()/pinch.d);
  if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.m=Math.max(drag.m,Math.hypot(dx,dy));
  if(drag.m>4){const k=57.3/proj.scale();rot=[drag.r[0]+dx*k,Math.max(-80,Math.min(80,drag.r[1]-dy*k))]}
};
cv.onpointerup=cv.onpointercancel=e=>{
  pts.delete(e.pointerId);if(pts.size<2)pinch=null;mark();cv.style.cursor="grab";
  const d=drag;drag=null;if(!d||d.m>4||e.type==="pointercancel")return;
  const r=cv.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,c=proj.translate();
  if(Math.hypot(x-c[0],y-c[1])>proj.scale())return clear();
  const pt=proj.invert([x,y]),f=pt&&feats.find(f=>d3.geoContains(f,pt));
  f?select(f):clear();
};
cv.addEventListener("wheel",e=>{
  e.preventDefault();mark();
  setZoom(zoom*Math.exp(-e.deltaY*(e.deltaMode?.033:1)*(e.ctrlKey?.01:.0015)));
},{passive:false});
addEventListener("keydown",e=>{if(e.key==="Escape")clear()});
requestAnimationFrame(frame);
}catch(e){console.error(e);document.getElementById("status").textContent="Globe failed to start: "+e.message}
