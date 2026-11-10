// Real local Auth -> PostgREST -> SQL, synthetic records only, no Aula network.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {localEnvironment,localFixture} from '../scripts/aula-local.mjs'
const env=localEnvironment(),f=await localFixture(env),ids=[],items=[]
const check=result=>{if(result.error)throw Error('LOCAL_API_'+result.error.code);return result.data}
const make=async()=>{const id=randomUUID();check(await f.db.from('aula_findings').insert({id,household_id:f.household.id,person_ids:[f.people[0].id],source_kind:'message',source_key:randomUUID().replaceAll('-','').repeat(2),type:'REMINDER',title:'Synthetic unknown date',date:null,confidence:'MEDIUM',summary:'Synthetic fixture',reason:'Synthetic fixture',proposed_action:'CREATE_ACTIVITY'}));ids.push(id);return id}
try{
 const c=check(await f.db.from('aula_connections').select('household_id').eq('household_id',f.household.id));if(!c.length)check(await f.db.from('aula_connections').insert({household_id:f.household.id,created_by:f.user.id,status:'disconnected'}))
 const id=await make(),payload={p_household_id:f.household.id,p_finding_id:id,p_action:'accept',p_person_ids:f.people.slice(0,2).map(p=>p.id),p_date:'2026-11-12',p_time:null,p_title:'Synthetic corrected activity',p_override_time:true}
 const anon=createClient(env.SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false}})
 assert.ok((await anon.rpc('aula_review',payload)).error)
 assert.ok((await f.client.rpc('aula_review',{...payload,p_person_ids:[randomUUID()]})).error)
 assert.ok((await f.client.rpc('aula_review',{...payload,p_date:'2026-02-30'})).error)
 assert.ok((await f.client.rpc('aula_review',{...payload,p_household_id:randomUUID()})).error)
 const [a,b]=await Promise.all([f.client.rpc('aula_review',payload),f.client.rpc('aula_review',payload)]);const first=check(a),second=check(b);items.push(first.item_id);assert.equal(first.item_id,second.item_id)
 const row=check(await f.client.from('calendar_items').select('type,title,date,time,person_ids,data').eq('id',first.item_id).single());assert.equal(row.type,'Aktivitet');assert.equal(row.date,'2026-11-12');assert.equal(row.title,payload.p_title);assert.ok(!row.time);assert.equal(row.person_ids.length,2);assert.equal(row.data.aulaAssisted,true);assert.equal(row.data.rewardMode,undefined)
 const legacy=check(await f.client.rpc('aula_review',{p_household_id:f.household.id,p_finding_id:id,p_action:'accept'}));assert.equal(legacy.item_id,first.item_id)
 console.log('AULA_REVIEW_API PASS: actual Auth/PostgREST contract, concurrent idempotency, null time, overrides, isolation and legacy default arguments')
}finally{
 if(ids.length)check(await f.db.from('aula_findings').delete().in('id',ids))
 if(items.length)check(await f.db.from('calendar_items').delete().in('id',items))
}
