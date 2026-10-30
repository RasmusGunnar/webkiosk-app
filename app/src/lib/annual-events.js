import {t} from '../i18n/index.js'
import {itemPeople,selectPeople} from './people.js'
const field=(item,key)=>item?.[key]??item?.data?.[key]??''
export const isAnnualType=type=>['Fødselsdag','Mærkedag'].includes(type)
export function birthdayPerson(item,people){
 if(!item)return ''
 return itemPeople(item,people).filter(name=>name!=='Alle').join(', ')||field(item,'title')
}
export function annualEventValues(fields,existing,people){
 if(!isAnnualType(fields.type))return fields
 const result={...fields,time:'',endDate:null,endTime:null,allDay:true,done:false,
  repeatWeekly:false,repeatYearly:true,weekdays:false,
  // Retain legacy metadata that is no longer exposed by this editor.
  location:existing?field(existing,'location'):'',durationMin:existing?field(existing,'durationMin')||existing.duration_min||null:null}
 if(fields.type==='Fødselsdag'){
  const name=String(fields.birthdayPerson||'').trim(),year=String(fields.birthYear||'').trim()
  if(!name||name.length>1000)throw Error(t('annual.person_required'))
  if(year&&(!/^\d{1,4}$/.test(year)||Number(year)<1))throw Error(t('annual.invalid_birth_year'))
  const unchanged=existing&&name===birthdayPerson(existing,people)
  const selection=unchanged?selectPeople(existing.person_ids?.length?existing.person_ids:existing.data?.personIds?.length?existing.data.personIds:existing.data?.people||[existing.person],people):selectPeople([name],people)
  Object.assign(result,selection,{person:selection.people[0],title:unchanged?field(existing,'title'):name,birthYear:year})
 }
 delete result.birthdayPerson
 return result
}
