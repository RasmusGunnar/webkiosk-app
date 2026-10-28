import {chromium,expect as baseExpect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import sharp from 'sharp'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {routeTo,openSettings} from './browser-actions.mjs'
import {weekDates} from '../src/lib/calendar-dates.js'

// Run from the repository root with app/scripts/preview-local.mjs on port 5179.
// All writes are confined to a disposable family on the allowlisted local stack.
const expect=baseExpect.configure({timeout:20000}),local=localSupabase()
const root='http://127.0.0.1:5179',out='supabase/.temp/meal-plan-remove'
const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const must=async query=>{const result=await query;if(result.error)throw Error(result.error.message);return result.data}
const results=[],errors=[],deletes=[],paths=[],users=[]
const pass=name=>{const result=name.endsWith('_PASS')?name:name+' PASS';results.push(result);console.log(result)}
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const context=await browser.newContext({locale:'da-DK',timezoneId:'Europe/Copenhagen',viewport:{width:1440,height:1000}})
const page=await context.newPage()
page.on('pageerror',e=>errors.push(e.message))
page.on('request',request=>{
 if(request.url().endsWith('/rpc/sync_calendar_mutation')){
  const payload=request.postDataJSON();if(payload.p_delete_ids?.length)deletes.push(payload)
 }
})
await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
let hid,peerContext
const meals=()=>must(admin.from('calendar_items').select('*').eq('household_id',hid).eq('type','Madplan').order('id'))
const library=()=>must(admin.from('recipes').select('*,recipe_ingredients(*),recipe_instructions(*),recipe_ratings(*)').eq('household_id',hid).order('id'))
const card=(id,p=page)=>p.locator('.meal-card [data-plan-edit="'+id+'"]')
const confirmRemove=async(button,{accept=true}={})=>{
 const dialog=page.waitForEvent('dialog');const click=button.click();const d=await dialog
 expect(d.type()).toBe('confirm');expect(d.message()).toContain('madplan');expect(d.message()).toMatch(/".+"/);expect(d.message()).not.toContain('Slet opskrift')
 if(accept)await d.accept();else await d.dismiss();await click
}
const closeRecipe=async()=>{await page.locator('[data-recipe-close]').click();await expect(page.locator('.recipe-modal')).toHaveCount(0)}
try{
 const html=await fetch(root).then(r=>r.text()),script=html.match(/<script[^>]+src="([^"]+)"/)?.[1]
 expect(script).toBeTruthy()
 const served=await fetch(new URL(script,root)).then(r=>r.text())
 expect(served).toContain(local.API_URL)
 const email='meal-remove-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1'
 const uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id;users.push(uid)
 hid=(await must(admin.from('households').insert({name:'Local meal removal regression',created_by:uid}).select('id').single())).id
 await must(admin.from('household_members').insert({household_id:hid,user_id:uid,role:'owner'}))
 const person=(await must(admin.from('household_people').insert({household_id:hid,name:'Testperson',role:'adult',color:'#7c935e'}).select('id').single()))
 const recipeId=randomUUID(),imagePath=hid+'/'+recipeId+'/'+randomUUID()+'.png';paths.push(imagePath)
 const image=await sharp({create:{width:48,height:48,channels:3,background:'#7c935e'}}).png().toBuffer()
 await must(admin.storage.from('recipe-images').upload(imagePath,image,{contentType:'image/png'}))
 const recipe=await must(admin.from('recipes').insert({id:recipeId,household_id:hid,title:'Testpasta',description:'Bevar hele opskriften',servings:4,image_path:imagePath,created_by:uid}).select('*').single())
 await must(admin.from('recipe_ingredients').insert([{recipe_id:recipe.id,position:0,raw_text:'500 g pasta'},{recipe_id:recipe.id,position:1,raw_text:'2 tomater'}]))
 await must(admin.from('recipe_instructions').insert({recipe_id:recipe.id,position:0,text:'Kog pastaen.'}))
 await must(admin.from('recipe_ratings').insert({recipe_id:recipe.id,person_id:person.id,rating:'love'}))
 const replacement=await must(admin.from('recipes').insert({household_id:hid,title:'Testsuppe',servings:3,created_by:uid}).select('*').single())
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen'}).format(new Date())
 const otherDay=weekDates(today).find(day=>day!==today)
 const seed=(date,note,servings)=>({household_id:hid,created_by:uid,title:recipe.title,date,type:'Madplan',note,data:{recipe_id:recipe.id,servings_override:servings}})
 const [selected,sameDay,other]=await must(admin.from('calendar_items').insert([seed(today,'Kun denne planlægning',6),seed(today,'Andet måltid samme dag',2),seed(otherDay,'Bevar denne dag',8)]).select('*'))
 const shopping=await must(admin.from('calendar_items').insert({household_id:hid,created_by:uid,title:'Pasta til indkøb',date:today,type:'Indkøb',data:{recipe_id:recipe.id,meal_id:selected.id}}).select('*').single())
 const beforeLibrary=await library(),beforeMeals=await meals()

 // Verify the existing RPC still denies a different authenticated household.
 const outsiderEmail='meal-outsider-'+randomUUID()+'@example.test',outsiderPassword=randomUUID()+'!Aa1'
 users.push((await must(admin.auth.admin.createUser({email:outsiderEmail,password:outsiderPassword,email_confirm:true}))).user.id)
 const outsider=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}})
 await must(outsider.auth.signInWithPassword({email:outsiderEmail,password:outsiderPassword}))
 const denied=await outsider.rpc('sync_calendar_mutation',{p_mutation_id:randomUUID(),p_household_id:hid,p_expected:[{id:selected.id,updated_at:selected.updated_at}],p_upserts:[],p_delete_ids:[selected.id]})
 expect(denied.error?.code).toBe('42501');expect(await meals()).toEqual(beforeMeals)
 await outsider.auth.signOut();pass('MEAL_PLAN_REMOVE_HOUSEHOLD_ACCESS')

 await page.goto(root);await page.locator('#email').fill(email);await page.locator('#password').fill(password)
 await page.locator('#login-form button[type=submit]').click();await routeTo(page,'meals')
 await card(selected.id).click();await expect(page.locator('.recipe-ingredients')).toContainText('500 g pasta')
 await expect(page.locator('[data-edit-meal]')).toBeVisible()
 const remove=page.locator('.recipe-modal').getByRole('button',{name:'Fjern fra madplan',exact:true})
 await expect(remove).toBeVisible()
 await page.screenshot({path:out+'/remove-action-desktop.png',fullPage:true})
 await confirmRemove(remove,{accept:false});expect(await meals()).toEqual(beforeMeals)
 await expect(page.locator('.recipe-modal')).toBeVisible();expect(deletes).toHaveLength(0)
 pass('MEAL_PLAN_REMOVE_CANCEL')

 // Separate browser storage proves server realtime, rather than BroadcastChannel sharing.
 peerContext=await browser.newContext({storageState:await context.storageState(),locale:'da-DK',timezoneId:'Europe/Copenhagen',viewport:{width:1440,height:1000}})
 const peer=await peerContext.newPage();peer.on('pageerror',e=>errors.push(e.message))
 await peer.goto(root);await routeTo(peer,'meals');await expect(card(selected.id,peer)).toBeVisible()
 await confirmRemove(remove);await expect(page.locator('.recipe-modal')).toHaveCount(0)
 await expect(card(selected.id)).toHaveCount(0)
 await expect.poll(async()=>(await meals()).some(m=>m.id===selected.id)).toBe(false)
 expect(deletes).toHaveLength(1);expect(deletes[0].p_delete_ids).toEqual([selected.id]);expect(deletes[0].p_upserts).toEqual([])
 expect(deletes[0].p_expected).toEqual([{id:selected.id,updated_at:selected.updated_at}])
 pass('MEAL_PLAN_REMOVE_RECIPE')
 await expect(card(selected.id,peer)).toHaveCount(0);await expect(card(other.id,peer)).toBeVisible()
 pass('MEAL_PLAN_REMOVE_REALTIME')
 await peerContext.close();peerContext=null

 expect(await library()).toEqual(beforeLibrary)
 const savedImage=await must(admin.storage.from('recipe-images').download(imagePath))
 expect(Buffer.from(await savedImage.arrayBuffer())).toEqual(image)
 await page.locator('.food-tabs [data-food-tab=recipes]').click()
 await page.locator('[data-recipe-open="'+recipe.id+'"]').click()
 await expect(page.locator('.recipe-modal .recipe-cover')).toBeVisible();await expect(page.locator('[data-recipe-rating]')).toHaveValue('love')
 await expect(page.locator('.recipe-ingredients li')).toHaveCount(2)
 await expect(page.locator('[data-remove-meal]')).toHaveCount(0);await closeRecipe()
 pass('MEAL_PLAN_RECIPE_LIBRARY_PRESERVED')
 expect(await meals()).toEqual(beforeMeals.filter(m=>m.id!==selected.id))
 expect(await must(admin.from('calendar_items').select('*').eq('id',shopping.id).single())).toEqual(shopping)
 pass('MEAL_PLAN_OTHER_DAYS_PRESERVED')

 await page.reload();await routeTo(page,'meals');await expect(card(selected.id)).toHaveCount(0)
 await expect(card(sameDay.id)).toBeVisible();await expect(card(other.id)).toBeVisible()
 expect(await library()).toEqual(beforeLibrary);pass('MEAL_PLAN_REMOVE_RELOAD_PASS')

 await page.locator('[data-recipe-plan="'+replacement.id+'"]').click()
 await page.locator('#recipe-plan-date').fill(today);await page.locator('#recipe-plan-note').fill('En ny ret på samme dag')
 await page.locator('#recipe-plan-servings').fill('5');await page.locator('#recipe-plan-form button[type=submit]').click()
 await expect(page.locator('#recipe-plan-form')).toHaveCount(0)
 const readded=(await meals()).find(m=>m.recipe_id===replacement.id)
 expect(readded.date).toBe(today);expect(readded.note).toBe('En ny ret på samme dag');expect(readded.data.servings_override).toBe(5)
 await page.reload();await routeTo(page,'meals');await expect(card(readded.id)).toBeVisible()
 pass('MEAL_PLAN_READD_AFTER_REMOVE')

 // Existing planning editor remains available and uses the same removal wording/path.
 await card(sameDay.id).click();await page.locator('[data-edit-meal]').click()
 await expect(page.locator('#plan-delete')).toHaveText('Fjern fra madplan')
 await confirmRemove(page.locator('#plan-delete'));await expect(page.locator('#plan-modal')).toHaveCount(0)
 await expect(card(sameDay.id)).toHaveCount(0);expect(await library()).toEqual(beforeLibrary)
 pass('MEAL_PLAN_REMOVE_FROM_EDITOR')

 // Mobile removal must remain local through reload, then replay on reconnect.
 await page.setViewportSize({width:375,height:667});await page.reload();await routeTo(page,'meals')
 await card(readded.id).click();await expect(page.locator('[data-remove-meal]')).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 await page.screenshot({path:out+'/remove-action-mobile.png',fullPage:true})
 await page.evaluate(()=>navigator.serviceWorker.ready)
 await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true)
 await context.setOffline(true);await confirmRemove(page.locator('[data-remove-meal]'))
 await expect(page.locator('.recipe-modal')).toHaveCount(0);await expect(card(readded.id)).toHaveCount(0)
 expect((await meals()).some(m=>m.id===readded.id)).toBe(true)
 await page.reload();await expect(card(readded.id)).toHaveCount(0);await expect(card(other.id)).toBeVisible()
 await context.setOffline(false)
 await expect.poll(async()=>(await meals()).some(m=>m.id===readded.id)).toBe(false)
 await page.reload();await routeTo(page,'meals');await expect(card(readded.id)).toHaveCount(0)
 expect(await meals()).toEqual([other]);expect(await library()).toEqual(beforeLibrary)
 pass('MEAL_PLAN_REMOVE_OFFLINE_RELOAD_SYNC')

 await page.setViewportSize({width:1280,height:800});await openSettings(page,'device')
 await page.locator('#device-kiosk').check();await page.locator('#device-pin').fill('1948')
 await page.locator('#device-settings-form button[type=submit]').click();await routeTo(page,'meals')
 await card(other.id).click();await expect(page.locator('.recipe-ingredients')).toBeVisible()
 await expect(page.locator('[data-remove-meal],[data-edit-meal],[data-meal-remove]')).toHaveCount(0)
 pass('MEAL_PLAN_REMOVE_KIOSK_READONLY')
 expect(errors).toEqual([])
 writeFileSync(out+'/results.json',JSON.stringify({pass:true,results,errors,localTarget:local.API_URL},null,2))
 console.log('MEAL PLAN REMOVE BROWSER PASS '+results.length)
}catch(error){
 await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{})
 writeFileSync(out+'/results.json',JSON.stringify({pass:false,message:error.message,results,errors},null,2))
 throw error
}finally{
 await browser.close()
 if(paths.length)await admin.storage.from('recipe-images').remove(paths)
 if(hid)await admin.from('households').delete().eq('id',hid)
 for(const uid of users)await admin.auth.admin.deleteUser(uid)
}
