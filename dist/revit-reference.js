import * as THREE from 'three';

// Read the exported v2 plaque geometry, in the same world coordinates as the IFC.
// The small raised L and centre dot distinguish the front from the back.
export function referenceFromRevit(elements,objects){
 const matches=[...elements.values()].filter(e=>/INCOAC_Marca_AR_Muro_v2/i.test(e.name));
 if(matches.length!==1)throw Error(matches.length?'Hay varias marcas AR. Exporta una sola marca por entrega.':'No se encontró la familia INCOAC_Marca_AR_Muro_v2. Colócala en Revit e inclúyela en la vista exportada.');
 const element=matches[0],triangles=[],points=[];
 for(const mesh of objects.get(element.id)||[]){
  mesh.updateWorldMatrix(true,false);const g=mesh.geometry,p=g.attributes.position,idx=g.index;
  const count=idx?idx.count:p.count;
  for(let i=0;i<count;i+=3){
   const v=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,idx?idx.getX(i+k):i+k).applyMatrix4(mesh.matrixWorld));
   const cross=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));
   const area=cross.length()/2;if(area<1e-10)continue;
   triangles.push({v,area,n:cross.normalize()});points.push(...v);
  }
 }
 if(!triangles.length)throw Error('La marca no contiene geometría exportada.');
 triangles.sort((a,b)=>b.area-a.area);
 let normal=triangles[0].n.clone();
 if(Math.abs(normal.y)>.01)throw Error('La marca AR debe estar vertical sobre el muro.');
 const projections=points.map(p=>p.dot(normal)),lo=Math.min(...projections),hi=Math.max(...projections);
 if(Math.abs(hi-lo-.005)>.0007)throw Error('La geometría de la marca AR no coincide con la familia de 20 × 20 cm.');
 const areaAt=h=>triangles.filter(t=>t.v.every(p=>Math.abs(p.dot(normal)-h)<.00015)).reduce((sum,t)=>sum+t.area,0);
 const lowArea=areaAt(lo),highArea=areaAt(hi);
 if(Math.max(lowArea,highArea)<.035 || Math.min(lowArea,highArea)>.005)throw Error('No se pudo distinguir el frente de la placa AR.');
 if(highArea>lowArea)normal.negate();
 const up=new THREE.Vector3(0,1,0),right=up.clone().cross(normal).normalize();
 const xs=points.map(p=>p.dot(right)),ys=points.map(p=>p.y),zs=points.map(p=>p.dot(normal));
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 if(Math.abs(maxX-minX-.2)>.001||Math.abs(maxY-minY-.2)>.001)throw Error('La placa debe medir 200 × 200 mm, sin escala ni inclinación.');
 // The printed sheet replaces the front of the 3 mm plaque, not the host wall.
 const a=right.clone().multiplyScalar((minX+maxX)/2).addScaledVector(up,(minY+maxY)/2).addScaledVector(normal,Math.min(...zs)+.003);
 return {version:1,mount:'wall',width:.2,a:a.toArray(),b:a.clone().add(right).toArray(),source:'revit-family-v2',elementId:element.id};
}
