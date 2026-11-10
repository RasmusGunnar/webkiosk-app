import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceOptions,analysisModelSources,analysisSchemaForSources,validateModelAnalysis,validateAnalysis} from '../server/aula/analysis.ts';
import {source,analyzed,ids} from './fixtures/aula.js';
test('Model selects bounded source spans; exact evidence is resolved by the server, never copied by the model',()=>{
 const s={...source,text:'3.A skal have maling med.\n3.C skal have tuscher med.'},options=evidenceOptions(s),choice=analysisSchemaForSources([s]).properties.findings.items.anyOf[0];
 assert.equal(choice.properties.evidence,undefined);assert.ok(choice.required.includes('evidence_index'));assert.deepEqual(choice.properties.evidence_index,{type:'integer',minimum:0,maximum:options.length-1});
 const input=analysisModelSources([s])[0];assert.equal(input.text,undefined);assert.deepEqual(input.evidence_options,options);
 const index=options.find(o=>o.text.includes('tuscher')).index;
 const [f]=validateModelAnalysis({findings:[{...analyzed,evidence_index:index,evidence:'MODEL PARAPHRASE IS NOT TRUSTED'}]},[s]);
 assert.equal(f.evidence,'3.C skal have tuscher med.');assert.equal(f.evidence_index,undefined);assert.deepEqual(validateAnalysis({findings:[f]},[s]),[f]);
});
test('Unknown indices, cross-source spans and invented people remain blocked',()=>{
 for(const index of [-1,0.5,999,'1',undefined])assert.throws(()=>validateModelAnalysis({findings:[{...analyzed,evidence_index:index}]},[source]),/AULA_ANALYSIS_INVALID_EVIDENCE/);
 const short={...source,source_key:'b'.repeat(64),title:'Title only',text:''};
 assert.throws(()=>validateModelAnalysis({findings:[{...analyzed,source_key:short.source_key,evidence_index:1}]},[source,short]),/AULA_ANALYSIS_INVALID_EVIDENCE/);
 assert.throws(()=>validateModelAnalysis({findings:[{...analyzed,evidence_index:1,person_ids:[ids.carl]}]},[source]),/AULA_ANALYSIS_INVALID_PEOPLE/);
 assert.throws(()=>analysisSchemaForSources([{...source,title:' ',text:''}]),/AULA_INVALID_BATCH/);
});
test('Class checks still inspect original sentence for an indexed shared notice',()=>{
 const s={...source,text:'3.A maling; 3.B pap; 3.C tuscher',person_scopes:[{person_id:ids.ida,class_name:'3.C'}]},opts=evidenceOptions(s);
 const rows=validateModelAnalysis({findings:opts.filter(o=>o.text.startsWith('3.')).map(o=>({...analyzed,evidence_index:o.index}))},[s]);
 assert.equal(rows.length,1);assert.equal(rows[0].evidence,'3.C tuscher');
});
test('Long and non-ASCII source text yields only exact bounded spans and no content loss',()=>{
 const s={...source,title:'',text:'ÆØÅ “husk”\n'+('lang tekst '.repeat(70))+' '.repeat(650)+'torsdag.'},opts=evidenceOptions(s);
 assert.ok(opts.every(o=>o.text.trim()&&o.text.length<=300&&s.text.includes(o.text)));assert.ok(opts.at(-1).text.endsWith('torsdag.'));
});
