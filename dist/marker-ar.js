import * as THREE from 'three';
import {boardIds} from './marker-board.js';
import {referenceInverse} from './reference-math.js';

// Camera-based tracking, independent of WebXR's experimental image-tracking API.
export function createMarkerAR({modelGroup,project,model,onExit,acquireCamera=constraints=>navigator.mediaDevices.getUserMedia(constraints)}){
 let active=false,starting=false,stream=null,worker=null,raf=0,renderer=null,scene=null,anchor=null,materials=[],pending=false,lastResult=0,stable=0;
 let frame=0,frameTime=0,focalRatio=.9,calibrated=false,calibrationKey='',lastCorners=null;
 const host=document.createElement('section');host.id='marker-ar';host.hidden=true;
 host.innerHTML='<div class="marker-stage"><video autoplay muted playsinline></video><div class="marker-render"></div><canvas class="marker-guides"></canvas></div><div class="marker-controls"><div><strong>GEEINCO · AR con 4 marcadores</strong><button type="button" id="marker-exit">Salir</button></div><p id="marker-status" role="status">Iniciando cámara…</p><label>Transparencia del modelo <input id="marker-opacity" type="range" min="15" max="90" value="55"></label><details><summary>Ajuste de cámara</summary><p>La profundidad usa una cámara aproximada hasta calibrarla. Para calibrar: placa de frente, cuatro marcadores visibles; mide desde la cámara al centro de la placa.</p><label>Distancia en cm <input id="marker-distance" type="number" min="20" max="200" value="50"></label><button id="marker-calibrate" type="button">Calibrar a esta distancia</button><p id="marker-calibration">Cámara aproximada · verifica otro punto de obra.</p></details><small>Mantén los 4 marcadores visibles. Si se pierde la placa se oculta el modelo. Revisión visual, no replanteo. Video procesado en este teléfono.</small></div>';
 document.body.append(host);const el=id=>host.querySelector('#'+id),video=host.querySelector('video'),stage=host.querySelector('.marker-stage'),guides=host.querySelector('.marker-guides'),guide=guides.getContext('2d');
 const capture=document.createElement('canvas'),ctx=capture.getContext('2d',{willReadFrequently:true});
 const camera=new THREE.PerspectiveCamera(60,1,.02,2000),ids=boardIds(project,model);
 const message=t=>{el('marker-status').textContent=t;};
 function hide(){if(anchor)anchor.visible=false;stable=0;lastCorners=null;guide.clearRect(0,0,guides.width,guides.height);}
 function cleanup(){active=false;starting=false;cancelAnimationFrame(raf);stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;worker?.terminate();worker=null;pending=false;for(const m of materials)m.dispose();materials=[];renderer?.dispose();renderer?.forceContextLoss();renderer=null;host.querySelector('.marker-render').replaceChildren();anchor=null;scene=null;host.hidden=true;document.body.classList.remove('marker-presenting');onExit?.();}
 el('marker-exit').onclick=cleanup;
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&(active||starting))cleanup();});
 window.addEventListener('pagehide',cleanup);
 el('marker-opacity').oninput=()=>{for(const m of materials)m.opacity=Number(el('marker-opacity').value)/100;};
 el('marker-calibrate').onclick=()=>{
  if(!lastCorners||performance.now()-lastResult>500){el('marker-calibration').textContent='Necesitas los cuatro marcadores visibles para calibrar.';return;}
  const distance=Number(el('marker-distance').value)/100;
  const tl=lastCorners[0][0],tr=lastCorners[1][1],br=lastCorners[2][2],bl=lastCorners[3][3],len=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const widths=[len(tl,tr),len(bl,br)],heights=[len(tl,bl),len(tr,br)],values=[...widths,...heights];
  if(!(distance>=.2&&distance<=2)||Math.max(...values)/Math.min(...values)>1.08){el('marker-calibration').textContent='Coloca la cámara de frente a la placa y revisa la distancia (20 a 200 cm).';return;}
  const ratio=values.reduce((a,b)=>a+b,0)/4*distance/.188/Math.max(capture.width,capture.height);
  if(ratio<.4||ratio>2){el('marker-calibration').textContent='Distancia incompatible; revisa la medida y la impresión de 20 cm.';return;}
  focalRatio=ratio;calibrated=true;try{localStorage.setItem(calibrationKey,String(ratio));}catch{}
  hide();el('marker-calibration').textContent='Calibración guardada para esta cámara y resolución. Verifica otro punto conocido.';
 };
 function fit(){
  const w=video.videoWidth,h=video.videoHeight;if(!w||!h)return;
  const factor=Math.min(innerWidth/w,innerHeight/h),cw=Math.round(w*factor),ch=Math.round(h*factor);
  Object.assign(stage.style,{width:cw+'px',height:ch+'px',left:((innerWidth-cw)/2)+'px',top:((innerHeight-ch)/2)+'px'});
  if(renderer&&(renderer.domElement.width!==Math.round(cw*renderer.getPixelRatio())||renderer.domElement.height!==Math.round(ch*renderer.getPixelRatio())))renderer.setSize(cw,ch);
  const scale=Math.min(1,960/Math.max(w,h)),pw=Math.round(w*scale),ph=Math.round(h*scale);
  if(capture.width!==pw||capture.height!==ph){capture.width=pw;capture.height=ph;guides.width=pw;guides.height=ph;hide();}
  camera.aspect=pw/ph;camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(ph/(2*focalRatio*Math.max(pw,ph))));camera.updateProjectionMatrix();
 }
 function loop(now){
  if(!active)return;raf=requestAnimationFrame(loop);fit();
  if(now-lastResult>450&&anchor.visible){hide();message('Referencia perdida · vuelve a enfocar los 4 marcadores.');}
  if(video.readyState>=2&&!pending&&capture.width&&now-frameTime>80){
   frameTime=now;ctx.drawImage(video,0,0,capture.width,capture.height);const image=ctx.getImageData(0,0,capture.width,capture.height);pending=true;
   worker.postMessage({buffer:image.data.buffer,width:capture.width,height:capture.height,focal:focalRatio*Math.max(capture.width,capture.height),ids,frame:++frame},[image.data.buffer]);
  }
  renderer.render(scene,camera);
 }
 async function start(config){
  if(active||starting)return;starting=true;host.hidden=false;document.body.classList.add('marker-presenting');message('Solicitando cámara trasera…');
  try{
   if(!isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Abre el visor mediante HTTPS en Chrome.');
   const requested=await acquireCamera({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
   if(!starting){requested.getTracks().forEach(t=>t.stop());return;}stream=requested;video.srcObject=stream;await video.play();if(!starting)return;
   const track=stream.getVideoTracks()[0],settings=track.getSettings();track.addEventListener('ended',()=>{if(active)cleanup();},{once:true});calibrationKey=`geeinco-camera-v1:${settings.deviceId||track.label}:${video.videoWidth}x${video.videoHeight}`;
   let stored=0;try{stored=Number(localStorage.getItem(calibrationKey));}catch{}calibrated=stored>=.4&&stored<=2;focalRatio=calibrated?stored:.9;
   el('marker-calibration').textContent=calibrated?'Calibración guardada aplicada.':'Cámara aproximada · verifica otro punto de obra.';
   renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0,0);host.querySelector('.marker-render').append(renderer.domElement);
   scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x71869c,3));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(2,4,3);scene.add(light);anchor=new THREE.Group();anchor.matrixAutoUpdate=false;anchor.visible=false;scene.add(anchor);
   modelGroup.updateWorldMatrix(true,true);const inverse=referenceInverse(config);
   modelGroup.traverse(o=>{if(!o.isMesh||!o.visible||o.userData.id===config.elementId)return;const cloned=[].concat(o.material).map(m=>{const c=m.clone();c.clippingPlanes=[];c.emissive?.set(0);c.transparent=true;c.opacity=Number(el('marker-opacity').value)/100;c.depthWrite=false;materials.push(c);return c;});const mesh=new THREE.Mesh(o.geometry,Array.isArray(o.material)?cloned:cloned[0]);mesh.applyMatrix4(inverse.clone().multiply(o.matrixWorld));anchor.add(mesh);});
   if(!anchor.children.length)throw Error('No hay elementos visibles para mostrar.');
   worker=new Worker(new URL('./marker-worker.js',import.meta.url),{type:'module'});
   worker.onerror=()=>{hide();message('No se pudo cargar el reconocimiento. Sal y recarga el visor.');worker?.terminate();pending=true;};
   worker.onmessage=({data})=>{pending=false;if(!active)return;if(data.width!==capture.width||data.height!==capture.height){hide();return;}lastResult=performance.now();
    if(!data.ok){hide();message(data.reason==='small'?'Acércate: la placa es demasiado pequeña en la imagen.':data.reason==='unstable'?'Mantén la placa plana, enfoca y evita reflejos.':`Marcadores ${data.count}/4 · enfoca la placa NUEVA completa, impresa a 20 × 20 cm.`);return;}
    lastCorners=data.corners;guide.clearRect(0,0,guides.width,guides.height);guide.strokeStyle='#d8b566';guide.lineWidth=2;for(const corners of data.corners){guide.beginPath();corners.forEach((p,i)=>i?guide.lineTo(p.x,p.y):guide.moveTo(p.x,p.y));guide.closePath();guide.stroke();}
    anchor.matrix.fromArray(data.matrix);anchor.matrixWorldNeedsUpdate=true;anchor.visible=++stable>=3;message(anchor.visible?`4/4 · Modelo alineado con la placa · ${calibrated?'cámara calibrada':'profundidad aproximada'}`:'4/4 · Estabilizando…');
   };
   active=true;starting=false;stable=0;lastResult=performance.now();message('Enfoca los cuatro marcadores de la nueva placa.');raf=requestAnimationFrame(loop);
  }catch(e){cleanup();throw Error(e.name==='NotAllowedError'?'Permite la cámara para alinear con la placa.':e.message);}
 }
 return {start,stop:cleanup};
}
