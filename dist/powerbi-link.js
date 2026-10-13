(()=>{
 const id=new URLSearchParams(location.search).get('id');if(!id)return;
 const el=name=>document.getElementById(name);el('powerbi-panel').hidden=false;
 const endpoint='/api/powerbi/projects/'+encodeURIComponent(id);
 let busy=false;
 async function update(method='GET'){
  if(busy)return;busy=true;
  try{const r=await fetch(endpoint,{method});const state=await r.json();if(!r.ok)throw Error(state.error||'No se pudo conectar.');el('pbi-link-box').hidden=!state.enabled;el('pbi-revoke').hidden=!state.enabled;el('pbi-enable').textContent=state.enabled?'Reintentar preparación':'Generar enlace Power BI';el('pbi-enable').hidden=state.enabled&&state.state!=='error';el('pbi-link').value=state.url||'';const label={disabled:'Genera el enlace una sola vez para conectar el proyecto.',empty:'Esperando el primer IFC.',queued:'En espera…',processing:'Preparando geometría y propiedades. El visual conserva la última versión hasta terminar.',ready:`Listo: ${state.elements||0} elementos · ${state.publishedAt?new Date(state.publishedAt).toLocaleString():''}`,error:'No se pudo preparar: '+(state.error||'Inténtalo nuevamente.')};el('pbi-status').textContent=label[state.state]||'Enlace revocado.';}catch(e){el('pbi-status').textContent=e.message;}finally{busy=false;}
 }
 el('pbi-enable').onclick=()=>update('POST');el('pbi-revoke').onclick=()=>update('DELETE');el('pbi-copy').onclick=async()=>{try{await navigator.clipboard.writeText(el('pbi-link').value);el('pbi-status').textContent='Enlace copiado.';}catch{el('pbi-link').select();el('pbi-status').textContent='Presiona Ctrl+C para copiar.';}};
 update();setInterval(()=>{if(!document.hidden)update();},5000);
})();
