import test from 'node:test'
import assert from 'node:assert/strict'
import {compactTask,compactMeals,filterRoutes} from '../src/lib/calendar-layout.js'
import {fitDayGroups} from '../src/lib/calendar-capacity.js'
import {ingredientDrafts,planValues} from '../src/lib/household-plans.js'
import {visibleImports} from '../src/lib/imported-editor.js'
import {recipeDetails} from '../src/lib/recipe.js'
test('Week capacity uses physical space, including headings, gaps and overflow control',()=>{
 const group={rows:Array(9).fill(52),gap:5,overhead:18}
 assert.deepEqual(fitDayGroups([group],526,12,32),{counts:[9],hidden:0,height:526})
 assert.equal(fitDayGroups([group],500,12,32).hidden,2)
 const mixed=[group,{rows:[38,38],gap:5,overhead:18},{rows:[34],gap:4,overhead:10}]
 const small=fitDayGroups(mixed,330,12,32)
 assert.ok(small.counts.every(n=>n>0));assert.ok(small.height+44<=330)
 assert.equal(fitDayGroups(mixed,2000,12,32).hidden,0)
 assert.deepEqual(fitDayGroups([],100,12,32).counts,[])
})
test('Week tasks expose compact details, with no inline administration',()=>{const html=compactTask({id:'one',title:'Tøm tasken'},{people:'Ida',reward:{mode:'stars',stars:10}});assert.match(html,/data-task-detail/);assert.match(html,/10 ⭐/);assert.doesNotMatch(html,/Fritag|Udf?r|data-reward-action/);assert.equal(compactMeals([]),'')})
test('Structured recipe stays editable, survives calendar values, feeds shopping dedupe',()=>{const values=planValues('meal',{title:'Pasta',date:'2026-10-05',recipeUrl:'https://example.com/recipe',ingredients:'Pasta\nTomater\nPasta',instructions:'Kog pasta\nTilsæt tomater'});assert.deepEqual(values.recipe.ingredients,['Pasta','Tomater','Pasta']);assert.deepEqual(ingredientDrafts(values.recipe.ingredients,[{title:'Tomater',type:'Indkøb',done:false}]).map(i=>i.title),['Pasta']);const edited=planValues('meal',{title:'Ny ret',date:'2026-10-05'},{id:'a',...values,data:{recipe:values.recipe}});assert.deepEqual(edited.recipe,values.recipe);assert.match(recipeDetails(values.recipe),/<ol>/);assert.throws(()=>planValues('meal',{title:'Ret',date:'2026-10-05',recipeUrl:'javascript:alert(1)'}))})
test('Only functional routes show people; imported tombstones do not remove manual lookalikes',()=>{assert.deepEqual(filterRoutes,['today','calendar','tasks']);assert.deepEqual(visibleImports([{id:'manual',title:'Carl spejder'},{id:'hidden',title:'Carl spejder',data:{importHidden:true}}]).map(i=>i.id),['manual'])})
