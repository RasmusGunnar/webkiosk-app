import {createClient} from 'npm:@supabase/supabase-js@2.105.4';
import {ImportFailure} from '../_shared/feed-security.ts';
import {importCalendarFeed} from '../_shared/calendar-import.ts';
export {parseIcsEvents,eventsToCalendarRows,buildExternalKey} from '../_shared/calendar-parser.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
export function makeHandler(dependencies:{clientFactory?:typeof createClient;fetcher?:typeof fetch;env?:(key:string)=>string|undefined;now?:()=>Date}={}) {
 const factory=dependencies.clientFactory||createClient,env=dependencies.env||((key:string)=>Deno.env.get(key));
 return async(req:Request):Promise<Response>=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({success:false,error:'Method not allowed'},405);
  try {
   const authHeader=req.headers.get('Authorization')||'';
   if(!/^Bearer \S+$/i.test(authHeader))return json({success:false,error:'Not authenticated'},401);
   const body=await req.json().catch(()=>({})),feedId=String(body.feedId||'').trim();
   if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(feedId))return json({success:false,error:'Invalid feedId'},400);
   const url=env('SUPABASE_URL'),anon=env('SUPABASE_ANON_KEY'),service=env('SUPABASE_SERVICE_ROLE_KEY');
   if(!url||!anon||!service)throw new ImportFailure('IMPORT_FAILED',503);
   const user=factory(url,anon,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false}});
   const {data:auth,error:authError}=await user.auth.getUser();
   if(authError||!auth?.user)return json({success:false,error:'Not authenticated'},401);
   const {data:feed,error:feedError}=await user.from('calendar_feeds').select('*').eq('id',feedId).single();
   if(feedError||!feed)return json({success:false,error:'Feed unavailable'},404);
   if(feed.is_active===false)return json({success:false,error:'Feed inactive'},409);
   const permission=await user.rpc('is_household_admin',{hid:feed.household_id,uid:auth.user.id});
   if(permission.error||permission.data!==true)return json({success:false,error:'Forbidden'},403);
   const writer=factory(url,service,{auth:{persistSession:false}});
   return json(await importCalendarFeed(writer,feedId,auth.user.id,{...dependencies,env,cleanup:body.preserveExisting!==true}));
  }catch(error){const failure=error instanceof ImportFailure?error:new ImportFailure('IMPORT_FAILED',500);return json({success:false,error:failure.code},failure.status);}
 };
}
if(import.meta.main)Deno.serve(makeHandler());
