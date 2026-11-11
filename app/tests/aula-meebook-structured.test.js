import test from 'node:test';
import assert from 'node:assert/strict';
import {meebookMetadata,retainStructuredTasks} from '../server/aula/meebook.ts';
import {schoolClasses} from '../server/aula/school-scope.ts';
import {validateAnalysis,analysisSchemaForSources,TIME_PATTERN} from '../server/aula/analysis.ts';
import {source,analyzed,ids} from './fixtures/aula.js';
const task={...source,source_kind:'meebook',title:'Matematik',text:'Aflevering af ugetræningsside',structured_type:'task',subject:'Matematik',date_context:'week_plan_day',date:'2026-11-12',time:null};
test('Confirmed production task/comment types retain content semantics without assuming an unobserved assignment enum',()=>{
 assert.equal(meebookMetadata({type:'task',pill:'Matematik'},{date:'2026-11-12T00:00:00+01:00'}).date,'2026-11-12');
 assert.equal(meebookMetadata({type:'comment'},{}).structured_type,'comment');assert.equal(meebookMetadata({type:'assignment'},{}).structured_type,'unknown');
 assert.equal(meebookMetadata({},{}).date_context,'unknown');
 assert.equal(meebookMetadata({type:'task'},{date:'11/12'},'2026-W46').date,'2026-11-12');
 assert.equal(meebookMetadata({type:'task'},{date:'11/12'}).date,null);
});
test('A worksheet week label does not replace the actual planned day; explicit action dates remain editable',()=>{
 const s={...task,text:'Aflevering af ugetræningsside - UGE 45'};
 const [f]=validateAnalysis({findings:[{...analyzed,date:'2001-11-12',evidence:s.text}]},[s]);assert.equal(f.date,s.date);
 const explicit={...s,text:'Læs side 30 til torsdag'};
 assert.equal(validateAnalysis({findings:[{...analyzed,date:'2026-11-19',evidence:explicit.text}]},[explicit])[0].date,'2026-11-19');
});
test('A provider-marked task survives AI omission as a medium-confidence Activity suggestion for its mapped child',()=>{
 const {results,retained}=retainStructuredTasks([task],[]);assert.equal(retained,1);assert.equal(results[0].actionability,'DEADLINE');assert.equal(results[0].proposed_action,'CREATE_ACTIVITY');assert.equal(results[0].confidence,'MEDIUM');assert.deepEqual(results[0].person_ids,[ids.ida]);assert.equal(results[0].time,null);assert.equal(results[0].date,task.date);
 assert.equal(retainStructuredTasks([{...task,structured_type:'comment'}],[]).results.length,0);assert.equal(retainStructuredTasks([{...task,structured_type:'unknown'}],[]).results.length,0);
 assert.equal(retainStructuredTasks([{...task,text:'Ingen lektier i denne uge.'}],[]).results.length,0);
 const [noMidnight]=validateAnalysis({findings:[{...analyzed,time:'00:00',evidence:task.text}]},[task]);assert.equal(noMidnight.time,null);
});
test('Multiple actions survive; structured fallback does not duplicate an already extracted task',()=>{
 const text='Læs side 30 og medbring passer på torsdag.',s={...task,text},rows=[{...analyzed,type:'HOMEWORK',title:'Læs side 30',actionability:'PREPARE',evidence:text},{...analyzed,title:'Husk passer',actionability:'BRING',evidence:text}];
 const result=retainStructuredTasks([s],validateAnalysis({findings:rows},[s]));assert.equal(result.retained,0);assert.equal(result.results.length,2);
});
test('Homework page numbers are not class scopes; actual other-class assignments remain excluded',()=>{
 for(const text of ['Rumfang s.30 i format','Læs side 3 i bogen'])assert.deepEqual(schoolClasses(text),[]);
 assert.deepEqual(schoolClasses('3.A maling. 3B pap. 3 C tuscher.'),['3a','3b','3c']);
 const s={...task,text:'Rumfang s.30 i format',person_scopes:[{person_id:ids.ida,class_name:'3.C'}]};
 assert.equal(validateAnalysis({findings:[{...analyzed,evidence:s.text}]},[s]).length,1);
 assert.equal(retainStructuredTasks([{...s,text:'3.A skal aflevere opgaven.'}],[]).results.length,0);
});
test('Model schema prevents the production invalid-time regression while server validation stays strict',()=>{
 const choice=analysisSchemaForSources([source]).properties.findings.items.anyOf[0];assert.equal(choice.properties.time.pattern,TIME_PATTERN);assert.equal(choice.properties.end_time.pattern,TIME_PATTERN);
 for(const time of ['','9:00','09.00','09:00:00','24:00','12:99','torsdag']){assert.ok(!new RegExp(TIME_PATTERN).test(time));assert.throws(()=>validateAnalysis({findings:[{...analyzed,time}]},[source]),/AULA_ANALYSIS_INVALID_TIME/);}
 for(const time of [null,'00:00','23:59'])assert.equal(validateAnalysis({findings:[{...analyzed,time}]},[source])[0].time,time);
});
