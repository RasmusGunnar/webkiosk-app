import test from 'node:test'
import assert from 'node:assert/strict'
import {makeHandler} from '../../supabase/functions/aula-analyze/index.ts'
import {source,finding,schoolExamples} from './aula-activity.fixtures.js'
const secret='synthetic-analyzer-secret-'.repeat(2)
test('Edge analyzer uses the activity schema and returns school classifications unchanged',async()=>{
 const rows=schoolExamples.map(([type,title,date])=>finding({type,title,date}))
 let requests=0
 const handler=makeHandler({secret,apiKey:'synthetic-key-not-used',fetcher:async(url,options)=>{
  requests++;assert.equal(url,'https://api.openai.com/v1/responses')
  const request=JSON.parse(options.body)
  for(const choice of request.text.format.schema.properties.findings.items.anyOf)assert.deepEqual(choice.properties.proposed_action.enum,['CREATE_ACTIVITY','NO_ACTION','MATCH_EXISTING'])
  assert.equal(request.store,false)
  return Response.json({output_text:JSON.stringify({findings:rows.map(row=>({...row,evidence_index:1}))})})
 }})
 const response=await handler(new Request('https://local.test/analyze',{method:'POST',headers:{'x-aula-analyze-secret':secret},body:JSON.stringify({sources:[source]})}))
 assert.equal(response.status,200);assert.equal(requests,1)
 const result=await response.json();assert.equal(result.findings.length,8)
 assert.ok(result.findings.every(f=>f.proposed_action==='CREATE_ACTIVITY'))
 assert.deepEqual(result.findings.map(f=>f.type),schoolExamples.map(([type])=>type))
})
test('Obsolete task output is rejected by the analyzer, never sent to acceptance',async()=>{
 const handler=makeHandler({secret,apiKey:'synthetic-key-not-used',fetcher:async()=>Response.json({output_text:JSON.stringify({findings:[finding({proposed_action:'CREATE_TASK',evidence_index:1})]})})})
 const response=await handler(new Request('https://local.test/analyze',{method:'POST',headers:{'x-aula-analyze-secret':secret},body:JSON.stringify({sources:[source]})}))
 assert.equal(response.status,422)
})
