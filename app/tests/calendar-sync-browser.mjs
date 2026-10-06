import {chromium,expect as baseExpect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {routeTo,openSettings,switchHousehold} from './browser-actions.mjs'
const expect=baseExpect.configure({timeout:20000}),local=localSupabase(),root='http://localhost:5173',out='supabase/.temp/calendar-sync30'
const hid='918d0c9b-3404-4aa2-aaf0-998a93e661b8'
const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}}),user=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}})
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.code||'LOCAL_API_ERROR');return r.data}
const runSql=sql=>execFileSync('docker',['exec','-i','supabase_db_familiekalender','psql','-X','-U','postgres','-d','postgres','-tA','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']})
const owner=(await must(admin.from('household_members').select('user_id').eq('household_id',hid).eq('role','owner').single())).user_id
const email=(await must(admin.auth.admin.getUserById(owner))).user.email
const link=await must(admin.auth.admin.generateLink({type:'magiclink',email}))
const session=(await must(user.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'magiclink'}))).session
const feed=(await must(admin.from('calendar_feeds').select('id').eq('household_id',hid).eq('source','google').single())).id
const records=()=>must(admin.from('calendar_items').select('*').eq('calendar_id',feed))
const baseline=await records(),item=baseline.find(i=>i.data.recurrenceId&&!i.data.importSourceRemoved&&i.date>='2026-10-05'&&i.date<='2026-10-11')
if(!item)throw Error('No realistic recurring item available')
const initialOverrides=await must(admin.from('calendar_import_overrides').select('*').eq('household_id',hid).eq('feed_id',feed).eq('uid',item.data.uid))
const people=await must(admin.from('household_people').select('id,name').eq('household_id',hid)),chosen=people.filter(p=>['Carl','Far'].includes(p.name)).map(p=>p.id)
const realtimeEvents=[];const feedStates=[];const checks=[],shots=[],errors=[];const pass=label=>{checks.push(label);console.log('PASS '+label)}
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--remote-debugging-port=9380']})
let contexts=[]
const setup=async(viewport,kiosk=false)=>{
 const context=await browser.newContext({viewport,timezoneId:'Europe/Copenhagen',serviceWorkers:'block'});contexts.push(context)
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(['localhost','127.0.0.1'].includes(u.hostname))return route.continue();return route.abort()})
 await context.addInitScript(({session,url,kiosk,owner,hid})=>{
  localStorage.setItem('sb-'+new URL(url).hostname.split('.')[0]+'-auth-token',JSON.stringify(session))
  localStorage.setItem('familiekalender.view','week')
  if(kiosk)localStorage.setItem('familiekalender.device.v1:'+url,JSON.stringify({kiosk:{userId:owner,householdId:hid}}))
 },{session,url:local.API_URL,kiosk,owner,hid})
 const page=await context.newPage();page.on('websocket',ws=>ws.on('framereceived',e=>{try{const p=JSON.parse(String(e.payload));if((p.event||p[3])==='postgres_changes')realtimeEvents.push({width:viewport.width,feeds:(p.payload||p[4])?.data?.record?.feeds_version})}catch{}}));page.on('response',async r=>{if(new URL(r.url()).pathname==='/rest/v1/calendar_feeds'&&r.status()===200){try{const rows=await r.json();const f=Array.isArray(rows)?rows.find(f=>f.id===feed):null;if(f)feedStates.push({width:viewport.width,state:f.last_sync_status})}catch{}}});page.on('pageerror',()=>errors.push('Uncaught browser error'))
 await page.clock.setFixedTime(new Date('2026-10-06T12:00:00+02:00'))
 await page.goto(root);await expect(page.locator('.product-nav')).toBeVisible()
 if(!kiosk)await switchHousehold(page,hid)
 await routeTo(page,'calendar')
 if(viewport.width<700)await page.locator('[data-calendar-view=week]').click()
 return page
}
const shot=async(page,name)=>{await page.screenshot({path:out+'/'+name+'.png',fullPage:true});shots.push(name)}
const card=(page)=>page.locator('[data-calendar-item="'+item.id+'"]')
const current=()=>must(admin.from('calendar_items').select('*').eq('id',item.id).single())
const sync=()=>must(user.functions.invoke('import-calendar-feed',{body:{feedId:feed}}))
try{
 const runtime=await fetch(root+'/src/lib/supabase.js').then(r=>r.text());expect(runtime.match(/"VITE_SUPABASE_URL":\s*"([^"]+)"/)?.[1]).toBe(local.API_URL)
 const page=await setup({width:1440,height:1000});await expect(card(page)).toBeVisible();await card(page).click()
 await expect(page.locator('.imported-editor')).toContainText('Importeret fra Google');await shot(page,'01-google-editor')
 for(const checkbox of await page.locator('.import-people input').all())await checkbox.setChecked(chosen.includes(await checkbox.getAttribute('value')))
 await shot(page,'02-person-selector');await expect(page.locator('.source-notice')).toContainText('ændrer ikke den oprindelige kalender');await shot(page,'03-local-only-explanation')
 await page.locator('#import-location').fill('Mød ved indgangen · lokal kontrol');await page.locator('#import-note').fill('Husk drikkedunk · lokal kontrol')
 await page.locator('.imported-editor button[type=submit]').click();await expect(page.locator('.imported-editor')).toHaveCount(0)
 expect([...(await current()).person_ids].sort()).toEqual([...chosen].sort());await page.reload();await routeTo(page,'calendar');await card(page).click()
 for(const id of chosen)await expect(page.locator('.import-people input[value="'+id+'"]')).toBeChecked()
 await expect(page.locator('#import-note')).toHaveValue('Husk drikkedunk · lokal kontrol');await page.keyboard.press('Escape')
 await sync();expect((await current()).location).toBe('Mød ved indgangen · lokal kontrol');expect([...(await current()).person_ids].sort()).toEqual([...chosen].sort());pass('Real family: imported editor and stable multi-person/location/note survive reload and real manual sync')
 const mobile=await setup({width:390,height:844}),kiosk=await setup({width:1920,height:1080},true)
 await expect(kiosk.locator('body')).toHaveAttribute('data-mode','kiosk')
 const active=await current(),raw=active.data.importSource||{}
 const claim=await must(admin.rpc('begin_calendar_feed_import',{p_feed_id:feed,p_actor_id:owner}))
 await must(admin.rpc('apply_calendar_feed_import',{p_feed_id:feed,p_actor_id:owner,p_token:claim.import_token,p_range_start:'2026-10-01',p_range_end:'2026-10-31',p_cleanup:false,p_rows:[{externalKey:active.external_id,payload:{title:'Lokal kildeopdatering',date:active.date,time:active.time,note:raw.note||'',data:{uid:active.data.uid,recurrenceId:active.data.recurrenceId,location:'Ny kildeplacering',durationMin:active.duration_min}}}]}))
 for(const target of [page,mobile,kiosk]){await expect(card(target)).toContainText('Lokal kildeopdatering');await expect(card(target)).toHaveCount(1)}
 expect((await current()).location).toBe('Mød ved indgangen · lokal kontrol');pass('Source update reaches desktop/mobile/kiosk through real Realtime without echo duplicates; overridden fields stay local')
 await sync();for(const target of [page,mobile,kiosk])await expect(card(target)).not.toContainText('Lokal kildeopdatering')
 await shot(page,'08-desktop-calendar-after-dedupe');await shot(kiosk,'10-kiosk-calendar-after-sync')
 await card(mobile).click();await expect(mobile.locator('.imported-editor')).toBeVisible();await shot(mobile,'09-mobile-imported-editor')
 expect(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);for(const viewport of [{width:375,height:667},{width:430,height:932}]){await mobile.setViewportSize(viewport);expect(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expect(mobile.locator('.imported-editor button[type=submit]')).toBeVisible()}await mobile.setViewportSize({width:390,height:844});await mobile.keyboard.press('Escape');pass('Mobile editor fits 375/390/430px; kiosk remains display mode')
 await card(page).click();await page.locator('[data-import-hide]').click();await expect(page.locator('[data-hide-scope=occurrence]')).toBeVisible();await expect(page.locator('[data-hide-scope=series]')).toBeVisible();await shot(page,'04-remove-recurring-scope')
 await page.locator('[data-hide-scope=occurrence]').click();await expect(card(page)).toHaveCount(0);await sync();expect((await current()).data.importHidden).toBe(true)
 const others=(await records()).filter(i=>i.data.uid===item.data.uid&&i.id!==item.id&&!i.data.importSourceRemoved);expect(others.some(i=>!i.data.importHidden)).toBe(true);pass('Single occurrence stays hidden after real sync while other series dates remain visible')
 await openSettings(page,'feeds');await page.locator('#hidden-imports-open').click();await expect(page.locator('[data-restore-import]')).toHaveCount(1);await page.locator('[data-restore-import]').scrollIntoViewIfNeeded();await shot(page,'05-hidden-imports-restore')
 await page.locator('[data-restore-import]').click();await expect(page.locator('[data-restore-import]')).toHaveCount(0);await page.keyboard.press('Escape');await routeTo(page,'calendar');await expect(card(page)).toBeVisible()
 await card(page).click();await page.locator('[data-import-hide]').click();await page.locator('[data-hide-scope=series]').click();await sync()
 expect((await records()).filter(i=>i.data.uid===item.data.uid).every(i=>i.data.importHidden)).toBe(true);pass('Full series stays hidden after real sync')
 await openSettings(page,'feeds');await page.locator('#hidden-imports-open').click();await page.locator('[data-restore-import]').click();await expect(page.locator('[data-restore-import]')).toHaveCount(0);pass('Feed settings restore series immediately')
 await expect(page.locator('[data-feed-status="'+feed+'"]')).toContainText('Synkroniseret');await shot(page,'06-feed-sync-status')
 await page.bringToFront();const failClaim=await must(admin.rpc('begin_calendar_feed_import',{p_feed_id:feed,p_actor_id:owner}));await must(admin.rpc('fail_calendar_feed_import',{p_feed_id:feed,p_token:failClaim.import_token,p_message:'FETCH_FAILED'}))
 await expect(page.locator('[data-feed-status="'+feed+'"]')).toContainText('Kunne ikke synkronisere');await shot(page,'07-feed-error-state')
 const request=page.waitForResponse(r=>new URL(r.url()).pathname==='/functions/v1/import-calendar-feed')
 await page.locator('[data-import-calendar-feed="'+feed+'"]').click();expect((await request).status()).toBe(200);await expect(page.locator('[data-feed-status="'+feed+'"]')).toContainText('Synkroniseret');pass('Feed status receives realtime errors and Hent nu recovers successfully')
 await must(admin.from('calendar_feeds').update({is_active:false}).eq('id',feed));expect((await user.functions.invoke('import-calendar-feed',{body:{feedId:feed}})).error).toBeTruthy();expect((await must(admin.rpc('due_calendar_feeds',{p_limit:10}))).some(f=>f.id===feed)).toBe(false)
 await must(admin.from('calendar_feeds').update({is_active:true}).eq('id',feed));await sync();pass('Real feed inactive blocks manual and scheduled selection, then reactivation succeeds')
 const secret=readFileSync(out+'/functions.env','utf8').match(/^CALENDAR_SYNC_SECRET=(.+)$/m)[1]
 // Expire this local feed's attempt timestamp so an immediate scheduled run proves
 // the same overrides survive automatic mode without waiting five real minutes.
 await must(admin.from('calendar_feeds').update({last_attempt_at:'2026-01-01T00:00:00Z'}).eq('id',feed))
 const scheduled=await fetch(local.API_URL+'/functions/v1/sync-calendar-feeds',{method:'POST',headers:{'x-calendar-sync-secret':secret,'Content-Type':'application/json'},body:'{}'}),result=await scheduled.json()
 expect(scheduled.status).toBe(200);expect(result.results.find(r=>r.feedId===feed)?.success).toBe(true)
 expect([...(await current()).person_ids].sort()).toEqual([...chosen].sort());expect((await current()).note).toBe('Husk drikkedunk · lokal kontrol');pass('Actual local scheduled Edge endpoint preserves person/location/note overrides')
 expect(errors).toEqual([]);pass('No uncaught browser errors')
 writeFileSync(out+'/browser-results.json',JSON.stringify({pass:true,checks,shots,localOnly:true},null,2))
 writeFileSync(out+'/review.html','<!doctype html><html lang="da"><meta charset="utf-8"><title>Calendar Import & Sync 3.0</title><style>body{font:16px system-ui;background:#f4f5ef;color:#274b36;margin:28px}nav{display:flex;flex-wrap:wrap;gap:12px}section{margin:32px 0}img{max-width:100%;border:1px solid #bac8ba;border-radius:12px}a{color:inherit}</style><h1>Calendar Import & Sync 3.0</h1><p>Kun lokal Supabase. Realistisk kopi af familien. Kildeopdatering og fejlstatus er kontrollerede lokale testtilstande. Ingen private feed-links i billederne. Test-overrides gendannes efter kontrollen.</p><nav>'+shots.map(s=>'<a href="#'+s+'">'+s+'</a>').join('')+'</nav>'+shots.map(s=>'<section id="'+s+'"><h2>'+s+'</h2><img loading="lazy" src="'+s+'.png" alt="'+s+'"></section>').join('')+'</html>')
 console.log('CALENDAR SYNC BROWSER PASS '+checks.length+' checks; '+shots.length+' screenshots')
 if(process.argv.includes('--keep-browser')){console.log('REVIEW_BROWSER_READY CDP=9380');await new Promise(resolve=>browser.on('disconnected',resolve))}
}catch(error){await contexts[0]?.pages()[0]?.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});console.log('REALTIME_EVENTS '+JSON.stringify(realtimeEvents.slice(-15)));console.log('FEED_STATES '+JSON.stringify(feedStates.slice(-15)));console.log('BROWSER CHECK FAILED '+String(error.message).replace(/https?:\/\/[^\s]+/g,'[URL]').slice(0,1000));process.exitCode=1}
finally{
 await must(admin.from('calendar_feeds').update({is_active:true}).eq('id',feed))
 await must(admin.from('calendar_import_overrides').delete().eq('household_id',hid).eq('feed_id',feed).eq('uid',item.data.uid))
 if(initialOverrides.length)await must(admin.from('calendar_import_overrides').insert(initialOverrides))
 // Item IDs are read from the local database; no URLs or credentials enter SQL.
 const ids=(await records()).filter(i=>i.data.uid===item.data.uid).map(i=>i.id)
 runSql('begin;'+ids.map(id=>"select private.apply_import_override('"+id+"');").join('')+'commit;')
 await browser.close()
}
