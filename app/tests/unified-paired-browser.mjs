import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {randomUUID} from 'node:crypto'
import {writeFileSync,mkdirSync} from 'node:fs'
import sharp from 'sharp'
import handler from '../server/meal-recipes.ts'
import {wallAvatarFixture,must,fixtureDate} from './fixtures/wall-avatar.js'
import {writeUnifiedReview} from './unified-review.mjs'
import {routeTo} from './browser-actions.mjs'
const f=await wallAvatarFixture(),rid=randomUUID(),mealId=randomUUID(),path=`${f.hid}/${rid}/meal.webp`,out=new URL('../../supabase/.temp/unified-responsive-ui/',import.meta.url)
Object.assign(process.env,f.env);mkdirSync(out,{recursive:true})
let server,browser;try{
const photo=await sharp({create:{width:1200,height:900,channels:3,background:'#b95533'}}).webp().toBuffer()
await must(f.client.from('recipes').insert({id:rid,household_id:f.hid,title:'Wall-test: tomatsuppe',image_path:path,total_minutes:25,servings:4}))
await must(f.client.from('recipe_ingredients').insert({recipe_id:rid,position:0,raw_text:'800 g tomater'}));await must(f.client.from('recipe_instructions').insert({recipe_id:rid,position:0,text:'Blend suppen.'}))
await must(f.client.storage.from('recipe-images').upload(path,photo,{contentType:'image/webp'}))
await must(f.admin.from('calendar_items').insert({id:mealId,created_by:f.user.id,household_id:f.hid,type:'Madplan',title:'Wall-test: tomatsuppe',date:fixtureDate,data:{recipe_id:rid}}))
const action=async(action,payload)=>must(f.client.rpc('reward_action',{p_request_id:randomUUID(),p_household_id:f.hid,p_action:action,p_payload:payload}))
const reward=await action('catalog',{title:'Biograftur',emoji:'⭐',star_cost:40,active:true});await action('goal',{person_id:f.carl.id,reward_id:reward.id})
await action('allowance_save',{person_id:f.ida.id,cadence:'week',amount_minor:10000,start_today:true,duties:[{title:'Dæk bord',schedule:'daily',approval:false}]})
await must(f.client.from('calendar_items').insert([{type:'Opgave',title:'Pak tasken',person_ids:[f.carl.id],data:{rewardMode:'stars',starValue:5}},{type:'Indkøb',title:'Mælk',location:'Mejeri & æg'},{type:'Indkøb',title:'Bananer',location:'Frugt & grønt'}].map(r=>({data:{},person_ids:[],time:null,...r,date:fixtureDate,household_id:f.hid,created_by:f.user.id}))))
const snapshot=async()=>JSON.stringify(await must(f.client.from('calendar_items').select('*').eq('household_id',f.hid).order('id')))
const before=await snapshot(),requests=[],errors=[],checks=[],parity=[],shots=[]
server=await createServer({configFile:false,envFile:false,server:{host:'127.0.0.1',port:5201,strictPort:true},plugins:[{name:'local-meal-api',configureServer(server){server.middlewares.use('/api/meal-recipes',async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString();req.body=body?JSON.parse(body):{};req.query=Object.fromEntries(new URL(req.url,'http://localhost').searchParams)
 const result={setHeader:(k,v)=>res.setHeader(k,v),status(code){res.statusCode=code;return result},json(value){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))},send(value){res.end(value)},end(){res.end()}}
 requests.push(req.method);await handler(req,result)
 })}}]});await server.listen()
browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1920,height:1080},locale:'da-DK',timezoneId:'Europe/Copenhagen',serviceWorkers:'block'})
const selectors={today:['.ux-welcome','.ux-welcome h3','.day-card','.today-meal','.today-meal h3','.compact-task'],calendar:['.day-card','.compact-activity','.calendar-day-section h3'],meals:['.meal-day','.meal-day header','.meal-card strong','.meal-recipe-thumbnail','.meal-empty'],shopping:['.shopping-group','.shopping-group h4','.shopping-row','.shopping-name strong'],tasks:['.reward-task','.reward-task-title strong','.reward-task-person','.person-bubble']}
const styles=page=>page.evaluate(selectors=>Object.fromEntries(selectors.map(selector=>{const node=document.querySelector(selector);if(!node)return[selector,null];const s=getComputedStyle(node);return[selector,Object.fromEntries(['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','borderColor','borderRadius','padding','gap'].map(p=>[p,s[p]]))]})),selectors[page.routeName])
const sessions=[['desktop',f.session],['wall',f.wallSession]],pages={}
for(const [kind,session]of sessions){
  const ctx=kind==='wall'?context:await browser.newContext({viewport:{width:1920,height:1080},locale:'da-DK',timezoneId:'Europe/Copenhagen',serviceWorkers:'block'})
  await ctx.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),session)
  await ctx.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort())
  await ctx.route('**/api/aula-status',r=>r.fulfill({json:{connection:null,mappings:[],findings:[]}}))
  const page=await ctx.newPage();pages[kind]=page;page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date(fixtureDate+'T09:30:00+01:00'));await page.goto('http://127.0.0.1:5201');await page.waitForLoadState('networkidle')
  await expect(page.locator('body')).toHaveAttribute('data-mode','desktop');await expect(page.locator('body')).toHaveAttribute('data-device',kind==='wall'?'wall':'browser')
  for(const route of Object.keys(selectors)){
   await routeTo(page,route);page.routeName=route
   await expect(page.locator('.surface-loading')).toHaveCount(0);await expect(page.locator('[data-meal-image][hidden]')).toHaveCount(0)
   await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(i=>i.src).map(i=>i.decode().catch(()=>{})));scrollTo(0,0)})
   const css=await styles(page);parity.push({kind,route,css})
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
   if(kind==='wall'){
    await expect(page.locator('#device-clock')).toBeVisible();await expect(page.locator('#device-date')).toBeVisible()
    await expect(page.locator('[data-meal-remove],[data-plan-new],#shopping-add,[data-shopping-toggle],[data-reward-edit],[data-reward-action=approve],[data-reward-action=excuse]')).toHaveCount(0)
   }
   const name='paired-'+kind+'-'+route+'.png';await page.screenshot({path:new URL(name,out).pathname.replace(/^\//,''),animations:'disabled'});shots.push({kind,route,name})
  }
 }
 for(const route of Object.keys(selectors)){
  const desktop=parity.find(p=>p.kind==='desktop'&&p.route===route).css,wall=parity.find(p=>p.kind==='wall'&&p.route===route).css
  for(const selector of selectors[route]){expect(desktop[selector],route+' '+selector+' exists').not.toBeNull();expect(wall[selector],route+' '+selector+' shared styles').toEqual(desktop[selector])}
  checks.push('Same 1920 viewport, shared '+route+' component styles with real paired wall')
 }
 const desktopGoal=await pages.desktop.locator('.star-panel-compact').first().evaluate(n=>{const s=getComputedStyle(n);return{font:s.fontFamily,background:s.backgroundColor,border:s.borderRadius}})
 await routeTo(pages.wall,'today');await expect(pages.wall.locator('.star-panel-compact')).not.toHaveCount(0)
 // Compare the same compact reward component under each capability context.
 const goalStyle=await pages.wall.locator('.star-panel-compact').first().evaluate(n=>{const s=getComputedStyle(n);return{font:s.fontFamily,background:s.backgroundColor,border:s.borderRadius}})
 expect(goalStyle).toEqual(desktopGoal);checks.push('Shared compact reward component with unchanged permission controls')
 await pages.wall.locator('#settings-button').click();await expect(pages.wall.locator('.native-panel')).toBeVisible();await pages.wall.keyboard.press('Escape');checks.push('Wall clock/date, restricted controls and device settings preserved')
 const responsive=[]
 for(const [width,height]of [[375,844],[390,844],[430,932],[768,1024],[1366,768],[1440,900],[1920,1080],[2560,1440]]){
  await pages.wall.setViewportSize({width,height})
  for(const route of Object.keys(selectors)){
   await routeTo(pages.wall,route);await expect(pages.wall.locator('#device-clock')).toBeVisible();await expect(pages.wall.locator('#device-date')).toBeVisible()
   expect(await pages.wall.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
   const touch=await pages.wall.locator('.person-chip,.product-nav button,.reward-actions button').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).every(n=>n.getBoundingClientRect().height>=44));expect(touch).toBe(true)
   responsive.push({width,height,route,overflow:false,touch})
   if(width===390&&route==='today')await pages.wall.screenshot({path:new URL('paired-wall-mobile-today.png',out).pathname.replace(/^\//,''),animations:'disabled'})
  }
 }
 await pages.wall.setViewportSize({width:1920,height:1080});await routeTo(pages.wall,'today');await expect(async()=>{await pages.wall.locator('.star-goals').scrollIntoViewIfNeeded();await expect(pages.wall.locator('.star-panel-compact').first()).toBeInViewport()}).toPass({timeout:10000})
 await pages.wall.screenshot({path:new URL('paired-wall-today-scrolled.png',out).pathname.replace(/^\//,''),animations:'disabled'})
 checks.push('Paired wall responsive across all eight sizes; clock/date and scrollable rewards remain reachable')
 expect(await snapshot()).toBe(before);expect(errors).toEqual([])
 writeFileSync(new URL('paired-parity.json',out),JSON.stringify({checks,parity,shots,goalStyle,responsive,dataUnchanged:true,errors},null,2));writeUnifiedReview(out);checks.forEach(v=>console.log('PASS '+v))
}finally{await browser?.close();await server?.close();await f.admin.storage.from('recipe-images').remove([path]);await f.cleanup()}
