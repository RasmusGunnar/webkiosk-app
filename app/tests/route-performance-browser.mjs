// Same synthetic family and browser; optional read-only source overlay from HEAD.
import {expect} from '@playwright/test'
import {writeFileSync} from 'node:fs'
import {root,ids,hid,api,server,browser,context,page,db,errors,unknown} from './tasks-people-fixture.mjs'
const results=[],phase=process.env.PERFORMANCE_BASELINE==='1'?'before':'after'
await context.route('**/api/aula-status',r=>r.fulfill({json:{connection:null,mappings:[],findings:[]}}))
try{
 for(const width of [375,390,430,1440,1920]){
  await page.setViewportSize({width,height:width<700?844:1080})
  if(width===1920)await page.evaluate(({api,uid,hid})=>localStorage.setItem('familiekalender.device.v1:'+api,JSON.stringify({kiosk:{userId:uid,householdId:hid}})),{api,uid:ids.adult,hid})
  await page.goto(root);await page.waitForLoadState('networkidle');await expect(page.locator('.product-nav')).toBeVisible()
  const routes=[]
  for(const route of ['today','calendar','tasks',...(width===1920?[]:['family']),'calendar']){
   const ms=await page.evaluate(route=>new Promise(resolve=>{const start=performance.now();document.querySelector('.product-nav [data-product-route="'+route+'"]').click();requestAnimationFrame(()=>resolve(performance.now()-start))}),route)
   await expect(page.locator('body')).toHaveAttribute('data-route',route);routes.push({route,ms});if(phase==='after')expect(ms).toBeLessThan(150)
  }
  results.push({width,routes})
 }
 expect(errors).toEqual([]);expect(unknown).toEqual([]);writeFileSync(new URL('../../supabase/.temp/performance-ux/route-'+phase+'.json',import.meta.url),JSON.stringify({phase,results,errors},null,2));console.log('ROUTE '+phase+' PASS')
}finally{await browser.close();await server.close();await db.close()}
