import assert from 'node:assert/strict';
process.on('uncaughtException',e=>{console.error('ACCOUNT DELETE FAIL',e.message,e.where);process.exit(1)});
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const db=new PGlite(),migrations=new URL('../../supabase/migrations/',import.meta.url);
await db.exec(`create role postgres superuser;set role postgres;create role anon;create role authenticated;create role service_role bypassrls;
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
for(const name of readdirSync(migrations).filter(n=>n.endsWith('.sql')&&!n.includes('calendar_import_cron')&&!n.includes('aula_automatic_scans')).sort()){
 try{await db.exec(readFileSync(new URL(name,migrations),'utf8').replaceAll('\r\n','\n'))}catch(e){console.error('Migration failed',name,e.message);await db.close();process.exit(1)}
}


const query=(sql,args=[])=>db.query(sql,args),checks=[];
const pass=name=>{checks.push(name);console.log('PASS',name)};
await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
try{
 for(const deleteConnector of [true,false]){
  const user=randomUUID(),other=randomUUID(),hid=randomUUID(),person=randomUUID(),item=randomUUID();
  await query('insert into auth.users(id,email) values($1,$2),($3,$4)',[user,'delete@example.invalid',other,'other@example.invalid']);
  await query("insert into public.households(id,name,created_by) values($1,'Synthetic deletion only',$2)",[hid,user]);
  await query("insert into public.household_members(household_id,user_id,role) values($1,$2,'owner'),($1,$3,'owner') on conflict do nothing",[hid,user,other]);
  await query("insert into public.household_people(id,household_id,name,role) values($1,$2,'Synthetic child','child')",[person,hid]);
  await query("insert into public.calendar_items(id,household_id,created_by,title,date) values($1,$2,$3,'Preserved activity',current_date)",[item,hid,user]);
  await query("insert into public.aula_connections(household_id,created_by,status) values($1,$2,'connected')",[hid,deleteConnector?user:other]);
  await query("insert into private.aula_credentials(household_id,encrypted_session) values($1,'{\"version\":1}')",[hid]);
  await query("insert into public.aula_child_mappings(household_id,provider_child_key,display_name,person_id) values($1,repeat('b',64),'Synthetic child',$2)",[hid,person]);
  const before=(await query('select to_jsonb(m) v from public.aula_child_mappings m where household_id=$1',[hid])).rows;
  await query("select private.aula_handoff_server('create',$1,$2,jsonb_build_object('token_hash',repeat('a',64)))",[hid,user]);
  await db.exec("set role authenticated");await query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  const exported=(await query('select public.export_family_data($1) v',[hid])).rows[0].v;
  assert.equal(exported.format_version,2);assert.equal(exported.aula.children[0].person_id,person);
  assert.ok(!JSON.stringify(exported).includes('encrypted_session'));assert.ok(!JSON.stringify(exported).includes('provider_child_key'));assert.ok(!JSON.stringify(exported).includes('token_hash'));
  pass('Adult export includes own Aula mappings without provider IDs or credentials');
  await assert.rejects(()=>query('select public.export_family_data($1)',[randomUUID()]));pass('Cross-household export denied');
  await db.exec("reset role;set role postgres");
  await query('select private.begin_account_deletion($1,$2)',[user,[]]);
  await query('delete from auth.users where id=$1',[user]);
  assert.equal((await query('select count(*)::int n from private.aula_handoffs where created_by=$1',[user])).rows[0].n,0);
  const connection=(await query('select status,created_by from public.aula_connections where household_id=$1',[hid])).rows[0];
  assert.equal(connection.status,deleteConnector?'disconnected':'connected');
  assert.equal(connection.created_by,deleteConnector?null:other);
  assert.equal((await query('select count(*)::int n from private.aula_credentials where household_id=$1',[hid])).rows[0].n,deleteConnector?0:1);
  assert.deepEqual((await query('select to_jsonb(m) v from public.aula_child_mappings m where household_id=$1',[hid])).rows,before);
  assert.equal((await query('select count(*)::int n from public.calendar_items where id=$1',[item])).rows[0].n,1);
  assert.equal((await query('select count(*)::int n from public.household_members where household_id=$1',[hid])).rows[0].n,1);
  pass(deleteConnector?'Deleting connector removes credentials, preserves other owner, mapping and activity':'Deleting other adult preserves current connector and session');
  await query('select private.begin_account_deletion($1,$2)',[other,[hid]]);
  await query('delete from auth.users where id=$1',[other]);
  for(const table of ['households','aula_connections','aula_child_mappings','calendar_items'])assert.equal((await query('select count(*)::int n from public.'+table+' where '+(table==='households'?'id':'household_id')+'=$1',[hid])).rows[0].n,0);
  assert.equal((await query('select count(*)::int n from private.aula_credentials where household_id=$1',[hid])).rows[0].n,0);
  pass('Confirmed last-owner deletion removes owned family and Aula credentials');
 }
 console.log('ACCOUNT DELETION PASS '+checks.length+'/'+checks.length);
}finally{await db.close()}
