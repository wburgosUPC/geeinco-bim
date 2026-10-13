import * as THREE from 'three';
import {QRCode} from './qr-code.js';
import {validateReference,referenceInverse,wallMatrix} from './reference-math.js';
export function installReference({renderer,camera,controls,modelGroup,isReady,getReference,status,redraw}){
 const params=new URLSearchParams(location.search),project=params.get('project'),model=params.get('model');
 const endpoint=`/api/projects/${project}/models/${model}/reference`;
 let config=null;
 const nav=document.querySelector('.viewer-panels');
 const setup=document.createElement('button');setup.textContent='Referencia QR';setup.id='reference-setup';nav.append(setup);
 const dialog=document.createElement('dialog');dialog.className='reference-dialog';
 dialog.innerHTML='<h2>AR-01 · Referencia en muro</h2><p>Fija la placa vertical, plana, con la flecha hacia arriba. La posición se lee de la familia INCOAC_Marca_AR_Muro_v2 exportada desde Revit. Coloca la placa impresa en ese mismo lugar, con la flecha hacia arriba.</p><p id="ref-state" role="status"></p><div class="ref-buttons"><button id="ref-read">Vincular familia de Revit</button><button id="ref-print">Imprimir placa</button><button id="ref-auto">AR con placa · experimental</button><button id="ref-manual">AR por dos puntos</button><button id="ref-close">Cerrar</button></div><p>El cuadrado debe medir exactamente 20 × 20 cm. La referencia solo corresponde a esta entrega IFC. Comprueba la alineación en otro punto de obra.</p>';
 document.body.append(dialog);const el=id=>document.getElementById(id);
 const say=t=>el('ref-state').textContent=t;
 function enable(value){for(const id of ['ref-print','ref-auto','ref-manual'])el(id).disabled=!value;}
 async function load(){
  config=null;enable(false);
  if(!project||!model||!isReady())throw Error('Espera a que termine de cargar la entrega IFC guardada.');
  const candidate=validateReference(getReference());
  const r=await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(candidate)});
  const data=await r.json();if(!r.ok)throw Error(data.error||'No se pudo guardar la vinculación.');
  config=candidate;enable(true);say('Familia de Revit vinculada · elemento IFC '+candidate.elementId+'. Escanea el QR, abre AR con placa y enfoca la placa completa.');
 }
 async function refresh(){try{await load();}catch(e){config=null;enable(false);say(e.message);}}
 setup.onclick=()=>{dialog.showModal();refresh();};
 el('ref-close').onclick=()=>dialog.close();
 el('ref-read').onclick=refresh;
 enable(false);
 function plate(){
  const url=new URL('/index.html',location.origin);url.searchParams.set('project',project);url.searchParams.set('model',model);url.searchParams.set('ar','reference');
  const qr=new QRCode(-1,1);qr.addData(url.href);qr.make();const n=qr.getModuleCount();
  const c=document.createElement('canvas');c.width=c.height=1000;const g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,1000,1000);g.fillStyle='#122d43';g.fillRect(0,0,1000,90);g.fillStyle='white';g.font='bold 42px sans-serif';g.fillText('GEEINCO · AR-01',32,60);g.fillText('↑ ARRIBA',700,60);
  // Distinct asymmetric features around the QR improve image recognition.
  let seed=Number.parseInt(model.replace(/-/g,'').slice(0,8),16)>>>0;
  for(let i=0;i<95;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const x=20+seed%960;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const y=110+seed%780;if(x>130&&x<870&&y>140&&y<870)continue;g.fillStyle=i%3?'#122d43':'#b78227';g.beginPath();g.arc(x,y,7+seed%18,0,Math.PI*2);g.fill();}
  const size=Math.floor(700/(n+8)),origin=Math.floor((1000-(n+8)*size)/2);g.fillStyle='white';g.fillRect(origin,origin,(n+8)*size,(n+8)*size);g.fillStyle='black';for(let r=0;r<n;r++)for(let k=0;k<n;k++)if(qr.isDark(r,k))g.fillRect(origin+(k+4)*size,origin+(r+4)*size,size,size);
  g.font='24px sans-serif';g.fillText('20 × 20 cm · Centro = punto A',260,940);g.font='20px sans-serif';g.fillText(model.slice(0,8),440,976);return c;
 }
 el('ref-print').onclick=()=>{const c=plate();let print=document.getElementById('reference-print');if(!print){print=document.createElement('section');print.id='reference-print';document.body.append(print);}print.replaceChildren();const title=document.createElement('h2');title.textContent='AR-01 · Placa vertical de muro';const img=new Image();img.src=c.toDataURL();const note=document.createElement('p');note.textContent='Imprimir al 100%, sin ajustar. Verificar cuadrado de 200 × 200 mm. Colocar sobre la familia de Revit, a su misma altura y orientación. Para alternativa manual, B está a la derecha del centro, a '+new THREE.Vector3(...config.a).distanceTo(new THREE.Vector3(...config.b)).toFixed(3)+' m. Entrega '+model;print.append(title,img,note);img.onload=()=>{dialog.close();window.print();};};
 let xr=null,starting=false,hit=null,space=null,aReal=null,snapshot=null;
 const overlay=document.createElement('section');overlay.id='reference-overlay';overlay.hidden=true;overlay.innerHTML='<div class="ar-heading"><strong>AR-01 · Muro · 1:1</strong><button id="ref-exit">Salir</button></div><p id="ref-message" role="status"></p><div class="ar-actions"><button id="ref-place" disabled>Fijar A</button><button id="ref-reset">Realinear</button></div><p class="ar-note">Revisión visual. Verifica otro punto conocido. No usar para replanteo.</p>';document.body.append(overlay);
 const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x71869c,3));const anchor=new THREE.Group();anchor.matrixAutoUpdate=false;anchor.visible=false;scene.add(anchor);
 const reticle=new THREE.Mesh(new THREE.RingGeometry(.06,.08,24),new THREE.MeshBasicMaterial({color:0xe0b74f,side:THREE.DoubleSide}));reticle.matrixAutoUpdate=false;reticle.visible=false;scene.add(reticle);
 let posePoint=null,automatic=false,done=false;
 const message=t=>el('ref-message').textContent=t;
 function reset(){anchor.visible=false;aReal=null;done=false;el('ref-place').textContent='Fijar A';message(automatic?'Apunta a la placa completa, con buena luz.':'Apunta al centro A de la placa física y pulsa Fijar A.');}
 function cleanup(){hit?.cancel();hit=null;xr=null;starting=false;renderer.setAnimationLoop(null);overlay.hidden=true;document.body.classList.remove('ar-presenting');for(const o of [...anchor.children]){for(const m of [].concat(o.material))m.dispose();anchor.remove(o);}if(snapshot){camera.position.copy(snapshot.position);camera.quaternion.copy(snapshot.quaternion);controls.enabled=snapshot.enabled;snapshot=null;}redraw();}
 el('ref-exit').onclick=()=>xr?.end();el('ref-reset').onclick=reset;overlay.addEventListener('beforexrselect',e=>e.preventDefault());
 el('ref-place').onclick=()=>{if(!posePoint||automatic||done)return;if(!aReal){aReal=posePoint.clone();el('ref-place').textContent='Fijar B';message('Apunta al punto B del muro real, a la derecha y a la misma altura.');return;}const delta=posePoint.clone().sub(aReal),expected=new THREE.Vector3(...config.a).distanceTo(new THREE.Vector3(...config.b));if(delta.length()<.2||Math.abs(delta.y)>.10){message('B debe estar a la misma altura que A y separado al menos 20 cm.');return;}if(Math.abs(delta.length()-expected)>Math.max(.10,expected*.1)){message('La distancia A–B no coincide con el modelo. Realinea y revisa ambos puntos.');return;}anchor.matrix.copy(wallMatrix(aReal,posePoint));anchor.visible=true;done=true;reticle.visible=false;message('Alineación manual aplicada. Verifica con otro punto; usa Realinear si se desplaza.');};
 async function start(auto){if(starting||xr)return;if(!isReady()||!config){say('Carga el modelo y define la referencia primero.');return;}if(!isSecureContext||!navigator.xr){say('Necesitas Chrome en un dispositivo AR compatible y HTTPS.');return;}starting=true;automatic=auto;try{const options={requiredFeatures:['dom-overlay',auto?'image-tracking':'hit-test'],domOverlay:{root:overlay}};let bitmap;if(auto){bitmap=await createImageBitmap(plate());options.trackedImages=[{image:bitmap,widthInMeters:config.width}];}let next;try{next=await navigator.xr.requestSession('immersive-ar',options);}finally{bitmap?.close();}xr=next;next.addEventListener('end',cleanup,{once:true});snapshot={position:camera.position.clone(),quaternion:camera.quaternion.clone(),enabled:controls.enabled};controls.enabled=false;modelGroup.updateWorldMatrix(true,true);const inverse=referenceInverse(config);modelGroup.traverse(o=>{if(!o.isMesh||!o.visible)return;const clone=new THREE.Mesh(o.geometry,Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone());for(const m of [].concat(clone.material)){m.clippingPlanes=[];m.emissive?.set(0);}clone.applyMatrix4(inverse.clone().multiply(o.matrixWorld));anchor.add(clone);});if(!anchor.children.length)throw Error('No hay geometría visible.');overlay.hidden=false;dialog.close();document.body.classList.add('ar-presenting');el('ref-place').hidden=auto;reset();renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local');await renderer.xr.setSession(next);space=await next.requestReferenceSpace('local');if(auto){if(!next.getTrackedImageScores)throw Error('El navegador no ofrece seguimiento de la placa. Usa AR por dos puntos.');const scores=await next.getTrackedImageScores();if(scores[0]==='untrackable')throw Error('El dispositivo no reconoce esta placa como rastreable. Usa AR por dos puntos.');}else{hit=await next.requestHitTestSource({space:await next.requestReferenceSpace('viewer')});}
 renderer.setAnimationLoop((time,frame)=>{if(frame){if(auto){const result=frame.getImageTrackingResults?.().find(r=>r.index===0&&r.trackingState==='tracked'),pose=result&&frame.getPose(result.imageSpace,space);anchor.visible=!!pose;if(pose){anchor.matrix.fromArray(pose.transform.matrix);message('Placa reconocida · modelo a 1:1. Mantén la placa visible.');}else message('Sin seguimiento de la placa. Modelo oculto hasta recuperarlo.');}else if(!done){const p=frame.getHitTestResults(hit)[0]?.getPose(space);posePoint=p?new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(p.transform.matrix)):null;el('ref-place').disabled=!p;reticle.visible=!!p;if(p){reticle.matrix.fromArray(p.transform.matrix);reticle.matrix.multiply(new THREE.Matrix4().makeRotationX(-Math.PI/2));}}}renderer.render(scene,camera);});
 }catch(e){if(xr)try{await xr.end();}catch{cleanup();}else cleanup();dialog.showModal();say('No se pudo iniciar '+(auto?'el reconocimiento automático':'AR')+': '+e.message+(auto?' Prueba «AR por dos puntos».':''));}}
 el('ref-auto').onclick=()=>start(true);el('ref-manual').onclick=()=>start(false);
 if(params.get('ar')==='reference')setup.click();
 return {pick:()=>false,isPicking:()=>false,modelReady:()=>{config=null;enable(false);if(dialog.open)refresh();}};
}
