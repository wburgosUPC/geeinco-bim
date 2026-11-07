const fs=require('node:fs/promises'),path=require('node:path'),zlib=require('node:zlib');
const {dataPath,publicOrigin}=require('./cloud-config.cjs');
// Called only after the viewer's authentication middleware.
exports.createControl=function(root=dataPath('control-panel')){
 const busy=new Set();
 return {async handle(req,res){
  const route=new URL(req.url,'http://localhost').pathname;
  if(!route.startsWith('/control-data/'))return false;
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));return true;};
  const m=/^\/control-data\/(simon|virgen)\.json$/.exec(route);
  if(!m)return json(404,{error:'No encontrado'});
  const key=m[1],file=path.join(root,key+'.json');
  if(['GET','HEAD'].includes(req.method)){
   try{const gzip=(req.headers['accept-encoding']||'').includes('gzip');const bytes=await fs.readFile(file+(gzip?'.gz':''));res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Accept-Encoding','X-Content-Type-Options':'nosniff',...(gzip?{'Content-Encoding':'gzip'}:{}),'Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);return true;}catch(e){return json(e.code==='ENOENT'?404:500,{error:'Datos aún no disponibles'});}
  }
  if(req.method!=='PUT')return json(405,{error:'Método no permitido'});
  if(req.headers.origin!==publicOrigin())return json(403,{error:'Origen no permitido'});
  if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'Usa JSON'});
  if(busy.has(key))return json(409,{error:'Carga en curso'});
  busy.add(key);
  try{
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>25*1024*1024)return json(413,{error:'Máximo 25 MB'});chunks.push(chunk);}
   const bytes=Buffer.concat(chunks);let value;try{value=JSON.parse(bytes);}catch{return json(400,{error:'JSON inválido'});}
   const expected={simon:'f2aeb8e7-b8f7-4b03-be93-d7198c4f35b2',virgen:'a41ecd24-5a8d-4f44-bc3a-53c1416ab5bb'};
   if(value.version!==1||value.key!==key||value.project!==expected[key]||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value.cutoff)||!['parts','budget','resources','labor','closures','schedule','costs','subcontracts','progress'].every(k=>Array.isArray(value[k])))return json(400,{error:'Paquete de panel no válido'});
   await fs.mkdir(root,{recursive:true});
   try{await fs.copyFile(file,file+'.previous');}catch(e){if(e.code!=='ENOENT')throw e;}
   await fs.writeFile(file+'.tmp',bytes,{mode:0o600});await fs.writeFile(file+'.gz.tmp',zlib.gzipSync(bytes),{mode:0o600});
   await fs.rename(file+'.tmp',file);await fs.rename(file+'.gz.tmp',file+'.gz');
   return json(200,{ok:true,project:key,cutoff:value.cutoff});
  }catch{return json(500,{error:'No se pudo guardar el panel'});}finally{busy.delete(key);}
 }};
};
