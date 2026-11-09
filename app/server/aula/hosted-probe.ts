import {setTimeout as delay} from 'node:timers/promises';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {AulaError,equalSecret} from './security.ts';

export function openEventStream(res:ServerResponse){
 res.statusCode=200;res.setHeader('content-type','text/event-stream');
 res.setHeader('cache-control','no-store, no-transform');res.setHeader('x-accel-buffering','no');
 res.setHeader('x-content-type-options','nosniff');res.flushHeaders();
}

// Operator-only transport probe: no household, provider calls, login or storage.
// Fixed duration exceeds the real login's 270s deadline, within its 300s budget.
export async function hostedSseProbe(req:IncomingMessage,res:ServerResponse,p:Record<string,unknown>,durationMs=275_000){
 const authorization=req.headers.authorization;
 if(!equalSecret(typeof authorization==='string'&&authorization.startsWith('Bearer ')?authorization.slice(7):undefined,process.env.AULA_SYNC_SECRET))throw new AulaError('AULA_UNAUTHORIZED',401);
 if(Object.keys(p).length!==0)throw new AulaError('INVALID_REQUEST');
 const abort=new AbortController(),cancel=()=>abort.abort();req.once('aborted',cancel);res.once('close',cancel);
 let heartbeat:ReturnType<typeof setInterval>|undefined;
 try{
  openEventStream(res);res.write('event: probe\ndata: {"stage":"started"}\n\n');
  heartbeat=setInterval(()=>{if(!res.destroyed&&!res.writableEnded)res.write(': heartbeat\n\n');},10_000);
  await delay(durationMs,undefined,{signal:abort.signal});
  if(!res.destroyed&&!res.writableEnded)res.write('event: probe\ndata: {"stage":"complete"}\n\n');
 }catch(e){if(!abort.signal.aborted)throw e;}
 finally{clearInterval(heartbeat);req.off('aborted',cancel);res.off('close',cancel);if(!res.writableEnded)res.end();}
}
