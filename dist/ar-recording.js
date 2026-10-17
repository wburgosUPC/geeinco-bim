import * as THREE from 'three';

// Record a composition of camera pixels and model, never the transparent XR layer alone.
export function createARRecording(host){
 const bar=document.createElement('div');bar.className='ar-recording';
 const button=document.createElement('button'),message=document.createElement('span');button.textContent='Grabar video';button.type='button';button.disabled=true;message.setAttribute('role','status');bar.append(button,message);host.append(bar);
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 let recorder=null,stream=null,chunks=[],started=0,last=0,timer=null,ready=false,finishing=false,recordRenderer=null,recordCamera=null;
 const supported=typeof MediaRecorder!=='undefined'&&typeof canvas.captureStream==='function';
 message.textContent=supported?'Video sin audio · máximo 2 minutos por clip.':'Grabación no disponible en este navegador. Usa la grabación de pantalla del teléfono.';
 function available(value){if(value&&!ready&&!recorder&&supported)message.textContent="Video sin audio · máximo 2 minutos por clip.";ready=value;button.disabled=!supported||!ready||finishing;if(!value&&!recorder&&supported)message.textContent='El navegador debe entregar la imagen de cámara para grabar cámara + modelo.';}
 function stop(){clearTimeout(timer);timer=null;if(recorder?.state==='recording'){finishing=true;button.disabled=true;message.textContent='Preparando video…';recorder.stop();}}
 function saveClip(blob){
  if(!blob.size){message.textContent='El video no contiene imágenes. Vuelve a intentarlo.';return;}
  const url=URL.createObjectURL(blob),name='GEEINCO-AR-'+new Date().toISOString().replace(/[:.]/g,'-')+(blob.type.includes('mp4')?'.mp4':'.webm');
  const link=document.createElement('a');link.href=url;link.download=name;link.textContent='Descargar video ('+(blob.size/1048576).toFixed(1)+' MB)';bar.append(link);
  let gallery=document.getElementById('ar-recordings');if(!gallery){gallery=document.createElement('aside');gallery.id='ar-recordings';gallery.setAttribute('aria-label','Videos AR grabados');gallery.innerHTML='<strong>Videos AR listos</strong><span>Descárgalos antes de cerrar o recargar esta página.</span>';document.body.append(gallery);}
  const copy=link.cloneNode(true);gallery.append(copy);
  message.textContent='Video listo. Pulsa Descargar video para guardarlo en tu dispositivo.';
 }
 button.onclick=()=>{
  if(recorder?.state==='recording'){stop();return;}if(!ready||!supported||finishing)return;
  try{
   const mime=['video/webm;codecs=vp8','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
   canvas.width=960;canvas.height=540;ctx.fillStyle='#142d3f';ctx.fillRect(0,0,960,540);stream=canvas.captureStream(15);chunks=[];
   recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:2500000});
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   recorder.onerror=()=>{message.textContent='La grabación se interrumpió. Guarda el clip si está disponible.';stop();};
   recorder.onstop=()=>{const blob=new Blob(chunks,{type:recorder.mimeType||mime||'video/webm'});stream?.getTracks().forEach(t=>t.stop());stream=null;chunks=[];recorder=null;finishing=false;button.textContent='Grabar video';button.disabled=!ready;saveClip(blob);};
   started=performance.now();last=0;recorder.start(1000);button.textContent='Detener video';message.textContent='● Grabando · sin audio';timer=setTimeout(stop,120000);
  }catch(e){stream?.getTracks().forEach(t=>t.stop());stream=null;recorder=null;message.textContent='No se pudo grabar: '+e.message;}
 };
 function due(time){return recorder?.state==='recording'&&time-last>=1000/15;}
 function compose(base,model,w,h,time){
  // Keep output dimensions constant if the device rotates; fit both layers together.
  ctx.fillStyle='#142d3f';ctx.fillRect(0,0,canvas.width,canvas.height);const scale=Math.min(canvas.width/w,canvas.height/h),dw=w*scale,dh=h*scale,x=(canvas.width-dw)/2,y=(canvas.height-dh)/2;
  ctx.drawImage(base,x,y,dw,dh);ctx.drawImage(model,x,y,dw,dh);ctx.fillStyle='#102c40cc';ctx.fillRect(0,canvas.height-28,canvas.width,28);ctx.fillStyle='white';ctx.font='14px sans-serif';ctx.fillText('GEEINCO · Revisión AR · '+new Date().toLocaleString('es-PE'),12,canvas.height-9);last=time;message.textContent='● Grabando · '+Math.floor((time-started)/1000)+' s · sin audio';
 }
 function frame2D(video,model,time){available(video.readyState>=2);if(!due(time))return;try{compose(video,model,video.videoWidth,video.videoHeight,time);}catch(e){message.textContent='No se pudo capturar el video: '+e.message;stop();}}
 const cameraCanvas=document.createElement('canvas'),cameraCtx=cameraCanvas.getContext('2d');
 function frameXR({frame,space,scene,binding,reader,time}){
  const view=frame?.getViewerPose(space)?.views.find(v=>v.camera);available(!!view&&!!binding?.getCameraImage&&!!reader);if(!due(time)||!ready)return;
  try{
   const texture=binding.getCameraImage(view.camera);if(!texture)return;
   const image=reader.read(texture,view.camera.width,view.camera.height);cameraCanvas.width=image.width;cameraCanvas.height=image.height;cameraCtx.putImageData(new ImageData(new Uint8ClampedArray(image.pixels.buffer),image.width,image.height),0,0);
   if(!recordRenderer){recordRenderer=new THREE.WebGLRenderer({alpha:true,antialias:false});recordRenderer.setPixelRatio(1);recordRenderer.setClearColor(0,0);recordCamera=new THREE.PerspectiveCamera();recordCamera.matrixAutoUpdate=false;}
   recordRenderer.setSize(image.width,image.height,false);recordCamera.projectionMatrix.fromArray(view.projectionMatrix);recordCamera.projectionMatrixInverse.copy(recordCamera.projectionMatrix).invert();recordCamera.matrix.fromArray(view.transform.matrix);recordCamera.matrixWorldNeedsUpdate=true;recordRenderer.render(scene,recordCamera);
   compose(cameraCanvas,recordRenderer.domElement,image.width,image.height,time);
  }catch(e){stop();available(false);message.textContent='Este navegador no permite grabar la cámara AR: '+e.message;}
 }
 function cleanup(){stop();ready=false;button.disabled=true;recordRenderer?.dispose();recordRenderer?.forceContextLoss();recordRenderer=null;recordCamera=null;}
 window.addEventListener('pagehide',cleanup);
 return {frame2D,frameXR,cleanup,stop};
}
