// Run only AFTER visual review. Never starts MitID or a scan automatically.
import {chromium} from '@playwright/test'
import {localEnvironment,localFixture} from './aula-local.mjs'
const env=localEnvironment(),fixture=await localFixture(env)
const probe=await fetch('http://127.0.0.1:5198/api/aula-status',{method:'POST',headers:{authorization:`Bearer ${fixture.session.access_token}`,'content-type':'application/json'},body:JSON.stringify({household_id:fixture.household.id})})
if(!probe.ok||!probe.headers.get('content-type')?.includes('application/json'))throw Error('Start dev:aula first; the local API must be available')
const browser=await chromium.launch({channel:'chrome',headless:false})
const context=await browser.newContext({viewport:{width:1100,height:850},locale:'da-DK',timezoneId:'Europe/Copenhagen'})
// Supabase's LOCAL fixture login only. No Aula token is available to this script.
await context.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),fixture.session)
const page=await context.newPage()
await page.goto('http://127.0.0.1:5198/')
await page.locator('[data-product-route="family"]').filter({visible:true}).first().click()
await page.locator('.aula-family-card').scrollIntoViewIfNeeded()
console.log('Local Aula acceptance is open. Login starts only when you choose Connect in the app. Do not share QR codes, user IDs or tokens.')
await new Promise(resolve=>browser.once('disconnected',resolve))
