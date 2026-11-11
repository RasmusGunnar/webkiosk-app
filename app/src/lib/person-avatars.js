import {ready} from './performance.js'
import {t} from '../i18n/index.js'
import {avatarDisplayUrl,preparedAvatar} from './avatars.js'
import {itemMatchesPerson,itemPeople,itemPersonIds} from './people.js'
import {occurrenceState,taskPeople,managedTask} from './rewards-model.js'
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const statusKeys={open:'people_status.open',pending:'rewards.awaiting_approval',completed:'app.completed',approved:'rewards.approved',excused:'rewards.excused',rejected:'app.try_again',cancelled:'rewards.cancelled'}
export const personStatusLabel=status=>t(statusKeys[status]||statusKeys.open)
export const initials=name=>String(name||'').trim().split(/\s+/).filter(Boolean).slice(0,2).map(s=>[...s][0]).join('').toLocaleUpperCase()||'?'
export function personAvatar(person,{status,className=''}={}){
 const all=person.id==='Alle',name=all?t('common.all'):person.name||'?',photo=!all&&avatarDisplayUrl(person)
 const color=/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(person.color||'')?person.color:'#64748b'
 const label=name+(status?' – '+personStatusLabel(status):'')
 const groupClass=all?'is-group':''
 const badge={completed:'✓',approved:'✓',pending:'◷',excused:'–'}[status]
 return `<span class="person-bubble ${groupClass} ${e(className)}" ${status?`data-person-status="${e(status)}"`:''} style="--person-color:${color}" role="img" aria-label="${e(label)}" title="${e(label)}"><span class="person-bubble-face" aria-hidden="true"><span>${all?'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v2"/></svg>':e(initials(name))}</span>${photo?`<img src="${e(photo)}" alt="" width="64" height="64" ${preparedAvatar(photo)?'data-avatar-loaded="true"':''} loading="eager" decoding="async" referrerpolicy="no-referrer">`:''}</span>${badge?`<span class="person-status-badge" aria-hidden="true">${badge}</span>`:''}</span>`
}
export function personPicker(options,selected){
 return options.map(p=>`<label class="calendar-person-pill person-choice ${selected.includes(p.id)?'selected':''}"><input type="checkbox" name="people" value="${e(p.id)}" data-calendar-person-choice aria-label="${e(p.id==='Alle'?t('common.all'):p.name)}" ${selected.includes(p.id)?'checked':''}>${personAvatar(p)}<span class="person-choice-name">${e(p.id==='Alle'?t('common.all'):p.name)}</span><span class="person-choice-check" aria-hidden="true">✓</span></label>`).join('')
}
export function personStack(item,people,state,{limit=3}={}){
 const task=managedTask(item),all=!itemPersonIds(item,people).length&&itemPeople(item,people).includes('Alle')
 const targets=task?taskPeople(item,people,state):all?[{id:'Alle'}]:people.filter(p=>itemMatchesPerson(item,p.id,people))
 const shown=targets.slice(0,limit),remaining=targets.slice(limit)
 return `<span class="person-stack">${shown.map(p=>personAvatar(p,{status:task?occurrenceState(state,item,p.id)?.status||'open':undefined})).join('')}${remaining.length?`<span class="person-overflow" role="img" aria-label="${e(remaining.map(p=>p.name+(task?' – '+personStatusLabel(occurrenceState(state,item,p.id)?.status||'open'):'')).join(', '))}" title="${e(remaining.map(p=>p.name).join(', '))}">+${remaining.length}</span>`:''}</span>`
}
// Failed/expired pictures reveal the initials already underneath, without inline scripts.
export function installAvatarFallback(root){
 root.addEventListener('load',event=>{if(event.target.matches?.('.person-bubble-face img')){event.target.dataset.avatarLoaded='true';if(!preparedAvatar(event.target.src))void event.target.decode?.().then(()=>ready('avatar_image_ready')).catch(()=>{})}},true)
 root.addEventListener('error',event=>{if(event.target.matches?.('.person-bubble-face img'))event.target.remove()},true)
}
