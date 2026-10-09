import {createClient} from 'npm:@supabase/supabase-js@2.105.4'
import {fetchSubscription,UUID,localMockAllowed} from '../_shared/subscription.ts'
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'}
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{...cors,'Cache-Control':'no-store'}})
export async function handler(req:Request) {
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
 if(req.method!=='POST')return reply({error:'method'},405)
 try {
  const auth=req.headers.get('Authorization')||''
  if(!auth.startsWith('Bearer '))return reply({error:'unauthorized'},401)
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!
  const client=createClient(url,key,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
  const {data:{user},error}=await client.auth.getUser(auth.slice(7))
  if(error||!user||user.is_anonymous)return reply({error:'unauthorized'},401)
  if(Number(req.headers.get('content-length'))>2048)return reply({error:'payload'},413)
  const raw=await req.text();if(raw.length>2048)return reply({error:'payload'},413)
  const body=JSON.parse(raw)
  if(!UUID.test(body.household_id)||!UUID.test(body.claim_id))return reply({error:'invalid'},400)
  const membership=await client.rpc('is_household_admin',{hid:body.household_id,uid:user.id})
  if(membership.error||membership.data!==true)return reply({error:'forbidden'},403)
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
  const claim=await admin.from('subscription_purchase_claims').select('id').eq('id',body.claim_id).eq('user_id',user.id).eq('household_id',body.household_id).gt('expires_at',new Date().toISOString()).maybeSingle()
  if(claim.error||!claim.data)return reply({error:'claim_expired'},409)
  const providerKey=Deno.env.get('REVENUECAT_SECRET_API_KEY')
  const mock=localMockAllowed(url,Deno.env.get('NATIVE50_MOCK_PROVIDER'))
  if(!providerKey&&!mock)return reply({error:'provider_not_configured'},503)
  const started=new Date().toISOString()
  const verified=mock?{status:'active',product_id:'local-review-only',store:'local_mock',period_end:new Date(Date.now()+30*86400000).toISOString(),will_renew:true}:
   await fetchSubscription(user.id,{key:providerKey!,allowSandbox:Deno.env.get('REVENUECAT_ALLOW_SANDBOX')==='true'})
  const result=await admin.rpc('apply_subscription_verification',{p_user_id:user.id,p_claim_id:body.claim_id,p_verified:verified,p_started_at:started})
  if(result.error) return reply({error:'verification_pending'},409)
  const access=await client.rpc('subscription_access',{p_household_id:body.household_id})
  if(access.error)return reply({error:'verification_pending'},503)
  return reply({access:access.data})
 }catch{return reply({error:'verification_unavailable'},503)}
}
if(import.meta.main)Deno.serve(handler)
