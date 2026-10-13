import * as THREE from 'three';

export function installAR({renderer,camera,controls,modelGroup,isReady,status,redraw}){
 const button=document.getElementById('ar-start');
 const overlay=document.createElement('section');overlay.id='ar-overlay';overlay.hidden=true;overlay.setAttribute('aria-label','Controles de realidad aumentada');
 overlay.innerHTML='<div class="ar-heading"><strong>GEEINCO · Realidad aumentada</strong><button id="ar-exit" type="button">Salir de AR</button></div><p id="ar-message" role="status">Mueve lentamente el teléfono para buscar una superficie.</p><div class="ar-actions"><button id="ar-place" type="button" disabled>Colocar aquí</button><button id="ar-reset" type="button" disabled>Reubicar</button><label>Escala<select id="ar-scale"><option value="0.01">Maqueta · 1:100</option><option value="0.02">Maqueta · 1:50</option><option value="0.1">Detalle · 1:10</option><option value="1">Tamaño real · 1:1</option></select></label><label>Giro<input id="ar-yaw" type="range" min="-180" max="180" value="0" step="1"></label></div><p class="ar-note">Alineación manual para revisión visual. No usar como replanteo ni medición de precisión.</p>';
 document.body.append(overlay);const el=id=>document.getElementById(id);let session=null,starting=false,hitSource=null,reference=null,placed=false,validHit=false,snapshot=null;
 const arScene=new THREE.Scene();arScene.add(new THREE.HemisphereLight(0xffffff,0x71869c,2.5));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(2,5,2);arScene.add(sun);
 const anchor=new THREE.Group(),content=new THREE.Group();anchor.add(content);arScene.add(anchor);anchor.visible=false;
 const reticle=new THREE.Mesh(new THREE.RingGeometry(.08,.1,32).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0xe0bd72,side:THREE.DoubleSide}));reticle.matrixAutoUpdate=false;reticle.visible=false;arScene.add(reticle);
 const setMessage=m=>{el('ar-message').textContent=m;};
 function reset(){placed=false;validHit=false;anchor.visible=false;reticle.visible=false;el('ar-place').disabled=true;el('ar-reset').disabled=true;setMessage('Apunta al suelo y mueve lentamente el teléfono hasta ver el aro dorado.');}
 function clearModel(){for(const child of [...content.children]){child.traverse(o=>{if(o.material)for(const m of [].concat(o.material))m.dispose();});content.remove(child);}}
 function restore(){hitSource?.cancel();hitSource=null;reference=null;renderer.setAnimationLoop(null);session=null;starting=false;overlay.hidden=true;document.body.classList.remove('ar-presenting');anchor.visible=false;reticle.visible=false;clearModel();if(snapshot){camera.position.copy(snapshot.position);camera.quaternion.copy(snapshot.quaternion);camera.projectionMatrix.copy(snapshot.projection);camera.projectionMatrixInverse.copy(snapshot.projection).invert();controls.enabled=snapshot.controlsEnabled;snapshot=null;}button.disabled=!isReady();redraw();}
 overlay.addEventListener('beforexrselect',e=>e.preventDefault());
 el('ar-place').onclick=()=>{if(!validHit||placed)return;anchor.position.setFromMatrixPosition(reticle.matrix);anchor.visible=true;placed=true;reticle.visible=false;el('ar-place').disabled=true;el('ar-reset').disabled=false;setMessage('Modelo colocado. Ajusta el giro y la escala; usa Reubicar para moverlo a otro punto.');};
 el('ar-reset').onclick=reset;
 el('ar-scale').onchange=()=>anchor.scale.setScalar(Number(el('ar-scale').value));
 el('ar-yaw').oninput=()=>anchor.rotation.y=THREE.MathUtils.degToRad(Number(el('ar-yaw').value));
 el('ar-exit').onclick=()=>{session?.end().catch(()=>setMessage('No se pudo cerrar AR. Usa el control de salida del navegador.'));};
 button.onclick=async()=>{
  if(starting||session||!isReady())return;
  if(!window.isSecureContext){status('AR necesita una dirección HTTPS. El portal local todavía no está publicado para tu celular.');return;}
  if(!navigator.xr){status('Este navegador no ofrece AR. En el Galaxy Z Fold7 usa Chrome actualizado y Servicios de Google Play para RA.');return;}
  starting=true;button.disabled=true;status('Solicitando sesión AR al navegador…');
  try{
   const next=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['hit-test','dom-overlay'],domOverlay:{root:overlay}});session=next;next.addEventListener('end',restore,{once:true});
   snapshot={position:camera.position.clone(),quaternion:camera.quaternion.clone(),projection:camera.projectionMatrix.clone(),controlsEnabled:controls.enabled};controls.enabled=false;
   content.position.set(0,0,0);content.updateMatrixWorld(true);modelGroup.updateWorldMatrix(true,true);const bounds=new THREE.Box3();
   modelGroup.traverse(o=>{if(!o.isMesh||!o.visible)return;const clone=new THREE.Mesh(o.geometry,Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone());for(const m of [].concat(clone.material)){m.clippingPlanes=[];if(m.emissive)m.emissive.set(0);}clone.applyMatrix4(o.matrixWorld);content.add(clone);bounds.expandByObject(clone);});
   if(bounds.isEmpty())throw Error('No hay elementos visibles para mostrar en AR.');
   const center=bounds.getCenter(new THREE.Vector3());content.position.set(-center.x,-bounds.min.y,-center.z);anchor.rotation.set(0,0,0);anchor.scale.setScalar(.01);el('ar-scale').value='0.01';el('ar-yaw').value='0';reset();
   overlay.hidden=false;document.body.classList.add('ar-presenting');renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local');await renderer.xr.setSession(next);
   reference=await next.requestReferenceSpace('local');const viewer=await next.requestReferenceSpace('viewer');hitSource=await next.requestHitTestSource({space:viewer});
   renderer.setAnimationLoop((time,frame)=>{if(frame&&hitSource&&!placed){const hits=frame.getHitTestResults(hitSource);const pose=hits[0]?.getPose(reference);validHit=!!pose;reticle.visible=validHit;el('ar-place').disabled=!validHit;if(pose)reticle.matrix.fromArray(pose.transform.matrix);}renderer.render(arScene,camera);});
  }catch(e){const message=e.name==='NotAllowedError'?'Permiso de realidad aumentada denegado. Puedes volver a intentarlo.':'No se pudo iniciar AR: '+e.message;if(session){try{await session.end();}catch{restore();}}else restore();status(message);window.alert(message);}
 };
}

