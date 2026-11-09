// Real local GoTrue/PostgREST/PostgreSQL concurrency, never real Aula login.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {localEnvironment,localFixture} from '../scripts/aula-local.mjs';
const env=localEnvironment(),fixture=await localFixture(env),hid=fixture.household.id,uid=fixture.user.id;
const call=async(action,p={},household=hid,user=uid)=>{const r=await fixture.db.rpc('aula_handoff_server',{p_action:action,p_household_id:household,p_user_id:user,p_payload:p});assert.equal(r.error,null);return r.data;};
const secret=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(secret).digest('hex');
const create=await call('create',{token_hash:hash});assert.ok(create.id);
const claims=await Promise.all(Array.from({length:8},()=>call('claim',{token_hash:hash},null,null)));
assert.equal(claims.filter(c=>c.claim_id).length,1);assert.equal(claims.filter(c=>c.error==='AULA_HANDOFF_INVALID').length,7);
console.log('PASS actual PostgreSQL parallel redemption: exactly one of eight wins');
const denied=await fixture.client.rpc('create_aula_handoff',{p_household_id:hid,p_user_id:uid,p_token_hash:hash});assert.ok(denied.error);
console.log('PASS authenticated client cannot bypass server RPC authorization');
const base='http://127.0.0.1:5198';
const post=(path,p,jwt)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(jwt?{authorization:'Bearer '+jwt}:{})},body:JSON.stringify(p)});
assert.equal((await post('/api/aula-handoff-create',{household_id:hid})).status,401);
const r=await post('/api/aula-handoff-create',{household_id:hid},fixture.session.access_token);assert.equal(r.status,200);const created=await r.json();assert.match(created.handoff_secret,/^[A-Za-z0-9_-]{43}$/);
const claimHash=createHash('sha256').update(created.handoff_secret).digest('hex');const c=await call('claim',{token_hash:claimHash},null,null);assert.equal(c.household_id,hid);assert.equal(c.created_by,uid);
const used=await post('/api/aula-handoff',{handoff_secret:created.handoff_secret,refresh_token:'synthetic-never-sent-to-provider'});assert.equal(used.status,409);assert.deepEqual(await used.json(),{code:'AULA_HANDOFF_INVALID'});
const wrong=await post('/api/aula-handoff',{handoff_secret:randomBytes(32).toString('base64url'),refresh_token:'synthetic-never-sent-to-provider'});assert.equal(wrong.status,409);
console.log('PASS real local API auth, issue, bound claim, replay and wrong-code rejection');
// No real provider verification, scan, or product write was invoked.
