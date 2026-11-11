// Real local Auth -> Node scan handler -> PostgREST -> PostgreSQL. No Aula IO.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {localEnvironment,localFixture} from '../scripts/aula-local.mjs';
import {makeHandlers} from '../server/aula/service.ts';
import {seal,sourceKey} from '../server/aula/security.ts';
const env=localEnvironment();Object.assign(process.env,env);
const fixture=await localFixture(env),hid=fixture.household.id,uid=fixture.user.id,person=fixture.people[0].id;
const check=r=>{if(r.error)throw Error('LOCAL_API_'+r.error.code);return r.data;};
const rpc=async(action,payload={})=>check(await fixture.db.rpc('aula_server',{p_action:action,p_household_id:hid,p_user_id:uid,p_payload:payload}));
const before=await rpc('status');assert.ok(!before.connection||before.connection.status==='disconnected','Refusing to alter an existing connected session');
const source={source_key:sourceKey(hid,'test',randomUUID()),origin_source_key:sourceKey(hid,'test-origin',randomUUID()),source_kind:'message',title:'Synthetic test',text:'Husk varmt tøj torsdag.',date:null,time:null,end_date:null,end_time:null,location:'',updated_at:'2099-11-09T12:00:00Z',person_ids:[person],explicit_scope:true};
let wording='Husk varmt tøj',date='2099-11-12';const logs=[];
const handler=makeHandlers({log:e=>logs.push(e),refresh:async()=>({access_token:'synthetic-local',refresh_token:'synthetic-local-rotated'}),collect:async()=>({children:[],sources:[source],counts:{source_messages_status:1},api_version:25}),analyze:async()=>[{source_key:source.source_key,person_ids:[person],type:'REMINDER',title:wording,date,time:null,end_date:null,end_time:null,location:'',confidence:'HIGH',reason:'Synthetic action',summary:'Synthetic action',proposed_action:'CREATE_ACTIVITY',actionability:'BRING',evidence:source.text}]});
const http=createServer(handler.scan);await new Promise(r=>http.listen(0,'127.0.0.1',r));
const scan=async authorized=>{const r=await fetch(`http://127.0.0.1:${http.address().port}`,{method:'POST',headers:{'content-type':'application/json',...(authorized?{authorization:'Bearer '+fixture.session.access_token}:{})},body:JSON.stringify({household_id:hid,full:true})});return {status:r.status,data:await r.json()};};
const firstIds=new Set(before.findings.map(f=>f.id));let started=false;
try{
 assert.equal((await scan(false)).status,401);
 const flow=await rpc('begin');started=true;await rpc('finish',{flow_id:flow.flow_id,encrypted_session:seal(hid,{refresh_token:'synthetic-local'}),identity_label:'Local synthetic fixture'});
 const claim=await rpc('scan_claim'),childKey=sourceKey(hid,'local-child','synthetic');await rpc('scan_finish',{lease:claim.lease,children:[{provider_child_key:childKey,display_name:'Synthetic child'}],findings:[],api_version:25,counts:{}});
 check(await fixture.client.rpc('aula_set_child_mappings',{p_household_id:hid,p_mappings:[{provider_child_key:childKey,person_id:person}]}));
 assert.equal((await scan(true)).status,200);let rows=(await rpc('status')).findings.filter(f=>!firstIds.has(f.id));assert.equal(rows.length,1);
 check(await fixture.client.rpc('aula_review',{p_household_id:hid,p_finding_id:rows[0].id,p_action:'ignore'}));wording='Medbring varmt tøj';
 const repeat=await scan(true);assert.equal(repeat.status,200);assert.equal(repeat.data.counts.previously_ignored,1);assert.equal(repeat.data.counts.legitimate_new,0);
 source.text='Husk varmt tøj fredag.';date='2099-11-13';const changed=await scan(true);assert.equal(changed.status,200);assert.equal(changed.data.counts.material_updates,1);
 rows=(await rpc('status')).findings.filter(f=>!firstIds.has(f.id));assert.equal(rows.filter(f=>f.status==='new').length,1);assert.equal(rows.find(f=>f.status==='new').review_state,'UPDATED');
 assert.ok(!JSON.stringify(logs).includes(source.text));assert.ok(!JSON.stringify(logs).includes(fixture.session.access_token));assert.ok(!JSON.stringify(logs).includes(hid));
 console.log('AULA_REVIEW_MEMORY_API PASS: real Auth, HTTP scan, PostgreSQL memory, ignored paraphrase suppression, material update, private-safe logs');
}finally{
 if(started)await rpc('disconnect');const rows=(await rpc('status')).findings.filter(f=>!firstIds.has(f.id));if(rows.length)check(await fixture.db.from('aula_findings').delete().in('id',rows.map(f=>f.id)));
 await new Promise(r=>http.close(r));
}
