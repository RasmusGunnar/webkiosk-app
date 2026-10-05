import {createClient} from 'npm:@supabase/supabase-js@2.105.4';
import {fetchRecipePage,parseRecipe,recipeUrl,resolvePublic,abortable} from '../_shared/recipe.ts';
import {fetchRecipeImage} from '../_shared/recipe-images.ts';
import {analyseRecipe,scanImages} from '../_shared/recipe-vision.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
export function makeRecipeHandler(deps:{authenticate?:(authorization:string)=>Promise<boolean>;authorize?:(auth:string,hid:string)=>Promise<boolean>;load?:typeof fetchRecipePage;validateImage?:typeof resolvePublic;image?:typeof fetchRecipeImage;vision?:typeof analyseRecipe}={}){
 const client=(auth:string)=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
 return async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  try{
   const authorization=req.headers.get('Authorization')||'';
   const authenticate=deps.authenticate|| (async(auth:string)=>{const {data,error}=await client(auth).auth.getUser();return !!data.user&&!error;});
   if(!authorization.startsWith('Bearer ')||!await authenticate(authorization))return json({error:'UNAUTHORIZED'},401);
   const limit=17*1024*1024;
   if(Number(req.headers.get('content-length'))>limit||!req.body)return json({error:'INVALID_REQUEST'},400);
   const reader=req.body.getReader(),parts:Uint8Array[]=[];let bytes=0;const deadline=AbortSignal.timeout(10000);
   try{while(true){const part=await abortable(reader.read(),deadline);if(part.done)break;bytes+=part.value.length;if(bytes>limit)return json({error:'INVALID_REQUEST'},413);parts.push(part.value);}}
   finally{await reader.cancel();reader.releaseLock();}
   const joined=new Uint8Array(bytes);let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.length;}
   const input=JSON.parse(new TextDecoder().decode(joined));
   if(input.action==='scan'){
    const authorize=deps.authorize|| (async(auth:string,hid:string)=>{const {data,error}=await client(auth).from('households').select('id').eq('id',hid).maybeSingle();return !!data&&!error;});
    if(typeof input.household_id!=='string'||!await authorize(authorization,input.household_id))return json({error:'FORBIDDEN'},403);
    try{const recipe=await(deps.vision||analyseRecipe)(scanImages(input.images));return json({recipe,review_required:true});}
    catch(error){const code=error instanceof Error?error.message:'';if(code==='VISION_NOT_CONFIGURED')return json({error:code,message:'Fotoscan er ikke konfigureret endnu. Du kan stadig skrive opskriften manuelt.'},503);return json({error:'VISION_UNAVAILABLE',message:'Vi kunne ikke læse hele opskriften sikkert. Prøv tydeligere fotos, eller skriv opskriften manuelt.'},422);}
   }
   const {url}=input;if(bytes>8192||typeof url!=='string'||url.length>4096)return json({error:'INVALID_REQUEST'},400);
   const page=await(deps.load||fetchRecipePage)(url),recipe=parseRecipe(page.html,page.url);
   let image_copy=null;
   if(recipe.image){try{await abortable((deps.validateImage||resolvePublic)(recipeUrl(recipe.image)),AbortSignal.timeout(3000));image_copy=await(deps.image||fetchRecipeImage)(recipe.image);}catch{recipe.image='';/* optional image failure never blocks the recipe or produces a hotlink */}}
   return json({recipe:{...recipe,image_copy}});
  }catch{return json({error:'RECIPE_UNAVAILABLE',message:'Opskriften kunne ikke hentes. Prøv et andet link, eller skriv den manuelt.'},422);}
 };
}
if(import.meta.main)Deno.serve(makeRecipeHandler());
