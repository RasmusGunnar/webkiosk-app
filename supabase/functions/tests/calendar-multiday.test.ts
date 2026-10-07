import {parseIcsEvents,eventsToCalendarRows} from '../_shared/calendar-parser.ts';
import {importCalendarFeed} from '../_shared/calendar-import.ts';
const equal=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(JSON.stringify({actual:a,expected:b}));};
const ics=(...events:string[][])=>['BEGIN:VCALENDAR','VERSION:2.0',...events.flatMap(e=>['BEGIN:VEVENT',...e,'END:VEVENT']),'END:VCALENDAR'].join('\r\n');
const feed={id:'feed',household_id:'family',source:'google',feed_url:'https://calendar.google.com/test.ics',assigned_person_id:'person',assigned_person_name:'Mor'};
const range={start:new Date('2026-10-01Z'),end:new Date('2026-11-30Z')};
const rows=(text:string,r=range)=>eventsToCalendarRows(parseIcsEvents(text,r),feed,'owner');
Deno.test('Multi-day DATE DTEND is exclusive, stored end inclusive, raw source end retained',()=>{
 const row=rows(ics(['UID:holiday','DTSTART;VALUE=DATE:20261015','DTEND;VALUE=DATE:20261019','SUMMARY:Ferie']))[0];
 equal(row.payload.date,'2026-10-15');equal(row.payload.end_date,'2026-10-18');equal(row.payload.all_day,true);equal(row.payload.end_time,null);
 equal(row.payload.data.sourceEnd,parseIcsEvents(ics(['UID:holiday','DTSTART;VALUE=DATE:20261015','DTEND;VALUE=DATE:20261019']),range)[0].end);equal(row.payload.person_ids,['person']);
});
Deno.test('Google timed Thu15 to Sun11 preserves exact local interval',()=>{
 const row=rows(ics(['UID:hotel','DTSTART;TZID=Europe/Copenhagen:20261015T150000','DTEND;TZID=Europe/Copenhagen:20261018T110000','SUMMARY:Hotelophold']))[0];
 equal([row.payload.date,row.payload.time,row.payload.end_date,row.payload.end_time,row.payload.all_day],['2026-10-15','15:00','2026-10-18','11:00',false]);
});
Deno.test('Recurring spans starting several days before window remain included, stable slot despite move',()=>{
 const base=['UID:hotel-series','DTSTART;TZID=Europe/Copenhagen:20261015T150000','DTEND;TZID=Europe/Copenhagen:20261018T110000','RRULE:FREQ=WEEKLY;COUNT=3'];
 const narrow={start:new Date('2026-10-24T00:00:00Z'),end:new Date('2026-10-24T23:59:59Z')};
 const old=rows(ics(base),narrow)[0];equal(old.payload.date,'2026-10-22');equal(old.payload.end_date,'2026-10-25');
 const moved=rows(ics(base,['UID:hotel-series','RECURRENCE-ID;TZID=Europe/Copenhagen:20261022T150000','DTSTART;TZID=Europe/Copenhagen:20261023T170000','DTEND;TZID=Europe/Copenhagen:20261026T120000']),narrow)[0];
 equal(moved.externalKey,old.externalKey);equal(moved.payload.end_date,'2026-10-26');
});
Deno.test('All-day recurrence spans DST without occupying exclusive end date',()=>{
 const result=rows(ics(['UID:days','DTSTART;VALUE=DATE:20261023','DTEND;VALUE=DATE:20261027','RRULE:FREQ=WEEKLY;COUNT=2']));
 equal(result.map(r=>[r.payload.date,r.payload.end_date]),[['2026-10-23','2026-10-26'],['2026-10-30','2026-11-02']]);
});
Deno.test('Midnight timed end and missing DTEND remain exact, single day DATE default',()=>{
 equal(rows(ics(['UID:night','DTSTART;TZID=Europe/Copenhagen:20261017T220000','DTEND;TZID=Europe/Copenhagen:20261018T000000']))[0].payload.end_time,'00:00');
 const date=rows(ics(['UID:day','DTSTART;VALUE=DATE:20261015']))[0];equal(date.payload.end_date,date.payload.date);
});
Deno.test('Spring DST DATE recurrence keeps four civil days after the clock change',()=>{
 const result=rows(ics(['UID:spring','DTSTART;VALUE=DATE:20260327','DTEND;VALUE=DATE:20260331','RRULE:FREQ=WEEKLY;COUNT=2']),{start:new Date('2026-03-01Z'),end:new Date('2026-04-30Z')});
 equal(result.map(r=>[r.payload.date,r.payload.end_date]),[['2026-03-27','2026-03-30'],['2026-04-03','2026-04-06']]);
});
Deno.test('Import core sends ongoing source interval before window start to transactional upsert',async()=>{
 let imported:any=null;
 const writer={rpc:(name:string,args:any)=>name==='begin_calendar_feed_import'?Promise.resolve({data:{...feed,import_token:'lease',sync_actor_id:'owner'}}):name==='apply_calendar_feed_import'?(imported=args,Promise.resolve({data:{importedCount:args.p_rows.length}})):Promise.resolve({data:true})};
 await importCalendarFeed(writer,feed.id,'owner',{now:()=>new Date('2026-11-18T12:00:00Z'),fetcher:async()=>new Response(ics(['UID:ongoing','DTSTART;VALUE=DATE:20261015','DTEND;VALUE=DATE:20261025']),{headers:{'content-type':'text/calendar'}})});
 equal(imported.p_rows.length,1);equal(imported.p_rows[0].payload.date,'2026-10-15');equal(imported.p_rows[0].payload.end_date,'2026-10-24');
});
