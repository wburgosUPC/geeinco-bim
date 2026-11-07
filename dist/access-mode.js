(async()=>{try{const response=await fetch('/api/auth/status'),state=await response.json();if(!state.authenticated)return;if(!document.getElementById('logout')){const exit=document.createElement('button');exit.textContent='Salir';exit.onclick=async()=>{const r=await fetch('/api/auth/logout',{method:'POST'});if(r.ok)location.href='/login.html';};document.querySelector('header')?.append(exit);}
 if(state.role==='admin'){document.documentElement.classList.add('access-admin');const link=document.createElement('a');link.href='/users.html';link.textContent='Usuarios';link.style.cssText='font-size:13px;padding:8px';document.querySelector('header')?.append(link);return;}
 document.documentElement.classList.add('access-viewer');
 const watermark=document.createElement('div');watermark.className='viewer-watermark';watermark.textContent=state.username+' · SOLO VISUALIZACIÓN · '+new Date().toLocaleDateString('es-PE');document.body.append(watermark);
 for(const event of ['copy','cut','contextmenu','dragstart'])document.addEventListener(event,e=>e.preventDefault(),true);
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&['c','x','s','p'].includes(e.key.toLowerCase()))e.preventDefault();},true);
 document.addEventListener('click',e=>{if(e.target.closest('#csv,#print,#dataImport,#open,#powerbi,#new-project,#add-files,#empty-action,a[download]')){e.preventDefault();e.stopImmediatePropagation();}},true);
 }catch{}})();
