// Real PostgreSQL/WASM for SQL state, permissions and migration tests when Docker
// is unavailable. Supabase Auth/Storage infrastructure is represented by schemas;
// this does NOT test GoTrue, PostgREST, websocket delivery or hosted services.
import {PGlite} from '@electric-sql/pglite'
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
const db=new PGlite(),migrations=new URL('../../supabase/migrations/',import.meta.url)
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
grant all on all tables in schema public to authenticated,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;`)
const files=readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort()
const taskMigration=files.find(n=>n.endsWith('_tasks_people_status.sql'))
assert.ok(taskMigration,'Task status migration must exist')
const migrationSql=file=>readFileSync(new URL(file,migrations),'utf8').replaceAll('\r\n','\n')
for(const file of files.filter(n=>n<taskMigration&&!n.includes('calendar_import_cron'))){
 try{await db.exec(migrationSql(file))}catch(e){console.error('MIGRATION FAIL',file,e.message,e.detail);await db.close();process.exit(1)}
}
console.log('BASE MIGRATIONS PASS (cron excluded; no scheduler/network extensions)')
const ids={adult:randomUUID(),child:randomUUID(),stranger:randomUUID(),hid:randomUUID(),rasmus:randomUUID(),carl:randomUUID(),legacy:randomUUID()}
const query=(sql,params=[])=>db.query(sql,params)
await query('insert into auth.users(id) values ($1),($2),($3)',[ids.adult,ids.child,ids.stranger])
await query("insert into public.households(id,name,created_by) values($1,'UX test',$2)",[ids.hid,ids.adult])
await query("insert into public.household_members(household_id,user_id,role) values ($1,$2,'owner'),($1,$3,'child') on conflict do nothing",[ids.hid,ids.adult,ids.child])
await query("insert into public.household_people(id,household_id,name,role) values($1,$3,'Rasmus','adult'),($2,$3,'Carl','child')",[ids.rasmus,ids.carl,ids.hid])
const today=(await query('select private.reward_today()::text as day')).rows[0].day
await query("insert into public.calendar_items(id,household_id,created_by,title,type,date,done,person_ids) values($1,$2,$3,'Legacy','Opgave',$4,true,$5)",[ids.legacy,ids.hid,ids.adult,today,[ids.rasmus,ids.carl]])
await db.exec(migrationSql(taskMigration))
assert.equal((await query("select count(*)::int n from public.task_reward_occurrences where task_id=$1 and status='completed'",[ids.legacy])).rows[0].n,2)
console.log('BACKFILL PASS')
for(const file of files.filter(n=>n>taskMigration))await db.exec(migrationSql(file))
const checks=['legacy shared DONE backfill'],check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name)}
const actor=async uid=>{await db.exec('reset role');await query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[uid||'']);if(uid)await db.exec('set role authenticated')}
const act=async(action,payload,user=ids.adult,request=randomUUID())=>{await actor(user);return (await query('select public.reward_action($1,$2,$3,$4::jsonb) result',[request,ids.hid,action,JSON.stringify(payload)])).rows[0].result}
const state=async()=>{await actor(ids.adult);return (await query('select public.get_reward_state($1) result',[ids.hid])).rows[0].result}
const denied=async(name,fn)=>{await assert.rejects(fn);check(name,true)}
const make=async({approval=false,repeat=false,stars=0}={})=>{
 await actor(null);const id=randomUUID()
 await query("insert into public.calendar_items(id,household_id,created_by,title,type,date,person_ids,data) values($1,$2,$3,'Tøm opvaskemaskinen','Opgave',$4,$5,$6::jsonb)",[id,ids.hid,ids.adult,today,[ids.rasmus,ids.carl],JSON.stringify({requiresApproval:approval,rewardMode:stars?'stars':'none',starValue:stars,repeatWeekly:repeat})]);return id
}
const payload=(item,person=ids.carl,date=today)=>({person_id:person,item_id:item,occurrence_date:date,due_date:date})
const status=(s,item,person=ids.carl)=>s.occurrences.find(o=>o.task_id===item&&o.person_id===person&&o.due_date===today)?.status||'open'
const task=await make(),request=randomUUID()
await act('complete',payload(task),ids.child,request);let s=await state()
check('MULTI_PERSON_TASK: Carl completed, Rasmus open',status(s,task)==='completed'&&status(s,task,ids.rasmus)==='open')
await act('complete',payload(task),ids.child,request)
check('Idempotent completion', (await state()).occurrences.filter(o=>o.task_id===task).length===1)
await act('complete',payload(task,ids.rasmus));s=await state()
check('SHARED_COMPLETION: independent completion of both',status(s,task)==='completed'&&status(s,task,ids.rasmus)==='completed')
await act('undo',payload(task));s=await state()
check('Reopen only Carl',status(s,task)==='open'&&status(s,task,ids.rasmus)==='completed')
const approval=await make({approval:true})
await act('complete',{...payload(approval),status:'approved',requires_approval:false,is_adult:true},ids.child);s=await state()
check('ADULT_APPROVAL: child completion is pending despite forged fields',status(s,approval)==='pending'&&status(s,approval,ids.rasmus)==='open')
await denied('Child cannot approve',()=>act('approve',payload(approval),ids.child))
await denied('Child cannot excuse',()=>act('excuse',payload(approval),ids.child))
await act('approve',payload(approval));check('Adult approval',status(await state(),approval)==='approved')
await denied('Child cannot reopen approved',()=>act('undo',payload(approval),ids.child))
await act('undo',payload(approval));check('Adult reopen approved',status(await state(),approval)==='open')
await act('complete',payload(approval,ids.rasmus));check('Assigned adult completes directly',status(await state(),approval,ids.rasmus)==='completed')
await act('excuse',{...payload(approval),reason:'Syg'});s=await state()
check('EXCUSE only Carl',status(s,approval)==='excused'&&status(s,approval,ids.rasmus)==='completed')
await denied('Child cannot unexcuse',()=>act('unexcuse',payload(approval),ids.child))
await act('unexcuse',payload(approval));check('Adult reopen excused',status(await state(),approval)==='open')
await denied('Cross-household RPC denied',()=>act('complete',payload(task),ids.stranger))
await actor(ids.stranger);check('Cross-household RLS hidden',(await query('select * from public.task_reward_occurrences')).rows.length===0)
await actor(ids.child);await denied('Direct forged approved row denied',()=>query("insert into public.task_reward_occurrences(household_id,person_id,origin_id,task_id,occurrence_date,due_date,title,reward_mode,status) values($1,$2,$3,$3,$4,$4,'Forged','none','approved')",[ids.hid,ids.carl,randomUUID(),today]))
await denied('Direct status UPDATE denied',()=>query("update public.task_reward_occurrences set status='approved' where person_id=$1",[ids.carl]))
await actor(ids.adult);await denied('Legacy shared done mutation rejected',()=>query('update public.calendar_items set done=true where id=$1',[task]))
const weekly=await make({repeat:true});await act('complete',payload(weekly),ids.child);s=await state()
check('Recurring occurrence does not leak to other person/date',s.occurrences.filter(o=>o.task_id===weekly).length===1&&status(s,weekly,ids.rasmus)==='open')
await act('undo',payload(ids.legacy));s=await state()
check('Backfilled shared DONE can reopen independently',status(s,ids.legacy)==='open'&&status(s,ids.legacy,ids.rasmus)==='completed')
await actor(null);const latePerson=randomUUID();await query("insert into public.household_people(id,household_id,name,role) values($1,$2,'Ida','child')",[latePerson,ids.hid])
check('New person does not inherit legacy DONE',!(await state()).occurrences.some(o=>o.person_id===latePerson))
await act('allowance_save',{person_id:ids.carl,cadence:'month',amount_minor:10000,duties:[{title:'Ryd bord',schedule:'daily',approval:true}],start_today:true,expected:null})
await act('allowance_save',{person_id:latePerson,cadence:'month',amount_minor:8000,duties:[{title:'Ryd bord',schedule:'daily',approval:false}],start_today:true,expected:null})
s=await state();const before=structuredClone(s.monthly),duty=s.occurrences.find(o=>o.person_id===ids.carl&&o.allowance_contract_id&&o.due_date===today)
const dutyPayload={person_id:ids.carl,item_id:duty.task_id,occurrence_date:duty.occurrence_date,due_date:duty.due_date}
await act('complete',dutyPayload,ids.child);await act('approve',dutyPayload);s=await state()
check('Allowance approved earns, stars unchanged',s.monthly.find(m=>m.person_id===ids.carl).completed_total===1&&s.ledger.length===0)
await act('excuse',{...dutyPayload,reason:'Syg'});s=await state()
const month=s.monthly.find(m=>m.person_id===ids.carl),original=before.find(m=>m.person_id===ids.carl)
check('Allowance excuse removes denominator and completed numerator',month.eligible_total===original.eligible_total-1&&month.excused_total===1&&month.completed_total===0)
check('Allowance amount and other person unchanged',month.allowance_minor===10000&&JSON.stringify(s.monthly.find(m=>m.person_id===latePerson))===JSON.stringify(before.find(m=>m.person_id===latePerson)))
await act('unexcuse',dutyPayload);s=await state();check('Unexcuse restores denominator',s.monthly.find(m=>m.person_id===ids.carl).eligible_total===original.eligible_total)
// Close a fixture contract as the database owner, then exercise real RPC lock guards.
await actor(null);await query('update public.allowance_contracts set closed_at=now() where id=$1',[duty.allowance_contract_id]);const frozen=(await query('select to_jsonb(c) data from public.allowance_contracts c where id=$1',[duty.allowance_contract_id])).rows[0].data
await denied('Closed contract rejects completion',()=>act('complete',dutyPayload));await denied('Closed contract rejects excuse',()=>act('excuse',dutyPayload));await denied('Closed contract rejects reopen',()=>act('undo',dutyPayload))
await actor(null);assert.deepEqual((await query('select to_jsonb(c) data from public.allowance_contracts c where id=$1',[duty.allowance_contract_id])).rows[0].data,frozen);check('Frozen amount and snapshots untouched',true)
const star=await make({approval:true,stars:10});await act('complete',payload(star),ids.child);await act('approve',payload(star));await act('approve',payload(star));s=await state()
check('Star approval idempotent',s.balances.find(b=>b.person_id===ids.carl).balance===10)
await act('undo',payload(star));check('Adult reopen reverses stars once',(await state()).balances.find(b=>b.person_id===ids.carl).balance===0)
await actor(null);const revision=(await query('select items_version from public.calendar_revisions where household_id=$1',[ids.hid])).rows[0].items_version
await act('complete',payload(task),ids.child);await actor(null);check('Realtime invalidation increments household revision',(await query('select items_version from public.calendar_revisions where household_id=$1',[ids.hid])).rows[0].items_version>revision)
check('No per-person calendar copies',(await query('select count(*)::int n from public.calendar_items where id=$1',[task])).rows[0].n===1)
const wall=randomUUID();await query('insert into auth.users(id,is_anonymous) values($1,true)',[wall]);await query("insert into public.household_devices(household_id,auth_user_id,platform,paired_by) values($1,$2,'web',$3)",[ids.hid,wall,ids.adult])
const wallTask=await make(),wallAction=async(action='complete',person=ids.carl)=>{await actor(wall);return query('select public.complete_task_as_device($1,$2,$3,$4,true,$5)',[randomUUID(),wallTask,today,person,action])}
await denied('Wall cannot omit selected person',()=>wallAction('complete',null));await wallAction();s=await state()
check('Wall completion changes only selected person',status(s,wallTask)==='completed'&&status(s,wallTask,ids.rasmus)==='open')
await denied('Wall cannot approve',()=>wallAction('approve'));await denied('Wall cannot excuse',()=>wallAction('excuse'))
await actor(null);await query('update public.household_devices set revoked_at=now() where auth_user_id=$1',[wall]);await denied('Revoked wall cannot complete',()=>wallAction())
const output=new URL('../../supabase/.temp/tasks-people-ux/',import.meta.url);mkdirSync(output,{recursive:true});writeFileSync(new URL('database-results.json',output),JSON.stringify({engine:'PGlite PostgreSQL',checks,notCovered:['Supabase HTTP API','Auth server','Realtime websocket delivery']},null,2))
console.log('DATABASE PASS: '+checks.length)
export {db,query,actor,today,ids}
if(process.argv[1]===fileURLToPath(import.meta.url))await db.close()
