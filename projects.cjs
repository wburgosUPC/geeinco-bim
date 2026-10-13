const {publicOrigin,dataPath}=require('./cloud-config.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_FILE=512*1024*1024;
exports.createProjects=function(root=dataPath('datos','proyectos'),onModelSaved=()=>{}){
 const locks=new Set();
 const folder=id=>path.join(root,id);
 const read=id=>{if(!ID.test(id))throw Object.assign(Error('Proyecto no encontrado.'),{status:404});try{return JSON.parse(fs.readFileSync(path.join(folder(id),'proyecto.json'),'utf8'));}catch(e){if(e.code==='ENOENT')throw Object.assign(Error('Proyecto no encontrado.'),{status:404});throw e;}};
 const save=project=>{const target=path.join(folder(project.id),'proyecto.json'),temp=target+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(project,null,2),{flag:'wx'});fs.renameSync(temp,target);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}};
 async function body(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>8192)throw Object.assign(Error('Nombre demasiado largo.'),{status:413});chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('Solicitud inválida.'),{status:400});}}
 return {async handle(req,res,port){
  let url;try{url=new URL(req.url,`${publicOrigin(port)}`);}catch{return false;}
  if(!url.pathname.startsWith('/api/projects'))return false;
  const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));return true;};
  if(req.method!=='GET'&&req.headers.origin!==`${publicOrigin(port)}`)return json(403,{error:'Solicitud no permitida.'});
  try{
   if(url.pathname==='/api/projects'){
    if(req.method==='GET'){
     const entries=fs.existsSync(root)?fs.readdirSync(root).filter(id=>ID.test(id)):[];
     const projects=entries.map(id=>{const p=read(id);return {id:p.id,name:p.name,createdAt:p.createdAt,updatedAt:p.updatedAt,modelCount:p.models.length,bytes:p.models.reduce((sum,m)=>sum+m.size,0)};}).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
     return json(200,{projects});
    }
    if(req.method==='POST'){
     if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'Formato no válido.'});
     const input=await body(req),name=typeof input?.name==='string'?input.name.trim():'';
     if(!name||name.length>100)return json(400,{error:'Escribe un nombre de entre 1 y 100 caracteres.'});
     const id=crypto.randomUUID(),now=new Date().toISOString(),project={id,name,createdAt:now,updatedAt:now,models:[]};
     fs.mkdirSync(folder(id),{recursive:true});save(project);return json(201,{project});
    }
    return json(405,{error:'Método no permitido.'});
   }
   const refMatch=url.pathname.match(/^\/api\/projects\/([^/]+)\/models\/([^/]+)\/reference$/);
   if(refMatch){
    const [,pid,mid]=refMatch;if(!ID.test(pid)||!ID.test(mid))return json(404,{error:'Entrega no encontrada.'});
    const p=read(pid);if(!p.models.some(m=>m.id===mid))return json(404,{error:'Entrega no encontrada. Abre el modelo vigente.'});
    const target=path.join(folder(pid),mid+'.reference.json');
    if(req.method==='GET')return json(200,{reference:fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):null});
    if(req.method==='PUT'){
     if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'Formato inválido.'});
     const c=await body(req),valid=v=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e7);
     if(c.version!==1||c.mount!=='wall'||c.width!==0.2||!valid(c.a)||!valid(c.b)||Math.hypot(...c.a.map((n,i)=>n-c.b[i]))<0.2||Math.abs(c.a[1]-c.b[1])>0.05)return json(400,{error:'A y B deben estar a la misma altura, separados al menos 20 cm.'});
     const reference={version:1,mount:'wall',width:0.2,a:c.a,b:c.b,updatedAt:new Date().toISOString()};
     const temp=target+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(reference),{flag:'wx'});fs.renameSync(temp,target);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
     return json(200,{reference});
    }return json(405,{error:'Método no permitido.'});
   }
   const match=url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/models(?:\/([^/]+)\/file)?)?$/);
   if(!match)return json(404,{error:'No encontrado.'});
   const id=match[1],modelID=match[2],project=read(id);
   if(url.pathname===`/api/projects/${id}`&&req.method==='GET')return json(200,{project});
   if(modelID&&req.method==='GET'){
    if(!ID.test(modelID))return json(404,{error:'Archivo no encontrado.'});
    const model=project.models.find(m=>m.id===modelID);if(!model)return json(404,{error:'Archivo no encontrado.'});
    const file=path.join(folder(id),modelID+'.ifc'),stat=fs.statSync(file);
    res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="modelo.ifc"; filename*=UTF-8''${encodeURIComponent(model.name)}`});
    const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);return true;
   }
   if(!modelID&&url.pathname===`/api/projects/${id}/models`&&req.method==='POST'){
    if(locks.has(id))return json(409,{error:'Se está guardando otro archivo en este proyecto. Inténtalo de nuevo.'});
    const name=url.searchParams.get('name')||'';
    if(name.length>200||!name.trim()||/[\\/\x00-\x1f]/.test(name)||!name.toLowerCase().endsWith('.ifc'))return json(400,{error:'Selecciona un archivo IFC con un nombre válido.'});
    if(Number(req.headers['content-length'])>MAX_FILE)return json(413,{error:'El límite es 512 MB por archivo.'});
    locks.add(id);
    const modelId=crypto.randomUUID(),temp=path.join(folder(id),modelId+'.tmp'),target=path.join(folder(id),modelId+'.ifc');let committed=false;
    try{
     let bytes=0;
     const counter=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>MAX_FILE)return done(Object.assign(Error('El límite es 512 MB por archivo.'),{status:413}));done(null,chunk);}});
     await pipeline(req,counter,fs.createWriteStream(temp,{flags:'wx'}));
     const fd=fs.openSync(temp,'r'),head=Buffer.alloc(Math.min(bytes,65536));try{fs.readSync(fd,head,0,head.length,0);}finally{fs.closeSync(fd);}
     const text=head.toString('utf8');
     if(!/^\uFEFF?\s*ISO-10303-21\s*;/i.test(text)||!/FILE_SCHEMA\s*\(\s*\(\s*'IFC/i.test(text))return json(400,{error:'El archivo no tiene una cabecera IFC válida.'});
     const current=read(id),model={id:modelId,name,size:bytes,addedAt:new Date().toISOString()};
     if(url.searchParams.get('source')==='Revit2027'){model.source='Revit 2027';model.sourceModel=(url.searchParams.get('sourceModel')||'').replace(/[\x00-\x1f]/g,'').slice(0,180);model.scope=url.searchParams.get('scope')==='active-view'?'active-view':'document';}
     const previous=current.models;
     fs.renameSync(temp,target);current.models=[...previous,model];current.updatedAt=model.addedAt;save(current);committed=true;
     try{onModelSaved(id,model);}catch{}
     return json(201,{model});
    }finally{locks.delete(id);if(fs.existsSync(temp))fs.unlinkSync(temp);if(!committed&&fs.existsSync(target))fs.unlinkSync(target);}
   }
   return json(405,{error:'Método no permitido.'});
  }catch(e){if(res.destroyed)return true;return json(e.status||500,{error:e.status?e.message:'No se pudo guardar o leer el proyecto. Comprueba el espacio disponible y vuelve a intentarlo.'});}
 }};
};


