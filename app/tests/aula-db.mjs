// Real PostgreSQL/WASM for SQL state, permissions and migration tests when Docker
// is unavailable. Supabase Auth/Storage infrastructure is represented by schemas;
// this does NOT test GoTrue, PostgREST, websocket delivery or hosted services.
import {memoryChecks} from './aula-review-memory-db.cases.mjs'
import {PGlite} from '@electric-sql/pglite'
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
process.on('uncaughtException',e=>{console.error('AULA DB FAIL:',e.message,e.where||'',e.stack?.split('\n').find(l=>l.includes('aula-db.mjs'))||'');process.exit(1)})
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
for(const name of readdirSync(migrations).filter(n=>n.endsWith('.sql')&&!n.includes('calendar_import_cron')).sort()){
 try{await db.exec(readFileSync(new URL(name,migrations),'utf8').replaceAll('\r\n','\n'))}catch(e){console.error('Migration failed',name,e.message);await db.close();process.exit(1)}
}
const query=(sql,p=[])=>db.query(sql,p),ids=Object.fromEntries(['adult','child','outsider','wall','hid','other','person','strangerPerson'].map(k=>[k,randomUUID()]));
await query('insert into auth.users(id,is_anonymous) values($1,false),($2,false),($3,false),($4,true)',[ids.adult,ids.child,ids.outsider,ids.wall]);
await query("insert into public.households(id,name,created_by) values($1,'Synthetic family',$3),($2,'Other family',$4)",[ids.hid,ids.other,ids.adult,ids.outsider]);
await query("insert into public.household_members(household_id,user_id,role) values($1,$2,'owner'),($3,$4,'owner') on conflict do nothing",[ids.hid,ids.adult,ids.other,ids.outsider]);
await query("insert into public.household_members(household_id,user_id,role) values($1,$2,'child') on conflict do nothing",[ids.hid,ids.child]);
await query("insert into public.household_people(id,household_id,name,role) values($1,$2,'Carl','child'),($3,$4,'Other','child')",[ids.person,ids.hid,ids.strangerPerson,ids.other]);
const legacy=randomUUID();await query("insert into public.calendar_feeds(id,household_id,name,source,feed_url,is_active) values($1,$2,'Legacy','aula','https://example.invalid/synthetic.ics',true)",[legacy,ids.hid]);
const legacyBefore=(await query('select to_jsonb(f) value from public.calendar_feeds f where id=$1',[legacy])).rows[0].value;
const actor=async(uid,role='authenticated')=>{await db.exec('reset role');await query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid||'',role]);await db.exec('set role '+role)};
const server=async(action,payload={},hid=ids.hid,user=ids.adult)=>{await actor(null,'service_role');return(await query('select public.aula_server($1,$2,$3,$4::jsonb) value',[action,hid,user,JSON.stringify(payload)])).rows[0].value};
const checks=[],pass=name=>{checks.push(name);console.log('PASS',name)};
const denied=async(name,fn)=>{await assert.rejects(fn);pass(name)};
const envelope={version:1,iv:'synthetic',ciphertext:'synthetic',authTag:'synthetic'};
const flow=await server('begin');
await denied('Cross-household identity rejected',()=>server('identity_choose',{flow_id:flow.flow_id,index:1},ids.other,ids.outsider));
await server('identity_wait',{flow_id:flow.flow_id,count:2});
await denied('Unknown identity rejected',()=>server('identity_choose',{flow_id:flow.flow_id,index:3}));
await server('identity_choose',{flow_id:flow.flow_id,index:2});assert.equal((await server('flow',{flow_id:flow.flow_id})).selected_identity,2);pass('Identity scoped and persisted without credentials');
await server('finish',{flow_id:flow.flow_id,encrypted_session:envelope,identity_label:'Forælder'});
await denied('Login replay rejected',()=>server('finish',{flow_id:flow.flow_id,encrypted_session:envelope}));
for(const [label,uid]of [['adult',ids.adult],['child',ids.child],['outsider',ids.outsider],['wall',ids.wall]]){
 await actor(uid);await denied(label+' cannot select credentials',()=>query('select * from private.aula_credentials'));await denied(label+' cannot invoke service gateway',()=>query("select public.aula_server('status',$1,$2,'{}')",[ids.hid,uid]));
 if(label!=='adult')assert.equal((await query('select * from public.aula_connections')).rows.length,0);
}
pass('Metadata RLS excludes child, outsider, wall');
const claim=await server('scan_claim');await denied('Concurrent scan blocked',()=>server('scan_claim'));
await server('scan_save_session',{lease:claim.lease,encrypted_session:{...envelope,ciphertext:'rotated'}});
assert.equal((await server('scan_credentials',{lease:claim.lease})).ciphertext,'rotated');pass('Rotation saved under lease');
const providerKey='a'.repeat(64);
await server('scan_finish',{lease:claim.lease,children:[{provider_child_key:providerKey,display_name:'Carl',school:'Testskolen',class_name:'3.C',group_names:['3.C']}],findings:[],api_version:25,counts:{calendar:1}});
await actor(ids.child);await denied('Child cannot map',()=>query('select public.aula_set_child_mappings($1,$2::jsonb)',[ids.hid,JSON.stringify([])]));
await actor(ids.adult);await denied('Cross-household person mapping rejected',()=>query('select public.aula_set_child_mappings($1,$2::jsonb)',[ids.hid,JSON.stringify([{provider_child_key:providerKey,person_id:ids.strangerPerson}])]));
await query('select public.aula_set_child_mappings($1,$2::jsonb)',[ids.hid,JSON.stringify([{provider_child_key:providerKey,person_id:ids.person}])]);pass('Adult confirms own-household mapping');
const today=new Date().toISOString().slice(0,10);
const finding={source_key:'b'.repeat(64),source_kind:'calendar',person_id:ids.person,type:'TRIP',title:'Skovtur',date:today,time:'09:00',end_date:today,end_time:'13:00',location:'Skoven',confidence:'HIGH',reason:'Dato og barn er angivet',summary:'Klassen tager på tur.',proposed_action:'CREATE_ACTIVITY',source_updated_at:new Date().toISOString()};
const upload=async findings=>{const c=await server('scan_claim');await server('scan_finish',{lease:c.lease,children:[],findings,counts:{calendar:findings.length},api_version:25})};
await upload([finding,{...finding,source_key:'c'.repeat(64),source_kind:'message',type:'REMINDER',title:'Husk madpakke',proposed_action:'CREATE_ACTIVITY'},{...finding,source_key:'d'.repeat(64),type:'GENERAL_INFO',title:'Generel information',confidence:'LOW',proposed_action:'NO_ACTION'}]);
let rows=(await server('status')).findings;const trip=rows.find(f=>f.type==='TRIP'),reminder=rows.find(f=>f.type==='REMINDER'),info=rows.find(f=>f.type==='GENERAL_INFO');
const review=async(id,action='accept',uid=ids.adult)=>{await actor(uid);return(await query('select public.aula_review($1,$2,$3) value',[ids.hid,id,action])).rows[0].value};
await denied('Child cannot accept',()=>review(trip.id,'accept',ids.child));await denied('Outsider cannot accept',()=>review(trip.id,'accept',ids.outsider));await denied('Wall cannot accept',()=>review(trip.id,'accept',ids.wall));
const accepted=await review(trip.id);assert.equal((await review(trip.id)).item_id,accepted.item_id);pass('Atomic accept idempotent');
await review(reminder.id);await review(info.id,'review');
await actor(ids.adult);let items=(await query("select * from public.calendar_items where data->>'aulaAssisted'='true'")).rows;
assert.equal(items.length,2);assert.equal(items.filter(i=>i.type==='Opgave').length,0);assert.equal(items.filter(i=>i.type==='Aktivitet').length,2);for(const item of items){assert.equal(item.data.rewardMode,undefined);assert.equal(item.data.requiresApproval,undefined);assert.deepEqual(item.person_ids,[ids.person])}assert.equal(items.find(i=>i.title==='Skovtur').end_time,'13:00:00');pass('Trip + reminder = two activities without chore/reward workflow; info creates nothing');
await upload([{...finding,title:'Changed source'}]);assert.equal((await server('status')).findings.find(f=>f.id===trip.id).title,'Skovtur');pass('Refresh preserves accepted finding and calendar content');
await upload([{...finding,source_key:'e'.repeat(64)}]);const duplicate=(await server('status')).findings.find(f=>f.source_key==='e'.repeat(64));assert.equal((await review(duplicate.id)).item_id,accepted.item_id);pass('Existing event matched without duplicate');
await upload([{...finding,source_key:'f'.repeat(64),title:'Ignorer dette'}]);const ignore=(await server('status')).findings.find(f=>f.source_key==='f'.repeat(64));await review(ignore.id,'ignore');await upload([{...finding,source_key:'f'.repeat(64),title:'Updated ignored'}]);assert.equal((await server('status')).findings.find(f=>f.id===ignore.id).status,'ignored');pass('Ignored finding stays ignored after scan');
await actor(ids.child);assert.ok((await query('select * from public.aula_findings')).rows.length);await actor(ids.outsider);assert.equal((await query('select * from public.aula_findings')).rows.length,0);pass('Findings follow household read access');
const failed=await server('scan_claim');await server('scan_fail',{lease:failed.lease,error:'AULA_TEMPORARY_ERROR'});assert.equal((await server('status')).connection.status,'connected');pass('Transient failure preserves connection');
const expired=await server('scan_claim');await server('scan_fail',{lease:expired.lease,error:'AULA_REAUTH_REQUIRED'});assert.equal((await server('status')).connection.status,'reauth_required');pass('Permanent expiry requests reauth');
const diagnostic=await server('scan_claim');
const beforeRelease=await server('status');
for(const role of ['anon','authenticated']){await actor(ids.adult,role);await denied(role+' cannot release diagnostic leases',()=>query('select public.aula_diagnostic_release($1,$2)',[ids.hid,diagnostic.lease]));}
await actor(null,'service_role');await denied('Diagnostic lease cannot cross households',()=>query('select public.aula_diagnostic_release($1,$2)',[ids.other,diagnostic.lease]));
await query('select public.aula_diagnostic_release($1,$2)',[ids.hid,diagnostic.lease]);
const afterRelease=await server('status');assert.deepEqual(afterRelease.connection,beforeRelease.connection);assert.deepEqual(afterRelease.findings,beforeRelease.findings);assert.equal(afterRelease.scanning,false);pass('Diagnostic release preserves connection and findings');
await memoryChecks({query,ids,server,review,actor,pass,denied,today});
const late=await server('scan_claim');await server('disconnect');await denied('Late scan cannot resurrect disconnected credentials',()=>server('scan_save_session',{lease:late.lease,encrypted_session:envelope}));
assert.equal((await server('status')).connection.status,'disconnected');await actor(ids.adult);assert.equal((await query("select * from public.calendar_items where data->>'aulaAssisted'='true'")).rows.length,3);pass('Disconnect retains accepted items');
assert.deepEqual((await query('select to_jsonb(f) value from public.calendar_feeds f where id=$1',[legacy])).rows[0].value,legacyBefore);pass('Legacy ICS byte-for-byte unchanged');
for(let i=0;i<3;i++){const f=await server('begin');await server('cancel',{flow_id:f.flow_id})}await denied('Login rate limit enforced',()=>server('begin'));
const output=new URL('../../supabase/.temp/aula-integration-10/',import.meta.url);mkdirSync(output,{recursive:true});writeFileSync(new URL('database-results.json',output),JSON.stringify({engine:'PGlite PostgreSQL',checks,limitations:['Supabase Auth/PostgREST/realtime infrastructure tested separately']},null,2));
await db.close();console.log('AULA DATABASE PASS:',checks.length);
