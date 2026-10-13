import * as THREE from 'three';
export function validateReference(c){
 if(!c||c.version!==1||c.mount!=='wall'||c.width!==0.2||!Array.isArray(c.a)||!Array.isArray(c.b)||c.a.length!==3||c.b.length!==3||![...c.a,...c.b].every(Number.isFinite))throw Error('Referencia inválida.');
 const a=new THREE.Vector3(...c.a),b=new THREE.Vector3(...c.b),d=b.clone().sub(a);
 if(d.length()<0.2||Math.abs(d.y)>0.05)throw Error('Elige B a la derecha, a la misma altura que A y al menos a 20 cm.');
 return c;
}
export function wallMatrix(a,b){
 const x=b.clone().sub(a);x.y=0;x.normalize();const y=new THREE.Vector3(0,1,0),z=new THREE.Vector3().crossVectors(x,y);
 return new THREE.Matrix4().makeBasis(x,y,z).setPosition(a);
}
export function referenceInverse(c){validateReference(c);return wallMatrix(new THREE.Vector3(...c.a),new THREE.Vector3(...c.b)).invert();}
