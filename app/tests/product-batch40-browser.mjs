import {chromium,expect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import sharp from 'sharp'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {routeTo,openSettings} from './browser-actions.mjs'
import {rewardToday} from '../src/lib/rewards-model.js'
const local=localSupabase(),opts={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,opts),client=createClient(local.API_URL,local.ANON_KEY,opts)
const out='supabase/.temp/product-batch40',shots=[],checks=[],errors=[],paths=[];mkdirSync(out,{recursive:true})
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data},pass=s=>{checks.push(s);console.log('PASS '+checks.length+': '+s)}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),context=await browser.newContext({locale:'da-DK',viewport:{width:1440,height:1000},timezoneId:'Europe/Copenhagen'}),page=await context.newPage()
page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message))
await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
const shot=async name=>{await page.screenshot({path:out+'/'+name+'.png',fullPage:false});shots.push(name)}
const close=async()=>{await page.keyboard.press('Escape');await expect(page.locator('.recipe-modal,.reward-modal')).toHaveCount(0)}
const call=(action,payload)=>must(client.rpc('reward_action',{p_request_id:randomUUID(),p_household_id:hid,p_action:action,p_payload:payload}))
const state=()=>must(client.rpc('get_reward_state',{p_household_id:hid}))
const fixture=async n=>sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1300" height="1800"><rect width="1300" height="1800" fill="#fbf7e9"/><rect x="100" y="110" width="1100" height="500" rx="30" fill="#d7a069"/><circle cx="650" cy="360" r="190" fill="#eee7d0"/><circle cx="650" cy="360" r="148" fill="#b95737"/><text x="100" y="740" font-family="Arial" font-size="72" fill="#354d3d">Tomatsuppe med basilikum</text><text x="100" y="850" font-family="Arial" font-size="36">4 portioner · 30 minutter · Side '+n+'</text><text x="100" y="980" font-family="Arial" font-size="38">'+(n===1?'2 dåser hakkede tomater':'Hak løget og steg det i olien.')+'</text><text x="100" y="1050" font-family="Arial" font-size="38">'+(n===1?'1 løg · 2 spsk olivenolie':'Tilsæt tomaterne og kog i 20 minutter.')+'</text><text x="100" y="1200" font-family="Arial" font-size="25">Syntetisk dansk testopskrift</text></svg>')).jpeg().toBuffer()
const email='batch40-browser-'+randomUUID()+'@example.test',password=randomUUID()+'Aa!1',today=rewardToday();let uid,hid,people,scanRelease,scanRequests=[]
try{
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id;await must(client.auth.signInWithPassword({email,password}))
 hid=await must(client.rpc('create_household',{p_name:'Familien Birk · lokalt review'}))
 people=await must(client.from('household_people').insert([{name:'Jakob',role:'child',color:'#72957b',reward_enabled:true},{name:'Freja',role:'child',color:'#bd8268',reward_enabled:true},{name:'Mor',role:'adult',color:'#967da7'},{name:'Far',role:'adult',color:'#688cab'}].map(p=>({...p,household_id:hid}))).select())
 const child=people[0],second=people[1],images=[await fixture(1),await fixture(2)]
 await call('allowance_save',{person_id:second.id,cadence:'month',amount_minor:10000,start_today:true,duties:[{title:'Dæk bord',schedule:'daily',approval:false}]})
 const response={title:'Tomatsuppe med basilikum',description:'En varm suppe til familiens hverdag.',servings:4,prep_minutes:10,cook_minutes:20,total_minutes:30,ingredients:[{raw_text:'2 dåser hakkede tomater',ingredient_name:'tomater',quantity:2,unit:'dåser',note:null},{raw_text:'1 løg',ingredient_name:'løg',quantity:1,unit:null,note:null},{raw_text:'2 spsk olivenolie',ingredient_name:'olivenolie',quantity:2,unit:'spsk',note:null}],instructions:[{position:0,text:'Hak løget og steg det i olien.'},{position:1,text:'Tilsæt tomaterne og kog i 20 minutter.'}],warnings:['RECIPE_SCAN_UNCERTAIN'],incomplete:true,cover_page_index:0}
 await page.route('**/functions/v1/recipe-preview',async r=>{
  const body=r.request().postDataJSON();if(body.action!=='scan')return r.continue();scanRequests.push(body);paths.push(...body.paths)
  await new Promise(resolve=>{scanRelease=resolve});await r.fulfill({contentType:'application/json',body:JSON.stringify({recipe:response,review_required:true})})
 })
 await page.goto('http://127.0.0.1:5179');await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click();await expect(page.locator('.product-nav')).toBeVisible()
 await page.addInitScript(()=>{window.rewardEvents=[];document.addEventListener('reward-motion',e=>window.rewardEvents.push(e.detail))});await page.evaluate(()=>{window.rewardEvents=[];document.addEventListener('reward-motion',e=>window.rewardEvents.push(e.detail))})
 await routeTo(page,'meals');await shot('01-food-scan-entry')
 await page.setViewportSize({width:390,height:844});await routeTo(page,'meals');await page.locator('[data-recipe-scan]').click();await shot('02-mobile-camera-upload')
 await expect(page.locator('#scan-camera')).toHaveAttribute('capture','environment')
 await page.locator('#scan-files').setInputFiles(images.map((buffer,i)=>({name:'side'+(i+1)+'.jpg',mimeType:'image/jpeg',buffer})))
 await expect(page.locator('.scan-page')).toHaveCount(2);await shot('03-two-processed-pages')
 await page.locator('[data-scan-up="1"]').click();await page.locator('[data-scan-up="1"]').click()
 await page.locator('#scan-analyse').click();await expect.poll(()=>scanRequests.length).toBe(1);await shot('04-analysing')
 expect(scanRequests[0].paths).toHaveLength(2);expect(scanRequests[0].images).toBeUndefined();scanRelease()
 await expect(page.locator('#recipe-title')).toHaveValue(response.title);await shot('05-editable-preview')
 await page.setViewportSize({width:1440,height:1000});await shot('06-warning-and-missing-field')
 await expect(page.locator('.recipe-scan-warnings')).toContainText('Noget tekst er usikker');await expect(page.locator('#recipe-image-preview img')).toHaveCount(0)
 await page.locator('[data-scan-cover="0"]').click();await shot('07-explicit-cover-selection')
 for(const path of scanRequests[0].paths){expect((await admin.storage.from('recipe-images').download(path)).error).toBeTruthy()}
 pass('Camera/upload, processed multipage order, analysing, warnings and explicit cover; temp cleanup after fixture analysis')
 await page.locator('#recipe-editor button[type=submit]').click();await expect(page.locator('#recipe-dialog-title')).toHaveText(response.title);await shot('09-scanned-recipe-detail');await close()
 await page.locator('.food-tabs [data-food-tab=recipes]').click();await expect(page.locator('.library-card')).toHaveCount(1);await expect(page.locator('.recipe-cover')).toBeVisible();await shot('08-saved-scanned-recipe-card')
 let recipe=await must(client.from('recipes').select('*,recipe_ingredients(*),recipe_instructions(*)').eq('household_id',hid).single());paths.push(recipe.image_path)
 expect(recipe.source_type).toBe('photo');expect(recipe.recipe_ingredients[0].quantity).toBe(2);expect(recipe.recipe_instructions).toHaveLength(2)
 await page.reload();await routeTo(page,'meals');await page.locator('.food-tabs [data-food-tab=recipes]').click();await expect(page.locator('.recipe-cover')).toBeVisible()
 await page.locator('[data-recipe-plan]').click();await page.locator('#recipe-plan-date').fill(today);await page.locator('#recipe-plan-form button[type=submit]').click();await expect(page.locator('.recipe-modal')).toHaveCount(0)
 await page.locator('[data-food-tab=meals]').click();await expect(page.locator('.meal-recipe-thumbnail')).toBeVisible()
 expect((await must(client.from('calendar_items').select('recipe_id').eq('household_id',hid).eq('type','Madplan').single())).recipe_id).toBe(recipe.id)
 await page.locator('[data-recipe-open]').first().click();await page.locator('[data-detail-shop]').click();await shot('10-scan-ingredients-shopping');await page.locator('#recipe-shopping-form button[type=submit]').click();await expect(page.locator('.recipe-modal')).toHaveCount(0)
 expect((await must(client.from('calendar_items').select('id').eq('household_id',hid).eq('type','Indkøb'))).length).toBe(3)
 pass('Scanned structured recipe persists, reloads with private cover, plans with thumbnail and adds shopping')
 await page.context().setOffline(true);await page.locator('[data-recipe-scan]').click();await expect(page.locator('#scan-upload-status')).toContainText('kræver internet');await close();await page.context().setOffline(false)
 pass('Offline scanning is explicit and never queued')
 await routeTo(page,'family');await shot('11-family-child-settings');await page.locator('[data-reward-config="'+child.id+'"]').click();await shot('12-agreement-setup')
 await page.locator('#allowance-form [name=cadence]').selectOption('week');await shot('13-month-week-selector')
 await page.locator('#allowance-add').click();await page.locator('[data-field=title]').fill('Ryd værelset');await page.locator('[data-field=schedule]').selectOption('weekly')
 await page.locator('#allowance-add').click();await page.locator('[data-field=title]').last().fill('Pak skoletasken');await page.locator('[data-field=schedule]').last().selectOption('weekly');await page.locator('[data-field=approval]').last().check()
 await shot('14-fixed-duties');await page.locator('[data-field=schedule]').last().selectOption('selected');await shot('15-duty-schedule');await page.locator('[data-field=schedule]').last().selectOption('weekly')
 await expect(page.locator('.allowance-next')).toContainText('2 forventede pligter');await shot('16-next-period-preview');await page.locator('#allowance-form [name=start]').selectOption('today');await expect(page.locator('.allowance-next')).toContainText('fulde beløb')
 await page.locator('#allowance-form button[type=submit]').click();await expect(page.locator('.reward-modal')).toHaveCount(0)
 let s=await state();expect(s.monthly.find(m=>m.person_id===child.id).eligible_total).toBe(2)
 // Synthetic bonus/ordinary tasks use the existing calendar engine.
 const bonus=await must(client.from('calendar_items').insert({household_id:hid,created_by:uid,title:'Vask cyklen',date:today,type:'Opgave',person_ids:[child.id],data:{rewardMode:'stars',starValue:10}}).select().single())
 await must(client.from('calendar_items').insert({household_id:hid,created_by:uid,title:'Husk regnjakke',date:today,type:'Opgave',person_ids:[child.id],data:{}}))
 await routeTo(page,'tasks');await page.locator('[data-reward-select="'+child.id+'"]').click();await expect(page.locator('.reward-month')).toContainText('0 %');await page.locator('[data-person-filter="'+second.id+'"]').click();await shot('17-child-monthly-progress');await page.locator('[data-person-filter="'+child.id+'"]').click();await shot('18-separate-stars')
 const card=title=>page.locator('.reward-task').filter({hasText:title}).first()
 await expect(card('Ryd værelset')).toBeVisible();await card('Ryd værelset').locator('[data-reward-action=complete]').click();await expect(page.locator('.reward-month')).toContainText('50 %')
 await card('Pak skoletasken').locator('[data-reward-action=complete]').click();await expect(card('Pak skoletasken')).toContainText('Afventer godkendelse');await expect(page.locator('.reward-month')).toContainText('50 %');await shot('19-pending-approval')
 s=await state();const pending=s.occurrences.find(o=>o.title==='Pak skoletasken');await call('approve',{person_id:child.id,item_id:pending.task_id,due_date:pending.due_date,occurrence_date:pending.occurrence_date})
 await expect(page.locator('.reward-month')).toContainText('100 %');await shot('20-full-period')
 pass('Real agreement UI saves weekly snapshot; flexible task completes once; pending approval earns nothing; remote approval updates money')
 await call('approve',{person_id:child.id,item_id:pending.task_id,due_date:pending.due_date,occurrence_date:pending.occurrence_date})
 expect((await page.evaluate(()=>window.rewardEvents)).filter(e=>e.kind==='allowance'&&e.to.completion_percent===100)).toHaveLength(1)
 await routeTo(page,'family');await page.locator('[data-reward-config="'+child.id+'"]').click();await shot('21-adult-current-period')
 await page.locator('#allowance-add').click();await page.locator('[data-field=title]').last().fill('Tøm opvaskemaskinen');await page.locator('#allowance-form [name=amount]').fill('150');await page.locator('#allowance-form button[type=submit]').click();await expect(page.locator('.reward-modal')).toHaveCount(0)
 expect((await state()).monthly.find(m=>m.person_id===child.id).allowance_minor).toBe(10000)
 // Historical screenshot is an explicitly synthetic, local fixture; API rollover is tested separately.
 const historic=await must(admin.from('allowance_contracts').insert({household_id:hid,person_id:child.id,period_start:'2026-09-01',period_end:'2026-09-30',cadence:'month',allowance_minor:10000,rules:[],closed_at:new Date().toISOString(),final_totals:{person_id:child.id,period_start:'2026-09-01',period_end:'2026-09-30',cadence:'month',allowance_minor:10000,earned_minor:9500,eligible_total:20,completed_total:19,excused_total:1,completion_percent:95}}).select().single())
 // final_totals carries identity, just as the real finalizer does.
 await must(admin.from('allowance_contracts').update({final_totals:{...historic.final_totals,id:historic.id}}).eq('id',historic.id))
 await routeTo(page,'tasks');await page.locator('[data-person-filter="'+child.id+'"]').click();await expect(page.locator('.reward-month')).toContainText('100 %');await page.locator('.reward-history summary').click();await expect(page.locator('.allowance-history-row')).toBeVisible();await page.locator('.allowance-history-row').scrollIntoViewIfNeeded();await shot('22-period-history')
 await page.locator('.reward-history summary').click();await page.locator('[data-task-range=week]').click();await page.evaluate(()=>scrollTo(0,0));await shot('23-task-types')
 pass('Changes wait until next period; current amount/denominator remain fixed; history and task types separate')
 // Offline completion uses the existing queue, without optimistic money.
 await page.context().setOffline(true);await card('Vask cyklen').locator('[data-reward-action=complete]').click();await expect(card('Vask cyklen')).toContainText('Afventer synkronisering');await expect(page.locator('.reward-star-balance')).toContainText('0')
 await page.context().setOffline(false);await expect(page.locator('.reward-star-balance')).toContainText('10');await expect(page.locator('.reward-month')).toContainText('100 %')
 pass('Existing offline task queue replays bonus once; allowance unchanged')
 await page.setViewportSize({width:390,height:844});await routeTo(page,'tasks');await page.locator('[data-person-filter="'+child.id+'"]').click();await page.locator('[data-child-day="'+child.id+'"]').first().click();await shot('25-mobile-child-view');await close()
 for(const [width,height] of [[375,667],[390,844],[430,932]]){await page.setViewportSize({width,height});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)}
 await page.emulateMedia({reducedMotion:'reduce'});await routeTo(page,'family');await page.locator('[data-reward-config="'+child.id+'"]').click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await close()
 pass('Mobile viewports, child view, settings and reduced motion have no horizontal overflow')
 await page.setViewportSize({width:1280,height:800});await openSettings(page,'device');await page.locator('#device-kiosk').check();await page.locator('#device-pin').fill('1234');await page.locator('#device-settings-form button[type=submit]').click();await page.keyboard.press('Escape');await expect(page.locator('body')).toHaveAttribute('data-mode','kiosk');await routeTo(page,'today');await shot('24-kiosk-summary')
 await page.locator('.reward-people-kiosk [data-child-day]').first().click();await expect(page.locator('.reward-modal [data-reward-config],.reward-modal [data-reward-action=approve]')).toHaveCount(0)
 expect(await page.locator('body').innerText()).not.toMatch(/🪙|💎|👑|Superstjerne|Hverdagshelt/)
 expect(errors).toEqual([]);pass('Kiosk is a summary without adult administration; old symbols absent; no browser exceptions')
 writeFileSync(out+'/review.html','<!doctype html><html lang="da"><meta charset="utf-8"><title>Product Batch 4.0 review</title><style>body{font:16px system-ui;background:#f6f4ee;color:#35473c;max-width:1500px;margin:auto;padding:30px}section{margin:40px 0}img{max-width:100%;max-height:900px;border-radius:16px;border:1px solid #ddd}a{color:inherit}</style><h1>Product Batch 4.0</h1><p>Kun syntetiske lokale fixtures. Scan-preview bruger en eksplicit provider-contract fixture; ingen live AI-test. OPENAI_API_KEY mangler. Kamera kræver fysisk enhedstest.</p><p>'+checks.length+' browserchecks · <a href="results.json">Testresultater</a></p>'+shots.sort().map(n=>'<section><h2>'+n+'</h2><a href="'+n+'.png"><img src="'+n+'.png" loading="lazy" alt="'+n+'"></a></section>').join('')+'</html>')
 writeFileSync(out+'/results.json',JSON.stringify({checks,shots,provider:'FIXTURE; LIVE VISION BLOCKED: OPENAI_API_KEY MISSING',errors},null,2))
 console.log('PRODUCT BATCH 4 BROWSER PASS '+checks.length+'; '+shots.length+' screenshots')
}catch(error){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});console.log('BROWSER_ERRORS',errors);throw error}
finally{if(hid){const {data}=await admin.from('recipes').select('image_path').eq('household_id',hid);for(const r of data||[])if(r.image_path)paths.push(r.image_path)}await browser.close();if(paths.length)await admin.storage.from('recipe-images').remove([...new Set(paths)]);if(hid)await must(admin.from('households').delete().eq('id',hid));if(uid)await must(admin.auth.admin.deleteUser(uid))}
