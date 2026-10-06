// LOCAL ONLY. Generates/reuses a private local secret; never reads hosted env.
import {localSupabase} from './local-supabase.mjs'
import {randomBytes} from 'node:crypto'
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
localSupabase()
const path='supabase/.temp/calendar-sync30/functions.env'
mkdirSync('supabase/.temp/calendar-sync30',{recursive:true})
const existing=existsSync(path)?readFileSync(path,'utf8').match(/^CALENDAR_SYNC_SECRET=([a-f0-9]{64})$/m)?.[1]:null
const secret=existing||randomBytes(32).toString('hex')
if(!existing)writeFileSync(path,'CALENDAR_SYNC_SECRET='+secret+'\n')
const endpoint='http://supabase_kong_familiekalender:8000/functions/v1/sync-calendar-feeds'
const statements=[['calendar_sync_secret',secret],['calendar_sync_url',endpoint]].map(([name,value])=>
 "do $local$ declare sid uuid;begin select id into sid from vault.secrets where name='"+name+"';if sid is null then perform vault.create_secret('"+value+"','"+name+"');else perform vault.update_secret(sid,'"+value+"');end if;end $local$;").join('\n')
try{execFileSync('docker',['exec','-i','supabase_db_familiekalender','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:statements,stdio:['pipe','pipe','pipe'],windowsHide:true})}
catch{throw Error('Local Vault setup failed; no secret values logged.')}
console.log('LOCAL calendar scheduler configured. Serve functions with --env-file supabase/.temp/calendar-sync30/functions.env. No hosted changes.')
