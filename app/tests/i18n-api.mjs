import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {localSupabase} from '../../scripts/local-supabase.mjs'
const local=localSupabase(),options={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,options),users=[],households=[],checks=[]
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data},check=(name,result)=>{assert.ok(result,name);checks.push(name);console.log('PASS '+name)}
const make=async()=>{const email='i18n-rls-'+randomUUID()+'@example.test',password=randomUUID()+'Aa!1',user=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user;users.push(user.id);const c=createClient(local.API_URL,local.ANON_KEY,options);await must(c.auth.signInWithPassword({email,password}));return {id:user.id,c}}
try{
 const owner=await make(),member=await make(),other=await make(),hid=await must(owner.c.rpc('create_household',{p_name:'I18N isolated RLS'}));households.push(hid)
 await must(admin.from('household_members').insert({household_id:hid,user_id:member.id,role:'adult'}))
 await must(owner.c.from('profiles').upsert({id:owner.id,preferred_locale:'en-GB'}));check('Self profile preference saved',(await must(owner.c.from('profiles').select('preferred_locale').eq('id',owner.id).single())).preferred_locale==='en-GB')
 const foreign=await other.c.from('profiles').update({preferred_locale:'da-DK'}).eq('id',owner.id).select();check('Cannot update another user preference',!!foreign.error||!foreign.data.length)
 check('Invalid profile locale rejected',!!(await owner.c.from('profiles').update({preferred_locale:'de-DE'}).eq('id',owner.id)).error)
 await must(owner.c.from('households').update({default_locale:'en-GB',currency_code:'EUR'}).eq('id',hid));check('Household administrator can set language and currency',(await must(owner.c.from('households').select('currency_code').eq('id',hid).single())).currency_code==='EUR')
 for(const who of [member,other]){const r=await who.c.from('households').update({currency_code:'USD'}).eq('id',hid).select();check('Non-admin cannot change household currency: '+(who===member?'member':'foreign'),!!r.error||!r.data?.length)}
 check('Invalid household currency rejected',!!(await owner.c.from('households').update({currency_code:'BAD'}).eq('id',hid)).error)
 const wall=createClient(local.API_URL,local.ANON_KEY,options);const wallUser=(await must(wall.auth.signInAnonymously())).user;users.push(wallUser.id)
 const code=await must(owner.c.rpc('create_wall_pairing',{p_household_id:hid}));const device=(await must(wall.rpc('redeem_wall_pairing',{p_code:code.code,p_platform:'web'}))).device
 let snapshot=await must(wall.rpc('wall_snapshot'));check('New display follows household preference',snapshot.device.display_locale===null&&snapshot.household.default_locale==='en-GB'&&snapshot.household.currency_code==='EUR')
 await must(owner.c.rpc('set_display_locale',{p_device_id:device.id,p_locale:'da-DK'}));snapshot=await must(wall.rpc('wall_snapshot'));check('Administrator changes display independently',snapshot.device.display_locale==='da-DK'&&snapshot.household.default_locale==='en-GB')
 for(const who of [member,other])check('Unauthorized display locale denied',!!(await who.c.rpc('set_display_locale',{p_device_id:device.id,p_locale:'en-GB'})).error)
 await must(wall.rpc('set_display_locale',{p_device_id:device.id,p_locale:null}));check('Active own display may follow family',(await must(wall.rpc('wall_snapshot'))).device.display_locale===null)
 check('Invalid display locale rejected',!!(await wall.rpc('set_display_locale',{p_device_id:device.id,p_locale:'de-DE'})).error)
 await must(owner.c.rpc('manage_wall_device',{p_device_id:device.id,p_action:'revoke'}));check('Revoked display cannot mutate preferences',!!(await wall.rpc('set_display_locale',{p_device_id:device.id,p_locale:'en-GB'})).error)
 console.log('I18N API/RLS PASS '+checks.length)
}finally{for(const id of households)await admin.from('households').delete().eq('id',id);for(const id of users)await admin.auth.admin.deleteUser(id)}
