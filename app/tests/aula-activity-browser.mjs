// Real review UI + existing calendar avatar/picker CSS; synthetic local API only.
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import sharp from 'sharp'
import {fileURLToPath} from 'node:url'
import {mkdirSync,writeFileSync} from 'node:fs'
import {finding,schoolExamples,ida,carl} from './aula-activity.fixtures.js'
const out=new URL('../../supabase/.temp/aula-activity-correction/',import.meta.url)
mkdirSync(out,{recursive:true})
const avatarPng=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#f5dce0"/><circle cx="40" cy="28" r="16" fill="#b98486"/><path d="M12 80v-8a28 28 0 0 1 56 0v8" fill="#b98486"/></svg>')).png().toBuffer()
const rows=schoolExamples.map(([type,title,date],i)=>finding({id:'finding-'+i,type,title,date}))
rows.push(finding({id:'shared',title:'Fælles skolearrangement',person_ids:[ida,carl],person_id:null}))
rows.push(finding({id:'info',type:'GENERAL_INFO',title:'Orientering',proposed_action:'NO_ACTION',confidence:'LOW'}))
rows.push(finding({id:'undated',title:'Uafklaret dato',date:null,confidence:'MEDIUM'}))
const people=[{id:ida,name:'Ida',color:'#b98486',avatar_url:'/fixture-ida.png',is_active:true},{id:carl,name:'Carl',color:'#8e9e65',is_active:true}]
const html=`<!doctype html><html lang="da"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aula activity fixture</title><body><script type="module">
import '/src/style.css';import '/src/product.css';import '/src/person-avatars.css';import '/src/aula.css';
import {AulaUI} from '/src/lib/aula-ui.js';
import {setLocale} from '/src/i18n/index.js';setLocale('da-DK');
const people=${JSON.stringify(people)};people[0].avatar_url=location.origin+'/fixture-ida.png';
const state={connection:{status:'connected'},mappings:[],findings:${JSON.stringify(rows)}};
window.calls=[];
const ui=new AulaUI({client:{rpc:async(name,payload)=>{window.calls.push({name,payload});const f=state.findings.find(f=>f.id===payload.p_finding_id);f.status=payload.p_action==='ignore'?'ignored':'accepted';if(payload.p_person_ids){f.person_ids=payload.p_person_ids;f.person_id=f.person_ids.length===1?f.person_ids[0]:null}return {data:{status:f.status},error:null}}},getContext:()=>({householdId:'local-fixture',role:'owner',wall:false,people}),onRender:()=>{},onAccepted:()=>{window.accepted=true}});
ui.request=async endpoint=>{if(endpoint!=='status')throw Error('Unexpected fixture request');return structuredClone(state)};
ui.syncContext();ui.state=structuredClone(state);ui.loaded=true;ui.review();window.ui=ui;
</script></body></html>`
const server=await createServer({configFile:false,root:fileURLToPath(new URL('../',import.meta.url)),plugins:[{name:'aula-activity-fixture',configureServer(s){s.middlewares.use('/aula-activity-fixture',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(html)})}}],server:{host:'127.0.0.1',port:5197,strictPort:true}})
let browser;const errors=[],checks=[]
try{
 await server.listen();browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 for(const width of [1280,375]){
  const context=await browser.newContext({locale:'da-DK',timezoneId:'Europe/Copenhagen',viewport:{width,height:900}})
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort()
   if(url.pathname==='/fixture-ida.png')return route.fulfill({contentType:'image/png',body:avatarPng})
   return route.continue()
  })
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000)
  await page.goto('http://127.0.0.1:5197/aula-activity-fixture')
  const card=id=>page.locator('[data-aula-finding="'+id+'"]'),first=card('finding-0'),accept=first.getByRole('button',{name:'Tilføj aktivitet',exact:true})
  await expect(accept).toBeEnabled();await expect(page.getByRole('button',{name:'Tilføj opgave',exact:true})).toHaveCount(0)
  for(let i=0;i<8;i++)await expect(card('finding-'+i).getByRole('button',{name:'Tilføj aktivitet',exact:true})).toBeEnabled()
  await expect(first.locator('.aula-finding-meta img')).toBeVisible()
  expect(await first.locator('.aula-finding-meta .person-bubble').evaluate(e=>e.style.getPropertyValue('--person-color'))).toBe('#b98486')
  await expect(first.locator('[data-person-status]')).toHaveCount(0)
  await expect(card('shared').locator('.aula-finding-meta .person-bubble')).toHaveCount(2)
  await expect(card('info').locator('[data-aula="accept"]')).toHaveCount(0)
  await expect(card('undated').getByRole('button',{name:'Tilføj aktivitet',exact:true})).toBeDisabled()
  await page.screenshot({path:fileURLToPath(new URL('review-'+width+'.png',out))})
  if(width===375)for(const type of ['HOMEWORK','REMINDER','DEADLINE','TRIP']){
   const findingCard=card('finding-'+schoolExamples.findIndex(example=>example[0]===type))
   await findingCard.scrollIntoViewIfNeeded()
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
   await findingCard.screenshot({path:fileURLToPath(new URL('type-'+type.toLowerCase()+'.png',out)),animations:'disabled'})
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
  expect(await page.locator('.aula-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true)
  await first.getByRole('checkbox',{name:'Ida',exact:true}).uncheck();await expect(accept).toBeDisabled()
  await first.getByRole('checkbox',{name:'Carl',exact:true}).check();await expect(accept).toBeEnabled()
  expect(await first.locator('.aula-finding-meta .person-bubble').evaluate(e=>e.style.getPropertyValue('--person-color'))).toBe('#8e9e65')
  await accept.click();await expect.poll(()=>page.evaluate(()=>window.calls.length)).toBe(1)
  expect(await page.evaluate(()=>window.calls[0])).toEqual({name:'aula_review',payload:{p_household_id:'local-fixture',p_finding_id:'finding-0',p_action:'accept',p_person_ids:[carl]}})
  await card('shared').getByRole('button',{name:'Tilføj aktivitet',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.calls.length)).toBe(2)
  expect((await page.evaluate(()=>window.calls[1].payload.p_person_ids)).sort()).toEqual([ida,carl].sort())
  expect(await page.evaluate(()=>window.calls.every(c=>c.name==='aula_review'))).toBe(true)
  checks.push(width+'px: activities, exact people selection, avatars/colours, no task controls, no overflow')
  await context.close()
 }
 expect(errors).toEqual([])
 writeFileSync(new URL('browser-results.json',out),JSON.stringify({status:'PASS',checks,runtimeErrors:errors},null,2))
 console.log(JSON.stringify({AULA_ACTIVITY_BROWSER:'PASS',checks,runtimeErrors:errors}))
}finally{await browser?.close();await server.close()}
