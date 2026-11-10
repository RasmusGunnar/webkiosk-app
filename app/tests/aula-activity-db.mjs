// Actual local PostgreSQL/WASM functions, no network or hosted data.
import {createRequire} from 'node:module'
import {readFileSync,readdirSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {schoolExamples,ida,carl} from './aula-activity.fixtures.js'
const repo=process.env.AULA_TEST_REPO?pathToFileURL(process.env.AULA_TEST_REPO.replaceAll('\\','/')+'/'):new URL('../../',import.meta.url)
const require=createRequire(new URL('app/package.json',repo)),{PGlite}=require('@electric-sql/pglite')
const db=new PGlite(),q=(sql,params=[])=>db.query(sql,params),checks=[]
let failed=false
const pass=name=>{checks.push(name);console.log('PASS '+name)}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;create schema extensions;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
 grant usage on schema auth,storage to authenticated,service_role;grant all on all tables in schema auth,storage to service_role;
 alter default privileges in schema public grant all on tables to authenticated,service_role;`)
 const migrations=new URL('supabase/migrations/',repo),aula='20261109120555_aula_integration_10.sql'
 for(const name of readdirSync(migrations).filter(n=>n.endsWith('.sql')&&n<aula&&!n.includes('calendar_import_cron')).sort())try{await db.exec(readFileSync(new URL(name,migrations),'utf8').replaceAll('\r\n','\n'))}catch(e){throw Error(name+': '+e.code+' '+e.message)}
 // Use this checkout's proposed migration when testing an isolated patch.
 await db.exec(readFileSync(new URL('../../supabase/migrations/'+aula,import.meta.url),'utf8'))
 await db.exec(readFileSync(new URL('../../supabase/migrations/20261110124355_aula_review_overrides.sql',import.meta.url),'utf8'))
 pass('Actual migrations and Aula acceptance function apply locally')
 const adult=randomUUID(),child=randomUUID(),stranger=randomUUID(),hid=randomUUID(),otherHid=randomUUID(),outsider=randomUUID()
 await q('insert into auth.users(id) values($1),($2),($3)',[adult,child,stranger])
 await q("insert into public.households(id,name,created_by) values($1,'Aula fixture',$3),($2,'Other family',$4)",[hid,otherHid,adult,stranger])
 await q("insert into public.household_members(household_id,user_id,role) values($1,$2,'owner'),($1,$3,'child') on conflict do nothing",[hid,adult,child])
 await q("insert into public.household_people(id,household_id,name,role,color,avatar_url) values($1,$3,'Ida','child','#b98486','https://example.test/ida.png'),($2,$3,'Carl','child','#8e9e65',null),($4,$5,'Other','child','#000000',null)",[ida,carl,hid,outsider,otherHid])
 await q("insert into public.aula_connections(household_id,created_by,status) values($1,$2,'connected')",[hid,adult])
 const actor=async(uid=adult)=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[uid||'']);if(uid)await db.exec('set role authenticated')}
 const make=async({type='REMINDER',title='Husk tuscher',date='2026-11-11',ids=[ida],action='CREATE_ACTIVITY',confidence='HIGH',extra={}}={})=>{
  await actor(null);const id=randomUUID(),key=randomUUID().replaceAll('-','').repeat(2)
  await q("insert into public.aula_findings(id,household_id,person_id,person_ids,source_kind,source_key,type,title,date,confidence,reason,summary,proposed_action,end_date,end_time,time) values($1,$2,$3,$4,'message',$5,$6,$7,$8,$9,'Synthetic reason','Synthetic summary',$10,$11,$12,$13)",[id,hid,ids.length===1?ids[0]:null,ids,key,type,title,date,confidence,action,extra.end_date||null,extra.end_time||null,extra.time||null]);return id
 }
 const review=async(id,selected=null,uid=adult,action='accept')=>{await actor(uid);return (await q('select public.aula_review($1,$2,$3,$4::uuid[]) result',[hid,id,action,selected])).rows[0].result}
 const item=async id=>(await q('select to_jsonb(i) row from public.calendar_items i where id=$1',[id])).rows[0].row
 const before=async()=>{await actor(null);const result={};for(const table of ['task_reward_occurrences','star_ledger','allowance_contracts']){const exists=(await q('select to_regclass($1) present',['public.'+table])).rows[0].present;if(exists)result[table]=(await q('select to_jsonb(t) row from public.'+table+' t')).rows}return result}
 const rewardBefore=await before()
 for(const [type,title,date]of schoolExamples){
  const fid=await make({type,title,date}),accepted=await review(fid),row=await item(accepted.item_id)
  assert.equal(row.type,'Aktivitet');assert.deepEqual(row.person_ids,[ida]);assert.deepEqual(row.data.personIds,[ida]);assert.equal(row.person,'Ida');assert.equal(row.done,false)
  assert.equal(row.data.aulaAssisted,true);assert.equal(row.source,null);assert.equal(row.title,title);assert.equal(row.date,date)
  for(const key of ['rewardMode','starValue','requiresApproval','allowanceContractId','rewardOriginId','color'])assert.equal(row.data[key],undefined)
  assert.equal((await review(fid)).item_id,row.id)
  await actor(null);assert.equal((await q('select * from private.reward_task_instances($1,$2,$2) where task_id=$3',[hid,date,row.id])).rows.length,0)
  await actor(adult);await assert.rejects(q('select public.reward_action($1,$2,$3,$4::jsonb)',[randomUUID(),hid,'complete',JSON.stringify({person_id:ida,item_id:row.id,occurrence_date:date,due_date:date})]))
  pass(type+': '+title+' creates only an activity, is idempotent and cannot complete as a chore')
 }
 assert.deepEqual(await before(),rewardBefore);pass('No task occurrences, star ledger or allowance contracts changed')
 const shared=await make({title:'Fælles skolearrangement',ids:[ida,carl]})
 const sharedResult=await review(shared),sharedRow=await item(sharedResult.item_id)
 assert.deepEqual([...sharedRow.person_ids].sort(),[ida,carl].sort());assert.equal(sharedRow.data.people.length,2)
 assert.equal((await q('select person_id from public.aula_findings where id=$1',[shared])).rows[0].person_id,null)
 pass('Multiple people remain one activity with exact IDs and standard people mirror')
 const changed=await make({title:'Vælg Carl'}),changedResult=await review(changed,[carl,carl])
 assert.deepEqual((await item(changedResult.item_id)).person_ids,[carl]);assert.equal((await q('select person_id from public.aula_findings where id=$1',[changed])).rows[0].person_id,carl)
 pass('Review selection overrides suggested person precisely and removes duplicate IDs')
 for(const ids of [[],[outsider],[null]]){const fid=await make();await assert.rejects(review(fid,ids),/AULA_INVALID_MAPPING/)}
 const restricted=await make();for(const uid of [child,stranger])await assert.rejects(review(restricted,null,uid),/AULA_FORBIDDEN/)
 pass('Empty, unknown, cross-household people and unauthorized reviewers fail')
 const existing=await make({title:'Fælles skolearrangement',ids:[carl,ida],action:'MATCH_EXISTING'})
 assert.equal((await review(existing)).item_id,sharedRow.id)
 const subset=await make({title:'Fælles skolearrangement',ids:[ida]})
 assert.notEqual((await review(subset)).item_id,sharedRow.id)
 pass('Existing match requires exactly the same people; a subset creates its own activity')
 const choreId=randomUUID();await actor(null)
 await q("insert into public.calendar_items(id,household_id,created_by,title,date,type,person_ids,data) values($1,$2,$3,'Samme titel','2026-11-11','Opgave',$4,'{}')",[choreId,hid,adult,[ida]])
 const sameTitle=await make({title:'Samme titel'}),sameResult=await review(sameTitle)
 assert.notEqual(sameResult.item_id,choreId);assert.equal((await item(sameResult.item_id)).type,'Aktivitet');assert.equal((await item(choreId)).type,'Opgave')
 pass('A matching family chore is neither reused nor modified')
 for(const values of [{type:'GENERAL_INFO'},{action:'NO_ACTION'}]){const fid=await make(values);assert.equal((await review(fid)).item_id,undefined)}
 for(const values of [{date:null},{confidence:'LOW'}]){const fid=await make(values);await assert.rejects(review(fid),/AULA_REVIEW_REQUIRED/)}
 for(const action of ['CREATE_TASK','CREATE_EVENT'])await assert.rejects(make({action}),e=>e.code==='23514')
 pass('No-action/info creates nothing; missing date, low confidence and obsolete actions fail closed')
 const trip=await make({type:'TRIP',title:'Lejrskole',extra:{end_date:'2026-11-13'}}),tripRow=await item((await review(trip)).item_id)
 assert.equal(tripRow.end_date,'2026-11-13');assert.equal(tripRow.all_day,true)
 pass('Activity interval survives the existing calendar mutation API')

 const corrected=async(fid,patch={},uid=adult)=>{await actor(uid);return (await q('select public.aula_review($1,$2,$3,$4::uuid[],$5,$6,$7,$8) result',[hid,fid,'accept',patch.people??[carl],patch.date??'2026-11-12',patch.time??null,patch.title??'Corrected title',patch.overrideTime??true])).rows[0].result}
 const missing=await make({date:null,confidence:'MEDIUM'}),fixed=await corrected(missing),fixedRow=await item(fixed.item_id)
 assert.equal(fixedRow.date,'2026-11-12');assert.equal(fixedRow.time||null,null);assert.equal(fixedRow.all_day,true);assert.equal(fixedRow.title,'Corrected title');assert.deepEqual(fixedRow.person_ids,[carl]);assert.equal(fixedRow.type,'Aktivitet');assert.equal(fixedRow.data.aulaAssisted,true)
 assert.equal((await corrected(missing,{date:'2026-12-01',title:'Second click'})).item_id,fixed.item_id);assert.equal((await item(fixed.item_id)).title,'Corrected title')
 const snapshot=(await q('select title,date,time,status from public.aula_findings where id=$1',[missing])).rows[0];assert.equal(snapshot.status,'accepted');assert.equal(snapshot.title,'Corrected title')
 pass('Missing date, null time, edited title/person create activity; final snapshot and duplicate-accept idempotency preserved')
 const timed=await make({extra:{time:'14:00',end_time:'15:30'}}),moved=await corrected(timed,{date:'2026-11-14',time:'16:00',people:[ida,carl]}),movedRow=await item(moved.item_id)
 assert.equal(movedRow.date,'2026-11-14');assert.equal(movedRow.time,'16:00');assert.equal(movedRow.end_time.slice(0,5),'17:30');assert.deepEqual(movedRow.person_ids,[ida,carl])
 const clear=await make({extra:{time:'14:00',end_time:'15:00'}}),cleared=await item((await corrected(clear)).item_id);assert.equal(cleared.time||null,null);assert.equal(cleared.end_time||null,null);assert.equal(cleared.all_day,true)
 const legacy=await make({extra:{time:'14:00'}});assert.equal((await item((await review(legacy)).item_id)).time,'14:00')
 pass('Existing date/time can change; interval duration, multiple people and old-client omission are safe; explicit null clears time')
 for(const patch of [{date:'2026-02-30'},{date:'12/11/2026'},{date:''},{time:'24:00'},{time:'8:30'},{time:''},{title:'   '},{title:'x'.repeat(161)},{people:[outsider]},{people:[]}]){const fid=await make({title:'Keep original'});await assert.rejects(corrected(fid,patch));await actor(null);const unchanged=(await q('select title,date::text,status from public.aula_findings where id=$1',[fid])).rows[0];assert.equal(unchanged.title,'Keep original');assert.equal(unchanged.status,'new');assert.equal(unchanged.date,'2026-11-11')}
 const guarded=await make();for(const uid of [child,stranger])await assert.rejects(corrected(guarded,{},uid),/AULA_FORBIDDEN/)
 await actor(adult);await assert.rejects(q('select public.aula_review($1,$2,$3,$4::uuid[],$5,$6,$7,$8)',[otherHid,guarded,'accept',[ida],'2026-11-12',null,'No',true]),/AULA_FORBIDDEN/)
 pass('Invalid dates/times/titles and cross-household people/reviewers roll back atomically')
 assert.deepEqual(await before(),rewardBefore);pass('Corrected acceptance leaves all reward, stars and allowance records untouched')
 console.log(JSON.stringify({AULA_ACTIVITY_DB:'PASS',checks:checks.length}))
}catch(e){console.error(JSON.stringify({code:e.code,message:e.message,detail:e.detail,where:e.where,stack:e.stack?.split('\n').filter(x=>x.includes('aula-activity-db')).join('\n')}));failed=true}finally{await db.close()}
if(failed)process.exitCode=1
