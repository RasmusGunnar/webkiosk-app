import {openCreate,openSettings,logout,toggleView,routeTo,switchHousehold} from './browser-actions.mjs'
import {chromium,expect} from '@playwright/test'
import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {localSupabase} from '../../scripts/local-supabase.mjs'
process.chdir(fileURLToPath(new URL('../../',import.meta.url)))
const local=localSupabase(),admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Europe/Copenhagen',acceptDownloads:true}),errors=[],checks=[]
page.on('pageerror',error=>errors.push(error.message))
await page.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort())
const must=async p=>{const r=await p;if(r.error)throw Error(r.error.message);return r.data},pass=label=>{checks.push(label);console.log('PASS '+checks.length+': '+label)}
const email='release-ui-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1',root='http://127.0.0.1:5178'
let uid,hid
try{
 await page.goto(root+'/auth/callback#error=access_denied&error_code=otp_expired');await expect(page.locator('#message')).toContainText('udløbet');expect(new URL(page.url()).hash).toBe('');pass('Expired web auth link shows safe error and clears URL')
 await page.goto(root+'/privacy');await expect(page.getByRole('heading',{name:'Privatliv i Familiekalender'})).toBeVisible()
 await page.reload();await expect(page.getByRole('heading',{name:'Privatliv i Familiekalender'})).toBeVisible();pass('Public privacy route and direct reload work without login')
 await page.goto(root+'/support');await expect(page.locator('a[href="/delete-account"]')).toBeVisible();pass('Public support exposes account deletion pathway')
 await page.locator('a[href="/delete-account"]').click();await expect(page.locator('#login-form')).toBeVisible();pass('Web deletion route requires login')
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 hid=(await must(admin.from('households').insert({name:'UI fixture family',created_by:uid}).select('id').single())).id
 await must(admin.from('household_members').insert({household_id:hid,user_id:uid,role:'owner'}))
 await must(admin.from('household_people').insert({household_id:hid,name:'Child UI fixture',role:'child'}))
 await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#login-form button[type=submit]').click()
 await expect(page.locator('#start-delete-account')).toBeVisible();pass('Deletion pathway persists through login')
 await page.goto(root);await openSettings(page,'account')
 const downloadPromise=page.waitForEvent('download');await page.locator('#export-family').click()
 const download=await downloadPromise,json=JSON.parse(readFileSync(await download.path(),'utf8'))
 expect(json.household.id).toBe(hid);expect(json.people[0].name).toBe('Child UI fixture')
 expect(JSON.stringify(json)).not.toContain(password);pass('Account export downloads valid authorized JSON')
 await page.locator('#start-delete-account').click();await expect(page.locator('#delete-account-form')).toBeVisible()
 await page.locator('#delete-password').fill(password);await page.locator('#delete-confirmation').fill('SLET MIN KONTO')
 await page.locator('#delete-account-form button[type=submit]').click();expect(await page.locator('#delete-account-form').evaluate(form=>form.checkValidity())).toBe(false)
 expect((await must(admin.auth.admin.getUserById(uid))).user.id).toBe(uid);pass('Last-owner family checkbox is required before submission')
 await page.locator('[name=delete-household]').check();await page.locator('#delete-password').fill('wrong-test-password')
 await page.locator('#delete-account-form button[type=submit]').click();await expect(page.locator('#delete-message')).toContainText('Adgangskoden kunne ikke')
 pass('Wrong reauthentication password leaves account intact and displays safe error')
 await page.screenshot({path:'supabase/.temp/mega5/account-delete.png',fullPage:true})
 await page.locator('#delete-password').fill(password);await page.locator('#delete-account-form button[type=submit]').click()
 await expect(page.locator('#login-form')).toBeVisible({timeout:15000})
 expect((await admin.auth.admin.getUserById(uid)).error).toBeTruthy()
 expect((await must(admin.from('households').select('id').eq('id',hid))).length).toBe(0)
 pass('In-app confirmed deletion removes family and Auth account, then logs out')
 expect(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.endsWith('-auth-token')))).toBe(false)
 await page.reload();await expect(page.locator('#login-form')).toBeVisible();pass('Deleted account cannot return from persistent local session')
 expect(errors).toEqual([]);pass('No uncaught browser exceptions in release flows')
 console.log('RELEASE BROWSER PASS '+checks.length+'/'+checks.length)
}finally{
 if(hid)await admin.from('households').delete().eq('id',hid)
 if(uid)await admin.auth.admin.deleteUser(uid)
 await browser.close()
 mkdirSync('supabase/.temp/mega5',{recursive:true});writeFileSync('supabase/.temp/mega5/browser-checks.json',JSON.stringify({checks,errors},null,2))
}
