import test from 'node:test';
import assert from 'node:assert/strict';
import {makeHandler} from '../../supabase/functions/aula-analyze/index.ts';
import {source,analyzed,ids} from './fixtures/aula.js';
import {analysisSchemaForSources,validateAnalysis} from '../server/aula/analysis.ts';
test('Model schema binds each source to its own nonempty person selection, including shared sources',async()=>{
 const second={...source,source_key:'b'.repeat(64),person_ids:[ids.carl,ids.jakob]},sources=[source,second];let sent;
 const logs=[],secret='s'.repeat(40),expected=[analyzed,{...analyzed,source_key:second.source_key,person_ids:[ids.carl,ids.jakob]}];
 const handler=makeHandler({secret,apiKey:'synthetic',log:e=>logs.push(e),fetcher:async(_url,init)=>{sent=JSON.parse(init.body);return Response.json({output_text:JSON.stringify({findings:expected})});}});
 const result=await handler(new Request('https://example.invalid',{method:'POST',headers:{'x-aula-analyze-secret':secret},body:JSON.stringify({sources})}));
 assert.equal(result.status,200);assert.deepEqual((await result.json()).findings,expected);assert.equal(sent.text.format.strict,true);assert.equal(sent.store,false);
 const choices=sent.text.format.schema.properties.findings.items.anyOf;
 assert.equal(choices.length,2);assert.deepEqual(choices[0].properties.source_key.enum,[source.source_key]);assert.deepEqual(choices[0].properties.person_ids.items.enum,[ids.ida]);assert.equal(choices[0].properties.person_ids.minItems,1);
 assert.deepEqual(choices[1].properties.source_key.enum,[second.source_key]);assert.deepEqual(choices[1].properties.person_ids.items.enum,[ids.carl,ids.jakob]);assert.equal(choices[1].properties.person_ids.minItems,1);
 assert.equal(logs.length,0);
});
test('Post-validation still rejects empty, invented and other-source people; it never repairs by widening scope',()=>{
 const second={...source,source_key:'b'.repeat(64),person_ids:[ids.carl]};
 for(const people of [[],[ids.carl],[ids.adult],[ids.ida,ids.carl]])assert.throws(()=>validateAnalysis({findings:[{...analyzed,person_ids:people}]},[source,second]),/AULA_ANALYSIS_INVALID_PEOPLE/);
 assert.throws(()=>analysisSchemaForSources([{...source,person_ids:[]}]),/AULA_INVALID_BATCH/);
 const information={...analyzed,type:'GENERAL_INFO',confidence:'LOW',proposed_action:'NO_ACTION'};assert.deepEqual(validateAnalysis({findings:[information]},[source]),[information]);
});
test('Analysis diagnostics identify static validation stage without content or identifiers',async()=>{
 const logs=[],secret='s'.repeat(40);
 const handler=makeHandler({secret,apiKey:'synthetic',log:e=>logs.push(e),fetcher:async()=>Response.json({output_text:JSON.stringify({findings:[{...analyzed,person_ids:[],summary:'PRIVATE CONTENT NEVER LOG'}]})})});
 const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{'x-aula-analyze-secret':secret},body:JSON.stringify({sources:[source]})}));
 assert.equal(response.status,422);assert.equal(logs[0].code,'AULA_ANALYSIS_INVALID_PEOPLE');assert.equal(logs[0].stage,'aula.scan.analysis.failed');
 assert.deepEqual(Object.keys(logs[0]).sort(),['code','counts','duration_ms','stage']);
 const output=JSON.stringify(logs);for(const privateValue of [source.source_key,...source.person_ids,source.text,'PRIVATE CONTENT NEVER LOG',secret])assert.ok(!output.includes(privateValue));
});
test('Unexpected provider exception messages never enter logs',async()=>{
 const logs=[],secret='s'.repeat(40);const handler=makeHandler({secret,apiKey:'synthetic',log:e=>logs.push(e),fetcher:async()=>{throw Error('token=PRIVATE&cookie=PRIVATE');}});
 await handler(new Request('https://example.invalid',{method:'POST',headers:{'x-aula-analyze-secret':secret},body:JSON.stringify({sources:[source]})}));assert.equal(logs[0].code,'AULA_ANALYSIS_INVALID');assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
});
