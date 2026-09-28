import { addDays, parseDate, weekDates } from './calendar-dates.js'
import { milestonesForDates } from './milestones.js'
const aliases={durationMin:'duration_min',repeatWeekly:'repeat_weekly',repeatYearly:'repeat_yearly',repeatUntil:'repeat_until',birthYear:'birth_year',seriesId:'series_id',overrideOf:'override_of',overrideBaseId:'override_base_id',exceptions:'exception_dates'}
export function value(item,key) { const alias=aliases[key]; return item?.[key]??(alias?item?.[alias]:undefined)??item?.data?.[key]??(alias?item?.data?.[alias]:undefined)??'' }
export function imported(item) { return Boolean(item && (['aula','google','ics'].includes(String(value(item,'source')).toLowerCase()) || item.external_id || item.calendar_id || item.data?.importFeedId)) }
export function sourceLabel(item) { const source=String(value(item,'source')).toLowerCase(); return imported(item)?({aula:'Aula',google:'Google'}[source]||'ICS'):'' }
export function birthday(item) { return ['Fødselsdag','FÃ¸dselsdag'].includes(value(item,'type')) || Boolean(value(item,'birthYear')) }
export function displayTitle(item) {
  const title=value(item,'title')||'(uden titel)', year=Number(value(item,'birthYear'))
  const age=Number(value(item,'date').slice(0,4))-year
  return birthday(item)&&year&&age>0 ? title+' bliver '+age+' år' : title
}
export function weekly(item) { return !imported(item) && Boolean(value(item,'repeatWeekly')) && !value(item,'overrideOf') }
export function repeatContext(item) { return !imported(item) && Boolean(weekly(item)||value(item,'overrideOf')||item?.isRepeatOccurrence) }
export function exceptions(item) { const raw=value(item,'exceptions'); return [...new Set((Array.isArray(raw)?raw:String(raw).split(/[;,]/)).filter(date=>parseDate(date)))] }
export function seriesId(item) { return String(value(item,'seriesId')||item.id) }
export function occurrenceDate(item) { return item.occurrenceDate || value(item,'originalDate') || value(item,'date') }
export function baseFor(rows,item) {
  const id=item.baseId||value(item,'overrideBaseId')||value(item,'overrideOf')
  return rows.find(row=>row.id===id) || rows.find(row=>weekly(row)&&seriesId(row)===(value(item,'overrideOf')||seriesId(item))) || rows.find(row=>row.id===item.id) || null
}
export function seriesRows(rows,base) {
  return rows.filter(row=>row.id===base.id || value(row,'overrideBaseId')===base.id || value(row,'overrideOf')===seriesId(base))
}
export function itemValues(item) {
  return {...(item.data||{}),...Object.fromEntries(['title','date','time','person','type','note','done','location','durationMin','repeatWeekly','repeatYearly','repeatUntil','birthYear','seriesId','overrideOf','overrideBaseId'].map(key=>[key,value(item,key)])),
    personIds:item.person_ids?.length?item.person_ids:(item.data?.personIds||[]), people:item.data?.people||[item.person||'Alle'], exceptions:exceptions(item)}
}
export function materialize(rows,dates,{milestones=true}={}) {
  const visible=new Set(dates), result=[]
  for (const item of rows) {
    const original=value(item,'date')
    if (!parseDate(original)) continue
    if (weekly(item)) {
      const related=seriesRows(rows,item).filter(row=>row.id!==item.id), excluded=new Set([...exceptions(item),...related.map(occurrenceDate)])
      for (const date of dates) {
        if (date<original || (value(item,'repeatUntil') && date>value(item,'repeatUntil')) || parseDate(date).getDay()!==parseDate(original).getDay() || excluded.has(date)) continue
        // Legacy base done belongs only to its original day, never to the entire series.
        result.push({...item,id:'repeat|'+item.id+'|'+date,baseId:item.id,date,occurrenceDate:date,isRepeatOccurrence:true,done:date===original?Boolean(value(item,'done')):false})
      }
    } else if (!imported(item) && birthday(item) && !value(item,'overrideOf')) {
      for (const date of dates) {
        const year=Number(date.slice(0,4)), monthDay=original.slice(5)
        let expected=year+'-'+monthDay
        if (monthDay==='02-29'&&!parseDate(expected)) expected=year+'-02-28'
        const firstYear=Number(value(item,'birthYear'))||Number(original.slice(0,4))
        if (date!==expected || year<firstYear) continue
        result.push({...item,id:'yearly|'+item.id+'|'+date,baseId:item.id,date,occurrenceDate:date,isYearlyOccurrence:true})
      }
    } else if (visible.has(original)) {
      if (!value(item,'overrideOf') && exceptions(item).includes(original)) continue
      result.push({...item,...(value(item,'overrideOf')?{baseId:baseFor(rows,item)?.id,occurrenceDate:occurrenceDate(item)}:{})})
    }
  }
  if (milestones) result.push(...milestonesForDates(dates,result))
  return result.sort((a,b)=>value(a,'date').localeCompare(value(b,'date'))||String(value(a,'time')).localeCompare(String(value(b,'time')))||String(a.id).localeCompare(String(b.id)))
}
function planner(rows) {
  const writes=new Map(), deletes=new Set(), expected=new Map()
  const touch=item=>{if(item) expected.set(item.id,{id:item.id,updated_at:item.updated_at})}
  return {
    put(id,values){ const old=rows.find(row=>row.id===id); touch(old); writes.set(id,{id,values:{...(old?itemValues(old):{}),...writes.get(id)?.values,...values}}); deletes.delete(id) },
    remove(row){touch(row);deletes.add(row.id);writes.delete(row.id)},
    touch, finish(){return {upserts:[...writes.values()],deleteIds:[...deletes],expected:[...expected.values()]}}
  }
}
export function planCreate(values,uuid=()=>crypto.randomUUID()) {
  const p=planner([]), dates=values.weekdays?weekDates(values.date).slice(0,5):[values.date]
  for (const date of dates) { const id=uuid(); p.put(id,{...values,date,weekdays:false,seriesId:values.repeatWeekly?id:'',exceptions:[],overrideOf:'',overrideBaseId:''}) }
  return p.finish()
}
function putOverride(p,rows,base,occurrence,values,uuid) {
  const original=occurrenceDate(occurrence)
  const old=seriesRows(rows,base).find(row=>row.id!==base.id&&occurrenceDate(row)===original)
  p.put(base.id,{exceptions:[...new Set([...exceptions(base),original])]})
  p.put(old?.id||uuid(),{...itemValues(base),...(old?itemValues(old):{}),...values,repeatWeekly:false,repeatYearly:false,
    repeatUntil:'',exceptions:[],weekdays:false,seriesId:seriesId(base),overrideOf:seriesId(base),overrideBaseId:base.id,originalDate:original})
}
export function planEdit(rows,item,values,scope='one',uuid=()=>crypto.randomUUID()) {
  if (imported(item)||item.isVirtualMilestone) throw new Error('Aftalen styres af sin kilde.')
  const p=planner(rows), base=baseFor(rows,item)
  if (!base) throw new Error('Aftalen findes ikke længere. Luk og åbn kalenderen igen.')
  if (!repeatContext(item)) {
    // A yearly virtual occurrence edits its base, retaining Feb 29 and the original year by default.
    p.put(base.id,values); return p.finish()
  }
  const original=occurrenceDate(item), related=seriesRows(rows,base)
  related.forEach(p.touch)
  if (scope==='one') {
    putOverride(p,rows,base,item,values,uuid)
  } else if (scope==='future') {
    const nextId=uuid()
    p.put(base.id,{repeatUntil:addDays(original,-1),exceptions:exceptions(base).filter(date=>date<original)})
    const next={...itemValues(base),...values,date:original,done:false,weekdays:false,seriesId:nextId,overrideOf:'',overrideBaseId:'',
      exceptions:exceptions(base).filter(date=>date>=original),repeatUntil:value(base,'repeatUntil'),previousSeriesId:seriesId(base)}
    p.put(nextId,next)
    // Reparent future customisations/completions; never discard their metadata or moved dates.
    for (const row of related.filter(row=>row.id!==base.id&&occurrenceDate(row)>=original)) {
      const selected=occurrenceDate(row)===original
      p.put(row.id,{...(selected?{...values,date:value(row,'date'),repeatWeekly:false,repeatYearly:false,repeatUntil:'',exceptions:[],weekdays:false}:{}),
        seriesId:nextId,overrideOf:nextId,overrideBaseId:nextId})
    }
    if (Boolean(values.done)!==Boolean(value(item,'done')) || (item.id.startsWith('repeat|') && Boolean(value(item,'done')))) {
      const existing=related.find(row=>row.id!==base.id&&occurrenceDate(row)===original)
      p.put(existing?.id||uuid(),{...itemValues(item),...values,date:value(item,'date'),repeatWeekly:false,repeatYearly:false,
        repeatUntil:'',exceptions:[],weekdays:false,seriesId:nextId,overrideOf:nextId,overrideBaseId:nextId,originalDate:original})
      p.put(nextId,{...next,exceptions:[...new Set([...next.exceptions,original])]})
    }
  } else if (scope==='series') {
    const next={...itemValues(base),...values,date:value(base,'date'),done:Boolean(value(base,'done')),
      seriesId:seriesId(base),exceptions:exceptions(base),repeatUntil:value(base,'repeatUntil'),overrideOf:'',overrideBaseId:''}
    p.put(base.id,next)
    if (Boolean(values.done)!==Boolean(value(item,'done'))) {
      // A done checkbox always refers to the selected occurrence, even with whole-series scope.
      putOverride(p,rows,{...base,data:{...base.data,...next}},item,{...values,date:value(item,'date')},uuid)
    }
  } else throw new Error('Ugyldigt serievalg')
  return p.finish()
}
export function planDelete(rows,item,scope='one') {
  if (imported(item)||item.isVirtualMilestone) throw new Error('Aftalen styres af sin kilde.')
  const p=planner(rows), base=baseFor(rows,item)
  if (!base) throw new Error('Aftalen findes ikke længere.')
  if (!repeatContext(item)) {p.remove(base);return p.finish()}
  const related=seriesRows(rows,base), original=occurrenceDate(item)
  related.forEach(p.touch)
  if (scope==='series') related.forEach(p.remove)
  else if (scope==='future') {
    p.put(base.id,{repeatUntil:addDays(original,-1),exceptions:exceptions(base).filter(date=>date<original)})
    related.filter(row=>row.id!==base.id&&occurrenceDate(row)>=original).forEach(p.remove)
  } else if (scope==='one') {
    p.put(base.id,{exceptions:[...new Set([...exceptions(base),original])]})
    related.filter(row=>row.id!==base.id&&occurrenceDate(row)===original).forEach(p.remove)
  } else throw new Error('Ugyldigt serievalg')
  return p.finish()
}
export const taskSuggestions=['Tøm opvaskemaskine','Lektier','Tøm vaskemaskine','Rydde op på værelset','Handle ind','Dæk bordet','Tøm tasker']
