import {assertEquals,assertRejects,assertThrows} from 'jsr:@std/assert@1'
import {subscriptionSnapshot,validSecret,webhookEvent,fetchSubscription,localMockAllowed,providerEventId} from '../_shared/subscription.ts'
import {handler as webhook} from '../revenuecat-webhook/index.ts'
const now=Date.parse('2026-10-09T00:00:00Z'),future=new Date(now+86400000).toISOString()
const fixture=(sub:Record<string,unknown>={})=>({subscriber:{entitlements:{family_access:{product_identifier:'configured-product',expires_date:future}},subscriptions:{'configured-product':{store:'app_store',is_sandbox:false,...sub}}}})
Deno.test('Mock verification requires explicit flag AND a local HTTP Supabase target',()=>{
 assertEquals(localMockAllowed('http://kong:8000','true'),true)
 assertEquals(localMockAllowed('http://127.0.0.1:47321','true'),true)
 assertEquals(localMockAllowed('https://real.supabase.co','true'),false)
 assertEquals(localMockAllowed('http://localhost','false'),false)
 assertEquals(localMockAllowed('https://kong','true'),false)
})
Deno.test('Subscription states from verified provider data, not client flags',()=>{
 assertEquals(subscriptionSnapshot(fixture(),now).status,'active')
 assertEquals(subscriptionSnapshot(fixture({period_type:'trial'}),now).status,'trialing')
 assertEquals(subscriptionSnapshot(fixture({unsubscribe_detected_at:future}),now).status,'cancelled')
 assertEquals(subscriptionSnapshot(fixture({billing_issues_detected_at:future}),now).status,'billing_issue')
 assertEquals(subscriptionSnapshot(fixture(),now+86400001).status,'expired')
 const grace=fixture({grace_period_expires_date:future});grace.subscriber.entitlements.family_access.expires_date=new Date(now-1).toISOString()
 assertEquals(subscriptionSnapshot(grace,now).status,'grace')
 assertEquals(subscriptionSnapshot({subscriber:{entitlements:{}}},now).status,'expired')
 assertThrows(()=>subscriptionSnapshot({entitled:true}))
})
Deno.test('Sandbox purchases cannot grant production access by default',()=>{
 assertEquals(subscriptionSnapshot(fixture({is_sandbox:true}),now).status,'expired')
 assertEquals(subscriptionSnapshot(fixture({is_sandbox:true}),now,true).status,'active')
})
Deno.test('Secret required and exact; no weak/empty secret accepted',async()=>{
 const secret=crypto.randomUUID();assertEquals(await validSecret('Bearer '+secret,secret),true)
 assertEquals(await validSecret(null,secret),false);assertEquals(await validSecret('Bearer wrong',secret),false);assertEquals(await validSecret('Bearer ',''),false)
})
Deno.test('Webhook rejects no/wrong secret, malformed; accepts authenticated test without side effects',async()=>{
 const secret=crypto.randomUUID();Deno.env.set('REVENUECAT_WEBHOOK_SECRET',secret)
 try{
 const req=(authorization:string,body:unknown)=>new Request('http://local/webhook',{method:'POST',headers:{Authorization:authorization},body:JSON.stringify(body)})
 assertEquals((await webhook(req('',{}))).status,401)
 assertEquals((await webhook(req('Bearer wrong',{}))).status,401)
 assertEquals((await webhook(req('Bearer '+secret,{}))).status,400)
 assertEquals((await webhook(req('Bearer '+secret,{api_version:'1.0',event:{id:'safe-test',type:'TEST'}}))).status,200)
 }finally{Deno.env.delete('REVENUECAT_WEBHOOK_SECRET')}
})
Deno.test('Webhook mapping ignores supplied household/customer attributes; transfer verifies both UUIDs',()=>{
 const a=crypto.randomUUID(),b=crypto.randomUUID()
 assertEquals(webhookEvent({api_version:'1.0',event:{id:'event',type:'RENEWAL',app_user_id:a,household_id:b,subscriber_attributes:{household_id:b}}}).users,[a])
 assertEquals(webhookEvent({api_version:'1.0',event:{id:'event',type:'TRANSFER',transferred_from:[a],transferred_to:[b]}}).users,[a,b])
 assertEquals(webhookEvent({api_version:'1.0',event:{id:'event',type:'RENEWAL',app_user_id:'email@example.test'}}).users,[])
 assertThrows(()=>webhookEvent({event:{id:'x',type:'INITIAL_PURCHASE'}}))
})
Deno.test('Server verification fetches only the fixed provider API; no redirects or failed-response trust',async()=>{
 const id=crypto.randomUUID();let called=false
 const result=await fetchSubscription(id,{key:'server-test-key',fetcher:async(input,init)=>{called=true;assertEquals(String(input),'https://api.revenuecat.com/v1/subscribers/'+id);assertEquals(init?.redirect,'error');return Response.json(fixture())}})
 assertEquals(called,true);assertEquals(result.product_id,'configured-product')
 await assertRejects(()=>fetchSubscription(id,{key:'server-test-key',fetcher:async()=>new Response('',{status:503})}))
})
Deno.test('Transfer idempotency keys are stable, distinct per customer and fit the DB limit',async()=>{
 const event={id:'e'.repeat(200),type:'TRANSFER'},a=crypto.randomUUID(),b=crypto.randomUUID()
 const first=await providerEventId(event,a)
 assertEquals(first,await providerEventId(event,a));assertEquals(first.length<=200,true)
 assertEquals(first===await providerEventId(event,b),false)
 assertEquals(await providerEventId({...event,type:'RENEWAL'},a),event.id)
})
