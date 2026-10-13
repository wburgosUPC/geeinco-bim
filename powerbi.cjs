const {publicOrigin,dataPath}=require('./cloud-config.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
exports.createPowerBI=function(root=dataPath('datos','proyectos')){
 const queued=new Set();let running=false,closed=false,activeWorker;
 const folder=id=>path.join(root,id),configFile=id=>path.join(folder(id),'powerbi.json');
 const readConfig=id=>{try{return JSON.parse(fs.readFileSync(configFile(id),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 const project=id=>JSON.parse(fs.readFileSync(path.join(folder(id),'proyecto.json'),'utf8'));
 function save(id,value){const f=configFile(id),temp=f+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,f);}
 function schedule(id){if(closed||!ID.test(id)||!readConfig(id))return;queued.add(id);void drain();}
 async function drain(){
  if(running||closed)return;running=true;
  try{while(queued.size&&!closed){
   const id=queued.values().next().value;queued.delete(id);let temp;
   try{
    let c=readConfig(id);if(!c)continue;const p=project(id),m=p.models.at(-1);
    if(!m){save(id,{...c,state:'empty',error:null});continue;}
    if(c.revision===m.id&&fs.existsSync(path.join(folder(id),m.id+'.powerbi.json'))){save(id,{...c,state:'ready',error:null});continue;}
    save(id,{...c,state:'processing',pendingRevision:m.id,error:null});
    temp=path.join(folder(id),m.id+'.'+crypto.randomUUID()+'.powerbi.tmp');
    const result=await new Promise((resolve,reject)=>{
     const worker=activeWorker=new Worker(path.join(__dirname,'powerbi-worker.mjs'),{workerData:{file:path.join(folder(id),m.id+'.ifc'),name:m.name,revision:m.id,output:temp},resourceLimits:{maxOldGenerationSizeMb:2048}});
     const timer=setTimeout(()=>{worker.terminate();reject(Error('La preparación superó 10 minutos. Envía una vista 3D más pequeña.'));},600000);
     worker.once('message',r=>{clearTimeout(timer);worker.terminate();r.ok?resolve(r):reject(Error(r.error));});worker.once('error',e=>{clearTimeout(timer);reject(e);});worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error('Se interrumpió la preparación del modelo.'));});
    });
    activeWorker=null;if(closed)continue;c=readConfig(id);if(!c)continue;
    if(project(id).models.at(-1)?.id!==m.id){queued.add(id);continue;}
    fs.renameSync(temp,path.join(folder(id),m.id+'.powerbi.json'));
    save(id,{...c,state:'ready',revision:m.id,name:m.name,publishedAt:new Date().toISOString(),elements:result.elements,pendingRevision:null,error:null});
   }catch(e){if(!closed){const c=readConfig(id);if(c)save(id,{...c,state:'error',error:e.message});}}
   finally{if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);}
  }}finally{running=false;}
 }
 const summary=c=>c?{enabled:true,state:c.state,revision:c.revision||null,name:c.name||null,publishedAt:c.publishedAt||null,elements:c.elements||0,error:c.error||null}:{enabled:false,state:'disabled'};
 function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));return true;}
 return {
  notify(id){try{schedule(id);}catch(e){console.error('No se pudo preparar Power BI:',e.message);}},
  resume(){if(fs.existsSync(root))for(const id of fs.readdirSync(root))if(ID.test(id)&&readConfig(id))schedule(id);},
  async close(){closed=true;queued.clear();if(activeWorker)await activeWorker.terminate();},
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
   if(!ID.test(revision)||(revision!==c.revision&&!project(id).models.some(m=>m.id===revision)))return json(res,404,{error:'Versión no disponible.'});
   const file=path.join(folder(id),revision+'.powerbi.json');if(!fs.existsSync(file))return json(res,409,{error:'La versión todavía no está preparada.'});
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':fs.statSync(file).size,'X-Content-Type-Options':'nosniff'});const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);return true;
  },
  async handle(req,res,port){
   const url=new URL(req.url,`${publicOrigin(port)}`),match=url.pathname.match(/^\/api\/powerbi\/projects\/([^/]+)$/);if(!match)return false;
   const id=match[1];if(!ID.test(id)||!fs.existsSync(path.join(folder(id),'proyecto.json')))return json(res,404,{error:'Proyecto no encontrado.'});
   if(req.method==='GET'){const c=readConfig(id);return json(res,200,{...summary(c),url:c?`${publicOrigin(port)}/api/powerbi/feed/${id}/${c.token}`:null});}
   if(req.method!=='POST'&&req.method!=='DELETE')return json(res,405,{error:'Método no permitido.'});
   if(req.headers.origin!==`${publicOrigin(port)}`)return json(res,403,{error:'Solicitud no permitida.'});
   if(req.method==='DELETE'){if(readConfig(id))fs.unlinkSync(configFile(id));queued.delete(id);return json(res,200,{enabled:false});}
   const c=readConfig(id)||{token:crypto.randomBytes(32).toString('hex'),state:'queued'};save(id,c);schedule(id);
   return json(res,200,{...summary(readConfig(id)),url:`${publicOrigin(port)}/api/powerbi/feed/${id}/${c.token}`});
  }
 };
};
