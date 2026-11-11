// Actual review UI with synthetic RPC responses; SQL/RLS are verified by aula-activity-db.mjs.
import {createServer} from 'vite'
import {chromium,expect} from '@playwright/test'
import {mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),out=fileURLToPath(new URL('../../supabase/.temp/aula-review-overrides/',import.meta.url))
mkdirSync(out,{recursive:true})
const css=['style','product','desktop-kiosk','mobile','rewards','polish','recipes','multiday','imported-scopes','native-family','aula','dialogs','person-avatars','stars']
const server=await createServer({configFile:false,root,server:{host:'127.0.0.1',port:5201,strictPort:true},plugins:[{name:'review-fixture',configureServer(s){s.middlewares.use('/__review',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="da"><meta name="viewport" content="width=device-width,initial-scale=1">'+css.map(c=>'<link rel="stylesheet" href="/src/'+c+'.css">').join('')+'<body></body></html>')})}}]})
await server.listen()
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),errors=[],shots=[]
try{
 for(const width of [375,390,430,1280]){
  const page=await browser.newPage({viewport:{width,height:900},locale:'da-DK'});page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
  await page.goto('http://127.0.0.1:5201/__review')
  await page.evaluate(async()=>{
   const {AulaUI}=await import('/src/lib/aula-ui.js'),{finding,ida,carl}=await import('/tests/aula-activity.fixtures.js')
   window.calls=[];window.people=[{id:ida,name:'Ida',color:'#b98486'},{id:carl,name:'Carl',color:'#8e9e65'}]
   const ui=window.ui=new AulaUI({client:{rpc:async(name,p)=>{window.calls.push({name,p});await new Promise(r=>setTimeout(r,40));const f=ui.state.findings.find(f=>f.id===p.p_finding_id);Object.assign(f,{status:'accepted',title:p.p_title,date:p.p_date,time:p.p_time,person_ids:p.p_person_ids});return {error:null}}},getContext:()=>({householdId:'synthetic',role:'owner',people:window.people}),onRender:()=>{}})
   ui.state.connection={status:'connected',scan_counts:{partial:1}};ui.context='synthetic';ui.loaded=true;ui.refresh=async()=>{};ui.state.findings=[finding({id:'unknown',date:null,confidence:'MEDIUM',review_state:'UPDATED'}),finding({id:'known',title:'Original title',time:'14:00'})];ui.review()
  })
  await expect(page.locator('.aula-error')).toContainText('delvist gennemført');
  const unknown=page.locator('[data-aula-finding="unknown"]'),known=page.locator('[data-aula-finding="known"]')
  await expect(unknown.locator('[role="status"]')).toContainText('Opdateret siden sidst');await expect(unknown.locator('[data-aula="accept"]')).toBeDisabled();await expect(unknown.locator('[data-aula-edit="date"]')).toBeVisible()
  await unknown.scrollIntoViewIfNeeded();await page.screenshot({path:out+'/missing-'+width+'.png'});shots.push('missing-'+width)
  await unknown.locator('[data-aula-edit="date"]').fill('2026-11-12')
  await expect(unknown.locator('[data-aula="accept"]')).toBeEnabled();await expect(unknown.locator('[data-aula-date-label]')).not.toHaveText('Dato skal afklares');await expect(unknown.locator('[data-aula-date-hint]')).toBeHidden()
  await unknown.locator('[data-aula="edit-finding"][data-field="title"]').click();await unknown.locator('[data-aula-edit="title"]').fill('   ');await expect(unknown.locator('[data-aula="accept"]')).toBeDisabled();await unknown.locator('[data-aula-edit="title"]').fill('Husk paprør')
  const choices=unknown.locator('[data-aula-person-choice]');await choices.nth(0).uncheck({force:true});await expect(unknown.locator('[data-aula="accept"]')).toBeDisabled();await choices.nth(1).check({force:true})
  // Another card can be corrected without discarding the first draft.
  await known.locator('[data-aula="edit-finding"][data-field="date"]').click();await known.locator('[data-aula-edit="date"]').fill('2026-11-14')
  await known.locator('[data-aula="edit-finding"][data-field="time"]').click();await known.locator('[data-aula-edit="time"]').fill('16:30')
  await known.locator('[data-aula-person-choice]').nth(1).check({force:true})
  await known.locator('[data-aula="edit-finding"][data-field="title"]').click();await known.locator('[data-aula-edit="title"]').fill('Forældremøde')
  await known.scrollIntoViewIfNeeded();await page.screenshot({path:out+'/edited-'+width+'.png'});shots.push('edited-'+width)
  const layout=await page.locator('.aula-dialog').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth+1,inputs:[...el.querySelectorAll('input:not([type="checkbox"])')].filter(e=>e.offsetParent).every(e=>e.getBoundingClientRect().right<=el.getBoundingClientRect().right&&e.getBoundingClientRect().width>0),touch:[...el.querySelectorAll('button')].filter(e=>e.offsetParent).every(e=>e.getBoundingClientRect().height>=44)}))
  expect(layout).toEqual({overflow:false,inputs:true,touch:true})
  await unknown.locator('[data-aula="accept"]').click();await expect.poll(()=>page.evaluate(()=>window.calls.length)).toBe(1);await expect(page.locator('.aula-accepted')).toBeVisible()
  // Re-render after accepting the other card must retain these corrections.
  await expect(known.locator('[data-aula-edit="date"]')).toHaveValue('2026-11-14');await expect(known.locator('[data-aula-edit="time"]')).toHaveValue('16:30');await expect(known.locator('[data-aula-title-label]')).toHaveText('Forældremøde')
  await known.locator('[data-aula="edit-finding"][data-field="time"]').click();await known.locator('[data-aula-edit="time"]').fill('');await known.locator('[data-aula="accept"]').click();await expect.poll(()=>page.evaluate(()=>window.calls.length)).toBe(2)
  const payloads=await page.evaluate(()=>window.calls.map(x=>x.p));expect(payloads[0]).toMatchObject({p_date:'2026-11-12',p_time:null,p_title:'Husk paprør',p_override_time:true});expect(payloads[0].p_person_ids).toHaveLength(1);expect(payloads[1]).toMatchObject({p_date:'2026-11-14',p_time:null,p_title:'Forældremøde'});expect(payloads[1].p_person_ids).toHaveLength(2)
  await page.close();console.log('PASS inline corrections, RPC payload, no overflow and touch targets at '+width+'px')
 }
 expect(errors).toEqual([])
 writeFileSync(out+'/review.html','<!doctype html><html lang="da"><meta charset="utf-8"><title>Aula review rettelser</title><style>body{font:16px system-ui;background:#eff3ed;padding:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}img{width:100%;max-height:700px;object-fit:contain;background:white}</style><h1>Aula · ret fund før accept</h1><p>Syntetiske data. 375, 390, 430 px og desktop.</p><main class="grid">'+shots.map(s=>'<figure><figcaption>'+s+'</figcaption><a href="'+s+'.png"><img src="'+s+'.png"></a></figure>').join('')+'</main></html>')
 console.log('AULA_REVIEW_BROWSER PASS: '+shots.length+' screenshots')
}finally{await browser.close();await server.close()}
