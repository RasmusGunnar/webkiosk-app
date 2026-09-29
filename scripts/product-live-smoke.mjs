import {createRequire} from 'node:module'
import {mkdirSync,writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
const require=createRequire(new URL('../app/package.json',import.meta.url)),{createClient}=require('@supabase/supabase-js')
process.chdir(fileURLToPath(new URL('../',import.meta.url)))
if(!process.argv.includes('--allow-live-tests'))throw Error('Explicit --allow-live-tests required; isolated fixtures only')
const project='oyyqniwppytipdktzwsy',url='https://'+project+'.supabase.co'
const keys=JSON.parse(execFileSync('cmd.exe',['/d','/s','/c','npx.cmd --yes supabase@2.118.0 projects api-keys --project-ref '+project+' --reveal --output json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}))
const options={auth:{persistSession:false,autoRefreshToken:false}},publicKey=keys.find(k=>k.name==='anon').api_key
const admin=createClient(url,keys.find(k=>k.name==='service_role').api_key,options)
const owner=createClient(url,publicKey,options),member=createClient(url,publicKey,options),outsider=createClient(url,publicKey,options),anonymous=createClient(url,publicKey,options)
const unwrap=r=>{if(r.error)throw Error(r.error.message);return r.data}
const users=[],households=[],report={project,started_at:new Date().toISOString(),checks:{},cleanup:false}
const check=(label,value)=>{if(!value)throw Error('FAIL '+label);report.checks[label]='PASS';console.log('PASS '+label)}
try {
 for(const client of [owner,member,outsider]){
  const email='product-smoke-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1'
  const user=unwrap(await admin.auth.admin.createUser({email,password,email_confirm:true})).user
  users.push({id:user.id,email,password});unwrap(await client.auth.signInWithPassword({email,password}))
 }
 const hid=unwrap(await owner.rpc('create_household',{p_name:'Isolated Mega 4 acceptance'}));households.push(hid)
 const other=unwrap(await outsider.rpc('create_household',{p_name:'Isolated Mega 4 other family'}));households.push(other)
 check('owner_member_list',unwrap(await owner.rpc('list_household_members',{p_household_id:hid}))[0]?.email===users[0].email)
 check('anonymous_list_denied',Boolean((await anonymous.rpc('list_household_members',{p_household_id:hid})).error))
 check('cross_household_list_denied',Boolean((await outsider.rpc('list_household_members',{p_household_id:hid})).error))
 const token=unwrap(await owner.rpc('invite_household_member',{p_household_id:hid,p_email:users[1].email,p_role:'adult'}))
 check('wrong_email_cannot_accept',Boolean((await outsider.rpc('accept_household_invitation',{p_token:token})).error))
 check('email_bound_invite_accepted',unwrap(await member.rpc('accept_household_invitation',{p_token:token}))===hid)
 check('token_single_use',Boolean((await member.rpc('accept_household_invitation',{p_token:token})).error))
 check('member_list_roles',unwrap(await member.rpc('list_household_members',{p_household_id:hid})).some(row=>row.user_id===users[1].id&&row.role==='adult'))
 check('adult_cannot_invite',Boolean((await member.rpc('invite_household_member',{p_household_id:hid,p_email:users[2].email,p_role:'adult'})).error))
 const revoked=unwrap(await owner.rpc('invite_household_member',{p_household_id:hid,p_email:users[2].email,p_role:'adult'}))
 const inv=unwrap(await owner.from('household_invitations').select('id').eq('household_id',hid).eq('email',users[2].email).single())
 check('adult_cannot_revoke',Boolean((await member.rpc('revoke_household_invitation',{p_invitation_id:inv.id})).error))
 check('other_owner_cannot_revoke',Boolean((await outsider.rpc('revoke_household_invitation',{p_invitation_id:inv.id})).error))
 check('anonymous_revoke_denied',Boolean((await anonymous.rpc('revoke_household_invitation',{p_invitation_id:inv.id})).error))
 unwrap(await owner.rpc('revoke_household_invitation',{p_invitation_id:inv.id}))
 check('owner_revoke_persisted',Boolean(unwrap(await owner.from('household_invitations').select('revoked_at').eq('id',inv.id).single()).revoked_at))
 check('revoked_link_denied',Boolean((await outsider.rpc('accept_household_invitation',{p_token:revoked})).error))
 const person=unwrap(await owner.from('household_people').insert({household_id:hid,name:'Archive fixture',role:'child'}).select().single())
 const item=unwrap(await owner.from('calendar_items').insert({household_id:hid,created_by:users[0].id,title:'Archive history fixture',person_ids:[person.id],date:'2026-09-29',type:'Opgave',done:true}).select().single())
 unwrap(await owner.from('household_people').update({is_active:false,reward_enabled:false}).eq('id',person.id))
 check('archive_retains_history',unwrap(await member.from('calendar_items').select('person_ids').eq('id',item.id).single()).person_ids.includes(person.id))
 // Generate a recovery link only for our fixture; no outbound email.
 const recovery=unwrap(await admin.auth.admin.generateLink({type:'recovery',email:users[1].email,options:{redirectTo:'http://127.0.0.1:5178'}}))
 check('local_redirect_allowlisted',new URL(recovery.properties.action_link).searchParams.get('redirect_to')==='http://127.0.0.1:5178')
 const recovered=createClient(url,publicKey,options)
 unwrap(await recovered.auth.verifyOtp({token_hash:recovery.properties.hashed_token,type:'recovery'}))
 const password=randomUUID()+'!Bb2';unwrap(await recovered.auth.updateUser({password}))
 check('recovery_password_change',Boolean(unwrap(await member.auth.signInWithPassword({email:users[1].email,password})).session))
 await recovered.auth.signOut({scope:'global'})
} finally {
 for(const client of [owner,member,outsider])await client.auth.signOut({scope:'global'}).catch(()=>{})
 for(const id of households)unwrap(await admin.from('households').delete().eq('id',id))
 for(const user of users)unwrap(await admin.auth.admin.deleteUser(user.id))
 report.cleanup=true;report.finished_at=new Date().toISOString()
 mkdirSync('supabase/.temp/mega4',{recursive:true});writeFileSync('supabase/.temp/mega4/live-smoke.json',JSON.stringify(report,null,2)+'\n')
}
console.log('LIVE MEGA 4 PASS '+Object.keys(report.checks).length+'; isolated fixtures removed')
