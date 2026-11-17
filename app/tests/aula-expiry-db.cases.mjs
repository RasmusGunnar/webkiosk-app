import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {reviewIdentity} from '../server/aula/review-memory.ts'
import {sourceKey} from '../server/aula/security.ts'

export async function expiryChecks({query,ids,server,review,actor,pass,denied}){
 await actor(null,'service_role')
 const dates=(await query("select (now() at time zone 'Europe/Copenhagen')::date::text today,((now() at time zone 'Europe/Copenhagen')::date-1)::text past,((now() at time zone 'Europe/Copenhagen')::date+7)::text future")).rows[0]
 for(const [instant,date,end,current] of [
  ['2026-11-12T23:01Z','2026-11-13',null,true],['2026-11-13T22:59Z','2026-11-13',null,true],['2026-11-13T23:01Z','2026-11-13',null,false],
  ['2026-07-13T21:59Z','2026-07-13',null,true],['2026-07-13T22:01Z','2026-07-13',null,false],
  ['2026-03-29T21:59Z','2026-03-29',null,true],['2026-03-29T22:01Z','2026-03-29',null,false],
  ['2026-10-25T22:59Z','2026-10-25',null,true],['2026-10-25T23:01Z','2026-10-25',null,false],
  ['2026-11-15T22:59Z','2026-11-13','2026-11-15',true],['2026-11-15T23:01Z','2026-11-13','2026-11-15',false],
  ['2099-01-01T12:00Z',null,null,true],['2099-01-01T12:00Z',null,'2001-01-01',true]
 ])assert.equal((await query('select private.aula_finding_current($1,$2,$3) value',[date,end,instant])).rows[0].value,current)
 pass('Expiry SQL: inclusive day/end day, CET, CEST, both DST boundaries, dateless with/without end date')
 const hash=()=>randomBytes(32).toString('hex')
 const source={source_key:hash(),origin_source_key:hash(),source_kind:'message',text:'Husk paprør '+dates.past,title:'Paprør',updated_at:new Date().toISOString(),person_ids:[ids.person],date:dates.past,time:null,end_date:null,end_time:null,location:''}
 const proposal=(s=source,extra={})=>{const f={source_kind:s.source_kind,person_ids:[ids.person],title:'Husk paprør',type:'REMINDER',date:s.date,time:null,end_date:null,end_time:null,location:'',confidence:'HIGH',reason:'Konkret handling',summary:'Syntetisk test',proposed_action:'CREATE_ACTIVITY',evidence:s.text,...extra};const identity=reviewIdentity(ids.hid,s,f);return {...f,identity,source_key:sourceKey(ids.hid,'finding-v2',identity.action_key+':'+identity.material_revision)}}
 const upload=async(findings,bindings=[])=>{const c=await server('scan_claim');return server('scan_finish',{lease:c.lease,children:[],findings,bindings,counts:{},api_version:25})}
 // Fixture setup only: production can call store only through its fenced gateway.
 const store=async findings=>{await query('reset role');return(await query('select private.aula_store_findings($1,$2) value',[ids.hid,JSON.stringify({findings})])).rows[0].value}
 const row=async key=>{await actor(null,'service_role');return(await query('select * from public.aula_findings where household_id=$1 and source_key=$2',[ids.hid,key])).rows[0]}
 const expired=proposal(),today=proposal({...source,origin_source_key:hash(),date:dates.today}),future=proposal({...source,origin_source_key:hash(),date:dates.future})
 const dateless=proposal({...source,origin_source_key:hash(),date:null},{end_date:dates.past}),multi=proposal({...source,origin_source_key:hash()},{end_date:dates.future})
 await store([expired,today,future,dateless,multi])
 const beforeCleanup=await server('status')
 assert.ok(!beforeCleanup.findings.some(f=>f.source_key===expired.source_key))
 for(const f of [today,future,dateless,multi])assert.equal(beforeCleanup.findings.find(r=>r.source_key===f.source_key)?.status,'new')
 assert.ok(beforeCleanup.findings.some(f=>f.status==='accepted'))
 pass('Status hides expired NEW before any scan/cleanup, retains multi-day/dateless and recent accepted history')
 const expiredRow=await row(expired.source_key)
 await denied('Old client cannot accept expired NEW or override it into the future',async()=>{
  await actor(ids.adult);await query('select public.aula_review($1,$2,$3,null,$4)',[ids.hid,expiredRow.id,'accept',dates.future])
 })
 const protectedState=async()=>{
  await query('reset role')
  const result={}
  for(const table of ['calendar_items','aula_child_mappings','aula_connections','aula_findings']){
   const filter=table==='aula_findings'?" and status in ('accepted','ignored')":''
   result[table]=(await query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') value from public.${table} t where household_id=$1${filter}`,[ids.hid])).rows[0].value
  }
  result.credentials=(await query('select to_jsonb(t) value from private.aula_credentials t where household_id=$1',[ids.hid])).rows[0].value
  return result
 }
 const before=await protectedState()
 assert.equal((await query('select private.aula_expire_findings($1) count',[ids.hid])).rows[0].count,1)
 assert.equal((await row(expired.source_key)).status,'stale')
 assert.deepEqual(await protectedState(),before)
 assert.equal((await query('select private.aula_expire_findings($1) count',[ids.hid])).rows[0].count,0)
 pass('Cleanup affects only expired NEW once; accepted, ignored, calendar, mappings, connection and session bytes unchanged')
 for(const extra of [{},{title:'Medbring paprør',date:dates.future,source_key:hash()}]){
  const result=await upload([{...expired,...extra}]);assert.equal(result.memory_counts.previously_expired,1);assert.equal(result.memory_counts.findings_stored,0)
 }
 assert.equal((await row(expired.source_key)).status,'stale')
 pass('Expired identity: zero resurrection on identical scan or AI-only future date/title/key drift')
 const changed=proposal({...source,text:'Husk paprør '+dates.future,date:dates.future})
 assert.equal(changed.identity.action_key,expired.identity.action_key)
 assert.notEqual(changed.identity.source_revision,expired.identity.source_revision)
 assert.notEqual(changed.identity.material_revision,expired.identity.material_revision)
 assert.equal((await upload([changed])).memory_counts.material_updates,1)
 const updated=(await server('status')).findings.find(f=>f.source_key===changed.source_key)
 assert.equal(updated.status,'new');assert.equal(updated.review_state,'UPDATED');assert.equal(updated.date,dates.future)
 pass('Real source/material change to a future date produces a new UPDATED finding')
 // The latest actual decision remains authoritative even if an expiry marker
 // exists for an older revision. This creates no calendar item.
 await review(updated.id,'ignore')
 const decided=await upload([{...changed,title:'Paraphrase after ignore'}]);assert.equal(decided.memory_counts.previously_ignored,1)
 pass('Actual ignored decision still takes precedence over older expiry history')
 const ordinary=proposal({...source,origin_source_key:hash(),date:dates.future})
 await store([ordinary]);const ordinaryRow=await row(ordinary.source_key)
 await query("update public.aula_findings set status='stale' where id=$1",[ordinaryRow.id])
 const anotherKey={...ordinary,source_key:hash()};await upload([anotherKey])
 assert.equal((await row(anotherKey.source_key)).status,'new')
 pass('Unmarked duplicate/history STALE does not acquire suppressive expiry semantics')
 const legacy=proposal({...source,origin_source_key:hash()});await store([{...legacy,identity:undefined}])
 const legacyRow=await row(legacy.source_key)
 await query('select private.aula_expire_findings($1)',[ids.hid])
 const bound=await upload([{...legacy,source_key:hash()}],[{finding_id:legacyRow.id,identity:legacy.identity}])
 assert.equal(bound.memory_counts.previously_expired,1)
 pass('Legacy identity bound after expiry still suppresses the unchanged source/action')
 // Expire existing pending rows before store: AI drift cannot refresh yesterday
 // into tomorrow just because no scheduled cleanup has run since midnight.
 const unclean=proposal({...source,origin_source_key:hash()});await store([unclean])
 assert.equal((await upload([{...unclean,date:dates.future}])).memory_counts.previously_expired,1)
 assert.equal((await row(unclean.source_key)).status,'stale')
 pass('scan_finish expires old pending rows before refreshing and expires newly ingested past rows after store')
 for(const role of ['anon','authenticated']){
  await actor(ids.adult,role)
  await denied(role+' cannot read expiry markers',()=>query('select * from private.aula_expired_findings'))
  await denied(role+' cannot invoke expiry cleanup',()=>query('select private.aula_expire_findings()'))
 }
}
