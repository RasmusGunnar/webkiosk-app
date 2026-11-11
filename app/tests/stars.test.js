import test from 'node:test'
import assert from 'node:assert/strict'
import {starGoal,canManageStars,rewardCanDelete} from '../src/lib/stars-model.js'
import {emptyRewards} from '../src/lib/rewards-model.js'
import {starGoals,starDashboard,starAdmin,starChoices,starHistory} from '../src/lib/stars-ui.js'
const carl={id:'carl',name:'Carl',role:'child',is_active:true},ida={id:'ida',name:'Ida',role:'child'}
const cinema={id:'cinema',title:'Biograftur',star_cost:25,emoji:'🎬',active:true},cafe={id:'cafe',title:'Cafétur',star_cost:20,active:true}
const state=()=>({...emptyRewards(),catalog:[cinema,cafe],balances:[{person_id:'carl',balance:17},{person_id:'ida',balance:20}],goals:[{person_id:'carl',reward_id:'cinema'}],person_members:[{user_id:'child-login',person_id:'carl'}]})
test('STAR_GOAL 17 / 25 = 68%, not redeemable; reached and progress capped at 100%',()=>{
 const s=state();assert.deepEqual([starGoal(s,carl).balance,starGoal(s,carl).percent,starGoal(s,carl).redeemable],[17,68,false])
 for(const balance of [25,31]){s.balances[0].balance=balance;assert.equal(starGoal(s,carl).percent,100);assert.equal(starGoal(s,carl).reached,true);assert.equal(starGoal(s,carl).redeemable,true)}
 s.redemptions=[{person_id:'carl',reward_id:'cinema',status:'pending'}];assert.equal(starGoal(s,carl).redeemable,false)
})
test('goals, progress and balances remain individual, inactive goal is explained',()=>{
 const s=state(),before=structuredClone(s.balances);s.goals.push({person_id:'ida',reward_id:'cinema'})
 assert.equal(starGoal(s,ida).percent,80);s.goals[0].reward_id='cafe';assert.equal(starGoal(s,carl).percent,85);assert.deepEqual(s.balances,before)
 s.catalog=s.catalog.map(r=>({...r,active:false}));assert.equal(starGoal(s,carl).reward.id,'cafe');assert.equal(starGoal(s,carl).redeemable,false)
})
test('only own linked child can manage goals, adult can act for child, wall stays read-only',()=>{
 const c={state:state(),role:'child',userId:'child-login',mode:'mobile'}
 assert.equal(canManageStars(c,'carl'),true);assert.equal(canManageStars(c,'ida'),false);assert.equal(canManageStars({...c,userId:'unlinked'},'carl'),false)
 assert.equal(canManageStars({...c,role:'adult'},'ida'),true);assert.equal(canManageStars({...c,role:'owner',mode:'kiosk'},'carl'),false)
})
test('reward deletion is offered only without goals or redemption history',()=>{
 const s=state();assert.equal(rewardCanDelete(s,'cinema'),false);assert.equal(rewardCanDelete(s,'cafe'),true)
 s.redemptions.push({reward_id:'cafe',status:'cancelled'});assert.equal(rewardCanDelete(s,'cafe'),false)
})
test('star surfaces keep readable progress, keyboard buttons, empty states and wall read-only',()=>{
 const c={state:state(),people:[carl,ida],role:'child',userId:'child-login',mode:'mobile',online:true},ui={c,adult:false,button:(action,payload,label)=>`<button data-reward-action="${action}">${label}</button>`,people:()=>c.people}
 assert.match(starDashboard(ui,'carl'),/value="17" max="25"/);assert.match(starDashboard(ui,'carl'),/68 procent/)
 assert.match(starChoices(ui,'carl'),/<button/);assert.equal(starAdmin(ui),'')
 c.mode='kiosk';assert.doesNotMatch(starDashboard(ui,'carl'),/<button|data-reward-redeem/)
 c.mode='mobile';c.state.goals=[];assert.match(starDashboard(ui,'carl'),/Hvad vil du spare op til/)
 c.state.catalog=[];assert.match(starDashboard(ui,'carl'),/endnu ingen belønninger/)
 assert.doesNotMatch(starDashboard(ui,'carl'),/data-star-choose/)
})
test('redemption history uses immutable snapshot titles, including after catalog edits',()=>{
 const c={state:state(),people:[carl],mode:'mobile',online:true};c.state.redemptions=[{id:'redeem',person_id:'carl',reward_id:'cinema',title:'Den aftalte biograftur',star_cost:25,status:'approved',created_at:'2026-11-07T12:00:00Z'}]
 c.state.ledger=[{source_id:'redeem',person_id:'carl',delta:-25,reason:'original',created_at:'2026-11-07T12:00:00Z'}]
 assert.match(starHistory({c,adult:false},'carl'),/Belønning: Den aftalte biograftur/);assert.match(starHistory({c,adult:false},'carl'),/-25/)
})

test('All tasks shows separate child goal cards, no disabled/archived/adult cards and no state writes',()=>{
 const c={state:state(),people:[{...carl,color:'#8e9e65'},ida,{...ida,id:'off'},{...ida,id:'archived',is_active:false},{...carl,id:'adult',role:'adult',reward_enabled:true}],role:'adult',mode:'desktop',online:true}
 c.state.configs=[{person_id:'off',star_rewards_enabled:false}]
 c.state.goals.push({person_id:'ida',reward_id:'cafe'})
 const before=structuredClone(c),html=starGoals({c,adult:true})
 assert.equal((html.match(/data-star-person=/g)||[]).length,2)
 assert.match(html,/Biograftur/);assert.match(html,/Cafétur/);assert.match(html,/--goal-color:#8e9e65/)
 assert.match(html,/Du mangler 8/);assert.match(html,/Du har nok stjerner til Cafétur/)
 assert.match(html,/data-reward-redeem="cafe" data-person="ida"/);assert.deepEqual(c,before)
})

test('All child cards expose only own goal actions; wall has no actions even with empty catalog',()=>{
 const c={state:state(),people:[carl,ida],role:'child',userId:'child-login',mode:'mobile',online:true}
 const html=starGoals({c,adult:false})
 assert.match(html,/data-star-choose="carl"/);assert.doesNotMatch(html,/data-star-choose="ida"|data-reward-catalog|data-star-admin/)
 c.mode='kiosk';c.role='owner';c.state.catalog=[];c.state.goals=[]
 const wall=starGoals({c,adult:true})
 assert.doesNotMatch(wall,/<button|data-star-choose|data-star-history|data-reward-catalog|data-reward-select|data-star-link/)
 assert.match(wall,/Intet mål valgt endnu/);assert.doesNotMatch(wall,/oprette|Vælg belønning/)
})
