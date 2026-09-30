import {chromium,expect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync,copyFileSync,readdirSync} from 'node:fs'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {routeTo,openCreate,openSettings,switchHousehold} from './browser-actions.mjs'
const local=localSupabase(),admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const root='http://127.0.0.1:5178',out='supabase/.temp/ux23'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'Europe/Copenhagen'})
const results=[],errors=[],shots=[],measurements=[],households=[]
page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
await page.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data},pass=label=>{results.push(label);console.log('PASS '+results.length+': '+label)}
const email='alignment-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1',today='2026-09-29'
let uid,hid
const shot=async name=>{await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out+'/'+name+'.png'});shots.push(name)}
const fits=async()=>{await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expect(page.locator('.product-nav')).toBeInViewport()}
try{
 mkdirSync(out,{recursive:true});writeFileSync(out+'/mobile-baseline.sha256','6A2556EBE076C508565D8C07FB63F9473B5DCB3206D22069ECDB86D495278065')
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 hid=(await must(admin.from('households').insert({name:'Familien Tandrup Jakobsen',created_by:uid}).select('id').single())).id;households.push(hid)
 await must(admin.from('household_members').insert({household_id:hid,user_id:uid,role:'owner'}))
 const people=await must(admin.from('household_people').insert(['Carl','Ida','Jakob','Far','Mor'].map((name,i)=>({household_id:hid,name,role:i<3?'child':'adult',color:['#7b9365','#b97758','#648794'][i%3]}))).select('*'))
 const carl=people.find(p=>p.name==='Carl'),ida=people.find(p=>p.name==='Ida'),jakob=people.find(p=>p.name==='Jakob')
 const seed=(title,type='Aktivitet',extra={})=>({id:randomUUID(),household_id:hid,created_by:uid,title,type,date:today,time:'',person:'Alle',person_ids:[],done:false,data:{},...extra})
 const task=seed('Dække bord','Opgave',{person:'Carl',person_ids:[carl.id]})
 await must(admin.from('calendar_items').insert([
 seed('Spejder i skoven','Fritidsinteresse',{time:'17:00',person:'Carl',person_ids:[carl.id],location:'Spejderhytten'}),seed('Fodboldtræning','Fritidsinteresse',{time:'16:30',person:'Jakob',person_ids:[jakob.id]}),task,
 seed('Pasta med tomater','Madplan',{note:'Tomater\nPasta'}),seed('Laks og ovnbagte kartofler','Madplan',{date:'2026-09-30'}),seed('Tortillas med grønt','Madplan',{date:'2026-10-02'}),
 seed('Mælk','Indkøb',{note:'2 liter',location:'Mejeri & æg'}),seed('Æbler','Indkøb',{note:'6 stk.',location:'Frugt & grønt'}),
 seed('Idas fødselsdag','Fødselsdag',{date:'2026-10-02',person:'Ida',person_ids:[ida.id],data:{birthYear:2017}}),seed('Forældremøde','Aktivitet',{date:'2026-09-30',time:'19:00',source:'aula',external_id:'ux23-local-only'}),
 seed('Svømning med familien','Aktivitet',{date:'2026-10-03',time:'10:00'}),seed('Rydde op','Opgave',{date:'2026-09-28',done:true,person:'Carl',person_ids:[carl.id]})]))
 await page.clock.setFixedTime(new Date('2026-09-29T08:00:00+02:00'))
 await page.goto(root);await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click();await expect(page.locator('.ux-welcome')).toBeVisible()
 expect(await page.locator('.product-nav button').allTextContents()).toEqual(['I dag','Kalender','Mad & indkøb','Opgaver','Familie']);await expect(page.locator('#settings-button,#household-switch')).toBeHidden();await expect(page.locator('#new-calendar-button span')).toHaveText('Ny');pass('Desktop: five ordered destinations, one + Ny, no gear or single-family selector')
 for(const [width,height] of [[1366,768],[1440,900]]){
  await page.setViewportSize({width,height})
  for(const route of ['today','calendar','meals','shopping','tasks','family']){
   await routeTo(page,route);await fits();await expect(page.locator('.floating-new-button:visible')).toHaveCount(1);await expect(page.locator('[data-quick-type],.ux-capture,.quick-create,#task-quick-add,.day-add-button,.meal-add')).toHaveCount(0)
   if(['meals','shopping','family'].includes(route))await expect(page.locator('#person-chipbar')).toHaveCount(0)
   if(route==='today'){
    const bounds=await page.evaluate(()=>({hero:document.querySelector('.ux-welcome').getBoundingClientRect().height,first:document.querySelector('.home-layout').getBoundingClientRect().top}));expect(bounds.hero).toBeLessThan(150);expect(bounds.first).toBeLessThan(400);measurements.push({viewport:width+'x'+height,...bounds})
   }
   if(route==='calendar'){
    await expect(page.locator('.week-grid .day-card')).toHaveCount(7)
    expect(await page.locator('.week-grid .day-card').evaluateAll(els=>new Set(els.map(el=>Math.round(el.getBoundingClientRect().top))).size)).toBe(1)
    const empty=page.locator('[data-day="2026-10-01"]');await expect(empty.locator('.empty-day')).toHaveText('Ingen planer');await expect(empty.locator('.calendar-day-section')).toHaveCount(0)
    await expect(page.locator('.calendar-source-badge')).toContainText('Aula');await expect(page.locator('.calendar-birthday-flag')).toBeVisible()
   }
   if(['meals','shopping'].includes(route)){await expect(page.locator('[data-product-route=food]')).toHaveAttribute('aria-current','page');await expect(page.locator('[data-food-tab]')).toHaveCount(2);if(route==='meals')expect(await page.locator('[data-meal-week="0"]').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.getBoundingClientRect().width>80)).toBe(true)}
   await shot('desktop-'+route+'-'+width+'x'+height)
  }
 }
 pass('Desktop Today, week, food, tasks and Family: compact content, useful filters, no duplicate creation actions or page overflow at both widths')
 await routeTo(page,'calendar');await page.locator('#new-calendar-button').click();await expect(page.locator('[data-create-kind]')).toHaveCount(5);await shot('desktop-create-sheet');await page.keyboard.press('Escape');await expect(page.locator('#new-calendar-button')).toBeFocused()
 for(const [kind,selector] of [['Aktivitet','#calendar-type'],['Opgave','#calendar-type'],['meal','#plan-title'],['shopping','#plan-title'],['Fødselsdag','#calendar-type']]){await openCreate(page,kind);await expect(page.locator(selector)).toBeVisible();if(selector==='#calendar-type')await expect(page.locator(selector)).toHaveValue(kind);await page.keyboard.press('Escape');await expect(page.locator('#new-calendar-button')).toBeFocused()}
 pass('Desktop shared creation sheet opens all five editors with keyboard focus return')
 for(const tab of ['people','family','feeds','device','appearance','account']){await openSettings(page,tab);await page.keyboard.press('Escape')}
 pass('Family opens people, members, feeds, device, appearance and account settings')
 const second=(await must(admin.from('households').insert({name:'Sommerhuset',created_by:uid}).select('id').single())).id;households.push(second);await must(admin.from('household_members').insert({household_id:second,user_id:uid,role:'owner'}));await page.reload();await routeTo(page,'family');await expect(page.locator('#household-switch')).toBeVisible();await switchHousehold(page,second,'calendar');await expect(page.locator('.calendar-item')).toHaveCount(0);await switchHousehold(page,hid,'today');pass('Multiple families switch within Family and retain isolated calendar data')
 await openSettings(page,'device');await page.locator('#device-kiosk').check();await page.locator('#device-pin').fill('1948');await page.locator('#device-settings-form button[type=submit]').click();await expect(page.locator('body')).toHaveAttribute('data-mode','kiosk')
 expect(await page.locator('.product-nav button').allTextContents()).toEqual(['I dag','Kalender','Mad & indkøb','Opgaver'])
 for(const [width,height] of [[1024,600],[1024,768],[1280,800],[1920,1080]]){
  await page.setViewportSize({width,height})
  for(const route of ['today','calendar','meals','shopping','tasks']){
   await routeTo(page,route);await fits();await expect(page.locator('#new-calendar-button')).toBeHidden();await expect(page.locator('#household-switch,#logout-button,[data-product-route=family],#shopping-add,[data-shopping-toggle],#clear-shopping,[data-meal-ingredients],.meal-add')).toHaveCount(0)
   await expect(page.locator('#settings-button')).toBeInViewport();expect(await page.locator('.product-nav').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(70);expect(await page.evaluate(()=>document.querySelector('#calendar-view').getBoundingClientRect().bottom<=document.querySelector('.product-nav').getBoundingClientRect().top-4)).toBe(true);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1)).toBe(true)
   if(route==='today'){
    await expect(page.locator('.kiosk-progress')).toContainText('0 / 1 klaret');await expect(page.locator('.reward-people-kiosk')).toContainText('1 klaret');await expect(page.locator('.ux-dinner-name')).toContainText('Pasta med tomater')
    const measure=await page.evaluate(()=>{const dinner=document.querySelector('.ux-dinner').getBoundingClientRect(),progress=document.querySelector('.kiosk-progress').getBoundingClientRect(),nav=document.querySelector('.product-nav').getBoundingClientRect();return {dinnerBottom:dinner.bottom,progressBottom:progress.bottom,navTop:nav.top,clock:parseFloat(getComputedStyle(document.querySelector('#device-clock')).fontSize)}});expect(measure.progressBottom).toBeLessThan(measure.navTop);expect(measure.dinnerBottom).toBeLessThan(measure.navTop);expect(measure.clock).toBeGreaterThanOrEqual(46);expect(await page.locator('.home-layout>.day-view>.day-card').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);expect(await page.evaluate(()=>document.querySelector('.next-panel').getBoundingClientRect().bottom<=document.querySelector('.home-aside').getBoundingClientRect().bottom+1)).toBe(true);measurements.push({viewport:width+'x'+height,...measure})
   }
   if(route==='calendar'){await expect(page.locator('.week-grid .day-card')).toHaveCount(7);expect(await page.locator('.week-grid .day-card').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().right<=innerWidth+1))).toBe(true)}
   await shot('kiosk-'+route+'-'+width+'x'+height)
  }
 }
 pass('Kiosk: clock, meal and task/reward status visible at four wall sizes; seven-day week and read-only food have no admin controls or page overflow')
 await routeTo(page,'meals');await page.locator('.meal-card [data-plan-edit]').first().click();await expect(page.locator('#plan-modal')).toBeVisible();await expect(page.locator('#plan-form')).toHaveCount(0);await page.keyboard.press('Escape');await routeTo(page,'shopping');await expect(page.locator('.kiosk-shopping')).toContainText('2 varer');await expect(page.locator('.kiosk-shopping input,.kiosk-shopping button')).toHaveCount(0);pass('Kiosk meal details and shopping are read-only')
 await routeTo(page,'tasks');await page.locator('[data-calendar-toggle="'+task.id+'"]').check();await expect.poll(async()=>(await must(admin.from('calendar_items').select('done').eq('id',task.id).single())).done).toBe(true);await routeTo(page,'today');await expect(page.locator('.kiosk-progress')).toContainText('1 / 1 klaret');pass('Kiosk task completion persists and updates the home summary')
 await page.locator('#settings-button').click();await expect(page.locator('#pin-modal')).toBeVisible();await page.locator('#kiosk-pin').fill('0000');await page.locator('#pin-form button[type=submit]').click();await expect(page.locator('#pin-message')).toContainText('Forkert');await expect(page.locator('#settings-modal')).toHaveCount(0);await page.keyboard.press('Escape');pass('Kiosk settings remain protected by PIN')
 expect(errors).toEqual([]);pass('No uncaught browser exceptions')
 writeFileSync(out+'/results.json',JSON.stringify({checks:results.length,results,measurements},null,2))
 for(const name of readdirSync('supabase/.temp/ux22').filter(name=>/^(today|calendar-week|meals|tasks)-\d+x\d+\.png$/.test(name))){copyFileSync('supabase/.temp/ux22/'+name,out+'/mobile-'+name);shots.push('mobile-'+name.slice(0,-4))}
 writeFileSync(out+'/review.html','<!doctype html><html lang="da"><meta charset="utf-8"><title>Product UX 2.3</title><style>body{font:16px system-ui;background:#f4f5ef;margin:32px;color:#274b36}nav{display:flex;gap:12px;flex-wrap:wrap}section{margin:32px 0}img{max-width:100%;border:1px solid #bccab6;border-radius:12px}a{color:inherit}h2{font-size:18px}</style><h1>Product UX 2.3 · lokal visuel kontrol</h1><p>Desktop, kiosk og godkendt mobilbaseline. Isolerede testdata.</p><nav>'+shots.map(name=>'<a href="#'+name+'">'+name+'</a>').join('')+'</nav>'+shots.map(name=>'<section id="'+name+'"><h2>'+name+'</h2><a href="'+name+'.png"><img loading="lazy" src="'+name+'.png" alt="'+name+'"></a></section>').join('')+'</html>')
 console.log('DESKTOP/KIOSK PASS '+results.length+'/'+results.length+' · '+shots.length+' screenshots')
}catch(error){console.log('LAYOUT_FAILURE',await page.evaluate(()=>({width:innerWidth,height:innerHeight,boxes:Object.fromEntries(['.home-aside','.next-panel','.kiosk-progress','.reward-people-kiosk','.ux-dinner'].map(s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect();return [s,r?{top:r.top,bottom:r.bottom,height:r.height,padding:getComputedStyle(e).padding}:null]}))})));await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});throw error}
finally{await browser.close();for(const id of households.reverse())await admin.from('households').delete().eq('id',id);if(uid)await admin.auth.admin.deleteUser(uid)}
