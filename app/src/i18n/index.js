import i18next from 'i18next'
import da from './locales/da-DK.json' with {type:'json'}
import en from './locales/en-GB.json' with {type:'json'}
export const LOCALES=['da-DK','en-GB'],CURRENCIES=['DKK','EUR','SEK','NOK','GBP','USD']
export const DEFAULT_LOCALE='da-DK',TIME_ZONE='Europe/Copenhagen'
export function detectLocale(language){return !language||/^da(?:-|$)/i.test(language)?'da-DK':'en-GB'}
export const validLocale=value=>LOCALES.includes(value)
const read=(key,storage=globalThis.localStorage)=>{try{return storage?.getItem(key)}catch{return null}}
const write=(key,value,storage=globalThis.localStorage)=>{try{storage?.setItem(key,value)}catch{}}
const deviceKey='familiekalender.locale'
export const engine=i18next.createInstance()
engine.init({resources:{'da-DK':{translation:da},'en-GB':{translation:en}},lng:read(deviceKey)||detectLocale(globalThis.document?globalThis.navigator?.language:null),fallbackLng:DEFAULT_LOCALE,supportedLngs:LOCALES,load:'currentOnly',keySeparator:false,initAsync:false,interpolation:{escapeValue:true},returnNull:false,returnEmptyString:false})
export const locale=()=>engine.resolvedLanguage||DEFAULT_LOCALE
export function t(key,options){return engine.exists(key,options)?String(engine.t(key,options)):String(engine.t('common.unavailable'))}
export function setLocale(value){if(!validLocale(value))value=DEFAULT_LOCALE;engine.changeLanguage(value);if(globalThis.document)document.documentElement.lang=value;return value}
setLocale(locale())
let currencyCode='DKK'
export function setHouseholdFormat(household){currencyCode=CURRENCIES.includes(household?.currency_code)?household.currency_code:'DKK'}
export const householdCurrency=()=>currencyCode
export const dateFormatter=options=>new Intl.DateTimeFormat(locale(),{timeZone:TIME_ZONE,...options})
export const formatDate=(value,options={day:'numeric',month:'long',year:'numeric'})=>dateFormatter(options).format(value instanceof Date?value:new Date(value))
export const formatTime=value=>formatDate(value,{hour:'2-digit',minute:'2-digit'})
export const formatNumber=(value,options={})=>new Intl.NumberFormat(locale(),options).format(value)
export const formatMoney=(minor,currency=currencyCode)=>new Intl.NumberFormat(locale(),{style:'currency',currency,maximumFractionDigits:2,...(locale()==='da-DK'?{minimumFractionDigits:minor%100?2:0}:{})}).format(minor/100)
export const relativeTime=(value,unit)=>new Intl.RelativeTimeFormat(locale(),{numeric:'auto'}).format(value,unit)
export const weekdays=(width='short')=>Array.from({length:7},(_,i)=>formatDate(new Date(Date.UTC(2026,0,5+i,12)),{weekday:width}))
export function labels(keys){const result={};for(const [name,key]of Object.entries(keys))Object.defineProperty(result,name,{enumerable:true,get:()=>t(key)});return result}
export function errorText(error,fallback='common.unavailable'){
 const code=typeof error==='string'?error:error?.code||error?.error||''
 if(engine.exists('errors.'+code))return t('errors.'+code)
 if(['AuthRetryableFetchError','TypeError'].includes(error?.name))return t('errors.network')
 return t(fallback)
}
// Supabase/provider codes are translated; app validation errors are already localised at their source.
export function userError(error){return error?.code||error?.error||/^Auth/.test(error?.name||'')?errorText(error):error?.message||t('common.unavailable')}
export class LanguagePreference {
 constructor({client,storage=globalThis.localStorage,systemLocale=globalThis.navigator?.language,onChange=()=>{}}){Object.assign(this,{client,storage,systemLocale,onChange});this.userId=null;this.version=0}
 key(id=this.userId){return id?'familiekalender.locale.user:'+id:deviceKey}
 async attach(user,{offline=false}={}){const version=++this.version;this.userId=user?.id||null;if(user?.is_anonymous)return
  const stored=read(this.key(),this.storage)||read(deviceKey,this.storage);setLocale(validLocale(stored)?stored:detectLocale(this.systemLocale))
  if(!user||offline||globalThis.navigator?.onLine===false)return
  try{
   const pending=read(this.key()+':pending',this.storage)
   if(validLocale(pending)){await this.select(pending);return}
   const r=await this.client.from('profiles').select('preferred_locale').eq('id',user.id).maybeSingle().abortSignal(AbortSignal.timeout(4000))
   if(version!==this.version)return
   if(validLocale(r.data?.preferred_locale)){write(this.key(),r.data.preferred_locale,this.storage);setLocale(r.data.preferred_locale)}
  }catch{/* Device preference remains usable offline. */}
 }
 async select(value){if(!validLocale(value))return false;this.version++;const id=this.userId,key=this.key();write(key,value,this.storage);write(deviceKey,value,this.storage);setLocale(value);this.onChange()
  if(!id)return true
  write(key+':pending',value,this.storage)
  if(globalThis.navigator?.onLine===false)return false
  const save=async()=>{if(this.userId!==id)return false;try{const r=await this.client.from('profiles').upsert({id,preferred_locale:value},{onConflict:'id'});if(r.error)return false;if(read(key+':pending',this.storage)===value){try{this.storage.removeItem(key+':pending')}catch{}}return true}catch{return false}}
  this.saving=(this.saving||Promise.resolve()).then(save,save);return this.saving
 }
 wall(device,household){this.userId=null;this.version++;setHouseholdFormat(household);setLocale(device?.display_locale||household?.default_locale||DEFAULT_LOCALE)}
}
