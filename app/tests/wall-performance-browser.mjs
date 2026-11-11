// Real isolated local anonymous Auth, RLS, Storage and restricted wall RPC.
import {chromium,expect} from '@playwright/test'
import {writeFileSync} from 'node:fs'
import {wallAvatarFixture,must,fixtureDate} from './fixtures/wall-avatar.js'
const f=await wallAvatarFixture(),browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1920,height:1080},locale:'da-DK',timezoneId:'Europe/Copenhagen',serviceWorkers:'block'})
const page=await context.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message))
let signs=0,images=0,acks=0,requests=0
await context.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),f.wallSession)
await context.route('**/*',async route=>{
 const u=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort()
 if(u.pathname.endsWith('/rpc/complete_task_as_device')){requests++;await new Promise(r=>setTimeout(r,1200))}
 if(u.pathname==='/storage/v1/object/sign/household-avatars')signs++
 if(u.pathname.startsWith('/storage/v1/object/sign/household-avatars/'))images++
 return route.continue()
})
page.on('response',r=>{if(r.url().includes('/rpc/complete_task_as_device'))acks++})
try{
 const task=await must(f.client.from('calendar_items').insert({household_id:f.hid,created_by:f.user.id,title:'Synthetic wall duty',type:'Opgave',date:fixtureDate,time:'08:00',person_ids:[f.ida.id,f.carl.id],data:{rewardMode:'none',requiresApproval:false}}).select().single())
 await page.goto('http://127.0.0.1:5198/');await page.waitForLoadState('networkidle');await expect(page.locator('body')).toHaveAttribute('data-mode','kiosk')
 await page.locator('[data-task-detail="'+task.id+'"]').first().click()
 const row=page.locator('.reward-modal [data-task-person="'+f.ida.id+'"]')
 await row.locator('[data-reward-action=complete]').evaluate(b=>b.click());await expect(row.locator('[data-reward-action=undo]')).toBeEnabled();expect(acks).toBe(0)
 await row.locator('[data-reward-action=undo]').evaluate(b=>b.click());await expect(row.locator('[data-reward-action=complete]')).toBeEnabled()
 await expect.poll(()=>acks).toBe(2);await page.waitForLoadState('networkidle')
 const state=()=>must(f.client.rpc('get_reward_state',{p_household_id:f.hid})),status=s=>s.occurrences.find(o=>o.task_id===task.id&&o.person_id===f.ida.id)?.status
 expect(status(await state())).toBe('open');checks.push('Wall rapid complete/undo returns before delayed ACK; real RPC final state open')
 await context.setOffline(true);await row.locator('[data-reward-action=complete]').evaluate(b=>b.click());await expect(row.locator('[data-reward-action=undo]')).toBeEnabled();expect(status(await state())).toBe('open')
 await context.setOffline(false);await expect.poll(async()=>status(await state()),{timeout:15000}).toBe('completed');checks.push('Wall offline pending survives until reconnect through same durable queue')
 expect((await state()).occurrences.find(o=>o.task_id===task.id&&o.person_id===f.carl.id)).toBeUndefined();checks.push('Other person unchanged; no adult task API used')
 await page.keyboard.press('Escape');await page.waitForLoadState('networkidle');const old={signs,images};await page.reload();await page.waitForLoadState('networkidle')
 expect(signs-old.signs).toBe(0);expect(images-old.images).toBe(0);checks.push('Real private wall avatar cache survives warm reload without signing or download')
 expect(errors).toEqual([]);expect(requests).toBe(3)
 writeFileSync(new URL('../../supabase/.temp/performance-ux/wall-performance.json',import.meta.url),JSON.stringify({status:'PASS',checks,requests,errors},null,2));console.log('WALL PERFORMANCE PASS '+checks.length)
}finally{await context.close();await browser.close();await f.cleanup()}
