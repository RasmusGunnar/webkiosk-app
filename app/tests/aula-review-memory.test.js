import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {atomicFindings,reviewIdentity,bindLegacy,bindLegacyCandidate} from '../server/aula/review-memory.ts';
import {sourceKey} from '../server/aula/security.ts';
import {normalizedTitle} from '../server/aula/analysis.ts';
process.env.AULA_HMAC_KEY=randomBytes(32).toString('base64');
const hid='00000000-0000-4000-8000-000000000001',person='00000000-0000-4000-8000-000000000002';
const source={source_key:'a'.repeat(64),origin_source_key:'b'.repeat(64),source_kind:'message',text:'Husk varmt tøj torsdag.',title:'Tur',date:null,time:null,end_date:null,end_time:null,location:'',updated_at:'2026-11-09T12:00:00Z',person_ids:[person]};
const row=(title,evidence=source.text)=>({title,evidence,person_ids:[person]});
test('Memory identity ignores AI title, summary, confidence and classification changes',()=>{
 const a=reviewIdentity(hid,source,row('Husk varmt tøj'));const b=reviewIdentity(hid,source,{...row('Medbring varmt tøj'),type:'HOMEWORK',confidence:'MEDIUM',summary:'Different'});
 assert.deepEqual(a,b);assert.match(a.origin_source_key,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(a).includes('tøj'));
});
test('Real Thursday to Friday source change preserves action and changes revision',()=>{
 const a=reviewIdentity(hid,source,row('Husk varmt tøj'));const changed={...source,text:'Husk varmt tøj fredag.'};const b=reviewIdentity(hid,changed,row('Medbring varmt tøj',changed.text));
 assert.equal(a.action_key,b.action_key);assert.notEqual(a.source_revision,b.source_revision);assert.notEqual(a.material_revision,b.material_revision);
});
test('Three actions in one sentence retain three independent source-bound identities',()=>{
 const s={...source,text:'Husk madpakke, drikkedunk og varmt tøj torsdag.'};
 const keys=['Husk madpakke','Medbring drikkedunk','Husk varmt tøj'].map(title=>reviewIdentity(hid,s,row(title,s.text)).action_key);
 assert.equal(new Set(keys).size,3);
 assert.equal(reviewIdentity(hid,s,row('Medbring madpakke',s.text)).action_key,keys[0]);
});
test('Grouped AI list and three separate AI findings resolve to the same three actions',()=>{
 const s={...source,text:'Husk madpakke, drikkedunk og varmt tøj torsdag.'};
 const split=atomicFindings(s,row('Medbring madpakke, drikkedunk og varmt tøj',s.text));assert.equal(split.length,3);
 const separate=['Husk madpakke','Husk drikkedunk','Husk varmt tøj'].map(title=>reviewIdentity(hid,s,row(title,s.text)).action_key).sort();
 assert.deepEqual(split.map(f=>reviewIdentity(hid,s,f).action_key).sort(),separate);
});
test('Reading and bringing the same object are separate source actions',()=>{
 const s={...source,text:'Læs bogen. Medbring bogen torsdag.'};
 const a=reviewIdentity(hid,s,row('Læs bogen','Læs bogen.')),b=reviewIdentity(hid,s,row('Husk bogen','Medbring bogen torsdag.'));
 assert.notEqual(a.action_key,b.action_key);
});
test('Person and origin isolate identities while model date changes do not',()=>{
 const a=reviewIdentity(hid,source,row('Husk varmt tøj'));
 assert.notEqual(a.action_key,reviewIdentity(hid,source,{...row('Husk varmt tøj'),person_ids:[hid]}).action_key);
 assert.notEqual(a.action_key,reviewIdentity(hid,{...source,origin_source_key:'c'.repeat(64)},row('Husk varmt tøj')).action_key);
 assert.deepEqual(a,reviewIdentity(hid,source,{...row('Medbring varmt tøj'),date:'2099-01-01'}));
});
test('Structured MeeBook item retains action when provider moves its date',()=>{
 const s={...source,source_kind:'meebook',structured_type:'task',text:'Aflevering af ugetræningsside - UGE 45',date:'2026-11-12'};
 const a=reviewIdentity(hid,s,row('Aflever ugetræningsside',s.text));const b=reviewIdentity(hid,{...s,date:'2026-11-13'},row('Ugetræningsside skal afleveres',s.text));
 assert.equal(a.action_key,b.action_key);assert.notEqual(a.material_revision,b.material_revision);
});
test('Legacy binding requires exact old HMAC, never a fuzzy cross-source title match',()=>{
 const legacy={id:hid,title:'Husk varmt tøj',type:'REMINDER',person_ids:[person],source_kind:'message',status:'ignored'};
 legacy.source_key=sourceKey(hid,'finding',`${source.source_key}:${person}:REMINDER:${normalizedTitle(legacy.title)}`);
 const unrelated={...legacy,id:person,source_key:'f'.repeat(64)};
 assert.equal(bindLegacy(hid,[source],[legacy,unrelated]).length,1);assert.ok(legacy.identity);assert.equal(unrelated.identity,undefined);
});
test('Legacy manual review title/person edits can be linked by the original candidate HMAC',()=>{
 const f={...row('Husk varmt tøj'),type:'REMINDER'},originalKey=sourceKey(hid,'finding',`${source.source_key}:${person}:REMINDER:${normalizedTitle(f.title)}`);
 const edited={id:person,source_key:originalKey,source_kind:'message',status:'accepted',title:'My changed title',person_ids:[hid]};
 assert.equal(bindLegacyCandidate(hid,source,f,[edited]).length,1);assert.equal(edited.identity.action_key,reviewIdentity(hid,source,f).action_key);
});
