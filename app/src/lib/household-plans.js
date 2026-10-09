import {t} from '../i18n/index.js'
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
 if(!PLAN_TYPES[kind])throw Error((t("household_plans.unknown_plan_type")))
 const title=String(fields.title||'').trim(),note=String(fields.note||'').trim()
 if(!title||title.length>160)throw Error((t("household_plans.enter_a_name_with_no_more_than_160_characters")))
 if(note.length>4000)throw Error((t("household_plans.the_note_must_be_no_longer_than_4_000_characters")))
 if(existing&&existing.type!==PLAN_TYPES[kind])throw Error((t("household_plans.the_item_type_has_changed_open_it_again")))
 const date=kind==='meal'?String(fields.date||''):existing?.date||today
 if(!parseDate(date))throw Error((t("household_plans.choose_a_valid_date")))
 const time=kind==='meal'?String(fields.time||''):''
 if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error((t("household_plans.choose_a_valid_time")))
 return {...(existing?itemValues(existing):{}),title,note,date,time,type:PLAN_TYPES[kind],
  ...(kind==='meal'?{recipe:recipeValues(fields,existing?.data?.recipe||existing?.recipe||{}),...(fields.servings_override!==undefined?{servings_override:fields.servings_override?Number(fields.servings_override):null}:{})}:{}),
  done:kind==='shopping'?Boolean(existing?.done):false,people:['Alle'],person:'Alle',personIds:[],
  location:kind==='shopping'&&SHOPPING_CATEGORIES.includes(fields.location)?fields.location:'',durationMin:'',
  repeatWeekly:false,repeatYearly:false,weekdays:false,birthYear:'',seriesId:'',overrideOf:'',overrideBaseId:'',exceptions:[]}
}
export function shoppingCategory(title){
 const text=title.toLocaleLowerCase('da')
 if(/mælk|ost|smør|yoghurt|skyr|fløde|æg/.test(text))return (t("household_plans.dairy_eggs"))
 if(/tomat|kartof|guler|salat|agurk|banan|æble|løg|peber|broccoli|citron|frugt/.test(text))return (t("household_plans.fruit_vegetables"))
 if(/kylling|oksekød|fisk|laks|kød|bacon/.test(text))return (t("household_plans.meat_fish"))
 if(/frost|frossen|frosne|istern/.test(text))return (t("household_plans.frozen"))
 if(/sæbe|toilet|rengøring|opvask|affald/.test(text))return (t("household_plans.household"))
 if(/brød|pasta|ris|mel|havre|olie|kaffe|te\b/.test(text))return (t("household_plans.bread_groceries"))
 return 'Andet'
}
const canonical=text=>text.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('da')
export function ingredientDrafts(note,rows){
 const known=new Set(shoppingItems(rows).filter(row=>!row.done).map(row=>canonical(row.title)))
 const result=[]
 for(const line of (Array.isArray(note)?note:String(note||'').split(/\r?\n/))){
  const title=line.trim().replace(/^[-*•]\s*/,'').trim()
  if(!title||known.has(canonical(title)))continue
  if(title.length>160)throw Error((t("household_plans.each_ingredient_must_be_no_longer_than_160_characters")))
  known.add(canonical(title));result.push({title,note:'',location:shoppingCategory(title)})
 }
 if(result.length>100)throw Error((t("household_plans.add_no_more_than_100_ingredients_at_a_time")))
 return result
}
