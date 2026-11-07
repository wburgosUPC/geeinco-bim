const {publicOrigin,dataPath}=require('./cloud-config.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const scrypt=require('node:util').promisify(crypto.scrypt);
exports.createAuth=function(dataDir=dataPath('cuenta')){
 const viewersFile=path.join(dataDir,'lectores.json'),allowedProjects=['f2aeb8e7-b8f7-4b03-be93-d7198c4f35b2','a41ecd24-5a8d-4f44-bc3a-53c1416ab5bb'];
 function viewers(){try{const list=JSON.parse(fs.readFileSync(viewersFile,'utf8'));if(!Array.isArray(list)||list.some(a=>a.role!=='viewer'||typeof a.username!=='string'||!/^[a-f0-9]{32}$/.test(a.salt)||!/^[a-f0-9]{128}$/.test(a.hash)||!Array.isArray(a.projects)||a.projects.some(p=>!allowedProjects.includes(p))))throw Error('Invalid accounts');return list;}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 const file=path.join(dataDir,'usuario.json'),sessions=new Map();let failures=0,blocked=0,busy=false;
 function account(){try{const a=JSON.parse(fs.readFileSync(file,'utf8'));if(a.version!==1||typeof a.username!=='string'||!/^[a-f0-9]{32}$/.test(a.salt)||!/^[a-f0-9]{128}$/.test(a.hash))throw Error();return a;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 return {async handle(req,res,port){
  const origin=`${publicOrigin(port)}`,cookieName=`visor_${port}`;
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));return true;};
  if(req.headers.host!==new URL(publicOrigin(port)).host)return json(403,{error:'Dirección no permitida.'});
  let route;try{route=decodeURIComponent(new URL(req.url,origin).pathname);}catch{return json(400,{error:'Dirección inválida.'});}
  const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  for(const [key,value]of sessions)if(value.expiry<Date.now())sessions.delete(key);
  const principal=token&&sessions.get(token),authenticated=!!principal;req.auth=principal||null;
  const session=(user)=>{if(token)sessions.delete(token);const key=crypto.randomBytes(32).toString('hex');sessions.set(key,{expiry:Date.now()+28800000,username:user.username,role:user.role||'admin',projects:user.projects||allowedProjects});res.setHeader('Set-Cookie',`${cookieName}=${key}; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=28800`);};
  try{
   if(route==='/api/health'&&req.method==='GET')return json(200,{application:'visor-ifc-local',version:'1.5',apiVersion:1,powerBiFeedVersion:1});
   if(route==='/api/auth/status'&&req.method==='GET')return json(200,{configured:!!account(),authenticated:!!authenticated,...(principal?{username:principal.username,role:principal.role,projects:principal.projects}:{})});
   if(route==='/api/auth/viewers'){
    if(!authenticated)return json(401,{error:'Inicia sesión como administrador.'});
    if(principal.role!=='admin')return json(403,{error:'Solo el administrador puede gestionar usuarios.'});
    if(req.method==='GET')return json(200,{users:viewers().map(({username,role,projects})=>({username,role,projects}))});
    if(req.method!=='POST')return json(405,{error:'Método no permitido.'});
    if(req.headers.origin!==origin)return json(403,{error:'Solicitud no permitida.'});
    if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'Formato no válido.'});
    if(busy)return json(429,{error:'Hay una solicitud en curso.'});busy=true;
    try{let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>8192)return json(413,{error:'Solicitud demasiado larga.'});chunks.push(c);}let input;try{input=JSON.parse(Buffer.concat(chunks));}catch{return json(400,{error:'Solicitud inválida.'});}
     const username=typeof input.username==='string'?input.username.trim():'',password=input.password;
     if(!/^[A-Za-z0-9._-]{3,64}$/.test(username)||typeof password!=='string'||password.length<12||password.length>256)return json(400,{error:'Usuario de 3 a 64 caracteres y contraseña de al menos 12 caracteres.'});
     const users=viewers();if([account(),...users].some(a=>a?.username.toLowerCase()===username.toLowerCase()))return json(409,{error:'El usuario ya existe. No se modificó su contraseña.'});
     const salt=crypto.randomBytes(16).toString('hex'),hash=(await scrypt(password,salt,64)).toString('hex');
     users.push({username,role:'viewer',projects:allowedProjects,salt,hash,createdAt:new Date().toISOString()});
     fs.mkdirSync(dataDir,{recursive:true});const temp=viewersFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(users),{mode:0o600});fs.renameSync(temp,viewersFile);
     return json(201,{ok:true,username,role:'viewer',projects:allowedProjects});
    }finally{busy=false;}
   }
   if(route==='/api/auth/setup')return json(403,{error:'La cuenta se configura desde el servidor.'});
   if(route.startsWith('/api/auth/')&&req.method==='POST'){
    if(req.headers.origin!==origin)return json(403,{error:'Solicitud no permitida.'});
    if(route==='/api/auth/logout'){if(token)sessions.delete(token);res.setHeader('Set-Cookie',`${cookieName}=; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=0`);return json(200,{ok:true});}
    if(!['/api/auth/setup','/api/auth/login'].includes(route))return json(404,{error:'No encontrado.'});
    if(Date.now()<blocked)return json(429,{error:'Demasiados intentos. Espera un minuto.'});
    if(busy)return json(429,{error:'Hay una solicitud en curso. Inténtalo nuevamente.'});
    if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'Formato no válido.'});
    busy=true;
    try{
     const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>8192)return json(413,{error:'Solicitud demasiado larga.'});chunks.push(chunk);}const raw=Buffer.concat(chunks).toString('utf8');
     let body;try{body=JSON.parse(raw);}catch{return json(400,{error:'Solicitud inválida.'});}
     const username=typeof body?.username==='string'?body.username.trim():'',password=typeof body?.password==='string'?body.password:'';
     if(username.length<3||username.length>64||!password||password.length>256)return json(400,{error:'Usa un usuario de 3 a 64 caracteres y una contraseña válida.'});
     const admin=account();const a=admin?.username===username?admin:viewers().find(a=>a.username===username);
     if(!a){await scrypt(password,'unknown-account',64);if(++failures>=5){blocked=Date.now()+60000;failures=0;}return json(401,{error:'Usuario o contraseña incorrectos.'});}
     const candidate=await scrypt(password,a.salt,64);
     if(!crypto.timingSafeEqual(candidate,Buffer.from(a.hash,'hex'))||username!==a.username){if(++failures>=5){blocked=Date.now()+60000;failures=0;}return json(401,{error:'Usuario o contraseña incorrectos.'});}
     failures=0;session(a);return json(200,{ok:true});
    }finally{busy=false;}
   }
   if(new Set(['/GEEINCO-BIM-Revit-2027.zip','/login.html','/auth.js','/auth.css','/portal.css','/portal.js','/geeincobim-logo.svg']).has(route)&&['GET','HEAD'].includes(req.method))return false;
   if(authenticated){
    if(principal.role==='viewer'){
     if(!['GET','HEAD'].includes(req.method))return json(403,{error:'Esta cuenta es de solo visualización.'});
     if(route==='/'||route==='/projects.html'){res.writeHead(302,{Location:'/control.html?project=simon','Cache-Control':'no-store'});res.end();return true;}
     if(route==='/users.html')return json(403,{error:'Acceso reservado al administrador.'});
     if(route.startsWith('/api/')){
      const match=route.match(/^\/api\/(?:projects|planning)\/([^/]+)(?:\/.*)?$/);
      if(route!=='/api/projects'&&(!match||!principal.projects.includes(match[1])))return json(403,{error:'Acceso no autorizado.'});
     }
     if(route.startsWith('/control-data/')&&!['/control-data/simon.json','/control-data/virgen.json'].includes(route))return json(403,{error:'Acceso no autorizado.'});
    }
    return false;
   }
   if(route==='/'||route==='/index.html'||route==='/projects.html'||route==='/control.html'||route==='/users.html'){res.writeHead(302,{Location:'/login.html?next='+encodeURIComponent(req.url),'Cache-Control':'no-store'});res.end();return true;}
   return json(401,{error:'Inicia sesión para acceder al visor.'});
  }catch{return json(500,{error:'No se pudo acceder a la cuenta local. Consulta las instrucciones.'});}
 }};
};

