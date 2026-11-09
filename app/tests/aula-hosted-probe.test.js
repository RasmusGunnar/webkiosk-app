import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {hostedSseProbe} from '../server/aula/hosted-probe.ts';
import {makeHandlers} from '../server/aula/service.ts';

test('Hosted SSE probe rejects missing/wrong secret before any auth/provider/storage call',async()=>{
 process.env.AULA_SYNC_SECRET=randomBytes(32).toString('base64');
 const forbidden=()=>{throw Error('Must not invoke product operations');};
 const handler=makeHandlers({authorize:forbidden,rpc:forbidden,login:forbidden}).connect;
 const server=createServer((req,res)=>void handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{for(const authorization of [undefined,'Bearer wrong']){
  const response=await fetch(`http://127.0.0.1:${server.address().port}`,{method:'POST',headers:{'content-type':'application/json','x-aula-probe':'sse-v1',...(authorization?{authorization}:{})},body:'{}'});
  assert.equal(response.status,401);assert.deepEqual(await response.json(),{code:'AULA_UNAUTHORIZED'});
 }}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('Authenticated probe streams immediately, completes and accepts no login data',async()=>{
 const secret=randomBytes(32).toString('base64');process.env.AULA_SYNC_SECRET=secret;
 const server=createServer((req,res)=>void hostedSseProbe(req,res,{},50));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const response=await fetch(`http://127.0.0.1:${server.address().port}`,{headers:{authorization:'Bearer '+secret}});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);assert.match(response.headers.get('cache-control'),/no-store/);
  const reader=response.body.getReader(),first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/started/);assert.doesNotMatch(first,/complete/);
  let rest='';for(;;){const next=await reader.read();if(next.done)break;rest+=new TextDecoder().decode(next.value);}assert.match(rest,/complete/);
  await assert.rejects(()=>hostedSseProbe({headers:{authorization:'Bearer '+secret}},null,{username:'synthetic'},1),{code:'INVALID_REQUEST'});
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
