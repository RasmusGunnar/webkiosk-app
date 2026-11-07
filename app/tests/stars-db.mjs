import {db,query,actor,today,ids} from './tasks-people-db.mjs'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
const checks=[],check=(name,ok=true)=>{assert.ok(ok,name);checks.push(name);console.log('STAR PASS '+name)}
const act=async(action,payload,user=ids.adult,request=randomUUID())=>{await actor(user);return (await query('select public.reward_action($1,$2,$3,$4::jsonb) result',[request,ids.hid,action,JSON.stringify(payload)])).rows[0].result}
const state=async()=>{await actor(ids.adult);return (await query('select public.get_reward_state($1) result',[ids.hid])).rows[0].result}
const balance=(s,p=ids.carl)=>Number(s.balances.find(b=>b.person_id===p)?.balance||0)
const denied=async(name,fn,code)=>{await assert.rejects(fn,code?e=>e.code===code:undefined);check(name)}
// Seed earned stars through actual task completion/approval, never manual balances.
const earn=async(person,stars)=>{await actor(null);const item=randomUUID();await query("insert into public.calendar_items(id,household_id,created_by,title,type,date,person_ids,data) values($1,$2,$3,'Hjalp med mad','Opgave',$4,$5,$6::jsonb)",[item,ids.hid,ids.adult,today,[person],JSON.stringify({rewardMode:'stars',starValue:stars,requiresApproval:true})]);const payload={person_id:person,item_id:item,due_date:today,occurrence_date:today};await act('complete',payload,ids.child);const before=await state();await act('approve',payload);return {item,payload,before}}
let s=await state();const carlStart=balance(s),allowanceBefore=JSON.stringify({monthly:s.monthly,contracts:s.contracts,snapshots:s.snapshots})
const cinema=(await act('catalog',{title:'Biograftur',star_cost:25,emoji:'🎬',active:true})).id,cafe=(await act('catalog',{title:'Cafétur',star_cost:20,emoji:'☕',active:true})).id
await denied('Unlinked child cannot claim another person goal',()=>act('goal',{person_id:ids.carl,reward_id:cinema},ids.child),'42501')
await act('link_person',{person_id:ids.carl,user_id:ids.child})
await actor(ids.child);await denied('Child cannot forge member/person mapping',()=>query('update public.household_members set person_id=$1 where user_id=$2',[ids.rasmus,ids.child]),'42501')
await denied('Child cannot create or edit rewards',()=>act('catalog',{id:cinema,title:'Free',star_cost:1,active:true},ids.child),'42501')
await denied('Child cannot link themselves to another person',()=>act('link_person',{person_id:ids.rasmus,user_id:ids.child},ids.child),'42501')
const firstAward=await earn(ids.carl,17-carlStart);s=await state();check('Pending bonus credits no stars before approval',balance(firstAward.before)===carlStart&&balance(s)===17)
await act('goal',{person_id:ids.carl,reward_id:cinema},ids.child);s=await state();check('STAR_GOAL',balance(s)===17&&s.goals.find(g=>g.person_id===ids.carl).reward_id===cinema)
await denied('Cannot redeem below cost',()=>act('redeem',{person_id:ids.carl,reward_id:cinema},ids.child),'P1002')
await act('goal',{person_id:ids.carl,reward_id:cafe},ids.child);check('CHANGE_GOAL balance unchanged',balance(await state())===17)
await act('goal',{person_id:ids.carl,reward_id:cinema},ids.child)
await earn(ids.carl,8);check('GOAL_REACHED',balance(await state())===25)
const request=randomUUID(),redemption=(await act('redeem',{person_id:ids.carl,reward_id:cinema},ids.child,request)).id
await act('redeem',{person_id:ids.carl,reward_id:cinema},ids.child,request)
check('REDEMPTION_REQUEST pending without spending',balance(await state())===25)
// Submit two requests together; PGlite executes on one connection. True two-
// connection PostgreSQL contention remains in the real API verification gate.
await actor(ids.child)
const duplicateRequests=await Promise.all([1,2].map(()=>query('select public.reward_action($1,$2,$3,$4::jsonb) result',[randomUUID(),ids.hid,'redeem',JSON.stringify({person_id:ids.carl,reward_id:cinema})])))
check('Concurrent-submitted requests share one pending redemption',duplicateRequests.every(r=>r.rows[0].result.id===redemption))
await act('catalog',{id:cinema,title:'Biograf nu 99',star_cost:99,emoji:'🎟️',active:false})
s=await state();check('Snapshot and inactive goal preserved',s.redemptions.find(r=>r.id===redemption).star_cost===25&&s.redemptions.find(r=>r.id===redemption).title==='Biograftur'&&s.goals.some(g=>g.person_id===ids.carl))
await denied('CHILD_APPROVAL denied',()=>act('redemption_approve',{id:redemption},ids.child),'42501')
await actor(ids.adult)
await Promise.all([1,2].map(()=>query('select public.reward_action($1,$2,$3,$4::jsonb)',[randomUUID(),ids.hid,'redemption_approve',JSON.stringify({id:redemption})])))
s=await state();check('DOUBLE_REDEEM single ledger debit',balance(s)===0&&s.ledger.filter(l=>l.source_id===redemption).length===1&&s.ledger.find(l=>l.source_id===redemption).delta===-25)
check('ADULT_APPROVAL and goal cleared',s.redemptions.find(r=>r.id===redemption).status==='approved'&&!s.goals.some(g=>g.person_id===ids.carl))
await denied('Reward with history cannot be deleted',()=>act('catalog_delete',{id:cinema}),'P1004')
await denied('Inactive reward cannot be chosen',()=>act('goal',{person_id:ids.carl,reward_id:cinema},ids.child),'P1003')
const unused=(await act('catalog',{title:'Unused',star_cost:2,active:true})).id;await act('catalog_delete',{id:unused});check('Unused reward can be deleted',!(await state()).catalog.some(r=>r.id===unused))
await earn(ids.carl,20);const pending=(await act('redeem',{person_id:ids.carl,reward_id:cafe},ids.child)).id
await act('redemption_cancel',{id:pending});s=await state();check('Rejected request keeps balance and history',balance(s)===20&&s.redemptions.find(r=>r.id===pending).status==='cancelled')
const next=(await act('redeem',{person_id:ids.carl,reward_id:cafe},ids.child)).id
const first20=s.occurrences.find(o=>o.person_id===ids.carl&&o.star_value===20&&o.status==='approved')
await act('undo',{person_id:ids.carl,item_id:first20.task_id,due_date:first20.due_date,occurrence_date:first20.occurrence_date})
await denied('INSUFFICIENT_BALANCE safe approval rejection',()=>act('redemption_approve',{id:next}),'P1002');s=await state()
check('Insufficient approval creates no debit or negative balance',balance(s)===0&&!s.ledger.some(l=>l.source_id===next)&&s.redemptions.find(r=>r.id===next).status==='pending')
const ida=randomUUID(),idaUser=randomUUID();await actor(null);await query('insert into auth.users(id) values($1)',[idaUser]);await query("insert into public.household_people(id,household_id,name,role) values($1,$2,'Ida','child')",[ida,ids.hid]);await query("insert into public.household_members(household_id,user_id,role) values($1,$2,'child')",[ids.hid,idaUser]);await act('link_person',{person_id:ida,user_id:idaUser});await earn(ida,20)
await act('goal',{person_id:ids.carl,reward_id:cafe},ids.child);await act('goal',{person_id:ida,reward_id:cafe},idaUser);s=await state();check('MULTI_CHILD independent goal and balances',s.goals.filter(g=>g.reward_id===cafe).length===2&&balance(s,ida)===20&&balance(s)===0)
await denied('Child cannot manage sibling goal',()=>act('goal',{person_id:ida,reward_id:cafe},ids.child),'42501');await denied('Child cannot request sibling reward',()=>act('redeem',{person_id:ida,reward_id:cafe},ids.child),'42501')
await actor(ids.child);await denied('Child cannot mint ledger stars',()=>query("insert into public.reward_star_ledger(household_id,person_id,delta,reason,source_type,source_id,idempotency_key) values($1,$2,999,'Forged','task_award',$3,$4)",[ids.hid,ids.carl,randomUUID(),randomUUID()]),'42501')
await actor(ids.stranger);const foreign=(await query("select public.create_household('Other family') id")).rows[0].id
await query('select public.reward_action($1,$2,$3,$4::jsonb)',[randomUUID(),foreign,'catalog',JSON.stringify({title:'Other family reward',star_cost:1})])
for(const table of ['reward_catalog','reward_goals','reward_redemptions','reward_star_ledger'])check('HOUSEHOLD_ISOLATION read '+table,(await query('select * from public.'+table+' where household_id=$1',[ids.hid])).rows.length===0)
const foreignRewards=(await query('select * from public.reward_catalog')).rows
check('Household B still sees its own rewards',foreignRewards.length===1&&foreignRewards[0].household_id===foreign)
await denied('HOUSEHOLD_ISOLATION mutation',()=>act('catalog',{title:'Cross-household',star_cost:1},ids.stranger),'42501')
await actor(ids.stranger);const foreignPerson=randomUUID();await query("insert into public.household_people(id,household_id,name,role) values($1,$2,'Other child','child')",[foreignPerson,foreign])
await denied('HOUSEHOLD_ISOLATION foreign reward in own goal',()=>query('select public.reward_action($1,$2,$3,$4::jsonb)',[randomUUID(),foreign,'goal',JSON.stringify({person_id:foreignPerson,reward_id:cafe})]),'P1003')
await actor(null);const wallUser=randomUUID();await query('insert into auth.users(id,is_anonymous) values($1,true)',[wallUser]);await query("insert into public.household_devices(household_id,auth_user_id,platform,paired_by) values($1,$2,'web',$3)",[ids.hid,wallUser,ids.adult])
for(const [action,payload] of [['goal',{person_id:ids.carl,reward_id:cafe}],['redeem',{person_id:ids.carl,reward_id:cafe}],['catalog',{title:'Wall reward',star_cost:1}],['redemption_approve',{id:next}]])await denied('Wall cannot mutate stars: '+action,()=>act(action,payload,wallUser))
s=await state();check('Allowance periods, snapshots and money unchanged',JSON.stringify({monthly:s.monthly,contracts:s.contracts,snapshots:s.snapshots})===allowanceBefore)
const out=new URL('../../supabase/.temp/tasks-people-ux/',import.meta.url);mkdirSync(out,{recursive:true});writeFileSync(new URL('stars-database-results.json',out),JSON.stringify({engine:'PostgreSQL/WASM (PGlite)',checks,concurrency:'Concurrent submissions tested on PGlite single connection. Real two-connection PostgreSQL/API verification pending.'},null,2));console.log('STARS DATABASE PASS '+checks.length);await db.close()
