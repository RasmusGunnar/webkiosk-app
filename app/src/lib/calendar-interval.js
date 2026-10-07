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
 if(!parseDate(values.date)||!parseDate(values.endDate||values.date))return 'Vælg en gyldig start- og slutdato.'
 if(values.endDate<values.date)return 'Slutdatoen skal være på eller efter startdatoen.'
 if(!values.allDay&&(values.endDate||values.date)===values.date&&values.time&&values.endTime&&values.endTime<values.time)return 'Sluttiden skal være på eller efter starttiden.'
 return ''
}
export function eventOverlapsDate(item,date){const i=eventInterval(item);return date>=i.startDate&&date<=i.lastDate}
export function shiftInterval(item,date){const i=eventInterval(item);return {date,...(supportsInterval(item)?{endDate:addDays(i.endDate,daysBetween(i.startDate,date)),endTime:i.endTime,allDay:i.allDay}:{})}}
const shortDate=date=>new Intl.DateTimeFormat('da-DK',{weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(parseDate(date))
export function eventDisplayRange(item){const i=eventInterval(item);if(!parseDate(i.startDate))return '';return shortDate(i.startDate)+(i.startTime?' kl. '+i.startTime:'')+(i.endDate!==i.startDate?' – '+shortDate(i.endDate)+(i.endTime?' kl. '+i.endTime:''):i.endTime?'–'+i.endTime:'')+(i.allDay?' · Heldag':'')}
export function eventDayState(item,date){
 const i=eventInterval(item)
 return !i.multiDay?'SINGLE':date===i.startDate?'START':date===i.lastDate?'END':'MIDDLE'
}
export function eventDayLabel(item,date,{compact=false}={}){
 const i=eventInterval(item),state=eventDayState(item,date)
 if(state==='SINGLE')return i.startTime||'Heldag'
 const endDay=new Intl.DateTimeFormat('da-DK',{weekday:compact?'short':'long'}).format(parseDate(i.lastDate))
 if(state==='END')return i.endTime?'Slutter '+i.endTime:'Slutter i dag'
 if(state==='START')return (i.startTime?i.startTime:compact?'Starter':'Starter i dag')+' · '+(i.startTime&&!compact?'fortsætter til ':'til ')+endDay
 return (compact?(daysBetween(i.startDate,date)+1)+'/'+(daysBetween(i.startDate,i.lastDate)+1):'Fortsætter')+' · til '+endDay
}
export function eventDateRange(item){
 const i=eventInterval(item);if(!parseDate(i.startDate))return ''
 const format=new Intl.DateTimeFormat('da-DK',{day:'numeric',month:'short',...(i.startDate.slice(0,4)!==i.lastDate.slice(0,4)?{year:'numeric'}:{})})
 return format.formatRange(parseDate(i.startDate),parseDate(i.lastDate))
}
