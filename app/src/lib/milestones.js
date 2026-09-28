import { addDays, dateIso, parseDate } from './calendar-dates.js'
// Product traditions from legacy FIXED/EASTER/RELATIVE_MILESTONES, not an official holiday list.
export const fixedMilestones = [
 ['nytarsdag','Nytårsdag',1,1], ['margrethe','Dronning Margrethes fødselsdag',4,16,['Dronningens fødselsdag']],
 ['arbejdernes-kampdag','Arbejdernes kampdag',5,1], ['grundlovsdag','Grundlovsdag',6,5],
 ['sankthans','Sankt Hans aften',6,23], ['mortensaften','Mortens aften',11,10],
 ['juleaften','Juleaften',12,24,['Juleaftensdag']], ['juledag','1. juledag',12,25,['Juledag']],
 ['anden-juledag','2. juledag',12,26,['Anden juledag']], ['nytarsaften','Nytårsaften',12,31],
]
export const easterMilestones = [
 ['fastelavn','Fastelavn',-49], ['palmesondag','Palmesøndag',-7], ['skaertorsdag','Skærtorsdag',-3],
 ['langfredag','Langfredag',-2], ['paaskedag','Påskedag',0], ['anden-paaskedag','2. påskedag',1,['Anden påskedag']],
 ['store-bededag','Store bededag (traditionel)',26,['Store bededag']],
 ['himmelfart','Kristi himmelfartsdag',39,['Kr. Himmelfartsdag']],
 ['pinsedag','Pinsedag',49], ['anden-pinsedag','2. pinsedag',50,['Anden pinsedag']],
]
export const relativeMilestones=[['mors-dag','Mors dag',5,0,2],['allehelgensdag','Allehelgensdag',11,0,1]]
export function easterDate(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,
    f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,
    i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),
    month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1
  return dateIso(new Date(year,month-1,day,12))
}
const normalized=title=>String(title||'').toLocaleLowerCase('da').replace(/[^\p{L}\p{N}]/gu,'')
export function milestonesForDates(dates, existing=[]) {
  const years=[...new Set(dates.map(date=>Number(date.slice(0,4))))], visible=new Set(dates), result=[]
  function add(id,title,date,aliases=[]) {
    if (!visible.has(date) || existing.some(item=>item.date===date && [title,...aliases].some(alias=>normalized(item.title)===normalized(alias)) )) return
    result.push({id:'milestone|'+id+'|'+date,title,date,type:'Mærkedag',person:'Alle',data:{people:['Alle']},isVirtualMilestone:true})
  }
  for (const year of years) {
    for (const [id,title,month,day,aliases] of fixedMilestones) add(id,title,dateIso(new Date(year,month-1,day,12)),aliases)
    for (const [id,title,offset,aliases] of easterMilestones) add(id,title,addDays(easterDate(year),offset),aliases)
    for (const [id,title,month,weekday,nth] of relativeMilestones) {
      const first=dateIso(new Date(year,month-1,1,12)), day=(weekday-parseDate(first).getDay()+7)%7+7*(nth-1)
      add(id,title,addDays(first,day))
    }
  }
  return result
}
