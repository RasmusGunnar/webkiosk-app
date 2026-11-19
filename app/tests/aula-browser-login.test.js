import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes,randomUUID,createHash} from 'node:crypto'
import {createServer} from 'node:http'
import {makeBrowserLogin,browserOAuthConfig,CALLBACK} from '../server/aula/browser-login.ts'
import {DEFAULT_OAUTH_CONFIG} from '../server/aula/vendor/aula-oauth.ts'
import {AulaError,seal,unseal} from '../server/aula/security.ts'
import {makeHandlers} from '../server/aula/service.ts'
import {refreshSession} from '../server/aula/provider.ts'
import {AulaHttpClient} from '../server/aula/vendor/http.ts'
import {parseAppLink} from '../src/lib/app-links.js'
process.env.AULA_SESSION_ENCRYPTION_KEY=randomBytes(32).toString('base64')
process.env.AULA_HMAC_KEY=randomBytes(32).toString('base64')
const hid=randomUUID(),uid=randomUUID(),id=randomUUID(),claim_id=randomUUID()
const cfg={...DEFAULT_OAUTH_CONFIG,clientId:'synthetic-approved-client',redirectUri:CALLBACK}
async function server(handler,fn){const s=createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));try{await fn(`http://127.0.0.1:${s.address().port}`)}finally{s.closeAllConnections();await new Promise(r=>s.close(r))}}
const post=(url,value)=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)})
test('Browser onboarding fails closed without separately registered provider client and exact callback',()=>{
 assert.throws(()=>browserOAuthConfig({}),/AULA_BROWSER_NOT_CONFIGURED/)
 const env={AULA_BROWSER_LOGIN_ENABLED:'true',AULA_OAUTH_CLIENT_ID:cfg.clientId,AULA_OAUTH_REDIRECT_URI:CALLBACK}
 assert.equal(browserOAuthConfig(env).clientId,cfg.clientId)
 for(const patch of [{AULA_OAUTH_CLIENT_ID:DEFAULT_OAUTH_CONFIG.clientId},{AULA_OAUTH_REDIRECT_URI:'https://evil.invalid'},{AULA_BROWSER_LOGIN_ENABLED:'false'}])assert.throws(()=>browserOAuthConfig({...env,...patch}))
})

test('Legacy refresh client is preserved; registered browser client is bound to its encrypted session',async()=>{
 const before=process.env.AULA_OAUTH_CLIENT_ID;process.env.AULA_OAUTH_CLIENT_ID=cfg.clientId
 try{
  const clients=[],http=new AulaHttpClient({fetcher:async(_url,init)=>{clients.push(new URLSearchParams(init.body).get('client_id'));return new Response(JSON.stringify({access_token:'synthetic-access',refresh_token:'synthetic-rotated',expires_in:3600,token_type:'Bearer'}))}})
  await refreshSession(http,'synthetic-old');await refreshSession(http,'synthetic-old',cfg.clientId)
  await assert.rejects(()=>refreshSession(http,'synthetic-old','unregistered-client'),/AULA_NOT_CONFIGURED/)
  assert.deepEqual(clients,[DEFAULT_OAUTH_CONFIG.clientId,cfg.clientId])
 }finally{if(before===undefined)delete process.env.AULA_OAUTH_CLIENT_ID;else process.env.AULA_OAUTH_CLIENT_ID=before}
})

test('Native Aula return accepts only completion proof and flow; provider codes/tokens cannot be injected',()=>{
 const proof=randomBytes(32).toString('base64url'),url='familiekalender://aula/connected#flow='+id+'&proof='+proof
 assert.deepEqual(parseAppLink(url),{kind:'aula-connected',id,proof})
 for(const bad of [url+'&proof='+proof,url+'&access_token=secret',url.replace('#','?'),url.replace('/connected','/other'),url.replace(proof,'invalid')])assert.equal(parseAppLink(bad),null)
})

test('Every scan rotation preserves registered client binding, including failure after refresh; legacy envelopes remain compatible',async()=>{
 for(const clientId of [undefined,cfg.clientId]){
  let saved;const h=makeHandlers({log:()=>{},authorize:async()=>uid,rpc:async(action,_h,_u,p)=>{if(action==='scan_claim')return {lease:id,encrypted_session:seal(hid,{refresh_token:'synthetic-old',...(clientId?{oauth_client_id:clientId}:{})}),mappings:[]};if(action==='scan_save_session')saved=unseal(hid,p.encrypted_session);return {}},refresh:async(_http,token,client)=>{assert.equal(token,'synthetic-old');assert.equal(client,clientId);return {access_token:'synthetic-access',refresh_token:'synthetic-rotated'}},collect:async()=>{throw new AulaError('AULA_TEMPORARY_ERROR',502)}})
  await server(h.scan,async url=>{assert.equal((await post(url,{household_id:hid})).status,502)})
  assert.deepEqual(saved,{refresh_token:'synthetic-rotated',...(clientId?{oauth_client_id:clientId}:{})})
 }
})
test('Authenticated start, hashed state, encrypted PKCE, callback verification and session finish; no client tokens',async()=>{
 let saved,finished;const calls=[]
 const handler=makeBrowserLogin({config:()=>cfg,authorize:async(_r,h)=>{assert.equal(h,hid);return uid},call:async(a,h,u,p)=>{calls.push(a);if(a==='start'){saved=p;assert.equal(h,hid);return {id,expires_at:'synthetic'}}if(a==='claim'){assert.equal(p.state_hash,saved.state_hash);return {id,claim_id,household_id:hid,created_by:uid,encrypted_flow:saved.encrypted_flow,native:true}}if(a==='prepare'){finished=p;return {prepared:true}}if(a==='finish'){assert.equal(p.completion_hash,finished.completion_hash);return {connected:true}}assert.fail(a)},exchange:async(_http,c,p)=>{assert.equal(c.clientId,cfg.clientId);assert.equal(p.code,'synthetic-code');assert.equal(p.codeVerifier,unseal(hid,saved.encrypted_flow).verifier);return {access_token:'synthetic-access',refresh_token:'synthetic-refresh'}},verify:async (r,_s,_h,clientId)=>{assert.equal(clientId,cfg.clientId);assert.equal(r,'synthetic-refresh');return 'synthetic-rotated'}})
 await server(handler,async url=>{
  const start=await post(url,{household_id:hid,action:'start',native:true}),data=await start.json(),auth=new URL(data.url)
  assert.equal(start.status,200);assert.equal(auth.searchParams.get('redirect_uri'),CALLBACK);assert.equal(auth.searchParams.get('code_challenge_method'),'S256')
  assert.equal(saved.state_hash,createHash('sha256').update(auth.searchParams.get('state')).digest('hex'))
  assert.ok(!JSON.stringify(data).includes('verifier'));assert.ok(!JSON.stringify(saved.encrypted_flow).includes('verifier'))
  const result=await fetch(url+'?state='+auth.searchParams.get('state')+'&code=synthetic-code',{redirect:'manual'})
  assert.equal(result.status,303);const returned=new URL(result.headers.get('location')),proof=new URLSearchParams(returned.hash.slice(1)).get('proof');assert.equal(returned.origin,'null');assert.equal(returned.hostname,'aula');assert.equal(createHash('sha256').update(proof).digest('hex'),finished.completion_hash);assert.deepEqual(calls,['start','claim','prepare']);const confirmed=await post(url,{action:'finish',household_id:hid,id,proof});assert.equal(confirmed.status,200);assert.equal(await result.text(),'')
  assert.equal(unseal(hid,finished.encrypted_session).refresh_token,'synthetic-rotated');assert.equal(unseal(hid,finished.encrypted_session).oauth_client_id,cfg.clientId);assert.deepEqual(calls,['start','claim','prepare','finish'])
 })
})
test('Start rejects anonymous/wall/outsider without touching flows; disabled endpoint touches no auth or storage',async()=>{
 for(const failure of ['auth','config'])await server(makeBrowserLogin({config:()=>{if(failure==='config')throw new AulaError('AULA_BROWSER_NOT_CONFIGURED',503);return cfg},authorize:async()=>{throw new AulaError('AULA_FORBIDDEN',403)},call:async()=>assert.fail('storage')}),async url=>{const r=await post(url,{household_id:hid,action:'start'});assert.equal(r.status,failure==='auth'?403:503)})
})
test('Wrong/reused state and malformed callback never reach token exchange',async()=>{
 let exchanges=0;const handler=makeBrowserLogin({config:()=>cfg,call:async()=>({error:'AULA_HANDOFF_INVALID'}),exchange:async()=>{exchanges++;assert.fail('exchange')}})
 await server(handler,async url=>{for(const query of ['?code=x','?state=bad&code=x','?state='+randomBytes(32).toString('base64url')+'&code=x','?state='+randomBytes(32).toString('base64url')+'&code=x&code=y']){const r=await fetch(url+query);assert.equal(r.status,409);assert.deepEqual(await r.json(),{code:'AULA_HANDOFF_INVALID'})}});assert.equal(exchanges,0)
})
test('Provider failure never echoes tokens, query or stack and cannot finish a session',async()=>{
 let saved;const actions=[];const h=makeBrowserLogin({config:()=>cfg,authorize:async()=>uid,call:async(a,_h,_u,p)=>{actions.push(a);if(a==='start'){saved=p;return {id}}return {id,claim_id,household_id:hid,created_by:uid,encrypted_flow:saved.encrypted_flow}},exchange:async()=>{throw Error('Authorization: secret-cookie code=private')}})
 await server(h,async url=>{const d=await(await post(url,{household_id:hid,action:'start'})).json(),state=new URL(d.url).searchParams.get('state');const r=await fetch(url+'?state='+state+'&code=synthetic');assert.equal(r.status,502);assert.deepEqual(await r.json(),{code:'AULA_TEMPORARY_ERROR'});assert.deepEqual(actions,['start','claim'])})
})
