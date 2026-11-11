import {expect} from '@playwright/test'
import {mkdirSync,writeFileSync} from 'node:fs'
import {routeTo,toggleView} from './browser-actions.mjs'
import {db,query,actor,today,ids,hid,carl,root,api,server,browser,context,page,errors,unknown} from './tasks-people-fixture.mjs'
const out=new URL('../../supabase/.temp/visual-regression-performance/',import.meta.url);mkdirSync(out,{recursive:true})
let count=9,mixed=false,writes=0
const rows=()=>Array.from({length:count},(_,i)=>({id:'30000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),household_id:hid,created_by:ids.adult,title:mixed&&i===0?'En lang aktivitetstitel som bruger to linjer og en længere beskrivelse':'Aktivitet '+(i+1),type:mixed?['Aktivitet','Fritidsinteresse','Opgave','Madplan'][i%4]:'Aktivitet',date:today,time:'16:00',person_ids:[carl],data:{},done:false}))
await context.route(api+'/rest/v1/calendar_items?**',route=>{if(route.request().method()!=='GET'){writes++;return route.abort()}return route.fulfill({json:rows(),headers:{'access-control-allow-origin':'*'}})})
await context.route('**/api/aula-status',route=>route.fulfill({json:{connection:null,mappings:[],findings:[]}}))
const checksum=async()=>{await actor(null);return (await query("select count(*)::int count,md5(string_agg(to_jsonb(c)::text,'' order by id)) checksum from public.calendar_items c where household_id=$1",[hid])).rows[0]}
const before=await checksum(),results=[]
await context.addInitScript(()=>{window.cls=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.cls+=e.value}).observe({type:'layout-shift',buffered:true})})
async function measure(){return page.locator('.week-grid .day-card[data-day="'+today+'"]').evaluate(card=>{
 const body=card.querySelector('.day-sections'),over=body.querySelector('.day-overflow'),sections=[...body.querySelectorAll(':scope>.calendar-day-section,:scope>.day-meals')]
 const all=sections.flatMap(s=>[...(s.querySelector('.calendar-items')||s).children]),saved=[...sections,...all,over].map(n=>[n,n.hidden])
 const bounds=body.getBoundingClientRect(),bottom=()=>Math.max(bounds.top,...[...body.children].filter(n=>!n.hidden).map(n=>n.getBoundingClientRect().bottom))
 const visible=all.filter(n=>!n.hidden),result={width:innerWidth,height:innerHeight,total:all.length,visible:visible.length,hidden:all.length-visible.length,available:bounds.height,used:bottom()-bounds.top,groups:sections.map(s=>({class:s.className,visible:!s.hidden})),cls:window.cls}
 sections.forEach(n=>n.hidden=false);all.forEach(n=>n.hidden=false);over.hidden=true
 result.allRequired=bottom()-bounds.top
 saved.forEach(([n,h])=>n.hidden=h)
 result.hiddenCouldFit=sections.map(s=>{
  const row=[...(s.querySelector('.calendar-items')||s).children].find(n=>n.hidden);if(!row)return false
  const was=s.hidden;s.hidden=false;row.hidden=false;const fits=bottom()<=bounds.bottom+0.5;s.hidden=was;row.hidden=true;return fits
 }).some(Boolean)
 return result
})}
try{
 for(const height of [768,900,1080,1440])for(const n of [2,6,7,9,12]){
  count=n;await page.setViewportSize({width:1440,height});await page.goto(root);await page.waitForLoadState('networkidle');await routeTo(page,'calendar');if(!await page.locator('.week-grid').count())await toggleView(page)
  const m=await measure();results.push(m)
  expect(m.total).toBe(n);expect(m.used).toBeLessThanOrEqual(m.available+0.5)
  if(m.allRequired<=m.available+0.5)expect(m.hidden).toBe(0)
  else {expect(m.hidden).toBeGreaterThan(0);expect(m.hiddenCouldFit).toBe(false)}
  expect(m.cls).toBeLessThan(0.01)
 }
 count=12;mixed=true;await page.setViewportSize({width:1440,height:900});await page.reload();await page.waitForLoadState('networkidle');await routeTo(page,'calendar')
 const groups=await measure();expect(groups.groups.every(g=>g.visible)).toBe(true);expect(groups.used).toBeLessThanOrEqual(groups.available+0.5);expect(groups.hiddenCouldFit).toBe(false);results.push({...groups,mixed:true})
 await page.locator('.day-card[data-day="'+today+'"] .day-overflow').click();expect(await page.locator('.full-day-detail [data-calendar-item],.full-day-detail [data-task-detail],.full-day-detail [data-plan-edit]').count()).toBe(12);await page.keyboard.press('Escape')
 const stable=await page.locator('.week-grid').evaluate(async grid=>{const snapshots=[];for(let i=0;i<10;i++){await new Promise(requestAnimationFrame);snapshots.push(grid.outerHTML)}return new Set(snapshots).size===1});expect(stable).toBe(true)
 await page.setViewportSize({width:390,height:844});await routeTo(page,'calendar');if(await page.locator('.week-grid').count())await toggleView(page);expect(await page.locator('[data-adaptive-day]').count()).toBe(0);expect(await page.locator('.day-overflow:visible').count()).toBe(0)
 await page.evaluate(({api,uid,hid})=>localStorage.setItem('familiekalender.device.v1:'+api,JSON.stringify({kiosk:{userId:uid,householdId:hid}})),{api,uid:ids.adult,hid})
 for(const height of [600,1080,1440]){await page.setViewportSize({width:1920,height});await page.reload();await page.waitForLoadState('networkidle');await routeTo(page,'calendar');if(!await page.locator('.week-grid').count())await toggleView(page);const m=await measure();results.push({...m,kiosk:true});expect(m.used).toBeLessThanOrEqual(m.available+0.5);expect(m.hiddenCouldFit).toBe(false)}
 expect(await checksum()).toEqual(before);expect(writes).toBe(0);expect(errors).toEqual([]);expect(unknown).toEqual([])
 console.log('CAPACITY PASS: 20 desktop scenarios, mixed groups, full day, stable layout, mobile and 3 kiosk heights; calendar rows unchanged')
}finally{writeFileSync(new URL('capacity.json',out),JSON.stringify({results,before,after:await checksum(),writes,errors,unknown},null,2));await browser.close();await server.close();await db.close()}
