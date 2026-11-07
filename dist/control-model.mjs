export const sum=(rows,key)=>rows.reduce((a,r)=>a+(Number(r[key])||0),0);
export const divide=(a,b)=>a==null||!b?null:a/b;
export const moneyRound=n=>Math.round((n+Number.EPSILON)*100)/100;
export const unique=xs=>[...new Set(xs.filter(x=>x!=null))].sort();
export function match(row,f,keys=['month','component','category','specialty','resource','unit']){return keys.every(k=>!f[k]?.length||f[k].includes(row[k]));}
export function laborData(data,f={}){
 const plan=data.resources.filter(r=>r.type==='Mano de Obra'&&match(r,f));
 const real=data.labor.filter(r=>match(r,f,['month','component','category']));
 // Payroll has no specialty, resource or unit detail. Never manufacture that allocation.
 const actual=Object.keys(f).some(k=>['specialty','resource','unit'].includes(k)&&f[k]?.length)?[]:real;
 const result={planCost:sum(plan,'cost'),planHH:sum(plan.filter(r=>r.unit.toUpperCase()==='HH'),'qty'),realCost:actual.length?sum(actual,'cost'):null,realHH:actual.length?sum(actual,'hh'):null};
 return {...result,planRate:divide(sum(plan.filter(r=>r.unit.toUpperCase()==='HH'),'cost'),result.planHH),realRate:divide(result.realCost,result.realHH),plan,real:actual};
}
export function monthlyLabor(data,f={}){return unique([...data.resources.filter(r=>r.type==='Mano de Obra'&&match(r,{...f,month:[]})).map(r=>r.month),...data.labor.filter(r=>match(r,{...f,month:[]},['component','category'])).map(r=>r.month)]).filter(m=>!f.month?.length||f.month.includes(m)).map(month=>({month,...laborData(data,{...f,month:[month]})}));}
export function selectedParts(data,f){return data.parts.filter(r=>match({component:r.Componente,specialty:r.Especialidad},f,['component','specialty']));}
export function finance(data,f,cut){
 const parts=selectedParts(data,f),codes=new Set(parts.map(r=>r.Codigo));
 const budget=data.budget.filter(r=>match({component:r.Componente,specialty:r.Especialidad},f,['component','specialty']));
 const closures=data.closures.filter(r=>codes.has(r.code)&&r.month===cut);
 const plan=data.schedule.filter(r=>codes.has(r.Codigo)&&r.Fecha.slice(0,7)<=cut);
 const ev=closures.length?sum(closures,'accum'):null,pv=plan.length?sum(plan,'PlanMes'):null;
 const groups=unique(parts.map(r=>r.Componente));let gross=0,periodGross=0;
 for(const c of groups){const cc=new Set(parts.filter(r=>r.Componente===c).map(r=>r.Codigo));const b=budget.filter(r=>r.Componente===c);const close=closures.filter(r=>cc.has(r.code));const direct=sum(b,'Directo');const gg=divide(sum(b,'GG'),direct)||0,util=divide(sum(b,'Utilidad'),direct)||0;
  const convert=x=>{const sub=x+moneyRound(x*gg)+moneyRound(x*util);return sub+moneyRound(sub*.18)};
  gross+=convert(sum(close,'accum'));periodGross+=convert(sum(close,'period'));
 }
 const approved=!f.component?.length&&!f.specialty?.length?data.approvedGross?.find(r=>r.month===cut):null;
 return {parts,budget,ev,pv,gross:approved?.accum??(closures.length?moneyRound(gross):null),periodGross:approved?.period??(closures.length?moneyRound(periodGross):null),bac:sum(parts,'Presupuesto'),total:sum(budget,'Total'),spi:divide(ev,pv),sv:ev!=null&&pv!=null?ev-pv:null};
}
