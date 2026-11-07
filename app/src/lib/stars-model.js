import {starBalance,enabled,rewardConfig} from './rewards-model.js'

export const ownStarPerson=(state,userId)=>state?.person_members?.find(m=>m.user_id===userId)?.person_id||null
export function canManageStars({state,userId,role,mode},personId){
 return mode!=='kiosk'&&(['owner','admin','adult'].includes(role)||(role==='child'&&ownStarPerson(state,userId)===personId))
}
export function starGoal(state,person){
 const balance=starBalance(state,person.id),goalId=state.goals?.find(g=>g.person_id===person.id)?.reward_id
 const reward=state.catalog?.find(r=>r.id===goalId)||null
 const pending=state.redemptions?.find(r=>r.person_id===person.id&&r.reward_id===goalId&&r.status==='pending')||null
 const available=person.is_active!==false&&enabled(person)&&rewardConfig(state,person.id).star_rewards_enabled
 const percent=reward?Math.min(100,Math.max(0,Math.round(balance/reward.star_cost*100))):0
 return {balance,reward,pending,available,percent,reached:!!reward?.active&&balance>=reward.star_cost,redeemable:available&&!!reward?.active&&balance>=reward.star_cost&&!pending}
}
export function personRedemptions(state,personId='Alle'){
 return [...(state.redemptions||[])].filter(r=>personId==='Alle'||r.person_id===personId).sort((a,b)=>String(b.updated_at||b.created_at).localeCompare(String(a.updated_at||a.created_at)))
}
export const rewardCanDelete=(state,id)=>!state.goals.some(g=>g.reward_id===id)&&!state.redemptions.some(r=>r.reward_id===id)
