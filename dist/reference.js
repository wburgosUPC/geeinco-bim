import {validateReference} from './reference-math.js';
import {drawPlate} from './marker-board.js';
import {createMarkerAR} from './marker-ar.js';

export function installReference({modelGroup,isReady,getReference}){
 const params=new URLSearchParams(location.search),project=params.get('project'),model=params.get('model');
 const endpoint=`/api/projects/${project}/models/${model}/reference`;
 let config=null,request=0;
 const setup=document.createElement('button');setup.textContent='Referencia QR';setup.id='reference-setup';document.querySelector('.viewer-panels').append(setup);
 const dialog=document.createElement('dialog');dialog.className='reference-dialog';
 dialog.innerHTML='<h2>AR-01 · Placa con cuatro marcadores</h2><p>Coloca la nueva placa de 20 × 20 cm sobre la familia de Revit, en la misma cara del muro, posición y altura. La flecha debe apuntar hacia arriba.</p><p id="ref-state" role="status"></p><div class="ref-buttons"><button id="ref-read">Vincular familia de Revit</button><button id="ref-print">Imprimir nueva placa</button><button id="ref-auto">Alinear con 4 marcadores</button><button id="ref-close">Cerrar</button></div><details><summary>Ver nueva placa</summary><div id="ref-preview"></div></details><p><strong>Reemplaza la impresión anterior.</strong> Esta opción reconoce los cuatro marcadores y no requiere fijar A ni B. Mantén la placa visible; el modelo se oculta si se pierde la referencia.</p><p>La posición se obtiene de INCOAC_Marca_AR_Muro_v2. La profundidad usa una cámara aproximada; puedes calibrarla desde «Ajuste de cámara». Verifica la coincidencia con otro punto conocido de obra.</p>';
 document.body.append(dialog);const el=id=>document.getElementById(id),say=t=>el('ref-state').textContent=t;
 const tracker=createMarkerAR({modelGroup,project,model});
 function enable(value){for(const id of ['ref-print','ref-auto'])el(id).disabled=!value;}
 async function refresh(){
  const token=++request;config=null;enable(false);say('Leyendo la referencia de Revit…');
  try{
   if(!project||!model||!isReady())throw Error('Espera a que termine de cargar el modelo guardado.');
   const candidate=validateReference(getReference());
   const r=await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(candidate)}),data=await r.json();
   if(token!==request)return;if(!r.ok)throw Error(data.error||'No se pudo guardar la vinculación.');
   config=candidate;el('ref-preview').replaceChildren(drawPlate({project,model}));enable(true);
   say('Familia vinculada · elemento IFC '+candidate.elementId+'. Imprime la nueva placa y pulsa «Alinear con 4 marcadores».');
  }catch(e){if(token===request){config=null;enable(false);say(e.message);}}
 }
 setup.onclick=()=>{if(!dialog.open)dialog.showModal();refresh();};el('ref-close').onclick=()=>dialog.close();el('ref-read').onclick=refresh;enable(false);
 el('ref-auto').onclick=async()=>{
  if(!config||!isReady())return;dialog.close();
  try{await tracker.start(config);}catch(e){if(!dialog.open)dialog.showModal();say('No se pudo abrir la cámara: '+e.message);}
 };
 el('ref-print').onclick=()=>{
  const canvas=drawPlate({project,model});let print=document.getElementById('reference-print');if(!print){print=document.createElement('section');print.id='reference-print';document.body.append(print);}print.replaceChildren();
  const title=document.createElement('h2');title.textContent='GEEINCO · AR-01 · Cuatro marcadores';
  const measure=document.createElement('p');measure.className='plate-measure';measure.textContent='← 200 mm · medir los bordes exteriores del recuadro →';
  const frame=document.createElement('div');frame.className='plate-frame';const image=new Image();image.alt='Placa GEEINCO con QR y cuatro marcadores';frame.append(image);
  const ruler=document.createElement('div');ruler.className='plate-ruler';ruler.textContent='CONTROL: 100 mm (10 cm)';
  const note=document.createElement('p');note.textContent='Imprimir al 100%, sin ajustar. Verifica 200 × 200 mm y la regla de 100 mm. Coloca la placa plana sobre la familia de Revit, flecha hacia arriba. Mantén despejados los cuatro marcadores. Sustituye la placa anterior. Modelo: '+model;
  print.append(title,measure,frame,ruler,note);image.onload=()=>{dialog.close();window.print();};image.src=canvas.toDataURL();
 };
 if(params.get('ar')==='reference')setup.click();
 return {pick:()=>false,isPicking:()=>false,modelReady:()=>{++request;config=null;tracker.stop();enable(false);if(dialog.open)refresh();}};
}
