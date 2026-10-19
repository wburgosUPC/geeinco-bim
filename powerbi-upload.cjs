const fs=require('node:fs');
const {once}=require('node:events');
// Receive bounded JSON records. Never load the full model in server memory.
exports.receivePackage=async function(req,file,revision){
 const out=fs.createWriteStream(file,{flags:'wx'});let pending='',bytes=0,header=false,ended=false,index=0,first=true,elements=0;
 const keys=['Elementos','Geometria','Propiedades'];
 let outputError;out.on('error',e=>{outputError=e;});
 async function write(s){if(outputError)throw outputError;if(!out.write(s))await once(out,'drain');}
 async function line(s){
  if(Buffer.byteLength(s)>1048576)throw Error('Registro demasiado grande.');
  const v=JSON.parse(s);if(ended)throw Error('Datos después del cierre.');
  if(!header){if(v.Version!==1||v.UnidadGeometria!=='m'||typeof v.Archivo!=='string')throw Error('Cabecera inválida.');
   await write(JSON.stringify({Version:1,Archivo:v.Archivo.slice(0,200),Exportado:new Date().toISOString(),UnidadGeometria:'m',Revision:revision}).slice(0,-1)+',"Elementos":[');header=true;return;}
  if(v.end===true){if(index!==2)throw Error('Paquete incompleto.');ended=true;await write(']}');return;}
  const next=keys.indexOf(v.table);if(next<index||next>index+1||!v.row||typeof v.row!=='object'||Array.isArray(v.row))throw Error('Registro inválido.');
  if(next!==index){await write('],"'+keys[next]+'":[');index=next;first=true;}
  if(v.empty===true)return;
  if(index===0)elements++;
  await write((first?'':',')+JSON.stringify(v.row));first=false;
 }
 try{
  req.setEncoding('utf8');
  for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>256*1024*1024)throw Error('El paquete supera 256 MB.');pending+=chunk;let pos;while((pos=pending.indexOf('\n'))>=0){await line(pending.slice(0,pos));pending=pending.slice(pos+1);}if(Buffer.byteLength(pending)>1048576)throw Error('Registro demasiado grande.');}
  if(pending||!ended||!elements)throw Error('Paquete incompleto o vacío.');
  out.end();await once(out,'finish');return {elements};
 }catch(e){out.destroy();await new Promise(r=>out.closed?r():out.once('close',r));throw e;}
};
