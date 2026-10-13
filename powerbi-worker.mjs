import fs from 'node:fs';
import path from 'node:path';
import {workerData,parentPort} from 'node:worker_threads';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as THREE from './dist/vendor/three.module.js';
import {createModelPackage} from './dist/powerbi-export.js';
// Reuse the viewer's IFC extraction, with the Node build of the same web-ifc release.
const root=path.dirname(fileURLToPath(import.meta.url));
const source=fs.readFileSync(path.join(root,'dist/ifc-worker.js'),'utf8');
const adapted=source.replace("'./vendor/web-ifc-api.js'",JSON.stringify(pathToFileURL(path.join(root,'server-vendor/web-ifc-api-node.js')).href)).replace("new URL('./vendor/', import.meta.url).href",JSON.stringify(path.join(root,'server-vendor').replaceAll('\\','/')+'/'));
const group=new THREE.Group(),objects=new Map();let ready,metadata,error;
globalThis.self={postMessage(message){
 if(message.kind==='error')error=new Error(message.message);
 if(message.kind==='ready')ready=message;
 if(message.kind==='export-ready')metadata=new Map(message.metadata.map(m=>[m.id,m]));
 if(message.kind==='mesh'){
  const meshes=[];
  for(const p of message.parts){const n=p.vertices.length/6,positions=new Float32Array(n*3),normals=new Float32Array(n*3);for(let i=0;i<n;i++){positions.set(p.vertices.subarray(i*6,i*6+3),i*3);normals.set(p.vertices.subarray(i*6+3,i*6+6),i*3);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setAttribute('normal',new THREE.BufferAttribute(normals,3));geo.setIndex(new THREE.BufferAttribute(p.indices,1));const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:new THREE.Color(p.color.x,p.color.y,p.color.z),opacity:p.color.w}));mesh.applyMatrix4(new THREE.Matrix4().fromArray(p.matrix));group.add(mesh);meshes.push(mesh);}objects.set(message.id,meshes);
 }
}};
try{
 await import('data:text/javascript;base64,'+Buffer.from(adapted).toString('base64'));
 const bytes=fs.readFileSync(workerData.file);
 await self.onmessage({data:{action:'open',buffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}});
 if(error)throw error;if(!ready)throw Error('El lector IFC no terminó.');
 await self.onmessage({data:{action:'export',ids:ready.elements.map(e=>e.id)}});
 if(error)throw error;if(!metadata)throw Error('No se extrajeron las propiedades.');
 const bounds=new THREE.Box3().setFromObject(group);if(!bounds.isEmpty())group.position.sub(bounds.getCenter(new THREE.Vector3()));
 const pack=createModelPackage({elements:new Map(ready.elements.map(e=>[e.id,e])),objects,modelGroup:group,spatial:ready.spatial,metadata,filename:workerData.name});
 pack.Revision=workerData.revision;
 const json=JSON.stringify(pack);if(Buffer.byteLength(json)>256*1024*1024)throw Error('El modelo para Power BI supera 256 MB. Envía una vista 3D más pequeña.');
 fs.writeFileSync(workerData.output,json,{flag:'wx'});
 parentPort.postMessage({ok:true,elements:pack.Elementos.length});
}catch(e){parentPort.postMessage({ok:false,error:e.message});}
