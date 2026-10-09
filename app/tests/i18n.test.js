import test from 'node:test'
import assert from 'node:assert/strict'
import {engine,t,locale,setLocale,detectLocale,LanguagePreference,formatDate,formatTime,formatMoney,formatNumber,setHouseholdFormat,weekdays,errorText} from '../src/i18n/index.js'
import {routeLabels} from '../src/lib/product-ui.js'
import {displayTitle,taskSuggestions} from '../src/lib/calendar-semantics.js'
import {eventDayLabel} from '../src/lib/calendar-interval.js'
import {typeLabel,personRoleLabel} from '../src/i18n/domain-labels.js'
import {statusText,offeringPackages} from '../src/lib/subscription-model.js'
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}}
test('initial default Danish; automatic language selection supports international fallback',()=>{
 assert.equal(locale(),'da-DK');for(const value of [undefined,'','da','da-DK'])assert.equal(detectLocale(value),'da-DK')
 for(const value of ['en','en-US','en-GB','de-DE','sv-SE'])assert.equal(detectLocale(value),'en-GB')
})
test('manual preference persists, profile preference wins and wall display is independent',async()=>{
 const saved=storage(),changes=[],profile={preferred_locale:'da-DK'},client={from(){return {upsert:async value=>{Object.assign(profile,value);return {}},select(){return {eq(){return {maybeSingle(){return {abortSignal:async()=>({data:profile})}}}}}}}}}
 const p=new LanguagePreference({client,storage:saved,systemLocale:'en-US',onChange:()=>changes.push(locale())})
 await p.attach({id:'parent'});assert.equal(locale(),'da-DK');await p.select('en-GB');assert.equal(profile.preferred_locale,'en-GB');assert.deepEqual(changes,['en-GB'])
 const restarted=new LanguagePreference({client,storage:saved,systemLocale:'da-DK'});await restarted.attach({id:'parent'});assert.equal(locale(),'en-GB')
 restarted.wall({display_locale:null},{default_locale:'da-DK',currency_code:'EUR'});assert.equal(locale(),'da-DK');assert.match(formatMoney(10000),/€/)
 restarted.wall({display_locale:'en-GB'},{default_locale:'da-DK'});assert.equal(locale(),'en-GB');assert.equal(saved.getItem('familiekalender.locale.user:parent'),'en-GB')
 setLocale('da-DK');setHouseholdFormat(null)
})
test('live navigation, plural, type and profile labels do not translate user data',()=>{
 for(const [lang,nav,one,many]of [['da-DK','I dag','1 opgave','2 opgaver'],['en-GB','Today','1 task','2 tasks']]){
  setLocale(lang);assert.equal(routeLabels.today,nav);assert.equal(t('tasks.count',{count:1}),one);assert.equal(t('tasks.count',{count:2}),many)
  assert.equal(displayTitle({title:'Jakob saxofon',date:'2026-10-07',type:'Aktivitet'}),'Jakob saxofon');assert.equal(displayTitle({title:'Today',date:'2026-10-07',type:'Aktivitet'}),'Today')
 }
 assert.equal(typeLabel('Opgave'),'Task');assert.equal(personRoleLabel('barn'),'Child');assert.equal(taskSuggestions()[0],'Empty the dishwasher');setLocale('da-DK')
})
test('central dates, times, numbers and currency follow locale independently',()=>{
 const day=new Date('2026-10-07T12:30:00Z')
 for(const lang of ['da-DK','en-GB']){setLocale(lang);assert.equal(formatDate(day,{weekday:'long',day:'numeric',month:'long'}),new Intl.DateTimeFormat(lang,{timeZone:'Europe/Copenhagen',weekday:'long',day:'numeric',month:'long'}).format(day));assert.equal(formatTime(day),new Intl.DateTimeFormat(lang,{timeZone:'Europe/Copenhagen',hour:'2-digit',minute:'2-digit'}).format(day));assert.equal(formatNumber(1000.5),new Intl.NumberFormat(lang).format(1000.5));assert.equal(weekdays().length,7)
  for(const currency of ['DKK','EUR','SEK','NOK','GBP','USD']){setHouseholdFormat({currency_code:currency});assert.equal(formatMoney(10050),new Intl.NumberFormat(lang,{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(100.5))}
 }
 setLocale('da-DK');assert.match(formatMoney(10000,'DKK'),/^100\s+kr\.$/);setHouseholdFormat(null)
})
test('Danish fallback works and unknown keys are never shown',()=>{
 engine.addResource('da-DK','translation','test.only_danish','Dansk fallback');setLocale('en-GB');assert.equal(t('test.only_danish'),'Dansk fallback');assert.notEqual(t('not.a.real.key'),'not.a.real.key');delete engine.getResourceBundle('da-DK','translation')['test.only_danish'];setLocale('da-DK')
})
test('Auth, Edge and warning codes are safe, localised messages',()=>{
 setLocale('en-GB');assert.equal(errorText({code:'invalid_credentials'}),'Incorrect email or password.');assert.match(errorText({error:'VISION_NOT_CONFIGURED'}),/not configured/);assert.match(errorText('RECIPE_SCAN_PARTIAL'),/missing fields/);assert.doesNotMatch(errorText({code:'unknown',message:'private provider response'}),/private|unknown/);setLocale('da-DK')
})
test('English recurrence and multi-day labels operate on whole original events',()=>{
 setLocale('en-GB');assert.equal(t('calendar.scope.single'),'Only this occurrence');assert.equal(t('calendar.scope.future'),'This and following');assert.equal(t('calendar.scope.series'),'Whole series')
 const item={title:'Hotelophold',type:'Aktivitet',date:'2026-10-08',endDate:'2026-10-11',allDay:true};assert.match(eventDayLabel(item,'2026-10-09'),/Continues/);assert.match(eventDayLabel(item,'2026-10-11'),/Ends today/);assert.equal(item.title,'Hotelophold');setLocale('da-DK')
})
test('subscription switches language while provider-localised product name and price remain unchanged',()=>{
 const offerings={all:{default:{availablePackages:[{identifier:'month',packageType:'MONTHLY',product:{title:'Provider product title',priceString:'49,00 kr.',subscriptionPeriod:'P1M'}}]}}}
 setLocale('en-GB');assert.equal(statusText({status:'expired'}),'Subscription expired');const product=offeringPackages(offerings)[0];assert.equal(product.period,'Monthly');assert.equal(product.price,'49,00 kr.');assert.equal(product.title,'Provider product title');setLocale('da-DK');assert.equal(offeringPackages(offerings)[0].period,'Månedligt')
})
test('rapid manual selections serialize profile writes and persist the last selection',async()=>{
 const saved=storage(),writes=[];const p=new LanguagePreference({storage:saved,client:{from(){return {async upsert(value){await new Promise(r=>setTimeout(r,value.preferred_locale==='en-GB'?15:0));writes.push(value.preferred_locale);return {}}}}}})
 p.userId='u';await Promise.all([p.select('en-GB'),p.select('da-DK')]);assert.deepEqual(writes,['en-GB','da-DK']);assert.equal(saved.getItem(p.key()),'da-DK');assert.equal(saved.getItem(p.key()+':pending'),null);assert.equal(locale(),'da-DK')
})
