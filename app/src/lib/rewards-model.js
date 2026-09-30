import {materialize, occurrenceDate, value} from './calendar-semantics.js'
import {monthDates, dateIso} from './calendar-dates.js'
import {itemMatchesPerson} from './people.js'
export const rewardToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export const emptyRewards=()=>({configs:[],periods:[],occurrences:[],balances:[],ledger:[],catalog:[],goals:[],redemptions:[],snapshots:[],monthly:[]})
export const enabled=p=>p.reward_enabled??['child','barn'].includes(p.role)
export const rewardConfig=(state,id)=>state?.configs?.find(c=>c.person_id===id)||{allowance_enabled:false,monthly_allowance_minor:10000,star_rewards_enabled:true,default_requires_approval:false,history:[]}
export function rewardRule(item){
 const day=item.date||rewardToday(),rules=value(item,'rewardRules')
 if(Array.isArray(rules))return [...rules].filter(r=>r.from<=day).sort((a,b)=>b.from.localeCompare(a.from))[0]||{mode:'none',stars:0,approval:false,pool:false}
 // Newly queued tasks have not yet received server-maintained rule history.
 return {mode:value(item,'rewardMode')||'none',stars:Number(value(item,'starValue')||0),approval:!!value(item,'requiresApproval'),pool:!!value(item,'bonusPool')}
}
export const managedTask=item=>item?.type==='Opgave'&&(rewardRule(item).mode!=='none'||rewardRule(item).approval)
export const rewardOrigin=item=>value(item,'rewardOriginId')||value(item,'overrideBaseId')||item.baseId||item.id
export const occurrenceState=(state,item,pid)=>state?.occurrences?.find(s=>s.origin_id===rewardOrigin(item)&&s.occurrence_date===occurrenceDate(item)&&s.person_id===pid)
export const isApproved=s=>['completed','approved'].includes(s?.status)
export const starBalance=(state,pid)=>Number(state?.balances?.find(b=>b.person_id===pid)?.balance||0)
export const rewardGoal=(state,pid)=>state?.catalog?.find(r=>r.active&&r.id===state.goals?.find(g=>g.person_id===pid)?.reward_id)
export function taskPeople(item,people,state){
 const pool=rewardRule(item).pool,claim=pool&&state?.occurrences?.find(s=>s.origin_id===rewardOrigin(item)&&s.occurrence_date===occurrenceDate(item)&&s.claimed)
 return people.filter(p=>p.is_active!==false&&(pool?(claim?p.id===claim.person_id:enabled(p)&&rewardConfig(state,p.id).star_rewards_enabled):itemMatchesPerson(item,p.id,people)))
}
export function taskComplete(item,people,state,pid='Alle'){
 if(!managedTask(item))return !!item.done
 const targets=taskPeople(item,people,state).filter(p=>pid==='Alle'||p.id===pid)
 return !!targets.length&&targets.every(p=>isApproved(occurrenceState(state,item,p.id)))
}
export const actionPayload=(item,pid)=>({person_id:pid,item_id:item.isRepeatOccurrence?item.baseId:item.id,occurrence_date:occurrenceDate(item),due_date:item.date})
export function currency(minor){return new Intl.NumberFormat('da-DK',{style:'currency',currency:'DKK',minimumFractionDigits:minor%100?2:0,maximumFractionDigits:2}).format(minor/100)}
export function parseCurrency(text){const m=String(text).trim().match(/^(\d{1,7})(?:[,.](\d{1,2}))?$/);if(!m)throw Error('Skriv et beløb i kroner, fx 100 eller 100,50.');const n=Number(m[1])*100+Number((m[2]||'').padEnd(2,'0'));if(n>100000000)throw Error('Beløbet er for stort.');return n}
export function monthProgress(rows,people,state,pid,day=rewardToday()){
 const month=day.slice(0,7),config=rewardConfig(state,pid),person=people.find(p=>p.id===pid)
 const frozen=state?.snapshots?.find(s=>s.person_id===pid&&s.year===Number(day.slice(0,4))&&s.month===Number(day.slice(5,7)));if(frozen)return frozen
 // Confirmed server totals are authoritative, including while completion is queued offline.
 const confirmed=state?.monthly?.find(m=>m.person_id===pid&&m.year===Number(day.slice(0,4))&&m.month===Number(day.slice(5,7)));if(confirmed)return confirmed
 let total=0,completed=0,excused=0
 for(const item of materialize(rows,monthDates(day),{milestones:false})){
  if(item.type!=='Opgave'||!person||!itemMatchesPerson(item,pid,people))continue
  const rule=rewardRule(item),s=occurrenceState(state,item,pid),cfg=[...config.history].filter(h=>h.from<=item.date).sort((a,b)=>b.from.localeCompare(a.from))[0]
  if((s?.reward_mode||rule.mode)!=='allowance'||!cfg?.enabled||!cfg?.allowance)continue
  if(s?.status==='excused'){excused++;continue}if(s?.status==='cancelled')continue
  total++;if(isApproved(s)&&!s.local_pending)completed++
 }
 const amount=state?.periods?.find(p=>p.person_id===pid&&p.month_start===month+'-01')?.allowance_minor??config.monthly_allowance_minor
 return {person_id:pid,eligible_total:total,completed_total:completed,excused_total:excused,allowance_minor:amount,earned_minor:total?Number((BigInt(amount)*BigInt(completed)*2n+BigInt(total))/(BigInt(total)*2n)):0,completion_percent:total?Math.round(completed*10000/total)/100:0}
}
export function optimisticReward(state,entry){
 const a=entry.payload.reward_action;if(!a||!['complete','undo'].includes(a.action))return state
 const p=a.payload,view=structuredClone(state||emptyRewards()),prior=view.occurrences.find(s=>s.person_id===p.person_id&&s.origin_id===a.optimistic.origin_id&&s.occurrence_date===p.occurrence_date)
 if(a.action==='complete'&&isApproved(prior))return view
 const s={...a.optimistic,...prior,...p,status:a.action==='undo'?'open':(prior?.requires_approval??a.optimistic.requires_approval)?'pending':'completed',local_pending:true}
 view.occurrences=view.occurrences.filter(o=>!(o.person_id===p.person_id&&o.origin_id===s.origin_id&&o.occurrence_date===p.occurrence_date));view.occurrences.push(s)
 return view
}
