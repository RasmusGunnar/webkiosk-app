import {chromium,expect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {routeTo} from './browser-actions.mjs'
import {dateIso,weekDates} from '../src/lib/calendar-dates.js'
import {calendarPayload} from '../src/lib/calendar.js'
const local=localSupabase(),base='http://127.0.0.1:5185',out='supabase/.temp/native50',opts={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,opts),client=createClient(local.API_URL,local.ANON_KEY,opts)
const checks=[],shots=[],errors=[],users=[],households=[];mkdirSync(out,{recursive:true})
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data}
const pass=name=>{checks.push(name);console.log('PASS '+name)}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const context=await browser.newContext({locale:'da-DK',viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(15000)
const track=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{const u=new URL(r.url());if(u.hostname.endsWith('.supabase.co'))throw Error('Hosted request prohibited')})};track(page)
// The fixed DEV-only warning is documented in the gallery; omit its overlay from product screenshots.
const shot=async(name,p=page)=>{await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:out+'/'+name+'.png',style:'.native-review-banner{display:none}'});shots.push(name)}
const close=async()=>{if(await page.locator('[data-native-close]').count())await page.locator('[data-native-close]').click()}
const state=async name=>{await page.evaluate(name=>sessionStorage.setItem('native50.state',name),name);await close();await page.locator('[data-native-page=subscription]').click();await expect(page.locator('.native-subscription-hero')).toBeVisible()}
let hid,wallContext,wallPage,wallId,wallUser
try{
 const email='native50-browser-'+randomUUID()+'@example.test',password=randomUUID()+'Aa!1'
 const uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id;users.push(uid);await must(client.auth.signInWithPassword({email,password}))
 hid=await must(client.rpc('create_household',{p_name:'Familien Birk · lokalt review'}));households.push(hid)
 const people=await must(client.from('household_people').insert([{name:'Mor',role:'adult',color:'#ad8a72'},{name:'Far',role:'adult',color:'#708c90'},{name:'Freja',role:'child',color:'#959769',reward_enabled:true},{name:'Emil',role:'child',color:'#a383a9',reward_enabled:true}].map(p=>({...p,household_id:hid}))).select())
 const dates=weekDates(dateIso(new Date())),today=dateIso(new Date())
 await must(client.from('calendar_items').insert([
  {title:'Hotelophold',type:'Aktivitet',date:dates[3],endDate:dates[6],allDay:true,person:'Alle'},
  {title:'Fodboldtræning',type:'Fritidsinteresse',date:today,time:'16:30',personIds:[people[3].id],location:'Klubben'},
  {title:'Pasta med grøntsager',type:'Madplan',date:today},
  {title:'Tøm opvaskemaskinen',type:'Opgave',date:today,personIds:[people[2].id]},
  {title:'Mælk',type:'Indkøb',date:today}
 ].map(i=>({...calendarPayload({time:'',person:'Alle',note:'',done:false,...i},people),household_id:hid,created_by:uid}))))
 await must(client.rpc('reward_action',{p_request_id:randomUUID(),p_household_id:hid,p_action:'allowance_save',p_payload:{person_id:people[2].id,cadence:'week',amount_minor:5000,start_today:true,duties:[{title:'Pak skoletasken',schedule:'daily',approval:false}]}}))
 // The real local Edge endpoint runs with explicit local-only mock verification; no response is intercepted.
 let verifies=0
 await page.route('**/functions/v1/subscription-verify',async route=>{
  const body=route.request().postDataJSON();expect(body.household_id).toBe(hid)
  verifies++;await route.continue()
 })
 await page.goto(base);await expect(page.locator('[data-device-choice=personal]')).toBeVisible();await shot('01-mobile-device-choice')
 await page.setViewportSize({width:820,height:1180});await shot('23-tablet-device-choice');await page.setViewportSize({width:390,height:844})
 await page.locator('[data-device-choice=personal]').click();await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click();await expect(page.locator('.product-nav')).toBeVisible()
 await shot('02-personal-mobile');await routeTo(page,'family');await state('none');await shot('03-subscription-inactive');await expect(page.locator('.native-offering')).toHaveCount(2);await shot('04-localized-offering')
 await page.locator('#native-purchase').click();await expect(page.locator('#native-message')).toContainText('Familien har nu adgang');expect(verifies).toBe(1);await shot('05-active-monthly')
 pass('First run, personal login, family subscription offering and server-confirmed local purchase')
 await state('cancelled');await expect(page.locator('.native-subscription-hero')).toContainText('Opsagt');await expect(page.locator('#native-purchase')).toHaveCount(0);await shot('06-cancelled-but-active')
 for(const name of ['yearly','trial','grace','expired']){await state(name);await shot('state-'+name)}
 await state('monthly');await page.locator('#native-restore').click();await expect(page.locator('#native-message')).toContainText('Familien har nu adgang');expect(verifies).toBe(2);await shot('08-restore-purchase')
 expect((await must(admin.from('household_subscriptions').select('household_id').eq('household_id',hid))).length).toBe(1)
 pass('Monthly/yearly, trial, cancelled, grace, expired and restore preserve one household subscription')
 await close();await page.evaluate(()=>{sessionStorage.setItem('native50.state','expired');sessionStorage.setItem('native50.enforce','true')});await page.reload()
 await expect(page.locator('h1')).toHaveText('Giv familien adgang');await shot('owner-expired-gating')
 await page.locator('[data-native-page=subscription]').click();await expect(page.locator('#native-purchase')).toBeVisible();await page.locator('#native-purchase').click()
 await expect(page.locator('#native-message')).toContainText('Familien har nu adgang');await close();await expect(page.locator('.product-nav')).toBeVisible()
 await page.evaluate(()=>sessionStorage.removeItem('native50.enforce'));await routeTo(page,'family')
 pass('Enabled owner gating opens purchase screen and verified purchase restores the normal app')
 await close();await page.setViewportSize({width:820,height:1180});await routeTo(page,'today');await shot('24-tablet-personal');await page.setViewportSize({width:390,height:844});await routeTo(page,'family')
 await page.locator('[data-native-page=devices]').click();await expect(page.locator('#native-add-wall')).toBeVisible();await shot('09-family-devices-empty');await shot('10-add-wall-screen')
 await page.locator('#native-add-wall').click();await expect(page.locator('.native-qr img')).toBeVisible();const code=await page.locator('.native-pair-code').innerText();const qr=await page.locator('.native-qr img').getAttribute('src');await shot('11-qr-and-code')
 wallContext=await browser.newContext({locale:'da-DK',viewport:{width:1024,height:768},serviceWorkers:'block'});wallPage=await wallContext.newPage();track(wallPage)
 await wallPage.goto(base);await wallPage.locator('[data-device-choice=wall]').click();await expect(wallPage.locator('#wall-pair-form')).toBeVisible();await shot('12-wall-pairing',wallPage)
 // QR scanning uses a captured image and the same parser as the camera input.
 await wallPage.locator('#wall-scan').setInputFiles({name:'local-pairing.png',mimeType:'image/png',buffer:Buffer.from(qr.split(',')[1],'base64')})
 await expect(wallPage.locator('#wall-name-form')).toBeVisible();await shot('13-pairing-success',wallPage);await wallPage.locator('#wall-name').fill('Køkken');await shot('14-device-naming',wallPage)
 await wallPage.locator('#wall-name-form button').click();await expect(wallPage.locator('body')).toHaveAttribute('data-mode','kiosk');await expect(wallPage.locator('.product-nav')).toBeVisible()
 const device=await must(client.from('household_devices').select('id,auth_user_id,name').eq('household_id',hid).single());wallId=device.id;wallUser=device.auth_user_id;users.push(wallUser)
 expect(device.name).toBe('Køkken');await shot('18-kiosk-landscape-1024',wallPage)
 for(const [width,height,name] of [[1280,800,'25-tablet-wall'],[1920,1080,'kiosk-landscape-1920']]){
  await wallPage.setViewportSize({width,height});await expect(wallPage.locator('.week-grid .day-card')).toHaveCount(7);await shot(name,wallPage)
 }
 await wallPage.setViewportSize({width:820,height:1180});await expect(wallPage.locator('.day-view .day-card')).toHaveCount(1);await shot('19-kiosk-portrait',wallPage)
 expect(await wallPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 expect(await wallPage.locator('.product-nav [data-product-route=family]').count()).toBe(0)
 await wallPage.reload();await expect(wallPage.locator('body')).toHaveAttribute('data-mode','kiosk');await expect(wallPage.locator('[data-device-choice]')).toHaveCount(0)
 pass('QR camera-image flow pairs a real anonymous user, names device, restores wall mode after reload')
 for(const route of ['today','tasks','meals']){await routeTo(wallPage,route);await shot('21-kiosk-'+route,wallPage)}
 await wallPage.locator('#settings-button').click();await expect(wallPage.locator('.native-panel')).toContainText('Administration foregår på en voksens telefon');await shot('22-wall-locked-administration',wallPage);await wallPage.locator('[data-native-close]').click()
 await wallPage.evaluate(()=>{sessionStorage.setItem('native50.state','expired');sessionStorage.setItem('native50.enforce','true')});await wallPage.reload();await expect(wallPage.locator('.wall-renewal')).toBeVisible();await shot('20-wall-renewal',wallPage)
 expect(await wallPage.locator('#native-purchase,#native-restore').count()).toBe(0)
 await wallPage.evaluate(()=>{sessionStorage.setItem('native50.state','monthly');sessionStorage.removeItem('native50.enforce')});await wallPage.reload();await expect(wallPage.locator('.product-nav')).toBeVisible()
 pass('Wall calendar/tasks/meals reuse kiosk; admin locked, expired renewal has no purchase UI')
 await close();await page.locator('[data-native-page=devices]').click();await expect(page.locator('.native-device')).toContainText('Køkken');await shot('15-paired-device-list')
 await page.locator('[data-rename-wall]').click();await page.locator('#wall-name').fill('Entré');await page.locator('#native-rename button').click();await expect(page.locator('.native-device')).toContainText('Entré')
 await page.locator('[data-revoke-wall]').click();await shot('16-revoke-confirmation');await page.locator('#native-confirm-revoke').click()
 await expect(wallPage.locator('h1')).toContainText('adgang er fjernet',{timeout:20000});await expect(wallPage.locator('.product-nav')).toHaveCount(0);await shot('17-revoked-device',wallPage)
 pass('Admin rename and revoke propagate to remote display and remove family view')
 // A normal household member sees access without a store purchase or restore action.
 const email2='native50-member-'+randomUUID()+'@example.test',pw2=randomUUID()+'Aa!1',member=(await must(admin.auth.admin.createUser({email:email2,password:pw2,email_confirm:true}))).user;users.push(member.id)
 await must(admin.from('household_members').insert({household_id:hid,user_id:member.id,role:'adult'}))
 const memberContext=await browser.newContext({locale:'da-DK',viewport:{width:390,height:844},serviceWorkers:'block'}),mp=await memberContext.newPage();track(mp);await mp.goto(base);await mp.locator('[data-device-choice=personal]').click();await mp.locator('#email').fill(email2);await mp.locator('#password').fill(pw2);await mp.locator('#login-form button[type=submit]').click();await expect(mp.locator('.product-nav')).toBeVisible();await routeTo(mp,'family');await mp.locator('[data-native-page=subscription]').click();await expect(mp.locator('.native-status-card')).toBeVisible();await expect(mp.locator('#native-purchase,#native-restore,#native-manage')).toHaveCount(0);await shot('07-household-member-access',mp)
 pass('Member shares household access without purchase/restore actions')
 await mp.evaluate(()=>{sessionStorage.setItem('native50.state','expired');sessionStorage.setItem('native50.enforce','true')});await mp.reload()
 await expect(mp.locator('h1')).toHaveText('En voksen skal aktivere abonnementet');await expect(mp.locator('[data-native-page=subscription],#native-purchase')).toHaveCount(0);await shot('member-expired-gating',mp)
 pass('Enabled member gating asks an adult to activate access without offering a purchase')
 await close();for(const [width,height]of [[375,667],[390,844],[430,932]]){await page.setViewportSize({width,height});await page.locator('[data-native-page=subscription]').click();await expect(page.locator('.native-subscription-hero')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await close()}
 expect(errors).toEqual([]);pass('Mobile 375/390/430 and tablet/kiosk checks; no uncaught browser exceptions')
 writeFileSync(out+'/review.html','<!doctype html><html lang="da"><meta charset="utf-8"><title>Native 5.0 review</title><style>body{font:16px system-ui;background:#f7f6ef;color:#294638;max-width:1450px;margin:auto;padding:32px}header{max-width:900px}nav{display:flex;flex-wrap:wrap;gap:10px}a{color:inherit}section{margin:44px 0;border-top:1px solid #d9e0d5;padding-top:14px}img{max-width:100%;max-height:1050px;border-radius:20px;box-shadow:0 8px 35px #183a301c}p{line-height:1.6}</style><header><h1>Familiekalender · Native 5.0</h1><p>Kun lokale syntetiske familier. Priser og abonnementsstatus er eksplicitte review-fixtures, aldrig production-konfiguration. Pairing, anonymous Auth, RLS, serververifikation og revoke bruger den rigtige lokale Supabase-instans. Ingen store-køb eller fysisk native enhedstest er udført.</p><p>'+checks.length+' browserchecks · <a href="browser-results.json">Resultater</a> · <a href="api-results.json">API/RLS</a></p></header><nav>'+shots.map(s=>'<a href="#'+s+'">'+s+'</a>').join('')+'</nav>'+shots.map(s=>'<section id="'+s+'"><h2>'+s+'</h2><a href="'+s+'.png"><img loading="lazy" src="'+s+'.png" alt="'+s+'"></a></section>').join('')+'</html>')
 writeFileSync(out+'/browser-results.json',JSON.stringify({checks,shots,errors,provider:'explicit LOCAL MOCK; store sandbox acceptance pending'},null,2));console.log('NATIVE50 BROWSER PASS '+checks.length+'; '+shots.length+' screenshots')
}catch(e){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});if(wallPage)await wallPage.screenshot({path:out+'/wall-failure.png',fullPage:true}).catch(()=>{});console.log('BROWSER_ERRORS '+JSON.stringify(errors));throw e}
finally{
 if(hid){const ds=await admin.from('household_devices').select('auth_user_id').eq('household_id',hid);users.push(...(ds.data||[]).map(d=>d.auth_user_id))}
 await browser.close();for(const id of households)await admin.from('households').delete().eq('id',id);for(const id of new Set(users))await admin.auth.admin.deleteUser(id)
}
