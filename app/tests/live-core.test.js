import test from 'node:test'
import assert from 'node:assert/strict'
import {annualEventValues,birthdayPerson} from '../src/lib/annual-events.js'
import {materialize,planEdit,planCreate} from '../src/lib/calendar-semantics.js'
import {calendarPayload} from '../src/lib/calendar.js'
import {eventInterval} from '../src/lib/calendar-interval.js'
import {allowanceTasks} from '../src/lib/allowance-model.js'
import {actionPayload,taskComplete} from '../src/lib/rewards-model.js'
import {compactTask} from '../src/lib/calendar-layout.js'
const people=[{id:'child',name:'Julie',is_active:true}],date='2026-10-28'
test('Birthday derives title/person and enforces all-day yearly without optional birth year',()=>{
 const values=annualEventValues({type:'Fødselsdag',birthdayPerson:'Julie',date,note:'Husk flag',time:'18:30',repeatWeekly:true},null,people)
 const payload=calendarPayload(values,people)
 assert.equal(payload.title,'Julie');assert.equal(payload.all_day,true);assert.equal(payload.time,'');assert.equal(payload.data.repeatYearly,true);assert.equal(payload.data.repeatWeekly,false)
 assert.deepEqual(payload.person_ids,['child']);assert.equal(payload.note,'Husk flag');assert.equal(planCreate(values).upserts.length,1)
 assert.throws(()=>annualEventValues({type:'Fødselsdag',date,birthdayPerson:''},null,people))
})
test('Existing birthday edit preserves identity, title, metadata, note and leap-day base',()=>{
 const row={id:'birthday',type:'Fødselsdag',title:'Julies fødselsdag',date:'2024-02-29',person_ids:['child'],note:'Gammel note',location:'Hos mor',updated_at:'version',data:{birthYear:'2024',custom:'keep',repeatYearly:true}}
 const occurrence=materialize([row],['2027-02-28'],{milestones:false})[0]
 assert.equal(birthdayPerson(occurrence,people),'Julie')
 const values=annualEventValues({...occurrence,date:row.date,birthdayPerson:'Julie',birthYear:'2024',note:'Ny note'},occurrence,people)
 const plan=planEdit([row],occurrence,values)
 assert.equal(plan.upserts.length,1);assert.equal(plan.upserts[0].id,row.id);assert.equal(plan.upserts[0].values.date,row.date)
 assert.equal(plan.upserts[0].values.title,row.title);assert.equal(plan.upserts[0].values.location,row.location);assert.equal(plan.upserts[0].values.custom,'keep')
 assert.equal(plan.upserts[0].values.note,'Ny note');assert.deepEqual(plan.expected,[{id:row.id,updated_at:'version'}]);assert.deepEqual(plan.deleteIds,[])
})
test('External birthday name remains unlinked; anniversary repeats yearly and is single-day',()=>{
 const external=annualEventValues({type:'Fødselsdag',birthdayPerson:'Farmor',date},null,people)
 assert.deepEqual(external.personIds,[]);assert.deepEqual(external.people,['Farmor'])
 const values=annualEventValues({type:'Mærkedag',title:'Bryllupsdag',date,note:'Blomster',endDate:'2026-11-05',time:'18:00'},null,people)
 const row={id:'anniversary',...values,data:{repeatYearly:true}}
 const list=materialize([row],['2027-10-28','2027-10-29'],{milestones:false})
 assert.equal(list.length,1);assert.equal(list[0].baseId,row.id);assert.equal(list[0].title,'Bryllupsdag');assert.equal(eventInterval(list[0]).allDay,true);assert.equal(eventInterval(list[0]).multiDay,false)
 assert.equal(planEdit([row],list[0],{...values,note:'Ny note'}).upserts[0].id,row.id)
})
test('Calendar derives only dated frozen duties and preserves completed/excused status without changing economics',()=>{
 const dates=['2026-10-28','2026-10-29','2026-10-30','2026-10-31']
 const make=(id,schedule,day,status='open',end=day)=>({id,task_id:id,origin_id:'origin-'+id,person_id:'child',allowance_contract_id:'contract',occurrence_date:day,due_date:day,window_end:end,title:id,status,obligation_rule:{schedule}})
 const state={occurrences:[make('daily','daily',dates[0]),make('weekday','weekdays',dates[1]),make('selected','selected',dates[2],'completed'),make('excused','daily',dates[3],'excused'),make('weekly','weekly',dates[0],'open',dates[3])],agreements:[],monthly:[{earned_minor:2500,eligible_total:20}],contracts:[{id:'contract',amount_minor:10000}]}
 const before=structuredClone(state),rows=allowanceTasks([],state,dates,{calendar:true})
 assert.deepEqual(rows.map(r=>r.id),['daily','weekday','selected','excused']);assert.deepEqual(rows.map(r=>r.date),dates)
 assert.equal(taskComplete(rows[2],people,state),true)
 assert.match(compactTask(rows[3],{reward:{mode:'allowance'}}),/Fritaget/)
 assert.deepEqual(actionPayload(rows[2],'child'),{person_id:'child',item_id:'selected',occurrence_date:dates[2],due_date:dates[2]})
 assert.deepEqual(state,before);assert.equal(allowanceTasks([],state,[date]).some(r=>r.id==='weekly'),true)
 assert.equal(allowanceTasks([],state,[dates[3]],{calendar:true}).some(r=>r.id==='weekday'),false)
})
test('Frozen legacy occurrences replace materialized task copies exactly once',()=>{
 const state={occurrences:[{task_id:'old',origin_id:'old',allowance_contract_id:'contract',person_id:'child',occurrence_date:date,due_date:date,window_end:date,title:'Fast pligt',status:'open'}],agreements:[]}
 const rows=allowanceTasks([{id:'old',type:'Opgave',date,title:'Old title'}],state,[date],{calendar:true})
 assert.equal(rows.length,1);assert.equal(rows[0].title,'Fast pligt')
})
