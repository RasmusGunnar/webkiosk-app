import {chromium,expect as baseExpect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {routeTo,openCreate,openSettings} from './browser-actions.mjs'
const expect=baseExpect.configure({timeout:15000}),local=localSupabase(),root='http://127.0.0.1:5178',out='supabase/.temp/multiday40'
const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}}),user=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}})
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.code+': '+r.error.message);return r.data}
const results=[],shots=[],errors=[],pass=name=>{results.push(name);console.log('PASS '+results.length+': '+name)}
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'Europe/Copenhagen'})
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
const realtimeEvents=[]
page.on('websocket',socket=>socket.on('framereceived',frame=>{
 try{
  const message=JSON.parse(frame.payload),event=message.event||message[3],payload=message.payload||message[4]
  realtimeEvents.push({event,keys:Object.keys(payload||{})})
 }catch{realtimeEvents.push({binary:typeof frame.payload!=='string'})}
}))
await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
const shot=async name=>{await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out+'/'+name+'.png'});shots.push(name)}
const fits=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
let uid,hid
try{
 const email='multiday-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1'
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 await must(user.auth.signInWithPassword({email,password}))
 hid=(await must(admin.from('households').insert({name:'Familien · fler-dages review',created_by:uid}).select('id').single())).id
 await must(admin.from('household_members').insert({household_id:hid,user_id:uid,role:'owner'}))
 const people=await must(admin.from('household_people').insert(['Mor','Far','Ida'].map((name,i)=>({household_id:hid,name,color:['#718c61','#ac7858','#6b8da0'][i],role:i<2?'adult':'child'}))).select('*'))
 const feed=await must(admin.from('calendar_feeds').insert({household_id:hid,name:'Google · testkalender',source:'google',feed_url:'https://calendar.google.com/fixture.ics',assigned_person_id:people[0].id,assigned_person_name:'Mor'}).select('*').single())
 const args=['--yes','deno@2.9.6','run','--quiet','--config','supabase/functions/deno.json','--no-lock','--allow-read','supabase/functions/tests/multiday-fixture.ts',feed.id,hid,uid,people[0].id]
 const sourceRows=JSON.parse(execFileSync(process.platform==='win32'?'cmd.exe':'npx',process.platform==='win32'?['/d','/s','/c','npx.cmd '+args.join(' ')]:args,{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}))
 const sync=async(rows=sourceRows,rangeStart='2026-10-01',rangeEnd='2026-11-30')=>{
  const claim=await must(admin.rpc('begin_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid}))
  return must(admin.rpc('apply_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid,p_token:claim.import_token,p_rows:rows,p_range_start:rangeStart,p_range_end:rangeEnd,p_cleanup:true}))
 }
 const records=()=>must(admin.from('calendar_items').select('*').eq('household_id',hid))
 const get=id=>must(admin.from('calendar_items').select('*').eq('id',id).single())
 await sync();let imported=await records(),hotel=imported.find(i=>i.data.uid==='multiday-hotel')
 expect(hotel.end_date).toBe('2026-10-18');expect(hotel.end_time).toBe('11:00:00')
 expect(imported.find(i=>i.data.uid==='multiday-exclusive').end_date).toBe('2026-10-18')
 pass('Actual ICS parser → local transactional import → typed interval persisted, including exclusive all-day DTEND')
 for(let i=0;i<3;i++)await sync()
 expect((await records()).length).toBe(sourceRows.length);expect((await get(hotel.id)).updated_at).toBe(hotel.updated_at)
 pass('Repeated sync keeps same IDs, zero duplicates, no unchanged-source realtime storm')
 await must(user.rpc('edit_imported_calendar_item',{p_id:hotel.id,p_expected:hotel.updated_at,p_patch:{title:'Hotelophold',location:'Aarhus · lokalt',note:'Husk badetøj',personIds:people.slice(0,2).map(p=>p.id)},p_hide_scope:null}))
 const corrected=structuredClone(sourceRows),hotelSource=corrected.find(r=>r.payload.data.uid==='multiday-hotel')
 hotelSource.payload.data.endDate='2026-10-19';hotelSource.payload.end_date='2026-10-19'
 await sync(corrected);hotel=await get(hotel.id);expect(hotel.end_date).toBe('2026-10-19');expect(hotel.note).toBe('Husk badetøj');expect(hotel.person_ids.length).toBe(2)
 await sync();hotel=await get(hotel.id);expect(hotel.end_date).toBe('2026-10-18');expect(hotel.note).toBe('Husk badetøj')
 pass('Source interval corrections retain ID and local title/location/note/multi-person overrides')
 // Feed cleanup must include ongoing rows that began before the import window.
 const ongoing=sourceRows.filter(r=>r.payload.date<'2026-10-17'&&r.payload.data.endDate>='2026-10-17')
 await sync(ongoing,'2026-10-17','2026-10-17');expect((await get(hotel.id)).data.importSourceRemoved).toBe(false)
 await sync([],'2026-10-17','2026-10-17');expect((await get(hotel.id)).data.importSourceRemoved).toBe(true)
 await sync();expect((await get(hotel.id)).data.importSourceRemoved).toBe(false)
 pass('Ongoing import window and source cancellation/return preserve interval and identity')
 const recurring=(await records()).find(i=>i.data.uid==='multiday-recurring')
 await must(user.rpc('edit_imported_calendar_item',{p_id:recurring.id,p_expected:recurring.updated_at,p_patch:{},p_hide_scope:'series'}));await sync()
 expect((await records()).filter(i=>i.data.uid==='multiday-recurring').every(i=>i.data.importHidden)).toBe(true)
 await must(user.rpc('restore_calendar_import',{p_household_id:hid,p_feed_id:feed.id,p_uid:'multiday-recurring',p_occurrence:'*'}))
 expect((await records()).filter(i=>i.data.uid==='multiday-recurring').every(i=>!i.data.importHidden&&i.end_date>i.date)).toBe(true)
 pass('Whole recurring multi-day series hide survives sync; restore retains every occurrence interval')
 const seed=(title,date,type='Aktivitet',extra={})=>({id:randomUUID(),household_id:hid,created_by:uid,title,date,type,time:'',person:'Alle',data:{},...extra})
 const legacy=seed('Fest','2026-10-17','Aktivitet',{time:'22:00',duration_min:360})
 await must(admin.from('calendar_items').insert([
  seed('Tandlæge','2026-10-06','Aktivitet',{time:'09:00'}),seed('Spejder','2026-10-08','Fritidsinteresse',{time:'17:00'}),
  seed('Dæk bordet','2026-10-05','Opgave'),seed('Pasta med grønt','2026-10-05','Madplan'),
 ]))
 const invalid=await user.from('calendar_items').insert(seed('Ugyldig','2026-10-16','Aktivitet',{end_date:'2026-10-15'}))
 expect(invalid.error?.code).toBe('22023');pass('Server rejects invalid interval independently of editor')
 await page.clock.setFixedTime(new Date('2026-10-16T09:00:00+02:00'))
 await page.goto(root);await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click();await expect(page.locator('.product-nav')).toBeVisible()
 await routeTo(page,'calendar');await expect(page.locator('[data-person-filter="'+people[1].id+'"]')).toBeVisible()
 const cards=(id=hotel.id,target=page)=>target.locator('.week-grid [data-calendar-item="'+id+'"]')
 const onDay=(id,date,target=page)=>target.locator('.day-card[data-day="'+date+'"] [data-calendar-item="'+id+'"]')
 const filter=async id=>{await page.locator('[data-person-filter="'+id+'"]').click()}
 const noSpans=async()=>{await expect(page.locator('.week-span,.week-spans,.span-week-headings,.has-multiday')).toHaveCount(0);await expect(page.locator('.week-grid> *')).toHaveCount(7);expect(await page.locator('.week-grid>.day-card').evaluateAll(els=>new Set(els.map(e=>Math.round(e.getBoundingClientRect().top))).size)).toBe(1)}
 await page.locator('#calendar-prev-button').click();await noSpans();await expect(page.locator('.calendar-multiday')).toHaveCount(0);await shot('daily-desktop-no-multiday');await page.locator('#calendar-today-button').click()
 await filter(people[1].id);await expect(cards()).toHaveCount(4);await noSpans();await fits()
 const baselineIds=(await records()).map(r=>r.id).sort()
 expect(await cards().evaluateAll(els=>els.map(e=>e.closest('[data-day]').dataset.day))).toEqual(['2026-10-15','2026-10-16','2026-10-17','2026-10-18'])
 expect(await cards().evaluateAll(els=>els.map(e=>e.dataset.eventState))).toEqual(['START','MIDDLE','MIDDLE','END'])
 expect(await cards().evaluateAll(els=>new Set(els.map(e=>e.dataset.calendarItem)).size)).toBe(1)
 expect(await cards().evaluateAll(els=>els.every(e=>e.getBoundingClientRect().left>=e.closest('.day-card').getBoundingClientRect().left&&e.getBoundingClientRect().right<=e.closest('.day-card').getBoundingClientRect().right))).toBe(true)
 await shot('daily-desktop-hotel')
 for(const day of ['2026-10-15','2026-10-16','2026-10-17','2026-10-18']){
  await onDay(hotel.id,day).click();await expect(page.locator('#import-name')).toHaveValue('Hotelophold');await expect(page.locator('#import-note')).toHaveValue('Husk badetøj');await page.keyboard.press('Escape')
 }
 expect((await records()).map(r=>r.id).sort()).toEqual(baselineIds)
 pass('One DB event renders on four independent days; all four clicks open the same editor without creating rows')
 await onDay(hotel.id,'2026-10-16').click();await page.locator('#import-name').fill('Hotelophold · familie');await page.locator('#import-note').fill('Husk badetøj og håndklæder');await page.locator('.imported-editor .stack-form button[type=submit]').click();await expect(page.locator('.imported-editor')).toHaveCount(0)
 await expect(cards()).toHaveText(Array(4).fill(/Hotelophold · familie/));expect((await get(hotel.id)).note).toBe('Husk badetøj og håndklæder');expect((await records()).map(r=>r.id).sort()).toEqual(baselineIds)
 await onDay(hotel.id,'2026-10-17').click();await page.locator('#import-name').fill('Hotelophold');await page.locator('.imported-editor .stack-form button[type=submit]').click();await expect(page.locator('.imported-editor')).toHaveCount(0)
 await filter(people[2].id);await expect(cards()).toHaveCount(0);await filter(people[0].id);await expect(cards()).toHaveCount(4);await filter(people[1].id)
 pass('Middle-day edit updates all four views; Far/Mor see the event, Ida does not')
 await must(admin.from('calendar_items').insert([legacy,seed('Spejder','2026-10-15','Aktivitet',{time:'17:00'}),seed('Fodbold','2026-10-16','Fritidsinteresse',{time:'16:00'}),seed('Dæk bordet','2026-10-16','Opgave'),seed('Pasta med grønt','2026-10-16','Madplan'),seed('Idas fødselsdag','2026-10-18','Fødselsdag')]))
 await expect(page.locator('.compact-task')).toHaveCount(1);await shot('daily-desktop-hotel-and-activities')
 const holiday=(await records()).find(i=>i.data.uid==='multiday-holiday')
 await must(user.rpc('edit_imported_calendar_item',{p_id:holiday.id,p_expected:holiday.updated_at,p_patch:{personIds:people.slice(0,2).map(p=>p.id)},p_hide_scope:null}))
 await expect(cards(holiday.id)).toHaveCount(3);await shot('daily-desktop-simultaneous')
 await page.locator('#calendar-next-button').click();await expect(cards(holiday.id)).toHaveCount(2);await expect(onDay(holiday.id,'2026-10-20')).toContainText('Slutter i dag');await noSpans();await shot('daily-desktop-week-boundary');await page.locator('#calendar-today-button').click()
 await expect(onDay(legacy.id,'2026-10-17')).toContainText('22:00 · til søn.');await expect(onDay(legacy.id,'2026-10-18')).toContainText('Slutter 04:00');await shot('daily-desktop-timed-overnight')
 pass('Simultaneous, all-day, cross-week and Sat22–Sun04 events stay inside their daily columns')
 await filter('Alle')
 const extras=Array.from({length:8},(_,i)=>seed('Ekstra aftale '+(i+1),'2026-10-16','Aktivitet',{time:'12:00'}))
 await must(admin.from('calendar_items').insert(extras))
 const friday=page.locator('.week-grid>[data-day="2026-10-16"]')
 await expect(friday.locator('[data-day-detail]')).toBeVisible()
 const shown=await friday.locator('[data-calendar-item],[data-task-detail]').count(),hidden=Number((await friday.locator('[data-day-detail]').innerText()).match(/\d+/)[0])
 expect(shown).toBeLessThanOrEqual(6);await expect(onDay(hotel.id,'2026-10-16')).toBeVisible()
 expect(await friday.locator('.day-sections').evaluate(e=>e.lastElementChild.classList.contains('day-meals'))).toBe(true)
 await shot('daily-desktop-overflow');await friday.locator('[data-day-detail]').click()
 await expect(page.locator('.full-day-detail [data-calendar-item],.full-day-detail [data-task-detail]')).toHaveCount(shown+hidden)
 await expect(page.locator('.full-day-detail [data-calendar-item="'+hotel.id+'"]')).toHaveCount(1);await shot('daily-day-detail');await page.keyboard.press('Escape')
 await must(admin.from('calendar_items').delete().in('id',extras.map(r=>r.id)));await filter(people[1].id)
 pass('Multi-day points share existing six-item budget, exact overflow count, day-detail and meals-last structure')
 await routeTo(page,'today');await expect(page.locator('[data-calendar-item="'+hotel.id+'"]')).toContainText('Fortsætter');await shot('daily-today')
 await routeTo(page,'calendar')
 await openCreate(page);await page.locator('#calendar-title').fill('Familiebesøg');await page.locator('#calendar-date').fill('2026-10-15');await page.locator('#calendar-end-date').fill('2026-10-18');await page.locator('#calendar-time').fill('15:00');await page.locator('#calendar-end-time').fill('11:00');await shot('daily-manual-editor')
 await page.locator('#calendar-end-date').fill('2026-10-14');await page.locator('#calendar-modal-form button[type=submit]').click();await expect(page.locator('#calendar-editor-message')).toContainText('Slutdato')
 await page.locator('#calendar-end-date').fill('2026-10-18');await page.locator('#calendar-modal-form button[type=submit]').click();await expect(page.locator('#calendar-modal')).toHaveCount(0)
 const manual=(await records()).find(r=>r.title==='Familiebesøg');expect(manual.end_date).toBe('2026-10-18')
 await page.reload();await routeTo(page,'calendar');await filter(people[1].id);await expect(cards(manual.id)).toHaveCount(4)
 pass('Manual timed interval validates, persists once and reloads as four daily points')
 await onDay(manual.id,'2026-10-16').click();await page.locator('#calendar-all-day').check();await page.locator('#calendar-modal-form button[type=submit]').click();await expect(page.locator('#calendar-modal')).toHaveCount(0)
 expect((await get(manual.id)).all_day).toBe(true);expect((await get(manual.id)).time).toBe('')
 pass('Heldag keeps the inclusive interval without time labels')
 const observer=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'Europe/Copenhagen'})
 observer.on('pageerror',e=>errors.push(e.message))
 await observer.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
 await observer.clock.setFixedTime(new Date('2026-10-16T09:00:00+02:00'))
 await observer.goto(root);await observer.locator('#email').fill(email);await observer.locator('#password').fill(password);await observer.locator('#login-form button[type=submit]').click();await routeTo(observer,'calendar');await observer.locator('[data-person-filter="'+people[1].id+'"]').click()
 await expect(cards(manual.id,observer)).toHaveCount(4)
 await page.context().setOffline(true);await onDay(manual.id,'2026-10-16').click();await page.locator('#calendar-title').fill('Familiebesøg · opdateret');await page.locator('#calendar-end-date').fill('2026-10-19');await page.locator('#calendar-modal-form button[type=submit]').click();await expect(page.locator('#calendar-modal')).toHaveCount(0)
 await expect(cards(manual.id)).toHaveText(Array(4).fill(/opdateret/))
 await page.context().setOffline(false);await expect.poll(async()=>(await get(manual.id)).end_date).toBe('2026-10-19')
 await expect(page.locator('#sync-status')).not.toContainText(/venter|Synkroniserer|Offline/)
 await expect(cards(manual.id,observer)).toHaveText(Array(4).fill(/opdateret/))
 await must(admin.from('calendar_items').update({title:'Familiebesøg · live',end_date:'2026-10-18'}).eq('id',manual.id))
 await expect(cards(manual.id,observer)).toHaveText(Array(4).fill(/live/))
 await page.reload();await routeTo(page,'calendar');await filter(people[1].id);await expect(cards(manual.id)).toHaveText(Array(4).fill(/live/))
 await observer.close()
 pass('Offline replay and realtime update every daily view while preserving one DB ID')
 await onDay(hotel.id,'2026-10-17').click();await page.locator('[data-import-hide]').click();await page.locator('[data-hide-scope=occurrence]').check();await page.locator('[data-scope-confirm]').click();await expect(cards()).toHaveCount(0)
 expect((await records()).filter(r=>r.id===hotel.id).length).toBe(1)
 await must(user.rpc('restore_calendar_import',{p_household_id:hid,p_feed_id:feed.id,p_uid:'multiday-hotel',p_occurrence:'single'}));await expect(cards()).toHaveCount(4)
 pass('Hiding from a middle day removes all four points; restore returns the same single stored event')
 for(const [width,height] of [[375,667],[390,844],[430,932]]){
  await page.setViewportSize({width,height});await routeTo(page,'calendar');await page.locator('[data-calendar-view=day]').click();await page.locator('#calendar-today-button').click();await filter(people[1].id)
  await expect(onDay(hotel.id,'2026-10-16')).toContainText('Fortsætter');await fits();await shot('daily-mobile-middle-'+width)
  if(width===390){
   await page.locator('#calendar-prev-button').click();await expect(onDay(hotel.id,'2026-10-15')).toHaveAttribute('data-event-state','START');await shot('daily-mobile-start')
   await page.locator('#calendar-next-button').click();await page.locator('#calendar-next-button').click();await page.locator('#calendar-next-button').click();await expect(onDay(hotel.id,'2026-10-18')).toContainText('Slutter 11:00');await shot('daily-mobile-end')
   await onDay(manual.id,'2026-10-18').click();await expect(page.locator('#calendar-end-date')).toHaveValue('2026-10-18');await shot('daily-mobile-editor');await page.keyboard.press('Escape')
  }
  await page.locator('[data-calendar-view=week]').click();await expect(cards()).toHaveCount(4);await fits()
 }
 pass('375/390/430px: compact start/middle/end, same editor, four weekly points and no horizontal overflow')
 await must(admin.from('calendar_items').delete().eq('id',manual.id))
 await page.setViewportSize({width:1920,height:1080});await openSettings(page,'device');await page.locator('#device-kiosk').check();await page.locator('#device-pin').fill('1948');await page.locator('#device-settings-form button[type=submit]').click();await routeTo(page,'calendar');await page.locator('#calendar-today-button').click();await filter(people[1].id)
 for(const [width,height] of [[1920,1080],[1280,800],[1024,600]]){
  await page.setViewportSize({width,height});if(width<1500)await expect(page.locator('body')).toHaveAttribute('data-density','compact')
  await noSpans();await fits();await expect(cards()).toHaveCount(4);await shot('daily-kiosk-hotel-'+width)
  expect(await page.locator('.week-grid .day-sections').evaluateAll(els=>els.every(e=>e.scrollHeight<=e.clientHeight+1))).toBe(true)
  expect(await page.locator('.week-grid .compact-activity,.week-grid .compact-task,.week-grid .day-meals').evaluateAll(els=>els.every(e=>e.getBoundingClientRect().bottom<document.querySelector('.product-nav').getBoundingClientRect().top))).toBe(true)
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true)
 }
 expect(errors).toEqual([]);pass('Kiosk retains seven independent columns and bounded rows at 1920/1280/1024; no uncaught browser errors')
 writeFileSync(out+'/results.json',JSON.stringify({pass:true,results,shots},null,2))
 writeFileSync(out+'/review.html','<!doctype html><html lang="da"><meta charset="utf-8"><title>Kalender · kompakte dagspunkter</title><style>body{font:16px system-ui;margin:28px;background:#f3f5ee;color:#294631}nav{display:flex;gap:12px;flex-wrap:wrap}section{margin:32px 0}img{max-width:100%;border:1px solid #c2cdbb;border-radius:12px}a{color:inherit}</style><h1>Flerdagesaftaler · ét kompakt punkt pr. dag</h1><p>Én gemt aftale, samme ID på alle dage. Polish24 dagskolonner, almindeligt overflow og mad nederst. Isolerede lokale testdata. Tidligere span/lane-layout er udgået og indgår ikke i dette review.</p><nav>'+shots.map(n=>'<a href="#'+n+'">'+n+'</a>').join('')+'</nav>'+shots.map(n=>'<section id="'+n+'"><h2>'+n+'</h2><a href="'+n+'.png"><img loading="lazy" src="'+n+'.png" alt="'+n+'"></a></section>').join('')+'</html>')
 console.log('MULTIDAY DAILY PASS '+results.length+' checks; '+shots.length+' screenshots')
}catch(error){await page.screenshot({path:out+'/daily-failure.png',fullPage:true}).catch(()=>{});throw error}
finally{await browser.close();if(hid)await admin.from('households').delete().eq('id',hid);if(uid)await admin.auth.admin.deleteUser(uid)}
