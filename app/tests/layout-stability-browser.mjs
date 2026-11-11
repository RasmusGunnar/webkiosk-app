// Real app + isolated PostgreSQL fixtures; delayed data/images make load shifts measurable.
import {expect} from '@playwright/test'
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import sharp from 'sharp'
import {routeTo} from './browser-actions.mjs'
import {db,query,actor,ids,hid,carl,personIds,root,api,server,browser,context,page,errors,unknown} from './tasks-people-fixture.mjs'
const baseline=process.argv.includes('--baseline'),phase=baseline?'before':'after',out=new URL('../../supabase/.temp/layout-stability/',import.meta.url)
mkdirSync(out,{recursive:true})
const png=await sharp({create:{width:180,height:240,channels:3,background:'#9eb8a3'}}).png().toBuffer()
await actor(null)
for(const [n,pid] of [carl,personIds[2]].entries())await query('update public.household_people set avatar_url=$1 where id=$2',[root+'/layout-avatar-'+n+'.png',pid])
await actor(ids.adult)
const act=async(action,payload)=>(await query('select public.reward_action($1,$2,$3,$4::jsonb) result',[randomUUID(),hid,action,JSON.stringify(payload)])).rows[0].result
const reward=(await act('catalog',{title:'Biograftur',emoji:'🎬',star_cost:25,active:true})).id
await act('goal',{person_id:carl,reward_id:reward})
let releasePhotos,photosReady=false,slowData=true,reads={},photoRequests=0
await context.route('**/layout-avatar-*.png',async route=>{photoRequests++;if(!photosReady)await new Promise(resolve=>{const previous=releasePhotos;releasePhotos=()=>{previous?.();resolve()}});await route.fulfill({contentType:'image/png',headers:{'cache-control':'public,max-age=3600'},body:png})})
await context.route(api+'/**',async route=>{const name=new URL(route.request().url()).pathname.split('/').pop();reads[name]=(reads[name]||0)+1;if(slowData&&['household_people','calendar_items','get_reward_state'].includes(name))await new Promise(r=>setTimeout(r,{household_people:800,calendar_items:500,get_reward_state:1100}[name]));await route.fallback()})
await context.addInitScript(()=>{
 window.layoutStats={shifts:[],frames:[],rebuilds:{header:0,pills:0,nav:0}};
 const selected={header:'.dashboard-header',pills:'#person-chipbar',nav:'.product-nav'},last={};let previous='';
 const rect=el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}};
 new PerformanceObserver(list=>{for(const entry of list.getEntries())window.layoutStats.shifts.push({value:entry.value,recent:entry.hadRecentInput,sources:entry.sources.map(s=>({node:s.node?.id||s.node?.className,from:s.previousRect.toJSON(),to:s.currentRect.toJSON()}))})}).observe({type:'layout-shift',buffered:true});
 const tick=()=>{const frame={};for(const [key,selector]of Object.entries(selected)){const el=document.querySelector(selector);if(el){if(last[key]&&last[key]!==el)window.layoutStats.rebuilds[key]++;last[key]=el;if(el.getClientRects().length)frame[key]=rect(el)}}const first=document.querySelector('#calendar-view');if(first)frame.content=rect(first);const sync=document.querySelector('#sync-status');if(sync?.getClientRects().length)frame.sync=rect(sync);const signature=JSON.stringify(frame);if(signature!==previous){window.layoutStats.frames.push(frame);previous=signature}requestAnimationFrame(tick)};requestAnimationFrame(tick);
})
const results=[],shots=[],extraChecks=[]
const shot=async(name,label)=>{await page.screenshot({path:fileURLToPath(new URL(phase+'-'+name+'.png',out)),fullPage:false});shots.push({name:phase+'-'+name,label})}
const boxes=()=>page.locator('.person-bubble,.person-chip').evaluateAll(nodes=>nodes.filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label')||e.dataset.personFilter,cls:e.className,x:r.x,y:r.y,width:r.width,height:r.height}}))
const cls=stats=>{let max=0,sum=0;for(const shift of stats.shifts)if(!shift.recent){sum+=shift.value;max=Math.max(max,shift.value)}return {sum,max}}
try{
 for(const width of [375,390,430]){
  const cdp=await context.newCDPSession(page);await cdp.send('Storage.clearDataForOrigin',{origin:root,storageTypes:'indexeddb,local_storage,cache_storage'});await cdp.detach()
  await page.setViewportSize({width,height:844});photosReady=false;releasePhotos=null;reads={};photoRequests=0;slowData=true
  const rewardsReady=page.waitForResponse(r=>r.url().includes('/rpc/get_reward_state'))
  await page.goto(root,{waitUntil:'domcontentloaded'});await expect(page.locator('#person-chipbar')).toBeVisible()
  const initial=await page.locator('#person-chipbar').boundingBox();await shot(width+'-initial',width+' px · første shell, data forsinket')
  await expect(page.locator('[data-person-filter="'+carl+'"]')).toBeVisible();await expect(page.locator('.person-chip-avatar img').first()).toBeAttached()
  await rewardsReady;await expect(page.locator('.surface-loading')).toHaveCount(0);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
  const loading=await boxes();await shot(width+'-avatar-loading',width+' px · initialer mens foto hentes')
  photosReady=true;releasePhotos?.();await page.waitForLoadState('networkidle');await expect.poll(()=>page.locator('.person-chip-avatar img').first().evaluate(e=>e.complete&&e.naturalWidth>0)).toBe(true)
  const loaded=await boxes(),cold=await page.evaluate(()=>structuredClone(window.layoutStats));await shot(width+'-loaded',width+' px · data og foto klar')
  const avatarStable=JSON.stringify(loading)===JSON.stringify(loaded)
  slowData=false
  const beforeReads={...reads},photosBeforeNavigation=photoRequests
  await page.evaluate(()=>{window.shellNodes={header:document.querySelector('.dashboard-header'),pills:document.querySelector('#person-chipbar'),nav:document.querySelector('.product-nav')}})
  for(const route of ['calendar','meals','tasks','family','calendar']){
   await routeTo(page,route);await page.waitForLoadState('networkidle')
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
   if(route==='tasks')await shot(width+'-stars',width+' px · stjernemål efter navigation')
  }
  const retained=await page.evaluate(()=>Object.fromEntries(Object.entries(window.shellNodes).map(([k,n])=>[k,n.isConnected&&n===document.querySelector({header:'.dashboard-header',pills:'#person-chipbar',nav:'.product-nav'}[k])]))),navigationReads=Object.fromEntries(['household_people','calendar_items','get_reward_state'].map(n=>[n,(reads[n]||0)-(beforeReads[n]||0)]))
  const navigationPhotoRequests=photoRequests-photosBeforeNavigation
  // A status change must not move the filter row, even after the input grace period.
  const pillsBefore=await page.locator('#person-chipbar').boundingBox();await context.setOffline(true);await expect(page.locator('#sync-status')).toContainText(/offline/i);const pillsAfter=await page.locator('#person-chipbar').boundingBox()
  await context.setOffline(false);await page.waitForLoadState('networkidle')
  slowData=true;await page.reload({waitUntil:'domcontentloaded'});await expect(page.locator('#person-chipbar')).toBeVisible();await shot(width+'-warm',width+' px · varm start fra lokal cache');await page.waitForLoadState('networkidle')
  const warm=await page.evaluate(()=>structuredClone(window.layoutStats)),result={width,initial,loadedPills:loaded.filter(b=>b.cls.includes('person-chip ')),avatarStable,retained,navigationReads,navigationPhotoRequests,statusPillsStable:JSON.stringify(pillsBefore)===JSON.stringify(pillsAfter),coldCls:cls(cold),warmCls:cls(warm),coldRebuilds:cold.rebuilds,photoRequests,cold,warm}
  results.push(result);console.log('LAYOUT '+phase+' '+JSON.stringify({width,avatarStable,retained,navigationReads,statusPillsStable:result.statusPillsStable,coldCls:result.coldCls,warmCls:result.warmCls,coldRebuilds:result.coldRebuilds,photoRequests}))
  if(!baseline){expect(avatarStable).toBe(true);expect(Object.values(retained).every(Boolean)).toBe(true);expect(Object.values(navigationReads).every(n=>n===0)).toBe(true);expect(navigationPhotoRequests).toBe(0);expect(result.statusPillsStable).toBe(true);expect(result.coldCls.sum).toBeLessThan(0.01);expect(result.warmCls.sum).toBeLessThan(0.01)}
 }
 if(!baseline){
  slowData=false
  // Keyed shell nodes must still reflect changed person metadata and photos.
  await page.evaluate(pid=>{window.originalPersonPill=document.querySelector('[data-person-filter="'+pid+'"]')},carl)
  await actor(null);await query('update public.household_people set name=$1,color=$2,avatar_url=$3 where id=$4',['Carl test','#326655',root+'/layout-avatar-new.png',carl])
  await page.evaluate(()=>window.dispatchEvent(new Event('online')))
  const pill=page.locator('[data-person-filter="'+carl+'"]')
  await expect(pill).toContainText('Carl test');await expect(pill.locator('img')).toHaveAttribute('src',root+'/layout-avatar-new.png')
  expect(await page.evaluate(()=>window.originalPersonPill.isConnected)).toBe(true)
  expect(await pill.locator('.person-bubble').evaluate(el=>el.style.getPropertyValue('--person-color'))).toBe('#326655')
  const box=await pill.locator('.person-bubble').boundingBox();await expect(pill.locator('img')).toHaveAttribute('data-avatar-loaded','true');expect(await pill.locator('.person-bubble').boundingBox()).toEqual(box)
  await page.waitForLoadState('networkidle')
  extraChecks.push('Person name, colour and photo update in the same keyed pill')
  await context.route('**/layout-avatar-error.png',route=>route.fulfill({status:404,body:'synthetic missing photo'}))
  await actor(null);await query('update public.household_people set avatar_url=$1 where id=$2',[root+'/layout-avatar-error.png',carl]);await page.evaluate(()=>window.dispatchEvent(new Event('online')))
  await expect(pill.locator('img')).toHaveCount(0);await expect(pill.locator('.person-bubble-face')).toContainText('CT');expect(await pill.locator('.person-bubble').boundingBox()).toEqual(box)
  extraChecks.push('Failed image keeps initials and identical avatar geometry')
  await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.person-bubble img').first()).toHaveCSS('transition-duration','0s');extraChecks.push('Reduced motion disables photo crossfade')
  for(const [surface,width,height]of [['desktop',1440,1000],['kiosk',1920,1080]]){
   await page.setViewportSize({width,height})
   if(surface==='kiosk'){await page.evaluate(({uid,hid,api})=>localStorage.setItem('familiekalender.device.v1:'+api,JSON.stringify({kiosk:{userId:uid,householdId:hid}})),{uid:ids.adult,hid,api});await page.reload()}
   await routeTo(page,'today');await page.waitForLoadState('networkidle')
   await page.evaluate(()=>{window.shellNodes={header:document.querySelector('.dashboard-header'),nav:document.querySelector('.product-nav'),pills:document.querySelector('#person-chipbar')}})
   for(const route of ['calendar','tasks','today'])await routeTo(page,route)
   expect(await page.evaluate(()=>Object.values(window.shellNodes).every(el=>el.isConnected))).toBe(true)
   const avatars=await page.locator('.person-bubble').evaluateAll(nodes=>nodes.filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return [r.width,r.height,getComputedStyle(el).flexShrink]}))
   expect(avatars.every(([w,h,shrink])=>w===h&&w>0&&shrink==='0')).toBe(true)
   await shot(surface,surface+' · samme shell og faste avatarstørrelser');extraChecks.push(surface+': shared shell survives navigation; all visible avatars square and non-shrinking')
  }
 }
 expect(errors).toEqual([]);expect(unknown).toEqual([])
}finally{
 writeFileSync(new URL(phase+'.json',out),JSON.stringify({phase,results,extraChecks,errors,unknown,shots,boundary:'Deterministically delayed local fixture data/images. Browser emulates mobile viewport, not a physical phone. Request routing disables HTTP cache; request counts are diagnostic, not a browser-cache benchmark.'},null,2))
 const reviews=['before','after'].filter(p=>existsSync(new URL(p+'.json',out))).map(p=>JSON.parse(readFileSync(new URL(p+'.json',out),'utf8')))
 writeFileSync(new URL('review.html',out),'<!doctype html><html lang="da"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Familiekalender · Layoutstabilitet</title><style>body{font:16px system-ui;background:#f4f5ef;color:#304738;margin:30px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}figure{margin:0;background:white;padding:12px;border-radius:12px}img{width:100%}figcaption{margin-bottom:12px}pre{white-space:pre-wrap}</style><h1>Layoutstabilitet · før / efter</h1><p>Samme lokale testfamilie, forsinkede data og billeder. Mobilbredder 375 / 390 / 430 px. Ingen production-data ændret.</p>'+reviews.map(r=>'<h2>'+r.phase+'</h2><pre>'+JSON.stringify(r.results.map(({width,coldCls,warmCls,avatarStable,retained,navigationReads,statusPillsStable})=>({width,coldCls,warmCls,avatarStable,retained,navigationReads,statusPillsStable})),null,2)+'</pre><div class="grid">'+r.shots.map(s=>'<figure><figcaption>'+s.label+'</figcaption><a href="'+s.name+'.png"><img src="'+s.name+'.png" loading="lazy"></a></figure>').join('')+'</div>').join('')+'</html>')
 releasePhotos?.();await browser.close();await server.close();await db.close()
}
