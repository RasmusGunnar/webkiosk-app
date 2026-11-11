import {t} from '../i18n/index.js'
import {escape as e,icon} from './product-ui.js'
export const filterRoutes=['today','calendar','tasks']
export function compactTask(item,{people,avatars,done,reward}={}){
 const excused=item.data?.allowanceStatus==='excused'
 return '<button class="compact-task '+(done?'is-done':excused?'is-excused':'')+'" data-task-detail="'+e(item.id)+'"><span class="compact-task-status" aria-hidden="true">'+(done?'✓':excused?'–':reward?.mode==='stars'?'☆':'○')+'</span><span><strong>'+e(item.title)+'</strong><small>'+(avatars||e(people||'Alle'))+(reward?.mode==='stars'?' · +'+e(reward.stars)+' ⭐':reward?.mode==='allowance'?' '+t('calendar_layout.allowance'):'')+(excused?' · '+t('rewards.excused'):'')+'</small></span></button>'
}
export function compactMeals(meals){return meals.length?("<section class=\"day-meals\" aria-label=\""+t("calendar_layout.meals")+"\">")+meals.map(meal=>'<button data-plan-edit="'+e(meal.id)+'">'+icon('meals')+'<strong>'+e(meal.title)+'</strong></button>').join('')+'</section>':''}
