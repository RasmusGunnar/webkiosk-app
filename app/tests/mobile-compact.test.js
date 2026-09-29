import test from 'node:test'
import assert from 'node:assert/strict'
import {monthDates} from '../src/lib/calendar-dates.js'
import {materialize} from '../src/lib/calendar-semantics.js'
test('month interval includes every civil day across leap years and DST',()=>{
 assert.equal(monthDates('2024-02-20').length,29);assert.equal(monthDates('2026-02-20').length,28)
 for(const value of ['2026-03-29','2026-10-25','2026-12-31']){const dates=monthDates(value);assert.equal(dates.length,31);assert.equal(new Set(dates).size,31);assert.equal(dates[0],value.slice(0,8)+'01');assert.equal(dates.at(-1),value.slice(0,8)+'31')}
 assert.throws(()=>monthDates('2026-02-30'))
})
test('month task materialization retains occurrence exceptions and excludes adjacent months',()=>{
 const rows=[{id:'series',type:'Opgave',title:'Weekly',date:'2026-09-01',repeatWeekly:true,done:false,data:{exceptions:['2026-09-15']}},{id:'next',type:'Opgave',title:'Next month',date:'2026-10-01',data:{}}]
 const items=materialize(rows,monthDates('2026-09-29'),{milestones:false})
 assert.deepEqual(items.map(x=>x.date),['2026-09-01','2026-09-08','2026-09-22','2026-09-29']);assert.ok(items.every(x=>x.title==='Weekly'))
})
