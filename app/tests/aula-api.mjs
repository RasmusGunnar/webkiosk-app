// Vercel dev -> real local Supabase Auth/PostgREST -> actual migration RPCs.
// No Aula network request is made. Refuse to touch any connected local session.
import assert from 'node:assert/strict'
import {createClient} from '@supabase/supabase-js'
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {localEnvironment,localFixture,reviewRoot} from '../scripts/aula-local.mjs'
import {seal} from '../server/aula/security.ts'
const env=localEnvironment(),fixture=await localFixture(env),checks=[]
const pass=name=>{checks.push(name);console.log('PASS',name)}
const request=async(endpoint,session=fixture.session,extra={},household=fixture.household.id)=>{
 const r=await fetch('http://127.0.0.1:5198/api/aula-'+endpoint,{method:'POST',headers:{'content-type':'application/json',...(session?{authorization:'Bearer '+session.access_token}:{})},body:JSON.stringify({household_id:household,...extra}),signal:AbortSignal.timeout(30000)})
 assert.match(r.headers.get('content-type')||'',/application\/json/,'API must not return SPA HTML');return {status:r.status,data:await r.json()}
}
const server=async(action,payload={})=>{const r=await fixture.db.rpc('aula_server',{p_action:action,p_household_id:fixture.household.id,p_user_id:fixture.user.id,p_payload:payload});if(r.error)throw Error('Local RPC failed: '+r.error.code);return r.data}
const initial=await request('status');assert.equal(initial.status,200)
assert.ok(!initial.data.connection||initial.data.connection.status==='disconnected','Refusing to alter an existing connected/connecting local session')
pass('Authenticated status through Vercel -> Auth -> PostgREST')
for(const endpoint of ['status','connect','identity','disconnect','scan'])assert.equal((await request(endpoint,null,{username:'synthetic'})).status,401)
pass('All five Node endpoints reject anonymous HTTP callers with JSON')
assert.equal((await request('status',fixture.session,{},'10000000-0000-4000-8000-000000000001')).status,403)
assert.equal((await request('connect',fixture.session,{username:''})).status,400)
assert.equal((await request('scan')).status,409)
pass('Cross-household denied; invalid login makes no provider call; missing session requests reauth')
const childEmail='aula-review-child@example.invalid',users=await fixture.db.auth.admin.listUsers()
let child=users.data.users.find(u=>u.email===childEmail)
if(!child){const r=await fixture.db.auth.admin.createUser({email:childEmail,password:env.LOCAL_FIXTURE_PASSWORD,email_confirm:true});if(r.error)throw Error('LOCAL_CHILD_SETUP_FAILED');child=r.data.user}
const member=await fixture.db.from('household_members').upsert({household_id:fixture.household.id,user_id:child.id,role:'child'});if(member.error)throw Error('LOCAL_CHILD_MEMBERSHIP_FAILED')
const childClient=createClient(env.SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const childAuth=await childClient.auth.signInWithPassword({email:childEmail,password:env.LOCAL_FIXTURE_PASSWORD});assert.ok(childAuth.data.session)
assert.equal((await request('status',childAuth.data.session)).status,403)
const wallClient=createClient(env.SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),wall=await wallClient.auth.signInAnonymously();assert.ok(wall.data.session)
assert.equal((await request('status',wall.data.session)).status,401)
pass('Real child and anonymous/wall tokens cannot administer Aula')
const flow=await server('begin')
try{
 await server('identity_wait',{flow_id:flow.flow_id,count:2})
 assert.equal((await request('identity',fixture.session,{flow_id:flow.flow_id,index:2})).status,200)
 assert.equal((await server('flow',{flow_id:flow.flow_id})).selected_identity,2)
 pass('Identity selection persists through two independent HTTP/RPC invocations')
 const encrypted=seal(fixture.household.id,{refresh_token:'synthetic-local-contract'},Buffer.from(env.AULA_SESSION_ENCRYPTION_KEY,'base64'))
 await server('finish',{flow_id:flow.flow_id,encrypted_session:encrypted,identity_label:'Forælder'})
 const state=await request('status');assert.equal(state.data.connection.status,'connected');assert.ok(!JSON.stringify(state.data).includes('encrypted_session'));assert.ok(!JSON.stringify(state.data).includes('synthetic-local-contract'))
 const forbiddenColumn=await fixture.client.from('aula_connections').select('encrypted_session');assert.ok(forbiddenColumn.error)
 const privateSchema=await fixture.client.schema('private').from('aula_credentials').select('*');assert.ok(privateSchema.error)
 const serviceRPC=await fixture.client.rpc('aula_server',{p_action:'status',p_household_id:fixture.household.id,p_user_id:fixture.user.id,p_payload:{}});assert.ok(serviceRPC.error)
 pass('REST exposes no ciphertext or private credentials; service RPC denied to authenticated client')
 assert.equal((await request('disconnect')).status,200);assert.equal((await request('status')).data.connection.status,'disconnected')
 pass('Disconnect through actual Node/Auth/RPC boundary')
}finally{await server('disconnect')}
await fixture.db.auth.admin.deleteUser(wall.data.user.id)
writeFileSync(join(reviewRoot,'api-results.json'),JSON.stringify({status:'PASS',checks,realAulaRequests:0,productionTouched:false},null,2))
console.log('AULA HTTP API PASS:',checks.length)
