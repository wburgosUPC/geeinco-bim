(() => {
  const mobile = matchMedia('(max-width: 900px)').matches;
  for (const [name, id] of [['model','model-panel'],['properties','properties-panel']]) {
    const panel = document.getElementById(id), button = document.getElementById('toggle-'+name);
    let visible = !mobile;
    try { const saved=localStorage.getItem('visor.panel.'+name); if(saved!==null)visible=saved==='true'; } catch {}
    const apply = () => { panel.hidden=!visible; button.setAttribute('aria-expanded',String(visible)); button.title=(visible?'Ocultar ':'Mostrar ')+(name==='model'?'modelo':'propiedades'); };
    button.onclick=()=>{ visible=!visible; apply(); try{localStorage.setItem('visor.panel.'+name,String(visible));}catch{} };
    apply();
  }
})();
