import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import {makeHandlers} from '../server/aula/service.ts';
import {seal,AulaError} from '../server/aula/security.ts';
import {source,analyzed,ids} from './fixtures/aula.js';
process.env.AULA_HMAC_KEY=randomBytes(32).toString('base64');process.env.AULA_SESSION_ENCRYPTION_KEY=randomBytes(32).toString('base64');
test('A partial scan persists validated findings and rotation, reports partial, and never auto-accepts',async()=>{
 const sources=Array.from({length:13},(_,i)=>({...source,source_key:i.toString(16).padStart(64,'0')})),calls=[],logs=[];
 const h=makeHandlers({log:e=>logs.push(e),authorize:async()=>ids.adult,rpc:async(a,_hid,_uid,p)=>{calls.push({a,p});return a==='scan_claim'?{lease:ids.flow,encrypted_session:seal(ids.household,{refresh_token:'synthetic'}),mappings:[]}:{}},refresh:async()=>({access_token:'synthetic',refresh_token:'rotated'}),collect:async()=>({sources,children:[],counts:{source_meebook_status:3,source_messages_status:1,partial:1},api_version:25}),items:async()=>[],analyze:async batch=>{if(batch.length===12)throw new AulaError('AULA_ANALYSIS_INVALID_TIME',422);return [{...analyzed,source_key:batch[0].source_key,date:'2099-01-01'}]}});
 const req=Object.assign(new EventEmitter(),{method:'POST',headers:{},body:{household_id:ids.household}});let response;
 const res=Object.assign(new EventEmitter(),{setHeader(){},end(s){response=JSON.parse(s)}});await h.scan(req,res);
 assert.equal(res.statusCode,200);assert.equal(response.status,'PARTIAL_SUCCESS');assert.equal(response.sources.meebook,'FAIL');assert.equal(response.counts.ai_failed_batches,1);assert.equal(response.findings,1);
 const saved=calls.find(c=>c.a==='scan_finish').p;assert.equal(saved.findings[0].evidence,undefined);assert.equal(saved.findings[0].status,undefined);assert.equal(saved.findings[0].proposed_action,'CREATE_ACTIVITY');assert.ok(calls.some(c=>c.a==='scan_save_session'));assert.ok(!calls.some(c=>c.a==='scan_fail'||c.a==='accept'));
 assert.ok(logs.some(l=>l.stage==='aula.scan.analysis.partial'));assert.ok(!JSON.stringify(logs).includes(source.text));
});
test('DB integrity failure after analysis cannot be presented as partial success',async()=>{
 const calls=[],h=makeHandlers({log:()=>{},authorize:async()=>ids.adult,rpc:async(a)=>{calls.push(a);if(a==='scan_finish')throw new AulaError('AULA_STORAGE_ERROR',502);return a==='scan_claim'?{lease:ids.flow,encrypted_session:seal(ids.household,{refresh_token:'synthetic'}),mappings:[]}:{}},refresh:async()=>({access_token:'synthetic',refresh_token:'rotated'}),collect:async()=>({sources:[],children:[],counts:{},api_version:25}),items:async()=>[]});
 let response;const req=Object.assign(new EventEmitter(),{method:'POST',headers:{},body:{household_id:ids.household}}),res=Object.assign(new EventEmitter(),{setHeader(){},end(s){response=JSON.parse(s)}});await h.scan(req,res);
 assert.equal(res.statusCode,502);assert.equal(response.code,'AULA_STORAGE_ERROR');assert.equal(calls.at(-1),'scan_fail');
});
