import {makeScheduledHandler} from '../sync-calendar-feeds/index.ts';
import {parseIcsEvents,eventsToCalendarRows} from '../import-calendar-feed/index.ts';
const assert=(ok:unknown)=>{if(!ok)throw new Error('Assertion failed')};
const equal=(a:unknown,b:unknown)=>assert(JSON.stringify(a)===JSON.stringify(b));
const secret='local-test-scheduler-secret-not-production';
const cal=(events:string[][])=>['BEGIN:VCALENDAR','VERSION:2.0',...events.flatMap(e=>['BEGIN:VEVENT',...e,'END:VEVENT']),'END:VCALENDAR'].join('\r\n');
const range={start:new Date('2026-10-01T00:00:00Z'),end:new Date('2026-10-31T23:59:59Z')};
const simple=cal([['UID:stable','DTSTART:20261006T140000Z','SUMMARY:Title']]);
function harness({failFirst=false}={}) {
 const claims=new Set<string>(),applied:string[]=[],failed:string[]=[],methods:string[]=[];let writers=0,concurrency=0,maxConcurrency=0;
 const writer={rpc:async(name:string,args:any)=>{
  if(name==='due_calendar_feeds')return {data:[{id:'one'},{id:'two'},{id:'three'}]};
  if(name==='begin_calendar_feed_import'){if(claims.has(args.p_feed_id))return {error:{message:'busy'}};claims.add(args.p_feed_id);return {data:{id:args.p_feed_id,household_id:'family',source:'google',feed_url:'https://calendar.google.com/'+args.p_feed_id,is_active:true,import_token:'lease',sync_actor_id:'owner'}}}
  if(name==='apply_calendar_feed_import'){applied.push(args.p_feed_id);claims.delete(args.p_feed_id);return {data:{importedCount:1}}}
  if(name==='fail_calendar_feed_import'){failed.push(args.p_feed_id);claims.delete(args.p_feed_id);return {}}
  throw new Error('Unexpected RPC');
 }};
 const handler=makeScheduledHandler({clientFactory:(()=>{writers++;return writer}) as any,
  env:key=>({CALENDAR_SYNC_SECRET:secret,SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-server-only'} as Record<string,string>)[key],
  now:()=>new Date('2026-10-06T12:00:00Z'),
  fetcher:(async(url:URL,init:RequestInit)=>{methods.push(init.method||'GET');concurrency++;maxConcurrency=Math.max(maxConcurrency,concurrency);await new Promise(r=>setTimeout(r,8));concurrency--;return new Response(failFirst&&url.pathname==='/one'?'INCOMPLETE':simple)}) as typeof fetch});
 const request=(headers:Record<string,string>={'x-calendar-sync-secret':secret},body={})=>new Request('https://edge.example/sync',{method:'POST',headers,body:JSON.stringify(body)});
 return {handler,request,applied,failed,methods,metrics:()=>({writers,maxConcurrency})};
}
Deno.test('Scheduled handler rejects anonymous, anon-key-only and wrong-secret callers before privileged access',async()=>{
 const h=harness();
 for(const headers of [{},{authorization:'Bearer public-anon-key'},{'x-calendar-sync-secret':'wrong'}])equal((await h.handler(h.request(headers as Record<string,string>))).status,401);
 equal(h.metrics().writers,0);
});
Deno.test('Scheduled handler shares parser/import core, ignores caller IDs, bounds concurrency and never writes back to source',async()=>{
 const h=harness(),r=await h.handler(h.request(undefined,{feedId:'attacker',householdId:'foreign'}));
 equal(r.status,200);equal((await r.json()).processed,3);equal(h.applied.sort(),['one','three','two']);assert(h.metrics().maxConcurrency<=2);equal(h.methods,['GET','GET','GET']);
});
Deno.test('One malformed feed fails safely without blocking subsequent scheduled feeds',async()=>{
 const h=harness({failFirst:true}),r=await h.handler(h.request());equal(r.status,200);
 equal(h.failed,['one']);equal(h.applied.sort(),['three','two']);const body=await r.json();equal(body.results.find((r:any)=>r.feedId==='one').error,'INVALID_ICS');
});
Deno.test('Overlapping scheduled invocations use the same per-feed lease',async()=>{
 const h=harness();await Promise.all([h.handler(h.request()),h.handler(h.request())]);
 equal(h.applied.sort(),['one','three','two']);
});
Deno.test('Malformed discarded components abort whole snapshot rather than deleting omitted events',()=>{
 for(const text of [cal([['DTSTART:20261006T140000Z'],['UID:valid','DTSTART:20261007T140000Z']]),cal([['UID:bad','DTSTART:broken'],['UID:valid','DTSTART:20261007T140000Z']])]){
  let rejected=false;try{parseIcsEvents(text,range)}catch{rejected=true}assert(rejected);
 }
});
Deno.test('Detached occurrence without master keeps its explicit recurrence slot',()=>{
 const events=parseIcsEvents(cal([['UID:detached','RECURRENCE-ID:20261006T140000Z','DTSTART:20261007T160000Z','SUMMARY:Moved']]),range);
 equal(events.length,1);equal(events[0].recurrenceId,'2026-10-06T14:00:00.000Z');
});
Deno.test('EXDATE and cancelled recurrence exclude only source slots; UID is feed scoped',()=>{
 const events=parseIcsEvents(cal([['UID:weekly','DTSTART:20261006T140000Z','RRULE:FREQ=DAILY;COUNT=4','EXDATE:20261007T140000Z'],['UID:weekly','RECURRENCE-ID:20261008T140000Z','DTSTART:20261008T140000Z','STATUS:CANCELLED']]),range);
 equal(events.map(e=>e.recurrenceId),['2026-10-06T14:00:00.000Z','2026-10-09T14:00:00.000Z']);
 const key=(id:string)=>eventsToCalendarRows(events,{id,household_id:'family',source:'google',feed_url:''},'actor')[0].externalKey;assert(key('a')!==key('b'));
});
