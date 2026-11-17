// Isolated visual inventory. All families, recipes, images and Aula findings are synthetic.
import {expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import sharp from 'sharp'
import {routeTo,openSettings,openCreate} from './browser-actions.mjs'
import {finding} from './aula-activity.fixtures.js'
import {db,query,actor,today,ids,hid,carl,personIds,root,api,server,browser,context,page,errors,unknown} from './tasks-people-fixture.mjs'
const phase=process.env.DESIGN_PHASE||'polished',out=new URL('../../supabase/.temp/design-polish/',import.meta.url)
mkdirSync(out,{recursive:true})
const rid=randomUUID(),mealId=randomUUID(),imagePath=hid+'/'+rid+'/synthetic.webp',shots=[],metrics=[]
let mealMode='with-image',imageRequests=0,imageBytes=0
const photo=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#d7d9c4"/><path d="M0 0H180V480H0" fill="#ece4d4"/><ellipse cx="340" cy="260" rx="205" ry="172" fill="#b9bdac"/><ellipse cx="325" cy="235" rx="205" ry="172" fill="#fff7e8"/><ellipse cx="325" cy="235" rx="170" ry="138" fill="#bb4c2c"/><path d="M240 220Q340 160 390 240T280 290" fill="none" stroke="#f1d2a8" stroke-width="8"/><ellipse cx="318" cy="230" rx="24" ry="9" fill="#42684e" transform="rotate(-30 318 230)"/><ellipse cx="348" cy="222" rx="26" ry="10" fill="#64834b" transform="rotate(35 348 222)"/><rect x="564" y="100" width="10" height="280" rx="5" fill="#8b8e80"/><ellipse cx="569" cy="96" rx="22" ry="36" fill="#abb0a2"/></svg>')).webp({quality:75}).toBuffer()
await actor(null)
await query("insert into public.recipes(id,household_id,title,description,servings,total_minutes,image_path,created_by) values($1,$2,'Tomatsuppe med basilikum','En varm hverdagsfavorit.',4,25,$3,$4)",[rid,hid,imagePath,ids.adult])
await query("insert into public.calendar_items(id,household_id,created_by,title,type,date,person_ids,data) values($1,$2,$3,'Tomatsuppe med basilikum','Madplan',$4,$5,$6::jsonb)",[mealId,hid,ids.adult,today,[],JSON.stringify({recipe_id:rid})])
const recipe={id:rid,household_id:hid,title:'Tomatsuppe med basilikum',description:'En varm hverdagsfavorit.',servings:4,total_minutes:25,image_path:imagePath,recipe_ingredients:[{position:0,raw_text:'800 g tomater'},{position:1,raw_text:'1 løg'},{position:2,raw_text:'Frisk basilikum'}],recipe_instructions:[{position:0,text:'Svits løget, og tilsæt tomater.'},{position:1,text:'Lad suppen simre. Blend og smag til.'}],recipe_ratings:[],updated_at:'2026-11-17T10:00:00Z'}
const action=async(name,payload)=>{await actor(ids.adult);return (await query('select public.reward_action($1,$2,$3,$4::jsonb) result',[randomUUID(),hid,name,JSON.stringify(payload)])).rows[0].result}
const reward=await action('catalog',{title:'Biograftur',emoji:'🎬',star_cost:25,active:true});await action('goal',{person_id:carl,reward_id:reward.id})
await context.route('**/api/aula-status',r=>r.fulfill({json:{connection:{status:'connected'},mappings:[],automatic:{active:true},findings:Array.from({length:3},(_,i)=>finding({id:'fixture-'+i,person_id:carl,person_ids:[carl],date:today,title:['Husk idrætstøj','Læs kapitel 4','Fælles skoledag'][i],review_state:'NEW',confidence:'HIGH'}))}}))
await context.route(api+'/rest/v1/recipes?**',r=>r.fulfill({json:[{...recipe,image_path:mealMode==='without-image'?null:imagePath}],headers:{'access-control-allow-origin':'*'}}))
await context.route(api+'/rest/v1/calendar_items?**',async route=>{await actor(null);const rows=(await query('select to_jsonb(c) data from public.calendar_items c where household_id=$1',[hid])).rows.map(r=>r.data);await route.fulfill({json:rows.filter(r=>mealMode!=='none'||r.id!==mealId).map(r=>r.id===mealId&&mealMode==='without-recipe'?{...r,recipe_id:null,data:{}}:r),headers:{'access-control-allow-origin':'*'}})})
await context.route(api+'/storage/v1/object/sign/recipe-images',r=>r.fulfill({json:r.request().postDataJSON().paths.map(path=>({path,signedURL:'/object/sign/recipe-images/'+path+'?token=fixture'})),headers:{'access-control-allow-origin':'*'}}))
const servePhoto=r=>{imageRequests++;imageBytes+=photo.length;return r.fulfill({contentType:'image/webp',headers:{'cache-control':'private,max-age=3600','access-control-allow-origin':'*'},body:photo})}
await context.route(api+'/storage/v1/object/sign/recipe-images/**',servePhoto)
await context.route('**/api/meal-recipes?**',servePhoto)
await context.route('**/api/meal-recipes',r=>r.fulfill({json:{recipes:[recipe]}}))
const dataSnapshot=async()=>{await actor(null);return (await query("select md5(string_agg(to_jsonb(c)::text,'' order by id)) hash from public.calendar_items c where household_id=$1",[hid])).rows[0].hash}
const dataBefore=await dataSnapshot()
const screenshot=async name=>{
 await page.evaluate(async()=>{await document.fonts.ready;scrollTo(0,0)})
 const {width,height}=page.viewportSize(),id=`${phase}-${width}x${height}-${name}`
 await page.screenshot({path:fileURLToPath(new URL(id+'.png',out)),animations:'disabled',fullPage:['family','today','tasks','rewards'].includes(name)&&await page.locator('body').getAttribute('data-mode')!=='kiosk'})
 const styles=await page.evaluate(()=>[...document.querySelectorAll('.day-card,.calendar-item,.reward-task-card,.star-panel,.meal-day,.ux-dinner,.today-meal,.aula-today,.ux-family-person,.recipe-modal,.reward-modal,.calendar-modal,.settings-modal')].filter(n=>n.getBoundingClientRect().width).map(n=>{const c=getComputedStyle(n),r=n.getBoundingClientRect();return {class:n.className,rect:{width:r.width,height:r.height},radius:c.borderRadius,padding:c.padding,gap:c.gap,background:c.backgroundColor,border:c.borderColor,shadow:c.boxShadow,font:c.fontSize}}))
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 shots.push({id,name,width,height,styles});console.log('DESIGN '+id)
}
try{
 for(const [width,height]of [[375,844],[390,844],[430,932],[1440,900],[1920,1080]]){
  await page.setViewportSize({width,height});await page.goto(root);await page.waitForLoadState('networkidle')
  await routeTo(page,'today');await screenshot('today')
  await page.locator('.aula-today [data-aula=review]').click();await screenshot('aula');await page.locator('.aula-dialog [data-aula=close]').click()
  for(const route of ['calendar','meals','shopping','tasks']){await routeTo(page,route);await screenshot(route)}
  await page.locator('[data-person-filter="'+carl+'"]').click();await screenshot('person-goal');await page.locator('[data-person-filter="Alle"]').click()
  await page.locator('[data-task-range=rewards]').click();await screenshot('rewards');await page.locator('[data-task-range=today]').click()
  await openCreate(page,'Aktivitet',{compact:true});await screenshot('activity-editor');await page.keyboard.press('Escape')
  await openCreate(page,'Opgave',{compact:true});await screenshot('task-editor');await page.keyboard.press('Escape')
  await routeTo(page,'family');await screenshot('family');await openSettings(page,'device');await screenshot('settings');await page.keyboard.press('Escape')
 }
 for(const mode of ['mobile','desktop','wall']){
  await page.setViewportSize(mode==='mobile'?{width:390,height:844}:mode==='wall'?{width:1920,height:1080}:{width:1440,height:900})
  if(mode==='wall')await page.evaluate(({api,uid,hid})=>localStorage.setItem('familiekalender.device.v1:'+api,JSON.stringify({kiosk:{userId:uid,householdId:hid}})),{api,uid:ids.adult,hid})
  for(const state of ['with-image','without-image','without-recipe','none']){
   mealMode=state;await page.reload();await page.waitForLoadState('networkidle');await routeTo(page,'today');await screenshot(mode+'-meal-'+state)
   if(phase==='polished'){
    const meal=page.locator('.today-meal');await expect(meal).toBeVisible()
    await expect(meal.locator('img')).toHaveCount(state==='with-image'?1:0)
    await expect(meal.locator('[data-today-recipe]')).toHaveCount(['with-image','without-image'].includes(state)?1:0)
    if(['with-image','without-image'].includes(state)){await meal.locator('[data-today-recipe]').click();await expect(page.locator('.recipe-modal')).toContainText('800 g tomater');await page.keyboard.press('Escape')}
   }
  }
  if(mode==='wall'){mealMode='with-image';await page.reload();await page.waitForLoadState('networkidle');for(const route of ['today','calendar','tasks','meals']){await routeTo(page,route);await screenshot('wall-'+route)}}
 }
 const dataAfter=await dataSnapshot();expect(dataAfter).toBe(dataBefore);metrics.push({imageRequests,imageBytes,syntheticImageBytes:photo.length,calendarBefore:dataBefore,calendarAfter:dataAfter})
 expect(errors).toEqual([]);expect(unknown).toEqual([])
}finally{writeFileSync(new URL(phase+'.json',out),JSON.stringify({phase,shots,metrics,errors,unknown},null,2));await browser.close();await server.close();await db.close()}
