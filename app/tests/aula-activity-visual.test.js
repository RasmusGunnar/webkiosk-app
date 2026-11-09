import test from 'node:test'
import assert from 'node:assert/strict'
import {AulaUI} from '../src/lib/aula-ui.js'
import {personStack} from '../src/lib/person-avatars.js'
import {sourceLabel,imported} from '../src/lib/calendar-semantics.js'
import {managedTask,rewardRule} from '../src/lib/rewards-model.js'
import {calendarPayload} from '../src/lib/calendar.js'
import {finding,ida,carl,schoolExamples} from './aula-activity.fixtures.js'
const people=[{id:ida,name:'Ida',color:'#b98486',avatar_url:'https://example.test/ida.png'},{id:carl,name:'Carl',color:'#8e9e65',avatar_url:'https://example.test/carl.png'}]
const ui=Object.create(AulaUI.prototype);ui.getContext=()=>({people})
for(const [type,title]of schoolExamples)test('Review offers an activity: '+title,()=>{
 const html=ui.findingCard(finding({id:'fixture',type,title}))
 assert.match(html,/Tilføj aktivitet/);assert.match(html,/Oprettes som aktivitet/)
 assert.doesNotMatch(html,/Tilføj opgave|data-task|reward|data-person-status/)
 assert.match(html,/data-aula-person-choice/);assert.match(html,/Ida/)
})
test('Review retains existing single and multi-person avatars and colours',()=>{
 const f=finding({person_ids:[ida,carl]})
 assert.equal(ui.findingAvatars(f),personStack({type:'Aktivitet',person_ids:[ida,carl]},people,null))
 const html=ui.findingAvatars(f)
 for(const p of people){assert.ok(html.includes('--person-color:'+p.color));assert.ok(html.includes(p.avatar_url))}
 assert.doesNotMatch(html,/data-person-status|person-status-badge/)
})
test('Calendar payload uses canonical person selection; Aula remains discreet provenance',()=>{
 const payload=calendarPayload({type:'Aktivitet',title:'Husk tuscher',date:'2026-11-11',people:[ida,carl],aulaAssisted:true,aulaSourceKind:'message'},people)
 assert.deepEqual(payload.person_ids,[ida,carl]);assert.deepEqual(payload.data.people,['Ida','Carl'])
 assert.equal(sourceLabel(payload),'Aula');assert.equal(imported(payload),false)
 assert.equal(managedTask(payload),false);assert.equal(rewardRule(payload).mode,'none')
 assert.equal(payload.data.color,undefined)
})
test('No-action and missing date cannot offer a misleading task or reward action',()=>{
 const info=ui.findingCard(finding({proposed_action:'NO_ACTION'}))
 assert.doesNotMatch(info,/data-aula="accept"|data-aula-person-choice/)
 const missing=ui.findingCard(finding({date:null}))
 assert.match(missing,/data-aula="accept"[^>]*disabled/)
})

test('Today is a compact inbox only while new findings need review',()=>{
 const inbox=Object.create(AulaUI.prototype);inbox.getContext=()=>({householdId:'fixture',role:'owner',people});inbox.ensure=()=>{}
 inbox.state={connection:{status:'connected'},findings:[]}
 assert.equal(inbox.todayCard(),'')
 inbox.state.findings=['accepted','ignored','stale'].map(status=>finding({status}))
 assert.equal(inbox.todayCard(),'')
 inbox.state.findings=Array.from({length:6},(_,i)=>finding({id:'finding-'+i,status:'new'}))
 const html=inbox.todayCard();assert.match(html,/Nyt fra Aula/);assert.match(html,/Gennemgå/);assert.equal((html.match(/<li>/g)||[]).length,3)
 assert.doesNotMatch(html,/CREATE_ACTIVITY|\bHIGH\b|\bMEDIUM\b/)
})
