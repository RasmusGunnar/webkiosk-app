
import test from 'node:test'
import assert from 'node:assert/strict'
import { calendarHeading, isoWeek, weekDates, addDays, preferredView } from '../src/lib/calendar-dates.js'
import { materialize, itemValues, planCreate, planEdit, planDelete, sourceLabel, repeatContext, displayTitle } from '../src/lib/calendar-semantics.js'
import { easterDate, milestonesForDates } from '../src/lib/milestones.js'
import { itemMatchesPerson, itemPeople } from '../src/lib/people.js'
import { calendarPayload } from '../src/lib/calendar.js'
import { calendarRealtime } from '../src/lib/calendar-realtime.js'
let count=0
const uuid=()=> 'id-'+(++count)
const base=(patch={})=>({id:'base',title:'Lektier',date:'2026-09-28',type:'Opgave',done:false,person:'Alle',person_ids:[],updated_at:'2026-09-01T00:00:00Z',data:{people:['Alle'],repeatWeekly:true,seriesId:'base',exceptions:[],custom:{keep:true}},...patch})
const shown=(rows,dates)=>materialize(rows,dates,{milestones:false})
const at=(rows,date)=>shown(rows,[date])[0]
const form=(item,patch={})=>({...itemValues(item),...patch})
function apply(rows,plan) {
  const result=rows.filter(row=>!plan.deleteIds.includes(row.id))
  for(const {id,values} of plan.upserts) {
    const i=result.findIndex(row=>row.id===id), row={...(result[i]||{}),id,...calendarPayload(values,[]),updated_at:'v'+(++count)}
    if(i>=0)result[i]=row;else result.push(row)
  }
  return result
}
test('day/week navigation and ISO headers cross year and DST',()=>{
  assert.deepEqual(isoWeek('2021-01-01'),{year:2020,week:53})
  assert.deepEqual(weekDates('2026-10-25'),['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25'])
  assert.equal(addDays('2026-03-29',1),'2026-03-30')
  assert.match(calendarHeading('2026-09-28','week','2026-09-29'),/^Denne uge · uge 40/)
  assert.equal(calendarHeading('2026-10-05','week','2026-09-28'),'Uge 41 · 5.–11. oktober')
  assert.match(calendarHeading('2026-12-31','week','2026-09-28'),/2026.*2027/)
  assert.match(calendarHeading('2026-10-05','day'),/mandag.*5.*oktober.*2026/)
})
test('mobile defaults day, desktop week, explicit preference wins and storage can fail',()=>{
  const empty={getItem:()=>null}
  assert.equal(preferredView(empty,390),'day');assert.equal(preferredView(empty,1800),'week')
  assert.equal(preferredView({getItem:()=>'week'},390),'week')
  assert.equal(preferredView({getItem:()=>'day'},1800),'day')
  assert.equal(preferredView({getItem(){throw Error()}},390),'day')
})
test('shared Alle and stable multi-person IDs remain visible after rename',()=>{
  const people=[{id:'ida',name:'New Ida'},{id:'carl',name:'Carl'}]
  assert.equal(itemMatchesPerson({person:'Carl',data:{people:['Alle']}},'ida',people),true)
  const item={person:'Old Ida',person_ids:['ida','carl'],data:{people:['Old Ida','Carl']}}
  assert.deepEqual(itemPeople(item,people),['New Ida','Carl'])
  assert.equal(itemMatchesPerson(item,'carl',people),true)
  assert.equal(itemMatchesPerson(item,'other',people),false)
})
test('yearly birthdays are virtual and use occurrence year without mutating rows',()=>{
  const item=base({type:'Fødselsdag',date:'2020-06-05',data:{birthYear:'2010',repeatYearly:true}})
  const original=structuredClone(item), rows=shown([item],['2025-06-05','2026-06-05'])
  assert.equal(rows.length,2);assert.deepEqual(item,original)
  assert.deepEqual(rows.map(row=>Number(row.date.slice(0,4))-Number(row.data.birthYear)),[15,16])
  assert.equal(shown([item],['2009-06-05']).length,0)
  assert.equal(displayTitle(rows[1]),'Lektier bliver 16 år')
})
test('Feb 29 becomes Feb 28 in nonleap years and remains Feb 29 in leap years',()=>{
  const item=base({type:'Fødselsdag',date:'2020-02-29',data:{birthYear:2020}})
  assert.deepEqual(shown([item],['2023-02-28','2023-03-01','2024-02-28','2024-02-29']).map(row=>row.date),['2023-02-28','2024-02-29'])
})
test('birthday edits/deletes target only base and retain leap-day source date',()=>{
  const row=base({type:'Fødselsdag',date:'2020-02-29',data:{birthYear:2020}}), occurrence=at([row],'2026-02-28')
  const plan=planEdit([row],occurrence,form(row,{title:'Birthday'}))
  assert.equal(plan.upserts[0].id,'base');assert.equal(plan.upserts[0].values.date,'2020-02-29')
  assert.deepEqual(planDelete([row],occurrence).deleteIds,['base'])
})
test('weekly dates respect start, weekday, exceptions and repeatUntil inclusively',()=>{
  const row=base({data:{repeatWeekly:true,exceptions:['2026-10-05'],repeatUntil:'2026-10-12'}})
  assert.deepEqual(shown([row],['2026-09-21','2026-09-28','2026-09-29','2026-10-05','2026-10-12','2026-10-19']).map(row=>row.date),['2026-09-28','2026-10-12'])
})
for(const date of ['2026-09-28','2026-10-05']) test('only-this edit preserves base including occurrence '+date,()=>{
  const row=base(), item=at([row],date), next=apply([row],planEdit([row],item,form(item,{title:'This only'}),'one',uuid))
  assert.equal(next.find(row=>row.id==='base').title,'Lektier')
  assert.equal(next.find(row=>row.id==='base').data.repeatWeekly,true)
  assert.equal(at(next,date).title,'This only')
  assert.equal(at(next,'2026-10-12').title,'Lektier')
  assert.equal(next.length,2)
})
test('moving then editing an existing override retains its identity and original exception date',()=>{
  let rows=[base()]
  rows=apply(rows,planEdit(rows,at(rows,'2026-09-28'),form(at(rows,'2026-09-28'),{date:'2026-09-29'}),'one',uuid))
  const item=at(rows,'2026-09-29'), id=item.id
  rows=apply(rows,planEdit(rows,item,form(item,{title:'Moved again',date:'2026-09-30'}),'one',uuid))
  assert.equal(at(rows,'2026-09-30').id,id);assert.equal(at(rows,'2026-09-28'),undefined)
  assert.equal(at(rows,'2026-09-29'),undefined);assert.equal(rows.length,2)
  assert.deepEqual(rows.find(row=>row.id==='base').data.exceptions,['2026-09-28'])
})
test('only-this delete first, later and moved override leaves remaining series',()=>{
  for(const date of ['2026-09-28','2026-10-05']) {
    const rows=[base()], next=apply(rows,planDelete(rows,at(rows,date),'one'))
    assert.equal(at(next,date),undefined);assert.equal(at(next,'2026-10-12').title,'Lektier')
  }
  let rows=[base()]
  rows=apply(rows,planEdit(rows,at(rows,'2026-09-28'),form(at(rows,'2026-09-28'),{date:'2026-09-29'}),'one',uuid))
  rows=apply(rows,planDelete(rows,at(rows,'2026-09-29'),'one'))
  assert.equal(rows.length,1);assert.equal(at(rows,'2026-09-28'),undefined)
})
test('future split preserves end date, future exceptions, custom metadata and future overrides',()=>{
  let rows=[base({data:{repeatWeekly:true,exceptions:['2026-10-19'],repeatUntil:'2026-11-30',custom:{keep:true}}})]
  rows=apply(rows,planEdit(rows,at(rows,'2026-10-12'),form(at(rows,'2026-10-12'),{date:'2026-10-13',done:true}),'one',uuid))
  const overrideId=at(rows,'2026-10-13').id
  rows=apply(rows,planEdit(rows,at(rows,'2026-10-05'),form(at(rows,'2026-10-05'),{title:'Future'}),'future',uuid))
  assert.equal(rows.find(row=>row.id==='base').data.repeatUntil,'2026-10-04')
  const next=rows.find(row=>row.id!=='base'&&row.data.repeatWeekly)
  assert.equal(next.date,'2026-10-05');assert.equal(next.data.repeatUntil,'2026-11-30')
  assert.deepEqual(next.data.custom,{keep:true});assert.ok(next.data.exceptions.includes('2026-10-19'))
  assert.equal(at(rows,'2026-09-28').title,'Lektier');assert.equal(at(rows,'2026-10-05').title,'Future')
  assert.equal(at(rows,'2026-10-19'),undefined)
  assert.equal(at(rows,'2026-10-12'),undefined);assert.equal(at(rows,'2026-10-13').id,overrideId)
  assert.equal(at(rows,'2026-10-13').done,true);assert.equal(at(rows,'2026-10-26').done,false)
})
test('whole-series edit from later occurrence preserves original start and historical completions',()=>{
  let rows=[base()]
  rows=apply(rows,planEdit(rows,at(rows,'2026-09-28'),form(at(rows,'2026-09-28'),{done:true}),'one',uuid))
  rows=apply(rows,planEdit(rows,at(rows,'2026-10-12'),form(at(rows,'2026-10-12'),{title:'All'}),'series',uuid))
  assert.equal(rows.find(row=>row.id==='base').date,'2026-09-28')
  assert.equal(at(rows,'2026-09-28').done,true);assert.equal(at(rows,'2026-10-05').title,'All')
  rows=apply(rows,planEdit(rows,at(rows,'2026-10-12'),form(at(rows,'2026-10-12'),{repeatWeekly:false}),'series',uuid))
  assert.equal(at(rows,'2026-09-28').done,true)
})
test('done checkbox with whole-series scope changes title globally but completes only selected occurrence',()=>{
  let rows=[base()], item=at(rows,'2026-10-05')
  rows=apply(rows,planEdit(rows,item,form(item,{title:'Renamed',done:true}),'series',uuid))
  assert.equal(at(rows,'2026-09-28').title,'Renamed');assert.equal(at(rows,'2026-09-28').done,false)
  assert.equal(at(rows,'2026-10-05').done,true);assert.equal(at(rows,'2026-10-12').done,false)
})
test('future delete removes moved future overrides by original date; whole delete removes all',()=>{
  let rows=[base()]
  rows=apply(rows,planEdit(rows,at(rows,'2026-10-12'),form(at(rows,'2026-10-12'),{date:'2026-09-30'}),'one',uuid))
  rows=apply(rows,planDelete(rows,at(rows,'2026-10-05'),'future'))
  assert.equal(at(rows,'2026-09-30'),undefined);assert.equal(at(rows,'2026-10-05'),undefined)
  assert.equal(at(rows,'2026-09-28').title,'Lektier')
  rows=apply(rows,planDelete(rows,at(rows,'2026-09-28'),'series'));assert.equal(rows.length,0)
})
test('repeated task done is occurrence-specific, first included; legacy done never leaks forward',()=>{
  for(const date of ['2026-09-28','2026-10-05']) {
    let rows=[base()]
    rows=apply(rows,planEdit(rows,at(rows,date),form(at(rows,date),{done:true}),'one',uuid))
    assert.equal(at(rows,date).done,true);assert.equal(at(rows,'2026-10-12').done,false)
    rows=apply(rows,planEdit(rows,at(rows,date),form(at(rows,date),{done:false}),'one',uuid))
    assert.equal(at(rows,date).done,false);assert.equal(rows.length,2)
  }
  assert.equal(at([base({done:true})],'2026-09-28').done,true)
  assert.equal(at([base({done:true})],'2026-10-05').done,false)
})
test('one-off task completion updates same row',()=>{
  const rows=[base({data:{}})], next=apply(rows,planEdit(rows,rows[0],form(rows[0],{done:true})))
  assert.equal(next.length,1);assert.equal(next[0].id,'base');assert.equal(next[0].done,true)
})
for(const repeatWeekly of [false,true]) test('Mon-Fri batch keeps repeatWeekly='+repeatWeekly,()=>{
  const plan=planCreate(form(base(),{date:'2026-09-30',weekdays:true,repeatWeekly}),uuid), rows=apply([],plan)
  assert.deepEqual(rows.map(row=>row.date),weekDates('2026-09-30').slice(0,5))
  assert.equal(rows.every(row=>row.data.repeatWeekly===repeatWeekly),true)
  assert.equal(shown(rows,weekDates('2026-10-05')).length,repeatWeekly?5:0)
  assert.equal(new Set(rows.map(row=>row.id)).size,5)
})
test('Gregorian Easter and legacy milestones across year boundary, Mother day and traditions',()=>{
  assert.equal(easterDate(2024),'2024-03-31');assert.equal(easterDate(2025),'2025-04-20');assert.equal(easterDate(2026),'2026-04-05')
  const days=milestonesForDates(['2026-12-24','2026-12-25','2026-12-26','2026-12-31','2027-01-01','2026-05-10','2026-05-01'])
  for(const title of ['Juleaften','1. juledag','2. juledag','Nytårsaften','Nytårsdag','Mors dag','Store bededag (traditionel)']) assert.ok(days.some(row=>row.title===title))
})
test('milestones deduplicate user/import aliases by date and keep unrelated events',()=>{
  const dates=['2026-12-25','2026-05-14']
  const result=milestonesForDates(dates,[{title:'Juledag',date:dates[0]},{title:'Kr. Himmelfartsdag',date:dates[1]}])
  assert.deepEqual(result,[])
  assert.equal(milestonesForDates(['2026-06-05'],[{title:'Other',date:'2026-06-05'}]).length,1)
})
test('Aula/Google/ICS events stay concrete, show source, disallow local mutation despite RRULE metadata',()=>{
  for(const source of ['aula','google','ics']) {
    const row=base({source,external_id:'external-fixture',data:{repeatWeekly:true,repeatYearly:true}})
    assert.equal(shown([row],['2026-09-28','2026-10-05']).length,1)
    assert.equal(repeatContext(row),false);assert.ok(sourceLabel(row))
    assert.throws(()=>planEdit([row],row,form(row)),/kilde/)
    assert.throws(()=>planDelete([row],row),/kilde/)
  }
})
test('optimistic expected versions cover series base and all existing overrides',()=>{
  let rows=[base()]
  rows=apply(rows,planEdit(rows,at(rows,'2026-09-28'),form(at(rows,'2026-09-28'),{done:true}),'one',uuid))
  const plan=planEdit(rows,at(rows,'2026-10-05'),form(at(rows,'2026-10-05'),{title:'changed'}),'series',uuid)
  assert.equal(plan.expected.length,2)
  assert.deepEqual(plan.expected.map(row=>row.id).sort(),rows.map(row=>row.id).sort())
})
test('realtime is household scoped, deduplicated, reconnected and unsubscribed; old callbacks cannot refresh',async()=>{
  const channels=[], removed=[];let refreshes=0
  const client={channel(name){const ch={name,on(event,filter,cb){if(event==='system')this.system=cb;else{this.filter=filter;this.cb=cb}return this},subscribe(cb){this.status=cb;return this}};channels.push(ch);return ch},removeChannel(ch){removed.push(ch)}}
  const realtime=calendarRealtime(client,async()=>{refreshes++})
  realtime.start('a');realtime.start('a');assert.equal(channels.length,1)
  assert.equal(channels[0].filter.filter,'household_id=eq.a')
  channels[0].status('SUBSCRIBED');channels[0].cb();channels[0].cb()
  await new Promise(resolve=>setTimeout(resolve,180));assert.equal(refreshes,1)
  realtime.start('b');channels[0].cb();channels[0].status('SUBSCRIBED')
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(refreshes,1)
  channels[1].status('SUBSCRIBED');await new Promise(resolve=>setTimeout(resolve,150));assert.equal(refreshes,2)
  realtime.stop();channels[1].cb();await new Promise(resolve=>setTimeout(resolve,150))
  assert.equal(refreshes,2);assert.equal(removed.length,2)
})

test('switching households during an in-flight refresh cannot stall the new subscription',async()=>{
  const channels=[],release=[];let calls=0
  const client={channel(){const c={on(e,f,cb){if(e==='system')this.system=cb;else this.cb=cb;return this},subscribe(status){this.status=status;return this}};channels.push(c);return c},removeChannel(){}}
  const rt=calendarRealtime(client,()=>{calls++;return new Promise(resolve=>release.push(resolve))})
  rt.start('a');channels[0].status('SUBSCRIBED')
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(calls,1)
  rt.start('b');channels[1].status('SUBSCRIBED')
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(calls,2)
  release.forEach(resolve=>resolve());rt.stop()
})

test('Postgres stream-ready notification refreshes changes missed during channel startup',async()=>{
  let system,subscribe,refreshes=0
  const channel={on(type,filter,callback){if(type==='system')system=callback;return this},subscribe(callback){subscribe=callback;return this}}
  const rt=calendarRealtime({channel:()=>channel,removeChannel(){}},async()=>refreshes++)
  rt.start('family');subscribe('SUBSCRIBED')
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(refreshes,1)
  system({extension:'postgres_changes',status:'ok'})
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(refreshes,2)
  rt.stop();system({extension:'postgres_changes',status:'ok'})
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(refreshes,2)
})

test('future editing a moved existing override updates that row and keeps subsequent customisations',()=>{
  let rows=[base()]
  rows=apply(rows,planEdit(rows,at(rows,'2026-10-05'),form(at(rows,'2026-10-05'),{date:'2026-10-06',done:true}),'one',uuid))
  const selected=at(rows,'2026-10-06'),id=selected.id
  rows=apply(rows,planEdit(rows,selected,form(selected,{title:'Changed from here',repeatWeekly:true}),'future',uuid))
  assert.equal(at(rows,'2026-10-06').id,id)
  assert.equal(at(rows,'2026-10-06').title,'Changed from here')
  assert.equal(at(rows,'2026-10-06').done,true)
  assert.equal(at(rows,'2026-10-05'),undefined)
  assert.equal(at(rows,'2026-10-12').title,'Changed from here')
  assert.equal(at(rows,'2026-10-12').done,false)
})
