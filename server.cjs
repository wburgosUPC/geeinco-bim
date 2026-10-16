const {initialize,publicOrigin}=require('./cloud-config.cjs');
initialize();
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {createAuth} = require('./auth.cjs');
const {createProjects} = require('./projects.cjs');
const root = path.join(__dirname, 'dist');
const mime = { '.zip':'application/zip', '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.wasm':'application/wasm', '.ifc':'application/octet-stream', '.svg':'image/svg+xml' };
const auth = createAuth();
const planning=require('./planning.cjs').createPlanning();
const {createPowerBI}=require('./powerbi.cjs');
const powerbi=createPowerBI();
const projects = createProjects(undefined,id=>powerbi.notify(id));
powerbi.resume();
const server = http.createServer(async (req,res) => {
  if (await powerbi.publicHandle(req,res,server.address().port)) return;
  if (await auth.handle(req,res,server.address().port)) return;
  if (await powerbi.handle(req,res,server.address().port)) return;
  if (await planning.handle(req,res,server.address().port)) return;
  if (await projects.handle(req,res,server.address().port)) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/projects.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file,(err,stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'text/plain; charset=utf-8', 'Content-Length':stat.size, 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-store', 'Permissions-Policy':'camera=(self), xr-spatial-tracking=(self)', 'X-Frame-Options':'DENY', 'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file); stream.on('error',()=>res.destroy()); stream.pipe(res);
  });
});
server.requestTimeout=600000;server.headersTimeout=10000;
server.listen(Number(process.env.PORT||63137),'0.0.0.0',()=>{
  const url = publicOrigin(server.address().port);
  console.log(`Visor IFC: ${url}\nMantén esta ventana abierta. Ctrl+C para cerrar.`);
  if (process.argv.includes('--open')) spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{stdio:'ignore',windowsHide:true}).on('error',()=>console.log('Abre el enlace en tu navegador.'));
});
server.on('error',async e=>{
  if(e.code==='EADDRINUSE'&&process.argv.includes('--open')){
    const port=Number(process.argv.find(a=>a.startsWith('--port='))?.split('=')[1]||63137),url='http://127.0.0.1:'+port;
    try{const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(2000),redirect:'error'});const state=await response.json();if(response.ok&&state.application==='visor-ifc-local'&&state.apiVersion===1){spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{stdio:'ignore',windowsHide:true}).on('error',()=>console.log('Abre '+url));console.log('El visor ya está abierto: '+url);return;}}catch{}
    console.error('El puerto '+port+' está ocupado. Cierra la instancia anterior del visor y vuelve a abrirlo.');process.exitCode=1;return;
  }
  console.error(e.message);process.exitCode=1;
});

