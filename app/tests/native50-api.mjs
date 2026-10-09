import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {localSupabase} from '../../scripts/local-supabase.mjs'
const local=localSupabase(),options={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,options),users=[],households=[],checks=[],events=[]
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data}
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+checks.length+': '+name)}
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_familiekalender','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim()
const make=async(role,hid,anonymous=false)=>{
 const c=createClient(local.API_URL,local.ANON_KEY,options);let user
 if(anonymous){user=(await must(c.auth.signInAnonymously())).user}else{const email='native50-'+randomUUID()+'@example.test',password=randomUUID()+'Aa!1';user=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user;await must(c.auth.signInWithPassword({email,password}))}
 users.push(user.id);if(hid)await must(admin.from('household_members').insert({household_id:hid,user_id:user.id,role}));return {c,id:user.id}
}
const call=(who,name,p={})=>must(who.c.rpc(name,p)),denied=async q=>{const r=await q;return !!r.error||r.data?.length===0}
let owner,member,other,wall,second,hid,otherHid
try{
 owner=await make();hid=await call(owner,'create_household',{p_name:'Native 5 local acceptance'});households.push(hid)
 member=await make('adult',hid);other=await make();otherHid=await call(other,'create_household',{p_name:'Native 5 other household'});households.push(otherHid)
 let access=await call(member,'subscription_access',{p_household_id:hid});check('Production rollout defaults OFF without fabricated entitlement',access.enabled===false&&access.entitled===false)
 const claim=await call(owner,'create_subscription_claim',{p_household_id:hid});check('Owner creates purchase claim',!!claim)
 const edge=async(who,body)=>{
  const session=who?await who.c.auth.getSession():null
  return fetch(local.API_URL+'/functions/v1/subscription-verify',{method:'POST',headers:{apikey:local.ANON_KEY,'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.data.session.access_token}:{})},body:JSON.stringify(body)})
 }
 check('Real Edge rejects missing user authentication',(await edge(null,{household_id:hid,claim_id:claim})).status===401)
 check('Real Edge rejects member purchase',(await edge(member,{household_id:hid,claim_id:claim})).status===403)
 check('Real Edge rejects cross-household purchase',(await edge(other,{household_id:hid,claim_id:claim})).status===403)
 check('Real Edge rejects a mismatched claim before provider verification',(await edge(owner,{household_id:hid,claim_id:randomUUID()})).status===409)
 check('Normal member cannot create purchase claim',await denied(member.c.rpc('create_subscription_claim',{p_household_id:hid})))
 check('Cross-household claim denied',await denied(other.c.rpc('create_subscription_claim',{p_household_id:hid})))
 check('Client cannot forge subscription status',await denied(owner.c.from('household_subscriptions').insert({household_id:hid,status:'active'})))
 check('Client cannot call server verification RPC',await denied(owner.c.rpc('apply_subscription_verification',{p_user_id:owner.id,p_claim_id:claim,p_verified:{status:'active'},p_started_at:new Date().toISOString()})))
 const verified={status:'active',period_end:new Date(Date.now()+86400000).toISOString(),product_id:'native50-synthetic-product',store:'app_store',will_renew:true}
 const verify=(state,event=randomUUID(),started=new Date().toISOString(),userId=owner.id,claimId=claim)=>{events.push(event);return must(admin.rpc('apply_subscription_verification',{p_user_id:userId,p_claim_id:claimId,p_verified:state,p_started_at:started,p_event_id:event,p_type:'LOCAL_ACCEPTANCE'}))}
 const event=randomUUID();await verify(verified,event)
 access=await call(owner,'subscription_access',{p_household_id:hid});check('Verified active entitlement grants owner access',access.entitled&&access.status==='active')
 check('Other household member shares access without own purchase',(await call(member,'subscription_access',{p_household_id:hid})).entitled)
 check('Other household denied subscription read',await denied(other.c.rpc('subscription_access',{p_household_id:hid})))
 check('Duplicate provider event idempotent',(await verify({...verified,status:'expired'},event)).duplicate===true)
 check('Duplicate event cannot revoke valid access',(await call(owner,'subscription_access',{p_household_id:hid})).entitled)
 await verify({...verified,status:'cancelled',will_renew:false});check('Cancelled remains entitled until actual end',(await call(owner,'subscription_access',{p_household_id:hid})).entitled)
 await verify({...verified,status:'grace'});check('Provider grace period retains entitlement',(await call(member,'subscription_access',{p_household_id:hid})).status==='grace')
 await verify({...verified,status:'expired',period_end:new Date(Date.now()-1000).toISOString()});check('Expired entitlement removes access',(await call(member,'subscription_access',{p_household_id:hid})).entitled===false)
 await verify(verified);await verify(verified);check('Restore updates same subscription row',(await must(admin.from('household_subscriptions').select('household_id').eq('household_id',hid))).length===1)
 await verify({...verified,status:'expired'},randomUUID(),'2000-01-01T00:00:00Z');check('Stale verification cannot overwrite newer provider state',(await call(owner,'subscription_access',{p_household_id:hid})).entitled)
 await must(admin.from('household_members').update({role:'adult'}).eq('household_id',hid).eq('user_id',owner.id))
 check('Final server write rejects a claimant whose admin access was removed',await denied(admin.rpc('apply_subscription_verification',{p_user_id:owner.id,p_claim_id:claim,p_verified:verified,p_started_at:new Date().toISOString()})))
 await must(admin.from('household_members').update({role:'owner'}).eq('household_id',hid).eq('user_id',owner.id))
 const unknown=await make();check('Unknown purchaser gets no household entitlement',(await verify(verified,randomUUID(),new Date().toISOString(),unknown.id,null)).mapped===false)
 await must(admin.from('household_members').insert({household_id:otherHid,user_id:owner.id,role:'admin'}));check('Purchaser cannot bind one purchase to a second household',await denied(owner.c.rpc('create_subscription_claim',{p_household_id:otherHid})))
 wall=await make(null,null,true)
 check('Real Edge rejects an anonymous display purchase',(await edge(wall,{household_id:hid,claim_id:claim})).status===401)
 check('Anonymous identity cannot create household',await denied(wall.c.rpc('create_household',{p_name:'Forbidden display family'})))
 check('Anonymous device cannot become household member',await denied(admin.from('household_members').insert({household_id:hid,user_id:wall.id,role:'adult'})))
 check('Member cannot generate pairing token',await denied(member.c.rpc('create_wall_pairing',{p_household_id:hid})))
 const pairing=await call(owner,'create_wall_pairing',{p_household_id:hid})
 const stored=await must(admin.from('device_pairing_codes').select('token_hash,short_code_hash,expires_at').eq('household_id',hid).single())
 check('Pairing contains a random opaque 256-bit token',/^[0-9a-f]{64}$/.test(pairing.token))
 check('Only token/code hashes are persisted',stored.token_hash!==pairing.token&&!JSON.stringify(stored).includes(pairing.code)&&stored.short_code_hash.length===64)
 check('Token lifetime at most ten minutes',Date.parse(stored.expires_at)-Date.now()<=600000)
 check('Client cannot read pairing hashes',await denied(owner.c.from('device_pairing_codes').select('*')))
 check('Wrong pairing code rejected',(await call(wall,'redeem_wall_pairing',{p_code:'00000-00000',p_platform:'android'})).error==='invalid')
 let paired=await call(wall,'redeem_wall_pairing',{p_code:pairing.token,p_platform:'android'});check('Anonymous auth maps to exactly one display device',paired.device.auth_user_id===wall.id&&paired.device.household_id===hid)
 const did=paired.device.id
 second=await make(null,null,true);check('Token is single use',(await call(second,'redeem_wall_pairing',{p_code:pairing.token,p_platform:'web'})).error==='invalid')
 const code=await call(owner,'create_wall_pairing',{p_household_id:hid});paired=await call(second,'redeem_wall_pairing',{p_code:code.code,p_platform:'ios'});check('Short fallback code also pairs',paired.device?.household_id===hid)
 const person=(await must(owner.c.from('household_people').insert({household_id:hid,name:'Testbarn',role:'child',reward_enabled:true}).select().single()))
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
 const item=await must(owner.c.from('calendar_items').insert({household_id:hid,created_by:owner.id,title:'Dæk testbord',type:'Opgave',date:today,data:{repeatWeekly:true,sourceUrl:'https://private.example.test/never-display'}}).select().single())
 let snapshot=await call(wall,'wall_snapshot');check('Wall reads only its paired household',snapshot.household.id===hid&&snapshot.people.some(p=>p.id===person.id)&&snapshot.items.some(i=>i.id===item.id))
 check('Wall snapshot excludes source payload/private links',!JSON.stringify(snapshot).includes('private.example.test'))
 // The rollout switch and expiry are changed only inside this rolled-back local transaction.
 const enforcement=sql(`begin;
 update private.subscription_config set enforcement_enabled=true;
 set local role authenticated;
 set local request.jwt.claims='${JSON.stringify({sub:wall.id,role:'authenticated',is_anonymous:true})}';
 select 'ACTIVE='||((public.wall_snapshot()->'access'->>'entitled')::boolean and public.wall_snapshot() ? 'items')::text;
 reset role;
 update public.household_subscriptions set current_period_end=now()-interval '1 second' where household_id='${hid}';
 set local role authenticated;
 select 'EXPIRED='||((public.wall_snapshot()->'access'->>'entitled')::boolean=false and not(public.wall_snapshot() ? 'items'))::text;
 rollback;`)
 check('Real server enforcement serves active wall and withholds expired family data',enforcement.includes('ACTIVE=true')&&enforcement.includes('EXPIRED=true'))
 check('Wall cannot read raw calendar/feed/member data',(await must(wall.c.from('calendar_items').select('id'))).length===0&&(await must(wall.c.from('calendar_feeds').select('feed_url'))).length===0&&(await must(wall.c.from('household_members').select('*'))).length===0)
 check('Wall cannot manage billing',await denied(wall.c.rpc('create_subscription_claim',{p_household_id:hid})))
 check('Wall cannot mutate arbitrary calendar rows',await denied(wall.c.from('calendar_items').update({title:'Forbidden'}).eq('id',item.id).select()))
 await call(wall,'complete_task_as_device',{p_request_id:randomUUID(),p_item_id:item.id,p_due_date:today,p_done:true});snapshot=await call(wall,'wall_snapshot')
 check('Ordinary recurring task completion is limited to one occurrence',snapshot.items.some(i=>i.data.overrideBaseId===item.id&&i.done)&&snapshot.items.find(i=>i.id===item.id).done===false)
 const bonus=await must(owner.c.from('calendar_items').insert({household_id:hid,created_by:owner.id,title:'Bonus local',type:'Opgave',date:today,person_ids:[person.id],data:{rewardMode:'stars',starValue:3}}).select().single())
 const args={p_request_id:randomUUID(),p_item_id:bonus.id,p_due_date:today,p_person_id:person.id};await call(wall,'complete_task_as_device',args);await call(wall,'complete_task_as_device',args)
 snapshot=await call(wall,'wall_snapshot');check('Limited reward completion reuses ledger idempotency',Number(snapshot.rewards.balances.find(b=>b.person_id===person.id)?.balance)===3)
 check('Wall cannot approve/configure rewards',await denied(wall.c.rpc('reward_action',{p_request_id:randomUUID(),p_household_id:hid,p_action:'config',p_payload:{person_id:person.id}})))
 await call(owner,'manage_wall_device',{p_device_id:did,p_action:'name',p_name:'Køkken'});check('Admin can rename paired display',(await call(wall,'wall_snapshot')).device.name==='Køkken')
 check('Cross-household revoke denied',await denied(other.c.rpc('manage_wall_device',{p_device_id:did,p_action:'revoke'})))
 await call(owner,'manage_wall_device',{p_device_id:did,p_action:'revoke'});check('Revoked device immediately loses snapshot access',await denied(wall.c.rpc('wall_snapshot')))
 check('Revoked device cannot complete tasks',await denied(wall.c.rpc('complete_task_as_device',args)))
 const expired=await call(owner,'create_wall_pairing',{p_household_id:hid});await must(admin.from('device_pairing_codes').update({expires_at:new Date(Date.now()-1000).toISOString()}).eq('household_id',hid).is('used_at',null))
 const third=await make(null,null,true);check('Expired token denied',(await call(third,'redeem_wall_pairing',{p_code:expired.token,p_platform:'web'})).error==='invalid')
 for(let n=0;n<8;n++)paired=await call(third,'redeem_wall_pairing',{p_code:'00000-00000',p_platform:'web'})
 check('Brute-force attempts rate limited with durable counter',paired.error==='rate_limited')
 check('Enforcement remains OFF after all tests',sql('select enforcement_enabled from private.subscription_config')==='f')
 mkdirSync('supabase/.temp/native50',{recursive:true});writeFileSync('supabase/.temp/native50/api-results.json',JSON.stringify({checks},null,2));console.log('NATIVE50 API PASS '+checks.length)
}finally{
 if(events.length)await admin.from('subscription_events').delete().in('provider_event_id',[...new Set(events)])
 for(const hid of households)await admin.from('households').delete().eq('id',hid)
 for(const id of users)await admin.auth.admin.deleteUser(id)
}
