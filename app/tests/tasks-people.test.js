import test from 'node:test'
import assert from 'node:assert/strict'
import {personAvatar,personPicker,personStack,initials} from '../src/lib/person-avatars.js'
import {emptyRewards,taskComplete,actionPayload,optimisticReward,completionNeedsApproval,managedTask} from '../src/lib/rewards-model.js'
import {weeklyProgress} from '../src/lib/task-rewards.js'
import {setLocale} from '../src/i18n/index.js'
setLocale('da-DK')
const people=[{id:'rasmus',name:'Rasmus',role:'adult',color:'#567891'},{id:'carl',name:'Carl',role:'child',color:'#809960'}]
const task={id:'task',date:'2026-11-07',type:'Opgave',person_ids:people.map(p=>p.id),data:{},done:true}
const entry=(person,action='complete')=>({payload:{reward_action:{action,payload:actionPayload(task,person),optimistic:{origin_id:task.id,requires_approval:false}}}})
test('ordinary multi-person task ignores legacy shared done; offline updates are scoped to person/occurrence',()=>{
 let state=emptyRewards();assert.equal(taskComplete(task,people,state),false)
 state=optimisticReward(state,entry('carl'));assert.equal(taskComplete(task,people,state,'carl'),true);assert.equal(taskComplete(task,people,state,'rasmus'),false)
 state=optimisticReward(state,entry('rasmus'));assert.equal(taskComplete(task,people,state),true)
 state=optimisticReward(state,entry('carl','undo'));assert.equal(taskComplete(task,people,state,'rasmus'),true);assert.equal(taskComplete(task,people,state,'carl'),false)
 assert.deepEqual(state.monthly,[]);assert.deepEqual(state.ledger,[])
 assert.equal(taskComplete({...task,date:'2026-11-14'},people,state),false)
})
test('approval prediction needs both authenticated adult membership and an assigned adult person',()=>{
 const item={...task,data:{requiresApproval:true}}
 assert.equal(completionNeedsApproval(item,people[1],'owner'),true)
 assert.equal(completionNeedsApproval(item,people[0],'child'),true)
 assert.equal(completionNeedsApproval(item,people[0],'owner'),false)
 assert.equal(completionNeedsApproval(item,{...people[0],role:'voksen'},'owner'),false)
 const prior={...emptyRewards(),occurrences:[{origin_id:task.id,person_id:'rasmus',occurrence_date:task.date,status:'open',requires_approval:true}]}
 assert.equal(optimisticReward(prior,entry('rasmus')).occurrences[0].status,'completed')
})
test('excused is settled for task grouping, never a weekly completed task',()=>{
 const state={...emptyRewards(),occurrences:people.map(p=>({origin_id:task.id,person_id:p.id,occurrence_date:task.date,due_date:task.date,status:p.id==='carl'?'excused':'completed'}))}
 assert.equal(taskComplete(task,people,state),true)
 assert.equal(weeklyProgress([task],people,task.date,task.date,state)[0].count,0)
})
test('avatar uses photo then initials, existing color, safe escaping and a distinct group',()=>{
 const html=personAvatar({...people[1],avatar_url:'data:image/png;base64,AAAA'})
 assert.match(html,/<img/);assert.match(html,/--person-color:#809960/);assert.match(html,/aria-label="Carl"/)
 assert.equal(initials(' Rasmus Jensen '),'RJ');assert.equal(initials(''),'?')
 assert.doesNotMatch(personAvatar({...people[0],avatar_url:'javascript:alert(1)',color:'red;position:fixed'}),/<img|position:fixed/)
 assert.match(personAvatar({id:'Alle'}),/is-group/);assert.match(personAvatar({id:'Alle'}),/<svg/)
 assert.match(personAvatar({name:'<script>'}),/&lt;/)
})
test('status badges have accessible labels, and activities do not inherit task status',()=>{
 for(const status of ['completed','pending','approved','excused'])assert.match(personAvatar(people[1],{status}),new RegExp('data-person-status="'+status+'"'))
 const state=optimisticReward(emptyRewards(),entry('carl'))
 assert.match(personStack(task,people,state),/Carl – Udført/)
 assert.doesNotMatch(personStack({...task,type:'Aktivitet'},people,state),/data-person-status|person-status-badge/)
 assert.equal(managedTask({...task,source:'ics'}),false)
 assert.doesNotMatch(personStack({...task,source:'ics'},people,state),/data-person-status|person-status-badge/)
 assert.match(personStack({...task,person_ids:[],person:'Alle',type:'Aktivitet'},people,state),/is-group/)
})
test('picker selection and overflow preserve names and stable IDs',()=>{
 const html=personPicker(people,['carl'])
 assert.match(html,/value="carl"[^>]+checked/);assert.doesNotMatch(html,/value="rasmus"[^>]+checked/)
 assert.match(html,/aria-label="Rasmus"/)
 const more=[...people,{id:'ida',name:'Ida'},{id:'jakob',name:'Jakob'}]
 const stack=personStack({...task,person_ids:more.map(p=>p.id)},more,emptyRewards(),{limit:2})
 assert.match(stack,/>\+2</);assert.match(stack,/Ida – Ikke udført, Jakob – Ikke udført/)
})
