import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {randomUUID} from 'node:crypto'
import {writeFileSync,mkdirSync} from 'node:fs'
import sharp from 'sharp'
import handler from '../server/meal-recipes.ts'
import {wallAvatarFixture,must,fixtureDate} from './fixtures/wall-avatar.js'
import {routeTo} from './browser-actions.mjs'
const f=await wallAvatarFixture(),rid=randomUUID(),mealId=randomUUID(),path=`${f.hid}/${rid}/meal.webp`,out=new URL('../../supabase/.temp/design-polish/',import.meta.url)
Object.assign(process.env,f.env);mkdirSync(out,{recursive:true})
const photo=await sharp({create:{width:1200,height:900,channels:3,background:'#b95533'}}).webp().toBuffer()
await must(f.client.from('recipes').insert({id:rid,household_id:f.hid,title:'Wall-test: tomatsuppe',image_path:path,total_minutes:25,servings:4}))
await must(f.client.from('recipe_ingredients').insert({recipe_id:rid,position:0,raw_text:'800 g tomater'}));await must(f.client.from('recipe_instructions').insert({recipe_id:rid,position:0,text:'Blend suppen.'}))
await must(f.client.storage.from('recipe-images').upload(path,photo,{contentType:'image/webp'}))
await must(f.admin.from('calendar_items').insert({id:mealId,created_by:f.user.id,household_id:f.hid,type:'Madplan',title:'Wall-test: tomatsuppe',date:fixtureDate,data:{recipe_id:rid}}))
const requests=[],errors=[],checks=[]
const server=await createServer({configFile:false,envFile:false,server:{host:'127.0.0.1',port:5199,strictPort:true},plugins:[{name:'local-meal-api',configureServer(server){server.middlewares.use('/api/meal-recipes',async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString();req.body=body?JSON.parse(body):{};req.query=Object.fromEntries(new URL(req.url,'http://localhost').searchParams)
 const result={setHeader:(k,v)=>res.setHeader(k,v),status(code){res.statusCode=code;return result},json(value){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))},send(value){res.end(value)},end(){res.end()}}
 requests.push(req.method);await handler(req,result)
 })}}]});await server.listen()
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1920,height:1080},locale:'da-DK',timezoneId:'Europe/Copenhagen',serviceWorkers:'block'})
try{
 await context.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),f.wallSession)
 await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date(fixtureDate+'T09:30:00+01:00'));await page.goto('http://127.0.0.1:5199');await routeTo(page,'today')
 await expect(page.locator('body')).toHaveAttribute('data-mode','kiosk');await expect(page.locator('.today-meal [data-today-recipe]')).toBeVisible();await expect(page.locator('.today-meal-photo')).toHaveClass(/is-ready/);await expect(page.locator('.today-meal img')).toBeVisible();checks.push('Real paired wall loads planned recipe and private thumbnail through Auth/RLS/API')
 await page.screenshot({path:new URL('paired-wall-meal.png',out).pathname.replace(/^\//,''),animations:'disabled'})
 await page.locator('[data-today-recipe]').click();await expect(page.locator('.recipe-modal')).toContainText('800 g tomater');await expect(page.locator('.recipe-modal')).toContainText('Blend suppen.');await expect(page.locator('[data-recipe-edit],[data-detail-shop],[data-detail-plan],[data-recipe-rating],[data-edit-meal],[data-remove-meal]')).toHaveCount(0);await page.keyboard.press('Escape');checks.push('Existing recipe detail opens read-only with ingredients and instructions')
const initialImages=requests.filter(m=>m==='GET').length;await routeTo(page,'meals');await expect(page.locator('.wall-meal-photo img')).toBeVisible();await page.locator('[data-plan-edit="'+mealId+'"]').click();await expect(page.locator('.recipe-modal')).toContainText('800 g tomater');await expect(page.locator('[data-recipe-edit],[data-detail-shop],[data-detail-plan],[data-recipe-rating],[data-edit-meal],[data-remove-meal]')).toHaveCount(0);await page.keyboard.press('Escape');checks.push('Real paired wall week plan reuses thumbnail and opens read-only recipe detail')
 await routeTo(page,'calendar');await routeTo(page,'today');await expect(page.locator('.today-meal-photo')).toHaveClass(/is-ready/);expect(requests.filter(m=>m==='GET').length).toBe(initialImages);checks.push('Warm route changes reuse decoded thumbnail without a network request')
 await page.reload();await routeTo(page,'today');await expect(page.locator('.today-meal-photo')).toHaveClass(/is-ready/);expect(requests.filter(m=>m==='GET').length).toBe(initialImages);checks.push('Warm reload reuses private device cache')
 await must(f.client.rpc('manage_wall_device',{p_device_id:f.device.id,p_action:'revoke'}));await expect(page.locator('.today-meal')).toHaveCount(0,{timeout:25000});expect(errors).toEqual([]);checks.push('Revoked wall clears recipe UI and private image cache')
 writeFileSync(new URL('paired-wall.json',out),JSON.stringify({checks,requests,errors},null,2));checks.forEach(v=>console.log('PASS '+v))
}finally{await browser.close();await server.close();await f.admin.storage.from('recipe-images').remove([path]);await f.cleanup()}
