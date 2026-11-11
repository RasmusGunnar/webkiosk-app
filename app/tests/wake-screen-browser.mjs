import {expect} from '@playwright/test'
import {writeFileSync,mkdirSync} from 'node:fs'
import {routeTo} from './browser-actions.mjs'
import {db,ids,hid,api,root,server,browser,context,page,errors,unknown} from './tasks-people-fixture.mjs'
const out=new URL('../../supabase/.temp/performance-ux/',import.meta.url);mkdirSync(out,{recursive:true})
await context.route('**/api/aula-status',r=>r.fulfill({json:{connection:null,mappings:[],findings:[]}}))
await context.addInitScript(()=>{
 window.wakeProbe={requests:0,releases:0,hidden:false,deny:localStorage.getItem('wake-test-deny')==='true',lock:null}
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.wakeProbe.hidden})
 Object.defineProperty(navigator,'wakeLock',{configurable:true,value:localStorage.getItem('wake-test-unsupported')?undefined:{request:async type=>{
  if(type!=='screen')throw Error('Wrong wake type');const p=window.wakeProbe;p.requests++;if(p.deny)throw new DOMException('Synthetic policy denial','NotAllowedError')
  const lock=new EventTarget();lock.release=async()=>{if(lock.released)return;lock.released=true;p.releases++;lock.dispatchEvent(new Event('release'))};p.lock=lock;return lock
 }}})
})
const checks=[],pass=s=>{checks.push(s);console.log('WAKE PASS '+s)}
async function settings(){await routeTo(page,'family');await page.locator('[data-open-settings=device]').click();await expect(page.locator('#device-wake')).toBeVisible()}
try{
 await page.goto(root);await page.waitForLoadState('networkidle');expect(await page.evaluate(()=>wakeProbe.requests)).toBe(0);pass('Normal mobile default OFF')
 await settings();await expect(page.locator('#device-wake')).not.toBeChecked();await page.locator('#device-wake').check();await page.locator('#device-settings-form button[type=submit]').click()
 await expect.poll(()=>page.evaluate(()=>wakeProbe.requests)).toBe(1);pass('Device setting ON requests screen lock')
 await page.reload();await page.waitForLoadState('networkidle');await expect.poll(()=>page.evaluate(()=>wakeProbe.requests)).toBe(1);pass('Reload/PWA reopen preserves device setting')
 await page.evaluate(()=>{wakeProbe.hidden=true;document.dispatchEvent(new Event('visibilitychange'))});await expect.poll(()=>page.evaluate(()=>wakeProbe.releases)).toBe(1)
 await page.evaluate(()=>{wakeProbe.hidden=false;document.dispatchEvent(new Event('visibilitychange'))});await expect.poll(()=>page.evaluate(()=>wakeProbe.requests)).toBe(2);pass('Hidden releases; visible reacquires')
 await page.evaluate(()=>wakeProbe.lock.release());await expect.poll(()=>page.evaluate(()=>wakeProbe.requests),{timeout:4000}).toBe(3);pass('System release safely reacquires')
 await settings();await page.locator('#device-wake').uncheck();await page.locator('#device-settings-form button[type=submit]').click();await expect.poll(()=>page.evaluate(()=>wakeProbe.releases)).toBe(3)
 await page.reload();await page.waitForLoadState('networkidle');expect(await page.evaluate(()=>wakeProbe.requests)).toBe(0);pass('OFF releases and persists')
 await page.evaluate(({api,uid,hid})=>{localStorage.setItem('familiekalender.device.v1:'+api,JSON.stringify({kiosk:{userId:uid,householdId:hid}}));localStorage.setItem('wake-test-deny','true')},{api,uid:ids.adult,hid})
 await page.reload();await page.waitForLoadState('networkidle');await expect(page.locator('body')).toHaveAttribute('data-mode','kiosk');expect(await page.evaluate(()=>wakeProbe.requests)).toBe(1)
 await page.waitForTimeout(1100);expect(await page.evaluate(()=>wakeProbe.requests)).toBe(1);pass('Wall default ON; rejected request does not loop')
 await page.evaluate(()=>{wakeProbe.deny=false;document.dispatchEvent(new PointerEvent('pointerdown'))});await expect.poll(()=>page.evaluate(()=>wakeProbe.requests)).toBe(2);pass('User interaction retries denied request')
 await page.evaluate(()=>localStorage.setItem('wake-test-unsupported','true'));await page.reload();await page.waitForLoadState('networkidle');await expect(page.locator('.product-nav')).toBeVisible();expect(await page.evaluate(()=>wakeProbe.requests)).toBe(0);pass('Unsupported browser keeps working')
 expect(errors).toEqual([]);expect(unknown).toEqual([])
 writeFileSync(new URL('wake-browser.json',out),JSON.stringify({status:'PASS',checks,errors},null,2))
}finally{await browser.close();await server.close();await db.close()}
