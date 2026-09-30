import {managedTask, isApproved} from './rewards-model.js'
import { materialize, occurrenceDate, value } from './calendar-semantics.js'
import { weekDates, dateIso, isoWeek } from './calendar-dates.js'
import { itemMatchesPerson } from './people.js'
export function taskEmoji(title) {
  const text=String(title||'').toLocaleLowerCase('da')
  if(/skole|lektie|taske/.test(text))return '🎒'
  if(/opvask|bord/.test(text))return '🍽️'
  if(/rydde? op|værelse/.test(text))return '🧹'
  if(/affald|skrald/.test(text))return '🗑️'
  if(/mad/.test(text))return '🥪'
  return '✅'
}
export function rewardEnabled(person) {return person.reward_enabled??['child','barn'].includes(person.role)}
export function taskOccurrenceKey(item) {return (value(item,'overrideBaseId')||value(item,'overrideOf')||item.baseId||item.id)+'|'+occurrenceDate(item)}
export function weeklyProgress(rows,people,cursor,today=dateIso(new Date()),rewards=null) {
  const completed=materialize(rows,weekDates(cursor),{milestones:false}).filter(item=>item.type==='Opgave'&&!managedTask(item)&&item.done&&item.date<=today)
  return people.filter(rewardEnabled).map(person=>{
    const unique=new Map()
    for(const item of completed)if(itemMatchesPerson(item,person.id,people))unique.set(taskOccurrenceKey(item),item)
    for(const s of rewards?.occurrences||[])if(s.person_id===person.id&&isApproved(s)&&s.due_date>=weekDates(cursor)[0]&&s.due_date<=weekDates(cursor).at(-1)&&s.due_date<=today)unique.set(s.origin_id+'|'+s.occurrence_date,{id:s.id,title:s.title,date:s.due_date})
    const tasks=[...unique.values()].sort((a,b)=>b.date.localeCompare(a.date))
    return {personId:person.id,count:tasks.length,tasks:tasks.slice(0,6),...isoWeek(cursor)}
  })
}
