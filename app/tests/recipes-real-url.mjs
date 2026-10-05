import {chromium,expect as baseExpect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {routeTo} from './browser-actions.mjs'
import {canonicalRecipeUrl} from '../src/lib/recipe-model.js'
const expect=baseExpect.configure({timeout:20000}),local=localSupabase(),root='http://localhost:5173',url='https://madensverden.dk/pasta-med-koedsovs/'
const out='supabase/.temp/recipes30-fix',admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}}),runFile=promisify(execFile)
mkdirSync(out,{recursive:true})
// No network mocks: the browser must use local Auth/DB/Storage/Edge only.
const context=await chromium.launchPersistentContext(out+'/real-url-browser-'+Date.now(),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--remote-debugging-port=9362'],viewport:{width:1440,height:1000},timezoneId:'Europe/Copenhagen'})
const page=context.pages()[0],errors=[],httpErrors=[],external=[],results=[],paths=[];let uid,hid,recipeId,preview
const pass=label=>{results.push(label);console.log('PASS '+label)}
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data}
const agent=async(...args)=>{const r=await runFile(process.env.AGENT_BROWSER_PATH,['--cdp','9362',...args],{windowsHide:true,timeout:45000});return r.stdout}
page.on('pageerror',e=>errors.push(e.message))
page.on('response',async r=>{if(r.status()>=400)httpErrors.push({status:r.status(),path:new URL(r.url()).pathname});if(r.url().includes('/functions/v1/recipe-preview')&&r.status()===200)preview=(await r.json()).recipe})
await context.route('**/*',r=>{const u=new URL(r.request().url());if(['localhost','127.0.0.1'].includes(u.hostname))return r.continue();external.push({origin:u.origin,path:u.pathname});return r.abort()})
try{
 const served=await fetch(root+'/src/lib/supabase.js').then(r=>r.text());expect(served.match(/"VITE_SUPABASE_URL":\s*"([^"]+)"/)?.[1]).toBe(local.API_URL);pass('Default localhost:5173 frontend uses only local Supabase')
 const email='recipes-real-url-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1';uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 hid=(await must(admin.from('households').insert({name:'Lokal opskriftskontrol',created_by:uid}).select('id').single())).id
 await must(admin.from('household_members').insert({household_id:hid,user_id:uid,role:'owner'}))
 await page.goto(root);await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click();await routeTo(page,'meals')
 await expect(page.getByText('Biblioteket kunne ikke opdateres.',{exact:false})).toHaveCount(0);pass('Library loads from the actual local REST query without fallback warning')
 if(process.env.AGENT_BROWSER_PATH){writeFileSync(out+'/agent-browser-before.txt',await agent('snapshot','-i'));await agent('click','[data-recipe-url]');await agent('fill','#library-recipe-url',url);await agent('click','#recipe-url-form button')}
 else{await page.locator('[data-recipe-url]').click();await page.locator('#library-recipe-url').fill(url);await page.locator('#recipe-url-form button').click()}
 await expect(page.locator('#recipe-title')).toHaveValue('Pasta med kødsovs');await expect(page.locator('#recipe-title')).toBeEditable()
 expect(preview?.format).toBe('jsonld');expect(preview?.url).toBe(url);expect(preview?.ingredients.length).toBe(14);expect(preview?.instructions.length).toBe(9)
 await expect(page.locator('#recipe-ingredients')).toBeEditable();await expect(page.locator('#recipe-instructions')).toBeEditable()
 expect((await page.locator('#recipe-ingredients').inputValue()).split('\n').filter(Boolean)).toHaveLength(14);expect((await page.locator('#recipe-instructions').inputValue()).split('\n').filter(Boolean)).toHaveLength(9)
 await expect(page.locator('[name=servings]')).toHaveValue('4');await expect(page.locator('[name=total_minutes]')).toHaveValue('70');await expect(page.locator('[name=prep_minutes]')).toHaveValue('15');await expect(page.locator('[name=cook_minutes]')).toHaveValue('55')
 await expect.poll(()=>page.locator('#recipe-image-preview img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true)
 expect((await must(admin.from('recipes').select('id').eq('household_id',hid))).length).toBe(0);pass('Real Recipe JSON-LD gives editable title, image, 14 ingredients, 9 steps, servings and time before any save')
 if(process.env.AGENT_BROWSER_PATH)writeFileSync(out+'/agent-browser-preview.txt',await agent('snapshot','-i'))
 await page.screenshot({path:out+'/real-url-preview-desktop.png',fullPage:true})
 await page.locator('#recipe-editor button[type=submit]').click();await expect(page.locator('#recipe-dialog-title')).toHaveText('Pasta med kødsovs')
 const recipe=(await must(admin.from('recipes').select('*,recipe_ingredients(*),recipe_instructions(*)').eq('household_id',hid).single()));recipeId=recipe.id;paths.push(recipe.image_path)
 expect(recipe.source_url).toBe(canonicalRecipeUrl(url));expect(recipe.source_type).toBe('url');expect(recipe.image_path).toBeTruthy();expect(recipe.recipe_ingredients).toHaveLength(14);expect(recipe.recipe_instructions).toHaveLength(9);pass('Save persists source URL, copied private image and ordered recipe lines')
 await page.keyboard.press('Escape');await page.reload();await routeTo(page,'meals');await expect(page.locator('[data-recipe-open="'+recipeId+'"]')).toBeVisible();await expect(page.getByText('Biblioteket kunne ikke opdateres.',{exact:false})).toHaveCount(0)
 await expect.poll(()=>page.locator('[data-recipe-open="'+recipeId+'"] img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);await page.screenshot({path:out+'/library-reload-desktop.png',fullPage:true});pass('Recipe and stored image load from the library after full browser reload')
 await page.setViewportSize({width:375,height:812});await routeTo(page,'meals');await page.locator('[data-recipe-open="'+recipeId+'"]').click();await expect(page.locator('.recipe-steps')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:out+'/saved-recipe-375.png',fullPage:true});pass('Saved real recipe remains readable at 375 px')
 expect(external).toEqual([]);expect(httpErrors).toEqual([]);expect(errors).toEqual([]);pass('No browser external fetch, hosted Supabase request, JavaScript error or HTTP error')
 writeFileSync(out+'/real-url-browser.json',JSON.stringify({pass:true,root,api:local.API_URL,url,results,preview:{title:preview.title,format:preview.format,ingredients:preview.ingredients.length,instructions:preview.instructions.length,image:!!preview.image_copy,servings:preview.servings,total_minutes:preview.total_minutes},libraryReload:true,errors,httpErrors,external,fixturePolicy:'Disposable local household and user; actual public URL, no import mocks; cleanup after test'},null,2))
}catch(e){await page.screenshot({path:out+'/real-url-failure.png',fullPage:true}).catch(()=>{});writeFileSync(out+'/real-url-failure.json',JSON.stringify({message:e.message,results,errors,httpErrors,external},null,2));throw e}
finally{await context.close();if(paths.length)await admin.storage.from('recipe-images').remove(paths.filter(Boolean));if(hid)await admin.from('households').delete().eq('id',hid);if(uid)await admin.auth.admin.deleteUser(uid)}
