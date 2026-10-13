import {POS} from './marker-library.js';
import {OUTER_SIZE,markerPoints} from './marker-board.js';

export function estimateBoard(markers,ids,width,height,focal){
 const selected=ids.map(id=>markers.filter(m=>m.id===id&&m.hammingDistance<=2));
 const count=selected.filter(a=>a.length===1).length;
 if(count!==4)return {ok:false,count,reason:'missing'};
 const ordered=selected.map(a=>a[0]);
 const corners=ordered.map((m,i)=>m.corners[i]);
 for(let i=0;i<4;i++)if(Math.hypot(corners[i].x-corners[(i+1)%4].x,corners[i].y-corners[(i+1)%4].y)<70)return {ok:false,count,reason:'small'};
 let pose;try{pose=new POS.Posit(OUTER_SIZE,focal).pose(corners.map(p=>({x:p.x-width/2,y:height/2-p.y})));}catch{return {ok:false,count,reason:'pose'};}
 const r=pose.bestRotation,t=pose.bestTranslation;
 if(![...r.flat(),...t].every(Number.isFinite)||t[2]<.12||t[2]>6)return {ok:false,count,reason:'pose'};
 // Validate all 16 corners, not only the outer four used by POSIT.
 let squared=0;
 for(let i=0;i<4;i++)for(let j=0;j<4;j++){
  const p=markerPoints(i)[j],v=r.map((row,k)=>row.reduce((sum,a,n)=>sum+a*p[n],t[k]));
  if(v[2]<=0)return {ok:false,count,reason:'pose'};
  squared+=(width/2+focal*v[0]/v[2]-ordered[i].corners[j].x)**2+(height/2-focal*v[1]/v[2]-ordered[i].corners[j].y)**2;
 }
 const error=Math.sqrt(squared/16);if(error>3.5)return {ok:false,count,reason:'unstable',error};
 // POSIT looks along +Z with Y up; Three looks along -Z. Reflect both camera
 // and local normal to retain a right-handed transform (front of plaque = +Z).
 const matrix=[r[0][0],r[1][0],-r[2][0],0,r[0][1],r[1][1],-r[2][1],0,-r[0][2],-r[1][2],r[2][2],0,t[0],t[1],-t[2],1];
 return {ok:true,count,error,matrix,corners:ordered.map(m=>m.corners)};
}
