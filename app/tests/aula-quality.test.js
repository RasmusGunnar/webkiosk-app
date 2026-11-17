import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {findingScope,resolveActionDate,familyAction} from '../server/aula/quality-rules.ts';
import {prepareReview} from '../server/aula/quality-pipeline.ts';
import {reviewIdentity} from '../server/aula/review-memory.ts';
process.env.AULA_HMAC_KEY=randomBytes(32).toString('base64');
const hid='00000000-0000-4000-8000-000000000001',a='00000000-0000-4000-8000-000000000002',b='00000000-0000-4000-8000-000000000003';
const source=(extra={})=>({source_key:'a'.repeat(64),origin_source_key:'b'.repeat(64),source_kind:'message',title:'Tur til Experimentarium',text:'Husk stor madpakke, drikkedunk og varmt tøj.',updated_at:'2026-11-16T12:00:00Z',source_timestamp_known:true,person_ids:[a],person_scopes:[{person_id:a,class_name:'3.C',name:'Ida Eksempel'}],explicit_scope:true,date:null,time:null,end_date:null,end_time:null,location:'',...extra});
const finding=(s,extra={})=>({source_key:s.source_key,person_ids:s.person_ids,type:'REMINDER',title:'Husk stor madpakke, drikkedunk og varmt tøj',evidence:s.text,date:null,time:null,end_date:null,end_time:null,location:'',confidence:'MEDIUM',reason:'Medbring',summary:'Medbring',proposed_action:'CREATE_ACTIVITY',actionability:'BRING',...extra});
const run=(sources,rows,history=[])=>prepareReview(hid,sources,rows,history,[],new Date('2026-11-17T12:00Z'));
test('Quality scope: correct class only; foreign class excluded, not all recipients',()=>{
 const s=source({text:'3.A skal have maling. 3.B skal have pap. 3.C skal have tuscher.'});
 assert.deepEqual(findingScope(s,finding(s,{title:'Husk tuscher'})).people,[a]);
 assert.equal(findingScope(s,finding(s,{title:'Husk maling'})).basis,'excluded');
 assert.equal(findingScope(s,finding(s,{title:'Husk pap'})).basis,'excluded');
});
test('Quality scope: actual shared recipient scope stays multi-person',()=>{
 const s=source({person_ids:[a,b]});assert.deepEqual(findingScope(s,finding(s)).people,[a,b]);
});
test('Quality scope: other named participant commitment does not belong to our children',()=>{
 const s=source({text:'Oliver tager 1,5 liter saftevand med.'});assert.equal(run([s],[finding(s,{title:'Medbring 1,5 liter saftevand'})]).items.length,0);
 const own=source({text:'Ida tager 1,5 liter saftevand med.'});assert.deepEqual(findingScope(own,finding(own)).people,[a]);
});
test('Quality scope: unresolved message is unassigned rather than applied to three children',()=>{
 const s=source({explicit_scope:false,person_ids:[a,b]});const out=run([s],[finding(s)]);assert.equal(out.items.length,1);assert.deepEqual(out.items[0].finding.person_ids,[]);
});
test('Quality dates: explicit, source-relative, Copenhagen boundary and structured priority',()=>{
 const s=source();assert.equal(resolveActionDate(s,'På torsdag skal børnene have regntøj med').date,'2026-11-19');
 assert.equal(resolveActionDate(s,'Husk regntøj 20. november').date,'2026-11-20');
 assert.equal(resolveActionDate({...s,updated_at:'2026-11-16T23:30Z'},'i morgen').date,'2026-11-18');
 assert.equal(resolveActionDate({...s,deadline:'2026-11-21'},'20. november').date,'2026-11-21');
 assert.equal(resolveActionDate({...s,source_timestamp_known:false},'på torsdag').date,null);
 assert.equal(resolveActionDate(s,'mandag eller torsdag').date,null);
});
test('Quality dates: MeeBook day is not a fabricated publication timestamp',()=>{
 const s=source({source_kind:'meebook',source_timestamp_known:false,date:'2026-11-20',date_context:'week_plan_day'});
 assert.equal(resolveActionDate(s,'Læs side 20').date,'2026-11-20');
 assert.equal(resolveActionDate(s,'Læs i morgen').date,null);
});
test('Quality numeric quantities, page references and clocks are not dates; supported meeting time survives',()=>{
 const s=source();for(const text of ['Medbring 1.5 liter mælk','Læs side 12/11','Møde kl. 9.11'])assert.equal(resolveActionDate(s,text).date,null,text);
 const meeting=source({text:'Møde 20. november kl. 18.30'});assert.equal(run([meeting],[finding(meeting,{actionability:'ATTEND',time:'18:30'})]).items[0].finding.time,'18:30');
});
test('Quality noise: teaching/history/general information no finding; BRING and RESPOND/PAY survive',()=>{
 for(const [text,actionability] of [['Klassen havde en rigtig god tur.','ATTEND'],['Vi starter nyt emne om brøker.','DO'],['Computerregler i klassen.','IMPORTANT_INFO'],['Vi arbejder med brøker.','DO']]){
  const s=source({text});assert.equal(familyAction(s,finding(s,{actionability})),false,text);
 }
 for(const [text,actionability] of [['På fredag skal børnene have regntøj med.','BRING'],['Tilmeld jer skole-hjem-samtale.','RESPOND'],['Betal 75 kr. og tilmeld senest fredag.','PAY']]){const s=source({text});assert.equal(familyAction(s,finding(s,{actionability})),true,text);}
});
test('Quality combined food, drink, clothes retains all specifics and memory components',()=>{
 const s=source(),rows=['Husk stor madpakke','Husk drikkedunk','Husk varmt tøj'].map(title=>finding(s,{title}));
 const one=run([s],rows);assert.equal(one.items.length,1);assert.equal(one.items[0].components.length,3);assert.match(one.items[0].finding.title,/stor madpakke.*drikkedunk.*varmt tøj/);
 const grouped=run([s],[finding(s)]);assert.deepEqual(grouped.items[0].components.map(c=>c.component_key).sort(),one.items[0].components.map(c=>c.component_key).sort());
});
test('Quality preserves decimal quantities and does not expand a sentence into malformed UI fragments',()=>{
 const s=source({text:'Medbring 1,5 liter mælk og 200 gram ris.'});const out=run([s],[finding(s,{title:'Medbring 1,5 liter mælk og 200 gram ris'})]);
 assert.equal(out.items.length,1);assert.match(out.items[0].finding.title,/1,5 liter mælk/);assert.equal(out.items[0].components.length,2);
});
test('Quality non-merge: sports clothes and maths same child/date are independent',()=>{
 const s=source({text:'Husk idrætstøj. Aflever matematik på fredag.'});const out=run([s],[finding(s,{title:'Husk idrætstøj',evidence:'Husk idrætstøj.'}),finding(s,{title:'Aflever matematik',evidence:'Aflever matematik på fredag.',actionability:'DEADLINE'})]);assert.equal(out.items.length,2);
});
test('Quality strong event context inherits date; exact cross-source duplicate produces one item',()=>{
 const s=source(),e=source({source_key:'c'.repeat(64),origin_source_key:'d'.repeat(64),source_kind:'calendar',date:'2026-11-20',text:'Tur til Experimentarium'});
 const other={...s,source_key:'e'.repeat(64),origin_source_key:'f'.repeat(64),source_kind:'post'};
 const out=run([s,e,other],[finding(s),finding(other)]);assert.equal(out.items.length,1);assert.equal(out.items[0].finding.date,'2026-11-20');assert.equal(out.counts.exact_duplicates_suppressed,1);
});
test('Quality uncertain event / different children / generic title never merge or inherit date',()=>{
 const s=source({title:'Tur'}),e=source({source_key:'c'.repeat(64),source_kind:'calendar',title:'Tur',date:'2026-11-20'});
 assert.equal(run([s,e],[finding(s)]).items[0].finding.date,null);
 const specific=source(),foreign={...e,title:specific.title,person_ids:[b]};assert.equal(run([specific,foreign],[finding(specific)]).items[0].finding.date,null);
});
test('Quality linked past event retires old preparation rather than inventing current date',()=>{
 const s=source(),e=source({source_key:'c'.repeat(64),source_kind:'calendar',date:'2026-11-13'});const out=run([s,e],[finding(s)]);assert.equal(out.items.length,0);assert.equal(out.counts.dated_expired,1);
});
test('Quality lifecycle is opt-in, source anchored; persistent response/payment never TTL',()=>{
 const s=source({text:'Husk snarest skiftetøj.'});let out=run([s],[finding(s,{title:'Husk skiftetøj'})]);assert.equal(out.items[0].expires_on,'2026-11-30');
 const p=source({text:'Udfyld snarest formularen og betal.'});out=run([p],[finding(p,{title:'Udfyld formular og betal',actionability:'RESPOND'})]);assert.equal(out.items[0].lifecycle,'persistent');assert.equal(out.items[0].expires_on,null);
 assert.equal(run([source()],[finding(source())]).items[0].expires_on,null);
});
test('Quality accepted combined old item binds separate actions only with proven source and recipients',()=>{
 const s=source(),f=finding(s),h={id:hid,title:f.title,person_ids:[a],status:'accepted',identity:reviewIdentity(hid,s,f)};
 const out=run([s],['Husk stor madpakke','Husk drikkedunk'].map(title=>finding(s,{title})),[h]);assert.equal(out.componentBindings.length,1);assert.equal(out.componentBindings[0].components.length,2);
 assert.equal(run([s],[f],[{...h,person_ids:[b]}]).componentBindings.length,0);
 assert.equal(run([s],[f],[{...h,status:'stale',automatically_expired:true}]).componentBindings.length,1);
 assert.equal(run([s],[f],[{...h,status:'stale'}]).componentBindings.length,0);
});
test('Quality new action for proven same event retains reviewed material context',()=>{
 const s=source(),e=source({source_key:'c'.repeat(64),origin_source_key:'d'.repeat(64),source_kind:'calendar',date:'2026-11-20'});
 const old=run([s,e],[finding(s,{title:'Husk stor madpakke og drikkedunk'})]).items[0];
 const history={id:hid,title:old.finding.title,date:old.finding.date,person_ids:[a],status:'ignored',identity:old.identity,components:old.components};
 const update={...s,text:'Husk også varmt tøj.'},out=run([update,e],[finding(update,{title:'Husk varmt tøj'})],[history]);
 assert.equal(out.items.length,1);assert.match(out.items[0].finding.title,/madpakke.*drikkedunk.*varmt tøj/);assert.equal(out.items[0].components.length,3);
});
test('Quality changed source timestamp advances relative action revision, not unchanged wording drift',()=>{
 const s=source({text:'Husk regntøj på torsdag.'}),f=finding(s,{title:'Husk regntøj'}),a1=run([s],[f]).items[0],a2=run([{...s,updated_at:'2026-11-23T12:00Z'}],[f]).items[0];
 assert.equal(a1.identity.action_key,a2.identity.action_key);assert.notEqual(a1.identity.source_revision,a2.identity.source_revision);assert.notEqual(a1.identity.material_revision,a2.identity.material_revision);
});
