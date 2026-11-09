import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {randomBytes} from 'node:crypto'
import {makeHandlers} from '../server/aula/service.ts'
import {seal} from '../server/aula/security.ts'
import {source,finding,ida,carl} from './aula-activity.fixtures.js'
test('Scanner preserves one multi-person activity and matches only exact activity assignments',async()=>{
 const keys=['AULA_SESSION_ENCRYPTION_KEY','AULA_HMAC_KEY'],previous=keys.map(k=>process.env[k]);keys.forEach(k=>process.env[k]=randomBytes(32).toString('base64'))
 try{
  const hid='00000000-0000-4000-8000-000000000001',uid='00000000-0000-4000-8000-000000000002'
  for(const existingType of [null,'Opgave','Aktivitet']){
   const calls=[],f=finding({type:'HOMEWORK',person_ids:[carl,ida]})
   const handlers=makeHandlers({authorize:async()=>uid,rpc:async(action,_hid,_uid,p)=>{
    calls.push({action,p});return action==='scan_claim'?{lease:uid,encrypted_session:seal(hid,{refresh_token:'synthetic-old'}),mappings:[],last_success_at:null}:{}
   },refresh:async()=>({access_token:'synthetic-access',refresh_token:'synthetic-rotation'}),collect:async()=>({children:[],sources:[source],counts:{messages:1},api_version:25}),items:async()=>existingType?[{...f,type:existingType,person_ids:[ida,carl]}]:[],analyze:async()=>[f,f]})
   const req=Object.assign(new EventEmitter(),{method:'POST',headers:{},body:{household_id:hid}})
   let response;const res=Object.assign(new EventEmitter(),{setHeader(){},end(body){response=JSON.parse(body)}})
   await handlers.scan(req,res)
   assert.equal(res.statusCode,200);assert.equal(response.findings,1)
   const rows=calls.find(c=>c.action==='scan_finish').p.findings
   assert.deepEqual(rows[0].person_ids,[ida,carl].sort());assert.equal(rows[0].person_id,null)
   assert.equal(rows[0].type,'HOMEWORK');assert.equal(rows[0].proposed_action,existingType==='Aktivitet'?'MATCH_EXISTING':'CREATE_ACTIVITY')
  }
 }finally{keys.forEach((key,i)=>previous[i]===undefined?delete process.env[key]:process.env[key]=previous[i])}
})
