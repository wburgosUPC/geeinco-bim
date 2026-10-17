import * as THREE from 'three';

export function installWalk({camera,controls,renderer,modelGroup,isReady,render,status}){
 let active=false,placing=false,saved=null,drag=null,frame=0,last=0,yaw=0,pitch=0;
 const keys=new Set(),held=new Set(),canvas=renderer.domElement;
 const button=document.createElement('button');button.textContent='Modo caminata';button.setAttribute('aria-pressed','false');document.querySelector('.viewer-panels').append(button);
 canvas.tabIndex=0;
 const panel=document.createElement('section');panel.className='walk-panel';panel.hidden=true;panel.setAttribute('aria-label','Controles de caminata');
 panel.innerHTML='<strong>Recorrido virtual</strong><span>Arrastra para mirar · W A S D o flechas para caminar · Esc para salir. Sin colisiones: puedes atravesar muros.</span><div class="walk-settings"><button data-action="place">Elegir punto de inicio</button><label>Velocidad <select aria-label="Velocidad de caminata"><option value="0.5">Lenta · 0.5 m/s</option><option value="1.4" selected>Normal · 1.4 m/s</option><option value="3">Rápida · 3 m/s</option></select></label><label>Altura de ojos <input aria-label="Altura de ojos en metros" type="number" min="0.5" max="3" step="0.1" value="1.65"> m</label><button data-action="exit">Salir de caminata</button></div><div class="walk-pad"><button data-move="left" aria-label="Caminar a la izquierda">◀</button><button data-move="forward" aria-label="Caminar hacia adelante">▲</button><button data-move="back" aria-label="Caminar hacia atrás">▼</button><button data-move="right" aria-label="Caminar a la derecha">▶</button><button data-move="up" aria-label="Subir altura">Subir</button><button data-move="down" aria-label="Bajar altura">Bajar</button></div><p role="status"></p>';
 document.getElementById('viewport').append(panel);
 const hint=panel.querySelector('[role=status]'),speed=panel.querySelector('select'),height=panel.querySelector('input');
 let eye=1.65,standing=false;
 const editable=e=>e.target?.closest?.('input,select,textarea,[contenteditable=true],dialog[open]');
 function angles(){const e=new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ');yaw=e.y;pitch=Math.max(-1.45,Math.min(1.45,e.x));}
 function orient(){camera.quaternion.setFromEuler(new THREE.Euler(pitch,yaw,0,'YXZ'));controls.target.copy(camera.position).add(new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion));}
 function stop(){keys.clear();held.clear();drag=null;last=0;}
 function exit(){if(!active)return;active=false;placing=false;stop();cancelAnimationFrame(frame);frame=0;panel.hidden=true;button.setAttribute('aria-pressed','false');canvas.style.cursor='';camera.position.copy(saved.position);camera.quaternion.copy(saved.rotation);controls.target.copy(saved.target);controls.enabled=saved.enabled;controls.update();render();status('Vista orbital restaurada.');}
 function tick(time){if(!active)return;const dt=last?Math.min((time-last)/1000,.05):0;last=time;
  if(document.hidden||document.querySelector('dialog[open]')){stop();frame=requestAnimationFrame(tick);return;}
  const has=(name,...codes)=>held.has(name)||codes.some(c=>keys.has(c));
  const x=Number(has('right','KeyD','ArrowRight'))-Number(has('left','KeyA','ArrowLeft'));
  const z=Number(has('forward','KeyW','ArrowUp'))-Number(has('back','KeyS','ArrowDown'));
  const y=Number(has('up','KeyE'))-Number(has('down','KeyQ'));
  if(!placing&&(x||z||y)){const v=new THREE.Vector3(Math.cos(yaw)*x-Math.sin(yaw)*z,y,-Math.sin(yaw)*x-Math.cos(yaw)*z).normalize();camera.position.addScaledVector(v,Number(speed.value)*dt);orient();render();}
  frame=requestAnimationFrame(tick);
 }
 function start(){if(!isReady()||renderer.xr.isPresenting){status('Espera a que cargue el IFC y sal de AR para iniciar la caminata.');return;}
  controls.update();saved={position:camera.position.clone(),rotation:camera.quaternion.clone(),target:controls.target.clone(),enabled:controls.enabled};controls.enabled=false;active=true;placing=true;standing=false;angles();panel.hidden=false;button.setAttribute('aria-pressed','true');canvas.style.cursor='crosshair';hint.textContent='Pulsa una superficie horizontal del modelo para situarte a 1.65 m sobre ella.';frame=requestAnimationFrame(tick);
 }
 button.onclick=()=>active?exit():start();panel.querySelector('[data-action=exit]').onclick=exit;
 panel.querySelector('[data-action=place]').onclick=()=>{placing=true;stop();canvas.style.cursor='crosshair';hint.textContent='Pulsa el piso desde el que quieres iniciar el recorrido.';};
 height.onchange=()=>{const n=Number(height.value);if(!Number.isFinite(n)||n<.5||n>3){height.value=String(eye);return;}if(standing){camera.position.y+=n-eye;orient();render();}eye=n;};
 canvas.addEventListener('pointerdown',e=>{if(!active||e.button!==0)return;canvas.focus({preventScroll:true});drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY};canvas.setPointerCapture(e.pointerId);});
 canvas.addEventListener('pointermove',e=>{if(!active||!drag||drag.id!==e.pointerId)return;if(!placing){yaw-=(e.clientX-drag.x)*.004;pitch=Math.max(-1.45,Math.min(1.45,pitch-(e.clientY-drag.y)*.004));orient();render();}drag.x=e.clientX;drag.y=e.clientY;});
 canvas.addEventListener('pointerup',e=>{if(!active||!drag||drag.id!==e.pointerId)return;const tap=Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<8;drag=null;if(!placing||!tap)return;
  const r=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);
  const hit=ray.intersectObjects(modelGroup.children,true).find(h=>h.object.visible);
  if(!hit?.face){hint.textContent='No se detectó un piso. Pulsa una superficie del modelo.';return;}
  const normal=hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();if(Math.abs(normal.y)<.85){hint.textContent='Selecciona un piso o losa horizontal, no un muro.';return;}
  camera.position.copy(hit.point);camera.position.y+=eye;pitch=0;placing=false;standing=true;canvas.style.cursor='grab';orient();render();hint.textContent='Punto fijado. Usa las flechas en pantalla o W A S D para recorrer; arrastra para mirar.';
 });
 canvas.addEventListener('pointercancel',()=>{drag=null;});
 for(const b of panel.querySelectorAll('[data-move]')){b.onpointerdown=e=>{e.preventDefault();held.add(b.dataset.move);b.setPointerCapture(e.pointerId);};for(const name of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(name,()=>held.delete(b.dataset.move));}
 window.addEventListener('keydown',e=>{if(!active)return;if(e.code==='Escape'){exit();return;}if(editable(e))return;if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();keys.add(e.code);}});
 window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',stop);document.addEventListener('visibilitychange',stop);
 document.addEventListener('click',e=>{if(active&&e.target.closest('#ar-start,#reference-setup,#fit,#top,#focus'))exit();},true);
 return {exit,isActive:()=>active};
}
