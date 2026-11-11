// Real app shell with synthetic Aula responses; no provider or production data.
import {expect} from '@playwright/test'
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import sharp from 'sharp'
import {routeTo} from './browser-actions.mjs'
import {finding} from './aula-activity.fixtures.js'
import {db,query,actor,today,ids,hid,personIds,root,api,server,browser,context,page,errors,unknown} from './tasks-people-fixture.mjs'
const before=process.argv.includes('--baseline'),phase=before?'before':'after',out=new URL('../../supabase/.temp/aula-today-ux/',import.meta.url)
mkdirSync(out,{recursive:true})
await actor(null)
await query("insert into public.calendar_items(id,household_id,created_by,title,type,date,person_ids,data) values($1,$2,$3,'Pasta med tomatsauce','Madplan',$4,$5,'{}')",[randomUUID(),hid,ids.adult,today,[personIds[2]]])
await query("insert into public.calendar_items(id,household_id,created_by,title,type,date,time,person_ids,data) values($1,$2,$3,'Svømning','Fritidsinteresse',$4::date+1,'17:00',$5,'{}')",[randomUUID(),hid,ids.adult,today,[personIds[2]]])
let state,delay=0,statusReads=0,writes=0,failStatus=false,releasePhoto,photosReady=false
const makeState=count=>({connection:{status:'connected'},mappings:[],findings:[
 ...Array.from({length:count},(_,i)=>finding({id:'action-'+i,person_id:personIds[i%2+1],person_ids:[personIds[i%2+1]],date:today,title:i===0?'Forbered porteføljesamtale':i===1?'Matematikkens dag':'Skoleaktivitet '+(i+1),review_state:i%2?'UPDATED':'NEW',confidence:i%2?'MEDIUM':'HIGH'})),
 ...Array.from({length:30},(_,i)=>finding({id:'info-'+i,proposed_action:'NO_ACTION',type:'GENERAL_INFO',confidence:'LOW'})),
 ...['accepted','ignored','stale','suppressed'].map(status=>finding({id:status,status}))
]})
await context.route('**/api/aula-status',async route=>{statusReads++;if(delay)await new Promise(r=>setTimeout(r,delay));await route.fulfill(failStatus?{status:503,json:{code:'AULA_TEMPORARY_ERROR'}}:{json:state})})
const photo=await sharp({create:{width:180,height:240,channels:3,background:'#b98486'}}).png().toBuffer()
await context.route('**/attention-avatar-*.png',async route=>{if(!photosReady)await new Promise(r=>{const previous=releasePhoto;releasePhoto=()=>{previous?.();r()}});await route.fulfill({contentType:'image/png',body:photo})})
await context.route('**/api/aula-scan',route=>{writes++;return route.abort()})
await context.route(api+'/**/aula_review',route=>{writes++;return route.abort()})
await context.addInitScript(()=>{
 window.aulaLayout=[]
 new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.aulaLayout.push({value:e.value,nodes:e.sources.map(s=>s.node?.className||s.node?.id)})}).observe({type:'layout-shift',buffered:true})
})
const shots=[],checks=[],measurements=[]
const snap=async(name,label)=>{await page.screenshot({path:fileURLToPath(new URL(phase+'-'+name+'.png',out))});shots.push({name:phase+'-'+name,label})}
async function load(width,count){
 state=makeState(count);await page.setViewportSize({width,height:1000});await page.goto(root);await page.waitForLoadState('networkidle');await routeTo(page,'today');await page.waitForLoadState('networkidle')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
}
try{
 for(const count of [0,1,2,19,50]){
  await load(1440,count)
  const card=page.locator('.aula-today'),day=await page.locator('.home-layout>.day-view').boundingBox(),summary=await page.locator('.ux-day-stats').boundingBox()
  measurements.push({width:1440,count,dayTop:day.y,summaryBottom:summary.y+summary.height})
  if(!before){
   await expect(card).toHaveCount(count?1:0)
   if(count){await expect(card.locator('li')).toHaveCount(Math.min(count,2));await expect(card.locator('[data-aula="review"]')).toHaveText('Gennemgå '+count);await expect(page.locator('.home-aside>.aula-today')).toHaveCount(1);expect((await card.boundingBox()).x).toBeGreaterThan(day.x+day.width)}
   await expect(page.locator('.home-aside .ux-dinner')).toContainText('Pasta med tomatsauce')
   await expect(page.locator('.home-aside .next-panel')).toContainText('Svømning')
   expect(day.y-summary.y-summary.height).toBeLessThan(30)
  }
  if(count===19||count===0)await snap('desktop-'+count,'Desktop · '+count+' handlingskrævende fund, mad og næste aftale')
  if(count===19){await page.evaluate(()=>scrollTo(0,180));await snap('desktop-context','Desktop · Aula, aftensmad og næste aftale i sidekolonnen');await page.evaluate(()=>scrollTo(0,0))}
 }
 checks.push('Desktop counts 0 / 1 / 2 / 19 / 50; calendar starts directly after summary')
 for(const width of [375,390,430,768,1024]){
  await load(width,19)
  const card=page.locator('.aula-today'),c=await card.boundingBox(),day=await page.locator(width<700?'.mobile-agenda-day':'.home-layout>.day-view').boundingBox()
  if(!before){expect(c.y+c.height).toBeLessThanOrEqual(day.y);expect(c.height).toBeLessThan(280);await expect(card.locator('li')).toHaveCount(2)}
  await snap('compact-'+width,width+' px · kompakt Aula før dagens aktiviteter')
  await card.locator('[data-aula="review"]').click();await expect(page.locator('.aula-dialog')).toBeVisible()
  await expect(page.locator('.aula-dialog [data-aula="accept"]')).toHaveCount(19)
  await expect(page.locator('.aula-dialog [data-aula="mark-reviewed"]')).toHaveCount(30)
  await page.locator('.aula-dialog [data-aula="close"]').click()
  await load(width,0);if(!before)await expect(page.locator('.aula-today')).toHaveCount(0)
  if(width===390)await snap('mobile-zero','Mobil · ingen handlingskrævende Aula-fund')
 }
 checks.push('375 / 390 / 430 / tablet 768 / 1024; CTA opens existing review with 19 actionable items')
 // A deliberately late status response must not insert a card into a settled day.
 for(const width of [390,1440]){
  state=makeState(19);delay=1800;await page.setViewportSize({width,height:1000})
  await page.goto(root,{waitUntil:'domcontentloaded'});await expect(page.locator('.product-nav')).toBeVisible()
  if(!before)await expect(page.locator('.surface-loading')).toBeVisible()
  await page.waitForLoadState('networkidle');await expect(page.locator('.aula-today')).toBeVisible()
  const shifts=await page.evaluate(()=>window.aulaLayout),cls=shifts.reduce((sum,e)=>sum+e.value,0);measurements.push({width,lateStatusCls:cls,shifts})
  if(!before)expect(cls).toBeLessThan(0.01)
  delay=0
 }
 checks.push('Delayed initial Aula status resolves within the stable content loading boundary')
 if(!before){
  for(const width of [390,1440]){
   photosReady=false;releasePhoto=null
   await actor(null);await query('update public.household_people set avatar_url=$1 where id=$2',[root+'/attention-avatar-'+width+'.png',personIds[1]])
   // Start from an empty household cache: the experiment changes the fixture's
   // photo URL, so a warm cache would also measure that separate data refresh.
   const cdp=await context.newCDPSession(page);await cdp.send('Storage.clearDataForOrigin',{origin:root,storageTypes:'indexeddb,local_storage,cache_storage'});await cdp.detach()
   state=makeState(19);await page.setViewportSize({width,height:1000});await page.goto(root,{waitUntil:'domcontentloaded'})
   const card=page.locator('.aula-today');await expect(card).toBeVisible();await expect(card.locator('img')).toBeAttached()
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
   const geometry=()=>card.evaluate(el=>[el,...el.querySelectorAll('.person-bubble,li')].map(node=>{const r=node.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}))
   const loading=await geometry();expect(loading.every(r=>r[2]>0&&r[3]>0)).toBe(true);await snap('avatar-loading-'+width,width+' px · initialer før foto');await expect.poll(()=>Boolean(releasePhoto)).toBe(true);photosReady=true;releasePhoto();releasePhoto=null
   await page.waitForLoadState('networkidle');await expect(card.locator('img')).toHaveAttribute('data-avatar-loaded','true');expect(await geometry()).toEqual(loading)
   await snap('avatar-loaded-'+width,width+' px · foto uden geometrisk ændring')
  }
  checks.push('Photo loading preserves identical card, row and avatar geometry on mobile and desktop')
  await actor(null);await query('update public.household_people set avatar_url=null where id=$1',[personIds[1]])
  failStatus=true;await load(390,0);await expect(page.locator('.mobile-agenda-day')).toBeVisible();await expect(page.locator('.surface-loading')).toHaveCount(0);await expect(page.locator('.aula-today')).toHaveCount(0);failStatus=false
  checks.push('Failed status read leaves the family day usable without a stale attention card')
 }
 expect(writes).toBe(0);expect(errors).toEqual([]);expect(unknown).toEqual([])
 console.log(JSON.stringify({phase,checks,measurements,statusReads,writes,errors},null,2))
}finally{
 writeFileSync(new URL(phase+'.json',out),JSON.stringify({phase,checks,measurements,shots,statusReads,writes,errors,unknown},null,2))
 const reports=['before','after'].filter(p=>existsSync(new URL(p+'.json',out))).map(p=>JSON.parse(readFileSync(new URL(p+'.json',out),'utf8')))
 writeFileSync(new URL('review.html',out),'<!doctype html><html lang="da"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Aula på I dag · før / efter</title><style>body{font:16px system-ui;background:#f4f5ef;color:#304738;margin:30px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}figure{margin:0;background:white;padding:12px;border-radius:12px}img{width:100%}figcaption{margin-bottom:12px}</style><h1>Aula på I dag · før / efter</h1><p>Den rigtige app med syntetiske fund og lokale data. Ingen production-data ændret. Mobilbredder er browseremulering.</p>'+reports.map(r=>'<h2>'+r.phase+'</h2><div class="grid">'+r.shots.map(s=>'<figure><figcaption>'+s.label+'</figcaption><a href="'+s.name+'.png"><img src="'+s.name+'.png" loading="lazy"></a></figure>').join('')+'</div>').join('')+'</html>')
 releasePhoto?.();await browser.close();await server.close();await db.close()
}
