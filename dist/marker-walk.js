import * as THREE from 'three';
import {boardIds} from './marker-board.js';
import {referenceInverse} from './reference-math.js';
import {cameraIntrinsics,createCameraReader} from './xr-camera-reader.js';
import {MarkerAnchorState} from './marker-anchor-state.js';

export function createMarkerWalk({modelGroup,project,model}){
 const overlay=document.createElement('section');overlay.id='marker-walk';overlay.hidden=true;
 overlay.innerHTML='<div class="walk-heading"><strong>GEEINCO · Recorrido AR</strong><button id="walk-exit">Salir</button></div><p id="walk-status" role="status">Preparando seguimiento…</p><div class="walk-actions"><button id="walk-realign">Volver a alinear</button><label>Transparencia <input id="walk-opacity" type="range" min="15" max="90" value="55"></label><small>Primero enfoca los cuatro marcadores. Espera «Modelo fijado» antes de caminar. El anclaje dura esta sesión; comprueba la coincidencia al cambiar de zona.</small></div>';
 document.body.append(overlay);const el=id=>overlay.querySelector('#'+id),say=t=>el('walk-status').textContent=t;
 const state=new MarkerAnchorState(),ids=boardIds(project,model);
 let session=null,starting=false,renderer=null,reader=null,worker=null,binding=null,space=null,scene=null,group=null,anchor=null,creating=false,materials=[],pending=null,captureId=0,generation=0,lastCapture=0,lastGood=0,startedAt=0;
 function reset(){generation++;anchor?.delete();anchor=null;creating=false;state.reset();lastGood=0;if(group)group.visible=false;say('Enfoca la nueva placa completa y mantén el teléfono estable.');}
 function cleanup(){generation++;session=null;starting=false;anchor?.delete();anchor=null;worker?.terminate();worker=null;pending=null;creating=false;state.reset();renderer?.setAnimationLoop(null);reader?.dispose();reader=null;for(const m of materials)m.dispose();materials=[];renderer?.dispose();renderer?.forceContextLoss();renderer?.domElement.remove();renderer=null;scene=null;group=null;overlay.hidden=true;}
 async function stop(){if(session){try{await session.end();}catch{cleanup();}}else cleanup();}
 el('walk-exit').onclick=stop;el('walk-realign').onclick=reset;
 overlay.addEventListener('beforexrselect',e=>e.preventDefault());window.addEventListener('pagehide',stop);
 el('walk-opacity').oninput=()=>{for(const m of materials)m.opacity=Number(el('walk-opacity').value)/100;};
 async function start(config){
  if(starting||session)return;starting=true;
  try{
   if(!isSecureContext||!navigator.xr)throw Error('Este navegador no ofrece seguimiento AR. Abre Chrome en el Fold7 mediante HTTPS.');
   // The request stays in the user's click. Do not open getUserMedia beforehand.
   const next=await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['camera-access','anchors','dom-overlay'],domOverlay:{root:overlay}});
   if(!starting){await next.end();return;}session=next;next.addEventListener('end',cleanup,{once:true});
   renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});renderer.setClearColor(0,0);renderer.domElement.style.display='none';document.body.append(renderer.domElement);
   renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local');await renderer.xr.setSession(next);space=renderer.xr.getReferenceSpace();
   space.addEventListener('reset',()=>{if(!anchor){generation++;state.reset();creating=false;lastGood=0;} });
   const gl=renderer.getContext();binding=new XRWebGLBinding(next,gl);if(!binding.getCameraImage)throw Error('El navegador no ofrece cámara sincronizada con el seguimiento AR.');reader=createCameraReader(gl);
   scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x71869c,3));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(2,4,3);scene.add(sun);group=new THREE.Group();group.matrixAutoUpdate=false;group.visible=false;scene.add(group);
   modelGroup.updateWorldMatrix(true,true);const inverse=referenceInverse(config);
   modelGroup.traverse(o=>{if(!o.isMesh||!o.visible||o.userData.id===config.elementId)return;const mats=[].concat(o.material).map(m=>{const c=m.clone();c.clippingPlanes=[];c.emissive?.set(0);c.transparent=true;c.opacity=Number(el('walk-opacity').value)/100;c.depthWrite=false;materials.push(c);return c;});const mesh=new THREE.Mesh(o.geometry,Array.isArray(o.material)?mats:mats[0]);mesh.applyMatrix4(inverse.clone().multiply(o.matrixWorld));group.add(mesh);});
   if(!group.children.length)throw Error('No hay elementos visibles en el modelo.');
   worker=new Worker(new URL('./marker-worker.js',import.meta.url),{type:'module'});
   worker.onmessage=({data})=>{
    const captured=pending;if(!captured||data.frame!==captured.id)return;pending=null;
    if(!session||captured.generation!==generation||anchor||creating)return;
    if(!data.ok){state.reset();say(`Marcadores ${data.count}/4 · enfoca la placa completa, con buena luz.`);return;}
    if(performance.now()-captured.time>700){state.reset();say('Acerca la placa y mantén el teléfono estable.');return;}
    lastGood=performance.now();state.observe(data.matrix,captured.view);
    say(state.ready?'4/4 · Creando anclaje espacial…':`4/4 · Estabilizando ${state.samples}/6…`);
   };
   worker.onerror=()=>{state.reset();pending={id:-1};say('Falló el reconocimiento. Sal y vuelve a abrir Recorrido AR.');};
   overlay.hidden=false;starting=false;startedAt=performance.now();reset();const camera=new THREE.PerspectiveCamera();
   renderer.setAnimationLoop((time,frame)=>{
    if(!session||!frame)return;
    try{
     const viewer=frame.getViewerPose(space);
     if(!viewer||viewer.emulatedPosition||session.visibilityState!=='visible'){
      group.visible=false;if(!anchor){state.reset();creating=false;generation++;}say('Seguimiento espacial perdido · mueve lentamente el teléfono para recuperarlo.');renderer.render(scene,camera);return;
     }
     if(anchor){
      const pose=frame.getPose(anchor.anchorSpace,space);group.visible=!!pose&&!pose.emulatedPosition;
      if(group.visible){group.matrix.fromArray(pose.transform.matrix);group.matrixWorldNeedsUpdate=true;say('Modelo fijado · puedes recorrer sin mantener el QR a la vista.');}
      else say('Recuperando seguimiento del entorno · el anclaje sigue guardado en esta sesión.');
     }else if(!creating&&state.ready&&performance.now()-lastGood<500){
      creating=true;const token=generation,position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();state.candidate.decompose(position,rotation,scale);
      frame.createAnchor(new XRRigidTransform({x:position.x,y:position.y,z:position.z},{x:rotation.x,y:rotation.y,z:rotation.z,w:rotation.w}),space).then(result=>{
       if(!session||token!==generation){result.delete();return;}anchor=result;creating=false;state.reset();say('Anclaje creado · comprobando seguimiento…');
      }).catch(e=>{if(token!==generation)return;creating=false;state.reset();say('No se pudo fijar el modelo: '+e.message+'. Vuelve a enfocar la placa.');});
     }else if(!creating&&!pending&&time-lastCapture>120){
      const view=viewer.views.find(v=>v.camera);if(!view){if(performance.now()-startedAt>5000)say('AR abrió, pero el navegador no entrega imágenes para reconocer la placa.');}
      else{
       const texture=binding.getCameraImage(view.camera);if(texture){
        const image=reader.read(texture,view.camera.width,view.camera.height),intrinsics=cameraIntrinsics(view.projectionMatrix,image.width,image.height);
        pending={id:++captureId,view:Array.from(view.transform.matrix),generation,time:performance.now()};lastCapture=time;
        worker.postMessage({buffer:image.pixels.buffer,width:image.width,height:image.height,focal:intrinsics.fx,intrinsics,ids,frame:pending.id},[image.pixels.buffer]);
       }
      }
     }
     renderer.render(scene,camera);
    }catch(e){group.visible=false;state.reset();say('No se pudo continuar el recorrido: '+e.message);renderer.setAnimationLoop(null);}
   });
  }catch(e){await stop();throw Error(e.name==='NotSupportedError'?'Este navegador no admite juntas cámara AR y anclajes. No se puede fijar el modelo para recorrer en esta configuración.':e.name==='NotAllowedError'?'Autoriza la cámara y la realidad aumentada para iniciar el recorrido.':e.message);}
 }
 return {start,stop};
}
