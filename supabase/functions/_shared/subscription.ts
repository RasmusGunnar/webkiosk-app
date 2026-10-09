// RevenueCat's REST snapshot is authoritative. Webhook/client payloads never grant access.
export const FAMILY_ENTITLEMENT = 'family_access'
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function localMockAllowed(url:string,flag:string|undefined){
 try{const u=new URL(url);return flag==='true'&&u.protocol==='http:'&&['127.0.0.1','localhost','kong','supabase_kong_familiekalender'].includes(u.hostname)}catch{return false}
}
export async function validSecret(actual: string | null, expected: string | undefined) {
 if (!expected || expected.length < 24 || !actual) return false
 const digest = async (v: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))
 const [a,b] = await Promise.all([digest(actual),digest('Bearer '+expected)])
 let diff=0; for(let i=0;i<a.length;i++) diff|=a[i]^b[i]
 return diff===0
}
const date = (value: unknown): number => typeof value==='string' ? Date.parse(value) : NaN
export function subscriptionSnapshot(input: any, now=Date.now(), allowSandbox=false) {
 const subscriber=input?.subscriber, entitlement=subscriber?.entitlements?.[FAMILY_ENTITLEMENT]
 if (!subscriber || typeof subscriber!=='object') throw Error('Invalid provider response')
 const product=entitlement?.product_identifier, subscription=subscriber.subscriptions?.[product]
 const expired={status:'expired',product_id:product||null,store:subscription?.store||null,period_end:null,will_renew:false}
 if(!entitlement || !subscription || (!allowSandbox&&subscription.is_sandbox)) return expired
 const expiry=date(entitlement.expires_date), grace=date(subscription.grace_period_expires_date)
 const until=Math.max(Number.isFinite(expiry)?expiry:0,Number.isFinite(grace)?grace:0)
 if(!until)return {...expired,status:'pending'}
 const status=until<=now?'expired':grace>now&&expiry<=now?'grace':subscription.billing_issues_detected_at?'billing_issue':subscription.unsubscribe_detected_at?'cancelled':subscription.period_type==='trial'?'trialing':'active'
 return {status,product_id:product,store:subscription.store||null,period_end:new Date(until).toISOString(),will_renew:!subscription.unsubscribe_detected_at}
}
export function webhookEvent(body: any) {
 const e=body?.event
 if(body?.api_version!=='1.0'||!e||typeof e.id!=='string'||!e.id.length||e.id.length>200||typeof e.type!=='string'||!/^[A-Z_]{1,80}$/.test(e.type))throw Error('Invalid event')
 // Transfers require refreshing both sides. Never infer ownership from attributes/household IDs.
 const ids=e.type==='TRANSFER'?[...(e.transferred_from||[]),...(e.transferred_to||[])]:[e.app_user_id]
 return {id:e.id,type:e.type,users:[...new Set(ids.filter((v: unknown)=>typeof v==='string'&&UUID.test(v as string)))].slice(0,20) as string[]}
}
export async function providerEventId(event:{id:string,type:string},userId:string){
 if(event.type!=='TRANSFER')return event.id
 // Bounded, collision-resistant identity even for a maximum-length provider event ID.
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([event.id,userId])))
 return 'transfer:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')
}
export async function fetchSubscription(userId:string,{key,fetcher=fetch,allowSandbox=false}:{key:string,fetcher?:typeof fetch,allowSandbox?:boolean}) {
 if(!UUID.test(userId)||!key)throw Error('Provider not configured')
 const response=await fetcher('https://api.revenuecat.com/v1/subscribers/'+encodeURIComponent(userId),{
  headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(8000),redirect:'error'
 })
 if(!response.ok)throw Error('Provider verification unavailable')
 return subscriptionSnapshot(await response.json(),Date.now(),allowSandbox)
}
