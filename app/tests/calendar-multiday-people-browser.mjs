// Run from repo root: node app/tests/calendar-multiday-people-browser.mjs
// Only isolated LOCAL fixtures. Changes are made through the real editors.
import {chromium,expect as baseExpect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {addDays} from '../src/lib/calendar-dates.js'
import {materialize} from '../src/lib/calendar-semantics.js'
import {routeTo,openCreate} from './browser-actions.mjs'
const expect=baseExpect.configure({timeout:15000}),local=localSupabase(),root='http://127.0.0.1:5178',out='supabase/.temp/multiday40'
const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const must=async q=>{const result=await q;if(result.error)throw Error(result.error.code+': '+result.error.message);return result.data}
const checks=[],evidence=[],errors=[],pass=name=>{checks.push(name);console.log('PASS '+checks.length+': '+name)}
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'Europe/Copenhagen',serviceWorkers:'block'})
page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
mkdirSync(out,{recursive:true})
let uid,hid,mor,far
try{
 const runtime=await fetch(root+'/src/lib/supabase.js').then(r=>r.text())
 expect(runtime.match(/"VITE_SUPABASE_URL":\s*"([^"]+)"/)?.[1]).toBe(local.API_URL)
 const email='multiday-people-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1'
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 hid=(await must(admin.from('households').insert({name:'Multi-day person regression',created_by:uid}).select('id').single())).id
 await must(admin.from('household_members').insert({household_id:hid,user_id:uid,role:'owner'}))
 const people=await must(admin.from('household_people').insert([{name:'Mor',color:'#718c61'},{name:'Far',color:'#ac7858'}].map(p=>({...p,household_id:hid,role:'adult'}))).select('*'))
 mor=people.find(p=>p.name==='Mor');far=people.find(p=>p.name==='Far')
 const records=()=>must(admin.from('calendar_items').select('*').eq('household_id',hid).order('date'))
 const ids=async()=>(await records()).map(r=>r.id).sort()
 const cards=id=>page.locator('.week-grid [data-calendar-item="'+id+'"]')
 const onDay=(id,date)=>page.locator('.week-grid>[data-day="'+date+'"] [data-calendar-item="'+id+'"]')
 const filter=id=>page.locator('[data-person-filter="'+id+'"]').click()
 const days=start=>Array.from({length:4},(_,i)=>addDays(start,i))
 const showWeek=async(start,reload=false)=>{
  await page.clock.setFixedTime(new Date(addDays(start,1)+'T12:00:00+02:00'))
  if(reload)await page.reload()
  await routeTo(page,'calendar');await page.locator('#calendar-today-button').click()
  await expect(page.locator('[data-person-filter="'+mor.id+'"]')).toBeVisible();await filter('Alle')
 }
 const assertFour=async(id,start,person,label)=>{
  await expect(cards(id)).toHaveCount(4)
  expect(await cards(id).evaluateAll(els=>els.map(el=>el.closest('[data-day]').dataset.day))).toEqual(days(start))
  expect(await cards(id).evaluateAll(els=>[...new Set(els.map(el=>el.dataset.calendarItem))])).toEqual([id])
  for(const date of days(start))await expect(onDay(id,date)).toHaveAttribute('aria-label',new RegExp(' · '+(person?.name||'Alle')+'$'))
  for(const candidate of [mor,far]){
   await filter(candidate.id);await expect(cards(id)).toHaveCount(!person||candidate.id===person.id?4:0)
  }
  await filter('Alle')
  evidence.push({label,start,days:days(start),eventId:id,person:person?.name||'Alle',dailyPoints:4})
 }
 const setPerson=async(person,imported)=>{
  const selector=imported?'.import-people input[name=personIds]':'#calendar-modal-form input[name=people]'
  await expect(page.locator(selector+'[value="'+person.id+'"]')).toBeVisible()
  if(imported){for(const box of await page.locator(selector).all())await box.setChecked(await box.getAttribute('value')===person.id)}
  else{
   // Selecting Alle clears old choices; selecting the target then clears Alle.
   await page.locator(selector+'[value=Alle]').check();await page.locator(selector+'[value="'+person.id+'"]').check()
  }
 }
 const editFrom=async(id,day,person,{imported=false,scope=null}={})=>{
  await onDay(id,day).click();await setPerson(person,imported)
  if(!imported&&scope)await page.locator('[name=repeatScope][value='+scope+']').check()
  await page.locator(imported?'.imported-editor .stack-form button[type=submit]':'#calendar-modal-form button[type=submit]').click()
  if(imported&&scope){await page.locator('[name=importScope][value='+scope+']').check();await page.locator('[data-scope-confirm]').click()}
  await expect(page.locator(imported?'.imported-editor':'#calendar-modal')).toHaveCount(0)
  await expect(page.locator('#sync-status')).not.toContainText(/venter|Synkroniserer|Offline/)
 }
 const createManual=async(title,start,recurring=false)=>{
  await openCreate(page);await page.locator('#calendar-title').fill(title);await page.locator('#calendar-date').fill(start)
  await page.locator('#calendar-end-date').fill(addDays(start,3));await page.locator('#calendar-all-day').check()
  await page.locator('[name=people][value=Alle]').check()
  if(recurring)await page.locator('[name=repeatWeekly]').check()
  await page.locator('#calendar-modal-form button[type=submit]').click();await expect(page.locator('#calendar-modal')).toHaveCount(0)
  await expect.poll(async()=>(await records()).length).toBe(1)
  return (await records())[0]
 }
 const clearFixtures=async()=>{
  // This household was created above solely for this test.
  await must(admin.from('calendar_items').delete().eq('household_id',hid));await page.reload();await showWeek('2026-10-15')
 }
 await page.clock.setFixedTime(new Date('2026-10-16T12:00:00+02:00'))
 await page.goto(root);await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click()
 await showWeek('2026-10-15')
 const hotel=await createManual('Hotelophold','2026-10-15')
 await assertFour(hotel.id,'2026-10-15',null,'Manual initial Alle')
 for(const [person,day] of [[mor,'2026-10-16'],[far,'2026-10-17']]){
  await editFrom(hotel.id,day,person)
  for(const reload of [false,true]){
   if(reload)await showWeek('2026-10-15',true)
   await assertFour(hotel.id,'2026-10-15',person,'Manual '+person.name+(reload?' reload':' immediate'))
   const stored=await records();expect(stored).toHaveLength(1);expect(stored[0].id).toBe(hotel.id);expect(stored[0].person_ids).toEqual([person.id])
  }
  pass('Hotelophold: middle-day change to '+person.name+' updates Thu/Fri/Sat/Sun immediately and after reload; exactly one unchanged DB ID')
 }
 await clearFixtures()
 const feed=await must(admin.from('calendar_feeds').insert({household_id:hid,name:'Local regression feed',source:'google',feed_url:'https://calendar.google.com/fixture.ics'}).select('*').single())
 const source=(start,series,recurring)=>{const slot=recurring?start+'T14:00:00.000Z':null;return {externalKey:JSON.stringify(['google',feed.id,series,slot||'single']),payload:{title:'Hotelophold · importeret',date:start,time:'16:00',data:{uid:series,recurrenceId:slot,occurrenceDate:start,endDate:addDays(start,3),endTime:'11:00',allDay:false,timeZone:'Europe/Copenhagen'}}}}
 const sync=async rows=>{const claim=await must(admin.rpc('begin_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid}));await must(admin.rpc('apply_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid,p_token:claim.import_token,p_rows:rows,p_range_start:'2026-10-01',p_range_end:'2026-11-30',p_cleanup:false}))}
 await sync([source('2026-10-15','hotel-single',false)]);await showWeek('2026-10-15',true)
 const importedHotel=(await records())[0];await assertFour(importedHotel.id,'2026-10-15',null,'Imported initial Alle')
 for(const [person,day] of [[mor,'2026-10-16'],[far,'2026-10-17']]){
  await editFrom(importedHotel.id,day,person,{imported:true})
  for(const reload of [false,true]){
   if(reload)await showWeek('2026-10-15',true)
   await assertFour(importedHotel.id,'2026-10-15',person,'Imported '+person.name+(reload?' reload':' immediate'))
   const stored=await records();expect(stored).toHaveLength(1);expect(stored[0].id).toBe(importedHotel.id);expect(stored[0].person_ids).toEqual([person.id])
  }
  pass('Imported hotel: '+person.name+' saved from a different day applies to all four views immediately/reload; exactly one DB row')
 }
 await clearFixtures()
 const starts=['2026-10-08','2026-10-15','2026-10-22'],sourceRows=starts.map(start=>source(start,'hotel-recurring',true))
 await sync(sourceRows);const recurringRows=await records(),originalIds=await ids(),selected=recurringRows.find(r=>r.date===starts[1])
 for(const [scope,person,expected] of [
  ['occurrence',mor,[null,mor,null]],['future',far,[null,far,far]],['series',mor,[mor,mor,mor]],
 ]){
  await showWeek(starts[1],true);await editFrom(selected.id,addDays(starts[1],scope==='future'?2:1),person,{imported:true,scope})
  // All four selected-day points update before navigation or reload.
  await assertFour(selected.id,starts[1],person,'Recurring '+scope+' immediate')
  for(let i=0;i<starts.length;i++){
   await showWeek(starts[i],true);await assertFour(recurringRows.find(r=>r.date===starts[i]).id,starts[i],expected[i],'Recurring '+scope+' reload '+starts[i])
  }
  expect(await ids()).toEqual(originalIds)
  for(const row of await records())expect(row.person_ids).toEqual(expected[starts.indexOf(row.date)]?[expected[starts.indexOf(row.date)].id]:[])
  await sync(sourceRows);expect(await ids()).toEqual(originalIds)
  for(let i=0;i<starts.length;i++){await showWeek(starts[i],true);await assertFour(recurringRows.find(r=>r.date===starts[i]).id,starts[i],expected[i],'Recurring '+scope+' source replay')}
  pass('Imported '+scope+': correct person on complete earlier/selected/future four-day occurrences after reload and sync; three stable DB rows')
 }
 // Manual recurrence stores a base plus occurrence overrides/series splits.
 // Verify the existing model creates those records, never one record per day.
 await clearFixtures()
 for(const scope of ['one','future','series']){
  const base=await createManual('Hotelophold · gentaget',starts[0],true)
  await showWeek(starts[1]);let rendered=materialize(await records(),days(starts[1]),{milestones:false})
  expect(rendered).toHaveLength(1);const selectedId=rendered[0].id
  await assertFour(selectedId,starts[1],null,'Manual recurring '+scope+' before')
  await editFrom(selectedId,addDays(starts[1],1),mor,{scope})
  rendered=materialize(await records(),days(starts[1]),{milestones:false});expect(rendered).toHaveLength(1)
  await assertFour(rendered[0].id,starts[1],mor,'Manual recurring '+scope+' immediate')
  const expected=scope==='one'?[null,mor,null]:scope==='future'?[null,mor,mor]:[mor,mor,mor]
  for(let i=0;i<starts.length;i++){
   await showWeek(starts[i],true);const occurrences=materialize(await records(),days(starts[i]),{milestones:false})
   expect(occurrences).toHaveLength(1);await assertFour(occurrences[0].id,starts[i],expected[i],'Manual recurring '+scope+' reload')
  }
  const stored=await records();expect(stored).toHaveLength(scope==='series'?1:2);expect(stored.some(r=>r.id===base.id)).toBe(true)
  expect(stored.every(row=>row.end_date===addDays(row.date,3))).toBe(true)
  pass('Manual '+scope+': all daily points share one occurrence; expected base/override/split only, no per-day DB rows')
  await clearFixtures()
 }
 expect(errors).toEqual([]);pass('No uncaught browser errors')
 writeFileSync(out+'/people-results.json',JSON.stringify({pass:true,localOnly:true,checks,evidence},null,2))
 console.log('MULTIDAY PEOPLE PASS '+checks.length+' checks; '+evidence.length+' four-day assertions')
}catch(error){await page.screenshot({path:out+'/people-failure.png',fullPage:true}).catch(()=>{});throw error}
finally{
 await browser.close()
 if(hid)await must(admin.from('households').delete().eq('id',hid))
 if(uid)await must(admin.auth.admin.deleteUser(uid))
}
