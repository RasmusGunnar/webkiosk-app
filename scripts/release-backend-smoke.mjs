import {createRequire} from 'node:module'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {localSupabase} from './local-supabase.mjs'
const require=createRequire(new URL('../app/package.json',import.meta.url)),{createClient}=require('@supabase/supabase-js')
process.chdir(fileURLToPath(new URL('../',import.meta.url)))
const live=process.argv.includes('--allow-live-tests'),project='oyyqniwppytipdktzwsy'
let url,key,service
if(live){
 const keys=JSON.parse(execFileSync('cmd.exe',['/d','/s','/c','npx.cmd --yes supabase@2.118.0 projects api-keys --project-ref '+project+' --reveal --output json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}))
 url='https://'+project+'.supabase.co';key=keys.find(k=>k.name==='anon').api_key;service=keys.find(k=>k.name==='service_role').api_key
}else{const local=localSupabase();url=local.API_URL;key=local.ANON_KEY;service=local.SERVICE_ROLE_KEY}
const options={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(url,service,options)
const users=[],households=[],paths=[],checks=[]
const must=async promise=>{const r=await promise;if(r.error)throw Error(r.error.message);return r.data}
const check=(name,value)=>{if(!value)throw Error('FAIL '+name);checks.push(name);console.log('PASS '+checks.length+': '+name)}
async function deletion(user,overrides={},authorize=true){
 const result=await fetch(url+'/functions/v1/delete-account',{method:'POST',headers:{'Content-Type':'application/json',apikey:key,...(authorize?{Authorization:'Bearer '+user.token}:{})},body:JSON.stringify({confirmation:'SLET MIN KONTO',password:user.password,delete_household_ids:[],...overrides})})
 return {status:result.status,body:await result.json()}
}
try{
 for(let i=0;i<4;i++){
  const email='release-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1',client=createClient(url,key,options)
  const user=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user
  const auth=await must(client.auth.signInWithPassword({email,password}))
  users.push({id:user.id,email,password,client,token:auth.session.access_token})
 }
 const [owner,member,remaining,outsider]=users
 const hid=await must(owner.client.rpc('create_household',{p_name:'Isolated release family'}));households.push(hid)
 const other=await must(outsider.client.rpc('create_household',{p_name:'Isolated release unrelated'}));households.push(other)
 await must(admin.from('household_members').insert([member,remaining].map(u=>({household_id:hid,user_id:u.id,role:'adult'}))))
 const person=(await must(owner.client.from('household_people').insert({household_id:hid,name:'Child fixture',role:'child'}).select().single()))
 const item=(await must(member.client.from('calendar_items').insert({household_id:hid,created_by:member.id,title:'Retained fixture task',type:'Opgave',date:'2026-09-29',person_ids:[person.id],done:true}).select().single()))
 await must(owner.client.from('calendar_feeds').insert({household_id:hid,name:'Export metadata',source:'ics',feed_url:'https://example.invalid/PRIVATE_TEST_ONLY.ics',assigned_person_id:person.id}))
 const path=hid+'/'+person.id+'/'+randomUUID()+'.png';paths.push(path)
 await must(member.client.storage.from('household-avatars').upload(path,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII=','base64'),{contentType:'image/png'}))
 await must(owner.client.from('household_people').update({avatar_path:path}).eq('id',person.id))
 check('Anonymous deletion is denied',(await deletion(member,{},false)).status===401)
 check('Wrong password is denied',(await deletion(member,{password:'Incorrect-test-password'})).status===403)
 check('Explicit confirmation required',(await deletion(member,{confirmation:'yes'})).status===400)
 check('Another family cannot be selected for deletion',(await deletion(member,{delete_household_ids:[other]})).status===409)
 check('Denied request preserves Auth account',Boolean((await must(admin.auth.admin.getUserById(member.id))).user))
 const exported=await must(member.client.rpc('export_family_data',{p_household_id:hid}))
 check('Export includes people, completed tasks, feed metadata and members',exported.people.length===1&&exported.calendar_and_tasks[0].done&&exported.feed_metadata.length===1&&exported.memberships.length===3)
 check('Export excludes feed URL, passwords and Auth tokens',!JSON.stringify(exported).includes('PRIVATE_TEST_ONLY')&&!JSON.stringify(exported).includes(member.password)&&!JSON.stringify(exported).includes(member.token))
 check('Cross-family export denied',Boolean((await outsider.client.rpc('export_family_data',{p_household_id:hid})).error))
 await must(member.client.rpc('register_device',{p_installation_id:randomUUID(),p_household_id:hid,p_platform:'android',p_app_version:'1.0.0',p_push_token:'TEST_ONLY_TOKEN_'+randomUUID()}))
 check('Owner cannot read another member push token',(await must(owner.client.from('native_devices').select('*'))).length===0)
 check('Member cannot invoke server-only deletion RPC',Boolean((await member.client.rpc('begin_account_deletion',{p_user_id:owner.id,p_delete_households:[hid]})).error))
 const removed=await deletion(member)
 check('Member deletion completes through Edge + Auth API',removed.status===200&&removed.body.deleted)
 check('Auth account is gone',Boolean((await admin.auth.admin.getUserById(member.id)).error))
 check('Shared task remains with anonymous author',(await must(owner.client.from('calendar_items').select('created_by').eq('id',item.id).single())).created_by===null)
 check('Child profile retained',(await must(owner.client.from('household_people').select('id').eq('id',person.id))).length===1)
 check('Shared avatar preserved',!(await owner.client.storage.from('household-avatars').download(path)).error)
 check('Deleted user old JWT cannot read family data',(await must(member.client.from('calendar_items').select('id'))).length===0)
 check('Deleted device registration removed',(await must(admin.from('native_devices').select('user_id').eq('user_id',member.id))).length===0)
 check('Last owner with remaining member cannot omit family confirmation',(await deletion(owner)).status===409)
 check('Last-owner denial preserves family',(await must(owner.client.from('households').select('id').eq('id',hid))).length===1)
 const familyRemoved=await deletion(owner,{delete_household_ids:[hid]})
 check('Explicit family + owner deletion completes',familyRemoved.status===200&&familyRemoved.body.deleted)
 check('Household cascade removes calendar, people and feeds',(await must(admin.from('calendar_items').select('id').eq('household_id',hid))).length===0&&(await must(admin.from('household_people').select('id').eq('household_id',hid))).length===0&&(await must(admin.from('calendar_feeds').select('id').eq('household_id',hid))).length===0)
 check('Physical avatar is deleted',Boolean((await admin.storage.from('household-avatars').download(path)).error))
 check('Other household untouched',(await must(outsider.client.from('households').select('id').eq('id',other))).length===1)
 check('Remaining member Auth account retained',Boolean((await must(admin.auth.admin.getUserById(remaining.id))).user))
 const retryHid=await must(remaining.client.rpc('create_household',{p_name:'Isolated interrupted deletion'}));households.push(retryHid)
 await must(admin.rpc('begin_account_deletion',{p_user_id:remaining.id,p_delete_households:[retryHid]}))
 check('Interrupted deletion is visible to its owner',(await must(remaining.client.rpc('account_deletion_plan'))).pending)
 check('Retry completes without resending removed household IDs',(await deletion(remaining)).body.deleted===true)
 check('Successful deletions remove outbox jobs',(await must(admin.from('account_deletion_jobs').select('user_id').in('user_id',users.map(u=>u.id)))).length===0)
 console.log('PASS '+checks.length+' '+(live?'LIVE':'LOCAL')+' release backend checks')
}finally{
 // Only this run's random fixture IDs. Never select or delete real application records.
 if(paths.length)await admin.storage.from('household-avatars').remove(paths)
 if(households.length){await admin.from('calendar_feeds').delete().in('household_id',households);await admin.from('households').delete().in('id',households)}
 for(const user of users)await admin.auth.admin.deleteUser(user.id)
 mkdirSync('supabase/.temp/mega5',{recursive:true})
 writeFileSync('supabase/.temp/mega5/'+(live?'live':'local')+'-backend-checks.json',JSON.stringify({at:new Date().toISOString(),project:live?project:'local',checks},null,2))
}
