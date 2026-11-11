import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {analyzeBatches,analysisBatches} from '../server/aula/scan-analysis.ts';
import {AulaError} from '../server/aula/security.ts';
import {source} from './fixtures/aula.js';
const sources=Array.from({length:300},(_,i)=>({...source,source_key:i.toString(16).padStart(64,'0')}));
test('Full 300-source scan uses exactly 25 batches, at most three in flight, preserving source order',async()=>{
 let active=0,peak=0;const seen=[];
 const result=await analyzeBatches(sources,async(batch,signal)=>{active++;peak=Math.max(peak,active);seen.push(...batch.map(s=>s.source_key));await delay(batch[0]===sources[0]?30:1,undefined,{signal});active--;return [];},AbortSignal.timeout(2000));
 assert.equal(peak,3);assert.equal(active,0);assert.equal(result.length,25);assert.ok(result.every(r=>r.batch.length===12));assert.deepEqual(result.flatMap(r=>r.batch),sources);assert.equal(new Set(seen).size,300);
});
test('An unexpected programming failure cancels and joins workers instead of hiding the bug',async()=>{
 let called=0,active=0,cancelled=0;const failure=Error('synthetic-failure');
 await assert.rejects(()=>analyzeBatches(sources,async(_batch,signal)=>{const n=called++;active++;try{if(n===0){await delay(5);throw failure;}await delay(2000,undefined,{signal});return [];}catch(e){if(signal.aborted)cancelled++;throw e;}finally{active--; }},AbortSignal.timeout(1000)),e=>e===failure);
 assert.equal(called,3);assert.equal(active,0);assert.equal(cancelled,2);
});
test('One invalid-time batch retains every other strictly validated batch in stable order',async()=>{
 const logs=[];const result=await analyzeBatches(sources,async batch=>{if(batch[0]===sources[0])throw Error('AULA_ANALYSIS_INVALID_TIME');return [];},AbortSignal.timeout(1000),(stage,counts,code)=>logs.push({stage,counts,code}));
 assert.equal(result.length,25);assert.equal(result[0].error,'AULA_ANALYSIS_INVALID_TIME');assert.equal(result.filter(r=>!r.error).length,24);assert.deepEqual(result.flatMap(r=>r.batch),sources);assert.equal(logs.filter(l=>l.code).length,1);
});
test('All failed batches and authorization failure are never reported as partial success',async()=>{
 await assert.rejects(()=>analyzeBatches(sources.slice(0,24),async()=>{throw new AulaError('AULA_ANALYSIS_INVALID_TIME',422)},AbortSignal.timeout(1000)),/AULA_ANALYSIS_INVALID_TIME/);
 await assert.rejects(()=>analyzeBatches(sources,async()=>{throw new AulaError('AULA_ANALYSIS_AUTH_FAILED',502)},AbortSignal.timeout(1000)),/AULA_ANALYSIS_AUTH_FAILED/);
});
test('AI budget reserves time for saving valid results and skips remaining batches',async()=>{
 const result=await analyzeBatches(sources,async(batch,signal)=>{if(batch[0]!==sources[0])await delay(500,undefined,{signal});return [];},AbortSignal.timeout(1000),()=>{},20);
 assert.ok(result.some(r=>!r.error));assert.ok(result.some(r=>r.error));
});
test('Unicode-heavy source batches stay within the Edge byte cap',()=>{
 const huge=sources.slice(0,12).map(s=>({...s,text:'界'.repeat(6000)})),batches=analysisBatches(huge);
 assert.ok(batches.length>1);assert.deepEqual(batches.flat(),huge);assert.ok(batches.every(sources=>Buffer.byteLength(JSON.stringify({sources}))<=95000));
});
test('Parent cancellation stops all work; empty scans make no AI request',async()=>{
 assert.deepEqual(await analyzeBatches([],async()=>assert.fail('called'),AbortSignal.timeout(1000)),[]);
 const abort=new AbortController();let started=0;const promise=analyzeBatches(sources,async(_batch,signal)=>{started++;await delay(2000,undefined,{signal});return [];},abort.signal);abort.abort();await assert.rejects(()=>promise);assert.equal(started,3);
});
