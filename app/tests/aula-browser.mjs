// Full application shell on Vercel dev + real local Auth. Aula responses are
// synthetic browser fixtures; separate aula-api.mjs tests real API/DB boundaries.
import {chromium,expect} from '@playwright/test'
import QRCode from 'qrcode'
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {localEnvironment,localFixture,reviewRoot} from '../scripts/aula-local.mjs'
import {ids,people as sourcePeople,connected} from './fixtures/aula.js'
const env=localEnvironment(),fixture=await localFixture(env),out=join(reviewRoot,'screenshots');mkdirSync(out,{recursive:true})
const personMap=new Map(sourcePeople.map(p=>[p.id,fixture.people.find(x=>x.name===p.name)?.id]))
const linked=structuredClone(connected);linked.connection.household_id=fixture.household.id
linked.mappings=linked.mappings.map(m=>({...m,household_id:fixture.household.id,person_id:personMap.get(m.person_id)}))
linked.findings=linked.findings.map(f=>({...f,household_id:fixture.household.id,person_id:personMap.get(f.person_id),person_ids:(f.person_ids??[f.person_id]).map(id=>personMap.get(id))}))
let state={connection:null,mappings:[],findings:[]},scanRelease,scanFails=false
const feed=await fixture.db.from('calendar_feeds').upsert({id:'30000000-0000-4000-8000-000000000001',household_id:fixture.household.id,name:'Carl · Aula-kalender',source:'aula',feed_url:'https://example.invalid/synthetic-aula.ics',assigned_person_id:personMap.get(ids.carl),is_active:false});if(feed.error)throw Error('LOCAL_LEGACY_FIXTURE_FAILED')
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),errors=[],shots=[],checks=[]
const context=await browser.newContext({viewport:{width:390,height:844},locale:'da-DK',timezoneId:'Europe/Copenhagen'})
await context.addInitScript(({session})=>{
 localStorage.setItem('sb-127-auth-token',JSON.stringify(session))
 const original=window.fetch.bind(window)
 window.fetch=async(input,init)=>{
  if(String(input).endsWith('/api/aula-connect')){
   const stream=new ReadableStream({start(controller){window.__aulaTestStream=controller;init.signal?.addEventListener('abort',()=>{try{controller.error(new DOMException('cancel','AbortError'))}catch{}},{once:true})}})
   return new Response(stream,{headers:{'content-type':'text/event-stream'}})
  }
  return original(input,init)
 }
 window.__aulaTestEmit=(event,data,done=false)=>{window.__aulaTestStream.enqueue(new TextEncoder().encode('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'));if(done)window.__aulaTestStream.close()}
},{session:fixture.session})
await context.route('**/*',async route=>{
 const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort()
 if(u.pathname==='/api/aula-handoff-create')return route.fulfill({json:{handoff_secret:'S'.repeat(43),expires_at:new Date(Date.now()+600000).toISOString()}})
 if(u.pathname==='/api/aula-status')return route.fulfill({json:state})
 if(u.pathname==='/api/aula-identity')return route.fulfill({json:{}})
 if(u.pathname==='/api/aula-disconnect'){state={connection:{status:'disconnected'},mappings:[],findings:[]};return route.fulfill({json:{}})}
 if(u.pathname==='/api/aula-scan'){
  if(scanFails)return route.fulfill({status:502,json:{code:'AULA_TEMPORARY_ERROR'}})
  await new Promise(resolve=>scanRelease=resolve);return route.fulfill({json:{counts:{calendar:1,messages:3,meebook:1,sensitive_skipped:2}}})
 }
 if(u.pathname.endsWith('/rpc/aula_set_child_mappings')){const p=route.request().postDataJSON();for(const m of p.p_mappings){const entry=state.mappings.find(x=>x.provider_child_key===m.provider_child_key);entry.person_id=m.person_id}return route.fulfill({json:null})}
 if(u.pathname.endsWith('/rpc/aula_review')){const p=route.request().postDataJSON(),f=state.findings.find(f=>f.id===p.p_finding_id);f.status=p.p_action==='ignore'?'ignored':'accepted';return route.fulfill({json:{status:f.status}})}
 return route.continue()
})
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
const snap=async(name,title)=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:join(out,name+'.png'),animations:'disabled'});shots.push({name,title});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' page overflow').toBe(true);if(await page.locator('.aula-dialog').count()){expect(await page.locator('.aula-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1),name+' dialog overflow').toBe(true);const footer=page.locator('.aula-dialog>footer');if(await footer.count())expect((await footer.boundingBox()).y+(await footer.boundingBox()).height).toBeLessThanOrEqual((await page.viewportSize()).height)}}
const close=async()=>{if(await page.locator('.aula-close').count())await page.locator('.aula-close').click()}
const family=async()=>{await close();await page.locator('[data-product-route="family"]').filter({visible:true}).first().click();await expect(page.locator('.aula-family-card')).toBeVisible();await page.waitForLoadState('networkidle')}
const emit=async(event,data,done=false)=>{await page.waitForFunction(()=>Boolean(window.__aulaTestStream));return page.evaluate(({event,data,done})=>window.__aulaTestEmit(event,data,done),{event,data,done})}
try{
 await page.goto('http://127.0.0.1:5198/');await family();await page.locator('.aula-family-card').scrollIntoViewIfNeeded();await snap('01-family-disconnected','Familie · Aula ikke forbundet')
 expect(await page.locator('.aula-family-card .aula-primary').evaluate(e=>({background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}))).toEqual({background:'rgb(36, 91, 72)',color:'rgb(255, 255, 255)'})
 await page.locator('.aula-family-card [data-aula="open"]').click();await snap('02-connect-intro','Forbind Aula · privatliv og forløb')
 await page.keyboard.press('Shift+Tab');expect(await page.locator('.aula-dialog').evaluate(e=>e.contains(document.activeElement))).toBe(true);checks.push('Dialog focus remains trapped; Escape/close supported')
 await page.locator('[data-aula="handoff"]').click();await expect(page.locator('#aula-handoff-code')).toHaveValue('S'.repeat(43));await snap('03-local-handoff','Forbind fra egen computer · syntetisk engangskode');expect(await page.locator('#aula-username').count()).toBe(0)
 await page.locator('[data-aula="check-handoff"]').click();await expect(page.locator('[data-handoff-status]')).toContainText('ikke klar');await snap('04-handoff-pending','Forbindelsen afventer lokal godkendelse')
 for(const width of [375,1280]){await page.setViewportSize({width,height:900});await snap('handoff-'+width,'Lokal forbindelse · '+width+'px')}
 await page.setViewportSize({width:390,height:844});state={connection:{status:'connected',connected_at:new Date().toISOString()},mappings:[],findings:[]};await page.locator('[data-aula="check-handoff"]').click();await expect(page.locator('[data-aula="discover"]')).toBeVisible();expect(await page.locator('#aula-handoff-code').count()).toBe(0);await snap('06-success','Aula forbundet · syntetisk handoff')
 state=structuredClone(linked);state.mappings=state.mappings.map(m=>({...m,person_id:null}));state.findings=[]
 await page.locator('[data-aula="discover"]').click();await expect(page.locator('.aula-progress')).toBeVisible();await snap('09-scanning','Scanning · følsomme beskeder springes over');await expect.poll(()=>Boolean(scanRelease)).toBe(true);scanRelease();scanRelease=null;await expect(page.locator('.aula-mappings')).toBeVisible()
 for(let i=0;i<state.mappings.length;i++)await page.locator('#aula-map-'+i).selectOption(linked.mappings[i].person_id)
 await expect(page.locator('[data-aula-mapping-avatar] .person-bubble')).toHaveCount(state.mappings.length);await snap('07-child-mapping','Børn · navn, klasse, avatar og eksplicit mapping')
 state.findings=structuredClone(linked.findings)
 await page.locator('[data-aula="save-mapping"]').click();await expect.poll(()=>Boolean(scanRelease)).toBe(true);scanRelease();scanRelease=null;await expect(page.locator('.aula-review-group')).toHaveCount(3)
 await snap('13-review-high','Review · klar til at tilføje')
 for(const [name,title,id]of [['17-homework','Lektiefund fra MeeBook',linked.findings[0].id],['18-reminder','Påmindelse om tusser',linked.findings[1].id],['16-existing-match','Eksisterende aftale matches',linked.findings[2].id],['19-trip','Tur med klassen',linked.findings[2].id],['14-review-medium','Review · dato kræver afklaring',linked.findings[4].id],['15-review-information','Review · generel information',linked.findings[5].id]]){await page.locator(`[data-aula-finding="${id}"]`).scrollIntoViewIfNeeded();await snap(name,title)}
 await family();await page.locator('.aula-family-card [data-aula="open"]').click();await snap('08-connected','Forbundet · overblik og sidste scanning');await page.locator('[data-aula="disconnect-confirm"]').click();await snap('25-disconnect','Afbryd forbindelse · accepterede poster bevares');await close()
 await page.locator('[data-product-route="today"]').filter({visible:true}).first().click();await expect(page.locator('.aula-today')).toBeVisible();await page.locator('.aula-today').scrollIntoViewIfNeeded();await snap('11-today-six','I dag · seks fund og gennemgang')
 await page.locator('.aula-today [data-aula="review"]').click();await page.locator('[data-aula="accept"]').first().click();await expect(page.locator('.aula-accepted')).toBeVisible();await page.locator('.aula-accepted>summary').click();await page.locator('.aula-accepted').scrollIntoViewIfNeeded();await snap('20-accepted','Accepteret fund · historik')
 for(const width of [375,430,768,1280]){await page.setViewportSize({width,height:900});await page.locator('.aula-body').evaluate(e=>e.scrollTop=0);await snap(width===375?'22-mobile-375':width===1280?'23-desktop':'responsive-'+width,`Review · ${width}px`)}
 await page.setViewportSize({width:390,height:844});await family();await page.locator('[data-open-settings="feeds"]').click();await expect(page.getByText('Carl · Aula-kalender',{exact:true})).toBeVisible();await page.getByText('Carl · Aula-kalender',{exact:true}).scrollIntoViewIfNeeded();await snap('21-legacy-feed','Eksisterende Aula-link · bevaret og markeret ældre')
 state.findings=state.findings.map(f=>({...f,status:'accepted'}));await page.reload();await page.locator('[data-product-route="today"]').filter({visible:true}).first().click();await page.waitForLoadState('networkidle');await expect(page.locator('.aula-today')).toHaveCount(0);await page.evaluate(()=>scrollTo(0,0));await snap('12-today-reviewed','I dag · Aula-kort skjult når alt er gennemgået')
 state.connection.status='reauth_required';await page.reload();await family();await page.locator('.aula-family-card [data-aula="open"]').click();await snap('10-reauth','Session udløbet · forbind igen')
 state.connection.status='connected';await page.reload();await family();await page.locator('.aula-family-card [data-aula="open"]').click();scanFails=true;await page.locator('[data-aula="scan"]').click();await expect(page.locator('.aula-error')).toBeVisible();await snap('24-transient-error','Midlertidig fejl · forbindelsen bevares')
 state=structuredClone(linked);scanFails=false;await family();await page.locator('[data-open-settings="account"]').click();await page.locator('[data-personal-locale]').selectOption('en-GB');await expect(page.locator('html')).toHaveAttribute('lang','en-GB')
 await page.reload();await family();await page.locator('.aula-family-card [data-aula="review"]').click();await expect(page.locator('.aula-dialog [data-aula="accept"]').first()).toHaveText('Add activity');await snap('28-english-review','Review · en-GB')
 checks.push('Full app Family/Today integration, local handoff states, mapping, review and legacy feed render without overflow at 375/390/430/768/1280px; en-GB actions verified')
 checks.push('No Aula network, password input or real provider data; Handoff code removed after advancing; footer actions remain within viewport')
 expect(errors).toEqual([])
 writeFileSync(join(reviewRoot,'browser-results.json'),JSON.stringify({status:'PASS',checks,screenshots:shots.length,runtimeErrors:errors,syntheticAula:true},null,2))
 const html=`<!doctype html><html lang="da"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aula 1.0 · visuel review</title><style>body{font:16px/1.6 system-ui;margin:0;background:#f2f5ee;color:#233e30}header{padding:40px;max-width:1100px;margin:auto}h1{font-size:34px;margin:8px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;padding:0 32px 48px}figure{margin:0;background:white;border:1px solid #d7e2d3;border-radius:16px;overflow:hidden}figcaption{padding:16px;font-weight:650}img{display:block;width:100%;height:500px;object-fit:contain;object-position:top;background:#e9eee5}a{color:inherit}small{display:block;color:#5c705d}</style><header><small>FAMILIEKALENDER · LOKALT REVIEW</small><h1>Aula i familiens hverdag</h1><p>${shots.length} skærme fra den rigtige app på Vercel dev. Login- og Aula-indhold er syntetiske testfixtures. Ingen MitID-login eller production-data er brugt.</p><p>Skærmene viser den godkendte aktivitetsmodel: skolefund bliver kalenderaktiviteter med valgte personer. De påvirker ikke pligter, stjerner eller lommepenge.</p><p>HTTP/Auth/RLS er testet separat mod den isolerede lokale Supabase-stack. Klik på en skærm for fuld størrelse.</p></header><main class="grid">${shots.map(s=>`<figure><figcaption>${s.title}</figcaption><a href="screenshots/${s.name}.png"><img src="screenshots/${s.name}.png" alt="${s.title}" loading="lazy"></a></figure>`).join('')}</main></html>`
 const reviewPath=join(reviewRoot,'review.html'),wallSection=existsSync(reviewPath)?readFileSync(reviewPath,'utf8').match(/<!-- WALL_PARITY_START -->[\s\S]*?<!-- WALL_PARITY_END -->/)?.[0]||'':'';writeFileSync(reviewPath,html.replace('</html>',wallSection+'</html>'));console.log('AULA BROWSER PASS:',shots.length,'screenshots')
}catch(error){await page.screenshot({path:join(reviewRoot,'browser-failure.png')});console.error('Synthetic page state:',(await page.locator('body').innerText()).slice(0,1600));console.error('Runtime errors:',errors);throw error}finally{await fixture.client.from('profiles').upsert({id:fixture.user.id,preferred_locale:'da-DK'});await context.close();await browser.close()}
