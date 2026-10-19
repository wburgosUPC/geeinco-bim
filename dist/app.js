import {installWalk} from './walk.js';
import {installPlanning} from './planning.js';
import * as THREE from 'three';
import { installAR } from './ar.js';
import { installReference } from './reference.js';
import {referenceFromRevit} from './revit-reference.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createModelPackage } from './powerbi-export.js';

const $ = id => document.getElementById(id);
const viewport = $('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#eef2f7');
const camera = new THREE.PerspectiveCamera(45,1,.01,10000);
camera.position.set(14,12,18);
const renderer = new THREE.WebGLRenderer({antialias:true});
const restingPixelRatio=Math.min(devicePixelRatio,1.5);
renderer.setPixelRatio(restingPixelRatio);
renderer.localClippingEnabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.prepend(renderer.domElement);
const controls = new OrbitControls(camera,renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .09;
scene.add(new THREE.HemisphereLight(0xffffff,0x8794ab,2));
const sun = new THREE.DirectionalLight(0xffffff,2.3); sun.position.set(30,50,20); scene.add(sun);
const fill = new THREE.DirectionalLight(0xcbdfff,1); fill.position.set(-20,8,-15); scene.add(fill);
const modelGroup = new THREE.Group(); scene.add(modelGroup);
const measureGroup = new THREE.Group(); scene.add(measureGroup);
let grid = new THREE.GridHelper(30,30,0xc1cddd,0xdce3ed); scene.add(grid);
let worker, elements = new Map(), objects = new Map(), selected = null, box = new THREE.Box3();
let loaded = false, loading = false, measuring = false, cutting = false, flipped = false, points = [];
let request = 0, currentName = '', spatial = null;
const plane = new THREE.Plane(new THREE.Vector3(0,-1,0),0);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const status = message => { $('status').textContent = message; };
const unwrap = v => v && typeof v === 'object' && 'value' in v ? v.value : v;
let pendingFrame=0,qualityTimer;
function requestRender(){if(renderer.xr.isPresenting)return;if(!pendingFrame&&!document.hidden)pendingFrame=requestAnimationFrame(()=>{pendingFrame=0;if(renderer.xr.isPresenting)return;if(controls.enabled)controls.update();renderer.render(scene,camera);});}
controls.addEventListener('change',requestRender);
controls.addEventListener('start',()=>{clearTimeout(qualityTimer);renderer.setPixelRatio(Math.min(devicePixelRatio,1));requestRender();});
controls.addEventListener('end',()=>{clearTimeout(qualityTimer);qualityTimer=setTimeout(()=>{renderer.setPixelRatio(restingPixelRatio);requestRender();},180);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)requestRender();});
const resize = () => { if(renderer.xr.isPresenting)return; const w=Math.max(1,viewport.clientWidth),h=Math.max(1,viewport.clientHeight); renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix();requestRender(); };
new ResizeObserver(resize).observe(viewport);
requestRender();

function disposeGroup(group) {
  for (const child of [...group.children]) {
    child.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){for(const m of [].concat(o.material))m.dispose();}});
    group.remove(child);
  }
}
function clearSelection() {
  requestRender();
  if(selected!==null) for(const mesh of objects.get(selected)||[]) mesh.material.emissive.set(0);
  selected=null; request++;
  $('selection').hidden=true; $('selection-empty').hidden=false;
  document.querySelectorAll('.tree button.active').forEach(b=>b.classList.remove('active'));
}
function resetModel() {
  walkUI.exit();planningUI.reset(); clearSelection(); disposeGroup(modelGroup); clearMeasure();
  elements.clear();objects.clear();spatial=null;loaded=false;
  cutting=false;measuring=false;flipped=false;
  $('cut').setAttribute('aria-pressed','false');$('measure').setAttribute('aria-pressed','false');
  $('cut-panel').hidden=true;$('measure-panel').hidden=true;
  document.querySelectorAll('[data-model]').forEach(b=>b.disabled=true);
  for(const id of ['filter-module','filter-block','filter-discipline','filter-type']){$(id).value='';$(id).disabled=true;}
  $('filter-state').textContent='Leyendo parámetros de módulo, bloque y disciplina…';
  $('module-values').replaceChildren();$('block-values').replaceChildren();$('discipline-values').replaceChildren();
  $('search').value='';$('search').disabled=true;$('tree').replaceChildren();$('count').textContent='0';
  grid.visible=true;
}
function addMesh(data) {
  const meshes=[];
  for(const part of data.parts) {
    const geo=new THREE.BufferGeometry();
    const positions=new Float32Array(part.vertices.length/2),normals=new Float32Array(part.vertices.length/2);
    for(let i=0,j=0;i<part.vertices.length;i+=6,j+=3){positions.set(part.vertices.subarray(i,i+3),j);normals.set(part.vertices.subarray(i+3,i+6),j);}
    geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geo.setAttribute('normal',new THREE.BufferAttribute(normals,3));
    geo.setIndex(new THREE.BufferAttribute(part.indices,1));
    const c=part.color;
    const material=new THREE.MeshStandardMaterial({color:new THREE.Color(c.x,c.y,c.z),opacity:c.w,transparent:c.w<.99,roughness:.8,metalness:0,side:THREE.DoubleSide,depthWrite:c.w>=.99});
    const mesh=new THREE.Mesh(geo,material);
    mesh.applyMatrix4(new THREE.Matrix4().fromArray(part.matrix));
    mesh.userData.id=data.id;
    meshes.push(mesh);modelGroup.add(mesh);
  }
  objects.set(data.id,meshes);
  if(data.index%40===0) $('busy-text').textContent=`Leyendo geometría… ${data.index+1} / ${data.total}`;
}
let savedModelActive=false,savedRevision=null;
async function openFile(file,fromSaved=false) {
  savedModelActive=fromSaved;
  if(loading)return;
  if(!file || !/\.ifc$/i.test(file.name)){status('Selecciona un archivo .ifc. Los archivos .rvt deben exportarse desde Revit a IFC.');return;}
  loading=true;$('open').disabled=true;$('demo').disabled=true;$('busy').hidden=false;
  $('busy-text').textContent='Abriendo modelo…';
  if(worker)worker.terminate();
  resetModel();currentName=file.name;$('filename').textContent=currentName;
  try {
    const buffer=await file.arrayBuffer();
    worker=new Worker(new URL('./ifc-worker.js',import.meta.url),{type:'module'});
    worker.onerror=()=>fail('No se pudo iniciar el lector IFC. Vuelve a abrir el visor con “Abrir visor.cmd”.');
    worker.onmessage=async({data})=>{
      if(data.kind==='filter-index'){
        for(const entry of data.entries){const e=elements.get(entry.id);if(e){e.module=entry.module;e.block=entry.block;e.discipline=entry.discipline;e.item=entry.item;}}
        const missing=[];
        for(const key of ['module','block','discipline']){const values=[...new Set(data.entries.flatMap(e=>e[key]))].sort((a,b)=>a.localeCompare(b));
          $('filter-'+key).disabled=!values.length;$ (key+'-values').replaceChildren();
          for(const value of values){const option=document.createElement('option');option.value=value;$(key+'-values').append(option);}
          if(!values.length)missing.push(({module:'Módulo',block:'Bloque',discipline:'Disciplina'})[key]);
        }
        $('filter-state').dataset.coverage=missing.length?'Sin parámetro exportado: '+missing.join(', '):'Parámetros de Revit disponibles.';
        planningUI.modelReady();applyTextFilters();
      }
      if(data.kind==='filter-index-error'){$('filter-state').textContent='No se pudo leer Módulo/Bloque/Disciplina. La búsqueda general sigue disponible.';}
      if(data.kind==='mesh')addMesh(data);
      if(data.kind==='ready')finishLoad(data);
      if(data.kind==='properties' && data.id===selected && data.request===request)showProperties(data);
      if(data.kind==='export-progress')$('busy-text').textContent=`Preparando datos para Power BI… ${data.done} / ${data.total}`;
      if(data.kind==='export-ready'){
        try{
          const pack=createModelPackage({elements,objects,modelGroup,spatial,metadata:new Map(data.metadata.map(m=>[m.id,m])),filename:currentName});
          if(savedModelActive&&savedRevision){
            $('busy-text').textContent='Publicando resultado preparado en tu computadora…';
            const parts=[JSON.stringify({Version:1,Archivo:currentName,UnidadGeometria:'m'})+'\n'];
            for(const table of ['Elementos','Geometria','Propiedades']){parts.push(JSON.stringify({table,empty:true,row:{}})+'\n');for(const row of pack[table])parts.push(JSON.stringify({table,row})+'\n');}
            parts.push('{"end":true}\n');
            const pid=new URLSearchParams(location.search).get('project');
            const r=await fetch('/api/powerbi/projects/'+encodeURIComponent(pid)+'?revision='+encodeURIComponent(savedRevision),{method:'PUT',headers:{'Content-Type':'application/x-ndjson'},body:new Blob(parts)});
            const result=await r.json();if(!r.ok)throw Error(result.error||'No se pudo publicar.');
            status(`Power BI actualizado: ${result.elements} elementos. El enlace del proyecto se conserva. Conversión realizada en este equipo.`);
          }else{
            const blob=new Blob([JSON.stringify(pack)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=currentName.replace(/\.ifc$/i,'')+'-PowerBI.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);status(`Exportados ${pack.Elementos.length} elementos para Power BI.`);
          }
        }catch(e){status(`No se pudo exportar: ${e.message}`);}finally{$('busy').hidden=true;loading=false;$('open').disabled=false;$('powerbi').disabled=false;}
      }
      if(data.kind==='error'){
        if(data.action==='open')fail(`No se pudo abrir el IFC: ${data.message}`);
        else if(data.action==='export'){$('busy').hidden=true;loading=false;$('open').disabled=false;$('powerbi').disabled=false;status('No se pudo exportar: '+data.message);}
        else {$('properties').textContent='No se pudieron leer las propiedades de este elemento.';}
      }
    };
    worker.postMessage({action:'open',buffer},[buffer]);
  }catch(e){fail(`No se pudo leer el archivo: ${e.message}`);}
}
function fail(message){
  if(worker)worker.terminate();resetModel();loading=false;$('busy').hidden=true;$('open').disabled=false;$('demo').disabled=false;$('empty').hidden=false;$('filename').textContent='Sin modelo abierto';status(message);
}
function finishLoad(data) {
  loading=false;$('busy').hidden=true;$('open').disabled=false;$('demo').disabled=false;
  elements=new Map(data.elements.map(e=>[e.id,e]));spatial=data.spatial;
  if(!modelGroup.children.length){fail('El archivo no contiene geometría visible compatible. Comprueba la exportación IFC.');return;}
  box.setFromObject(modelGroup);
  const center=box.getCenter(new THREE.Vector3());
  modelGroup.position.sub(center);box.setFromObject(modelGroup);
  loaded=true;$('empty').hidden=true;$('search').disabled=false;
  document.querySelectorAll('[data-model]').forEach(b=>b.disabled=false);
  $('count').textContent=elements.size.toLocaleString('es-PE');
  scene.remove(grid);grid.geometry.dispose();grid.material.dispose();
  const size=box.getSize(new THREE.Vector3());const extent=Math.max(size.x,size.y,size.z,1);
  grid=new THREE.GridHelper(extent*2,30,0xbccadb,0xd9e1eb);grid.position.y=box.min.y-.015*extent;scene.add(grid);
  drawTree();fitBox(box);
  referenceUI.modelReady();
  status(`${data.schema} · ${elements.size.toLocaleString('es-PE')} elementos · Selecciona un elemento para ver sus propiedades`);
}
function fitBox(bounds,top=false){
  if(bounds.isEmpty())return;
  const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
  const radius=Math.max(size.length()/2,.1);
  const fov=THREE.MathUtils.degToRad(camera.fov);
  const halfAngle=Math.min(fov/2,Math.atan(Math.tan(fov/2)*camera.aspect));
  const distance=radius/Math.sin(halfAngle)*1.18;
  const direction=top?new THREE.Vector3(0,1,.0001):new THREE.Vector3(1,.8,1.2).normalize();
  camera.position.copy(center).addScaledVector(direction,distance);
  camera.near=Math.max(distance/10000,.001);camera.far=Math.max(distance*100,1000);camera.updateProjectionMatrix();
  controls.target.copy(center);controls.maxDistance=distance*20;controls.update();requestRender();
}
function elementButton(element){
  const b=document.createElement('button');b.dataset.id=element.id;b.classList.toggle('active',selected===element.id);
  const name=document.createElement('span');name.textContent=element.name;b.append(name);
  const small=document.createElement('small');small.textContent=`${element.type} · #${element.id}`;b.append(small);
  b.onclick=()=>selectElement(element.id);return b;
}
function drawTree(){
  const tree=$('tree');tree.replaceChildren();
  if(hasTextFilters()){
    const matches=[...elements.values()].filter(matchesTextFilters);
    for(const e of matches.slice(0,400))tree.append(elementButton(e));
    if(!matches.length)tree.textContent='No se encontraron elementos.';
    if(matches.length>400){const p=document.createElement('p');p.textContent=`Mostrando 400 de ${matches.length}. Afina la búsqueda.`;tree.append(p);}return;
  }
  const covered=new Set();
  function collect(node){if(elements.has(node.expressID))covered.add(node.expressID);for(const child of node.children||[])collect(child);}
  if(spatial)collect(spatial);
  function branch(node,depth=0){
    if(elements.has(node.expressID) && !(node.children||[]).length){covered.add(node.expressID);return elementButton(elements.get(node.expressID));}
    const detail=document.createElement('details'),summary=document.createElement('summary');
    detail.open=depth<2;
    summary.textContent=String(unwrap(node.Name)||node.type||`#${node.expressID}`);detail.append(summary);
    const children=document.createElement('div');children.className='children';
    let built=false;
    function populate(){if(built)return;built=true;if(elements.has(node.expressID))children.append(elementButton(elements.get(node.expressID)));for(const child of node.children||[])children.append(branch(child,depth+1));}
    if(detail.open)populate();
    detail.addEventListener('toggle',()=>{if(detail.open)populate();});
    detail.append(children);return detail;
  }
  if(spatial)tree.append(branch(spatial));
  const other=[...elements.values()].filter(e=>!covered.has(e.id));
  const grouped=Map.groupBy?Map.groupBy(other,e=>e.type):other.reduce((map,e)=>{if(!map.has(e.type))map.set(e.type,[]);map.get(e.type).push(e);return map;},new Map());
  for(const [type,items]of grouped){
    const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`${type} (${items.length})`;detail.append(summary);
    const children=document.createElement('div');children.className='children';let built=false;
    detail.addEventListener('toggle',()=>{if(detail.open&&!built){for(const e of items)children.append(elementButton(e));built=true;}});detail.append(children);tree.append(detail);
  }
}
function selectElement(id){
  clearSelection();if(!elements.has(id))return;selected=id;
  planningUI.selected(id);
  const e=elements.get(id);for(const mesh of objects.get(id)||[])mesh.material.emissive.setHex(0x245e9c);
  $('selection-empty').hidden=true;$('selection').hidden=false;
  $('selected-type').textContent=e.type;$('selected-name').textContent=e.name;$('selected-id').textContent=`Express ID #${id}`;
  $('properties').textContent='Leyendo propiedades…';
  document.querySelectorAll('.tree button').forEach(b=>b.classList.toggle('active',Number(b.dataset.id)===id));
  worker.postMessage({action:'properties',id,request});
}
function displayValue(value,depth=0){
  if(value===null||value===undefined)return '—';
  if(depth>4)return '…';
  if(typeof value!=='object')return String(value);
  if('value'in value)return displayValue(value.value,depth+1);
  if('_representationValue'in value)return displayValue(value._representationValue,depth+1);
  if('_internalValue'in value)return displayValue(value._internalValue,depth+1);
  if(Array.isArray(value))return value.map(v=>displayValue(v,depth+1)).join(', ');
  return Object.entries(value).filter(([k])=>!['type','expressID'].includes(k)).map(([k,v])=>`${k}: ${displayValue(v,depth+1)}`).join(' · ')||`#${value.expressID??''}`;
}
function propertySection(title,entries,open=false){
  const d=document.createElement('details');d.open=open;const s=document.createElement('summary');s.textContent=title;d.append(s);
  const dl=document.createElement('dl');for(const [key,val]of entries){if(val===null||val===undefined)continue;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=displayValue(val);dl.append(dt,dd);}d.append(dl);return d;
}
function showProperties(data){
  const panel=$('properties');panel.replaceChildren();
  const omit=new Set(['type','expressID','OwnerHistory','ObjectPlacement','Representation']);
  panel.append(propertySection('Identidad',Object.entries(data.line).filter(([k])=>!omit.has(k)),true));
  for(const set of data.sets){
    const props=set.HasProperties||set.Quantities||[];
    const entries=props.map(p=>[String(unwrap(p.Name)||'Propiedad'),p.NominalValue??p.ListValues??p.EnumerationValues??Object.fromEntries(Object.entries(p).filter(([k])=>!['type','expressID','Name','Description','Unit'].includes(k)))]);
    panel.append(propertySection(String(unwrap(set.Name)||'Propiedades IFC'),entries));
  }
  for(const type of data.types)panel.append(propertySection('Tipo · '+String(unwrap(type.Name)||''),Object.entries(type).filter(([k])=>!omit.has(k))));
  if(data.materials.length)panel.append(propertySection('Materiales',data.materials.map((m,i)=>[String(unwrap(m.Name)||`Material ${i+1}`),m])));
}
function updateCut(){
  if(!loaded)return;
  const axis=$('cut-axis').value,t=Number($('cut-range').value)/100;
  const position=THREE.MathUtils.lerp(box.min[axis],box.max[axis],t);
  const normal=new THREE.Vector3();normal[axis]=flipped?1:-1;plane.set(normal,flipped?-position:position);
  for(const meshes of objects.values())for(const mesh of meshes){if(Boolean(mesh.material.clippingPlanes?.length)!==cutting){mesh.material.clippingPlanes=cutting?[plane]:[];mesh.material.needsUpdate=true;}}
  requestRender();
}
function clearMeasure(){points=[];disposeGroup(measureGroup);$('measure-text').textContent='Selecciona dos puntos del modelo.';requestRender();}
function measurePoint(point){
  requestRender();
  if(points.length===2)clearMeasure();points.push(point.clone());
  const radius=Math.max(box.getSize(new THREE.Vector3()).length()*.004,.005);
  const dot=new THREE.Mesh(new THREE.SphereGeometry(radius,12,8),new THREE.MeshBasicMaterial({color:0x216ae4,depthTest:false}));dot.position.copy(point);dot.renderOrder=99;measureGroup.add(dot);
  if(points.length===1){$('measure-text').textContent='Selecciona el segundo punto.';return;}
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x216ae4,depthTest:false}));line.renderOrder=99;measureGroup.add(line);
  $('measure-text').textContent=`Distancia: ${points[0].distanceTo(points[1]).toLocaleString('es-PE',{minimumFractionDigits:3,maximumFractionDigits:3})} m`;
}
let down=null;
renderer.domElement.addEventListener('pointerdown',e=>{if(e.button===0)down={x:e.clientX,y:e.clientY};else down=null;});
renderer.domElement.addEventListener('pointerup',e=>{
  if(walkUI.isActive())return;
  if(renderer.xr.isPresenting||!loaded||!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5){down=null;return;}down=null;
  const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,camera);
  const hits=raycaster.intersectObjects(modelGroup.children,false).filter(hit=>hit.object.visible&&(!cutting||plane.distanceToPoint(hit.point)>=0));
  if(hits.length&&referenceUI.isPicking()){referenceUI.pick(hits[0].point);return;}
  if(hits.length){if(measuring)measurePoint(hits[0].point);else selectElement(hits[0].object.userData.id);}else if(!measuring)clearSelection();
});
$('open').onclick=$('empty-open').onclick=()=>$('file').click();
$('file').onchange=e=>{openFile(e.target.files[0]);e.target.value='';};
$('demo').onclick=async()=>{try{const r=await fetch('./ejemplo.ifc');if(!r.ok)throw Error();openFile(new File([await r.arrayBuffer()],'Ejemplo · pabellón.ifc'));}catch{status('No se pudo abrir el ejemplo.');}};
$('fit').onclick=()=>fitBox(box);$('top').onclick=()=>fitBox(box,true);
const normalizeText=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const filterIds=['search','filter-module','filter-block','filter-discipline','filter-type'];
function hasTextFilters(){return filterIds.some(id=>$(id).value.trim());}
function matchesTextFilters(e){
 return normalizeText(`${e.name} ${e.type} ${e.id}`).includes(normalizeText($('search').value))
 && normalizeText(e.type).includes(normalizeText($('filter-type').value))
 && ['module','block','discipline'].every(key=>!$( 'filter-'+key).value.trim()||(e[key]||[]).some(v=>normalizeText(v).includes(normalizeText($('filter-'+key).value))));
}
function applyTextFilters(){
 let count=0;for(const [id,e] of elements){const show=matchesTextFilters(e);if(show)count++;for(const mesh of objects.get(id)||[])mesh.visible=show;}
 if(selected!==null&&!matchesTextFilters(elements.get(selected)))clearSelection();
 $('filter-state').textContent=count.toLocaleString('es-PE')+' de '+elements.size.toLocaleString('es-PE')+' elementos. '+($('filter-state').dataset.coverage||'Leyendo módulos, bloques y disciplinas…');
 planningUI.apply();drawTree();requestRender();
}
function clearTextFilters(){for(const id of filterIds)$(id).value='';applyTextFilters();}
let searchTimer;for(const id of filterIds)$(id).oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(applyTextFilters,160);};
$('filter-clear').onclick=clearTextFilters;
$('powerbi').onclick=()=>{if(!loaded||loading)return;loading=true;$('powerbi').disabled=true;$('open').disabled=true;$('busy-text').textContent='Preparando el modelo completo para Power BI…';$('busy').hidden=false;worker.postMessage({action:'export',ids:[...elements.keys()]});};
$('restore').onclick=()=>{planningUI.reset();clearTextFilters();status('Filtros limpiados. Todos los elementos están visibles.');};
$('isolate').onclick=()=>{if(selected===null)return;for(const [id,meshes]of objects)for(const m of meshes)m.visible=id===selected;requestRender();status('Elemento aislado. Usa “Mostrar todo” para restaurar el modelo.');};
$('hide').onclick=()=>{for(const m of objects.get(selected)||[])m.visible=false;clearSelection();status('Elemento oculto. Usa “Mostrar todo” para restaurarlo.');};
$('focus').onclick=()=>{const bounds=new THREE.Box3();for(const mesh of objects.get(selected)||[])bounds.expandByObject(mesh);fitBox(bounds);};
$('cut').onclick=()=>{cutting=!cutting;$('cut').setAttribute('aria-pressed',String(cutting));$('cut-panel').hidden=!cutting;updateCut();};
$('cut-axis').onchange=$('cut-range').oninput=updateCut;$('flip').onclick=()=>{flipped=!flipped;updateCut();};
$('measure').onclick=()=>{measuring=!measuring;$('measure').setAttribute('aria-pressed',String(measuring));$('measure-panel').hidden=!measuring;if(!measuring)clearMeasure();};
$('clear-measure').onclick=clearMeasure;
let dragDepth=0;
document.addEventListener('dragenter',e=>{e.preventDefault();if([...e.dataTransfer.types].includes('Files')){dragDepth++;$('drop-hint').hidden=false;}});
document.addEventListener('dragover',e=>e.preventDefault());
document.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;$('drop-hint').hidden=true;}});
document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('drop-hint').hidden=true;if(e.dataTransfer.files.length)openFile(e.dataTransfer.files[0]);});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){clearSelection();measuring=false;$('measure').setAttribute('aria-pressed','false');$('measure-panel').hidden=true;clearMeasure();}});
window.addEventListener('error',e=>status(`Error del visor: ${e.message}`));
async function openSavedModel(){
  const params=new URLSearchParams(location.search),project=params.get('project'),model=params.get('model');
  if(!project||!model)return;
  $('projects-link').href='/projects.html?id='+encodeURIComponent(project);
  loading=true;$('busy').hidden=false;$('busy-text').textContent='Abriendo archivo del proyecto…';$('open').disabled=true;$('demo').disabled=true;
  try{
    const detail=await fetch('/api/projects/'+encodeURIComponent(project));if(detail.status===401){location.replace('/login.html');return;}const data=await detail.json();if(!detail.ok)throw Error(data.error||'No se pudo abrir el proyecto.');
    const entry=data.project.models.find(m=>m.id===model);if(!entry)throw Error('El archivo no está en este proyecto.');savedRevision=entry.revision||entry.id;
    const response=await fetch(`/api/projects/${encodeURIComponent(project)}/models/${encodeURIComponent(model)}/file`);if(response.status===401){location.replace('/login.html');return;}if(!response.ok)throw Error('No se pudo leer el IFC guardado.');
    document.title=data.project.name+' · Visor IFC';$('projects-link').title='Volver a '+data.project.name;
    const bytes=await response.arrayBuffer();loading=false;await openFile(new File([bytes],entry.name),true);
  }catch(e){fail(e.message);}
}
openSavedModel();

installAR({renderer,camera,controls,modelGroup,isReady:()=>loaded&&!loading,status,redraw:resize});


const referenceUI=installReference({renderer,camera,controls,modelGroup,isReady:()=>loaded&&!loading&&savedModelActive,getReference:()=>referenceFromRevit(elements,objects),status,redraw:resize});
const speed=document.createElement('select');
speed.setAttribute('aria-label','Velocidad de navegación');
speed.title='Velocidad de giro, desplazamiento y zoom; no cambia la escala del modelo';
for(const [value,label] of [['1','Movimiento normal'],['2','Movimiento rápido'],['.5','Movimiento preciso']]){
  const option=document.createElement('option');option.value=value;option.textContent=label;speed.append(option);
}
try{const saved=localStorage.getItem('visor.navigation.speed');if(['1','2','.5'].includes(saved))speed.value=saved;}catch{}
speed.onchange=()=>{const value=Number(speed.value);controls.panSpeed=value;controls.rotateSpeed=value;controls.zoomSpeed=value;try{localStorage.setItem('visor.navigation.speed',speed.value);}catch{}};
speed.onchange();document.querySelector('.viewer-panels').append(speed);

const planningUI=installPlanning({getElements:()=>elements,getObjects:()=>objects,render:requestRender,baseFilters:applyTextFilters,select:selectElement});

const walkUI=installWalk({camera,controls,renderer,modelGroup,isReady:()=>loaded&&!loading,render:requestRender,status});
