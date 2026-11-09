import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomBytes} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {makeHandlers} from '../server/aula/service.ts'
import {ids} from './fixtures/aula.js'
import {AulaUI} from '../src/lib/aula-ui.js'
import {setLocale} from '../src/i18n/index.js'

test('Closing a live SSE stream cancels auth and removes the flow without saving credentials',async()=>{
 process.env.AULA_SESSION_ENCRYPTION_KEY=randomBytes(32).toString('base64')
 process.env.AULA_HMAC_KEY=randomBytes(32).toString('base64')
 const actions=[],cancelled=Promise.withResolvers()
 const handler=makeHandlers({authorize:async()=>ids.adult,rpc:async action=>{actions.push(action);if(action==='cancel')cancelled.resolve();return action==='begin'?{flow_id:ids.flow}:{}},login:async options=>new Promise((_,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})})}).connect
 const server=createServer((req,res)=>void handler(req,res))
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const response=await fetch(`http://127.0.0.1:${server.address().port}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({household_id:ids.household,username:'synthetic'})})
  assert.equal(response.status,200)
  await response.body.cancel()
  await Promise.race([cancelled.promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('cancel not propagated')),2000);timer.unref()})])
  assert.deepEqual(actions,['begin','cancel'])
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})

test('SPA fallback preserves all Node endpoints and real assets, including Vercel dev modules',()=>{
 const config=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url)))
 const route=new RegExp('^'+config.rewrites[0].source+'$')
 for(const path of ['/api','/api/aula-connect','/api/aula-identity','/api/aula-scan','/api/aula-status','/api/aula-disconnect','/src/main.js','/@vite/client','/node_modules/.vite/deps/a.js','/assets/index-abcd.js','/sw.js','/manifest.webmanifest'])assert.equal(route.test(path),false,path)
 for(const path of ['/','/family','/calendar/2026-11-11'])assert.equal(route.test(path),true,path)
})

test('Aula administration stays hidden for child/wall contexts in either locale',()=>{
 const ui=Object.create(AulaUI.prototype);ui.ensure=()=>{}
 for(const locale of ['da-DK','en-GB'])for(const context of [{role:'child',wall:false},{role:'owner',wall:true},{role:null,wall:false}]){
  setLocale(locale);ui.getContext=()=>({householdId:ids.household,...context})
  assert.equal(ui.allowed,false);assert.equal(ui.familyCard(),'');assert.equal(ui.todayCard(),'')
 }
 setLocale('da-DK')
})
