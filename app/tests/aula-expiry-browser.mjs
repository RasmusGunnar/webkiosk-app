// Real app shell; only synthetic local data. No scan, login or review mutation.
import {expect} from '@playwright/test'
import {mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {routeTo} from './browser-actions.mjs'
import {finding} from './aula-activity.fixtures.js'
import {db,query,root,api,server,browser,context,page,errors,unknown,personIds} from './tasks-people-fixture.mjs'
const out=new URL('../../supabase/.temp/aula-finding-expiry/',import.meta.url);mkdirSync(out,{recursive:true})
const f=(id,date,extra={})=>finding({id,date,person_ids:[personIds[1]],person_id:personIds[1],title:'Test '+id,...extra})
const rows=[f('expires','2026-11-13'),f('future','2026-11-20'),f('dateless',null),f('multi','2026-11-12',{end_date:'2026-11-14'}),
 ...['HIGH','MEDIUM','LOW'].map(confidence=>f('past-'+confidence,'2026-11-12',{confidence})),
 f('information',null,{confidence:'LOW',proposed_action:'NO_ACTION'}),f('accepted','2026-11-01',{status:'accepted'}),f('ignored','2026-11-01',{status:'ignored'}),f('stale','2026-11-20',{status:'stale'})]
const state={connection:{status:'connected'},mappings:[],findings:rows},original=JSON.stringify(state)
let offline=false,statusReads=0,writes=0
await context.route('**/api/aula-status',route=>{statusReads++;return route.fulfill(offline?{status:503,json:{code:'AULA_TEMPORARY_ERROR'}}:{json:state})})
await context.route('**/api/aula-scan',route=>{writes++;return route.abort()})
await context.route(api+'/**/aula_review',route=>{writes++;return route.abort()})
const calendar=async()=>(await query("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') value from public.calendar_items t")).rows[0].value
const calendarBefore=await calendar(),checks=[]
await page.clock.install({time:new Date('2026-11-13T23:59:00+01:00')})
try{
 await page.setViewportSize({width:1440,height:900});await page.goto(root);await page.waitForLoadState('networkidle');await routeTo(page,'today')
 await expect(page.locator('.surface-loading')).toHaveCount(0)
 await expect(page.locator('.aula-today [data-aula="review"]')).toHaveText('Gennemgå 4')
 await routeTo(page,'family');await expect(page.locator('.aula-family-card [data-aula="review"]')).toHaveText('Se fund (5)')
 await page.locator('.aula-family-card [data-aula="review"]').click()
 await expect(page.locator('.aula-review-group [data-aula-finding]')).toHaveCount(5)
 await expect(page.locator('[data-aula-finding^="past-"]')).toHaveCount(0)
 await expect(page.locator('.aula-accepted')).toContainText('Test accepted')
 const title=page.locator('[data-aula-finding="future"] [data-aula-edit="title"]')
 await page.locator('[data-aula-finding="future"] [data-aula="edit-finding"][data-field="title"]').click()
 await title.fill('Locally edited future title')
 await page.screenshot({path:fileURLToPath(new URL('review-before-midnight.png',out))})
 offline=true;await page.clock.fastForward(120000)
 await expect(page.locator('[data-aula-finding="expires"]')).toHaveCount(0)
 await expect(page.locator('.aula-review-group [data-aula-finding]')).toHaveCount(4)
 await expect(title).toHaveValue('Locally edited future title')
 await expect(page.locator('.aula-accepted')).toContainText('Test accepted')
 await page.screenshot({path:fileURLToPath(new URL('review-after-midnight.png',out))})
 checks.push('Open review expires at Copenhagen midnight during failed status reads; current draft and accepted history retained')
 await page.locator('.aula-dialog [data-aula="close"]').click()
 await expect(page.locator('.aula-family-card [data-aula="review"]')).toHaveText('Se fund (4)')
 await routeTo(page,'today');await expect(page.locator('.aula-today [data-aula="review"]')).toHaveText('Gennemgå 3')
 await page.screenshot({path:fileURLToPath(new URL('today-desktop.png',out))})
 await page.setViewportSize({width:390,height:844});await page.clock.runFor(500);await expect(page.locator('.aula-today [data-aula="review"]')).toHaveText('Gennemgå 3')
 await page.locator('.aula-today').scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL('today-mobile.png',out))})
 checks.push('Family current NEW and desktop/mobile Today current actionable counts exclude past rows and retain dateless/multi-day')
 expect(JSON.stringify(state)).toBe(original);expect(await calendar()).toEqual(calendarBefore);expect(writes).toBe(0);expect(errors).toEqual([]);expect(unknown).toEqual([])
 checks.push('Calendar and finding input unchanged; zero scan/review writes, no browser errors')
 console.log('AULA EXPIRY BROWSER PASS:',checks.length)
 writeFileSync(new URL('browser-results.json',out),JSON.stringify({checks,statusReads,writes,calendarUnchanged:true,errors},null,2))
}finally{await browser.close();await server.close();await db.close()}
