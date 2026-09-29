import test from 'node:test'
import assert from 'node:assert/strict'
import {planValues,calendarOnly,mealsOn,shoppingItems,ingredientDrafts,shoppingCategory} from '../src/lib/household-plans.js'
import {calendarPayload} from '../src/lib/calendar.js'
import {planCreate,planEdit} from '../src/lib/calendar-semantics.js'
import {weeklyProgress} from '../src/lib/task-rewards.js'
import {upcomingItems} from '../src/lib/product-model.js'
import {renderMeals,renderShopping} from '../src/lib/product-ui.js'
const date='2026-09-29',id='00000000-0000-4000-8000-000000000001'
test('meal and shopping use existing persisted fields and preserve exported information',()=>{
 const meal=planValues('meal',{title:' Pasta ',date,time:'18:30',note:'Tomater\nPasta'})
 const payload=calendarPayload(meal,[])
 assert.equal(payload.type,'Madplan');assert.equal(payload.note,'Tomater\nPasta');assert.equal(payload.time,'18:30')
 const shopping=planValues('shopping',{title:'Mælk',note:'2 liter',location:'Mejeri & æg'},null,date)
 assert.equal(shopping.date,date);assert.equal(shopping.type,'Indkøb');assert.equal(shopping.repeatWeekly,false);assert.deepEqual(shopping.personIds,[])
})
test('invalid dates, long input, unknown types and invalid times are rejected',()=>{
 for(const input of [{title:'',date},{title:'a'.repeat(161),date},{title:'Mad',date:'2026-02-30'},{title:'Mad',date,time:'24:01'},{title:'Mad',date,note:'x'.repeat(4001)}])assert.throws(()=>planValues('meal',input))
 assert.throws(()=>planValues('unknown',{title:'x',date}))
 assert.throws(()=>planValues('meal',{title:'x',date},{type:'Aktivitet'}))
})
test('shopping persists beyond its creation day and retains bought state when edited',()=>{
 const row={id,type:'Indkøb',title:'Mælk',date:'2020-01-01',done:true,note:'1 liter',data:{},updated_at:'version'}
 assert.equal(shoppingItems([row]).length,1)
 const values=planValues('shopping',{title:'Mælk',note:'2 liter'},row,date)
 assert.equal(values.date,'2020-01-01');assert.equal(values.done,true)
 assert.deepEqual(planEdit([row],row,values).expected,[{id,updated_at:'version'}])
})
test('meal days and normal calendar/upcoming views are isolated from the shopping list',()=>{
 const rows=[{id,type:'Madplan',title:'Mad',date,time:'18:00'},{id:'2',type:'Indkøb',title:'Mælk',date,time:'15:00'},{id:'3',type:'Aktivitet',title:'Sport',date,time:'19:00'}]
 assert.equal(mealsOn(rows,date).length,1);assert.deepEqual(calendarOnly(rows).map(r=>r.id),['3'])
 assert.deepEqual(upcomingItems(rows,[],'Alle',new Date(date+'T12:00:00')).map(r=>r.id),['3'])
})
test('buying groceries never increases child task rewards',()=>{
 const rows=[{id,type:'Indkøb',title:'Mælk',date,done:true,person:'Alle',data:{}},{id:'2',type:'Madplan',title:'Mad',date,done:true,person:'Alle',data:{}}]
 assert.equal(weeklyProgress(rows,[{id:'child',name:'Ida',role:'child'}],date,date)[0].count,0)
})
test('ingredient transfer deduplicates whitespace, case and bullets, but allows buying an item again',()=>{
 const rows=[{type:'Indkøb',title:'  MÆLK ',done:false},{type:'Indkøb',title:'Pasta',done:true}]
 const drafts=ingredientDrafts('- mælk\n• Pasta\nPasta\n  Tomater  \n',rows)
 assert.deepEqual(drafts.map(r=>r.title),['Pasta','Tomater']);assert.equal(drafts[1].location,'Frugt & grønt')
 assert.throws(()=>ingredientDrafts('a'.repeat(161),[]))
})
test('new entries use distinct IDs so same-day meals do not overwrite each other',()=>{
 let n=0;const next=()=>String(++n)
 assert.notEqual(planCreate(planValues('meal',{title:'Mad',date}),next).upserts[0].id,planCreate(planValues('meal',{title:'Mad',date}),next).upserts[0].id)
 assert.equal(shoppingCategory('2 liter mælk'),'Mejeri & æg')
})
test('meal and shopping rendering escapes user text and unknown categories remain visible',()=>{
 const attack='<img src=x onerror=alert(1)>'
 const meals=renderMeals([{id,type:'Madplan',title:attack,date,note:attack}],new Date(date+'T12:00:00'))
 const shop=renderShopping([{id,type:'Indkøb',title:attack,date,location:'unknown',note:attack}],{title:'" autofocus onfocus=alert(1)'})
 assert.ok(!meals.includes('<img'));assert.ok(!shop.includes('<img'));assert.ok(shop.includes('&lt;img'));assert.ok(shop.includes('Andet'));assert.ok(shop.includes('&quot; autofocus'))
})
