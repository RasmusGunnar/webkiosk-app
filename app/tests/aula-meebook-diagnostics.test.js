import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMeeBook,diagnoseMeeBook} from '../server/aula/meebook-diagnostics.ts';
test('MeeBook diagnostics expose counters and enum values, never content, identities or URLs',()=>{
 const counts=inspectMeeBook([{name:'PRIVATE CHILD',unilogin:'PRIVATE ID',weekPlan:[{date:'2026-11-12',tasks:[{type:'assignment',id:'PRIVATE ID',title:'Aflevering af uge\u00adtræningsside - UGE 45',content:'PRIVATE MESSAGE',pill:'PRIVATE SUBJECT',editUrl:'https://example.invalid/?token=PRIVATE'},{type:'comment',content:'PRIVATE MESSAGE'},{type:'invalid PRIVATE',content:'PRIVATE'}]}]}],'2026-W46');
 assert.equal(counts.type_assignment,1);assert.equal(counts.reference_type_assignment,1);assert.equal(counts.type_assignment_field_editUrl,1);assert.equal(counts.day_date_in_requested_week,3);assert.equal(counts.type_other,1);
 assert.ok(!JSON.stringify(counts).includes('PRIVATE'));assert.ok(Object.values(counts).every(Number.isInteger));
});
test('Yearless MeeBook labels are distinguished without logging dates or trusting Date.parse default year',()=>{
 const data=[{weekPlan:[{date:'11/11',tasks:[{type:'task',content:'synthetic'}]},{date:'11.11.',tasks:[{type:'comment'}]},{date:'11',tasks:[{type:'comment'}]}]}];
 const counts=inspectMeeBook(data,'2026-W46');assert.equal(counts.date_shape_day_month_slash,1);assert.equal(counts.date_shape_day_month_dot,1);assert.equal(counts.date_shape_single_number,1);assert.equal(counts.date_parse_default_year,3);assert.ok(!JSON.stringify(counts).includes('11/11'));
});
test('Diagnostic reads only profiles and three week plans; no messages, AI or writes',async()=>{
 const weeks=[],logs=[];const provider={read:async method=>{assert.ok(['profiles.getProfilesByLogin','profiles.getProfileContext'].includes(method));return method==='profiles.getProfilesByLogin'?{profiles:[{children:[{id:101,userId:'opaque'}]}]}:{}},meebook:async(_ctx,children,week)=>{assert.equal(children.length,1);weeks.push(week);return [{weekPlan:[]}];}};
 await diagnoseMeeBook(provider,(stage,counts)=>logs.push({stage,counts}),new Date('2026-11-11T10:00:00Z'));
 assert.deepEqual(weeks,['2026-W45','2026-W46','2026-W47']);assert.equal(logs.length,4);
});
