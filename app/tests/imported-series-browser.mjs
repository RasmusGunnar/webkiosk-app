import {chromium,expect as baseExpect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {routeTo,openSettings} from './browser-actions.mjs'
const expect=baseExpect.configure({timeout:15000}),local=localSupabase(),out='supabase/.temp/multiday40'
const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}}),user=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}})
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.code+': '+r.error.message);return r.data}
const checks=[],shots=[],errors=[],pass=name=>{checks.push(name);console.log('PASS '+checks.length+': '+name)}
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'Europe/Copenhagen',serviceWorkers:'block'})
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
await page.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
const shot=async name=>{await page.screenshot({path:out+'/'+name+'.png'});shots.push(name)}
let uid,hid
try{
 const email='series-browser-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1'
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 await must(user.auth.signInWithPassword({email,password}))
 hid=(await must(admin.from('households').insert({name:'Familien · serier',created_by:uid}).select('id').single())).id
 await must(admin.from('household_members').insert({household_id:hid,user_id:uid,role:'owner'}))
 const people=await must(admin.from('household_people').insert(['Mor','Jakob','Far'].map((name,i)=>({household_id:hid,name,color:['#718c61','#6b8da0','#ac7858'][i],role:i===1?'child':'adult'}))).select('*'))
 const feed=await must(admin.from('calendar_feeds').insert({household_id:hid,name:'Google · familiens kalender',source:'google',feed_url:'https://calendar.google.com/fixture.ics',assigned_person_id:people[0].id,assigned_person_name:'Mor'}).select('*').single())
 const payload=(date,series='saxofon',extra={})=>{const slot=date+'T14:00:00.000Z';return {externalKey:JSON.stringify(['google',feed.id,series,slot]),payload:{date,time:'16:00',title:series==='saxofon'?'Saxofon':'Sommerhus',note:'Husk nøgler',...extra,data:{uid:series,recurrenceId:slot,timeZone:'Europe/Copenhagen',occurrenceDate:date,endDate:date,endTime:'17:00',location:'Musikskolen',...extra.data}}}}
 const rows=['08','15','22'].map(day=>payload('2026-10-'+day))
 const summer=['09','16','23'].map(day=>payload('2026-10-'+day,'sommerhus',{data:{endDate:'2026-10-'+String(Number(day)+2),endTime:'11:00',location:'Sommerhuset',durationMin:2580}}))
 const sync=async data=>{const claim=await must(admin.rpc('begin_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid}));return must(admin.rpc('apply_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid,p_token:claim.import_token,p_rows:data,p_range_start:'2026-10-01',p_range_end:'2026-11-30',p_cleanup:false}))}
 const records=()=>must(admin.from('calendar_items').select('*').eq('household_id',hid).order('date'))
 const get=async(date,series='saxofon')=>(await records()).find(r=>r.data.uid===series&&r.data.occurrenceDate===date)
 const rules=()=>must(admin.from('calendar_import_overrides').select('*').eq('household_id',hid))
 const hide=async(date,scope='occurrence')=>{const row=await get(date);await must(user.rpc('edit_imported_calendar_scope',{p_id:row.id,p_expected:row.updated_at,p_patch:{},p_scope:scope,p_hide:true}))}
 await sync([...rows,...summer])
 const item=await get('2026-10-15'),stay=await get('2026-10-16','sommerhus')
 await page.clock.setFixedTime(new Date('2026-10-15T12:00:00+02:00'))
 await page.goto('http://127.0.0.1:5178')
 await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click()
 await routeTo(page,'calendar')
 const card=id=>page.locator('[data-calendar-item="'+id+'"]').first()
 const open=async(id=item.id)=>{await card(id).click();await expect(page.locator('.imported-editor .stack-form')).toBeVisible()}
 const save=()=>page.locator('.imported-editor .stack-form button[type=submit]').click()
 const scope=async value=>{await page.locator('input[name=importScope][value='+value+']').check();await page.locator('[data-scope-confirm]').click();await expect(page.locator('.imported-editor')).toHaveCount(0)}
 const setPerson=async id=>{for(const box of await page.locator('.import-people input').all())await box.setChecked(await box.getAttribute('value')===id)}
 const hiddenList=async()=>{await openSettings(page,'feeds');await page.locator('#hidden-imports-open').click();await expect(page.locator('.hidden-imports')).toBeVisible()}
 const restore=async label=>{const rule=page.locator('.hidden-imports article').filter({hasText:label});await expect(rule).toHaveCount(1);await rule.locator('[data-restore-import]').click();await expect(rule).toHaveCount(0)}
 const backCalendar=async()=>{await page.keyboard.press('Escape');await routeTo(page,'calendar');await page.locator('#calendar-today-button').click()}
 await open();await save();await expect(page.locator('.imported-editor')).toHaveCount(0);expect((await rules()).length).toBe(0)
 pass('Unchanged save closes without a new rule or unnecessary scope dialog')
 await expect(page.locator('[data-person-filter="'+people[0].id+'"]')).toBeVisible()
 await open();await setPerson(people[1].id);await save()
 await expect(page.locator('#import-title')).toHaveText('Hvor skal ændringen gælde?')
 await expect(page.locator('input[name=importScope]')).toHaveCount(3);await expect(page.locator('input[value=occurrence]')).toBeChecked()
 await shot('series-edit-scope');await page.locator('input[name=importScope][value=future]').check();await shot('series-future-selected')
 await page.locator('[data-scope-back]').click();await expect(page.locator('.import-people input[value="'+people[1].id+'"]')).toBeChecked();await save();await scope('future')
 expect((await get('2026-10-08')).person_ids).toEqual([people[0].id]);expect((await get('2026-10-22')).person_ids).toEqual([people[1].id])
 await page.reload();await routeTo(page,'calendar');await open();await expect(page.locator('.import-people input[value="'+people[1].id+'"]')).toBeChecked();await page.keyboard.press('Escape')
 pass('Edit scope/back retains draft; future assignment survives reload and leaves earlier dates unchanged')
 await sync([payload('2026-10-15','saxofon',{title:'Saxofon · ny sal',note:'Kildeopdatering',data:{location:'Sal 2'}}),payload('2026-10-29')])
 await expect(card(item.id)).toContainText('Saxofon · ny sal');expect((await get('2026-10-29')).person_ids).toEqual([people[1].id])
 await open();await expect(page.locator('#import-location')).toHaveValue('Sal 2');await expect(page.locator('#import-note')).toHaveValue('Kildeopdatering')
 await page.locator('#import-note').fill('Jakob tager saxofonen med');await save();await scope('future')
 expect((await get('2026-10-22')).note).toBe('Jakob tager saxofonen med')
 pass('Real import RPC/realtime updates untouched source fields; a newly imported occurrence inherits future people and note')
 await hide('2026-10-08')
 await open();await page.locator('[data-import-hide]').click()
 await expect(page.locator('#import-title')).toHaveText('Hvad vil du fjerne fra Familiekalenderen?')
 await page.locator('input[name=importScope][value=future]').check();await shot('series-hide-scope');await scope('future')
 await expect(card(item.id)).toHaveCount(0)
 await sync([payload('2026-11-05')]);expect((await get('2026-11-05')).data.importHidden).toBe(true)
 await hiddenList();await expect(page.locator('.hidden-imports')).toContainText('Skjult fra 15. oktober 2026');await expect(page.locator('.hidden-imports article')).toHaveCount(2)
 await page.locator('.hidden-imports').scrollIntoViewIfNeeded();await shot('series-hidden-from')
 await page.locator('.hidden-imports article').filter({hasText:'Skjult fra'}).locator('[data-restore-import]').focus();await shot('series-restore')
 await restore('Skjult fra');expect((await get('2026-10-08')).data.importHidden).toBe(true);expect((await get('2026-10-22')).data.importHidden).toBe(false);expect((await get('2026-10-22')).note).toBe('Jakob tager saxofonen med')
 await restore('Enkelt forekomst');await backCalendar();await expect(card(item.id)).toBeVisible()
 pass('Future hide includes later imports; exact restore leaves earlier single exclusion and field overrides intact')
 await open();await page.locator('#import-name').fill('Saxofon · kun denne');await save();await scope('occurrence')
 expect((await get('2026-10-22')).title).toBe('Saxofon')
 await open();await setPerson(people[2].id);await save();await scope('series')
 expect((await records()).filter(r=>r.data.uid==='saxofon').every(r=>r.person_ids[0]===people[2].id)).toBe(true)
 pass('Single title and whole-series people use separate persistent rules, including historical occurrences')
 for(const choice of ['occurrence','series']){
  await open();await page.locator('[data-import-hide]').click();await scope(choice)
  expect((await get('2026-10-22')).data.importHidden).toBe(choice==='series')
  await hiddenList();await restore(choice==='series'?'Hele serien':'Enkelt forekomst');await backCalendar();await expect(card(item.id)).toBeVisible()
 }
 pass('Single/whole hide and matching restore work through the UI')
 await open(stay.id);await page.locator('#import-note').fill('Sommerhus · husk sengetøj');await save();await scope('future')
 expect((await get('2026-10-09','sommerhus')).note).toBe('Husk nøgler');expect((await get('2026-10-23','sommerhus')).note).toBe('Sommerhus · husk sengetøj')
 await open(stay.id);await page.locator('[data-import-hide]').click();await scope('future')
 await expect(card(stay.id)).toHaveCount(0);await page.locator('#calendar-next-button').click();await expect(card((await get('2026-10-23','sommerhus')).id)).toHaveCount(0)
 await hiddenList();await restore('Skjult fra 16. oktober');await backCalendar();await expect(page.locator('.week-grid [data-calendar-item="'+stay.id+'"]')).toHaveCount(3);await shot('series-multiday-restored')
 pass('Future edit/hide/restore retains complete multi-day occurrences without daily fragments')
 for(const [width,height] of [[375,667],[390,844],[430,932]]){
  await page.setViewportSize({width,height});await routeTo(page,'calendar');await page.locator('[data-calendar-view=day]').click();await page.locator('#calendar-today-button').click()
  await open();await page.locator('#import-location').fill('Mobil kontrol '+width);await save();await page.locator('input[name=importScope][value=future]').check()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  await expect(page.locator('[data-scope-confirm]')).toBeInViewport();await expect(page.locator('input[name=importScope][value=series]')).toBeInViewport()
  await shot('series-mobile-scope-'+width);await page.keyboard.press('Escape')
 }
 pass('375/390/430px scope cards and confirmation fit without horizontal overflow')
 await open();await page.locator('#import-note').fill('Offline ændring');await save()
 await page.context().setOffline(true);await page.locator('[data-scope-confirm]').click()
 await expect(page.locator('[data-import-scope-form] [role=alert]')).toContainText('Forbind til internettet')
 expect((await get('2026-10-15')).note).not.toBe('Offline ændring')
 await page.context().setOffline(false);await page.keyboard.press('Escape')
 pass('Offline imported edit reports the existing connection requirement and cannot lose the persisted rule')
 expect(errors).toEqual([]);pass('No uncaught browser errors')
 writeFileSync(out+'/series-results.json',JSON.stringify({pass:true,checks,shots,localOnly:true},null,2))
 const path=out+'/review.html',existing=readFileSync(path,'utf8').replace(/<!-- IMPORTED SERIES START -->[\s\S]*?<!-- IMPORTED SERIES END -->/,'')
 const extra='<!-- IMPORTED SERIES START --><h1>Importerede serier · kun denne / denne og frem / hele serien</h1><p>Isolerede lokale data. Rigtige RPC-kald, import, reload, realtime og gendannelse. Ingen hosted ændringer.</p><nav>'+shots.map(n=>'<a href="#'+n+'">'+n+'</a>').join('')+'</nav>'+shots.map(n=>'<section id="'+n+'"><h2>'+n+'</h2><a href="'+n+'.png"><img loading="lazy" src="'+n+'.png" alt="'+n+'"></a></section>').join('')+'<!-- IMPORTED SERIES END -->'
 writeFileSync(path,existing.replace('</html>',extra+'</html>'))
 console.log('IMPORTED SERIES BROWSER PASS '+checks.length+' checks; '+shots.length+' new screenshots')
}catch(error){await page.screenshot({path:out+'/series-failure.png',fullPage:true}).catch(()=>{});throw error}
finally{await browser.close();if(hid)await admin.from('households').delete().eq('id',hid);if(uid)await admin.auth.admin.deleteUser(uid)}
