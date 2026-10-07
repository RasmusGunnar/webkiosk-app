import test from 'node:test'
import assert from 'node:assert/strict'
import {eventInterval,eventOverlapsDate,eventDayState,eventDateRange,eventDayLabel,eventDisplayRange,validateEventInterval} from '../src/lib/calendar-interval.js'
import {materialize,planCreate,planEdit,planDelete,itemValues} from '../src/lib/calendar-semantics.js'
import {weekDates} from '../src/lib/calendar-dates.js'
import {itemMatchesPerson} from '../src/lib/people.js'
import {visibleImports} from '../src/lib/imported-editor.js'
import {calendarPayload} from '../src/lib/calendar.js'
import {overlaySnapshot} from '../src/lib/offline-sync.js'
const hotel={id:'hotel',title:'Hotelophold',type:'Aktivitet',date:'2026-10-15',time:'15:00',end_date:'2026-10-18',end_time:'11:00:00',all_day:false,data:{}}
test('Manual single-day remains one event; explicit all-day range is inclusive',()=>{
 assert.equal(eventInterval({...hotel,end_date:hotel.date,end_time:'17:00'}).multiDay,false)
 const all={...hotel,all_day:true,end_date:'2026-10-18'}
 assert.equal(eventInterval(all).startTime,'')
 assert.ok(eventOverlapsDate(all,'2026-10-18'));assert.ok(!eventOverlapsDate(all,'2026-10-19'))
 const plan=planCreate({...itemValues(all),people:['Alle']},()=> 'one')
 assert.equal(plan.upserts.length,1);assert.equal(plan.upserts[0].values.endDate,'2026-10-18')
})
test('Timed Thu–Sun materializes one ID in a week and the same ID each day',()=>{
 const week=weekDates(hotel.date)
 assert.equal(materialize([hotel],week,{milestones:false}).length,1)
 for(const date of week.slice(3))assert.equal(materialize([hotel],[date],{milestones:false})[0].id,hotel.id)
 assert.equal(eventDayLabel(hotel,'2026-10-16'),'Fortsætter · til søndag')
 assert.match(eventDayLabel(hotel,'2026-10-15'),/15:00 · fortsætter til søndag/)
 assert.match(eventDayLabel(hotel,'2026-10-18'),/Slutter 11:00/)
})
test('Reject earlier end date/time, allow no times and midnight ending next day',()=>{
 assert.ok(validateEventInterval({date:hotel.date,endDate:'2026-10-14'}))
 assert.ok(validateEventInterval({date:hotel.date,endDate:hotel.date,time:'15:00',endTime:'14:00',allDay:false}))
 assert.equal(validateEventInterval({date:hotel.date,endDate:hotel.date,allDay:true}),'')
 assert.equal(eventInterval({...hotel,end_date:'2026-10-16',end_time:'00:00'}).lastDate,hotel.date)
})
test('Clip week/month/year boundaries, keep continuation independent of color',()=>{
 const holiday={...hotel,date:'2026-10-16',end_date:'2026-10-20',all_day:true}
 assert.deepEqual(weekDates(hotel.date).filter(date=>eventOverlapsDate(holiday,date)),['2026-10-16','2026-10-17','2026-10-18'])
 assert.deepEqual(weekDates('2026-10-19').filter(date=>eventOverlapsDate(holiday,date)),['2026-10-19','2026-10-20'])
 for(const [date,end,inside] of [['2026-10-30','2026-11-03','2026-11-01'],['2026-12-30','2027-01-03','2027-01-01']])assert.ok(eventOverlapsDate({...hotel,date,end_date:end},inside))
 assert.match(eventDisplayRange({...hotel,date:'2026-12-30',end_date:'2027-01-03'}),/2026.*2027/)
})
test('Daily status and compact labels distinguish start, middle, end and single',()=>{
 assert.deepEqual(['2026-10-15','2026-10-16','2026-10-17','2026-10-18'].map(day=>eventDayState(hotel,day)),['START','MIDDLE','MIDDLE','END'])
 assert.equal(eventDayState({...hotel,end_date:hotel.date},hotel.date),'SINGLE')
 assert.equal(eventDayLabel(hotel,'2026-10-16',{compact:true}),'2/4 · til søn.')
 assert.equal(eventDayLabel({...hotel,all_day:true},hotel.date),'Starter i dag · til søndag')
 assert.equal(eventDayLabel({...hotel,all_day:true},'2026-10-18'),'Slutter i dag')
 assert.match(eventDateRange(hotel),/15.*18.*okt/)
 const party={date:'2026-10-17',time:'22:00',duration_min:360}
 assert.equal(eventDayLabel(party,'2026-10-17'),'22:00 · fortsætter til søndag')
 assert.equal(eventDayLabel(party,'2026-10-18'),'Slutter 04:00')
})
test('Legacy Sat22:00 +360 minutes crosses midnight without rewriting stored row',()=>{
 const legacy={id:'old',date:'2026-10-17',time:'22:00',duration_min:360,type:'Aktivitet'}
 assert.equal(eventInterval(legacy).endDate,'2026-10-18');assert.equal(eventInterval(legacy).endTime,'04:00')
 assert.equal(materialize([legacy],['2026-10-18'],{milestones:false}).length,1)
 assert.equal(legacy.end_date,undefined)
 assert.equal(eventInterval({...legacy,time:'22.00'}).endTime,'04:00')
})
test('Copenhagen legacy duration respects spring and autumn DST, civil all-day count does not drift',()=>{
 assert.equal(eventInterval({date:'2026-03-28',time:'22:00',duration_min:360}).endTime,'05:00')
 assert.equal(eventInterval({date:'2026-10-24',time:'22:00',duration_min:360}).endTime,'03:00')
 assert.equal(eventDayLabel({...hotel,date:'2026-10-24',end_date:'2026-10-27',all_day:true},'2026-10-25'),'Fortsætter · til tirsdag')
})
test('Weekly multi-day recurrence includes starts before window and shifts end with occurrence',()=>{
 const base={...hotel,id:'base',data:{repeatWeekly:true,exceptions:[]}}
 const occurrence=materialize([base],['2026-10-23'],{milestones:false})[0]
 assert.equal(occurrence.date,'2026-10-22');assert.equal(eventInterval(occurrence).endDate,'2026-10-25')
 const whole=planEdit([base],occurrence,{...itemValues(occurrence),endDate:'2026-10-26'},'series')
 assert.equal(whole.upserts[0].values.endDate,'2026-10-19')
 const one=planDelete([base],occurrence,'one');assert.deepEqual(one.upserts[0].values.exceptions,['2026-10-22'])
 assert.equal(materialize([{...base,data:{...base.data,exceptions:['2026-10-22']}}],['2026-10-23'],{milestones:false}).length,0)
})
test('Stable people IDs and Alle filter across every day, hidden occurrence/restore affect all dates',()=>{
 const people=[{id:'a',name:'Anna'},{id:'b',name:'Bo'}],shared={...hotel,person_ids:['a','b']}
 for(const date of ['2026-10-15','2026-10-17','2026-10-18']){
  assert.ok(itemMatchesPerson(materialize([shared],[date],{milestones:false})[0],'b',people))
  assert.ok(itemMatchesPerson({...hotel,person:'Alle'},'a',people))
  assert.equal(materialize(visibleImports([{...hotel,data:{importHidden:true}}]),[date],{milestones:false}).length,0)
  assert.equal(materialize(visibleImports([{...hotel,data:{importHidden:false}}]),[date],{milestones:false}).length,1)
 }
})
test('Today includes ongoing interval while label does not repeat previous start time',()=>{
 const ongoing=materialize([hotel],['2026-10-16'],{milestones:false})
 assert.equal(ongoing.length,1);assert.equal(eventDayLabel(ongoing[0],'2026-10-16'),'Fortsætter · til søndag')
})
test('Tasks, meals, birthdays and automatic milestones stay single-day',()=>{
 for(const type of ['Opgave','Madplan','Indkøb','Fødselsdag']){
  assert.equal(eventInterval({...hotel,type}).multiDay,false)
  assert.equal(materialize([{...hotel,type}],['2026-10-16'],{milestones:false}).length,0)
 }
 assert.ok(materialize([],['2026-12-24']).some(i=>i.isVirtualMilestone))
})
test('Offline optimistic overlay carries authoritative interval through replay payload',()=>{
 const values={...itemValues(hotel),endDate:'2026-10-20',endTime:'12:00',people:['Alle']}
 const payload={id:hotel.id,...calendarPayload(values,[])}
 const result=overlaySnapshot({snapshot:{items:[hotel]},queue:[{id:'queued',household_id:'family',user_id:'user',payload:{p_upserts:[payload],p_delete_ids:[],p_expected:[]}}]})
 assert.equal(payload.end_date,'2026-10-20');assert.equal(payload.data.endDate,'2026-10-20')
 assert.equal(result.items.length,1);assert.equal(eventInterval(result.items[0]).endDate,'2026-10-20')
 assert.equal(materialize(result.items,['2026-10-19'],{milestones:false}).length,1)
})
