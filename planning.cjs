const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {dataPath,publicOrigin}=require('./cloud-config.cjs');
exports.createPlanning=function(root=dataPath('datos','proyectos')){
 return {async handle(req,res,port){
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/planning/'))return false;
  const reply=(s,v)=>{res.writeHead(s,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(v));return true;};
  const id=url.pathname.slice('/api/planning/'.length);
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))return reply(404,{error:'Proyecto no encontrado.'});
  const dir=path.join(root,id),file=path.join(dir,'planning.json');
  if(!fs.existsSync(path.join(dir,'proyecto.json')))return reply(404,{error:'Proyecto no encontrado.'});
  try{
   if(req.method==='GET')return reply(200,{planning:fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null});
   if(req.method!=='PUT')return reply(405,{error:'Método no permitido.'});
   if(req.headers.origin!==publicOrigin(port))return reply(403,{error:'Origen no permitido.'});
   if(!req.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'Se requiere JSON.'});
   const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>8*1024*1024)return reply(413,{error:'Archivo demasiado grande.'});chunks.push(c);}
   const p=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   const {validatePlan}=await import('./dist/planning-core.js');validatePlan(p);
   if(p.projectId!==id)return reply(400,{error:'La planificación pertenece a otro proyecto.'});
   const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(p),{flag:'wx'});fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
   return reply(200,{saved:true});
  }catch(e){return reply(400,{error:'No se pudo leer o guardar la planificación: '+e.message});}
 }};
};
