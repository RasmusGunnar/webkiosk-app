import test from 'node:test'
import assert from 'node:assert/strict'
import {ACTIONS,ANALYSIS_SCHEMA,ANALYSIS_INSTRUCTIONS,validateAnalysis,findExisting} from '../server/aula/analysis.ts'
import {source,finding,schoolExamples,ida,carl} from './aula-activity.fixtures.js'

for(const [type,title,date] of schoolExamples)test(type+': '+title+' is a calendar activity',()=>{
 const [result]=validateAnalysis({findings:[finding({type,title,date})]},[source])
 assert.equal(result.proposed_action,'CREATE_ACTIVITY');assert.equal(result.type,type)
 assert.equal(result.title,title);assert.equal(result.date,date);assert.deepEqual(result.person_ids,[ida])
})
test('structured output allows only the three Aula actions',()=>{
 assert.deepEqual(ACTIONS,['CREATE_ACTIVITY','NO_ACTION','MATCH_EXISTING'])
 assert.deepEqual(ANALYSIS_SCHEMA.properties.findings.items.properties.proposed_action.enum,ACTIONS)
 for(const action of ['CREATE_TASK','CREATE_EVENT'])assert.throws(()=>validateAnalysis({findings:[finding({proposed_action:action})]},[source]),/AULA_ANALYSIS_INVALID/)
 assert.match(ANALYSIS_INSTRUCTIONS,/All accepted suggestions become CREATE_ACTIVITY/)
 assert.match(ANALYSIS_INSTRUCTIONS,/NEVER CREATE_TASK/)
})
test('information, no action and uncertain date retain their review gates',()=>{
 const rows=validateAnalysis({findings:[finding({type:'GENERAL_INFO'}),finding({confidence:'LOW'}),finding({proposed_action:'NO_ACTION'}),finding({date:null})]},[source])
 assert.deepEqual(rows.slice(0,3).map(f=>f.proposed_action),['NO_ACTION','NO_ACTION','NO_ACTION'])
 assert.equal(rows[3].confidence,'MEDIUM');assert.equal(rows[3].date,null)
 assert.equal(rows[3].proposed_action,'CREATE_ACTIVITY')
})
test('multiple supplied people stay together; unrelated IDs remain forbidden',()=>{
 const [f]=validateAnalysis({findings:[finding({person_ids:[ida,carl,ida]})]},[source])
 assert.deepEqual(f.person_ids,[ida,carl])
 assert.throws(()=>validateAnalysis({findings:[finding({person_ids:['00000000-0000-4000-8000-000000000099']})]},[source]),/AULA_ANALYSIS_INVALID/)
})
test('duplicate matching accepts only activities with exactly the selected people',()=>{
 const f=finding({type:'HOMEWORK'}),activity={id:'activity',...f,type:'Aktivitet'},chore={...activity,id:'chore',type:'Opgave'}
 assert.equal(findExisting(f,ida,[chore,activity])?.id,'activity')
 assert.equal(findExisting(f,ida,[chore]),undefined)
 assert.equal(findExisting(f,[ida,carl],[activity]),undefined)
 assert.equal(findExisting(f,ida,[{...activity,person_ids:[ida,carl]}]),undefined)
 assert.equal(findExisting(f,[carl,ida],[{...activity,person_ids:[ida,carl]}])?.id,'activity')
})
