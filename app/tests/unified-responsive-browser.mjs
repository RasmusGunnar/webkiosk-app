// Synthetic, loopback-only wall composition and unchanged desktop/mobile audit.
import {expect} from '@playwright/test'
import {createHash} from 'node:crypto'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import sharp from 'sharp'
import {routeTo} from './browser-actions.mjs'
import {writeUnifiedReview} from './unified-review.mjs'
import {weekDates} from '../src/lib/calendar-dates.js'
import {db,query,actor,today,ids,hid,carl,personIds,root,api,server,browser,context,page,errors,unknown} from './tasks-people-fixture.mjs'
const phase=process.env.UI_PHASE||'after',out=new URL('../../supabase/.temp/unified-responsive-ui/',import.meta.url),shots=[]
mkdirSync(out,{recursive:true})
const uuid=n=>'30000000-0000-4000-8000-'+String(n).padStart(12,'0'),rid=uuid(1),days=weekDates(today),imagePath=hid+'/'+rid+'/synthetic.webp'
let state='today-many',planned=3,shopping=8
const photo=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#d7d9c4"/><path d="M0 0H180V480H0" fill="#ece4d4"/><ellipse cx="340" cy="260" rx="205" ry="172" fill="#b9bdac"/><ellipse cx="325" cy="235" rx="205" ry="172" fill="#fff7e8"/><ellipse cx="325" cy="235" rx="170" ry="138" fill="#bb4c2c"/><path d="M240 220Q340 160 390 240T280 290" fill="none" stroke="#f1d2a8" stroke-width="8"/><ellipse cx="318" cy="230" rx="24" ry="9" fill="#42684e" transform="rotate(-30 318 230)"/><ellipse cx="348" cy="222" rx="26" ry="10" fill="#64834b" transform="rotate(35 348 222)"/><rect x="564" y="100" width="10" height="280" rx="5" fill="#8b8e80"/><ellipse cx="569" cy="96" rx="22" ry="36" fill="#abb0a2"/></svg>')).webp({quality:75}).toBuffer()
const recipe={id:rid,household_id:hid,title:'Tomatsuppe med basilikum',servings:4,total_minutes:25,image_path:imagePath,recipe_ingredients:[{position:0,raw_text:'800 g tomater'}],recipe_instructions:[{position:0,text:'Lad suppen simre og smag til.'}],recipe_ratings:[]}
await actor(null)
await query("insert into public.recipes(id,household_id,title,servings,total_minutes,image_path,created_by) values($1,$2,$3,4,25,$4,$5)",[rid,hid,recipe.title,imagePath,ids.adult])
const insert=async(id,title,type,date,person_ids,data={},location=null,note=null)=>query('insert into public.calendar_items(id,household_id,created_by,title,type,date,time,person_ids,data,location,note) values($1,$2,$3,$4,$5,$6,\'17:00\',$7,$8::jsonb,$9,$10)',[id,hid,ids.adult,title,type,date,person_ids,JSON.stringify(data),location,note])
for(const [i,date] of days.entries())await insert(uuid(10+i),['Pasta med tomat','Tomatsuppe med basilikum','Ovnbagt laks','Vegetarlasagne','Pizza med grønt','Kylling med kartofler','Rester fra ugen'][i],'Madplan',date,[],i%2?{recipe_id:rid}:{})
for(let i=0;i<5;i++)await insert(uuid(30+i),['Tandlæge','Hent fødselsdagsgave','Musikskole','Besøg hos farmor','Forældremøde'][i],'Aktivitet',today,[personIds[(i+1)%5]])
for(let i=0;i<8;i++)await insert(uuid(40+i),['Læg tøj sammen','Vand planterne','Luft hunden','Ryd skrivebordet','Tøm skraldespanden','Pak gymnastiktasken','Fej køkkenet','Læs 20 minutter'][i],'Opgave',today,[personIds[1+i%4]],{rewardMode:'stars',starValue:5})
const categories=['Mejeri & æg','Frugt & grønt','Kød & fisk','Br\u00f8d & kolonial','Hjemmet','Andet']
for(let i=0;i<20;i++)await insert(uuid(60+i),['Mælk','Madkasse Carl','Bananer','Tomater','Smør','Havregryn','Køkkenrulle','Æg','Kylling','Ris','Æbler','Yoghurt','Brød','Opvasketabs','Laks','Pasta','Gulerødder','Ost','Kaffe','Agurk'][i],'Indkøb',today,[],{},categories[[0,5,1,1,0,3,4,0,2,3,1,0,3,4,2,3,1,0,3,1][i]],i%3===0?'2 stk.':null)
let actionId=100
const action=async(name,payload)=>{await actor(ids.adult);return (await query('select public.reward_action($1,$2,$3,$4::jsonb) result',[uuid(actionId++),hid,name,JSON.stringify(payload)])).rows[0].result}
const reward=await action('catalog',{title:'Biograftur',emoji:'🎬',star_cost:40,active:true});await action('goal',{person_id:carl,reward_id:reward.id})
await action('allowance_save',{person_id:personIds[2],cadence:'week',amount_minor:10000,start_today:true,duties:[{title:'Dæk bord',schedule:'daily',approval:false}]})
await actor(null)
const all=(await query('select to_jsonb(c) data from public.calendar_items c where household_id=$1',[hid])).rows.map(r=>r.data)
const snapshot=async()=>{await actor(null);return (await query("select md5(string_agg(to_jsonb(c)::text,'' order by id)) hash from public.calendar_items c where household_id=$1",[hid])).rows[0].hash}
const before=await snapshot()
const visibleRows=()=>all.filter(r=>{
 if(r.type==='Madplan')return planned===7||planned===3&&[days[0],days[1],days[4]].includes(r.date)
 if(r.type==='Indkøb')return Number(r.id.slice(-12))-60<shopping
 if(r.id.startsWith('30000000')&&r.type==='Aktivitet')return state==='today-many'||state==='calendar'
 if(r.id.startsWith('30000000')&&r.type==='Opgave')return state==='tasks-many'||state==='today-many'
 return true
}).map(r=>state==='shopping-completed'&&r.type==='Indk\u00f8b'&&[uuid(60),uuid(61)].includes(r.id)?{...r,done:true}:r)
await context.route('**/api/aula-status',r=>r.fulfill({json:{connection:null,mappings:[],findings:[]}}))
await context.route(api+'/rest/v1/calendar_items?**',r=>r.fulfill({json:visibleRows(),headers:{'access-control-allow-origin':'*'}}))
await context.route(api+'/rest/v1/recipes?**',r=>r.fulfill({json:[recipe],headers:{'access-control-allow-origin':'*'}}))
await context.route(api+'/storage/v1/object/sign/recipe-images',r=>r.fulfill({json:r.request().postDataJSON().paths.map(path=>({path,signedURL:'/object/sign/recipe-images/'+path+'?token=fixture'})),headers:{'access-control-allow-origin':'*'}}))
const serve=r=>r.fulfill({body:photo,contentType:'image/webp',headers:{'access-control-allow-origin':'*'}})
await context.route(api+'/storage/v1/object/sign/recipe-images/**',serve)
await context.route('**/api/meal-recipes?**',serve)
await context.route('**/api/meal-recipes',r=>r.fulfill({json:{recipes:[recipe]}}))
await page.clock.setFixedTime(new Date(today+'T09:00:00+01:00'))
const capture=async(name,wall=true)=>{
 await expect(page.locator('.surface-loading')).toHaveCount(0)
 await expect(page.locator('[data-meal-image][hidden]')).toHaveCount(0)
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(i=>i.src).map(i=>i.decode().catch(()=>{})));scrollTo(0,0)})
 const {width,height}=page.viewportSize(),id=`${phase}-${wall?'wall':'normal'}-${width}x${height}-${name}`
 const png=await page.screenshot({path:fileURLToPath(new URL(id+'.png',out)),animations:'disabled'})
 const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,navTop:document.querySelector('.product-nav').getBoundingClientRect().top,cards:[...document.querySelectorAll('.meal-day,.shopping-group,.wall-section,.star-panel-compact')].map(n=>{const r=n.getBoundingClientRect();return {class:n.className,x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}}),images:document.querySelectorAll('[data-meal-image]:not([hidden])').length}))
 expect(metrics.overflow,id+' horizontal overflow').toBe(false)
 if(phase==='after'&&wall){
  if(name.startsWith('meals-')){const cards=metrics.cards.filter(c=>c.class.includes('meal-day'));expect(cards).toHaveLength(7);expect(Math.max(...cards.map(c=>c.bottom))).toBeLessThanOrEqual(height-60)}
  if(name==='shopping-2')expect(Math.max(...metrics.cards.map(c=>c.width))).toBeLessThanOrEqual(440)
  if(name==='today-image'||name==='meals-7')expect(metrics.images).toBeGreaterThan(0)
  if(name==='shopping-completed'){await page.locator('.shopping-completed summary').click();await expect(page.locator('.shopping-completed .is-bought')).toHaveCount(2)}
 }
 shots.push({id,name,wall,width,height,hash:createHash('sha256').update(png).digest('hex'),...metrics});console.log('WALL '+id)
}
try{
 for(const [width,height]of (process.env.WALL_ONLY?[]:[[375,844],[390,844],[430,932],[768,1024],[1366,768],[1440,900],[1920,1080],[2560,1440]])){
  state='normal';planned=3;shopping=8;await page.setViewportSize({width,height});await page.goto(root);await page.waitForLoadState('networkidle')
  for(const route of ['today','calendar','meals','shopping','tasks']){await routeTo(page,route);await capture(route,false)}
 }
 if(process.env.WALL_ONLY){await page.goto(root);await page.waitForLoadState('networkidle')}
 await page.evaluate(({api,uid,hid})=>localStorage.setItem('familiekalender.device.v1:'+api,JSON.stringify({kiosk:{userId:uid,householdId:hid}})),{api,uid:ids.adult,hid})
 for(const [width,height]of (process.env.WALL_ONLY?[[1366,768]]:[[1920,1080]])){
  await page.setViewportSize({width,height})
  for(const [name,route,count]of [['today-many','today',3],['today-few','today',0],['today-image','today',7],['calendar','calendar',3],['meals-0','meals',0],['meals-3','meals',3],['meals-7','meals',7],['shopping-2','shopping',2],['shopping-8','shopping',8],['shopping-20','shopping',20],['shopping-completed','shopping',20],['tasks-few','tasks',3],['tasks-many','tasks',3]]){
   if(process.env.WALL_ONLY&&name!=='today-image')continue
   state=name;if(route==='shopping')shopping=count;else planned=count
   await page.reload();await page.waitForLoadState('networkidle');await routeTo(page,route);await capture(name)
  }
 }
 expect(await snapshot()).toBe(before);expect(errors).toEqual([]);expect(unknown).toEqual([])
 let unchanged=null
 if(phase==='after'){const baseline=JSON.parse(readFileSync(new URL('before.json',out),'utf8'));unchanged=shots.filter(s=>!s.wall).map(s=>({name:s.name,width:s.width,identical:s.hash===baseline.shots.find(b=>!b.wall&&b.name===s.name&&b.width===s.width).hash}));console.log('BASELINE identical '+unchanged.filter(s=>s.identical).length+'/'+unchanged.length);expect(unchanged.filter(s=>s.name!=='shopping').every(s=>s.identical),'Unchanged desktop/mobile surfaces').toBe(true)}
 writeFileSync(new URL((process.env.WALL_ONLY?'smoke':phase)+'.json',out),JSON.stringify({shots,dataUnchanged:true,unchanged,errors,unknown},null,2))
 if(phase==='after'&&!process.env.WALL_ONLY)writeUnifiedReview(out)
 console.log('WALL REVIEW PASS '+shots.length+' states; data unchanged')
}finally{await browser.close();await server.close();await db.close()}
