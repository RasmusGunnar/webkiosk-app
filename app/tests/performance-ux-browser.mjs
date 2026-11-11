// Real application + PostgreSQL fixtures. All delays/images/people are synthetic.
import {expect} from '@playwright/test'
import {mkdirSync,writeFileSync} from 'node:fs'
import {randomBytes} from 'node:crypto'
import sharp from 'sharp'
import {routeTo} from './browser-actions.mjs'
import {db,query,actor,ids,hid,carl,personIds,ordinary,root,api,server,browser,context,page,errors,unknown} from './tasks-people-fixture.mjs'
const before=process.argv.includes('--baseline'),built=process.env.PERFORMANCE_BUILD==='1',phase=before?(built?'before-built':'before'):built?'after-built':'after',out=new URL('../../supabase/.temp/performance-ux/',import.meta.url)
mkdirSync(out,{recursive:true})
const image=await sharp(randomBytes(2048*1536*3),{raw:{width:2048,height:1536,channels:3}}).jpeg({quality:70}).toBuffer()
await actor(null)
for(const id of [carl,personIds[2]])await query('update public.household_people set avatar_path=$1,avatar_url=null where id=$2',[hid+'/'+id+'/fixture.jpg',id])
let signs=0,images=0,acks=0,slow=true
const wait=ms=>new Promise(r=>setTimeout(r,ms))
await context.route(api+'/storage/v1/object/sign/household-avatars',async route=>{
 signs++;if(slow)await wait(600);const {paths}=route.request().postDataJSON()
 expect(paths.every(p=>p.startsWith(hid+'/'))).toBe(true)
 await route.fulfill({json:paths.map(path=>({path,signedURL:'/object/sign/household-avatars/'+path+'?token=synthetic-'+signs})),headers:{'access-control-allow-origin':'*'}})
})
await context.route(api+'/storage/v1/object/sign/household-avatars/**',async route=>{images++;if(slow)await wait(1200);await route.fulfill({contentType:'image/jpeg',headers:{'cache-control':'public,max-age=3600','access-control-allow-origin':'*'},body:image})})
await context.route(api+'/rest/**',async route=>{
 const name=new URL(route.request().url()).pathname.split('/').pop()
 if(name==='reward_action'){acks++;await wait(1800)}
 else if(slow&&['household_people','calendar_items','get_reward_state','subscription_access'].includes(name))await wait({household_people:800,calendar_items:400,get_reward_state:2800,subscription_access:900}[name])
 await route.fallback()
})
await context.route('**/api/aula-status',route=>route.fulfill({json:{connection:null,mappings:[],findings:[],automatic:{active:true}}}))
await context.addInitScript(()=>{
 window.perfUX={images:[],cls:[],shell:null,pills:null,started:performance.now()}
 new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.perfUX.cls.push(e.value)}).observe({type:'layout-shift',buffered:true})
 const tick=()=>{const s=window.perfUX;if(!s.shell&&document.querySelector('.product-nav'))s.shell=performance.now();if(!s.pills&&document.querySelector('#person-chipbar [data-person-filter]:nth-child(2)'))s.pills=performance.now();if(!s.images.length){const imgs=[...document.querySelectorAll('#person-chipbar img')];if(imgs.length&&imgs.every(i=>i.complete&&i.naturalWidth))s.images.push(performance.now())}requestAnimationFrame(tick)};requestAnimationFrame(tick)
})
const results=[]
const metrics=()=>page.evaluate(()=>({observed:window.perfUX,timings:performance.getEntriesByType('measure').filter(e=>e.name.startsWith('fk:')).map(e=>({name:e.name,duration:e.duration,startTime:e.startTime,detail:e.detail}))}))
try{
 for(const width of [375,390,430,1440,1920]){
  const cdp=await context.newCDPSession(page);await cdp.send('Storage.clearDataForOrigin',{origin:root,storageTypes:'indexeddb,local_storage,cache_storage,service_workers'});await cdp.detach()
  if(width===1920)await context.addInitScript(({api,uid,hid})=>localStorage.setItem('familiekalender.device.v1:'+api,JSON.stringify({kiosk:{userId:uid,householdId:hid}})),{api,uid:ids.adult,hid})
  await page.setViewportSize({width,height:width<700?844:1080});signs=0;images=0;slow=true
  await page.goto(root);await expect(page.locator('.product-nav')).toBeVisible({timeout:15000});await routeTo(page,'today');await page.waitForLoadState('networkidle')
  await expect.poll(()=>page.evaluate(()=>window.perfUX.images.length)).toBe(1)
  const cold={...await metrics(),signs,images}
  slow=false;let n=images,signStart=signs
  for(const route of ['calendar','tasks',...(width===1920?[]:['family']),'calendar'])await routeTo(page,route)
  await page.waitForLoadState('networkidle');const navigation={additionalImages:images-n,additionalSigns:signs-signStart}
  // Modal is the previously network-blocked path: feedback includes a usable undo action.
  await page.locator('[data-task-detail="'+ordinary+'"]').first().click()
  const row=page.locator('.reward-modal [data-task-person="'+carl+'"]'),first=await row.locator('[data-reward-action=complete]').count()?'complete':'undo',opposite=first==='complete'?'undo':'complete'
  await page.evaluate(()=>{window.keptTaskNodes=[...document.querySelectorAll(".dashboard-header,#person-chipbar,.product-nav,#calendar-view,.reward-modal img")]});
  n=images;const ackBefore=acks
  await row.locator('[data-reward-action='+first+']').evaluate((b,opposite)=>{
   const start=performance.now(),container=b.closest('[data-task-person]');window.taskVisualMs=null
   b.click();const check=()=>{const button=container.querySelector('[data-reward-action="'+opposite+'"]'),replacement=document.querySelector('.reward-modal [data-task-person="'+container.dataset.taskPerson+'"] [data-reward-action="'+opposite+'"]');if((button&&!button.disabled)||(replacement&&!replacement.disabled))window.taskVisualMs=performance.now()-start;else requestAnimationFrame(check)};requestAnimationFrame(check)
  },opposite)
  await expect(row.locator('[data-reward-action='+opposite+']')).toBeEnabled({timeout:8000})
  await expect.poll(()=>page.evaluate(()=>window.taskVisualMs)).not.toBeNull()
  if(!before)await expect.poll(()=>page.evaluate(()=>performance.getEntriesByName('fk:task_optimistic_feedback').length)).toBeGreaterThan(0)
  const actionReady=await metrics(),retainedTaskNodes=await page.evaluate(()=>window.keptTaskNodes.every(n=>n.isConnected))
  if(!before)await row.locator('[data-reward-action='+opposite+']').evaluate(b=>b.click()) // rapid reverse while ACK is delayed
  if(!before)await expect.poll(()=>page.evaluate(()=>performance.getEntriesByName('fk:task_final_sync').length),{timeout:10000}).toBe(2)
  await page.waitForLoadState('networkidle')
  const action={ready:actionReady,settled:await metrics(),additionalImages:images-n,requests:acks-ackBefore,retainedTaskNodes,visualMs:await page.evaluate(()=>window.taskVisualMs)}
  await page.keyboard.press('Escape');await routeTo(page,'today')
  // A warm production shell includes its installed static cache. Clearing Cache
  // Storage without unregistering the old worker would prevent reinstall/precache.
  if(built)await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}))})
  const warmStart={images,signs};slow=true;await page.reload({waitUntil:'domcontentloaded'})
  await expect(page.locator('.product-nav')).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.perfUX.images.length)).toBe(1)
  const earlyWarm=await metrics();await page.waitForLoadState('networkidle')
  const warm={...earlyWarm,additionalImages:images-warmStart.images,additionalSigns:signs-warmStart.signs}
  const result={width,cold,navigation,action,warm};results.push(result)
  console.log(JSON.stringify({width,phase,coldImages:cold.images,navigation,warmImages:warm.additionalImages,coldAvatarMs:cold.observed.images[0],warmAvatarMs:warm.observed.images[0],taskMs:action.ready.timings.filter(t=>t.name==='fk:task_optimistic_feedback').at(-1)?.duration}))
  await page.screenshot({path:new URL(phase+'-'+width+'.png',out).pathname.replace(/^\/([A-Z]:)/,'$1')})
  if(!before){
   expect(retainedTaskNodes).toBe(true);expect(navigation.additionalImages).toBe(0);expect(navigation.additionalSigns).toBe(0);expect(action.additionalImages).toBe(0);expect(warm.additionalImages).toBe(0);expect(warm.additionalSigns).toBe(0)
   expect(action.ready.timings.filter(t=>t.name==='fk:task_optimistic_feedback').at(-1)?.duration).toBeLessThan(200)
   expect(warm.timings.find(t=>t.name==='fk:app_shell_ready').duration).toBeLessThan(200)
   expect(warm.timings.find(t=>t.name==='fk:people_ready').duration).toBeLessThan(300)
   const appStart=warm.timings.find(t=>t.name==='fk:app_shell_ready').startTime
   expect(warm.observed.images[0]-appStart).toBeLessThan(500)
   if(built){expect(warm.observed.shell).toBeLessThan(200);expect(warm.observed.pills).toBeLessThan(300);expect(warm.observed.images[0]).toBeLessThan(500)}
   expect(warm.observed.cls.reduce((a,b)=>a+b,0)).toBeLessThan(0.01)
   const routes=action.ready.timings.filter(t=>t.name==='fk:route_content_ready');expect(routes.length).toBeGreaterThan(2);expect(routes.every(t=>t.duration<150)).toBe(true)
  }
 }
 expect(errors).toEqual([]);expect(unknown).toEqual([])
}catch(error){console.log(JSON.stringify({signs,images,errors,unknown,metrics:await metrics(),photos:await page.locator("#person-chipbar img").evaluateAll(imgs=>imgs.map(i=>({blob:i.src.startsWith("blob:"),complete:i.complete,width:i.naturalWidth})))}));await page.screenshot({path:new URL(phase+'-failure.png',out).pathname.replace(/^\/([A-Z]:)/,'$1')});throw error}finally{
 writeFileSync(new URL(phase+'.json',out),JSON.stringify({phase,imageBytes:image.length,delays:{people:800,sign:600,image:1200,rewards:2800,subscription:900,taskAck:1800},results,errors,unknown},null,2))
 await browser.close();await server.close();await db.close()
}
