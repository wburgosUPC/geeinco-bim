import {AR} from './marker-library.js';
import {estimateBoard} from './marker-pose.js';
const detector=new AR.Detector({dictionaryName:'ARUCO_MIP_36h12'});
self.onmessage=({data})=>{
 try{const image={data:new Uint8ClampedArray(data.buffer),width:data.width,height:data.height};
  const markers=detector.detect(image);
  self.postMessage({...estimateBoard(markers,data.ids,data.width,data.height,data.focal),frame:data.frame,width:data.width,height:data.height});
 }catch(e){self.postMessage({ok:false,count:0,reason:'error',error:String(e.message||e),frame:data.frame,width:data.width,height:data.height});}
};
