import {createClient} from 'npm:@supabase/supabase-js@2.105.4'
import {validSecret,webhookEvent,fetchSubscription,providerEventId} from '../_shared/subscription.ts'
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
export async function handler(req:Request) {
 if(req.method!=='POST')return reply({error:'method'},405)
 // Authenticate before parsing, database access or provider requests.
 if(!await validSecret(req.headers.get('Authorization'),Deno.env.get('REVENUECAT_WEBHOOK_SECRET')))return reply({error:'unauthorized'},401)
 let event
 try {
  if(Number(req.headers.get('content-length'))>65536)return reply({error:'payload'},413)
  const raw=await req.text();if(raw.length>65536)return reply({error:'payload'},413)
  event=webhookEvent(JSON.parse(raw))
 }catch{return reply({error:'invalid'},400)}
 if(event.type==='TEST'||!event.users.length)return reply({ignored:true})
 try {
  const key=Deno.env.get('REVENUECAT_SECRET_API_KEY')
  if(!key)return reply({error:'provider_not_configured'},503)
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
  for(const userId of event.users){
   const eventId=await providerEventId(event,userId)
   const previous=await admin.from('subscription_events').select('processed_at').eq('provider_event_id',eventId).maybeSingle()
   if(previous.error)throw Error('Database unavailable')
   if(previous.data?.processed_at)continue
   const {data,error}=await admin.auth.admin.getUserById(userId)
   if(error||!data.user||data.user.is_anonymous)continue
   const started=new Date().toISOString(),verified=await fetchSubscription(userId,{key,allowSandbox:Deno.env.get('REVENUECAT_ALLOW_SANDBOX')==='true'})
   const result=await admin.rpc('apply_subscription_verification',{p_user_id:userId,p_claim_id:null,p_verified:verified,p_started_at:started,p_event_id:eventId,p_type:event.type})
   if(result.error)throw Error('Verification pending')
  }
  return reply({ok:true})
 }catch{return reply({error:'retry'},503)}
}
if(import.meta.main)Deno.serve(handler)
