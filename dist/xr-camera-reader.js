// Read only the camera image belonging to the current XRView/current XRFrame.
// No getUserMedia handoff: camera pixels, intrinsics and pose stay synchronized.
export function cameraIntrinsics(projection,width,height){
 return {fx:projection[0]*width/2,fy:projection[5]*height/2,cx:(1-projection[8])*width/2,cy:(1+projection[9])*height/2,skew:projection[4]*width/2};
}
export function topDownRGBA(bottomUp,width,height){
 const out=new Uint8Array(bottomUp.length),stride=width*4;
 for(let y=0;y<height;y++)out.set(bottomUp.subarray((height-1-y)*stride,(height-y)*stride),y*stride);
 return out;
}
export function createCameraReader(gl){
 const source=gl.createFramebuffer(),target=gl.createFramebuffer(),texture=gl.createTexture();let w=0,h=0;
 return {
  read(cameraTexture,width,height){
   const scale=Math.min(1,960/Math.max(width,height)),rw=Math.round(width*scale),rh=Math.round(height*scale);
   const prevRead=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),prevDraw=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),prevTexture=gl.getParameter(gl.TEXTURE_BINDING_2D),scissor=gl.isEnabled(gl.SCISSOR_TEST);
   try{
    gl.disable(gl.SCISSOR_TEST);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,source);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,cameraTexture,0);
    if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('El navegador no permite leer la imagen de cámara AR.');
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,target);
    if(rw!==w||rh!==h){w=rw;h=rh;gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);}
    if(gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('No se pudo preparar la lectura de cámara.');
    gl.blitFramebuffer(0,0,width,height,0,0,w,h,gl.COLOR_BUFFER_BIT,gl.NEAREST);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,target);
    const pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    return {pixels:topDownRGBA(pixels,w,h),width:w,height:h};
   }finally{
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,source);gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,null,0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,prevRead);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,prevDraw);gl.bindTexture(gl.TEXTURE_2D,prevTexture);if(scissor)gl.enable(gl.SCISSOR_TEST);
   }
  },
  dispose(){gl.deleteFramebuffer(source);gl.deleteFramebuffer(target);gl.deleteTexture(texture);}
 };
}
