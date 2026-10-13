const $=id=>document.getElementById(id);const projectId=new URLSearchParams(location.search).get('id');let saving=false;
const date=value=>new Date(value).toLocaleString('es-PE',{dateStyle:'medium',timeStyle:'short'});
const size=bytes=>bytes>=1048576?(bytes/1048576).toLocaleString('es-PE',{maximumFractionDigits:1})+' MB':(bytes?Math.max(1,Math.round(bytes/1024)):0)+' KB';
async function api(url,options){const r=await fetch(url,options);if(r.status===401){location.replace('/login.html');throw Error('Inicia sesión para continuar.');}let body;try{body=await r.json();}catch{throw Error('No se pudo conectar con el visor. Vuelve a abrirlo.');}if(!r.ok)throw Error(body.error||'No se pudo completar la operación.');return body;}
function text(tag,value,className){const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;}
function createDialog(){$('form-error').textContent='';$('create-form').reset();$('create-dialog').showModal();$('project-name').focus();}
$('new-project').onclick=createDialog;$('cancel').onclick=()=>$('create-dialog').close();
$('empty-action').onclick=()=>projectId?$('files').click():createDialog();$('add-files').onclick=()=>$('files').click();
$('create-form').onsubmit=async e=>{e.preventDefault();$('create').disabled=true;$('cancel').disabled=true;try{const {project}=await api('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('project-name').value})});location.href='/projects.html?id='+project.id;}catch(e){$('form-error').textContent=e.message;}finally{$('create').disabled=false;$('cancel').disabled=false;}};
async function refresh(){
 try{
  if(!projectId){const {projects}=await api('/api/projects');$('cards').replaceChildren();for(const p of projects){const card=document.createElement('a');card.className='card';card.href='/projects.html?id='+p.id;card.append(text('span','▱','card-icon'),text('h2',p.name),text('span',`${p.modelCount} ${p.modelCount===1?'archivo':'archivos'} IFC · ${size(p.bytes)}`,'stats'));const foot=text('div','Actualizado '+date(p.updatedAt),'date');foot.append(text('span','↗','arrow'));card.append(foot);$('cards').append(card);}$('empty').hidden=projects.length>0;$('status').textContent=projects.length?`${projects.length} ${projects.length===1?'proyecto guardado':'proyectos guardados'}`:'';
  }else{
   const {project}=await api('/api/projects/'+projectId);document.title=project.name+' · Visor IFC';$('title').textContent=project.name;$('eyebrow').textContent='PROYECTO EN LA NUBE';$('subtitle').textContent='Entregas del proyecto. Cada envío conserva las versiones anteriores y su referencia AR.';$('back').hidden=false;$('new-project').hidden=true;$('add-files').hidden=false;$('cards').hidden=true;$('models').hidden=false;$('models').replaceChildren();
   for(const m of [...project.models].reverse()){const row=document.createElement('article');row.className='model-row';const info=text('div','','model-info');info.append(text('h2',m.name),text('p',`${size(m.size)} · Última actualización ${date(m.addedAt)}`));const link=document.createElement('a');link.textContent='Explorar modelo →';link.href=`/index.html?project=${project.id}&model=${m.id}`;row.append(text('span','IFC','model-icon'),info,link);$('models').append(row);}
   $('empty').hidden=project.models.length>0;$('empty-title').textContent='Agrega el primer modelo';$('empty-text').textContent='Selecciona el IFC de esta obra. Los siguientes envíos actualizarán este mismo proyecto.';$('empty-action').textContent='Subir modelo IFC';$('status').textContent=project.models.length?'MODELO VIGENTE · Actualizado '+date(project.updatedAt):'';
  }
 }catch(e){$('status').textContent=e.message;$('empty').hidden=true;}
}
$('files').onchange=async e=>{
 const files=[...e.target.files].slice(0,1);e.target.value='';if(saving||!projectId||!files.length)return;saving=true;$('add-files').disabled=true;$('empty-action').disabled=true;let completed=0;const errors=[];
 for(const file of files){if(!/\.ifc$/i.test(file.name)){errors.push(file.name+': selecciona un IFC.');continue;}if(file.size>512*1024*1024){errors.push(file.name+': supera 512 MB.');continue;}try{$('status').textContent=`Guardando ${file.name} (${completed+1} de ${files.length})…`;await api(`/api/projects/${projectId}/models?name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});completed++;}catch(e){errors.push(file.name+': '+e.message);}}
 saving=false;$('add-files').disabled=false;$('empty-action').disabled=false;await refresh();$('status').textContent=(completed?'Modelo actualizado. El proyecto conserva un único IFC vigente.':'No se cambió el modelo.')+(errors.length?' '+errors.join(' '):'');
};
window.addEventListener('beforeunload',e=>{if(saving){e.preventDefault();e.returnValue='';}});refresh();
