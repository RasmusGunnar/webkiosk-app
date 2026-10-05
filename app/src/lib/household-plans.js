import {recipeValues} from './recipe.js'
import { dateIso, parseDate } from './calendar-dates.js'
import { itemValues } from './calendar-semantics.js'
export const PLAN_TYPES={meal:'Madplan',shopping:'Indkøb'}
export const SHOPPING_CATEGORIES=['Frugt & grønt','Mejeri & æg','Kød & fisk','Brød & kolonial','Frost','Hjemmet','Andet']
export const isHouseholdPlan=row=>Object.values(PLAN_TYPES).includes(row?.type)
export const calendarOnly=rows=>rows.filter(row=>!isHouseholdPlan(row))
export const mealsOn=(rows,date)=>rows.filter(row=>row.type===PLAN_TYPES.meal&&row.date===date).sort((a,b)=>(a.time||'').localeCompare(b.time||'')||a.title.localeCompare(b.title,'da'))
export const shoppingItems=rows=>rows.filter(row=>row.type===PLAN_TYPES.shopping).sort((a,b)=>a.title.localeCompare(b.title,'da'))
export function planValues(kind,fields,existing=null,today=dateIso(new Date())){
 if(!PLAN_TYPES[kind])throw Error('Ukendt plantype.')
 const title=String(fields.title||'').trim(),note=String(fields.note||'').trim()
 if(!title||title.length>160)throw Error('Skriv et navn på højst 160 tegn.')
 if(note.length>4000)throw Error('Noten må højst være 4.000 tegn.')
 if(existing&&existing.type!==PLAN_TYPES[kind])throw Error('Postens type er ændret. Åbn den igen.')
 const date=kind==='meal'?String(fields.date||''):existing?.date||today
 if(!parseDate(date))throw Error('Vælg en gyldig dato.')
 const time=kind==='meal'?String(fields.time||''):''
 if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Vælg et gyldigt klokkeslæt.')
 return {...(existing?itemValues(existing):{}),title,note,date,time,type:PLAN_TYPES[kind],
  ...(kind==='meal'?{recipe:recipeValues(fields,existing?.data?.recipe||existing?.recipe||{}),...(fields.servings_override!==undefined?{servings_override:fields.servings_override?Number(fields.servings_override):null}:{})}:{}),
  done:kind==='shopping'?Boolean(existing?.done):false,people:['Alle'],person:'Alle',personIds:[],
  location:kind==='shopping'&&SHOPPING_CATEGORIES.includes(fields.location)?fields.location:'',durationMin:'',
  repeatWeekly:false,repeatYearly:false,weekdays:false,birthYear:'',seriesId:'',overrideOf:'',overrideBaseId:'',exceptions:[]}
}
export function shoppingCategory(title){
 const text=title.toLocaleLowerCase('da')
 if(/mælk|ost|smør|yoghurt|skyr|fløde|æg/.test(text))return 'Mejeri & æg'
 if(/tomat|kartof|guler|salat|agurk|banan|æble|løg|peber|broccoli|citron|frugt/.test(text))return 'Frugt & grønt'
 if(/kylling|oksekød|fisk|laks|kød|bacon/.test(text))return 'Kød & fisk'
 if(/frost|frossen|frosne|istern/.test(text))return 'Frost'
 if(/sæbe|toilet|rengøring|opvask|affald/.test(text))return 'Hjemmet'
 if(/brød|pasta|ris|mel|havre|olie|kaffe|te\b/.test(text))return 'Brød & kolonial'
 return 'Andet'
}
const canonical=text=>text.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('da')
export function ingredientDrafts(note,rows){
 const known=new Set(shoppingItems(rows).filter(row=>!row.done).map(row=>canonical(row.title)))
 const result=[]
 for(const line of (Array.isArray(note)?note:String(note||'').split(/\r?\n/))){
  const title=line.trim().replace(/^[-*•]\s*/,'').trim()
  if(!title||known.has(canonical(title)))continue
  if(title.length>160)throw Error('Hver ingrediens må højst være 160 tegn.')
  known.add(canonical(title));result.push({title,note:'',location:shoppingCategory(title)})
 }
 if(result.length>100)throw Error('Tilføj højst 100 ingredienser ad gangen.')
 return result
}
