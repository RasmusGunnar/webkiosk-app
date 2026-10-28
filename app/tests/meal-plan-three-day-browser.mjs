import {chromium,expect as baseExpect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import sharp from 'sharp'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {routeTo} from './browser-actions.mjs'
import {weekDates} from '../src/lib/calendar-dates.js'

// Only disposable fixtures on the allowlisted local Supabase; preview-local on 5179.
const expect=baseExpect.configure({timeout:20000}),local=localSupabase(),root='http://127.0.0.1:5179',out='supabase/.temp/live-core-bugfix'
const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data}
const results=[],shots=[],errors=[],deletes=[],paths=[]
const pass=name=>{results.push(name+' PASS');console.log(name+' PASS')}
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const context=await browser.newContext({locale:'da-DK',timezoneId:'Europe/Copenhagen',viewport:{width:1440,height:1000}}),page=await context.newPage()
const localOnly=route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort()
await context.route('**/*',localOnly)
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/rpc/sync_calendar_mutation')){const p=r.postDataJSON();if(p.p_delete_ids?.length)deletes.push(p)}})
const shot=async(name,label)=>{await page.screenshot({path:out+'/'+name+'.png'});shots.push({name,label})}
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen'}).format(new Date()),dates=weekDates(today).slice(0,3)
let uid,hid,peerContext
const meals=()=>must(admin.from('calendar_items').select('*').eq('household_id',hid).eq('type','Madplan').order('date'))
const library=()=>must(admin.from('recipes').select('*,recipe_ingredients(*),recipe_instructions(*),recipe_ratings(*)').eq('household_id',hid))
const card=(id,p=page)=>p.locator('.meal-card [data-plan-edit="'+id+'"]')
const remove=(id,p=page)=>p.locator('.meal-card [data-meal-remove="'+id+'"]')
try{
 const html=await fetch(root).then(r=>r.text()),script=html.match(/<script[^>]+src="([^"]+)"/)?.[1]
 if(!(await fetch(new URL(script,root)).then(r=>r.text())).includes(local.API_URL))throw Error('Run preview-local.mjs --build-only before this test.')
 const email='meal-three-day-'+randomUUID()+'@example.test',password=randomUUID()+'Aa!1'
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 hid=(await must(admin.from('households').insert({name:'Familien · samme ret på tre dage',created_by:uid}).select('id').single())).id
 await must(admin.from('household_members').insert({household_id:hid,user_id:uid,role:'owner'}))
 const person=await must(admin.from('household_people').insert({household_id:hid,name:'Julie',role:'adult',color:'#7c935e'}).select().single())
 const recipeId=randomUUID(),imagePath=hid+'/'+recipeId+'/'+randomUUID()+'.png';paths.push(imagePath)
 const imageBytes=await sharp({create:{width:48,height:48,channels:3,background:'#c85f37'}}).png().toBuffer()
 await must(admin.storage.from('recipe-images').upload(imagePath,imageBytes,{contentType:'image/png'}))
 await must(admin.from('recipes').insert({id:recipeId,household_id:hid,created_by:uid,title:'Tomatsuppe',description:'Familiens tomatsuppe',servings:4,image_path:imagePath}))
 await must(admin.from('recipe_ingredients').insert([{recipe_id:recipeId,position:0,raw_text:'2 dåser tomater'},{recipe_id:recipeId,position:1,raw_text:'1 løg'}]))
 await must(admin.from('recipe_instructions').insert({recipe_id:recipeId,position:0,text:'Hak løget, tilsæt tomater og lad suppen simre.'}))
 await must(admin.from('recipe_ratings').insert({recipe_id:recipeId,person_id:person.id,rating:'love'}))
 await must(admin.from('calendar_items').insert(dates.map((date,i)=>({household_id:hid,created_by:uid,title:'Tomatsuppe',type:'Madplan',date,note:['Mandagens note','Kun tirsdagens note','Onsdagens note'][i],data:{recipe_id:recipeId,servings_override:[2,6,4][i]}}))))
 const before=await meals(),[a,b,c]=before,recipeBefore=(await library())[0]
 expect(new Set(before.map(m=>m.recipe_id)).size).toBe(1);expect(new Set(before.map(m=>m.date)).size).toBe(3)
 await page.goto(root);await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click();await routeTo(page,'meals')
 for(const m of before){await expect(card(m.id)).toContainText('Tomatsuppe');await expect(remove(m.id)).toBeVisible()}
 await shot('15-three-days-same-recipe','15. Samme opskrift · mandag, tirsdag og onsdag')
 await card(b.id).click();await expect(page.locator('.recipe-meal-context')).toContainText('Kun tirsdagens note');await expect(page.locator('[data-remove-meal]')).toBeVisible()
 await shot('16-middle-day-remove-action','16. Midterste dag · eksisterende detailhandling');await page.locator('[data-recipe-close]').click()
 await remove(b.id).click()
 const dayLabel=new Intl.DateTimeFormat('da-DK',{timeZone:'Europe/Copenhagen',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(b.date+'T12:00:00Z'))
 await expect(page.locator('#meal-remove-question')).toHaveText('Fjern Tomatsuppe fra '+dayLabel+'?')
 await expect(page.locator('#plan-modal')).not.toContainText('Slet opskrift')
 await shot('17-middle-day-confirmation','17. Bekræftelse · kun tirsdag med præcis dato')
 await page.locator('#plan-modal').getByRole('button',{name:'Annuller',exact:true}).click();expect(await meals()).toEqual(before);expect(deletes).toHaveLength(0)
 pass('SPECIFIC_DAY_CANCEL_PRESERVED')
 peerContext=await browser.newContext({storageState:await context.storageState(),locale:'da-DK',timezoneId:'Europe/Copenhagen',viewport:{width:1440,height:1000}})
 await peerContext.route('**/*',localOnly)
 const peer=await peerContext.newPage();peer.on('pageerror',e=>errors.push(e.message));await peer.goto(root);await routeTo(peer,'meals');await expect(card(b.id,peer)).toBeVisible()
 // Acceptance action is the visible button on DATE_B's meal-card, never a library delete.
 await remove(b.id).click();await page.locator('[data-confirm-meal-remove]').click();await expect(page.locator('#plan-modal')).toHaveCount(0)
 await expect(card(b.id)).toHaveCount(0);await expect.poll(async()=>(await meals()).map(m=>m.id)).toEqual([a.id,c.id])
 const after=await meals()
 expect(after.find(m=>m.id===a.id)).toEqual(a);await expect(card(a.id)).toBeVisible();pass('MEAL_A_PRESERVED')
 expect(after.some(m=>m.id===b.id)).toBe(false);await expect(page.locator('[data-meal-date="'+b.date+'"] .meal-empty')).toBeVisible();pass('MEAL_B_REMOVED')
 expect(after.find(m=>m.id===c.id)).toEqual(c);await expect(card(c.id)).toBeVisible();pass('MEAL_C_PRESERVED')
 expect(before.length-after.length).toBe(1);expect(deletes).toHaveLength(1);expect(deletes[0].p_delete_ids).toEqual([b.id]);expect(deletes[0].p_upserts).toEqual([]);expect(deletes[0].p_expected).toEqual([{id:b.id,updated_at:b.updated_at}]);pass('EXACTLY_ONE_MEAL_INSTANCE_REMOVED')
 const recipeAfter=(await library())[0];expect(recipeAfter).toEqual(recipeBefore);pass('RECIPE_LIBRARY_PRESERVED')
 expect(recipeAfter.recipe_ratings).toEqual(recipeBefore.recipe_ratings);pass('RATINGS_PRESERVED')
 expect(Buffer.from(await (await must(admin.storage.from('recipe-images').download(imagePath))).arrayBuffer())).toEqual(imageBytes);pass('IMAGE_PRESERVED')
 expect(recipeAfter.recipe_ingredients).toEqual(recipeBefore.recipe_ingredients);pass('INGREDIENTS_PRESERVED')
 expect(recipeAfter.recipe_instructions).toEqual(recipeBefore.recipe_instructions);pass('INSTRUCTIONS_PRESERVED')
 await expect(card(b.id,peer)).toHaveCount(0);await expect(card(a.id,peer)).toBeVisible();await expect(card(c.id,peer)).toBeVisible();pass('REALTIME_PRESERVED')
 await page.reload();await routeTo(page,'meals');await expect(card(b.id)).toHaveCount(0);await expect(card(a.id)).toBeVisible();await expect(card(c.id)).toBeVisible();expect(await meals()).toEqual([a,c]);pass('RELOAD_PRESERVED')
 await shot('18-three-days-after-remove','18. Efter fjernelse · mandag/onsdag bevaret, tirsdag tom')
 // The new card action must use the same durable offline queue as the foundation.
 await page.locator('[data-recipe-plan="'+recipeId+'"]').click();await page.locator('#recipe-plan-date').fill(b.date);await page.locator('#recipe-plan-note').fill('Ny tirsdagsplan');await page.locator('#recipe-plan-servings').fill('5');await page.locator('#recipe-plan-form button[type=submit]').click();await expect(page.locator('#recipe-plan-form')).toHaveCount(0)
 const readded=(await meals()).find(m=>m.date===b.date);expect(readded).toBeTruthy();await expect(card(readded.id,peer)).toBeVisible()
 await page.setViewportSize({width:375,height:667});await page.reload();await routeTo(page,'meals');await expect(remove(readded.id)).toBeVisible()
 await page.evaluate(()=>navigator.serviceWorker.ready);await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true)
 await context.setOffline(true);await remove(readded.id).click();await expect(page.locator('#meal-remove-question')).toContainText(dayLabel)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 await page.locator('[data-confirm-meal-remove]').click();await expect(page.locator('#plan-modal')).toHaveCount(0);await expect(card(readded.id)).toHaveCount(0)
 expect((await meals()).some(m=>m.id===readded.id)).toBe(true)
 await page.reload();await expect(card(readded.id)).toHaveCount(0);await expect(card(a.id)).toBeVisible();await expect(card(c.id)).toBeVisible()
 await context.setOffline(false);await expect.poll(async()=>(await meals()).map(m=>m.id)).toEqual([a.id,c.id]);await expect(card(readded.id,peer)).toHaveCount(0)
 await page.reload();await routeTo(page,'meals');await expect(card(readded.id)).toHaveCount(0);expect(await meals()).toEqual([a,c]);expect((await library())[0]).toEqual(recipeBefore)
 pass('DIRECT_CARD_REMOVE_OFFLINE_RELOAD_REALTIME_PRESERVED')
 expect(errors).toEqual([])
 writeFileSync(out+'/three-day-results.json',JSON.stringify({pass:true,results,shots,errors,recipeId,instanceIds:{a:a.id,b:b.id,c:c.id},dates,deleteKey:'calendar_items.id',localTarget:local.API_URL},null,2))
 console.log('THREE-DAY ACCEPTANCE PASS '+results.length)
}catch(error){
 await page.screenshot({path:out+'/three-day-failure.png'}).catch(()=>{})
 writeFileSync(out+'/three-day-results.json',JSON.stringify({pass:false,results,shots,errors,message:error.message},null,2));throw error
}finally{
 await browser.close();if(paths.length)await admin.storage.from('recipe-images').remove(paths)
 if(hid)await must(admin.from('households').delete().eq('id',hid));if(uid)await must(admin.auth.admin.deleteUser(uid))
}
