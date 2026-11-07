import {t,dateFormatter,formatNumber} from '../i18n/index.js'
import {personAvatar} from './person-avatars.js'
import {enabled,rewardConfig,starBalance} from './rewards-model.js'
import {canManageStars,starGoal,personRedemptions,rewardCanDelete} from './stars-model.js'
import {escape as e,icon} from './product-ui.js'

const date=value=>dateFormatter({day:'numeric',month:'short'}).format(new Date(value))
const text=(key,values)=>e(t(key,{...values,interpolation:{escapeValue:false}}))
const stateKeys={pending:'stars.pending',approved:'stars.approved',fulfilled:'stars.fulfilled',cancelled:'stars.rejected'}
const starCount=(pid,n)=>`<span data-reward-count="stars:${e(pid)}">${formatNumber(n)}</span><span aria-hidden="true"> ⭐</span>`
const choose=(pid,label)=>`<button type="button" data-star-choose="${e(pid)}">${label}</button>`
const progress=(person,g)=>`<div class="star-progress-label"><span>${text('stars.progress_value',{balance:formatNumber(g.balance),cost:formatNumber(g.reward.star_cost)})}</span><b>${g.percent}%</b></div><progress class="star-progress" data-reward-progress="goal:${e(person.id)}" value="${Math.min(Math.max(0,g.balance),g.reward.star_cost)}" max="${g.reward.star_cost}" aria-label="${text('stars.progress_label',{name:person.name,title:g.reward.title})}" aria-valuetext="${text('stars.progress_text',{balance:formatNumber(g.balance),cost:formatNumber(g.reward.star_cost),percent:g.percent})}"></progress>`

export function starDashboard(ui,pid){
 const c=ui.c,p=c.people.find(p=>p.id===pid);if(!p||!enabled(p)||!rewardConfig(c.state,pid).star_rewards_enabled)return ''
 const g=starGoal(c.state,p),can=canManageStars(c,pid),wall=c.mode==='kiosk',active=c.state.catalog.some(r=>r.active)
 const requests=personRedemptions(c.state,pid).slice(0,2)
 let body
 if(!g.reward)body=`<p class="star-empty">${text(active?'stars.choose_something':'stars.no_rewards')}</p>${can&&active?choose(pid,text('stars.choose_reward')):!active&&ui.adult?`<button data-reward-catalog="new">${text('stars.create_reward')}</button>`:!active?`<small>${text('stars.adult_creates')}</small>`:''}`
 else body=`<div class="star-goal-heading"><span class="star-symbol" aria-hidden="true">${e(g.reward.emoji)}</span><div><p class="eyebrow">${text('stars.my_goal')}</p><h4>${e(g.reward.title)}</h4></div>${g.reached?`<span class="star-reached-mark" aria-hidden="true">✓</span>`:''}</div>${progress(p,g)}<p class="star-goal-message">${g.pending?text('stars.pending'):!g.reward.active?text('stars.inactive_goal'):g.reached?text('stars.enough',{title:g.reward.title}):text('stars.remaining',{count:g.reward.star_cost-g.balance})}</p><div class="star-actions">${can?choose(pid,text('stars.change_goal')):''}${can&&g.redeemable?`<button class="star-primary" data-reward-redeem="${e(g.reward.id)}" data-person="${e(pid)}" ${!c.online?'disabled':''}>${text('stars.redeem_reward')}</button>`:''}</div>`
 return `<section class="star-panel ${g.reached?'goal-reached':''}" data-star-person="${e(pid)}"><header><div><p class="eyebrow">${text('stars.heading')}</p><strong class="star-balance" aria-label="${text('stars.balance_label',{name:p.name,count:g.balance})}">${starCount(pid,g.balance)}</strong></div>${!wall?`<button class="star-history-button" data-star-history="${e(pid)}">${text('stars.history')}</button>`:''}</header>${body}${!can&&!wall&&c.role==='child'&&!c.state.person_members?.some(m=>m.user_id===c.userId&&m.person_id)?`<p class="hint">${text('stars.link_needed')}</p>`:''}${!c.online&&!wall?`<small>${text('stars.online_needed')}</small>`:''}${requests.length?`<div class="star-recent">${requests.map(r=>`<div data-star-request="${e(r.id)}"><span>${e(r.title)}<small>${formatNumber(r.star_cost)} ⭐ · ${date(r.updated_at||r.created_at)}</small></span><span class="star-state" data-state="${e(r.status)}">${text(stateKeys[r.status])}</span></div>`).join('')}</div>`:''}</section>`
}
export function starChoices(ui,pid){
 const c=ui.c,p=c.people.find(p=>p.id===pid),can=p&&canManageStars(c,pid),balance=starBalance(c.state,pid),current=c.state.goals.find(g=>g.person_id===pid)
 const rewards=c.state.catalog.filter(r=>r.active)
 return `<div class="star-choice-intro">${p?personAvatar(p):''}<span>${p?e(p.name):''}<strong>${text('stars.balance_value',{count:balance})}</strong></span></div><div class="star-reward-grid">${rewards.map(r=>{
  const pending=c.state.redemptions.some(s=>s.person_id===pid&&s.reward_id===r.id&&s.status==='pending')
  return `<article class="star-reward-card" data-star-reward="${e(r.id)}"><span class="star-symbol" aria-hidden="true">${e(r.emoji)}</span><h4>${e(r.title)}</h4>${r.description?`<p>${e(r.description)}</p>`:''}<strong>${formatNumber(r.star_cost)} <span aria-hidden="true">⭐</span><span class="sr-only">${text('stars.unit')}</span></strong><div class="star-actions">${can?ui.button('goal',{person_id:pid,reward_id:r.id},current?.reward_id===r.id?text('stars.selected_goal'):text('stars.save_for',{title:r.title}),!c.online||current?.reward_id===r.id):''}${can?`<button data-reward-redeem="${e(r.id)}" data-person="${e(pid)}" ${!c.online||pending||balance<r.star_cost?'disabled':''}>${pending?text('stars.pending'):balance<r.star_cost?text('stars.remaining',{count:r.star_cost-balance}):text('stars.redeem_reward')}</button>`:''}</div></article>`
 }).join('')||`<div class="star-empty"><h4>${text('stars.no_rewards')}</h4><p>${text(ui.adult?'stars.create_invitation':'stars.adult_creates')}</p>${ui.adult?`<button data-reward-catalog="new">${text('stars.create_reward')}</button>`:''}</div>`}</div>`
}
export function starRequests(ui,pid='Alle',{history=false}={}){
 const c=ui.c,rows=personRedemptions(c.state,pid).filter(r=>history||r.status==='pending'||r.status==='approved')
 if(!rows.length)return ''
 return `<section class="star-requests"><h3>${text('stars.requests')}</h3>${rows.map(r=>{const p=c.people.find(p=>p.id===r.person_id);return `<article data-reward-redemption="${e(r.id)}">${p?personAvatar(p):''}<div><strong>${e(r.title)}</strong><small>${e(p?.name||'')} · ${formatNumber(r.star_cost)} ⭐ · ${date(r.created_at)}</small><span class="star-state" data-state="${e(r.status)}">${text(stateKeys[r.status])}</span></div>${ui.adult?`<div class="star-actions">${r.status==='pending'?ui.button('redemption_approve',{id:r.id},text('rewards.approve'),!c.online)+ui.button('redemption_cancel',{id:r.id},text('rewards.reject'),!c.online):r.status==='approved'?ui.button('redemption_fulfill',{id:r.id},text('stars.mark_fulfilled'),!c.online):''}</div>`:''}</article>`}).join('')}</section>`
}
export function starHistory(ui,pid='Alle'){
 const c=ui.c,rows=c.state.ledger.filter(l=>pid==='Alle'||l.person_id===pid).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,50)
 return `${starRequests(ui,pid,{history:true})}<section class="star-ledger"><h3>${text('stars.history')}</h3>${rows.map(l=>{
  const redemption=c.state.redemptions.find(r=>r.id===l.source_id),occurrence=c.state.occurrences.find(o=>o.id===l.source_id)
  const reason=redemption?text('stars.history_reward',{title:redemption.title}):occurrence?text(l.delta>0?'stars.history_bonus':'stars.history_reopen',{title:occurrence.title}):e(l.reason)
  return `<article><div><strong>${reason}</strong><small>${e(c.people.find(p=>p.id===l.person_id)?.name||'')} · ${date(l.created_at)}</small></div><b>${l.delta>0?'+':''}${formatNumber(l.delta)} ⭐</b></article>`
 }).join('')||`<p>${text('stars.history_empty')}</p>`}${c.state.ledger.length>=200?`<small>${text('rewards.showing_the_latest_50_entries_the_family_data_export_includes_the_complete_ledger')}</small>`:''}</section>`
}
export function starAdminEntry(ui){
 if(!ui.adult)return ''
 const pending=ui.c.state.redemptions.filter(r=>r.status==='pending').length
 return `<section class="star-admin-entry"><div>${icon('tasks')}<strong>${text('stars.family_rewards')}</strong>${pending?`<span class="star-state">${text('stars.pending_count',{count:pending})}</span>`:''}</div><button data-star-admin>${text('stars.open_rewards')}</button></section>`
}
export function starAdmin(ui){
 if(!ui.adult)return ''
 const c=ui.c,people=ui.people().filter(p=>rewardConfig(c.state,p.id).star_rewards_enabled)
 return `<section class="star-admin"><header class="star-admin-heading"><div><p class="eyebrow">${text('stars.heading')}</p><h3>${text('stars.family_rewards')}</h3><p>${text('stars.bonus_explanation')}</p></div><button class="star-primary" data-reward-catalog="new">${text('stars.create_reward')}</button></header><div class="star-family-goals">${people.map(p=>{const g=starGoal(c.state,p);return `<article data-star-overview-person="${e(p.id)}">${personAvatar(p)}<div><strong>${e(p.name)}</strong><small>${g.reward?e(g.reward.title):text('stars.no_goal')}</small>${g.reward?progress(p,g):''}</div><div><b>${formatNumber(g.balance)} ⭐</b>${choose(p.id,text(g.reward?'stars.change_goal':'stars.choose_reward'))}</div></article>`}).join('')}</div>${starRequests(ui)}<h3>${text('stars.available_rewards')}</h3><div class="star-reward-grid">${c.state.catalog.map(r=>`<article class="star-reward-card ${r.active?'':'is-inactive'}" data-star-reward="${e(r.id)}"><span class="star-symbol" aria-hidden="true">${e(r.emoji)}</span><h4>${e(r.title)}</h4><strong>${formatNumber(r.star_cost)} ⭐</strong><span class="star-state">${text(r.active?'stars.active':'stars.inactive')}</span><button data-reward-catalog="${e(r.id)}">${text('stars.edit_named',{title:r.title})}</button></article>`).join('')||`<p>${text('stars.no_rewards')}</p>`}</div>${starMemberLinks(ui,people)}<details class="star-admin-history"><summary>${text('stars.history')}</summary>${starHistory(ui)}</details></section>`
}
function starMemberLinks(ui,people){
 const members=ui.c.state.person_members||[];if(!members.length)return `<details class="star-member-links"><summary>${text('stars.child_logins')}</summary><p>${text('stars.invite_child_first')}</p></details>`
 return `<details class="star-member-links"><summary>${text('stars.child_logins')}</summary><p>${text('stars.link_explanation')}</p>${people.filter(p=>['child','barn'].includes(p.role)).map(p=>`<form data-star-link="${e(p.id)}">${personAvatar(p)}<label>${e(p.name)}<select name="user_id"><option value="">${text('stars.not_linked')}</option>${members.map(m=>`<option value="${e(m.user_id)}" ${m.person_id===p.id?'selected':''}>${e(m.email||m.user_id)}</option>`).join('')}</select></label><button type="submit" ${!ui.c.online?'disabled':''}>${text('common.save')}</button></form>`).join('')}</details>`
}
export const rewardTemplates=[{key:'stars.cinema',emoji:'🎬',cost:25},{key:'stars.cafe',emoji:'☕',cost:20},{key:'stars.dinner',emoji:'🍕',cost:15},{key:'stars.screen_time',emoji:'🎮',cost:10},{key:'stars.board_games',emoji:'🎲',cost:20}]
export function openStarCatalog(ui,id){
 if(!ui.adult)return
 const r=ui.c.state.catalog.find(r=>r.id===id)||{title:'',emoji:'⭐',description:'',star_cost:25,active:true}
 ui.modal(t(r.id?'stars.edit_reward':'stars.create_reward'),`${!r.id?`<div class="star-templates"><p class="eyebrow">${text('stars.suggestions')}</p>${rewardTemplates.map((r,i)=>`<button type="button" data-star-template="${i}"><span aria-hidden="true">${r.emoji}</span> ${text(r.key)}</button>`).join('')}<button type="button" data-star-template="custom">${text('stars.custom_reward')}</button></div>`:''}<form id="reward-catalog-form" class="stack-form" data-id="${r.id||''}"><label for="reward-title">${text('stars.reward_title')}</label><input id="reward-title" name="title" required maxlength="120" value="${e(r.title)}"><div class="star-form-pair"><label>${text('stars.price')}<input name="star_cost" type="number" min="1" max="1000000" step="1" required value="${r.star_cost}"></label><label>${text('stars.symbol')}<input name="emoji" maxlength="16" value="${e(r.emoji)}"></label></div><label for="reward-description">${text('stars.description_optional')}</label><textarea id="reward-description" name="description" maxlength="1000">${e(r.description)}</textarea><label class="star-active-field"><input name="active" type="checkbox" ${r.active?'checked':''}>${text('stars.available_to_family')}</label><button class="star-primary" type="submit" ${!ui.c.online?'disabled':''}>${text('stars.save_reward')}</button></form>${r.id?`<p class="hint">${text('stars.history_preserved')}</p>${rewardCanDelete(ui.c.state,r.id)?`<button class="star-delete" data-star-delete="${e(r.id)}">${text('stars.delete_unused')}</button>`:''}`:''}`,'catalog')
}
