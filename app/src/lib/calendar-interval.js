import {t,dateFormatter} from '../i18n/index.js'
import {addDays, parseDate} from './calendar-dates.js'

// Stored all-day ends are inclusive. Timed ends are exclusive instants in the
// event's civil timezone; midnight therefore does not occupy the following day.
const field=(item,key,alias=key)=>item?.[key]??item?.[alias]??item?.data?.[key]??item?.data?.[alias]
const dayNumber=date=>Date.parse(date+'T12:00:00Z')/86400000
export const daysBetween=(start,end)=>Math.round(dayNumber(end)-dayNumber(start))
export const supportsInterval=item=>!['Opgave','Madplan','Indkøb','Fødselsdag'].includes(field(item,'type'))&&!item?.isVirtualMilestone
const wallFormatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
function wallParts(instant){const p=Object.fromEntries(wallFormatter.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));return {date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute}}
function civilInstant(date,time){
 const wanted=Date.parse(date+'T'+(time||'00:00')+':00Z');let instant=wanted
 for(let i=0;i<3;i++){const p=wallParts(instant),delta=wanted-Date.parse(p.date+'T'+p.time+':00Z');if(!delta)break;instant+=delta}
 return instant
}
export function eventInterval(item){
 const startDate=field(item,'date')||'',startTime=String(field(item,'time')||'').slice(0,5).replace('.',':')
 const allDay=field(item,'allDay','all_day')===''||field(item,'allDay','all_day')==null?!startTime:Boolean(field(item,'allDay','all_day'))
 let endDate=field(item,'endDate','end_date')||'',endTime=String(field(item,'endTime','end_time')||'').slice(0,5)
 if(!parseDate(startDate))return {startDate,endDate:startDate,lastDate:startDate,startTime,endTime,allDay,multiDay:false}
 if(!supportsInterval(item))return {startDate,endDate:startDate,lastDate:startDate,startTime,endTime:'',allDay,multiDay:false}
 if(!endDate){
  const duration=Math.max(0,Number(field(item,'durationMin','duration_min'))||0)
  if(allDay){endDate=addDays(startDate,Math.max(0,Math.ceil(duration/1440)-1));endTime=''}
  else if(duration){const end=wallParts(civilInstant(startDate,startTime)+duration*60000);endDate=end.date;endTime=end.time}
  else endDate=startDate
 }
 let lastDate=!allDay&&endTime==='00:00'&&endDate>startDate?addDays(endDate,-1):endDate
 if(lastDate<startDate)lastDate=startDate
 return {startDate,startTime:allDay?'':startTime,endDate,endTime:allDay?'':endTime,lastDate,allDay,multiDay:lastDate>startDate}
}
export function validateEventInterval(values){
 if(!supportsInterval(values))return ''
 if(!parseDate(values.date)||!parseDate(values.endDate||values.date))return (t("calendar_interval.choose_valid_start_and_end_dates"))
 if(values.endDate<values.date)return (t("calendar_interval.the_end_date_must_be_on_or_after_the_start_date"))
 if(!values.allDay&&(values.endDate||values.date)===values.date&&values.time&&values.endTime&&values.endTime<values.time)return (t("calendar_interval.the_end_time_must_be_at_or_after_the_start_time"))
 return ''
}
export function eventOverlapsDate(item,date){const i=eventInterval(item);return date>=i.startDate&&date<=i.lastDate}
export function shiftInterval(item,date){const i=eventInterval(item);return {date,...(supportsInterval(item)?{endDate:addDays(i.endDate,daysBetween(i.startDate,date)),endTime:i.endTime,allDay:i.allDay}:{})}}
const shortDate=date=>dateFormatter({weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(parseDate(date))
export function eventDisplayRange(item){const i=eventInterval(item);if(!parseDate(i.startDate))return '';return shortDate(i.startDate)+(i.startTime?(" "+t("calendar_interval.at")+" ")+i.startTime:'')+(i.endDate!==i.startDate?' – '+shortDate(i.endDate)+(i.endTime?(" "+t("calendar_interval.at")+" ")+i.endTime:''):i.endTime?'–'+i.endTime:'')+(i.allDay?(" "+t("calendar_interval.all_day")):'')}
export function eventDayState(item,date){
 const i=eventInterval(item)
 return !i.multiDay?'SINGLE':date===i.startDate?'START':date===i.lastDate?'END':'MIDDLE'
}
export function eventDayLabel(item,date,{compact=false}={}){
 const i=eventInterval(item),state=eventDayState(item,date)
 if(state==='SINGLE')return i.startTime||(t("calendar.all_day"))
 const endDay=dateFormatter({weekday:compact?'short':'long'}).format(parseDate(i.lastDate))
 if(state==='END')return i.endTime?(t("calendar_interval.ends")+" ")+i.endTime:(t("calendar_interval.ends_today"))
 if(state==='START')return (i.startTime?i.startTime:compact?(t("calendar_interval.starts")):(t("calendar_interval.starts_today")))+' · '+(i.startTime&&!compact?(t("calendar_interval.continues_until")+" "):(t("calendar_interval.until")+" "))+endDay
 return (compact?(daysBetween(i.startDate,date)+1)+'/'+(daysBetween(i.startDate,i.lastDate)+1):(t("calendar_interval.continues")))+(" "+t("calendar_interval.until__til")+" ")+endDay
}
export function eventDateRange(item){
 const i=eventInterval(item);if(!parseDate(i.startDate))return ''
 const format=dateFormatter({day:'numeric',month:'short',...(i.startDate.slice(0,4)!==i.lastDate.slice(0,4)?{year:'numeric'}:{})})
 return format.formatRange(parseDate(i.startDate),parseDate(i.lastDate))
}
