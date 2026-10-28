import {parseIcsEvents,eventsToCalendarRows} from '../_shared/calendar-parser.ts';
const equal=(actual:unknown,expected:unknown)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(JSON.stringify({actual,expected}));};
const range={start:new Date('2026-01-01T00:00:00Z'),end:new Date('2027-01-01T00:00:00Z')};
const feed={id:'feed',household_id:'family',source:'ics',feed_url:''};
const calendar=(...events:string[][])=>['BEGIN:VCALENDAR','VERSION:2.0',...events.flatMap(lines=>['BEGIN:VEVENT',...lines,'END:VEVENT']),'END:VCALENDAR'].join('\r\n');
const rows=(...events:string[][])=>eventsToCalendarRows(parseIcsEvents(calendar(...events),range),feed,'owner');
const civil=(list:ReturnType<typeof rows>)=>list.map(r=>[r.payload.date,r.payload.time,r.payload.end_date,r.payload.end_time]);

for(const [month,offset] of [['07',2],['12',1]] as const){
 Deno.test('TIMEZONE Copenhagen TZID, UTC Z and floating agree in '+month,()=>{
  const local=`2026${month}01T183000`,end=`2026${month}01T193000`,utc=`2026${month}01T${18-offset}3000Z`,utcEnd=`2026${month}01T${19-offset}3000Z`;
  const a=rows(['UID:tzid','DTSTART;TZID=Europe/Copenhagen:'+local,'DTEND;TZID=Europe/Copenhagen:'+end]);
  const b=rows(['UID:utc','DTSTART:'+utc,'DTEND:'+utcEnd]);
  const c=rows(['UID:floating','DTSTART:'+local,'DTEND:'+end]);
  equal(civil(a),[[`2026-${month}-01`,'18:30',`2026-${month}-01`,'19:30']]);equal(civil(a),civil(b));equal(civil(a),civil(c));
  equal(a[0].payload.data.sourceStart,b[0].payload.data.sourceStart);equal(a[0].payload.data.sourceStart,c[0].payload.data.sourceStart);
  equal(b[0].payload.data.timeZone,'Etc/UTC');equal(b[0].payload.data.displayTimeZone,'Europe/Copenhagen');
 });
}
Deno.test('TIMEZONE UTC crossing midnight stores Copenhagen dates and exact end',()=>{
 equal(civil(rows(['UID:midnight','DTSTART:20260701T233000Z','DTEND:20260702T003000Z'])),[['2026-07-02','01:30','2026-07-02','02:30']]);
 equal(civil(rows(['UID:ny','DTSTART;TZID=America/New_York:20260701T123000','DTEND;TZID=America/New_York:20260701T133000'])),[['2026-07-01','18:30','2026-07-01','19:30']]);
});
for(const [day,expected] of [
 ['20260328',['2026-03-28T17:30:00.000Z','2026-03-29T16:30:00.000Z','2026-03-30T16:30:00.000Z']],
 ['20261024',['2026-10-24T16:30:00.000Z','2026-10-25T17:30:00.000Z','2026-10-26T17:30:00.000Z']],
] as const){
 Deno.test('TIMEZONE named and floating recurrence follows DST '+day,()=>{
  for(const prefix of [';TZID=Europe/Copenhagen','']){
   const result=rows(['UID:daily','DTSTART'+prefix+':'+day+'T183000','DTEND'+prefix+':'+day+'T193000','RRULE:FREQ=DAILY;COUNT=3']);
   equal(result.map(r=>r.payload.data.sourceStart),expected);equal(result.map(r=>r.payload.time),['18:30','18:30','18:30']);
  }
 });
}
Deno.test('TIMEZONE UTC recurrence keeps fixed instants while Copenhagen clocks change',()=>{
 const result=rows(['UID:utc-series','DTSTART:20260328T173000Z','DTEND:20260328T183000Z','RRULE:FREQ=DAILY;COUNT=3']);
 equal(result.map(r=>r.payload.time),['18:30','19:30','19:30']);
});
Deno.test('TIMEZONE UTC UNTIL includes the final named-zone occurrence',()=>{
 const result=rows(['UID:until','DTSTART;TZID=Europe/Copenhagen:20260328T183000','RRULE:FREQ=DAILY;UNTIL=20260330T163000Z']);
 equal(result.map(r=>r.payload.date),['2026-03-28','2026-03-29','2026-03-30']);
});
Deno.test('TIMEZONE ambiguous autumn recurrence uses the first local occurrence',()=>{
 const result=rows(['UID:ambiguous','DTSTART;TZID=Europe/Copenhagen:20261024T023000','RRULE:FREQ=DAILY;COUNT=3']);
 equal(result.map(r=>r.payload.data.sourceStart),['2026-10-24T00:30:00.000Z','2026-10-25T00:30:00.000Z','2026-10-26T01:30:00.000Z']);
});
Deno.test('TIMEZONE explicit DST gap uses pre-gap offset and fold uses first occurrence',()=>{
 for(const prefix of [';TZID=Europe/Copenhagen','']){
  equal(rows(['UID:gap','DTSTART'+prefix+':20260329T023000'])[0].payload.data.sourceStart,'2026-03-29T01:30:00.000Z');
  equal(rows(['UID:fold','DTSTART'+prefix+':20261025T023000'])[0].payload.data.sourceStart,'2026-10-25T00:30:00.000Z');
 }
});
Deno.test('TIMEZONE nonexistent spring recurrence is skipped without consuming COUNT',()=>{
 const result=rows(['UID:gap-series','DTSTART;TZID=Europe/Copenhagen:20260328T023000','RRULE:FREQ=DAILY;COUNT=3']);
 equal(result.map(r=>r.payload.data.sourceStart),['2026-03-28T01:30:00.000Z','2026-03-30T00:30:00.000Z','2026-03-31T00:30:00.000Z']);
});
Deno.test('TIMEZONE explicit fold preserves UTC end and exception identity',()=>{
 const single=rows(['UID:fold-end','DTSTART;TZID=Europe/Copenhagen:20261025T023000','DTEND:20261025T030000Z']);
 equal(single[0].payload.data.sourceStart,'2026-10-25T00:30:00.000Z');equal(single[0].payload.data.sourceEnd,'2026-10-25T03:00:00.000Z');
 const result=rows(['UID:fold-slots','DTSTART;TZID=Europe/Copenhagen:20261024T023000','RRULE:FREQ=DAILY;COUNT=3','EXDATE;TZID=Europe/Copenhagen:20261025T023000']);
 equal(result.map(r=>r.payload.date),['2026-10-24','2026-10-26']);
});
Deno.test('TIMEZONE floating UNTIL is a wall-clock boundary independent of property order',()=>{
 const result=rows(['UID:floating-until','RRULE:FREQ=HOURLY;UNTIL=20260701T203000','DTSTART:20260701T183000']);
 equal(result.map(r=>r.payload.time),['18:30','19:30','20:30']);
});
Deno.test('TIMEZONE floating EXDATE and moved override retain canonical recurrence slots',()=>{
 const result=rows(
  ['UID:slots','DTSTART:20260328T183000','DTEND:20260328T193000','RRULE:FREQ=DAILY;COUNT=4','EXDATE:20260329T183000'],
  ['UID:slots','RECURRENCE-ID:20260330T183000','DTSTART:20260330T203000','DTEND:20260330T213000'],
  ['UID:slots','RECURRENCE-ID:20260331T183000','DTSTART:20260331T183000','STATUS:CANCELLED']);
 equal(result.map(r=>r.payload.time),['18:30','20:30']);equal(result[1].payload.data.recurrenceId,'2026-03-30T16:30:00.000Z');
 equal(JSON.parse(result[1].externalKey).at(-1),'2026-03-30T16:30:00.000Z');
});
Deno.test('TIMEZONE all-day DATE, implicit end and recurrence preserve civil days across DST',()=>{
 for(const day of ['20260328','20261024']){
  const result=rows(['UID:date','DTSTART;VALUE=DATE:'+day,'RRULE:FREQ=DAILY;COUNT=3']);
  equal(result.length,3);equal(result.every(r=>r.payload.all_day&&r.payload.time===''&&r.payload.date===r.payload.end_date),true);
  equal(result.every(r=>r.payload.data.sourceStart?.endsWith('T00:00:00.000Z')),true);
 }
 const multi=rows(['UID:multi','DTSTART;VALUE=DATE:20260328','DTEND;VALUE=DATE:20260401']);
 equal(civil(multi),[['2026-03-28','','2026-03-31',null]]);
});
Deno.test('TIMEZONE all-day EXDATE and moved instance use civil recurrence identity',()=>{
 const result=rows(['UID:all-slots','DTSTART;VALUE=DATE:20261024','RRULE:FREQ=DAILY;COUNT=3','EXDATE;VALUE=DATE:20261025'],
  ['UID:all-slots','RECURRENCE-ID;VALUE=DATE:20261026','DTSTART;VALUE=DATE:20261028']);
 equal(result.map(r=>[r.payload.date,r.payload.end_date]),[['2026-10-24','2026-10-24'],['2026-10-28','2026-10-28']]);
 equal(result[1].payload.data.recurrenceId,'2026-10-26T00:00:00.000Z');
});
