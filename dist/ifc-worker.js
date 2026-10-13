import { IfcAPI, IFCRELDEFINESBYPROPERTIES, IFCRELDEFINESBYTYPE } from './vendor/web-ifc-api.js';
const api = new IfcAPI();
api.SetWasmPath(new URL('./vendor/', import.meta.url).href, true);
let model = null;
let initialized;
const propertyCache=new Map();
const value = v => v && typeof v === 'object' && 'value' in v ? v.value : v;
self.onmessage = async ({data}) => {
  try {
    if (data.action === 'open') {
      propertyCache.clear();
      initialized ||= api.Init();
      await initialized;
      if (model !== null) { api.CloseModel(model); model = null; }
      model = api.OpenModel(new Uint8Array(data.buffer), { COORDINATE_TO_ORIGIN: true });
      if (model < 0) { model = null; throw Error('No se pudo interpretar el archivo IFC.'); }
      const elements = [];
      api.StreamAllMeshes(model, (flat, index, total) => {
        let line;
        try { line = api.GetLine(model, flat.expressID, false); } catch {}
        const type = api.GetNameFromTypeCode(api.GetLineType(model, flat.expressID));
        elements.push({id:flat.expressID,name:String(value(line?.Name) || type),type});
        const parts = [], transfers = [];
        for (let i=0; i<flat.geometries.size(); i++) {
          const placed = flat.geometries.get(i);
          const geometry = api.GetGeometry(model, placed.geometryExpressID);
          try {
            const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize()).slice();
            const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize()).slice();
            if (!vertices.length || !indices.length) continue;
            parts.push({vertices,indices,matrix:placed.flatTransformation,color:placed.color});
            transfers.push(vertices.buffer,indices.buffer);
          } finally { geometry.delete(); }
        }
        self.postMessage({kind:'mesh',id:flat.expressID,parts,index,total}, transfers);
      });
      let spatial = null;
      try {
        spatial=await api.properties.getSpatialStructure(model,false);
        // Only spatial containers need names here; element labels already exist above.
        function nameContainers(node){if(node.children?.length){try{const line=api.GetLine(model,node.expressID,false);node.Name={value:String(value(line.Name)||node.type)};}catch{}for(const child of node.children)nameContainers(child);}}
        nameContainers(spatial);
      } catch {}
      self.postMessage({kind:'ready',elements,spatial,schema:api.GetModelSchema(model)});
      // Build the small text-filter index in the worker, once per file.
      try {
        const index=new Map(elements.map(e=>[e.id,{id:e.id,module:[],block:[],discipline:[]}])) ,cache=new Map();
        const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ');
        function readSet(id){
          if(cache.has(id))return cache.get(id);
          const result={module:[],block:[],discipline:[]},set=api.GetLine(model,id,true);
          for(const p of set.HasProperties||[]){
            const name=norm(value(p.Name)||'');
            const key=/\b(modulo|modulos|module)\b/.test(name)?'module':/\b(bloque|bloques|block)\b/.test(name)?'block':/\b(disciplina|discipline|especialidad)\b/.test(name)?'discipline':null;
            if(!key)continue;
            const raw=p.NominalValue??p.ListValues??p.EnumerationValues;
            for(const item of [].concat(raw??[])){const v=value(item);if(typeof v==='string'||typeof v==='number'){const text=String(v).trim();if(text)result[key].push(text);}}
          }
          cache.set(id,result);return result;
        }
        function apply(objects,setIds,replace){for(const ref of objects||[]){const entry=index.get(value(ref));if(!entry)continue;const found={module:[],block:[],discipline:[]};for(const id of setIds){try{const p=readSet(id);for(const key of ['module','block','discipline'])found[key].push(...p[key]);}catch{}}
          for(const key of ['module','block','discipline'])if(found[key].length)entry[key]=[...new Set(replace?found[key]:[...entry[key],...found[key]])];}}
        const types=api.GetLineIDsWithType(model,IFCRELDEFINESBYTYPE);
        for(let i=0;i<types.size();i++){const rel=api.GetLine(model,types.get(i),false),type=api.GetLine(model,value(rel.RelatingType),false);apply(rel.RelatedObjects,(type.HasPropertySets||[]).map(value),false);}
        const rels=api.GetLineIDsWithType(model,IFCRELDEFINESBYPROPERTIES),byObject=new Map();
        for(let i=0;i<rels.size();i++){const rel=api.GetLine(model,rels.get(i),false),id=value(rel.RelatingPropertyDefinition);if(typeof id!=='number')continue;for(const ref of rel.RelatedObjects||[]){const oid=value(ref);if(!byObject.has(oid))byObject.set(oid,[]);byObject.get(oid).push(id);}}
        for(const [id,sets]of byObject)apply([id],sets,true);
        self.postMessage({kind:'filter-index',entries:[...index.values()]});
      }catch(error){self.postMessage({kind:'filter-index-error',message:error.message});}

    } else if (data.action === 'export' && model !== null) {
      const relations=new Map(),sets=new Map();
      const relIDs=api.GetLineIDsWithType(model,IFCRELDEFINESBYPROPERTIES);
      for(let i=0;i<relIDs.size();i++){
        const rel=api.GetLine(model,relIDs.get(i),false);
        const setID=value(rel.RelatingPropertyDefinition);
        if(typeof setID!=='number')continue;
        for(const ref of rel.RelatedObjects||[]){const id=value(ref);if(!relations.has(id))relations.set(id,[]);relations.get(id).push(setID);}
      }
      const metadata=[];
      for(let index=0;index<data.ids.length;index++){
        const id=data.ids[index],line=api.GetLine(model,id,false),properties=[];
        for(const setID of relations.get(id)||[]){
          if(!sets.has(setID))sets.set(setID,api.GetLine(model,setID,true));
          const set=sets.get(setID);
          for(const p of set.HasProperties||set.Quantities||[]){
            const val=value(p.NominalValue??p.LengthValue??p.AreaValue??p.VolumeValue??p.CountValue??p.WeightValue??p.TimeValue??p.ListValues??p.EnumerationValues);
            const number=typeof val==='number'&&Number.isFinite(val)?val:null;
            properties.push({Id:String(id),Conjunto:String(value(set.Name)||''),Propiedad:String(value(p.Name)||''),Valor:val==null?'':typeof val==='object'?JSON.stringify(val):String(val),ValorNumerico:number,Unidad:p.Unit?JSON.stringify(p.Unit):'Unidades del proyecto IFC'});
          }
        }
        metadata.push({id,globalId:String(value(line.GlobalId)||''),properties});
        if(index%100===0)self.postMessage({kind:'export-progress',done:index,total:data.ids.length});
      }
      self.postMessage({kind:'export-ready',metadata});
    } else if (data.action === 'properties' && model !== null) {
      if(propertyCache.has(data.id)){const cached=propertyCache.get(data.id);propertyCache.delete(data.id);propertyCache.set(data.id,cached);self.postMessage({...cached,request:data.request});return;}
      const line = api.GetLine(model,data.id,false);
      let sets = [], types = [], materials = [];
      try { sets = await api.properties.getPropertySets(model,data.id,true); } catch {}
      try { types = await api.properties.getTypeProperties(model,data.id,true); } catch {}
      try { materials = await api.properties.getMaterialsProperties(model,data.id,true); } catch {}
      const result={kind:'properties',id:data.id,line,sets,types,materials};
      if(propertyCache.size>=128)propertyCache.delete(propertyCache.keys().next().value);
      propertyCache.set(data.id,result);
      self.postMessage({...result,request:data.request});
    }
  } catch (error) {
    self.postMessage({kind:'error',action:data.action,message:error?.message || String(error)});
  }
};
