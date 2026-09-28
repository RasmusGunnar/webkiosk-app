import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { OfflineSync } from '../app/src/lib/offline-sync.js'
import { calendarPayload } from '../app/src/lib/calendar.js'
import { materialize, itemValues, planCreate, planEdit } from '../app/src/lib/calendar-semantics.js'
const require=createRequire(new URL('../app/package.json',import.meta.url)),{createClient}=require('@supabase/supabase-js')
process.chdir(fileURLToPath(new URL('../',import.meta.url)))
if(!process.argv.includes('--allow-live-tests'))throw Error('Requires --allow-live-tests; creates and removes only isolated fixtures.')
const project='oyyqniwppytipdktzwsy',url='https://'+project+'.supabase.co'
const keys=JSON.parse(execFileSync('cmd.exe',['/d','/s','/c','npx.cmd --yes supabase@2.118.0 projects api-keys --project-ref '+project+' --reveal --output json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}))
const options={auth:{persistSession:false,autoRefreshToken:false}},publicKey=keys.find(k=>k.name==='anon').api_key
const admin=createClient(url,keys.find(k=>k.name==='service_role').api_key,options)
const writer=createClient(url,publicKey,options),otherDevice=createClient(url,publicKey,options),outsider=createClient(url,publicKey,options)
const unwrap=result=>{if(result.error)throw Error(result.error.message);return result.data}
const report={project,started_at:new Date().toISOString(),checks:{},cleanup:false}
const check=(name,pass)=>{if(!pass)throw Error('FAIL '+name);report.checks[name]='PASS';console.log('PASS '+name)}
const users=[],households=[];let engine,channel
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
class MemoryStore{
 constructor(){this.rows=new Map()}
 async get(key){return structuredClone(this.rows.get(key))}
 async update(key,fn){const value=fn(await this.get(key));this.rows.set(key,structuredClone(value));return value}
}
try{
 for(const client of [writer,outsider]){
  const email='reward-smoke-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1'
  users.push(unwrap(await admin.auth.admin.createUser({email,password,email_confirm:true})).user.id)
  const session=unwrap(await client.auth.signInWithPassword({email,password})).session
  if(client===writer)unwrap(await otherDevice.auth.setSession({access_token:session.access_token,refresh_token:session.refresh_token}))
  households.push(unwrap(await client.rpc('create_household',{p_name:'Isolated Mega 3 smoke'})))
 }
 const [hid,other]=households,uid=users[0]
 const people=unwrap(await writer.from('household_people').insert([{household_id:hid,name:'Child fixture',role:'child'},{household_id:hid,name:'Adult fixture',role:'adult'}]).select('*'))
 const child=people.find(p=>p.role==='child')
 check('role_defaults',child.reward_enabled===true&&people.find(p=>p.role==='adult').reward_enabled===false)
 const payload=plan=>({p_expected:plan.expected,p_upserts:plan.upserts.map(({id,values})=>({id,...calendarPayload(values,people)})),p_delete_ids:plan.deleteIds})
 const values={title:'Lektier fixture',date:today,type:'Opgave',people:[child.id],done:true,time:'',note:''}
 const create=(n,done=true)=>({p_expected:[],p_upserts:Array.from({length:n},()=>({id:randomUUID(),...calendarPayload({...values,done},people)})),p_delete_ids:[]})
 const rpc=(client,batch,id=randomUUID())=>client.rpc('sync_calendar_mutation',{p_mutation_id:id,p_household_id:hid,...batch})
 const rows=async()=>unwrap(await writer.from('calendar_items').select('*').eq('household_id',hid))
 check('no_load_time_celebrations',unwrap(await writer.from('reward_celebrations').select('id').eq('household_id',hid)).length===0)
 check('six_done_without_popup',unwrap(await rpc(writer,create(6))).celebrations.length===0)
 const competing=await Promise.all([rpc(writer,create(1)),rpc(otherDevice,create(1))])
 const claims=competing.flatMap(result=>unwrap(result).celebrations)
 check('two_devices_one_atomic_threshold_claim',claims.length===1&&claims[0].threshold===7&&claims[0].tasks.length===6)
 const retryId=randomUUID(),nine=create(1),ninth=unwrap(await rpc(writer,nine,retryId))
 check('threshold_9',ninth.celebrations.length===1&&ninth.celebrations[0].threshold===9)
 const retry=unwrap(await rpc(otherDevice,nine,retryId))
 check('response_loss_receipt_replay',retry.already_applied===true&&retry.celebrations.length===0&&(await rows()).length===9)
 check('threshold_12',unwrap(await rpc(writer,create(3))).celebrations[0]?.threshold===12)
 check('cross_household_RLS',
  unwrap(await outsider.from('reward_celebrations').select('*').eq('household_id',hid)).length===0&&
  unwrap(await outsider.from('calendar_mutation_receipts').select('*').eq('household_id',hid)).length===0&&
  Boolean((await rpc(outsider,create(1))).error)&&
  Boolean((await outsider.rpc('sync_calendar_mutation',{p_mutation_id:retryId,p_household_id:other,p_expected:[],p_upserts:[],p_delete_ids:[]})).error))
 let connected=false,events=0,ready=false
 channel=otherDevice.channel('mega3-smoke:'+hid)
 .on('postgres_changes',{event:'*',schema:'public',table:'calendar_revisions',filter:'household_id=eq.'+hid},()=>events++)
 .on('system',{},m=>{if(m.extension==='postgres_changes'&&m.status==='ok')ready=true}).subscribe()
 const wait=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>20000)throw Error('Realtime timeout');await new Promise(r=>setTimeout(r,100))}}
 await wait(()=>ready)
 const store=new MemoryStore()
 engine=await new OfflineSync({store,client:writer,userId:uid,householdId:hid,online:()=>connected}).init()
 await engine.snapshot({items:await rows(),people})
 const recurring=planCreate({...values,title:'Offline recurring fixture',done:false,repeatWeekly:true},randomUUID)
 await engine.enqueue(payload(recurring),{action:'create'})
 const occurrence=materialize(engine.view.items,[today],{milestones:false}).find(i=>i.title==='Offline recurring fixture')
 await engine.enqueue(payload(planEdit(engine.view.items,occurrence,{...itemValues(occurrence),done:true},'one',randomUUID)),{action:'toggle_done'})
 check('offline_queue_durable_before_send',(await store.get(engine.key)).queue.length===2&&(await rows()).length===12)
 connected=true;await engine.replay();await wait(()=>events>0)
 check('ordered_replay_and_realtime',engine.state.queue.length===0&&(await rows()).length===14&&events>0)
 const stored=await rows(),completed=materialize(stored,[today],{milestones:false}).find(i=>i.title==='Offline recurring fixture')
 check('recurring_done_has_one_concrete_override',completed.done===true&&stored.filter(i=>i.title==='Offline recurring fixture'&&i.done).length===1)
 // A real newer write must block the cached offline version until explicit choice.
 connected=false;await engine.snapshot({items:stored})
 const target=stored.find(i=>i.title==='Lektier fixture')
 await engine.enqueue(payload(planEdit(engine.view.items,target,{...itemValues(target),title:'Local conflict fixture'},'one',randomUUID)))
 unwrap(await rpc(otherDevice,payload(planEdit(stored,target,{...itemValues(target),title:'Remote conflict fixture'},'one',randomUUID))))
 connected=true;await engine.replay()
 check('live_stale_write_conflict',engine.state.queue[0]?.status==='conflict'&&engine.view.items.find(i=>i.id===target.id).title==='Remote conflict fixture')
 await engine.resolve(engine.state.queue[0].id,'local')
 check('explicit_keep_local',engine.state.queue.length===0&&(await rows()).find(i=>i.id===target.id).title==='Local conflict fixture')
 const current=(await rows()).find(i=>i.id===target.id)
 connected=false;await engine.snapshot({items:await rows()})
 await engine.enqueue({p_expected:[{id:current.id,updated_at:current.updated_at}],p_upserts:[],p_delete_ids:[current.id]},{action:'delete'})
 unwrap(await rpc(otherDevice,payload(planEdit(await rows(),current,{...itemValues(current),title:'Preserve remote fixture'},'one',randomUUID))))
 connected=true;await engine.replay();await engine.resolve(engine.state.queue[0].id,'server')
 check('explicit_use_server_preserves_newer_row',(await rows()).find(i=>i.id===target.id).title==='Preserve remote fixture'&&engine.state.queue.length===0)
}finally{
 engine?.stop();if(channel)await otherDevice.removeChannel(channel)
 for(const id of households)unwrap(await admin.from('households').delete().eq('id',id))
 for(const id of users)unwrap(await admin.auth.admin.deleteUser(id))
 report.cleanup=true;report.finished_at=new Date().toISOString()
 mkdirSync('supabase/.temp/mega3',{recursive:true})
 writeFileSync('supabase/.temp/mega3/live-smoke.json',JSON.stringify(report,null,2)+'\n')
}
console.log('LIVE MEGA 3 PASS '+Object.keys(report.checks).length+'; isolated fixtures removed')
