import {chromium,expect as baseExpect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {routeTo,openCreate} from './browser-actions.mjs'

const expect=baseExpect.configure({timeout:20000}),local=localSupabase(),root='http://127.0.0.1:5179',out='supabase/.temp/live-core-bugfix'
const opts={auth:{persistSession:false}},admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,opts),user=createClient(local.API_URL,local.ANON_KEY,opts)
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.code+': '+r.error.message);return r.data}
const results=[],shots=[],errors=[],pass=name=>{results.push(name);console.log(name+' PASS')}
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const context=await browser.newContext({locale:'da-DK',timezoneId:'Europe/Copenhagen',viewport:{width:375,height:667},hasTouch:true}),page=await context.newPage()
page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message))
await context.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
const shot=async(name,label)=>{await page.screenshot({path:out+'/'+name+'.png'});shots.push({name,label})}
const fits=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
const inViewport=async locator=>expect(await locator.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})).toBe(true)
// Real wheel input proves users can scroll, unlike setting scrollTop on an overflow:hidden element.
const scrollBottom=async(selector,button)=>{
 const modal=page.locator(selector)
 await expect.poll(async()=>{await modal.hover({position:{x:60,y:100}});await page.mouse.wheel(0,20000);return button.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})}).toBe(true)
 await inViewport(button);await fits()
}
const closeRecipe=()=>page.locator('[data-recipe-close]').click()
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen'}).format(new Date()),weekday=new Date(today+'T12:00:00Z').getUTCDay()||7
let uid,hid
const records=()=>must(admin.from('calendar_items').select('*').eq('household_id',hid))
const get=id=>must(admin.from('calendar_items').select('*').eq('id',id).single())
const state=()=>must(user.rpc('get_reward_state',{p_household_id:hid}))
const act=(action,payload)=>must(user.rpc('reward_action',{p_request_id:randomUUID(),p_household_id:hid,p_action:action,p_payload:payload}))
try{
 const html=await fetch(root).then(r=>r.text()),script=html.match(/<script[^>]+src="([^"]+)"/)?.[1]
 if(!(await fetch(new URL(script,root)).then(r=>r.text())).includes(local.API_URL))throw Error('Preview is not built for the allowlisted local Supabase. Run preview-local.mjs --build-only first.')
 const email='live-core-'+randomUUID()+'@example.test',password=randomUUID()+'Aa!1'
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 await must(user.auth.signInWithPassword({email,password}))
 hid=await must(user.rpc('create_household',{p_name:'Familien · lokalt bugfix-review'}))
 const people=await must(user.from('household_people').insert([{household_id:hid,name:'Julie',role:'child',color:'#7c935e',reward_enabled:true},{household_id:hid,name:'Mads',role:'adult',color:'#6b8da0'}]).select())
 const julie=people.find(p=>p.name==='Julie')
 const recipe=await must(user.from('recipes').insert({household_id:hid,created_by:uid,title:'Pastafad med grøntsager',servings:4,description:'En lang opskrift til at kontrollere, at hele indholdet og de nederste handlinger kan nås.'}).select().single())
 const ingredients=Array.from({length:24},(_,position)=>({recipe_id:recipe.id,position,raw_text:(position+1)+' dl '+['pasta','tomater','grøntsager','bouillon'][position%4]}))
 await must(user.from('recipe_ingredients').insert(ingredients))
 await must(user.from('recipe_instructions').insert(Array.from({length:16},(_,position)=>({recipe_id:recipe.id,position,text:'Trin '+(position+1)+': Gør grøntsagerne klar, bland med pastaen og smag til. Rør grundigt, så retten bliver jævnt fordelt.'}))))
 const duties=[{title:'Tøm opvaskemaskinen',schedule:'daily',approval:false},{title:'Pak skoletasken',schedule:'weekdays',approval:false},{title:'Vand planterne',schedule:'selected',weekdays:[weekday],approval:false},{title:'Ryd værelset denne uge',schedule:'weekly',approval:false}]
 await act('allowance_save',{person_id:julie.id,cadence:'week',amount_minor:10000,duties,start_today:true,expected:null})
 const rewardBefore=await state(),duty=name=>rewardBefore.occurrences.find(o=>o.title===name&&o.due_date===today)
 const daily=duty(duties[0].title),selected=duty(duties[2].title),workday=duty(duties[1].title)
 expect(daily).toBeTruthy();expect(selected).toBeTruthy()
 const feed=await must(user.from('calendar_feeds').insert({household_id:hid,name:'Lokal UTC-kilde',source:'ics',feed_url:'https://example.test/calendar.ics'}).select().single())
 const args=['--yes','deno@2.9.6','run','--quiet','--config','supabase/functions/deno.json','--allow-read','supabase/functions/tests/timezone-fixture.ts',feed.id,hid,uid,today]
 const importedRows=JSON.parse(execFileSync('cmd.exe',['/d','/s','/c','npx.cmd '+args.join(' ')],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}))
 const sync=async rows=>{const claim=await must(admin.rpc('begin_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid}));return must(admin.rpc('apply_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid,p_token:claim.import_token,p_rows:rows,p_range_start:today,p_range_end:today,p_cleanup:true}))}
 const oldRows=structuredClone(importedRows)
 for(const row of oldRows){row.payload.time=row.payload.data.time=row.payload.data.sourceStart.slice(11,16);delete row.payload.data.displayTimeZone}
 await sync(oldRows);let imported=(await records()).find(r=>r.calendar_id===feed.id)
 await must(user.rpc('edit_imported_calendar_item',{p_id:imported.id,p_expected:imported.updated_at,p_patch:{note:'Lokal note bevares'},p_hide_scope:null}))
 await sync(importedRows);await sync(importedRows)
 const repaired=await get(imported.id);expect(repaired.time.slice(0,5)).toBe('18:30');expect(repaired.note).toBe('Lokal note bevares')
 expect((await records()).filter(r=>r.calendar_id===feed.id)).toHaveLength(1)
 pass('TIMEZONE_PARSE_STORAGE_RESYNC_IDENTITY_OVERRIDES')
 const legacy=await must(user.from('calendar_items').insert({household_id:hid,created_by:uid,title:'Julies fødselsdag',type:'Fødselsdag',date:'2014'+today.slice(4),person_ids:[julie.id],note:'Bevar noten',data:{birthYear:'2014',location:'Gammel lokation',durationMin:60,extraLegacy:'bevar'}}).select().single())
 await page.goto(root);await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click()
 await routeTo(page,'meals');await page.locator('.food-tabs [data-food-tab=recipes]').click();await page.locator('[data-recipe-open="'+recipe.id+'"]').click()
 await fits();await shot('01-recipe-mobile-top','1. Recipe detail · mobil, top')
 await scrollBottom('.recipe-modal',page.locator('[data-detail-edit]'));await shot('02-recipe-mobile-bottom','2. Recipe detail · mobil, nederste handlinger')
 pass('MODAL_RECIPE_MOBILE_WHEEL_BOTTOM')
 await page.locator('[data-detail-edit]').click();await scrollBottom('.recipe-modal',page.locator('#recipe-editor button[type=submit]'))
 await shot('13-recipe-editor-bottom','13. Lang opskriftseditor · nederste handling');await closeRecipe()
 await page.locator('[data-recipe-plan="'+recipe.id+'"]').click();await page.locator('#recipe-plan-note').fill('Til denne dag')
 await scrollBottom('.recipe-modal',page.locator('#recipe-plan-form button[type=submit]'));await shot('03-add-meal-bottom','3. Tilføj til madplan · Gem synlig')
 await page.locator('#recipe-plan-form button[type=submit]').click();await expect(page.locator('#recipe-plan-form')).toHaveCount(0)
 const meal=(await records()).find(r=>r.type==='Madplan');expect(meal.recipe_id).toBe(recipe.id)
 await page.locator('[data-recipe-open="'+recipe.id+'"]').click();await page.locator('[data-detail-shop]').click()
 await scrollBottom('.recipe-modal',page.locator('#recipe-shopping-form button[type=submit]'));await shot('04-add-shopping-bottom','4. Tilføj til indkøb · nederste handling')
 await page.locator('#recipe-shopping-form button[type=submit]').click();await expect(page.locator('#recipe-shopping-form')).toHaveCount(0)
 expect((await records()).filter(r=>r.type==='Indkøb')).toHaveLength(ingredients.length);pass('MODAL_PLAN_SHOPPING_RECIPE_EDITOR_ACTIONS')
 await page.setViewportSize({width:1440,height:700});await page.locator('[data-recipe-open="'+recipe.id+'"]').click()
 await scrollBottom('.recipe-modal',page.locator('[data-detail-edit]'));await shot('10-desktop-long-modal','10. Desktop · lang dialog scrollet til bund');await closeRecipe()
 pass('MODAL_DESKTOP_WHEEL_BOTTOM')
 await page.setViewportSize({width:375,height:667});await routeTo(page,'calendar')
 await openCreate(page,'Fødselsdag');await page.locator('#calendar-birthday-person').fill('Bedstemor');await page.locator('#calendar-date').fill(today)
 await expect(page.locator('#calendar-modal-form button[type=submit]')).toHaveText('Opret fødselsdag')
 for(const selector of ['#calendar-title','#calendar-time','#calendar-end-date','#calendar-end-time','#calendar-location','#calendar-duration','#calendar-type','[name=repeatWeekly]'])await expect(page.locator(selector)).toBeHidden()
 expect(await page.locator('#calendar-modal-form').evaluate(f=>f.checkValidity())).toBe(true)
 await shot('05-birthday-editor','5. Fødselsdag · person, dato, valgfrit år og note')
 await page.locator('#calendar-modal-form button[type=submit]').click();await expect(page.locator('#calendar-modal')).toHaveCount(0)
 const birthday=(await records()).find(r=>r.title==='Bedstemor');expect(birthday.all_day).toBe(true);expect(birthday.repeat_yearly||birthday.data.repeatYearly).toBe(true);expect(birthday.time||'').toBe('')
 await openCreate(page,'Mærkedag');await page.locator('#calendar-title').fill('Bryllupsdag');await page.locator('#calendar-date').fill(today);await page.locator('#calendar-note').fill('Husk blomster')
 await expect(page.locator('#calendar-modal-form button[type=submit]')).toHaveText('Opret mærkedag')
 for(const selector of ['#calendar-birthday-person','#calendar-birth-year','#calendar-time','#calendar-end-date','#calendar-location','#calendar-duration','#calendar-type','[name=repeatWeekly]'])await expect(page.locator(selector)).toBeHidden()
 await scrollBottom('#calendar-modal-form',page.locator('#calendar-modal-form button[type=submit]'));await shot('06-anniversary-editor','6. Mærkedag · titel, dato, personer og note')
 await page.locator('#calendar-modal-form button[type=submit]').click();await expect(page.locator('#calendar-modal')).toHaveCount(0)
 const anniversary=(await records()).find(r=>r.title==='Bryllupsdag');expect(anniversary.all_day).toBe(true);expect(anniversary.repeat_yearly||anniversary.data.repeatYearly).toBe(true)
 pass('BIRTHDAY_ANNIVERSARY_CREATE_MINIMAL_FIELDS')
 const editAnnual=async(id,note)=>{await page.locator('[data-calendar-item^="yearly|'+id+'|"]').first().click();await expect(page.locator('#calendar-modal-form button[type=submit]')).toHaveText('Gem ændringer');await page.locator('#calendar-note').fill(note);await page.locator('#calendar-modal-form button[type=submit]').click();await expect(page.locator('#calendar-modal')).toHaveCount(0)}
 await editAnnual(legacy.id,'Opdateret note');const updated=await get(legacy.id)
 expect(updated.title).toBe(legacy.title);expect(updated.date).toBe(legacy.date);expect(updated.person_ids).toEqual(legacy.person_ids);expect(updated.data.extraLegacy).toBe('bevar');expect(updated.data.location).toBe('Gammel lokation');expect(updated.data.durationMin).toBe(60)
 await editAnnual(anniversary.id,'Husk roser');expect((await get(anniversary.id)).note).toBe('Husk roser')
 await page.reload();await routeTo(page,'calendar');expect((await records()).filter(r=>['Fødselsdag','Mærkedag'].includes(r.type))).toHaveLength(3)
 await expect(page.locator('[data-calendar-item^="yearly|'+anniversary.id+'|"]')).toHaveCount(1)
 pass('ANNUAL_EDIT_RELOAD_NO_DATA_LOSS_OR_DUPLICATES')
 await expect(page.locator('[data-calendar-item="'+imported.id+'"]')).toContainText('18:30');pass('TIMEZONE_DISPLAY_1830')
 const task=id=>page.locator('[data-reward-task="'+id+'"]')
 await expect(task(daily.task_id)).toBeVisible();await expect(task(selected.task_id)).toBeVisible()
 await task(daily.task_id).hover();await shot('07-calendar-daily-duty','7. Kalender · daglig fast pligt')
 if(workday){await expect(task(workday.task_id)).toBeVisible();await task(workday.task_id).hover();await shot('08-calendar-weekday-duty','8. Kalender · hverdagspligt')}
 await expect(page.getByText(duties[3].title,{exact:true})).toHaveCount(0)
 expect((await records()).filter(r=>r.type==='Opgave')).toHaveLength(0)
 expect((await state()).monthly).toEqual(rewardBefore.monthly);expect((await state()).snapshots).toEqual(rewardBefore.snapshots)
 pass('ALLOWANCE_CALENDAR_DERIVED_DAILY_WEEKDAYS_SELECTED_NO_COPIES')
 await task(daily.task_id).locator('[data-reward-action=complete]').click()
 await expect.poll(async()=>(await state()).occurrences.find(o=>o.id===daily.id).status).toBe('completed')
 const completed=page.locator('[data-completed-date="'+today+'"]');if(await completed.count())await completed.locator('summary').click()
 await expect(task(daily.task_id)).toContainText('Udført');await task(daily.task_id).hover();await shot('09-calendar-completed-duty','9. Kalender · udført pligt')
 await task(selected.task_id).locator('[data-reward-action=excuse]').click();await page.locator('#reward-reason').fill('Ferie');await page.locator('#reward-reason-form button[type=submit]').click()
 await expect.poll(async()=>(await state()).occurrences.find(o=>o.id===selected.id).status).toBe('excused')
 if(await page.locator('[data-reward-close]').count())await page.locator('[data-reward-close]').click()
 await expect(task(selected.task_id)).toContainText('Fritaget');pass('ALLOWANCE_CALENDAR_COMPLETE_EXCUSE')
 await routeTo(page,'today');await expect(page.getByText(duties[3].title,{exact:true})).toBeVisible();await expect(task(selected.task_id)).toContainText('Fritaget')
 pass('TODAY_ALLOWANCE_DUTIES_PRESERVED')
 await routeTo(page,'calendar');await page.locator('[data-calendar-view=week]').click();await page.setViewportSize({width:1440,height:900})
 await page.locator('[data-person-filter="'+julie.id+'"]').click()
 const compact=id=>page.locator('[data-task-detail="'+id+'"]')
 await expect(compact(selected.task_id)).toContainText('Fritaget');await expect(compact(daily.task_id)).toHaveClass(/is-done/)
 await compact(selected.task_id).click();await expect(page.locator('.reward-modal')).toContainText('Fritaget');await page.locator('[data-reward-close]').click()
 await shot('14-calendar-week-duties','14. Ugekalender · faste pligter og status');pass('ALLOWANCE_WEEK_VIEW_STATUS_DETAIL')
 await routeTo(page,'meals');await page.locator('[data-plan-edit="'+meal.id+'"]').click();await page.locator('[data-remove-meal]').scrollIntoViewIfNeeded();await shot('11-meal-remove-action','11. Madplan · Fjern fra madplan')
 page.once('dialog',d=>d.accept());await page.locator('[data-remove-meal]').click();await expect(page.locator('.recipe-modal')).toHaveCount(0)
 await expect(page.locator('[data-plan-edit="'+meal.id+'"]')).toHaveCount(0);await page.evaluate(()=>scrollTo(0,0));await shot('12-meal-after-remove','12. Madplan · retten fjernet, opskriften bevaret')
 expect(await must(user.from('recipes').select('id').eq('id',recipe.id))).toHaveLength(1)
 expect(errors).toEqual([]);pass('LIVE_CORE_BROWSER_NO_ERRORS')
 writeFileSync(out+'/browser-results.json',JSON.stringify({pass:true,results,shots,errors,localTarget:local.API_URL},null,2))
 writeFileSync(out+'/review.html',`<!doctype html><html lang="da"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Live core bugfix · visuelt review</title><style>body{margin:0;background:#f4f2ec;color:#24322a;font:16px system-ui}main{max-width:1400px;margin:auto;padding:32px}h1{font-size:32px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:24px}figure{margin:0;padding:16px;background:white;border-radius:12px}img{display:block;max-width:100%;max-height:800px;margin:auto}figcaption{padding:12px 0;font-weight:600}li{margin:6px 0}a{color:#264c38}</style><main><h1>Live core bugfix · visuelt review</h1><p>Lokalt build fra main · ingen production-ændringer, commit eller push. Ægte browserbilleder, ${new Date().toISOString()}.</p><p>Opskrift-dialogerne er testet med faktisk wheel-scroll og synlige bundhandlinger. Årsdage gemmes via normal API og kontrolleres efter reload. Faste pligter kommer fra de eksisterende periodeforekomster.</p><p><strong>PRODUCT DECISION REQUIRED:</strong> Én gang om ugen uden bestemt dag vises fortsat i Opgaver/I dag, men placeres ikke vilkårligt i kalenderen.</p><p><strong>Importerede data:</strong> Berørte eksisterende UTC/floating-tider kræver resync. Bevar lokale overrides ved identitetskontrol; floating recurrence kan kræve mapping/backfill før resync. Ingen repair kørt i production.</p><details><summary>${results.length} browserkontroller · PASS</summary><ul>${results.map(r=>'<li>'+r+' PASS</li>').join('')}</ul></details><div class="grid">${shots.map(s=>'<figure><figcaption>'+s.label+'</figcaption><a href="'+s.name+'.png"><img loading="lazy" src="'+s.name+'.png" alt="'+s.label+'"></a></figure>').join('')}</div></main></html>`)
 console.log('LIVE CORE BROWSER PASS '+results.length)
}catch(error){
 await page.screenshot({path:out+'/browser-failure.png'}).catch(()=>{})
 writeFileSync(out+'/browser-results.json',JSON.stringify({pass:false,message:error.message,results,shots,errors},null,2));throw error
}finally{
 await browser.close();if(hid)await must(admin.from('households').delete().eq('id',hid));if(uid)await must(admin.auth.admin.deleteUser(uid))
}
