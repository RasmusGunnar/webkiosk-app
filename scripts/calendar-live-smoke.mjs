
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { calendarPayload } from '../app/src/lib/calendar.js'
import { materialize, itemValues, planCreate, planEdit, planDelete } from '../app/src/lib/calendar-semantics.js'
const require=createRequire(new URL('../app/package.json',import.meta.url))
const {createClient}=require('@supabase/supabase-js')
process.chdir(fileURLToPath(new URL('../',import.meta.url)))
if(!process.argv.includes('--allow-live-tests'))throw Error('Requires --allow-live-tests: creates/removes one isolated Auth user and household.')
const project='oyyqniwppytipdktzwsy',url='https://'+project+'.supabase.co'
const raw=execFileSync('cmd.exe',['/d','/s','/c','npx.cmd --yes supabase@2.118.0 projects api-keys --project-ref '+project+' --reveal --output json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true})
const keys=JSON.parse(raw),options={auth:{persistSession:false,autoRefreshToken:false}}
const admin=createClient(url,keys.find(k=>k.name==='service_role').api_key,options)
const key=keys.find(k=>k.name==='anon').api_key
const writer=createClient(url,key,options),viewer=createClient(url,key,options)
const report={project,startedAt:new Date().toISOString(),checks:{},cleanup:false}
const check=(name,condition)=>{if(!condition)throw Error('FAIL: '+name);report.checks[name]='PASS';console.log('PASS: '+name)}
const unwrap=result=>{if(result.error)throw Error(result.error.message);return result.data}
let uid,hid,channel,events=0
const waitUntil=async predicate=>{const start=Date.now();while(!predicate()){if(Date.now()-start>15000)throw Error('Realtime event timed out');await new Promise(resolve=>setTimeout(resolve,100))}}
try {
  const email='calendar-smoke-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1'
  uid=unwrap(await admin.auth.admin.createUser({email,password,email_confirm:true})).user.id
  const session=unwrap(await writer.auth.signInWithPassword({email,password})).session
  unwrap(await viewer.auth.setSession({access_token:session.access_token,refresh_token:session.refresh_token}))
  hid=unwrap(await writer.rpc('create_household',{p_name:'Isolated Mega 2 smoke'}))
  check('isolated_authenticated_household',Boolean(hid))
  const other=unwrap(await admin.from('households').select('id').neq('id',hid).limit(1))[0].id
  check('cross_household_RLS',
    unwrap(await writer.from('calendar_items').select('id').eq('household_id',other)).length===0 &&
    unwrap(await writer.from('calendar_revisions').select('household_id').eq('household_id',other)).length===0 &&
    Boolean((await writer.rpc('mutate_calendar',{p_household_id:other,p_expected:[],p_upserts:[],p_delete_ids:[]})).error))
  let subscription, streamReady=false
  channel=viewer.channel('calendar-smoke:'+hid).on('postgres_changes',{event:'*',schema:'public',table:'calendar_revisions',filter:'household_id=eq.'+hid},()=>events++)
    .on('system', {}, message => { if(message.extension==='postgres_changes') { console.log('Realtime stream status: '+message.status); if(message.status==='ok')streamReady=true } }).subscribe(status=>subscription=status)
  await waitUntil(()=>subscription==='SUBSCRIBED' && streamReady)
  check('live_realtime_subscribed',true)
  const rows=async()=>unwrap(await writer.from('calendar_items').select('*').eq('household_id',hid))
  const mutate=plan=>writer.rpc('mutate_calendar',{p_household_id:hid,p_expected:plan.expected,p_delete_ids:plan.deleteIds,
    p_upserts:plan.upserts.map(({id,values})=>({id,...calendarPayload(values,[])}))})
  const date='2026-09-28',input={title:'Isolated recurring task',date,time:'',type:'Opgave',people:['Alle'],done:false,repeatWeekly:true}
  unwrap(await mutate(planCreate(input,randomUUID)))
  await waitUntil(()=>events>0)
  let stored=await rows(),occurrence=materialize(stored,[date],{milestones:false})[0]
  check('atomic_create_and_live_realtime',stored.length===1&&events>0)
  unwrap(await mutate(planEdit(stored,occurrence,{...itemValues(occurrence),done:true},'one',randomUUID)))
  stored=await rows()
  const display=materialize(stored,[date,'2026-10-05'],{milestones:false})
  check('first_done_is_occurrence_specific',stored.length===2&&display[0].done===true&&display[1].done===false)
  const stale=planEdit(stored,display[1],{...itemValues(display[1]),title:'Whole series changed'},'series',randomUUID)
  unwrap(await mutate(stale))
  const conflict=await mutate(stale)
  check('stale_write_rejected',Boolean(conflict.error)&&conflict.error.message.includes('anden enhed'))
  stored=await rows()
  const changed=materialize(stored,[date,'2026-10-05'],{milestones:false})
  check('series_edit_retains_completion',changed[0].done===true&&changed[1].title==='Whole series changed'&&stored.find(row=>row.data.repeatWeekly).date===date)
  const beforeDelete=events
  unwrap(await mutate(planDelete(stored,changed[1],'series')))
  await waitUntil(()=>events>beforeDelete)
  check('atomic_delete_and_live_realtime',(await rows()).length===0)
} finally {
  if(channel)await viewer.removeChannel(channel)
  viewer.realtime.disconnect();writer.realtime.disconnect()
  await viewer.auth.signOut({scope:'local'});await writer.auth.signOut({scope:'local'})
  if(hid)unwrap(await admin.from('households').delete().eq('id',hid))
  if(uid)unwrap(await admin.auth.admin.deleteUser(uid))
  report.cleanup=true;report.finishedAt=new Date().toISOString()
  mkdirSync('supabase/.temp/mega2',{recursive:true})
  writeFileSync('supabase/.temp/mega2/live-smoke.json',JSON.stringify(report,null,2)+'\n')
}
console.log('PASS: isolated live fixtures removed; no existing account/session was used')
