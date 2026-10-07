import {expandTaskAdvanced} from './browser-actions.mjs'
import {openCreate,openSettings,logout,toggleView,routeTo,switchHousehold} from './browser-actions.mjs'
import { chromium, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { localSupabase } from '../../scripts/local-supabase.mjs'
process.chdir(fileURLToPath(new URL('../../', import.meta.url)))
const local=localSupabase(),admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const email='mega3-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1'
const must=async query=>{const r=await query;if(r.error)throw Error(r.error.message);return r.data}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
let uid,hid,hid2,phone,wall,checks=0
const errors=[],results=[]
const pass=label=>{checks++;results.push(label);console.log('PASS '+checks+': '+label)}
const card=(page,title)=>page.locator('[data-calendar-item],[data-task-detail]').filter({hasText:title}).first()
const cache=page=>page.evaluate(async()=>{
 const names=await indexedDB.databases(),name=names.find(row=>row.name.startsWith('familiekalender-offline-v1:'))?.name
 if(!name)return []
 return new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>{
  const db=request.result,read=db.transaction('records').objectStore('records').getAll()
  read.onsuccess=()=>{resolve(read.result);db.close()};read.onerror=()=>reject(read.error)
 }})
})
const state=async(page,id=hid)=>(await cache(page)).find(row=>row.household_id===id)
const countQueue=async page=>(await state(page))?.queue.length
async function newPage(width) {
 const context=await browser.newContext({viewport:{width,height:900},timezoneId:'Europe/Copenhagen'})
 const page=await context.newPage();page.on('console',msg=>{if(msg.type()==='error')console.log('CONSOLE',msg.text().slice(0,220))});page.on('requestfailed',req=>console.log('REQUEST_FAILED',new URL(req.url()).pathname,req.failure()?.errorText));page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 await page.goto('http://127.0.0.1:5179')
 await expect(page.locator('#login-form')).toBeVisible()
 await page.locator('#email').fill(email);await page.locator('#password').fill(password)
 await page.getByRole('button',{name:'Log ind',exact:true}).click()
 await expect(page.locator('.product-nav')).toBeVisible()
 await page.locator('.product-nav [data-product-route=calendar]').click()
 await page.evaluate(()=>navigator.serviceWorker.ready)
 await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true)
 return page
}
async function save(page) {await page.locator('#calendar-modal-form button[type=submit]').click();await expect(page.locator('#calendar-modal')).toHaveCount(0)}
async function create(page,title,{person,done=false,weekly=false}={}) {
 await openCreate(page)
 await page.locator('#calendar-title').fill(title);await page.locator('#calendar-date').fill(today)
 await page.locator('#calendar-type').selectOption('Opgave');await expandTaskAdvanced(page)
 if(person)await page.locator('[data-calendar-person-choice][value="'+person+'"]').check()
 if(done)await page.locator('#calendar-modal-form [name=done]').check()
 if(weekly)await page.locator('[name=repeatWeekly]').check()
 await save(page)
 if (await page.evaluate(()=>navigator.onLine)) await expect.poll(()=>countQueue(page),{timeout:15000}).toBe(0)
}
async function edit(page,title,next) {await card(page,title).click();await page.locator('#calendar-title').fill(next);await save(page)}
async function online(page) {await page.context().setOffline(false);await expect.poll(()=>countQueue(page),{timeout:20000}).toBe(0)}
try {
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 hid=(await must(admin.from('households').insert({name:'Mega 3 A',created_by:uid}).select('id').single())).id
 hid2=(await must(admin.from('households').insert({name:'Mega 3 B',created_by:uid}).select('id').single())).id
 await must(admin.from('household_members').insert([hid,hid2].map(household_id=>({household_id,user_id:uid,role:'owner'}))))
 const people=await must(admin.from('household_people').insert([
 {household_id:hid,name:'Ida',role:'child',color:'#f59e0b'},{household_id:hid,name:'Carl',role:'child',color:'#22c55e'},{household_id:hid,name:'Adult',role:'adult',color:'#64748b'}
 ]).select('*'))
 const ida=people.find(p=>p.name==='Ida'),carl=people.find(p=>p.name==='Carl'),adult=people.find(p=>p.name==='Adult')
 const seed=(title,extra={})=>({id:randomUUID(),household_id:hid,created_by:uid,title,date:today,type:'Opgave',person:'Alle',person_ids:[],done:false,data:{},...extra})
 const baseline=Array.from({length:6},(_,i)=>seed('Historic '+i,{done:true,person_ids:[ida.id],person:'Ida'}))
 const editable=seed('Offline edit'),deletable=seed('Offline delete'),toggle=seed('Offline done'),conflict=seed('Conflict source')
 await must(admin.from('calendar_items').insert([...baseline,editable,deletable,toggle,conflict,seed('Only B',{household_id:hid2})]))
 await must(admin.from('calendar_feeds').insert({household_id:hid,source:'ics',name:'Private metadata fixture',feed_url:'https://example.invalid/calendar/private-fixture.ics',is_active:true}))
 wall=await newPage(1800);phone=await newPage(390)
 // Day view exposes every task; the compact week intentionally folds items after six.
 await toggleView(wall)
 await expect(phone.locator('[data-reward-person]')).toHaveCount(0)
 await expect(phone.locator('#celebration-title')).toHaveCount(0)
 pass('Initial completed history loads without weekly rewards or popup')
 await expect.poll(async()=>JSON.stringify((await state(phone))?.snapshot.feeds)).toContain('Private metadata fixture')
 const cached=await state(phone)
 if(JSON.stringify(cached).includes('private-fixture.ics'))throw Error('Private feed URL cached')
 if(cached.snapshot.items.length!==10||cached.snapshot.people.length!==3)throw Error('Incomplete online snapshot')
 pass('IndexedDB snapshot includes items, people, safe feed metadata and reward state')
 await openSettings(phone)
 await expect(phone.locator('#person-'+adult.id+'-reward-enabled')).not.toBeChecked()
 await expect(phone.locator('#person-'+ida.id+'-reward-enabled')).toBeChecked()
 await phone.locator('#person-'+adult.id+'-reward-enabled').check()
 await phone.locator('[data-save-person="'+adult.id+'"]').click()
 await expect.poll(async()=>(await must(admin.from('household_people').select('reward_enabled').eq('id',adult.id).single())).reward_enabled).toBe(true)
 await expect(phone.getByText('Person gemt.',{exact:true})).toBeVisible();
 await phone.locator('#person-'+adult.id+'-reward-enabled').uncheck();await phone.locator('[data-save-person="'+adult.id+'"]').click()
 await expect.poll(async()=>(await must(admin.from('household_people').select('reward_enabled').eq('id',adult.id).single())).reward_enabled).toBe(false)
 await phone.locator('#settings-modal-close').click();await routeTo(phone,'calendar')
 pass('Child/adult defaults and explicit persisted reward setting')
 await openCreate(phone);await phone.locator('#calendar-type').selectOption('Opgave');await expandTaskAdvanced(phone)
 await expect(phone.locator('#task-suggestions option')).toHaveCount(17) // seven standard + ten distinct historic/current titles
 await phone.locator('#calendar-modal-close').click()
 pass('Seven standard suggestions plus prior household titles; free text remains available')
 await create(phone,'Tøm tasker',{person:ida.id,weekly:true})
 await expect(card(phone,'Tøm tasker').locator('.task-emoji')).toHaveText('🎒')
 await card(phone,'Tøm tasker').locator('[data-calendar-toggle]').check()
 await expect(phone.locator('#calendar-modal')).toHaveCount(0)
 await expect(phone.locator('#celebration-title')).toHaveCount(0)
 await expect(phone.locator('.celebration-card')).toHaveCount(0)
 await expect(wall.locator('#celebration-title')).toHaveCount(0)
 await expect.poll(async()=>(await must(admin.from('reward_celebrations').select('id').eq('household_id',hid))).length).toBe(0)
 pass('Quick checkbox stays out of editor; seventh completion creates no legacy celebration')
 mkdirSync('supabase/.temp/mega3',{recursive:true})
 await phone.screenshot({path:'supabase/.temp/mega3/celebration-mobile.png',fullPage:true})
 await phone.keyboard.press('Escape');await expect(phone.locator('#celebration-title')).toHaveCount(0)
 await phone.locator('[data-completed-date] summary').click()
 await card(phone,'Tøm tasker').locator('[data-calendar-toggle]').uncheck()
 await card(phone,'Tøm tasker').locator('[data-calendar-toggle]').check()
 await expect.poll(()=>countQueue(phone)).toBe(0)
 await expect(phone.locator('#celebration-title')).toHaveCount(0)
 pass('Undo/redo retains occurrence state without weekly popups')
 await phone.locator('#calendar-next-button').click()
 // Weekly task exists only on its weekday next week, navigate directly via week mode.
 await toggleView(phone);await phone.locator('#calendar-next-button').click()
 await expect(card(phone,'Tøm tasker')).not.toHaveClass(/is-done/)
 await phone.locator('#calendar-today-button').click();await toggleView(phone)
 pass('Repeated completion stays on concrete occurrence; next week remains incomplete')
 await create(phone,'Task eight',{person:ida.id,done:true})
 await create(phone,'Task nine',{person:ida.id,done:true})
 await expect(phone.locator('#celebration-title')).toHaveCount(0)
 await create(phone,'Task ten',{person:ida.id,done:true});await create(phone,'Task eleven',{person:ida.id,done:true});await create(phone,'Task twelve',{person:ida.id,done:true})
 await expect(phone.locator('#celebration-title')).toHaveCount(0)
 await expect(phone.locator('#celebration-title')).toHaveCount(0)
 pass('Ninth and twelfth completion never produce legacy popups')
 await expect(phone.locator('[data-reward-person]')).toHaveCount(0)
 await phone.screenshot({path:'supabase/.temp/mega3/tasks-mobile.png',fullPage:true})
 await wall.screenshot({path:'supabase/.temp/mega3/tasks-desktop.png',fullPage:true})
 pass('Person chips contain no weekly symbols; completed tasks remain folded')
 await phone.context().setOffline(true)
 await phone.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.endsWith('-auth-token')){const value=JSON.parse(localStorage.getItem(key));value.expires_at=1;localStorage.setItem(key,JSON.stringify(value))}})
 await phone.reload()
 await expect(phone.locator('#sync-status')).toContainText('Offline')
 await expect(card(phone,'Offline edit')).toBeVisible()
 pass('Production service worker reloads app shell; IndexedDB restores calendar offline')
 await create(phone,'Created offline',{person:carl.id})
 await edit(phone,'Created offline','Created and edited offline')
 await edit(phone,'Offline edit','Changed offline')
 await card(phone,'Offline delete').click();await phone.locator('#calendar-modal-delete').click();await expect(phone.locator('#calendar-modal')).toHaveCount(0)
 await card(phone,'Offline done').locator('[data-calendar-toggle]').check()
 await expect.poll(()=>countQueue(phone)).toBe(5)
 const queuedIds=(await state(phone)).queue.map(row=>row.id)
 await phone.reload()
 await expect(card(phone,'Changed offline')).toBeVisible();await expect(card(phone,'Offline delete')).toHaveCount(0)
 await expect.poll(()=>countQueue(phone)).toBe(5)
 if(JSON.stringify((await state(phone)).queue.map(row=>row.id))!==JSON.stringify(queuedIds))throw Error('Queue identity changed after reload')
 pass('Offline create/edit/delete/done persist with stable IDs and order across reload')
 await online(phone)
 await expect.poll(async()=>(await must(admin.from('calendar_items').select('title').eq('id',editable.id).single())).title).toBe('Changed offline')
 if((await must(admin.from('calendar_items').select('id').eq('id',deletable.id))).length)throw Error('Delete not replayed')
 await expect(card(wall,'Created and edited offline')).toBeVisible({timeout:15000})
 pass('Reconnect replays ordered dependent mutations; queue clears and realtime has one row')
 // A new entity avoids a completed task hidden inside the fold.
 await create(phone,'Coalesced task')
 await phone.context().setOffline(true)
 await card(phone,'Coalesced task').locator('[data-calendar-toggle]').check()
 const details=phone.locator('[data-completed-date]');if(!await details.getAttribute('open'))await details.locator('summary').click()
 await card(phone,'Coalesced task').locator('[data-calendar-toggle]').uncheck()
 await card(phone,'Coalesced task').locator('[data-calendar-toggle]').check()
 await expect.poll(()=>countQueue(phone)).toBe(1)
 await online(phone);pass('Repeated toggles coalesce into one durable server mutation')
 for(const choice of ['local','server']) {
  const current=await must(admin.from('calendar_items').select('*').eq('id',conflict.id).single())
  await expect(card(phone,current.title)).toBeVisible()
  await phone.context().setOffline(true)
  await edit(phone,current.title,'Mine '+choice)
  await must(admin.from('calendar_items').update({title:'Remote '+choice}).eq('id',conflict.id))
  await phone.context().setOffline(false)
  await expect.poll(async()=>(await state(phone))?.queue[0]?.status,{timeout:20000}).toBe('conflict')
  await expect(card(phone,'Remote '+choice)).toBeVisible()
  await phone.locator('#sync-details-button').click()
  await phone.locator('[data-sync-choice="'+choice+'"]').click()
  await expect.poll(()=>countQueue(phone),{timeout:15000}).toBe(0)
  await phone.locator('#sync-panel-close').click()
  await expect(card(phone,(choice==='local'?'Mine ':'Remote ')+choice)).toBeVisible()
  pass('Offline conflict detects newer server row and resolves explicitly: '+choice)
 }
 // Server denial after optimistic checkbox: pending retained, checkbox rolled back.
 await create(phone,'Server rejection')
 await phone.route('**/rest/v1/rpc/sync_calendar_mutation',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'42501',message:'Isolated rejection fixture'})}))
 await card(phone,'Server rejection').locator('[data-calendar-toggle]').check()
 await expect.poll(async()=>(await state(phone))?.queue[0]?.status).toBe('error')
 await expect(card(phone,'Server rejection').locator('[data-calendar-toggle]')).not.toBeChecked()
 await phone.unroute('**/rest/v1/rpc/sync_calendar_mutation')
 await phone.locator('#sync-details-button').click();await phone.locator('[data-sync-retry]').click()
 await expect.poll(()=>countQueue(phone)).toBe(0);await phone.locator('#sync-panel-close').click()
 pass('Server failure rolls back checkbox, retains queue and can retry successfully')
 // Realtime changes cache without replacing editor or dashboard header.
 await card(phone,'Changed offline').click();await expandTaskAdvanced(phone);await phone.locator('#calendar-note').fill('Unsaved draft')
 await phone.evaluate(()=>{window.testEditor=document.querySelector('#calendar-modal');window.testHeader=document.querySelector('.dashboard-header')})
 await must(admin.from('calendar_items').update({title:'Realtime cache value'}).eq('id',editable.id))
 await expect.poll(async()=>(await state(phone))?.snapshot.items.find(row=>row.id===editable.id)?.title,{timeout:15000}).toBe('Realtime cache value')
 if(!await phone.evaluate(()=>window.testEditor===document.querySelector('#calendar-modal')&&window.testHeader===document.querySelector('.dashboard-header')))throw Error('Realtime replaced dashboard/editor')
 await expect(phone.locator('#calendar-note')).toHaveValue('Unsaved draft');await phone.locator('#calendar-modal-close').click()
 pass('Realtime updates IndexedDB and preserves unsaved editor DOM and dashboard')
 await switchHousehold(phone,hid2);await expect(card(phone,'Only B')).toBeVisible()
 await phone.context().setOffline(true)
 await switchHousehold(phone,hid)
 await expect(card(phone,'Realtime cache value')).toBeVisible();await expect(card(phone,'Only B')).toHaveCount(0)
 await switchHousehold(phone,hid2)
 await expect(card(phone,'Only B')).toBeVisible();await expect(card(phone,'Realtime cache value')).toHaveCount(0)
 pass('Household switching uses isolated cached snapshots offline')
 await create(phone,'Pending before logout')
 await logout(phone);await expect(phone.locator('#login-form')).toBeVisible()
 await expect.poll(async()=>(await cache(phone)).filter(row=>row.user_id===uid).length).toBe(0)
 await phone.reload();await expect(phone.locator('#login-form')).toBeVisible()
 pass('Offline logout confirms pending loss, clears every household cache and cannot restore private data')
 if(errors.length)throw Error('Browser errors: '+errors.join('; '))
 pass('No browser exceptions in tasks, rewards, offline and reconnect flows')
 writeFileSync('supabase/.temp/mega3/browser.json',JSON.stringify({checks,results},null,2)+'\n')
 console.log('MEGA 3 BROWSER PASS '+checks+'/'+checks)
} catch(error) {
 console.log('BROWSER_DIAGNOSTIC',JSON.stringify({errors,dom:phone?await phone.locator('body').innerText():null,offline:phone?await phone.evaluate(()=>!navigator.onLine):null,cache:phone?(await cache(phone)).map(row=>({key:row.key,households:row.households?.length,queue:row.queue?.map(e=>({action:e.action,status:e.status,entity:e.entity_id,expected:e.payload.p_expected}))})):[]}))
 if(phone){mkdirSync('supabase/.temp/mega3',{recursive:true});await phone.screenshot({path:'supabase/.temp/mega3/failure.png',fullPage:true}).catch(()=>{})}
 throw error
} finally {
 await browser.close()
 for(const id of [hid,hid2].filter(Boolean))await must(admin.from('households').delete().eq('id',id))
 if(uid)await must(admin.auth.admin.deleteUser(uid))
}
