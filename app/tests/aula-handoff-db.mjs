// Real PostgreSQL/WASM for SQL state, permissions and migration tests when Docker
// is unavailable. Supabase Auth/Storage infrastructure is represented by schemas;
// this does NOT test GoTrue, PostgREST, websocket delivery or hosted services.
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

const checks=[];const pass=name=>{checks.push(name);console.log('PASS',name)};
const actor=async(role)=>{await db.exec('reset role');if(role!=='postgres')await db.exec('set role '+role)};
const server=async(action,p={},hid=ids.hid,uid=ids.adult)=>{await actor('service_role');return (await query('select public.aula_handoff_server($1,$2,$3,$4::jsonb) value',[action,hid,uid,JSON.stringify(p)])).rows[0].value};
let next=0;const create=async()=>{const hash=String(++next).padStart(64,'0');const row=await server('create',{token_hash:hash});assert.ok(row.id);return {...row,hash}};
const claim=h=>server('claim',{token_hash:h.hash},null,null);
const reset=async()=>{await actor('postgres');await db.exec('truncate private.aula_handoffs;update private.aula_handoff_rate set attempts=0,window_start=now()')};
const finish=c=>server('finish',{id:c.id,claim_id:c.claim_id,encrypted_session:{version:1,iv:'synthetic',ciphertext:'synthetic',authTag:'synthetic'}});
try{
 for(const role of ['anon','authenticated']){await actor(role);await assert.rejects(()=>query('select public.create_aula_handoff($1,$2,$3)',[ids.hid,ids.adult,'a'.repeat(64)]));await assert.rejects(()=>query('select * from private.aula_handoffs'));}pass('Anonymous/authenticated cannot bypass server authorization or read hashes');
 for(const uid of [ids.child,ids.wall,ids.outsider])await assert.rejects(()=>server('create',{token_hash:'a'.repeat(64)},ids.hid,uid));pass('Child, anonymous wall, outsider denied');
 let h=await create();await actor('postgres');const raw=(await query('select * from private.aula_handoffs where id=$1',[h.id])).rows[0];assert.equal(raw.token_hash,h.hash);assert.equal(new Date(raw.expires_at)-new Date(raw.created_at),600000);assert.equal(raw.used_at,null);pass('Hash only and max ten-minute TTL');
 assert.equal((await server('claim',{token_hash:'f'.repeat(64)},null,null)).error,'AULA_HANDOFF_INVALID');pass('Wrong code rejected');
 await actor('postgres');await query("update private.aula_handoffs set expires_at=now()-interval '1 second' where id=$1",[h.id]);assert.equal((await claim(h)).error,'AULA_HANDOFF_INVALID');pass('Expired code rejected');
 await reset();h=await create();const c=await claim(h);assert.ok(c.claim_id);assert.equal((await claim(h)).error,'AULA_HANDOFF_INVALID');pass('Used code rejected before verify');
 assert.equal((await server('finish',{id:c.id,claim_id:c.claim_id,encrypted_session:{version:1}},ids.other,ids.outsider)).error,'AULA_HANDOFF_INVALID');pass('Cross-household finish blocked');
 assert.equal((await finish(c)).connected,true);assert.equal((await finish(c)).error,'AULA_HANDOFF_INVALID');pass('Finish consumes claim once and establishes existing credential model');
 await reset();h=await create();const disconnectClaim=await claim(h);await actor('postgres');await query("update public.aula_connections set status='disconnected' where household_id=$1",[ids.hid]);assert.equal((await finish(disconnectClaim)).error,'AULA_HANDOFF_INVALID');pass('Disconnect fences in-flight verification');
 await reset();h=await create();const older=await claim(h);await create();assert.equal((await finish(older)).error,'AULA_HANDOFF_INVALID');pass('New code revokes earlier pending and claimed handoffs');
 await reset();for(let i=0;i<4;i++)await create();assert.equal((await server('create',{token_hash:'e'.repeat(64)})).error,'AULA_RATE_LIMIT');pass('Create rate limit shared in database');
 await reset();for(let i=0;i<30;i++)assert.equal((await server('claim',{token_hash:'f'.repeat(64)},null,null)).error,'AULA_HANDOFF_INVALID');assert.equal((await server('claim',{token_hash:'f'.repeat(64)},null,null)).error,'AULA_RATE_LIMIT');pass('Failed guesses retain shared rate counter');
 await reset();h=await create();const late=await claim(h);await actor('postgres');await query("update private.aula_handoffs set used_at=now()-interval '91 seconds' where id=$1",[h.id]);assert.equal((await finish(late)).error,'AULA_HANDOFF_INVALID');pass('Late verification cannot save');
 await reset();h=await create();const removed=await claim(h);await actor('postgres');await query("update public.household_members set role='child' where household_id=$1 and user_id=$2",[ids.hid,ids.adult]);assert.equal((await finish(removed)).error,'AULA_HANDOFF_INVALID');pass('Adult role rechecked at completion');
 console.log('AULA HANDOFF DB PASS:',checks.length);
}finally{await db.close()}
