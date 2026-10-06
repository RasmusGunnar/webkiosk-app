import {chromium,expect as baseExpect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {routeTo,openCreate} from './browser-actions.mjs'
import {addDays} from '../src/lib/calendar-dates.js'

const expect=baseExpect.configure({timeout:20000}),local=localSupabase(),root='http://localhost:5173'
const source='https://madensverden.dk/pasta-med-koedsovs/',out='supabase/.temp/recipes-persistence'
const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data}
const results=[],errors=[],httpErrors=[],external=[]
const pass=label=>{results.push(label);console.log('PASS '+label)}
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Europe/Copenhagen'}),page=await context.newPage()
let uid,hid,preview
page.on('pageerror',e=>errors.push(e.message))
page.on('response',async r=>{if(r.status()>=400)httpErrors.push({status:r.status(),path:new URL(r.url()).pathname});if(r.url().includes('/functions/v1/recipe-preview')&&r.status()===200)preview=(await r.json()).recipe})
await context.route('**/*',r=>{const u=new URL(r.request().url());if(['localhost','127.0.0.1'].includes(u.hostname))return r.continue();external.push(u.origin);return r.abort()})
try{
 const served=await fetch(root+'/src/lib/supabase.js').then(r=>r.text())
 expect(served.match(/"VITE_SUPABASE_URL":\s*"([^"]+)"/)?.[1]).toBe(local.API_URL)
 const email='recipe-persistence-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1'
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 hid=(await must(admin.from('households').insert({name:'Local recipe persistence regression',created_by:uid}).select('id').single())).id
 await must(admin.from('household_members').insert({household_id:hid,user_id:uid,role:'owner'}))
 const recipes=()=>must(admin.from('recipes').select('*,recipe_ingredients(*),recipe_instructions(*)').eq('household_id',hid))
 const meals=()=>must(admin.from('calendar_items').select('*').eq('household_id',hid).eq('type','Madplan'))
 const recipeCard=id=>page.locator('[data-recipe-open="'+id+'"]')
 const mealCard=id=>page.locator('[data-plan-edit="'+id+'"]')
 const loaded=async img=>{await expect(img).toBeVisible();await expect.poll(()=>img.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true)}
 const reload=async()=>{await page.reload();await routeTo(page,'meals');await expect(page.getByText('Biblioteket kunne ikke opdateres.',{exact:false})).toHaveCount(0)}
 await page.goto(root);await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click();await routeTo(page,'meals')
 await openCreate(page,'meal');await page.locator('#recipe-url').fill(source);await page.locator('#recipe-fetch').click()
 await expect(page.locator('#plan-title')).toHaveValue('Pasta med kødsovs');await expect(page.locator('#recipe-status')).toContainText('Opskrift hentet')
 expect(preview.format).toBe('jsonld');expect(preview.image_copy?.base64).toBeTruthy();expect(preview.ingredients).toHaveLength(14);expect(preview.instructions).toHaveLength(9)
 expect(await recipes()).toHaveLength(0)
 const firstDate=await page.locator('#plan-date').inputValue()
 await page.locator('#plan-form button[type=submit]').click();await expect(page.locator('#plan-modal')).toHaveCount(0)
 const saved=await recipes();expect(saved,'The meal URL-import save must create exactly one library recipe').toHaveLength(1)
 const recipe=saved[0];expect(recipe.recipe_ingredients).toHaveLength(14);expect(recipe.recipe_instructions).toHaveLength(9)
 expect(recipe.source_type).toBe('url');expect(recipe.source_url).toBe(source.replace(/\/$/,''));expect(recipe.servings).toBe(4);expect(recipe.total_minutes).toBe(70);expect(recipe.image_path).toBeTruthy()
 expect((await admin.storage.from('recipe-images').download(recipe.image_path)).error).toBeNull()
 let first=(await meals())[0];expect(first.recipe_id).toBe(recipe.id);expect(first.data.recipe_id).toBe(recipe.id)
 pass('Real URL through meal editor persists one recipe, ordered lines, private image, metadata and authoritative meal recipe_id')
 await reload();await loaded(mealCard(first.id).locator('.meal-recipe-thumbnail'))
 await expect.poll(async()=>{const box=await mealCard(first.id).locator('img').boundingBox();return box?[box.width,box.height]:null}).toEqual([48,48])
 await page.locator('.food-tabs [data-food-tab=recipes]').click();await loaded(recipeCard(recipe.id).locator('img'))
 expect(await recipes()).toHaveLength(1);pass('Full reload keeps the recipe library cover and 48x48 meal thumbnail')
 await page.screenshot({path:out+'/library-reload.png',fullPage:true})
 // Plan the persisted master on another empty day through the actual library action.
 const nextDate=addDays(firstDate,1)
 await page.locator('[data-recipe-plan="'+recipe.id+'"]').click();await page.locator('#recipe-plan-date').fill(nextDate);await page.locator('#recipe-plan-form button[type=submit]').click();await expect(page.locator('#recipe-plan-form')).toHaveCount(0)
 await expect.poll(async()=>(await meals()).length).toBe(2)
 const planned=(await meals()).find(m=>m.date===nextDate);expect(planned.recipe_id).toBe(recipe.id);expect(planned.data.recipe_id).toBe(recipe.id)
 await reload();await loaded(mealCard(planned.id).locator('img'));pass('Planning from the reloaded library keeps recipe_id and thumbnail after another reload')
 await mealCard(planned.id).click();await page.locator('[data-detail-shop]').click();await page.locator('#recipe-shopping-form button[type=submit]').click();await expect(page.locator('#recipe-shopping-form')).toHaveCount(0)
 const shopping=await must(admin.from('calendar_items').select('*').eq('household_id',hid).eq('type','Indkøb'))
 expect(shopping).toHaveLength(14);expect(shopping.every(i=>i.recipe_id===recipe.id&&i.data.meal_id===planned.id&&i.data.ingredient_id)).toBe(true)
 await reload();expect((await meals()).find(m=>m.id===planned.id).recipe_id).toBe(recipe.id);await loaded(mealCard(planned.id).locator('img'));pass('Ingredient shopping rows preserve recipe/meal/ingredient references without changing the meal')
 // Identical text never establishes a recipe relationship for existing legacy data.
 const legacy=(await must(admin.from('calendar_items').insert({household_id:hid,created_by:uid,title:recipe.title,type:'Madplan',date:firstDate,note:'Legacy note',data:{}}).select('*').single()))
 await reload();await expect(mealCard(legacy.id).locator('img')).toHaveCount(0);await mealCard(legacy.id).click();await page.locator('#plan-form button[type=submit]').click();await expect(page.locator('#plan-modal')).toHaveCount(0)
 const unlinked=await must(admin.from('calendar_items').select('*').eq('id',legacy.id).single());expect(unlinked.recipe_id).toBeNull();expect(unlinked.data.recipe_id||null).toBeNull();expect(await recipes()).toHaveLength(1)
 pass('Legacy meals with an identical title remain unlinked after edit/save; no inferred relation or duplicate recipe')
 // The existing offline queue must retain the relation while editing the meal note.
 await mealCard(planned.id).click();await page.locator('[data-edit-meal]').click();await context.setOffline(true);await page.locator('#plan-note').fill('Offline note with recipe retained');await page.locator('#plan-form button[type=submit]').click();await expect(page.locator('#plan-modal')).toHaveCount(0);await context.setOffline(false)
 await expect.poll(async()=>(await must(admin.from('calendar_items').select('note').eq('id',planned.id).single())).note).toBe('Offline note with recipe retained')
 await reload();const synced=(await meals()).find(m=>m.id===planned.id);expect(synced.recipe_id).toBe(recipe.id);await loaded(mealCard(planned.id).locator('img'));pass('Offline edit and realtime refresh preserve the existing recipe relation and private thumbnail')
 await page.setViewportSize({width:375,height:667});await reload();await loaded(mealCard(planned.id).locator('img'));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:out+'/meal-mobile.png',fullPage:true});pass('Mobile meal thumbnail remains compact without horizontal overflow')
 expect(errors).toEqual([]);expect(httpErrors).toEqual([]);expect(external).toEqual([]);pass('No browser errors, failed API calls or nonlocal browser requests')
 writeFileSync(out+'/results.json',JSON.stringify({pass:true,results,realUrl:source,localTarget:new URL(local.API_URL).host},null,2))
 console.log('RECIPE PERSISTENCE PASS '+results.length)
}catch(error){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});writeFileSync(out+'/failure.json',JSON.stringify({message:error.message,results,errors,httpErrors,external},null,2));throw error}
finally{
 await browser.close()
 if(hid){const {data}=await admin.from('recipes').select('image_path').eq('household_id',hid);const paths=(data||[]).map(r=>r.image_path).filter(Boolean);if(paths.length)await admin.storage.from('recipe-images').remove(paths);await admin.from('households').delete().eq('id',hid)}
 if(uid)await admin.auth.admin.deleteUser(uid)
}
