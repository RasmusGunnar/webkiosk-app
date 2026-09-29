import {openCreate,openSettings,logout,toggleView,routeTo,switchHousehold} from './browser-actions.mjs'
import {chromium,expect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {localSupabase} from '../../scripts/local-supabase.mjs'
process.chdir(fileURLToPath(new URL('../../',import.meta.url)))
const local=localSupabase(),admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const root=process.env.TEST_UX_ROOT||'http://127.0.0.1:5179'
if(!['localhost','127.0.0.1'].includes(new URL(root).hostname))throw Error('Local test only')
const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const email='ux-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1',users=[],households=[],errors=[],results=[]
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const must=async query=>{const result=await query;if(result.error)throw Error(result.error.message);return result.data}
const pass=text=>{results.push(text);console.log('PASS '+results.length+': '+text)}
const route=routeTo
const screenshot=async(page,name)=>page.screenshot({path:'supabase/.temp/ux2/'+name+'.png',fullPage:true})
const savePlan=async page=>{await page.locator('#plan-form button[type=submit]').click();await expect(page.locator('#plan-modal')).toHaveCount(0)}
const shoppingRow=(page,title)=>page.locator('.shopping-row').filter({has:page.locator('strong',{hasText:title})}).first()
const calendarCard=(page,title)=>page.locator('.calendar-item').filter({has:page.locator('strong',{hasText:title})}).first()
let uid,hid,phone,desktop,mealId,second
async function newPage(width,height=900){
 const context=await browser.newContext({viewport:{width,height},timezoneId:'Europe/Copenhagen'})
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 await page.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
 await page.goto(root);await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.getByRole('button',{name:'Log ind',exact:true}).click()
 await expect(page.locator('.product-nav')).toBeVisible();return page
}
const queue=page=>page.evaluate(async()=>{const dbs=await indexedDB.databases();const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(dbs.find(d=>d.name.startsWith('familiekalender-offline-v1:')).name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const rows=await new Promise(resolve=>{const r=db.transaction('records').objectStore('records').getAll();r.onsuccess=()=>resolve(r.result)});db.close();return rows.flatMap(r=>r.queue||[])})
try{
 mkdirSync('supabase/.temp/ux2',{recursive:true})
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id;users.push(uid)
 hid=(await must(admin.from('households').insert({name:'Familien Sommer',created_by:uid}).select('id').single())).id;households.push(hid)
 second=(await must(admin.from('households').insert({name:'Sommerhuset',created_by:uid}).select('id').single())).id;households.push(second)
 await must(admin.from('household_members').insert([hid,second].map(household_id=>({household_id,user_id:uid,role:'owner'}))))
 await must(admin.from('household_people').insert([{household_id:hid,name:'Ida',role:'child',color:'#be755b'},{household_id:hid,name:'Carl',role:'child',color:'#6b8464'},{household_id:hid,name:'Rasmus',role:'adult',color:'#597d91'}]))
 const seed=(title,type='Aktivitet',extra={})=>({id:randomUUID(),household_id:hid,created_by:uid,title,type,date:today,time:'',person:'Alle',person_ids:[],done:false,data:{},...extra})
 const event=seed('Fodboldtræning','Fritidsinteresse',{time:'16:30',location:'Klubben',note:'Husk støvler og en drikkedunk.'})
 await must(admin.from('calendar_items').insert([event,seed('Lektier og læsning','Opgave'),seed('Dække bord','Opgave'),seed('Fødselsdag hos mormor','Aktivitet',{time:'18:00'})]))
 phone=await newPage(390,844);desktop=await newPage(1440,1000)
 await expect(phone.locator('.product-nav button')).toHaveCount(5);await expect(phone.locator('.mobile-today')).toBeVisible();await expect(desktop.locator('.ux-welcome')).toBeVisible()
 expect(await phone.locator('vite-error-overlay').count()).toBe(0);pass('Mobile and desktop start on Today with mode-specific destinations and no runtime overlay')
 await route(phone,'tasks');await openCreate(phone,'Opgave');await phone.locator('#calendar-title').fill('Pak tasken');await phone.getByRole('checkbox',{name:'Ida',exact:true}).check();await phone.locator('#calendar-modal-form button[type=submit]').click();await expect(phone.locator('#calendar-modal')).toHaveCount(0);await expect(calendarCard(phone,'Pak tasken')).toBeVisible();const quickTask=await must(admin.from('calendar_items').select('person_ids').eq('household_id',hid).eq('title','Pak tasken').single());expect(quickTask.person_ids).toHaveLength(1);pass('Shared task creation saves to today with a stable person assignment')
 await route(phone,'meals');await openCreate(phone,'meal');await phone.locator('#plan-title').fill('Pasta med tomater');await phone.locator('#plan-time').fill('18:30');await phone.locator('#plan-note').fill('500 g pasta\nTomater\nBasilikum');await savePlan(phone)
 await expect(phone.locator('.meal-card')).toContainText('Pasta med tomater')
 mealId=(await must(admin.from('calendar_items').select('id').eq('household_id',hid).eq('type','Madplan').single())).id
 await route(desktop,'meals');await expect(desktop.locator('[data-plan-edit="'+mealId+'"]')).toContainText('Pasta med tomater');pass('Meal creation persists through the existing RLS/RPC model and appears on a second device')
 await phone.locator('[data-meal-ingredients="'+mealId+'"]').click();await expect(phone.locator('#message')).toContainText('3 varer');await expect(phone.locator('.ux-notice')).toBeInViewport();await phone.locator('#dismiss-message').click();await expect(phone.locator('.ux-notice')).toBeHidden();await phone.locator('[data-meal-ingredients="'+mealId+'"]').click();await expect(phone.locator('#message')).toContainText('allerede')
 expect((await must(admin.from('calendar_items').select('id').eq('household_id',hid).eq('type','Indkøb'))).length).toBe(3);pass('Meal ingredients become three shopping entries, repeated transfer does not duplicate them')
 await route(phone,'shopping');await phone.locator('#shopping-title').fill('Mælk');await phone.locator('#shopping-note').fill('2 liter');await phone.locator('#shopping-note').press('Enter');await expect(shoppingRow(phone,'Mælk')).toContainText('2 liter')
 await shoppingRow(phone,'Mælk').locator('input').check();await phone.locator('.shopping-completed summary').click();await expect(shoppingRow(phone,'Mælk').locator('input')).toBeChecked();await shoppingRow(phone,'Mælk').locator('input').uncheck()
 await expect(shoppingRow(phone,'Mælk').locator('input')).not.toBeChecked();await shoppingRow(phone,'Mælk').locator('.shopping-name').click();await phone.locator('#plan-note').fill('3 liter');await savePlan(phone);await expect(shoppingRow(phone,'Mælk')).toContainText('3 liter');pass('Shopping quick-entry, quantity, category, purchase and undo work')
 await route(desktop,'shopping');await desktop.locator('#shopping-title').fill('Bevar indtastning');await desktop.locator('#shopping-note').fill('1 pakke');await must(admin.from('calendar_items').insert(seed('Æbler','Indkøb',{location:'Frugt & grønt'})))
 await expect(shoppingRow(desktop,'Æbler')).toBeVisible();await expect(desktop.locator('#shopping-title')).toHaveValue('Bevar indtastning');await expect(desktop.locator('#shopping-note')).toHaveValue('1 pakke');await expect(desktop.locator('#shopping-note')).toBeFocused();pass('Realtime preserves unfinished shopping input and focus')
 await route(phone,'meals');await phone.locator('[data-plan-edit="'+mealId+'"]').click();await phone.locator('#plan-title').fill('Min kladde');await must(admin.from('calendar_items').update({title:'Pasta med basilikum'}).eq('id',mealId));await expect(desktop.locator('#message')).toBeAttached();await new Promise(r=>setTimeout(r,800));await expect(phone.locator('#plan-title')).toHaveValue('Min kladde')
 await phone.locator('#plan-form button[type=submit]').click();await expect(phone.locator('#plan-error')).toContainText('ændret');await phone.keyboard.press('Escape');await phone.locator('#sync-details-button').click();await phone.locator('[data-sync-choice=server]').click();await phone.locator('#sync-panel-close').click()
 await expect(phone.locator('[data-plan-edit="'+mealId+'"]')).toContainText('Pasta med basilikum');pass('Meal draft survives realtime and a stale save requires explicit conflict resolution')
 await phone.locator('[data-plan-edit="'+mealId+'"]').click();await phone.locator('#plan-title').fill('Pasta med grønt');await savePlan(phone);await phone.locator('[data-meal-week="1"]').click();await expect(phone.locator('[data-plan-edit="'+mealId+'"]')).toHaveCount(0);await phone.locator('[data-meal-week="0"]').click();await expect(phone.locator('[data-plan-edit="'+mealId+'"]')).toBeVisible();pass('Meal editing and week navigation retain dated plans')
 await route(phone,'shopping');await phone.context().setOffline(true);await phone.locator('#shopping-title').fill('Havregryn offline');await phone.locator('#shopping-title').press('Enter');await expect(shoppingRow(phone,'Havregryn offline')).toBeVisible();await shoppingRow(phone,'Tomater').locator('input').check()
 await expect.poll(async()=>(await queue(phone)).length).toBeGreaterThan(0)
 await route(phone,'meals');await openCreate(phone,'meal');await phone.locator('#plan-title').fill('Offline suppe');await savePlan(phone)
 if(root.endsWith(':5179')){await phone.reload();await expect(phone.locator('.meal-card').filter({hasText:'Offline suppe'})).toBeVisible()}
 await phone.locator('.meal-card').filter({hasText:'Offline suppe'}).locator('[data-plan-edit]').click();await phone.locator('#plan-title').fill('Offline tomatsuppe');await savePlan(phone);await phone.locator('.meal-card').filter({hasText:'Offline tomatsuppe'}).locator('[data-plan-edit]').click();await phone.locator('#plan-delete').click();await expect(phone.locator('#plan-modal')).toHaveCount(0)
 await route(phone,'shopping')
 if(root.endsWith(':5179')){await phone.reload();await expect(shoppingRow(phone,'Havregryn offline')).toBeVisible();await expect(phone.locator('body')).toHaveAttribute('data-route','shopping')}
 await phone.context().setOffline(false);await expect.poll(async()=>(await queue(phone)).length,{timeout:20000}).toBe(0);await expect(shoppingRow(desktop,'Havregryn offline')).toBeVisible();expect((await must(admin.from('calendar_items').select('id').eq('household_id',hid).ilike('title','Offline %suppe'))).length).toBe(0);pass('Offline shopping plus meal create/edit/delete survive reload and replay without duplicates')
 if(!await phone.locator('.shopping-completed').getAttribute('open'))await phone.locator('.shopping-completed summary').click();await phone.locator('#clear-shopping').click();await expect(shoppingRow(phone,'Tomater')).toHaveCount(0);await expect(shoppingRow(phone,'Mælk')).toBeVisible();pass('Clearing bought groceries preserves every outstanding item')
 await route(phone,'calendar');await expect(phone.locator('.calendar-item').filter({hasText:'Pasta med grønt'})).toHaveCount(0);await expect(phone.locator('.calendar-item').filter({hasText:'Havregryn offline'})).toHaveCount(0)
 await route(phone,'tasks');await expect(phone.locator('.task-view')).not.toContainText('Havregryn');expect((await must(admin.from('reward_celebrations').select('id').eq('household_id',hid))).length).toBe(0);pass('Meal and shopping records never appear as appointments or earn task rewards')
 const client=createClient(local.API_URL,local.PUBLISHABLE_KEY||local.ANON_KEY,{auth:{persistSession:false}});await must(client.auth.signInWithPassword({email,password}));const exported=await must(client.rpc('export_family_data',{p_household_id:hid}));expect(exported.calendar_and_tasks.find(row=>row.id===mealId).note).toBe('500 g pasta\nTomater\nBasilikum')
 const outsiderEmail='outside-'+randomUUID()+'@example.test',outsider=(await must(admin.auth.admin.createUser({email:outsiderEmail,password,email_confirm:true}))).user.id;users.push(outsider)
 const outside=createClient(local.API_URL,local.PUBLISHABLE_KEY||local.ANON_KEY,{auth:{persistSession:false}});await must(outside.auth.signInWithPassword({email:outsiderEmail,password}));expect((await must(outside.from('calendar_items').select('id').eq('household_id',hid))).length).toBe(0)
 const denied=await outside.rpc('sync_calendar_mutation',{p_mutation_id:randomUUID(),p_household_id:hid,p_expected:[],p_upserts:[],p_delete_ids:[mealId]});expect(denied.error).toBeTruthy();pass('JSON export includes complete planning data; another family cannot read or mutate it')
 await route(phone,'family');await expect(phone.locator('.ux-family-person')).toHaveCount(3);await phone.locator('[data-open-settings=family]').click();await expect(phone.locator('#invite-form')).toBeVisible();await phone.keyboard.press('Escape');await phone.locator('[data-open-settings=account]').click();await expect(phone.locator('#start-delete-account')).toBeVisible();await phone.keyboard.press('Escape');pass('Family destination leads to profiles, invitations and account/privacy controls')
 for(const width of [375,390,430,768,820,1366,1440]){
  await phone.setViewportSize({width,height:width<700?844:1000})
  for(const name of ['today','calendar','tasks','meals','shopping','family']){await route(phone,name);await expect.poll(()=>phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expect(phone.locator('.product-nav')).toBeInViewport()}
 }
 pass('All six destinations fit seven phone/tablet/desktop widths without horizontal overflow')
 await phone.setViewportSize({width:390,height:844});await route(phone,'today');await screenshot(phone,'mobile-today');await route(phone,'meals');await screenshot(phone,'mobile-meals');await route(phone,'shopping');await screenshot(phone,'mobile-shopping');await route(phone,'family');await screenshot(phone,'mobile-family');await route(desktop,'today');await screenshot(desktop,'desktop-today')
 await route(phone,'meals');await phone.locator('[data-plan-edit="'+mealId+'"]').click();await phone.locator('#plan-note').fill('Tastaturkladde');await phone.setViewportSize({width:390,height:420});await phone.locator('#plan-form button[type=submit]').scrollIntoViewIfNeeded();await expect(phone.locator('#plan-form button[type=submit]')).toBeInViewport();await expect(phone.locator('#plan-note')).toHaveValue('Tastaturkladde');await phone.keyboard.press('Escape');pass('New editors remain usable with a reduced keyboard viewport and Escape restores the page')
 await openSettings(desktop,'device');await desktop.locator('#device-kiosk').check();await desktop.locator('#device-pin').fill('1948');await desktop.locator('#device-settings-form button[type=submit]').click();await expect(desktop.locator('body')).toHaveAttribute('data-mode','kiosk');await expect(desktop.locator('.ux-dinner')).toContainText('Pasta med grønt');await expect(desktop.locator('#new-calendar-button')).toBeHidden();await expect(desktop.locator('.product-nav button')).toHaveCount(4)
 await calendarCard(desktop,'Fodboldtræning').click();await expect(desktop.locator('#plan-modal')).toContainText('Husk støvler');await expect(desktop.locator('#calendar-modal-form')).toHaveCount(0);await desktop.keyboard.press('Escape');await calendarCard(desktop,'Dække bord').locator('[data-calendar-toggle]').check();pass('Kiosk shows tonight’s meal, opens appointments read-only and keeps quick task completion')
 for(const [width,height] of [[1024,600],[1024,768],[1280,800],[1920,1080]]){
  await desktop.setViewportSize({width,height});await route(desktop,'today');await expect.poll(()=>desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expect(desktop.locator('#settings-button')).toBeInViewport();expect(await desktop.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);await screenshot(desktop,'kiosk-today-'+width+'x'+height)
  await route(desktop,'calendar');await expect(desktop.locator('.week-grid .day-card')).toHaveCount(7);expect(await desktop.locator('.week-grid .day-card').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().right<=innerWidth+1))).toBe(true);await screenshot(desktop,'kiosk-week-'+width+'x'+height)
 }
 pass('Kiosk Today and seven-day week fit all four wall sizes with settings accessible')
 await desktop.locator('#settings-button').click();await expect(desktop.locator('#pin-modal')).toBeVisible();await desktop.locator('#kiosk-pin').fill('0000');await desktop.locator('#pin-form button[type=submit]').click();await expect(desktop.locator('#pin-message')).toContainText('Forkert');await desktop.keyboard.press('Escape');pass('Kiosk administration still requires the configured PIN')
 await phone.setViewportSize({width:390,height:844});await route(phone,'shopping');await switchHousehold(phone,second,'shopping');await route(phone,'shopping');await expect(shoppingRow(phone,'Mælk')).toHaveCount(0);await switchHousehold(phone,hid,'shopping');await route(phone,'shopping');await expect(shoppingRow(phone,'Mælk')).toBeVisible();pass('Household switching isolates shopping and meals')
 await logout(phone);await expect(phone.locator('#login-form')).toBeVisible();expect(await phone.evaluate(()=>document.body.innerText.includes('Pasta med grønt'))).toBe(false);expect(await queue(phone)).toEqual([]);pass('Logout removes the new family content and its local queued data')
 expect(errors).toEqual([]);pass('No uncaught browser exceptions through the complete UX flows')
 writeFileSync('supabase/.temp/ux2/results.json',JSON.stringify({checks:results.length,results},null,2));console.log('UX 2 PASS '+results.length+'/'+results.length)
}catch(error){for(const [name,page]of [['phone',phone],['desktop',desktop]])if(page&&!page.isClosed())await screenshot(page,'failure-'+name).catch(()=>{});throw error}
finally{await browser.close();for(const id of households.reverse())await admin.from('households').delete().eq('id',id);for(const id of users)await admin.auth.admin.deleteUser(id)}
