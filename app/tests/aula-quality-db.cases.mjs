import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {prepareReview} from '../server/aula/quality-pipeline.ts';
import {sourceKey} from '../server/aula/security.ts';
export async function qualityChecks({query,ids,server,review,actor,pass,denied}){
 const hash=()=>randomBytes(32).toString('hex');
 const s={source_key:hash(),origin_source_key:hash(),source_kind:'message',title:'Materialer til fælles aktivitet',text:'Husk madpakke og drikkedunk 2099-11-20.',updated_at:'2099-11-16T12:00Z',source_timestamp_known:true,person_ids:[ids.person],explicit_scope:true,date:null,time:null,end_date:null,end_time:null,location:''};
 const f=(title,evidence=s.text)=>({source_key:s.source_key,person_ids:s.person_ids,type:'REMINDER',title,evidence,actionability:'BRING',date:null,time:null,end_date:null,end_time:null,location:'',confidence:'MEDIUM',reason:'Materialer',summary:'Materialer',proposed_action:'CREATE_ACTIVITY'});
 const proposals=(rows,source=s)=>prepareReview(ids.hid,[source],rows,[],[],new Date('2099-11-17T12:00Z')).items.map(({finding,source,identity,components,lifecycle,expires_on})=>({...finding,evidence:undefined,identity,components,lifecycle,expires_on,source_kind:source.source_kind,source_key:sourceKey(ids.hid,'finding-v2',identity.action_key+':'+identity.material_revision)}));
 const upload=async(findings,extra={})=>{const c=await server('scan_claim');return server('scan_finish',{lease:c.lease,children:[],findings,counts:{},api_version:25,...extra});};
 const all=async()=>{await actor(null,'service_role');return(await query('select * from public.aula_findings where household_id=$1',[ids.hid])).rows;};
 const combined=proposals([f('Husk madpakke og drikkedunk')]);assert.equal(combined[0].components.length,2);
 await upload(combined);const original=(await all()).find(r=>r.source_key===combined[0].source_key);await review(original.id,'ignore');
 const snapshot=(await all()).find(r=>r.id===original.id);
 for(const title of ['Husk madpakke','Husk drikkedunk']){
  const result=await upload(proposals([f(title)]));assert.equal(result.memory_counts.component_covered_suppressed,1);
 }
 assert.deepEqual((await all()).find(r=>r.id===original.id),snapshot);pass('Combined ignored item suppresses each later component; review history byte-identical');
 const changed={...s,text:'Husk madpakke, drikkedunk og varmt tøj 2099-11-20.'};
 const updated=proposals([f('Husk madpakke, drikkedunk og varmt tøj',changed.text)],changed);const result=await upload(updated);
 assert.equal(result.memory_counts.cluster_updates,1);
 const row=(await server('status')).findings.find(r=>r.source_key===updated[0].source_key);assert.equal(row.review_state,'UPDATED');assert.match(row.title,/madpakke.*drikkedunk.*varmt tøj/);
 pass('New material component creates UPDATED combined item with previous specifics');
 const claim=await server('scan_claim');await server('scan_memory',{lease:claim.lease});await review(row.id,'ignore');
 const race=await server('scan_finish',{lease:claim.lease,children:[],findings:updated,counts:{},api_version:25});assert.equal(race.memory_counts.component_covered_suppressed,1);pass('Concurrent cluster decision is rechecked transactionally at scan finish');
 // Safe reconciliation only retires exact NEW snapshot rows; reviewed and
 // changed rows plus an unrelated source are retained.
 const legacy={...combined[0],source_key:hash(),identity:{...combined[0].identity,action_key:hash(),origin_source_key:hash()},components:[]};
 await upload([legacy]);const pending=(await all()).find(r=>r.source_key===legacy.source_key);
 const safe={finding_id:pending.id,updated_at:pending.updated_at,origin_source_key:legacy.identity.origin_source_key};
 assert.equal((await upload([],{reconcile:[{...safe,updated_at:'2000-01-01T00:00Z'}]})).memory_counts.quality_retired,0);
 assert.equal((await upload([],{reconcile:[safe]})).memory_counts.quality_retired,1);
 assert.equal((await all()).find(r=>r.id===pending.id).status,'stale');assert.deepEqual((await all()).find(r=>r.id===original.id),snapshot);
 pass('Reconciliation compare-and-set retires only proven obsolete NEW, preserving decisions');
 const ephemeral={...combined[0],source_key:hash(),identity:{...combined[0].identity,action_key:hash(),origin_source_key:hash()},components:combined[0].components.map(c=>({...c,component_key:hash()})),date:null,lifecycle:'immediate',expires_on:'2000-01-01'};
 await upload([ephemeral]);const expired=(await all()).find(r=>r.source_key===ephemeral.source_key);assert.equal(expired.status,'stale');
 const resurrect=await upload([{...ephemeral,title:'AI wording changed',expires_on:'2099-01-01'}]);assert.equal(resurrect.memory_counts.component_covered_suppressed,1);
 pass('Explicit short-lived expiry cannot resurrect unchanged as fragments or AI future dates');
 const persistent={...ephemeral,source_key:hash(),identity:{...ephemeral.identity,action_key:hash()},components:[],actionability:'RESPOND',lifecycle:'persistent',expires_on:null};await upload([persistent]);assert.equal((await all()).find(r=>r.source_key===persistent.source_key).status,'new');pass('Dateless response is persistent and never gets blanket TTL');
 for(const role of ['anon','authenticated']){await actor(ids.adult,role);await denied(role+' cannot read component memory',()=>query('select * from private.aula_review_components'));await denied(role+' cannot bind components',()=>query("select private.aula_bind_components($1,$2,'[]')",[ids.hid,original.id]));}
 const foreign=await server('scan_claim');await denied('Cross-household component binding rejected',()=>server('scan_finish',{lease:foreign.lease,children:[],findings:[],component_bindings:[{finding_id:ids.other,components:combined[0].components}],api_version:25}));await server('scan_fail',{lease:foreign.lease,error:'AULA_STORAGE_ERROR'});
}
