import { makeHandler, parseIcsEvents, eventsToCalendarRows } from "../import-calendar-feed/index.ts";
import { fetchFeedText, validateFeedUrl, DEFAULT_FEED_HOSTS } from "../_shared/feed-security.ts";
function assert(value: unknown, label = "assertion failed"): asserts value { if (!value) throw new Error(label); }
function equal(actual: unknown, expected: unknown) { assert(JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify({actual, expected})); }
async function rejects(fn: () => unknown, code?: string) {
  try { await fn(); } catch (error) { if (code) equal((error as Error).message, code); return; }
  throw new Error("Expected rejection");
}
const calendar = (...events: string[][]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.flatMap(event => ["BEGIN:VEVENT", ...event, "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");
const range = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-31T23:59:59Z") };
const simple = calendar(["UID:event-one", "DTSTART:20260907T080000Z", "DTEND:20260907T090000Z", "SUMMARY:School"]);
Deno.test("ICS recurrence keeps RRULE, EXDATE, moved and cancelled overrides", () => {
  const text = calendar(
    ["UID:weekly", "DTSTART:20260907T080000Z", "DTEND:20260907T090000Z", "RRULE:FREQ=WEEKLY;COUNT=4", "EXDATE:20260914T080000Z", "SUMMARY:Weekly"],
    ["UID:weekly", "RECURRENCE-ID:20260921T080000Z", "DTSTART:20260922T100000Z", "DTEND:20260922T110000Z", "SUMMARY:Moved"],
    ["UID:weekly", "RECURRENCE-ID:20260928T080000Z", "DTSTART:20260928T080000Z", "STATUS:CANCELLED"],
  );
  const result = parseIcsEvents(text, range);
  equal(result.map(event => event.start), ["2026-09-07T08:00:00.000Z", "2026-09-22T10:00:00.000Z"]);
  equal(result[1].recurrenceId, "2026-09-21T08:00:00.000Z");
});
Deno.test("ICS all-day events preserve imported fields and stable person ID", () => {
  const events = parseIcsEvents(calendar(["UID:birthday", "DTSTART;VALUE=DATE:20260909", "DTEND;VALUE=DATE:20260910", "SUMMARY:Birthday"]), range);
  const rows = eventsToCalendarRows(events, { id:"feed",household_id:"household",source:"google",feed_url:"",assigned_person_id:"person",assigned_person_name:"Name" }, "user");
  equal(rows[0].payload.time, "");
  equal(rows[0].payload.date, "2026-09-09");
  equal(rows[0].payload.person_ids, ["person"]);
  equal(rows[0].payload.calendar_id, "feed");
  equal(rows[0].payload.external_id, rows[0].payload.data.externalKey);
});
Deno.test("Timezone recurrence preserves Copenhagen wall time over DST", () => {
  const events = parseIcsEvents(calendar(["UID:dst", "DTSTART;TZID=Europe/Copenhagen:20261024T100000", "DTEND;TZID=Europe/Copenhagen:20261024T110000", "RRULE:FREQ=DAILY;COUNT=3"]), range);
  equal(events.map(event => event.start), ["2026-10-24T08:00:00.000Z","2026-10-25T09:00:00.000Z","2026-10-26T09:00:00.000Z"]);
});
Deno.test("Malformed/partial calendars cannot become empty successful imports", async () => {
  await rejects(() => parseIcsEvents("<html>Login required</html>", range), "INVALID_ICS");
  await rejects(() => parseIcsEvents(calendar(["UID:bad","DTSTART:not-a-date"]), range), "INVALID_ICS");
  await rejects(() => parseIcsEvents(calendar(["UID:too-many","DTSTART:20260907T080000Z","RRULE:FREQ=SECONDLY"]), range), "IMPORT_LIMIT");
  equal(parseIcsEvents(calendar(), range), []);
});
Deno.test("URL validation and each redirect prohibit credentials and unapproved hosts", async () => {
  for (const value of ["http://calendar.google.com/calendar","https://user:password@calendar.google.com/calendar","https://127.0.0.1/","https://evil.example/"]) {
    await rejects(() => validateFeedUrl(value, DEFAULT_FEED_HOSTS), "URL_NOT_ALLOWED");
  }
  let calls = 0;
  await rejects(() => fetchFeedText("https://calendar.google.com/calendar", { fetcher: (() => { calls++; return Promise.resolve(new Response(null,{status:302,headers:{location:"http://127.0.0.1/"}})); }) as typeof fetch }), "URL_NOT_ALLOWED");
  equal(calls, 1);
});
Deno.test("HTTP timeout, response-size limit and safe errors", async () => {
  await rejects(() => fetchFeedText("https://calendar.google.com/calendar", {
    maxBytes: 2, fetcher: (() => Promise.resolve(new Response("123"))) as typeof fetch,
  }), "IMPORT_LIMIT");
  await rejects(() => fetchFeedText("https://calendar.google.com/calendar", {
    timeoutMs: 5, fetcher: ((_url: unknown, init: RequestInit) => new Promise((_resolve,reject) => init.signal?.addEventListener("abort",()=>reject(new Error("URL with PRIVATE TOKEN"))))) as typeof fetch,
  }), "FETCH_FAILED");
});
const feedId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
function mockHandler(options: {active?:boolean;admin?:boolean;body?:string;fetchError?:boolean;dbError?:boolean;thenableWriter?:boolean} = {}) {
  const calls: string[] = [], failures: unknown[] = [], batches: any[] = [];
  const feed = {id:feedId,household_id:"household-a",source:"aula",feed_url:"https://kalenderlink.aula.dk/?feed=TEST_ONLY",is_active:options.active ?? true,import_token:"token"};
  const user = {
    auth: {getUser:async()=>({data:{user:{id:"user-a"}}})},
    from:()=>({select:()=>({eq:()=>({single:async()=>({data:feed})})})}),
    rpc:async()=>({data:options.admin ?? true}),
  };
  const writer = {rpc:async(name:string,args:unknown)=>{
    calls.push(name);
    if(name==="apply_calendar_feed_import")batches.push(args);
    if(name==="begin_calendar_feed_import")return {data:feed};
    if(name==="fail_calendar_feed_import"){failures.push(args);return {};}
    if(options.dbError)return {error:{message:"PRIVATE DATABASE URL"}};
    return {data:{importedCount:1,insertedCount:1,updatedCount:0,deletedCount:0}};
  }};
  const rpcWriter = options.thenableWriter ? {rpc:(name:string,args:unknown)=>{const promise=writer.rpc(name,args);return {then:promise.then.bind(promise)};}} : writer;
  const handler=makeHandler({
    clientFactory:((_url:string,key:string)=>key==="public-key"?user:rpcWriter) as any,
    env:(key:string)=>({SUPABASE_URL:"https://example.supabase.co",SUPABASE_ANON_KEY:"public-key",SUPABASE_SERVICE_ROLE_KEY:"test-server-key"} as Record<string,string>)[key],
    now:()=>new Date("2026-09-20T12:00:00Z"),
    fetcher:(()=>{if(options.fetchError)throw new Error("PRIVATE FEED URL");return Promise.resolve(new Response(options.body ?? simple));}) as typeof fetch,
  });
  const request=()=>new Request("https://edge.example/import",{method:"POST",headers:{Authorization:"Bearer test-user-token"},body:JSON.stringify({feedId,household_id:"ATTACKER_IGNORED"})});
  return {handler,calls,failures,request,batches};
}
Deno.test("Inactive feed and non-admin requests never call service writer",async()=>{
  for(const opts of [{active:false},{admin:false}]){
    const mock=mockHandler(opts), response=await mock.handler(mock.request());
    assert(response.status>=400);equal(mock.calls,[]);
  }
});
Deno.test("Aula/Google/ICS handler contract and authoritative server feed identity",async()=>{
  const mock=mockHandler(),response=await mock.handler(mock.request()),body=await response.json();
  equal(response.status,200);equal(body.success,true);equal(body.feedId,feedId);equal(body.importedCount,1);
  equal(mock.calls,["begin_calendar_feed_import","apply_calendar_feed_import"]);
});
Deno.test("Fetch and parse failures persist safe failure status and never clean up",async()=>{
  for(const opts of [{fetchError:true},{body:"not a calendar"}]){
    const mock=mockHandler(opts),response=await mock.handler(mock.request()),body=await response.json();
    assert(response.status>=400);assert(!JSON.stringify(body).includes("PRIVATE"));
    equal(mock.calls,["begin_calendar_feed_import","fail_calendar_feed_import"]);equal(mock.failures.length,1);
  }
});
Deno.test("Database failure is persisted without disclosing raw SQL or credentials",async()=>{
  const mock=mockHandler({dbError:true}),response=await mock.handler(mock.request()),body=await response.json();
  equal(body.error,"IMPORT_FAILED");equal(mock.failures.length,1);
});

Deno.test("Live smoke preserveExisting disables cleanup without bypassing authorization",async()=>{
  const mock=mockHandler();
  const req=new Request("https://edge.example/import",{method:"POST",headers:{Authorization:"Bearer test-user-token"},body:JSON.stringify({feedId,preserveExisting:true})});
  const response=await mock.handler(req);
  equal(response.status,200); equal(mock.batches[0].p_cleanup,false);
  const normal=mockHandler();await normal.handler(normal.request());equal(normal.batches[0].p_cleanup,true);
});

Deno.test("Failure persistence accepts the actual SDK thenable contract without catch",async()=>{
  const mock=mockHandler({fetchError:true,thenableWriter:true});
  const response=await mock.handler(mock.request());
  equal((await response.json()).error,"FETCH_FAILED");equal(mock.failures.length,1);
});

Deno.test('External identity survives source corrections and moved recurrence; feeds and same-day occurrences stay distinct',()=>{
 const feed={id:'feed',household_id:'household',source:'google',feed_url:''};
 const base=parseIcsEvents(simple,range)[0],key=(event:any,source=feed)=>eventsToCalendarRows([event],source,'user')[0].externalKey;
 equal(key(base),key({...base,summary:'Renamed',location:'Elsewhere',start:'2026-09-08T12:00:00Z',end:'2026-09-08T14:00:00Z'}));
 assert(key(base)!==key({...base,uid:'another'}));assert(key(base)!==key(base,{...feed,id:'other-feed'}));
 const recurring={...base,recurrenceId:'2026-09-07T08:00:00.000Z'};
 equal(key(recurring),key({...recurring,start:'2026-09-09T11:00:00Z'}));
 assert(key(recurring)!==key({...recurring,recurrenceId:'2026-09-07T09:00:00.000Z'}));
});
