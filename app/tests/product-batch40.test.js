import {RewardTransitions} from '../src/lib/reward-transitions.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {allowanceTasks,currentAgreement,allowancePreview} from '../src/lib/allowance-model.js'
import {actionPayload,emptyRewards,monthProgress,optimisticReward} from '../src/lib/rewards-model.js'
import {RecipeService} from '../src/lib/recipe-service.js'
import {recipeDraft} from '../src/lib/recipe-model.js'
const occurrence={id:'o',task_id:'task',origin_id:'origin',person_id:'child',allowance_contract_id:'period',due_date:'2026-10-05',occurrence_date:'2026-10-05',window_end:'2026-10-11',title:'Ryd værelset',status:'open',reward_mode:'allowance',requires_approval:true}
test('Weekly obligation is visible on Wednesday once; actions retain Monday identity',()=>{
 const s={occurrences:[occurrence]},rows=allowanceTasks([],s,['2026-10-07'])
 assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-10-07')
 assert.deepEqual(actionPayload(rows[0],'child'),{person_id:'child',item_id:'task',occurrence_date:'2026-10-05',due_date:'2026-10-05'})
 assert.equal(allowanceTasks([],s,['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11']).length,1)
 assert.equal(allowanceTasks([],s,['2026-10-12']).length,0)
})
test('Legacy template projection never duplicates the same frozen occurrence',()=>{
 const rows=allowanceTasks([{id:'task',date:'2026-10-05',title:'Changed old title',type:'Opgave'}],{occurrences:[occurrence]},['2026-10-05'])
 assert.equal(rows.length,1);assert.equal(rows[0].title,'Ryd værelset')
})
test('Offline checkbox overlays preserve server money, immutable period and person identity',()=>{
 const s={...emptyRewards(),occurrences:[occurrence],monthly:[{person_id:'child',period_start:'2026-10-05',period_end:'2026-10-11',eligible_total:8,completed_total:1,earned_minor:1250}]}
 const next=optimisticReward(s,{payload:{reward_action:{action:'complete',payload:actionPayload(allowanceTasks([],s,['2026-10-07'])[0],'child'),optimistic:{origin_id:'origin',requires_approval:true}}}})
 assert.equal(next.occurrences[0].status,'pending');assert.equal(next.occurrences[0].allowance_contract_id,'period')
 assert.equal(monthProgress([],[],next,'child','2026-10-07').earned_minor,1250)
})
test('Latest next-period version selected without changing confirmed current amount',()=>{
 const s={agreements:[{person_id:'p',effective_from:'2026-10-01',amount_minor:10000},{person_id:'p',effective_from:'2026-11-01',amount_minor:20000}]}
 assert.equal(currentAgreement(s,'p').amount_minor,20000)
})
test('Structured ingredients survive unchanged raw-text editing; modified wording drops stale quantities',()=>{
 const ingredients=[{raw_text:'2 dåser tomater',ingredient_name:'tomater',quantity:2,unit:'dåser',note:null}]
 const d=recipeDraft({title:'Suppe',ingredients:'2 dåser tomater',ingredient_details:ingredients})
 assert.deepEqual(d.ingredients,ingredients)
 assert.deepEqual(recipeDraft({title:'Suppe',ingredients:'3 dåser tomater',ingredient_details:ingredients}).ingredients,['3 dåser tomater'])
})
for(const outcome of ['success','provider-failure','partial-upload'])test('Scanner cleans only its own uploaded paths on '+outcome,async()=>{
 Object.defineProperty(navigator,'onLine',{value:true,configurable:true});const uploaded=[],removed=[]
 const bucket={upload:async path=>{uploaded.push(path);return {error:outcome==='partial-upload'&&uploaded.length===2?Error('fail'):null}},remove:async paths=>{removed.push(...paths);return {error:null}}}
 const service=new RecipeService({getContext:()=>({key:'u:h',householdId:'h'}),client:{auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})},storage:{from:()=>bucket}}})
 service.import=async body=>{assert.equal(body.paths.length,2);assert.equal(body.images,undefined);if(outcome==='provider-failure')throw Error('Controlled error');return {recipe:{title:'Suppe'}}}
 const run=()=>service.scan([new Blob(['a'],{type:'image/jpeg'}),new Blob(['b'],{type:'image/jpeg'})])
 if(outcome==='success')assert.equal((await run()).recipe.title,'Suppe');else await assert.rejects(run)
 assert.deepEqual(removed,uploaded);assert.ok(removed.every(p=>p.startsWith('h/')&&p.includes('/scan-u-')))
})
test('Offline scan never uploads or enters the existing task queue',async()=>{
 Object.defineProperty(navigator,'onLine',{value:false,configurable:true})
 const service=new RecipeService({client:{},getContext:()=>({})})
 await assert.rejects(()=>service.scan([]),/kræver internetforbindelse/)
 Object.defineProperty(navigator,'onLine',{value:true,configurable:true})
})

test('Materializing future obligations emits no misleading reopened animation',()=>{const t=new RewardTransitions();t.hydrate(emptyRewards());assert.deepEqual(t.observe({...emptyRewards(),occurrences:[{...occurrence,revision:0}]}),[])})

test('Next-period preview counts civil daily, weekday and weekly expectations without creating data',()=>{assert.deepEqual(allowancePreview([{schedule:'daily'}],'2028-02-01','month'),{expected:29,period_end:'2028-02-29'});assert.equal(allowancePreview([{schedule:'daily'}],'2026-03-01','month').expected,31);assert.deepEqual(allowancePreview([{schedule:'weekly'},{schedule:'weekdays'},{schedule:'selected',weekdays:[2,5]}],'2026-10-26','week'),{expected:8,period_end:'2026-11-01'});assert.equal(allowancePreview([{schedule:'weekly'}],'2026-10-07','week').expected,1)})
