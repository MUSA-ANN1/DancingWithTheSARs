try{const world=WORLD;
const NEWS="https://www.earthdata.nasa.gov/news/nisar-l-band-data-released-expanding-record-surface-changes";
const D={
 "Venezuela":{icon:"mountains",type:"Earthquake",signal:"Ground displacement, before and after passes",product:"NISAR L-band",at:[-66.9,10.5],
  text:"Two earthquakes on 24 June 2026 moved the ground, most strongly near Caracas and La Guaira. NISAR passes from 13 and 18 June (before) and 25 and 30 June (after) were compared to map the shift.",
  src:{t:"NASA Earthdata, 21 Jul 2026",u:NEWS}},
 "South Africa":{icon:"plant",type:"Farming and vegetation",signal:"Growing-season change, 2025 to 2026",product:"NISAR L-band time series",
  text:"A false-color composite of an agricultural region. Green shows vegetated areas, red shows unvegetated surfaces, and blue shows how fast the vegetation changed.",
  src:{t:"NASA Earthdata, 21 Jul 2026",u:NEWS}},
 "Antarctica":{icon:"snowflake",type:"Ice structure and flow",signal:"L-band radar through snow, Aug 2025",product:"NISAR L-band",
  text:"Nunatak Zaterjavshijsja in East Antarctica, a mountaintop rising through ice that flows northeast to the ocean. Radar sees structure that optical images miss.",
  src:{t:"NASA JPL release, 21 Jul 2026",u:"https://indiawest.com/india-us-satellite-spots-antarctic-hummingbird/"}}
};
const feats=topojson.feature(world,world.objects.countries).features;
const $=s=>document.querySelector(s), C={};
const colors=()=>{const s=getComputedStyle(document.documentElement);for(const k of["ocean","land","land-data","line","bg","accent"])C[k]=s.getPropertyValue("--"+k).trim()};
colors();matchMedia("(prefers-color-scheme:light)").addEventListener("change",colors);
const app=$("#app"),cv=$("#globe"),ctx=cv.getContext("2d"),box=$("#box"),L=$("#l"),M=$("#m");
const proj=d3.geoOrthographic().clipAngle(90).precision(.5),path=d3.geoPath(proj,ctx);
const grat=d3.geoGraticule10(),sph={type:"Sphere"};
let W,H,narrow,rot=[10,-20],sel=null,cen=null,shown=false,drag=null,tw=null,zoom=1,pinch=null;
const pts=new Map();
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
  if(!sel&&!drag&&!tw&&!pts.size)rot[0]+=.06;
  if(tw){
    const t=Math.min(1,(now-tw.t0)/700),e=d3.easeCubicInOut(t);
    rot=[tw.a[0]+(tw.b[0]-tw.a[0])*e,tw.a[1]+(tw.b[1]-tw.a[1])*e];
    if(t===1){tw=null;shown=true}
  }
  draw();place();requestAnimationFrame(frame);
}

const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function render(f){
  const n=f.properties.name,r=D[n],x=`<button id="x" aria-label="Close">${ICONS.x}</button>`;
  box.innerHTML=(r
   ?`<div class="top">${ICONS[r.icon]}${x}</div><h2>${n}</h2>
     <p class="tag">Source: <a href="${r.src.u}" target="_blank" rel="noopener">${r.src.t}</a></p>
     <dl><dt>Change</dt><dd>${r.type}</dd><dt>Signal</dt><dd>${r.signal}</dd><dt>Data</dt><dd>${r.product}</dd></dl><p>${r.text}</p>`
   :`<div class="top">${ICONS.info}${x}</div><h2>${n}</h2><p class="tag">No featured record</p>
     <p class="muted">Countries in lighter blue have a featured record.</p>`)
   +`<div id="live"></div>`;
  $("#x").onclick=clear;live(r);
}

const ASF="https://api.daac.asf.alaska.edu/services/search/param",VERTEX="https://search.asf.alaska.edu/";
let liveId=0;
async function live(r){
  const id=++liveId,c=(r&&r.at)||cen,el=()=>id===liveId&&$("#live"),head='<h3>Live NISAR products</h3>';
  const put=h=>{const e=el();if(e)e.innerHTML=head+h};
  const foot=`<p><a href="${VERTEX}" target="_blank" rel="noopener">Open ASF Vertex</a></p>`;
  put('<p class="muted">Searching the ASF archive...</p>');
  const ac=new AbortController(),t=setTimeout(()=>ac.abort(),12000);
  try{
    const wkt=encodeURIComponent(`POINT(${c[0].toFixed(3)} ${c[1].toFixed(3)})`);
    const res=await fetch(`${ASF}?dataset=NISAR&processingLevel=GCOV,GUNW&intersectsWith=${wkt}&maxResults=25&output=geojson`,{signal:ac.signal});
    if(!res.ok)throw new Error("HTTP "+res.status);
    const items=((await res.json()).features||[]).map(f=>f.properties)
      .sort((a,b)=>String(b.startTime).localeCompare(String(a.startTime)));
    if(!items.length)return put(`<p>No NISAR GCOV or GUNW product covers this point yet. Coverage grows with each data release.</p>`+foot);
    const shot=(items.find(p=>p.browse&&p.browse[0])||{}).browse;
    put((shot?`<img id="shot" src="${esc(shot[0])}" alt="NISAR browse image" referrerpolicy="no-referrer">`:"")
      +`<p>${items.length}${items.length>=25?"+":""} products cover this point. Newest first:</p><ul>`
      +items.slice(0,3).map(p=>`<li><span>${esc(String(p.startTime).slice(0,10))}</span><b>${esc(p.processingLevel)}</b>
         <a href="${esc(p.url)}" title="${esc(p.sceneName||p.fileID)}">${esc(p.sceneName||p.fileID)}</a></li>`).join("")
      +`</ul><p class="muted">Downloads need a free NASA Earthdata login.</p>`+foot);
    const im=$("#shot");if(im)im.onerror=()=>im.remove();
  }catch(e){
    put(`<p>Live search is not available right now. Check your connection.</p>`+foot);
  }finally{clearTimeout(t)}
}
function select(f){
  sel=f;cen=d3.geoCentroid(f);shown=false;render(f);setStatus(f.properties.name);
  const a=[...rot];let b0=-cen[0];b0=a[0]+((b0-a[0]+540)%360)-180;
  tw={a,b:[b0,Math.max(-70,Math.min(70,-cen[1]))],t0:performance.now()};
}
function clear(){sel=cen=tw=null;shown=false;liveId++;setStatus()}

const dist=()=>{const[a,b]=[...pts.values()];return Math.hypot(a[0]-b[0],a[1]-b[1])};
cv.onpointerdown=e=>{
  pts.set(e.pointerId,[e.clientX,e.clientY]);try{cv.setPointerCapture(e.pointerId)}catch{}
  cv.style.cursor="grabbing";if(tw){tw=null;shown=true}
  if(pts.size===1)drag={x:e.clientX,y:e.clientY,r:[...rot],m:0};
  else if(pts.size===2){drag=null;pinch={d:dist(),z:zoom}}
};
cv.onpointermove=e=>{
  if(!pts.has(e.pointerId))return;pts.set(e.pointerId,[e.clientX,e.clientY]);
  if(pts.size===2&&pinch)return setZoom(pinch.z*dist()/pinch.d);
  if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.m=Math.max(drag.m,Math.hypot(dx,dy));
  if(drag.m>4){const k=57.3/proj.scale();rot=[drag.r[0]+dx*k,Math.max(-80,Math.min(80,drag.r[1]-dy*k))]}
};
cv.onpointerup=cv.onpointercancel=e=>{
  pts.delete(e.pointerId);if(pts.size<2)pinch=null;cv.style.cursor="grab";
  const d=drag;drag=null;if(!d||d.m>4||e.type==="pointercancel")return;
  const r=cv.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,c=proj.translate();
  if(Math.hypot(x-c[0],y-c[1])>proj.scale())return clear();
  const pt=proj.invert([x,y]),f=pt&&feats.find(f=>d3.geoContains(f,pt));
  f?select(f):clear();
};
cv.addEventListener("wheel",e=>{
  e.preventDefault();
  setZoom(zoom*Math.exp(-e.deltaY*(e.deltaMode?.033:1)*(e.ctrlKey?.01:.0015)));
},{passive:false});
addEventListener("keydown",e=>{if(e.key==="Escape")clear()});
requestAnimationFrame(frame);
}catch(e){console.error(e);document.getElementById("status").textContent="Globe failed to start: "+e.message}
