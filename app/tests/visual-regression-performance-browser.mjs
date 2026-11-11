// Three read-only source revisions, identical synthetic household, real app/RPCs.
import {expect} from '@playwright/test'
import {mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {routeTo,openSettings,toggleView} from './browser-actions.mjs'
import {finding} from './aula-activity.fixtures.js'
import {db,query,actor,today,ids,hid,carl,personIds,ordinary,root,api,server,browser,context,page,errors,unknown} from './tasks-people-fixture.mjs'
const phase=process.env.VISUAL_PHASE||'fixed',out=new URL('../../supabase/.temp/visual-regression-performance/',import.meta.url)
mkdirSync(out,{recursive:true})
const shots=[],diagnostics=[],geometry=[]
let nextId=0
const randomUUID=()=> '20000000-0000-4000-8000-'+String(++nextId).padStart(12,'0')
const action=async(name,payload)=>{await actor(ids.adult);return (await query('select public.reward_action($1,$2,$3,$4::jsonb) result',[randomUUID(),hid,name,JSON.stringify(payload)])).rows[0].result}
await actor(null)
await query("insert into public.calendar_items(id,household_id,created_by,title,type,date,person_ids,data) values($1,$2,$3,'Pasta med tomatsauce','Madplan',$4,$5,'{}')",[randomUUID(),hid,ids.adult,today,[carl]])
const reward=await action('catalog',{title:'Biograftur',emoji:'🎬',star_cost:25,active:true})
await action('goal',{person_id:carl,reward_id:reward.id})
for(const pid of [carl,personIds[2]])await action('allowance_save',{person_id:pid,cadence:'week',amount_minor:10000,start_today:true,duties:[{title:'Dæk bord',schedule:'daily',approval:false}]})
await context.route('**/api/aula-status',route=>route.fulfill({json:{connection:{status:'connected'},mappings:[],automatic:{active:true},findings:Array.from({length:3},(_,i)=>finding({id:'synthetic-'+i,person_id:carl,person_ids:[carl],date:today,title:['Husk idrætstøj','Læs kapitel 4','Skoleaktivitet'][i],review_state:'NEW',confidence:'HIGH'}))}}))
await context.addInitScript(()=>{window.shifts=[];new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.shifts.push(e.value)}).observe({type:'layout-shift',buffered:true})})
const snapshot=async(name)=>{
 await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0)})
 const size=page.viewportSize(),id=`${phase}-${size.width}x${size.height}-${name}`
 await page.screenshot({path:fileURLToPath(new URL(id+'.png',out)),animations:'disabled'})
 const dom=await page.evaluate(()=>{
  const props=['display','gridTemplateColumns','flexDirection','width','maxWidth','height','gap','padding','position','overflow']
  const roots=[...document.querySelectorAll('#calendar-view,.reward-modal,.aula-dialog,#settings-modal:not([hidden])')]
  return roots.flatMap(root=>[root,...root.querySelectorAll('*')].filter(n=>!n.closest('svg')&&n.tagName!=='IMG').map(n=>({tag:n.tagName,classes:n.className,depth:(()=>{let d=0,p=n;while(p!==root){d++;p=p.parentElement}return d})(),open:n.tagName==='DETAILS'?n.open:undefined,style:Object.fromEntries(props.map(k=>[k,getComputedStyle(n)[k]]))})))
 })
 shots.push({id,name,...size,dom});console.log('VISUAL '+id)
}
try{
 await page.setViewportSize({width:1440,height:900});await page.goto(root);await page.waitForLoadState('networkidle')
 // A real unkeyed <details> is reused across person selection in 8f. Opening
 // Carl's allowance must not also expand Ida's different agreement.
 await routeTo(page,'tasks');await page.locator('[data-person-filter="'+carl+'"]').click()
 await page.locator('.reward-dashboard>.reward-secondary>summary').click()
 await page.locator('[data-person-filter="'+personIds[2]+'"]').click()
 diagnostics.push({scenario:'person switch after expanding allowance',open:await page.locator('.reward-dashboard>.reward-secondary').evaluate(n=>n.open)})
 await snapshot('person-switch-stale-details')
 if(phase==='fixed')expect(diagnostics[0].open).toBe(false)
 await routeTo(page,'today');await routeTo(page,'tasks')
 // Direct renderer probe: dirty form value is browser state, not an attribute.
 // It must follow the new page markup when content is replaced.
 diagnostics.push(await page.evaluate(async()=>{
  const {updateContent}=await import('/src/lib/stable-shell.js');const host=document.createElement('div')
  updateContent(host,'<input value="old"><details><summary>Old</summary></details>');host.querySelector('input').value='edited';host.querySelector('details').open=true
  updateContent(host,'<input value="new"><details><summary>New</summary></details>')
  return {scenario:'complex content browser properties',value:host.querySelector('input').value,attribute:host.querySelector('input').getAttribute('value'),open:host.querySelector('details').open}
 }))
 for(const [width,height] of [[375,844],[390,844],[430,932],[768,1024],[1440,900],[1920,1080]]){
  await page.setViewportSize({width,height});await routeTo(page,'today');await page.waitForLoadState('networkidle');await snapshot('today')
  await page.locator('.aula-today [data-aula=review]').click();await snapshot('aula-review');await page.locator('.aula-dialog [data-aula=close]').click()
  await routeTo(page,'calendar');await snapshot('calendar')
  await routeTo(page,'meals');await snapshot('meals');await routeTo(page,'shopping');await snapshot('shopping')
  await routeTo(page,'tasks');await page.locator('[data-person-filter="Alle"]').click();await snapshot('tasks-all')
  await page.locator('[data-person-filter="'+carl+'"]').click();await snapshot('tasks-person')
  await page.locator('[data-star-choose]').first().click();await snapshot('rewards');await page.keyboard.press('Escape')
  await page.locator('[data-person-filter="Alle"]').click();await snapshot('star-goals')
  await page.locator('[data-task-range=rewards]').click();await snapshot('reward-admin');await page.locator('[data-task-range=today]').click()
  await routeTo(page,'family');await snapshot('family');await openSettings(page,'device');await snapshot('settings');await page.keyboard.press('Escape')
 }
 // Seed only the isolated fixture, then verify its exact rows throughout sizing.
 await actor(null);await query('delete from public.calendar_items where household_id=$1',[hid])
 const calendarIds=[]
 for(let i=0;i<12;i++){const id=randomUUID();calendarIds.push(id);await query("insert into public.calendar_items(id,household_id,created_by,title,type,date,time,person_ids,data) values($1,$2,$3,$4,'Aktivitet',$5,'16:00',$6,'{}')",[id,hid,ids.adult,'Aktivitet '+(i+1),today,[personIds[4]]])}
 const checksum=async()=>{await actor(null);return (await query("select count(*)::int count,md5(string_agg(to_jsonb(c)::text,'' order by id)) checksum from public.calendar_items c where household_id=$1",[hid])).rows[0]}
 const before=await checksum()
 // Filter the server response only; no database update for capacity scenarios.
 let count=9
 await context.route(api+'/rest/v1/calendar_items?**',async route=>{
  await actor(null);const rows=(await query('select to_jsonb(c) data from public.calendar_items c where household_id=$1 order by title',[hid])).rows.map(r=>r.data)
  await route.fulfill({json:rows.filter(r=>calendarIds.indexOf(r.id)<count),headers:{'access-control-allow-origin':'*'}})
 })
 for(const [width,height,n] of [[1440,900,9],[1920,1080,9],[1440,600,12]]){
  count=n;await page.setViewportSize({width,height});await page.reload();await page.waitForLoadState('networkidle');await routeTo(page,'calendar');await page.locator('[data-person-filter="'+personIds[4]+'"]').click();if(await page.locator('.week-grid').count()===0)await toggleView(page)
  await snapshot(n===9?'calendar-nine':'calendar-overflow')
  geometry.push(await page.locator('.day-card[data-day="'+today+'"]').evaluate(el=>({height:innerHeight,card:el.getBoundingClientRect().toJSON(),rows:[...el.querySelectorAll('.compact-activity')].map(n=>({hidden:n.hidden,rect:n.getBoundingClientRect().toJSON()})),overflow:el.querySelector('.day-overflow')?.textContent})))
 }
 expect(await checksum()).toEqual(before)
 await page.evaluate(({api,uid,hid})=>localStorage.setItem('familiekalender.device.v1:'+api,JSON.stringify({kiosk:{userId:uid,householdId:hid}})),{api,uid:ids.adult,hid})
 for(const height of [1080,1440]){
  await page.setViewportSize({width:1920,height});await page.reload();await page.waitForLoadState('networkidle');await routeTo(page,'today');await snapshot('wall-today');await routeTo(page,'calendar');await snapshot('wall-calendar')
 }
 expect(errors).toEqual([]);expect(unknown).toEqual([])
}finally{
 writeFileSync(new URL(phase+'.json',out),JSON.stringify({phase,shots,diagnostics,geometry,errors,unknown},null,2));await browser.close();await server.close();await db.close()
}
