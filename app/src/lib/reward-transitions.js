import {emptyRewards, starBalance, rewardGoal} from './rewards-model.js'

const monthKey=m=>`${m.person_id}:${m.year}-${m.month}`
export const fullMonth=m=>m?.eligible_total>0&&m.completed_total===m.eligible_total
const byId=rows=>new Map((rows||[]).map(row=>[row.id,row]))

// Only confirmed server snapshots enter this observer. Hydration establishes a
// baseline; optimistic queue overlays never mint currency or animation events.
export class RewardTransitions {
 constructor(){this.reset()}
 reset(){this.previous=null;this.ledgerIds=new Set();this.eventKeys=new Set()}
 hydrate(state){this.previous=structuredClone(state||emptyRewards());for(const row of state?.ledger||[])this.ledgerIds.add(row.id)}
 observe(state){
  if(!this.previous){return []}
  const before=this.previous,events=[],add=event=>{if(!this.eventKeys.has(event.key)){this.eventKeys.add(event.key);events.push(event)}}
  const oldOccurrences=byId(before.occurrences),changedPeople=new Set()
  for(const row of state.ledger||[]){
   if(this.ledgerIds.has(row.id))continue
   this.ledgerIds.add(row.id)
   // A recent-history window can reveal older rows after another row disappears.
   if(before.ledger?.length&&row.created_at<before.ledger.reduce((a,b)=>a.created_at<b.created_at?a:b).created_at)continue
   const occurrence=(state.occurrences||[]).find(o=>o.id===row.source_id)
   add({kind:'stars',key:'ledger:'+row.id,pid:row.person_id,delta:row.delta,taskId:occurrence?.task_id,redemptionId:row.source_type==='redemption'?row.source_id:null})
   changedPeople.add(row.person_id)
  }
  for(const pid of changedPeople){
   const from=starBalance(before,pid),to=starBalance(state,pid)
   if(from!==to)events.push({kind:'balance',key:'balance:'+pid,pid,from,to})
   const goal=rewardGoal(state,pid),oldGoal=rewardGoal(before,pid)
   if(goal&&goal.id===oldGoal?.id&&from!==to)events.push({kind:'goal',key:'goal:'+pid,pid,from,to,max:goal.star_cost,title:goal.title,rewardId:goal.id,unlocked:from<goal.star_cost&&to>=goal.star_cost})
  }
  const months=new Map((before.monthly||[]).map(m=>[monthKey(m),m]))
  for(const m of state.monthly||[]){
   const old=months.get(monthKey(m));if(!old)continue
   if(old.earned_minor!==m.earned_minor||old.completion_percent!==m.completion_percent||old.completed_total!==m.completed_total||old.eligible_total!==m.eligible_total){
    events.push({kind:'allowance',key:'allowance:'+monthKey(m),pid:m.person_id,from:old,to:m,milestone:fullMonth(m)&&!fullMonth(old)})
   }
  }
  for(const row of state.occurrences||[]){
   const old=oldOccurrences.get(row.id)
   if(old?.revision===row.revision||old?.status===row.status||!['pending','completed','approved','open','rejected'].includes(row.status))continue
   add({kind:'task',key:`occurrence:${row.id}:${row.revision}`,pid:row.person_id,taskId:row.task_id,status:row.status,mode:row.reward_mode,title:row.title})
  }
  const redemptions=byId(before.redemptions)
  for(const row of state.redemptions||[]){
   if(redemptions.get(row.id)?.status===row.status)continue
   if(['pending','approved'].includes(row.status))add({kind:'redemption',key:`redemption:${row.id}:${row.status}`,pid:row.person_id,redemptionId:row.id,rewardId:row.reward_id,status:row.status,title:row.title})
  }
  this.previous=structuredClone(state)
  return events
 }
}
