const toggle=document.getElementById('toggle-password'),password=document.getElementById('password');
toggle.addEventListener('click',()=>{const show=password.type==='password';password.type=show?'text':'password';toggle.textContent=show?'Ocultar':'Ver';toggle.setAttribute('aria-label',show?'Ocultar contraseña':'Mostrar contraseña');toggle.setAttribute('aria-pressed',String(show));});
