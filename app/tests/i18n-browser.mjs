import {chromium,expect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {routeTo,openSettings} from './browser-actions.mjs'
import {dateIso,weekDates} from '../src/lib/calendar-dates.js'
import {calendarPayload} from '../src/lib/calendar.js'
const local=localSupabase(),base='http://127.0.0.1:5185',out='supabase/.temp/i18n10',options={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,options),client=createClient(local.API_URL,local.ANON_KEY,options)
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data},checks=[],shots=[],errors=[],users=[];mkdirSync(out,{recursive:true})
const pass=name=>{checks.push(name);console.log('PASS '+name)}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const context=await browser.newContext({locale:'en-GB',timezoneId:'Europe/Copenhagen',viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(15000)
const watch=p=>{p.on('pageerror',e=>errors.push(e.message));p.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())};watch(page)
const shot=async(name,p=page)=>{await p.evaluate(()=>scrollTo(0,0));await expect.poll(()=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await p.screenshot({path:out+'/'+name+'.png',style:'.native-review-banner{display:none}'});shots.push(name)}
const close=async()=>{for(const selector of ['[data-native-close]','#settings-modal-close','[data-recipe-close]','[data-reward-close]','#calendar-modal-close']){const b=page.locator(selector);if(await b.count())await b.first().click()}}
let hid,uid,wallPage
try{
 const email='i18n-'+randomUUID()+'@example.test',password=randomUUID()+'Aa!1';uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id;users.push(uid);await must(client.auth.signInWithPassword({email,password}))
 hid=await must(client.rpc('create_household',{p_name:'Familien Birk · lokalt review'}));const hh=await must(client.from('households').select('*').eq('id',hid).single());expect(hh.default_locale).toBe('da-DK');expect(hh.currency_code).toBe('DKK');pass('Existing/new household default Danish + DKK')
 const people=await must(client.from('household_people').insert([{name:'Mor',role:'adult',color:'#ad8a72'},{name:'Far',role:'adult',color:'#708c90'},{name:'Freja',role:'child',color:'#959769',reward_enabled:true},{name:'Emil',role:'child',color:'#a383a9',reward_enabled:true}].map(p=>({...p,household_id:hid}))).select())
 const today=dateIso(new Date()),dates=weekDates(today),rows=await must(client.from('calendar_items').insert([
  {title:'Hotelophold',type:'Aktivitet',date:dates[3],endDate:dates[6],allDay:true,repeatWeekly:true},
  {title:'Jakob saxofon',type:'Fritidsinteresse',date:today,time:'16:30',personIds:[people[3].id],location:'Musikhuset'},
  {title:'Pasta med grøntsager',type:'Madplan',date:today},
  {title:'Tøm opvaskemaskinen',type:'Opgave',date:today,personIds:[people[2].id]},
  {title:'Mælk',type:'Indkøb',date:today}
 ].map(i=>({...calendarPayload({time:'',person:'Alle',note:'Familiens egen note',done:false,...i},people),household_id:hid,created_by:uid}))).select())
 await must(client.rpc('reward_action',{p_request_id:randomUUID(),p_household_id:hid,p_action:'allowance_save',p_payload:{person_id:people[2].id,cadence:'week',amount_minor:5000,start_today:true,duties:[{title:'Pak skoletasken',schedule:'daily',approval:false}]}}))
 await page.goto(base);await expect(page.locator('[data-device-choice=personal]')).toContainText('Personal');await page.locator('[data-device-choice=personal]').click();await expect(page.locator('html')).toHaveAttribute('lang','en-GB');await shot('24-en-auth')
 await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click();await expect(page.locator('.product-nav')).toBeVisible();pass('English system locale and real local login')
 const before=await must(client.from('calendar_items').select('id,title,type,note:data').eq('household_id',hid).order('id'))
 for(const [lang,prefix]of [['da-DK','da'],['en-GB','en']]){
  await openSettings(page,'account');await page.locator('[data-personal-locale]').selectOption(lang);await expect(page.locator('html')).toHaveAttribute('lang',lang);await shot(prefix+'-language-selector');await close()
  await expect.poll(async()=>(await must(client.from('profiles').select('preferred_locale').eq('id',uid).single())).preferred_locale).toBe(lang)
  for(const route of ['today','calendar','meals','tasks','family']){await routeTo(page,route);await shot(prefix+'-'+route)}
  await page.locator('[data-reward-config="'+people[2].id+'"]').click();await expect(page.locator('#allowance-form')).toBeVisible();await shot(prefix+'-allowance');await close()
  await page.locator('[data-native-page=subscription]').click();await expect(page.locator('.native-subscription-hero')).toBeVisible();await shot(prefix+'-subscription');await close()
  await page.locator('[data-native-page=devices]').click();await page.locator('#native-add-wall').click();await expect(page.locator('.native-pair-code')).toBeVisible();await shot(prefix+'-device-pairing')
  if(!wallPage){const code=await page.locator('.native-pair-code').innerText(),wall=await browser.newContext({locale:'en-GB',viewport:{width:1280,height:800},serviceWorkers:'block'});wallPage=await wall.newPage();watch(wallPage);await wallPage.goto(base);await wallPage.locator('[data-device-choice=wall]').click();await wallPage.locator('#wall-code').fill(code);await wallPage.locator('#wall-pair-form button').click();await wallPage.locator('#wall-name').fill('Køkken');await wallPage.locator('#wall-name-form button').click();await expect(wallPage.locator('.product-nav')).toBeVisible();await expect(wallPage.locator('html')).toHaveAttribute('lang','da-DK');pass('English browser wall follows Danish family default, independent of personal locale')}
  await close();await page.locator('[data-native-page=devices]').click();await page.locator('[data-display-locale]').selectOption(lang==='da-DK'?'':lang);await expect(wallPage.locator('html')).toHaveAttribute('lang',lang,{timeout:25000});await shot(prefix+'-wall',wallPage);await close()
  await page.reload();await expect(page.locator('html')).toHaveAttribute('lang',lang);await expect(page.locator('.product-nav')).toBeVisible();pass(lang+' live selection, profile persistence, reload and independent wall language')
 }
 const after=await must(client.from('calendar_items').select('id,title,type,note:data').eq('household_id',hid).order('id'));expect(after).toEqual(before);pass('All user titles, notes, types, people and household data unchanged by language switching')
 await openSettings(page,'account');await page.locator('#start-delete-account').click();await expect(page.locator('#delete-confirmation')).toHaveAttribute('pattern','DELETE MY ACCOUNT');await close();pass('English account deletion confirmation keeps localised UI without submitting deletion')
 await routeTo(page,'calendar');await page.locator('[data-calendar-view=week]').click();await page.locator('[data-calendar-item]').filter({hasText:'Hotelophold'}).first().click();await expect(page.locator('[name=repeatScope]')).toHaveCount(3);await shot('22-en-recurring-scope');await close()
 await routeTo(page,'meals');await page.locator('[data-recipe-scan]').first().click();await shot('23-en-recipe-scan');await close()
 await openSettings(page,'family');await page.locator('#household-format [name=currency_code]').selectOption('EUR');await page.locator('#household-format button').click();await expect.poll(async()=>(await must(client.from('households').select('currency_code').eq('id',hid).single())).currency_code).toBe('EUR');await close();await routeTo(page,'family');await page.locator('[data-reward-config="'+people[2].id+'"]').click();await expect(page.locator('#allowance-form')).toContainText('EUR');await shot('21-en-eur');await close();pass('Household currency independent of English UI; amounts unchanged')
 for(const [width,height]of [[375,667],[390,844],[430,932],[1440,900]]){await page.setViewportSize({width,height});for(const route of ['today','calendar','meals','tasks','family']){await routeTo(page,route);await shot('en-'+width+'-'+route)};await page.locator('[data-native-page=subscription]').click();await shot('en-'+width+'-subscription');await close()}
 await wallPage.setViewportSize({width:1920,height:1080});await shot('en-wall-1920',wallPage);pass('English 375/390/430/1440 and kiosk 1280/1920 have no page overflow')
 expect(errors).toEqual([]);pass('No uncaught browser exceptions')
 writeFileSync(out+'/browser-results.json',JSON.stringify({checks,shots,errors},null,2))
 writeFileSync(out+'/review.html','<!doctype html><html lang="da"><meta charset="utf-8"><title>I18N 1.0 review</title><style>body{font:16px system-ui;background:#f7f6ef;color:#294638;max-width:1450px;margin:auto;padding:32px}nav{display:flex;flex-wrap:wrap;gap:12px}a{color:inherit}section{margin:44px 0;border-top:1px solid #d9e0d5;padding-top:14px}img{max-width:100%;max-height:1000px;border-radius:20px;box-shadow:0 8px 35px #183a301c}</style><h1>Familiekalender · Internationalization 1.0</h1><p>Kun lokal syntetisk familie. Abonnementsstatus/priser er eksplicitte Native 5 review-fixtures. Personlige sprogvalg, valuta og wall pairing bruger lokal Auth/RLS. Familiens danske indhold oversættes ikke.</p><p>'+checks.length+' browserchecks · <a href="browser-results.json">Resultater</a></p><nav>'+shots.map(s=>'<a href="#'+s+'">'+s+'</a>').join('')+'</nav>'+shots.map(s=>'<section id="'+s+'"><h2>'+s+'</h2><img loading="lazy" src="'+s+'.png" alt="'+s+'"></section>').join('')+'</html>')
 console.log('I18N BROWSER PASS '+checks.length+'; '+shots.length+' screenshots')
}catch(error){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});console.log('BROWSER_ERRORS '+JSON.stringify(errors));throw error}
finally{if(hid){const d=await admin.from('household_devices').select('auth_user_id').eq('household_id',hid);users.push(...(d.data||[]).map(x=>x.auth_user_id))}await browser.close();if(hid)await admin.from('households').delete().eq('id',hid);for(const id of new Set(users))await admin.auth.admin.deleteUser(id)}
