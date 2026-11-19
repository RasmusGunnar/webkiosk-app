import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {applicationApiBase} from '../src/lib/api-origin.js'
import {nativeCors} from '../server/native-cors.ts'
import {makeHandlers} from '../server/aula/service.ts'
import {AulaError} from '../server/aula/security.ts'
import {validateAulaAuthorizeUrl} from '../src/lib/aula-browser-login.js'

test('Bundled native API uses public origin; browser stays same-origin; missing native config fails closed',()=>{
 const env={VITE_PUBLIC_APP_URL:'https://familiekalender-alpha.vercel.app'}
 assert.equal(applicationApiBase({device:{native:true},env}),'https://familiekalender-alpha.vercel.app')
 assert.equal(applicationApiBase({device:{native:false},env}),'')
 assert.throws(()=>applicationApiBase({device:{native:true},env:{},location:{origin:'capacitor://localhost'}}))
 for(const value of ['http://example.test','https://localhost','https://u:p@example.test'])assert.throws(()=>applicationApiBase({device:{native:true},env:{VITE_PUBLIC_APP_URL:value}}))
})
test('Native preflight allows exact bundled origins, without credentials or wildcard',()=>{
 for(const origin of ['capacitor://localhost','https://localhost','https://localhost.evil.invalid','null','http://localhost','https://evil.invalid']){
  const headers={},res={setHeader:(k,v)=>headers[k]=v,end(){}}
  assert.equal(nativeCors({method:'OPTIONS',headers:{origin}},res),true)
  const allowed=['capacitor://localhost','https://localhost'].includes(origin)
  assert.equal(res.statusCode,allowed?204:403)
  assert.equal(headers['Access-Control-Allow-Origin'],allowed?origin:undefined)
  assert.equal(headers['Access-Control-Allow-Credentials'],undefined)
 }
})
test('Native origin does not bypass Aula user authentication',async()=>{
 const handler=makeHandlers({authorize:async()=>{throw new AulaError('AULA_UNAUTHORIZED',401)},rpc:async()=>assert.fail('storage')}).status
 const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r))
 try{const response=await fetch(`http://127.0.0.1:${server.address().port}`,{method:'POST',headers:{origin:'capacitor://localhost','content-type':'application/json'},body:JSON.stringify({household_id:'11111111-1111-4111-8111-111111111111'})});assert.equal(response.status,401);assert.equal(response.headers.get('access-control-allow-origin'),'capacitor://localhost')}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
test('System browser receives only Aula authorize URL with PKCE',()=>{
 const good='https://login.aula.dk/simplesaml/module.php/oidc/authorize.php?state=synthetic&code_challenge_method=S256'
 assert.equal(validateAulaAuthorizeUrl(good),good)
 for(const value of ['https://evil.invalid','javascript:alert(1)',good.replace('login.aula.dk','login.aula.dk.evil.invalid'),good.replace('S256','plain')])assert.throws(()=>validateAulaAuthorizeUrl(value))
})
