async function verifySession(){try{const r=await fetch('/api/auth/status');if(!r.ok)return;const s=await r.json();if(!s.authenticated)location.replace('/login.html?next='+encodeURIComponent(location.pathname+location.search));}catch{}}
document.getElementById('logout').addEventListener('click',async()=>{try{const r=await fetch('/api/auth/logout',{method:'POST'});if(!r.ok)throw Error();location.replace('/login.html');}catch{document.getElementById('status').textContent='No se pudo cerrar la sesión.';}});
setInterval(verifySession,60000);window.addEventListener('pageshow',verifySession);
