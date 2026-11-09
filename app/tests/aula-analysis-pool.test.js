import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {analyzeBatches} from '../server/aula/scan-analysis.ts';
import {source} from './fixtures/aula.js';
const sources=Array.from({length:300},(_,i)=>({...source,source_key:i.toString(16).padStart(64,'0')}));
test('Full 300-source scan uses exactly 25 batches, at most three in flight, preserving source order',async()=>{
 let active=0,peak=0;const seen=[];
 const result=await analyzeBatches(sources,async(batch,signal)=>{active++;peak=Math.max(peak,active);seen.push(...batch.map(s=>s.source_key));await delay(batch[0]===sources[0]?30:1,undefined,{signal});active--;return [];},AbortSignal.timeout(2000));
 assert.equal(peak,3);assert.equal(active,0);assert.equal(result.length,25);assert.ok(result.every(r=>r.batch.length===12));assert.deepEqual(result.flatMap(r=>r.batch),sources);assert.equal(new Set(seen).size,300);
});
test('A failed batch cancels and joins all workers; no subsequent batch or partial result escapes',async()=>{
 let called=0,active=0,cancelled=0;const failure=Error('synthetic-failure');
 await assert.rejects(()=>analyzeBatches(sources,async(_batch,signal)=>{const n=called++;active++;try{if(n===0){await delay(5);throw failure;}await delay(2000,undefined,{signal});return [];}catch(e){if(signal.aborted)cancelled++;throw e;}finally{active--; }},AbortSignal.timeout(1000)),e=>e===failure);
 assert.equal(called,3);assert.equal(active,0);assert.equal(cancelled,2);
});
test('Parent cancellation stops all work; empty scans make no AI request',async()=>{
 assert.deepEqual(await analyzeBatches([],async()=>assert.fail('called'),AbortSignal.timeout(1000)),[]);
 const abort=new AbortController();let started=0;const promise=analyzeBatches(sources,async(_batch,signal)=>{started++;await delay(2000,undefined,{signal});return [];},abort.signal);abort.abort();await assert.rejects(()=>promise);assert.equal(started,3);
});
