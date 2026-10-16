export const isoDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function validatePlan(p){
 if(p?.version!==1||typeof p.name!=='string'||p.name.length>200||typeof p.source!=='string'||p.source.length>2000||!Array.isArray(p.tasks)||!p.tasks.length||p.tasks.length>10000)throw Error('Archivo de planificación inválido.');
 const codes=new Set();
 for(const t of p.tasks){
  if(typeof t.code!=='string'||!/^\d+(?:\.\d+)+$/.test(t.code)||codes.has(t.code)||typeof t.name!=='string'||t.name.length>1000||typeof t.unit!=='string'||t.unit.length>50||!isoDate(t.start)||!isoDate(t.finish)||t.finish<t.start||!Number.isFinite(t.quantity)||t.quantity<0||!Array.isArray(t.actuals)||t.actuals.length>500)throw Error('Partida inválida o duplicada.');
  codes.add(t.code);const dates=new Set();for(const a of t.actuals){if(!isoDate(a.date)||dates.has(a.date)||!Number.isFinite(a.quantity)||a.quantity<0)throw Error('Avance inválido.');dates.add(a.date);}
 }
 return p;
}
export function addDays(s,n){const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function monday(s){return addDays(s,-((new Date(s+'T12:00:00Z').getUTCDay()+6)%7));}
export function linkedTask(e,tasks){const codes=[...new Set((e.item||[]).map(s=>String(s).trim()).filter(s=>tasks.has(s)))];return codes.length===1?tasks.get(codes[0]):null;}
export function scheduleState(t,start){const end=addDays(start,6);return t.finish<start?'Terminación prevista anterior':t.start>end?'Programada después':'Programada esta semana';}
export function actualAt(t,date){return t.actuals.filter(a=>a.date<=date).sort((a,b)=>b.date.localeCompare(a.date))[0]||null;}
