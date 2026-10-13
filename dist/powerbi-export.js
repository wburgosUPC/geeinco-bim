export function createModelPackage({elements,objects,modelGroup,spatial,metadata,filename}){
 const levels=new Map();
 function walk(node,level=''){const type=String(node.type||'').toUpperCase();if(type==='IFCBUILDINGSTOREY')level=String(node.Name?.value||node.Name||`Nivel ${node.expressID}`);if(node.expressID)levels.set(node.expressID,level);for(const child of node.children||[])walk(child,level);}
 if(spatial)walk(spatial);
 modelGroup.updateMatrixWorld(true);
 const Elementos=[],Geometria=[];
 for(const e of elements.values()){
  const m=metadata.get(e.id)||{};const id=String(e.id);
  Elementos.push({Id:id,GlobalId:m.globalId||'',Nombre:e.name,Tipo:e.type,Nivel:levels.get(e.id)||'',Archivo:filename});
  const pieces=(objects.get(e.id)||[]).map(mesh=>({p:Array.from(mesh.geometry.attributes.position.array),n:Array.from(mesh.geometry.attributes.normal.array),i:Array.from(mesh.geometry.index.array),m:mesh.matrixWorld.toArray(),c:mesh.material.color.toArray(),a:mesh.material.opacity}));
  const text=JSON.stringify(pieces);const total=Math.ceil(text.length/24000);
  for(let index=0;index<total;index++)Geometria.push({Id:id,Parte:index,Partes:total,Datos3D:text.slice(index*24000,(index+1)*24000)});
 }
 return {Version:1,Archivo:filename,Exportado:new Date().toISOString(),UnidadGeometria:'m',Elementos,Geometria,Propiedades:[...metadata.values()].flatMap(m=>m.properties||[])};
}
