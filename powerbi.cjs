const {publicOrigin,dataPath}=require('./cloud-config.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {receivePackage}=require('./powerbi-upload.cjs');
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
exports.createPowerBI=function(root=dataPath('datos','proyectos')){
 let uploading=false;
 const folder=id=>path.join(root,id),configFile=id=>path.join(folder(id),'powerbi.json');
 const readConfig=id=>{try{return JSON.parse(fs.readFileSync(configFile(id),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const project=id=>JSON.parse(fs.readFileSync(path.join(folder(id),'proyecto.json'),'utf8'));
 function save(id,value){const f=configFile(id),temp=f+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,f);}
 function schedule(id){if(!ID.test(id))return;const c=readConfig(id);if(!c)return;const m=project(id).models.at(-1),revision=m?.revision||m?.id;const ready=c.revision===revision&&revision&&fs.existsSync(path.join(folder(id),revision+'.powerbi.json'));save(id,{...c,state:ready?'ready':'local_required',error:null});}
 const summary=c=>c?{enabled:true,state:c.state,revision:c.revision||null,name:c.name||null,publishedAt:c.publishedAt||null,elements:c.elements||0,error:c.error||null}:{enabled:false,state:'disabled'};
 function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));return true;}
 return {
  notify(id){try{schedule(id);}catch(e){console.error('No se pudo preparar Power BI:',e.message);}},
  resume(){if(fs.existsSync(root))for(const id of fs.readdirSync(root))if(ID.test(id))schedule(id);},
  async close(){},
  async publicHandle(req,res,port){
   const url=new URL(req.url,`${publicOrigin(port)}`);if(!url.pathname.startsWith('/api/powerbi/feed/'))return false;
   if(req.headers.host!==new URL(publicOrigin(port)).host)return json(res,403,{error:'Dirección no permitida.'});
   const match=url.pathname.match(/^\/api\/powerbi\/feed\/([^/]+)\/([a-f0-9]{64})(\/model)?$/);
   if(!match||!ID.test(match[1]))return json(res,404,{error:'Enlace no válido.'});
   // A dedicated read-only capability link, without cookies, is usable by Power BI's sandbox.
   res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');res.setHeader('Access-Control-Allow-Private-Network','true');
   if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true;}
   if(req.method!=='GET')return json(res,405,{error:'Este enlace es solo de lectura.'});
   const id=match[1],c=readConfig(id);
   if(!c||!crypto.timingSafeEqual(Buffer.from(c.token,'hex'),Buffer.from(match[2],'hex')))return json(res,403,{error:'Enlace revocado o no válido. Genera otro desde el proyecto.'});
   if(!match[3])return json(res,200,{...summary(c),projectId:id,projectName:project(id).name});
   const revision=url.searchParams.get('revision')||c.revision;
   if(!revision)return json(res,409,{error:c.error||'El modelo todavía se está preparando.'});
   if(!ID.test(revision)||(revision!==c.revision&&!project(id).models.some(m=>(m.revision||m.id)===revision)))return json(res,404,{error:'Versión no disponible.'});
   const file=path.join(folder(id),revision+'.powerbi.json');if(!fs.existsSync(file))return json(res,409,{error:'La versión todavía no está preparada.'});
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':fs.statSync(file).size,'X-Content-Type-Options':'nosniff'});const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);return true;
  },
  async handle(req,res,port){
   const url=new URL(req.url,`${publicOrigin(port)}`),match=url.pathname.match(/^\/api\/powerbi\/projects\/([^/]+)$/);if(!match)return false;
   const id=match[1];if(!ID.test(id)||!fs.existsSync(path.join(folder(id),'proyecto.json')))return json(res,404,{error:'Proyecto no encontrado.'});
   if(req.method==='GET'){const c=readConfig(id);return json(res,200,{...summary(c),url:c?`${publicOrigin(port)}/api/powerbi/feed/${id}/${c.token}`:null});}
   if(req.method!=='POST'&&req.method!=='DELETE'&&req.method!=='PUT')return json(res,405,{error:'Método no permitido.'});
   if(req.headers.origin!==`${publicOrigin(port)}`)return json(res,403,{error:'Solicitud no permitida.'});
   if(req.method==='PUT'){
    if(uploading)return json(res,409,{error:'Otra publicación está en curso. Intenta nuevamente.'});
    const revision=url.searchParams.get('revision'),m=project(id).models.at(-1);
    if(!ID.test(revision||'')||revision!==(m?.revision||m?.id))return json(res,409,{error:'El IFC cambió. Recarga el modelo antes de preparar Power BI.'});
    if(!req.headers['content-type']?.startsWith('application/x-ndjson'))return json(res,415,{error:'Formato no válido.'});
    uploading=true;const temp=path.join(folder(id),crypto.randomUUID()+'.upload.tmp');
    try{
     const result=await receivePackage(req,temp,revision),latest=project(id).models.at(-1);
     if(revision!==(latest?.revision||latest?.id))return json(res,409,{error:'El IFC cambió durante la publicación. Recarga el modelo.'});
     const c=readConfig(id)||{token:crypto.randomBytes(32).toString('hex')};
     fs.renameSync(temp,path.join(folder(id),revision+'.powerbi.json'));
     save(id,{...c,state:'ready',revision,name:m.name,publishedAt:new Date().toISOString(),elements:result.elements,pendingRevision:null,error:null});
     return json(res,200,{...summary(readConfig(id)),url:`${publicOrigin(port)}/api/powerbi/feed/${id}/${c.token}`});
    }catch(e){if(!res.destroyed)return json(res,400,{error:e.message});return true;}
    finally{uploading=false;if(fs.existsSync(temp))fs.unlinkSync(temp);}
   }
   if(req.method==='DELETE'){if(readConfig(id))fs.unlinkSync(configFile(id));return json(res,200,{enabled:false});}
   const c=readConfig(id)||{token:crypto.randomBytes(32).toString('hex'),state:'queued'};save(id,c);schedule(id);
   return json(res,200,{...summary(readConfig(id)),url:`${publicOrigin(port)}/api/powerbi/feed/${id}/${c.token}`});
  }
 };
};
