import {escape as e,icon} from './product-ui.js'
export const filterRoutes=['today','calendar','tasks']
const group=item=>item.type==='Opgave'?2:item.type==='Fritidsinteresse'?1:0
export function compactDay(items,limit=6){
 const groups=[0,1,2].map(n=>items.filter(x=>group(x)===n)),counts=[0,0,0]
 let left=limit
 // A short kiosk day keeps an appointment and a task before allocating hobbies.
 for(const i of [0,2,1])if(left>0&&groups[i].length){counts[i]++;left--}
 for(const i of [0,1,2]){const extra=Math.min(left,groups[i].length-counts[i]);counts[i]+=extra;left-=extra}
 const selected=groups.flatMap((items,i)=>items.slice(0,counts[i]))
 return {items:selected,hidden:items.length-selected.length}
}
export function compactTask(item,{people,done,reward}={}){
 return '<button class="compact-task '+(done?'is-done':'')+'" data-task-detail="'+e(item.id)+'"><span class="compact-task-status" aria-hidden="true">'+(done?'✓':reward?.mode==='stars'?'☆':'○')+'</span><span><strong>'+e(item.title)+'</strong><small>'+e(people||'Alle')+(reward?.mode==='stars'?' · +'+e(reward.stars)+' ⭐':reward?.mode==='allowance'?' · Lommepenge':'')+'</small></span></button>'
}
export function compactMeals(meals){return meals.length?'<section class="day-meals" aria-label="Mad">'+meals.map(meal=>'<button data-plan-edit="'+e(meal.id)+'">'+icon('meals')+'<strong>'+e(meal.title)+'</strong></button>').join('')+'</section>':''}
