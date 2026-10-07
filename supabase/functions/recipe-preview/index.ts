import {createClient} from 'npm:@supabase/supabase-js@2.105.4';
import {fetchRecipePage,parseRecipe,recipeUrl,resolvePublic,abortable} from '../_shared/recipe.ts';
import {fetchRecipeImage,encodeImage} from '../_shared/recipe-images.ts';
import {analyseRecipe,scanImages} from '../_shared/recipe-vision.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
export function makeRecipeHandler(deps:{authenticate?:(authorization:string)=>Promise<boolean|string>;authorize?:(auth:string,hid:string)=>Promise<boolean>;rate?:(auth:string,hid:string)=>Promise<boolean>;download?:(auth:string,path:string)=>Promise<{mime:string;base64:string}>;cleanup?:(auth:string,paths:string[])=>Promise<void>;load?:typeof fetchRecipePage;validateImage?:typeof resolvePublic;image?:typeof fetchRecipeImage;vision?:typeof analyseRecipe}={}){
 const client=(auth:string)=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
 return async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  try{
   const authorization=req.headers.get('Authorization')||'';
   const authenticate=deps.authenticate|| (async(auth:string)=>{const {data,error}=await client(auth).auth.getUser();return !error&&data.user?.id||false;});
   const user=authorization.startsWith('Bearer ')?await authenticate(authorization):false;
   if(!user)return json({error:'UNAUTHORIZED'},401);
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
    const storage=()=>client(authorization).storage.from('recipe-images');
    let paths:string[]=[];
    try{
     if(input.paths!==undefined){
      const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
      const owned=new RegExp('^'+input.household_id+'/'+uuid+'/scan-'+user+'-'+uuid+'[.]jpg$');
      if(!Array.isArray(input.paths)||!input.paths.length||input.paths.length>4||new Set(input.paths).size!==input.paths.length||input.paths.some((p:unknown)=>typeof p!=='string'||!owned.test(p)))throw Error('INVALID_IMAGES');
      paths=input.paths;
     }
     const rate=deps.rate|| (async(auth:string,hid:string)=>{const {data,error}=await client(auth).rpc('claim_recipe_scan',{p_household_id:hid});if(error)throw Error('VISION_UNAVAILABLE');return data===true;});
     if(!await rate(authorization,input.household_id))throw Error('VISION_RATE_LIMIT');
     const download=deps.download|| (async(_auth:string,path:string)=>{const {data,error}=await storage().download(path);if(error||!data||data.size>5*1024*1024)throw Error('INVALID_IMAGES');return {mime:data.type,base64:encodeImage(new Uint8Array(await data.arrayBuffer()))};});
     const images=paths.length?await Promise.all(paths.map(p=>download(authorization,p))):input.images;
     const recipe=await(deps.vision||analyseRecipe)(scanImages(images));
     return json({recipe,review_required:true});
    }catch(error){
     const code=error instanceof Error?error.message:'';
     const messages:Record<string,[number,string]>={
      VISION_NOT_CONFIGURED:[503,'Fotoscan er ikke konfigureret endnu. Du kan stadig skrive opskriften manuelt.'],
      VISION_RATE_LIMIT:[429,'Der er mange scanninger lige nu. Vent et minut og prøv igen.'],
      VISION_TIMEOUT:[504,'Det tog for lang tid at læse billederne. Prøv igen.'],
      INVALID_IMAGES:[400,'Vælg 1–4 læsbare billeder på højst 2200 pixels og 12 MB i alt.'],
      VISION_NO_RECIPE:[422,'Vi kunne ikke finde en opskrift. Prøv tydeligere fotos, eller skriv den manuelt.'],
      VISION_UNREADABLE:[422,'Vi kunne ikke læse opskriften. Prøv tydeligere fotos, eller skriv den manuelt.']
     };
     const [status,message]=messages[code]||[503,'Opskriftsscanning er midlertidigt ikke tilgængelig. Prøv igen eller skriv opskriften manuelt.'];
     return json({error:messages[code]?code:'VISION_UNAVAILABLE',message},status);
    }finally{
     if(paths.length){
      const cleanup=deps.cleanup|| (async(_auth:string,p:string[])=>{const {error}=await storage().remove(p);if(error)throw Error('CLEANUP_FAILED');});
      try{await cleanup(authorization,paths);}catch{return json({error:'SCAN_CLEANUP_FAILED',message:'Scanningen blev afbrudt. Midlertidige billeder forsøges fjernet igen fra din enhed.'},503);}
     }
    }
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
