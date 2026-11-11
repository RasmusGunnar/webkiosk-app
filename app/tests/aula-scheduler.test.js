import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import {makeHandlers} from '../server/aula/service.ts';
import {sourceCheckpoint,incrementalSources} from '../server/aula/incremental.ts';
import {seal,AulaError} from '../server/aula/security.ts';
import {source,analyzed,ids} from './fixtures/aula.js';
process.env.AULA_HMAC_KEY=randomBytes(32).toString('base64');
process.env.AULA_SESSION_ENCRYPTION_KEY=randomBytes(32).toString('base64');
process.env.AULA_SYNC_SECRET=randomBytes(32).toString('hex');
async function invoke(handler,body={},headers={},method='POST'){
 let data;const req=Object.assign(new EventEmitter(),{method,headers,body}),res=Object.assign(new EventEmitter(),{setHeader(){},end(s){data=JSON.parse(s)}});
 await handler(req,res);return {status:res.statusCode,data};
}
test('Source checkpoints retain old future plans, detect content/date/person edits and ignore synthetic unknown timestamps',()=>{
 const s={...source,updated_at:'2026-10-01T10:00:00Z'},checkpoint=sourceCheckpoint(ids.household,s);
 assert.equal(incrementalSources(ids.household,[s],[checkpoint],true).unchanged,1);
 for(const edit of [{text:'A real change'}, {date:'2099-01-02'}, {person_ids:[ids.carl]}, {updated_at:'2026-10-02T10:00:00Z'}])assert.equal(incrementalSources(ids.household,[{...s,...edit}],[checkpoint],true).candidates.length,1);
 assert.equal(incrementalSources(ids.household,[s],[],true).candidates.length,1);
 assert.equal(incrementalSources(ids.household,[s],[checkpoint],false).candidates.length,1);
 assert.equal(sourceCheckpoint(ids.household,{...s,source_timestamp_known:false}).revision,sourceCheckpoint(ids.household,{...s,source_timestamp_known:false,updated_at:'2026-11-11T10:00:00Z'}).revision);
 assert.ok(!JSON.stringify(checkpoint).includes(s.text));
});
test('Scheduled and manual scans share rotation, collection, memory and finish; unchanged sources make no AI call',async()=>{
 for(const scheduled of [false,true]){
  const calls=[],logs=[];let collected=0,ai=0;
  const h=makeHandlers({log:e=>logs.push(e),authorize:async()=>ids.adult,rpc:async(a,_h,_u,p)=>{calls.push({a,p});if(['schedule_claim','scan_claim'].includes(a))return {lease:ids.flow,encrypted_session:seal(ids.household,{refresh_token:'synthetic'}),mappings:[],last_success_at:'2026-11-10T10:00:00Z'};if(a==='source_checkpoints')return {sources:[sourceCheckpoint(ids.household,source)]};return {};},refresh:async()=>({access_token:'synthetic',refresh_token:'rotated'}),collect:async(_p,_h,_m,_last,full)=>{assert.equal(full,false);collected++;return {sources:[source],children:[],counts:{},api_version:25}},items:async()=>[],analyze:async()=>{ai++;return []}});
  const result=await invoke(h.scan,{household_id:ids.household,...scheduled?{scheduled_slot:'2026-11-11:morning'}:{}},scheduled?{'x-aula-sync-secret':process.env.AULA_SYNC_SECRET}:{});
  assert.equal(result.status,200);assert.equal(collected,1);assert.equal(ai,0);assert.equal(result.data.counts.sources_unchanged,1);assert.equal(result.data.counts.incremental,1);
  assert.ok(calls.some(c=>c.a==='scan_save_session'));assert.ok(calls.some(c=>c.a==='scan_memory'));assert.deepEqual(calls.find(c=>c.a==='scan_finish').p.findings,[]);
  assert.ok(!JSON.stringify(logs).includes(source.text));assert.ok(!calls.some(c=>c.a==='accept'));
 }
});
test('Changed source goes through existing analysis and decision-memory identity, with checkpoint only after successful analysis',async()=>{
 const calls=[],changed={...source,text:source.text+' Ny information.',updated_at:'2026-11-11T10:00:00Z'};
 const h=makeHandlers({log:()=>{},authorize:async()=>ids.adult,rpc:async(a,_h,_u,p)=>{calls.push({a,p});if(a==='scan_claim')return {lease:ids.flow,encrypted_session:seal(ids.household,{refresh_token:'synthetic'}),mappings:[],last_success_at:'2026-11-10'};if(a==='source_checkpoints')return {sources:[sourceCheckpoint(ids.household,source)]};return {};},refresh:async()=>({access_token:'synthetic',refresh_token:'rotated'}),collect:async()=>({sources:[changed],children:[],counts:{},api_version:25}),items:async()=>[],analyze:async()=>[{...analyzed,date:'2099-01-01'}]});
 assert.equal((await invoke(h.scan,{household_id:ids.household})).status,200);
 const p=calls.find(c=>c.a==='scan_finish').p;assert.equal(p.findings.length,1);assert.ok(p.findings[0].identity.action_key);assert.deepEqual(p.checkpoints,[sourceCheckpoint(ids.household,changed)]);assert.equal(p.findings[0].status,undefined);
});
test('Duplicate, busy, ineligible scheduled delivery stops before refresh/provider calls',async()=>{
 for(const skip of ['duplicate','busy','ineligible','reauth']){
  const calls=[],h=makeHandlers({log:()=>{},rpc:async a=>{calls.push(a);return {skip}},refresh:async()=>{assert.fail('provider must not be called')}});
  const r=await invoke(h.scan,{household_id:ids.household,scheduled_slot:'2026-11-11:morning'},{'x-aula-sync-secret':process.env.AULA_SYNC_SECRET});
  assert.equal(r.status,200);assert.equal(r.data.status,'SKIPPED');assert.deepEqual(calls,['schedule_claim']);
 }
});
test('Only shared-secret caller can supply a slot; no full or diagnostic scheduled scan',async()=>{
 const h=makeHandlers({authorize:async()=>ids.adult,log:()=>{},rpc:async()=>assert.fail('storage must not be called')});
 for(const body of [{scheduled_slot:'2026-11-11:morning',full:true},{scheduled_slot:'2026-11-11:morning',diagnostic:'meebook-structure'},{scheduled_slot:'not-a-slot'}])assert.notEqual((await invoke(h.scan,{household_id:ids.household,...body},{'x-aula-sync-secret':process.env.AULA_SYNC_SECRET})).status,200);
 assert.notEqual((await invoke(h.scan,{household_id:ids.household,scheduled_slot:'2026-11-11:morning'})).status,200);
});
test('Scheduler setup rejects anonymous, wrong and reused capability, exposes neither capability nor secret',async()=>{
 let used=false;const token='a'.repeat(64),h=makeHandlers({rpc:async(a,_h,_u,p)=>{assert.equal(a,'schedule_setup');if(p.token!==token||used)throw new AulaError('AULA_UNAUTHORIZED',401);used=true;assert.equal(p.secret,process.env.AULA_SYNC_SECRET);return {}}});
 assert.equal((await invoke(h.setup)).status,401);
 assert.equal((await invoke(h.setup,{}, {'x-aula-setup':'b'.repeat(64)})).status,401);
 const ok=await invoke(h.setup,{}, {'x-aula-setup':token});assert.equal(ok.status,200);assert.deepEqual(ok.data,{configured:true});
 assert.equal((await invoke(h.setup,{}, {'x-aula-setup':token})).status,401);
});
