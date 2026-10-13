import {AR} from './marker-library.js';
import {QRCode} from './qr-code.js';

export const BOARD_VERSION='G4-1';
export const BOARD_SIZE=.2;
// Black marker borders: 32 mm, inset 6 mm. Outer-corner square: 188 mm.
export const MARKER_SIZE=.032;
export const OUTER_SIZE=.188;
export const dictionary=new AR.Dictionary('ARUCO_MIP_36h12');
export function boardIds(project,model){
 let seed=2166136261;for(const c of `${BOARD_VERSION}:${project}:${model}`)seed=Math.imul(seed^c.charCodeAt(0),16777619)>>>0;
 const ids=[];while(ids.length<4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const id=seed%dictionary.codeList.length;if(!ids.includes(id))ids.push(id);}return ids;
}
export function markerPoints(index){
 const left=[-.094,.062,.062,-.094][index],top=[.094,.094,-.062,-.062][index];
 return [[left,top,0],[left+MARKER_SIZE,top,0],[left+MARKER_SIZE,top-MARKER_SIZE,0],[left,top-MARKER_SIZE,0]];
}
export function drawMarker(g,id,x,y,size){
 const bits=dictionary.codeList[id],cell=size/8;g.fillStyle='#000';g.fillRect(x,y,size,size);g.fillStyle='#fff';
 for(let row=0;row<6;row++)for(let col=0;col<6;col++)if(bits[row*6+col]==='1')g.fillRect(x+(col+1)*cell,y+(row+1)*cell,cell,cell);
}
export function drawPlate({project,model,origin=location.origin}){
 const c=document.createElement('canvas');c.width=c.height=1000;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,1000,1000);
 const ids=boardIds(project,model);[[30,30],[810,30],[810,810],[30,810]].forEach(([x,y],i)=>drawMarker(g,ids[i],x,y,160));
 g.fillStyle='#122d43';g.textAlign='center';g.font='bold 40px sans-serif';g.fillText('GEEINCO',500,78);g.font='24px sans-serif';g.fillText('↑ ARRIBA · AR-01',500,120);
 const url=new URL('/index.html',origin);url.searchParams.set('project',project);url.searchParams.set('model',model);url.searchParams.set('ar','reference');
 const qr=new QRCode(-1,1);qr.addData(url.href);qr.make();const n=qr.getModuleCount(),cell=Math.floor(570/(n+8)),start=(1000-cell*(n+8))/2;
 g.fillStyle='#000';for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(qr.isDark(y,x))g.fillRect(start+(x+4)*cell,start+(y+4)*cell,cell,cell);
 g.fillStyle='#122d43';g.font='22px sans-serif';g.fillText('20 × 20 cm · CUATRO MARCADORES',500,870);g.font='18px sans-serif';g.fillText(`${BOARD_VERSION} · ${model.slice(0,8)}`,500,910);
 g.font='15px sans-serif';g.fillText(ids.join(' / '),500,942);g.strokeStyle='#122d43';g.lineWidth=2;g.strokeRect(1,1,998,998);return c;
}
