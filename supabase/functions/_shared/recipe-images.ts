import {recipeUrl,resolvePublic,pinnedGet,abortable} from './recipe.ts';
export const MAX_IMAGE_BYTES=5*1024*1024;
export function validateImageBytes(bytes:Uint8Array,mime:string){
 if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw Error('IMAGE_TOO_LARGE');
 const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10;
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const webp=new TextDecoder().decode(bytes.subarray(0,4))==='RIFF'&&new TextDecoder().decode(bytes.subarray(8,12))==='WEBP';
 if(!((mime==='image/png'&&png)||(mime==='image/jpeg'&&jpeg)||(mime==='image/webp'&&webp)))throw Error('INVALID_IMAGE');
 return bytes;
}
export const encodeImage=(bytes:Uint8Array)=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
export async function fetchRecipeImage(input:string,deps:{resolve?:typeof resolvePublic;get?:typeof pinnedGet}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{let url=recipeUrl(input);
  for(let i=0;i<4;i++){
   const address=await abortable((deps.resolve||resolvePublic)(url),controller.signal);
   const r=await abortable((deps.get||pinnedGet)(url,address,controller.signal,{image:true}),controller.signal);
   if([301,302,303,307,308].includes(r.status)){if(!r.headers.location||i===3)throw Error('IMAGE_UNAVAILABLE');url=recipeUrl(new URL(r.headers.location,url).href);continue;}
   const mime=(r.headers['content-type']||'').split(';')[0].toLowerCase();
   if(r.status!==200||!r.bytes)throw Error('IMAGE_UNAVAILABLE');
   validateImageBytes(r.bytes,mime);return {mime,base64:encodeImage(r.bytes)};
  }throw Error('IMAGE_UNAVAILABLE');
 }finally{clearTimeout(timer);}
}
