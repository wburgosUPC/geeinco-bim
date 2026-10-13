import * as THREE from 'three';

// Accept repeated poses in world space. Camera motion must not move the plaque.
export class MarkerAnchorState{
 constructor(){this.reset();}
 reset(){this.candidate=null;this.samples=0;this.ready=false;}
 observe(markerMatrix,viewMatrix){
  const world=new THREE.Matrix4().fromArray(viewMatrix).multiply(new THREE.Matrix4().fromArray(markerMatrix));
  if(!world.elements.every(Number.isFinite)){this.reset();return false;}
  if(this.candidate){
   const a=new THREE.Vector3(),b=new THREE.Vector3(),qa=new THREE.Quaternion(),qb=new THREE.Quaternion(),s=new THREE.Vector3();
   this.candidate.decompose(a,qa,s);world.decompose(b,qb,s);
   if(a.distanceTo(b)>.025||qa.angleTo(qb)>.10)this.samples=0;
  }
  this.candidate=world;this.ready=++this.samples>=6;return this.ready;
 }
}
