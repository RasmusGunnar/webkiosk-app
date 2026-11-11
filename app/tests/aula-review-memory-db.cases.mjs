import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {reviewIdentity} from '../server/aula/review-memory.ts';
import {sourceKey} from '../server/aula/security.ts';

export async function memoryChecks({query,ids,server,review,actor,pass,denied,today}){
 process.env.AULA_HMAC_KEY=randomBytes(32).toString('base64');
 const source={source_key:'1'.repeat(64),origin_source_key:'2'.repeat(64),source_kind:'message',text:'Husk varmt tøj torsdag.',title:'Tur',updated_at:new Date().toISOString(),person_ids:[ids.person],date:null,time:null,end_date:null,end_time:null,location:''};
 const proposal=(s,title,evidence=s.text)=>{const f={source_kind:s.source_kind,person_ids:s.person_ids,title,type:'REMINDER',date:today,time:null,end_date:null,end_time:null,location:'',confidence:'HIGH',reason:'Konkret handling',summary:'Handling til review.',proposed_action:'CREATE_ACTIVITY',evidence};const identity=reviewIdentity(ids.hid,s,f);return {...f,identity,source_updated_at:s.updated_at,source_key:sourceKey(ids.hid,'finding-v2',`${identity.action_key}:${identity.material_revision}`)};};
 const upload=async(findings,bindings=[])=>{const claim=await server('scan_claim');return server('scan_finish',{lease:claim.lease,children:[],findings,bindings,counts:{},api_version:25});};
 const byKey=async key=>(await server('status')).findings.find(f=>f.source_key===key);
 const a=proposal(source,'Husk varmt tøj');await upload([a]);const original=await byKey(a.source_key);await review(original.id,'ignore');
 for(const title of ['Husk varmt tøj','Medbring varmt tøj']){const result=await upload([proposal(source,title)]);assert.equal(result.memory_counts.previously_ignored,1);assert.equal(result.memory_counts.legitimate_new,0);}
 assert.equal((await byKey(a.source_key)).status,'ignored');pass('Ignored action never resurrects across repeated scans and changed AI wording');
 const paper={...source,origin_source_key:'3'.repeat(64),text:'Husk paprør torsdag.'};const p=proposal(paper,'Husk paprør');await upload([p]);const accepted=await byKey(p.source_key);await review(accepted.id,'accept');
 await actor(null,'service_role');const before=(await query("select jsonb_agg(to_jsonb(c) order by id) rows from public.calendar_items c where household_id=$1",[ids.hid])).rows[0].rows;
 assert.equal((await upload([proposal(paper,'Medbring paprør')])).memory_counts.previously_accepted,1);pass('Accepted action suppresses paraphrase without another activity');
 const changed={...paper,text:'Husk paprør fredag.'};const changedProposal={...proposal(changed,'Medbring paprør'),date:'2099-01-02'};const changedResult=await upload([changedProposal]);assert.equal(changedResult.memory_counts.material_updates,1);
 const updated=await byKey(changedProposal.source_key);assert.equal(updated.status,'new');assert.equal(updated.review_state,'UPDATED');
 await actor(null,'service_role');assert.deepEqual((await query("select jsonb_agg(to_jsonb(c) order by id) rows from public.calendar_items c where household_id=$1",[ids.hid])).rows[0].rows,before);pass('Real changed source creates UPDATED review and leaves accepted calendar bytes unchanged');
 await review(updated.id,'ignore');const reverted=await upload([p]);assert.equal(reverted.memory_counts.material_updates,1);
 const revertedRows=(await server('status')).findings.filter(f=>f.status==='new'&&f.review_state==='UPDATED');assert.equal(revertedRows.length,1);assert.notEqual(revertedRows[0].id,accepted.id);pass('Source reverting to an older date is compared to the latest decision and never rewrites history');
 const classified={...proposal(source,'Medbring varmt tøj'),type:'HOMEWORK',date:'2099-01-03'};assert.equal((await upload([classified])).memory_counts.previously_ignored,1);pass('AI-only classification/date changes cannot revive a reviewed action');
 const multi={...source,origin_source_key:'4'.repeat(64),text:'Husk madpakke, drikkedunk og varmt tøj torsdag.'};const three=['Husk madpakke','Husk drikkedunk','Husk varmt tøj'].map(title=>proposal(multi,title));await upload(three);await review((await byKey(three[0].source_key)).id,'ignore');
 const rescan=await upload(three.map(f=>({...f,title:f.title.replace('Husk','Medbring')})));assert.equal(rescan.memory_counts.previously_ignored,1);assert.equal((await byKey(three[1].source_key)).status,'new');assert.equal((await byKey(three[2].source_key)).status,'new');pass('Ignoring lunch leaves bottle and warm clothing independently reviewable');
 const claim=await server('scan_claim');const memory=await server('scan_memory',{lease:claim.lease});assert.ok(memory.findings.some(f=>f.id===original.id&&f.identity.action_key===a.identity.action_key));
 await review((await byKey(three[1].source_key)).id,'ignore');const concurrent=await server('scan_finish',{lease:claim.lease,children:[],findings:[three[1]],counts:{},api_version:25});assert.equal(concurrent.memory_counts.previously_ignored,1);pass('Decision made after scan memory read is rechecked transactionally at finish');
 const legacyKey='5'.repeat(64);await upload([{...a,identity:undefined,source_key:legacyKey,title:'Old duplicate'}]);const legacy=await byKey(legacyKey);
 const cleanup=await upload([],[{finding_id:legacy.id,identity:a.identity}]);assert.equal(cleanup.memory_counts.old_duplicates_cleaned,1);assert.equal((await byKey(legacyKey)).status,'stale');assert.equal((await byKey(a.source_key)).status,'ignored');pass('Proven old pending duplicate becomes stale; historical decision is preserved');
 const foreign=await server('scan_claim');await denied('Cross-household identity binding rejected',()=>server('scan_finish',{lease:foreign.lease,children:[],bindings:[{finding_id:ids.other,identity:a.identity}],findings:[],counts:{},api_version:25}));await server('scan_fail',{lease:foreign.lease,error:'AULA_STORAGE_ERROR'});
 for(const role of ['anon','authenticated']){await actor(ids.adult,role);await denied(role+' cannot read private decision identity',()=>query('select * from private.aula_finding_identity'));}
}
