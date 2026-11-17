import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import sharp from 'sharp';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS='id,household_id,title,description,source_url,source_name,source_type,image_path,servings,prep_minutes,cook_minutes,total_minutes,updated_at,archived_at,recipe_ingredients(position,raw_text,ingredient_name,quantity,unit,note),recipe_instructions(position,text),recipe_ratings(person_id,rating)';
const MAX_IMAGE=5*1024*1024;
class ReadError extends Error {readonly status:number;constructor(status:number){super('RECIPE_UNAVAILABLE');this.status=status;}}
export function recipeIds(value:unknown):string[]{
  if(!Array.isArray(value)||value.length>24||value.some(id=>typeof id!=='string'||!UUID.test(id)))throw new ReadError(400);
  return [...new Set(value)] as string[];
}
// The wall can read only recipes referenced by its existing authorized snapshot.
// Normal members keep the existing recipe RLS. No new storage or table policies.
export async function authorizedRecipes(user:{is_anonymous?:boolean},client:SupabaseClient,admin:SupabaseClient,ids:string[],signal:AbortSignal){
  let query;
  if(user.is_anonymous){
    const snapshot=await client.rpc('wall_snapshot').abortSignal(signal);
    if(snapshot.error||!snapshot.data?.household?.id)throw new ReadError(403);
    const allowed=new Set((snapshot.data.items||[]).filter((item:any)=>item.type==='Madplan').map((item:any)=>item.recipe_id));
    if(ids.some(id=>!allowed.has(id)))throw new ReadError(403);
    query=admin.from('recipes').select(FIELDS).eq('household_id',snapshot.data.household.id);
  }else query=client.from('recipes').select(FIELDS);
  const result=await query.in('id',ids).abortSignal(signal);
  if(result.error)throw new ReadError(502);
  if(result.data.length!==ids.length)throw new ReadError(404);
  return result.data;
}
export async function thumbnail(response:Response):Promise<Buffer>{
  if(!response.ok||!['image/jpeg','image/png','image/webp'].includes((response.headers.get('content-type')||'').split(';')[0])||Number(response.headers.get('content-length'))>MAX_IMAGE||!response.body){await response.body?.cancel();throw new ReadError(404);}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_IMAGE)throw new ReadError(413);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  if(!size)throw new ReadError(404);
  const image=await sharp(Buffer.concat(chunks),{limitInputPixels:50_000_000,animated:false}).rotate().resize({width:640,height:480,fit:'inside',withoutEnlargement:true}).webp({quality:76,effort:3}).toBuffer();
  if(image.length>384*1024)throw new ReadError(413);
  return image;
}
export function imageObjectPath(recipe:{id:string;household_id:string;image_path:string|null}):string{
  const path=recipe.image_path||'';
  if(!path.startsWith(`${recipe.household_id}/${recipe.id}/`)||!path.split('/').every(p=>/^[a-zA-Z0-9_-]+(?:\.(?:jpg|jpeg|png|webp))?$/.test(p)))throw new ReadError(404);
  return path.split('/').map(encodeURIComponent).join('/');
}
export default async function handler(req:any,res:any){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
  // Native builds use the configured public app origin. Browser requests are same-origin.
  const origin=req.headers.origin;
  if(origin&&['capacitor://localhost','https://localhost','http://localhost'].includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','authorization, content-type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
  if(req.method==='OPTIONS')return res.status(204).end();
  if(!['GET','POST'].includes(req.method))return res.status(405).json({code:'RECIPE_UNAVAILABLE'});
  try{
    const token=String(req.headers.authorization||'').match(/^Bearer (\S+)$/)?.[1];if(!token)throw new ReadError(401);
    const url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!url||!key)throw new ReadError(503);
    const options={auth:{persistSession:false,autoRefreshToken:false}},signal=AbortSignal.timeout(15000);
    const admin=createClient(url,key,options),client=createClient(url,key,{...options,global:{headers:{Authorization:`Bearer ${token}`},fetch:(input,init)=>fetch(input,{...init,signal})}});
    const auth=await client.auth.getUser(token);if(auth.error||!auth.data.user)throw new ReadError(401);
    const ids=recipeIds(req.method==='GET'?[req.query.id]:req.body?.ids);
    const recipes=await authorizedRecipes(auth.data.user,client,admin,ids,signal);
    if(req.method==='POST')return res.status(200).json({recipes});
    const path=imageObjectPath(recipes[0]);
    const response=await fetch(`${url}/storage/v1/object/authenticated/recipe-images/${path}`,{headers:{Authorization:`Bearer ${key}`,apikey:key},signal,redirect:'error'});
    const image=await thumbnail(response);res.setHeader('Content-Type','image/webp');return res.status(200).send(image);
  }catch(error){return res.status(error instanceof ReadError?error.status:502).json({code:'RECIPE_UNAVAILABLE'});}
}
