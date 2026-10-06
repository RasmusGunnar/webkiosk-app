import {createClient} from 'npm:@supabase/supabase-js@2.105.4';
import {importCalendarFeed} from '../_shared/calendar-import.ts';
import {ImportFailure} from '../_shared/feed-security.ts';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
async function authorized(received:string,expected:string) {
 if(!expected||expected.length<32||!received)return false;
 const digest=(value:string)=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 const [a,b]=await Promise.all([digest(received),digest(expected)]);
 let mismatch=0;new Uint8Array(a).forEach((byte,i)=>{mismatch|=byte^new Uint8Array(b)[i]});return mismatch===0;
}
export function makeScheduledHandler(deps:{clientFactory?:typeof createClient;env?:(key:string)=>string|undefined;fetcher?:typeof fetch;now?:()=>Date}={}) {
 const env=deps.env||((key:string)=>Deno.env.get(key)),factory=deps.clientFactory||createClient;
 return async(req:Request)=>{
  if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  if(!await authorized(req.headers.get('x-calendar-sync-secret')||'',env('CALENDAR_SYNC_SECRET')||''))return json({error:'UNAUTHORIZED'},401);
  try {
   // No caller-supplied IDs. Two workers, bounded batch and shared DB lease.
   const writer=factory(env('SUPABASE_URL')!,env('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
   const due=await writer.rpc('due_calendar_feeds',{p_limit:10});
   if(due.error)throw new Error('Unavailable');
   const feeds=[...(due.data||[])],results:{feedId:string;success:boolean;error?:string}[]=[];
   await Promise.all([0,1].map(async()=>{
    while(feeds.length){const feed=feeds.shift();try{await importCalendarFeed(writer,feed.id,null,{...deps,env});results.push({feedId:feed.id,success:true})}
     catch(error){results.push({feedId:feed.id,success:false,error:error instanceof ImportFailure?error.code:'IMPORT_FAILED'})}}
   }));
   return json({processed:results.length,results});
  }catch{return json({error:'SYNC_UNAVAILABLE'},503)}
 };
}
if(import.meta.main)Deno.serve(makeScheduledHandler());
