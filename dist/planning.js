import {validatePlan,addDays,monday,linkedTask,scheduleState,actualAt} from './planning-core.js';
export function installPlanning({getElements,getObjects,render,baseFilters,select}){
 const projectId=new URL(location.href).searchParams.get('project');
 let plan=null,tasks=new Map(),active=false;const originals=new Map();
 const el=(tag,text,parent)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(parent)parent.append(e);return e;};
 const button=el('button','Planificación semanal',document.querySelector('.viewer-panels'));
 const panel=el('dialog',null,document.body);panel.className='planning-dialog';
 const title=el('h2','Planificación semanal',panel);
 const close=el('button','Cerrar',panel);close.onclick=()=>panel.close();
 const info=el('p','Carga la planificación del proyecto.',panel);info.setAttribute('role','status');
 const file=el('input',null,panel);file.type='file';file.accept='.json';file.setAttribute('aria-label','Importar planificación');
 const save=el('button','Guardar en este proyecto',panel);save.disabled=true;
 const controls=el('div',null,panel);controls.className='planning-controls';
 const field=(name,type)=>{const label=el('label',name,controls);return el(type,null,label);};
 const week=field('Semana','select'),block=field('Bloque / módulo IFC','select'),mode=field('Colores','select'),search=field('Buscar partida','input');
 for(const [value,text]of [['plan','Programación'],['actual','Avance valorizado de partida']]){const o=el('option',text,mode);o.value=value;}
 const apply=el('button','Aplicar al modelo',controls),restore=el('button','Restaurar modelo',controls);
 const note=el('p','Las fechas proceden del Project. Los metrados valorizados corresponden a toda la partida: no identifican qué elemento está ejecutado ni se reparten por bloque o semana.',panel);
 const legend=el('p',null,panel),coverage=el('p',null,panel),detail=el('p',null,panel);
 const wrap=el('div',null,panel);wrap.className='planning-table';const table=el('table',null,wrap);
 const head=el('tr',null,el('thead',null,table));for(const h of ['Partida','Inicio / fin previstos','Situación programada','Metrado contractual','Acumulado valorizado','Corte del dato'])el('th',h,head);
 const body=el('tbody',null,table);
 const num=n=>new Intl.NumberFormat('es-PE',{maximumFractionDigits:2}).format(n);
 const matching=e=>!block.value||[...(e.block||[]),...(e.module||[])].includes(block.value);
 function rows(){if(!plan)return [];let codes=null;if(block.value){codes=new Set();for(const e of getElements().values()){const t=linkedTask(e,tasks);if(t&&matching(e))codes.add(t.code);}}
 return plan.tasks.filter(t=>(!codes||codes.has(t.code))&&(!search.value||`${t.code} ${t.name}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())));}
 function refresh(){
  body.replaceChildren();if(!plan)return;
  title.textContent=plan.name+' · Planificación semanal';const end=addDays(week.value,6),list=rows();
  let linked=0,ambiguous=0;for(const e of getElements().values()){if(linkedTask(e,tasks))linked++;else if((e.item||[]).filter(c=>tasks.has(c)).length>1)ambiguous++;}
  coverage.textContent=`${linked} de ${getElements().size} elementos vinculados por código de partida. ${ambiguous} con vínculo ambiguo. ${list.length} partidas en la selección. Las no vinculadas quedan grises.`;
  legend.textContent=mode.value==='plan'?'Azul: programada esta semana · Dorado: terminación prevista anterior · Gris claro: programada después · Gris: sin vínculo. Esto no acredita ejecución.':'Verde: partida valorizada ≥ 100% · Dorado: parcial · Azul: 0 registrado · Gris: sin dato al cierre de la semana. El corte figura en la tabla.';
  for(const t of list){const tr=el('tr',null,body),a=actualAt(t,end);const td=el('td',null,tr),b=el('button',t.code+' · '+t.name,td);b.onclick=()=>{const found=[...getElements().values()].find(e=>matching(e)&&linkedTask(e,tasks)===t);detail.textContent=found?'Partida vinculada al elemento '+found.id+'. '+t.name:'Esta partida no tiene elementos vinculados en el IFC actual.';if(found)select(found.id);};
   for(const text of [t.start+' / '+t.finish,scheduleState(t,week.value),num(t.quantity)+' '+t.unit,a?num(a.quantity)+' '+t.unit+(t.quantity>0?' ('+num(100*a.quantity/t.quantity)+'%)':''):'Sin dato',a?a.date+(a.date<end?' · corte anterior al fin de semana':''):'—'])el('td',text,tr);
  }
 }
 function reset(){active=false;for(const [m,c]of originals){m.color.copy(c);}originals.clear();baseFilters();render();}
 function applyModel(){if(!active||!plan)return;const selectedCodes=new Set(rows().map(t=>t.code)),end=addDays(week.value,6);
  for(const [id,e]of getElements())for(const mesh of getObjects().get(id)||[]){
   const t=linkedTask(e,tasks),plate=/marca.*ar|ar.*muro/i.test(e.name||'');
   if(!plate&&((block.value&&!matching(e))||(search.value&&(!t||!selectedCodes.has(t.code)))))mesh.visible=false;
   if(plate)continue;
   const a=t?actualAt(t,end):null;
   const color=!t?'#a2aab2':mode.value==='plan'?(t.finish<week.value?'#c39a46':t.start>end?'#d5dce2':'#2786b5'):!a?'#a2aab2':a.quantity===0?'#2786b5':t.quantity>0&&a.quantity>=t.quantity?'#2c9e73':'#c39a46';
   if(!originals.has(mesh.material))originals.set(mesh.material,mesh.material.color.clone());mesh.material.color.set(color);
  }render();
 }
 function modelReady(){const selected=block.value;block.replaceChildren();el('option','Todos',block).value='';for(const value of [...new Set([...getElements().values()].flatMap(e=>[...(e.block||[]),...(e.module||[])]))].sort()){el('option',value,block).value=value;}block.value=[...block.options].some(o=>o.value===selected)?selected:'';refresh();}
 function setPlan(p){validatePlan(p);if(p.projectId!==projectId)throw Error('Este archivo pertenece a otro proyecto.');reset();plan=p;tasks=new Map(p.tasks.map(t=>[t.code,t]));week.replaceChildren();const start=monday(p.tasks.reduce((a,t)=>t.start<a?t.start:a,p.tasks[0].start)),finish=p.tasks.reduce((a,t)=>t.finish>a?t.finish:a,p.tasks[0].finish);for(let d=start;d<=finish;d=addDays(d,7)){const o=el('option',d+' a '+addDays(d,6),week);o.value=d;}const dates=p.tasks.flatMap(t=>t.actuals.map(a=>a.date)).sort();const target=monday(dates.at(-1)||start);if([...week.options].some(o=>o.value===target))week.value=target;save.disabled=!projectId;info.textContent=p.source;modelReady();}
 file.onchange=async()=>{try{const f=file.files[0];if(!f)return;if(f.size>8*1024*1024)throw Error('Archivo demasiado grande.');setPlan(JSON.parse(await f.text()));info.textContent='Importado localmente. Pulsa Guardar en este proyecto para compartirlo con el equipo.';}catch(e){info.textContent=e.message;}};
 save.onclick=async()=>{save.disabled=true;try{const r=await fetch('/api/planning/'+projectId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(plan)});const v=await r.json();if(!r.ok)throw Error(v.error||'No se guardó.');info.textContent='Planificación guardada en el proyecto.';}catch(e){info.textContent=e.message;}finally{save.disabled=false;}};
 button.onclick=()=>{modelReady();panel.showModal();};
 for(const f of [week,block,mode,search])f.oninput=()=>{refresh();if(active){baseFilters();}};
 apply.onclick=()=>{if(!plan){info.textContent='Importa primero la planificación.';return;}active=true;baseFilters();panel.close();};restore.onclick=reset;
 if(projectId)fetch('/api/planning/'+projectId).then(async r=>{if(!r.ok)throw Error('Planificación no disponible todavía.');return r.json();}).then(v=>{if(v.planning)setPlan(v.planning);}).catch(e=>{info.textContent=e.message;});
 return {modelReady,apply:applyModel,reset,selected(id){const e=getElements().get(id),t=e&&linkedTask(e,tasks);detail.textContent=t?`${t.code} · ${t.name} · ${t.start} a ${t.finish}`:'Sin partida vinculada para este elemento.';}};
}
