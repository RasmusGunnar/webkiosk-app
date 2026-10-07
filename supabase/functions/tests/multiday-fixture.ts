import {eventsToCalendarRows,parseIcsEvents} from '../_shared/calendar-parser.ts';
const events=[
 ['UID:multiday-hotel','DTSTART;TZID=Europe/Copenhagen:20261015T150000','DTEND;TZID=Europe/Copenhagen:20261018T110000','SUMMARY:Hotelophold','LOCATION:Aarhus','DESCRIPTION:Et par dage sammen'],
 ['UID:multiday-holiday','DTSTART;VALUE=DATE:20261016','DTEND;VALUE=DATE:20261021','SUMMARY:Ferie'],
 ['UID:multiday-exclusive','DTSTART;VALUE=DATE:20261015','DTEND;VALUE=DATE:20261019','SUMMARY:Google heldagsaftale'],
 ['UID:multiday-recurring','DTSTART;TZID=Europe/Copenhagen:20261015T180000','DTEND;TZID=Europe/Copenhagen:20261017T100000','RRULE:FREQ=WEEKLY;COUNT=3','SUMMARY:Weekendkursus'],
];
export const multidayIcs=['BEGIN:VCALENDAR','VERSION:2.0',...events.flatMap(e=>['BEGIN:VEVENT',...e,'END:VEVENT']),'END:VCALENDAR'].join('\r\n');
if(import.meta.main){
 const [feedId,householdId,userId,personId]=Deno.args;
 const feed={id:feedId,household_id:householdId,source:'google',feed_url:'https://calendar.google.com/fixture.ics',assigned_person_id:personId,assigned_person_name:'Mor'};
 console.log(JSON.stringify(eventsToCalendarRows(parseIcsEvents(multidayIcs,{start:new Date('2026-10-01Z'),end:new Date('2026-11-30Z')}),feed,userId)));
}
