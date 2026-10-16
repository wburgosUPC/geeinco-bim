const {publicOrigin,dataPath}=require('./cloud-config.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const scrypt=require('node:util').promisify(crypto.scrypt);
exports.createAuth=function(dataDir=dataPath('cuenta')){
 const file=path.join(dataDir,'usuario.json'),sessions=new Map();let failures=0,blocked=0,busy=false;
 function account(){try{const a=JSON.parse(fs.readFileSync(file,'utf8'));if(a.version!==1||typeof a.username!=='string'||!/^[a-f0-9]{32}$/.test(a.salt)||!/^[a-f0-9]{128}$/.test(a.hash))throw Error();return a;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 return {async handle(req,res,port){
  const origin=`${publicOrigin(port)}`,cookieName=`visor_${port}`;
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));return true;};
  if(req.headers.host!==new URL(publicOrigin(port)).host)return json(403,{error:'Dirección no permitida.'});
  let route;try{route=decodeURIComponent(new URL(req.url,origin).pathname);}catch{return json(400,{error:'Dirección inválida.'});}
  const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  for(const [key,expiry]of sessions)if(expiry<Date.now())sessions.delete(key);
  const authenticated=token&&sessions.has(token);
  const session=()=>{if(token)sessions.delete(token);const key=crypto.randomBytes(32).toString('hex');sessions.set(key,Date.now()+28800000);res.setHeader('Set-Cookie',`${cookieName}=${key}; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=28800`);};
  try{
   if(route==='/api/health'&&req.method==='GET')return json(200,{application:'visor-ifc-local',version:'1.5',apiVersion:1,powerBiFeedVersion:1});
   if(route==='/api/auth/status'&&req.method==='GET')return json(200,{configured:!!account(),authenticated:!!authenticated});
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
     const a=account();
     if(route==='/api/auth/setup'){return json(403,{error:'La cuenta se configura desde el servidor.'});
      if(a)return json(409,{error:'Ya existe una cuenta. Inicia sesión.'});
      if(password.length<12)return json(400,{error:'La contraseña debe tener al menos 12 caracteres.'});
      const salt=crypto.randomBytes(16).toString('hex'),hash=(await scrypt(password,salt,64)).toString('hex');fs.mkdirSync(dataDir,{recursive:true});
      try{fs.writeFileSync(file,JSON.stringify({version:1,username,salt,hash}),{flag:'wx',mode:0o600});}catch(e){if(e.code==='EEXIST')return json(409,{error:'Ya existe una cuenta.'});throw e;}
      session();return json(201,{ok:true});
     }
     if(!a)return json(409,{error:'Primero crea tu cuenta.'});
     const candidate=await scrypt(password,a.salt,64);
     if(!crypto.timingSafeEqual(candidate,Buffer.from(a.hash,'hex'))||username!==a.username){if(++failures>=5){blocked=Date.now()+60000;failures=0;}return json(401,{error:'Usuario o contraseña incorrectos.'});}
     failures=0;session();return json(200,{ok:true});
    }finally{busy=false;}
   }
   if(new Set(['/GEEINCO-BIM-Revit-2027.zip','/login.html','/auth.js','/auth.css','/portal.css','/portal.js','/geeincobim-logo.svg']).has(route)&&['GET','HEAD'].includes(req.method))return false;
   if(authenticated)return false;
   if(route==='/'||route==='/index.html'||route==='/projects.html'){res.writeHead(302,{Location:'/login.html?next='+encodeURIComponent(req.url),'Cache-Control':'no-store'});res.end();return true;}
   return json(401,{error:'Inicia sesión para acceder al visor.'});
  }catch{return json(500,{error:'No se pudo acceder a la cuenta local. Consulta las instrucciones.'});}
 }};
};

