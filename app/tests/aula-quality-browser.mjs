// Synthetic only; existing review UI, zero provider or production requests.
import {expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {routeTo} from './browser-actions.mjs';
import {finding} from './aula-activity.fixtures.js';
import {db,query,root,api,server,browser,context,page,errors,unknown,personIds} from './tasks-people-fixture.mjs';
const out=new URL('../../supabase/.temp/aula-inbox-quality/',import.meta.url);mkdirSync(out,{recursive:true});
const title='Husk stor madpakke · Medbring 1,5 liter saftevand · Husk varmt tøj';
const rows=[finding({id:'combined',date:'2026-11-20',title,summary:title,person_ids:[personIds[1]],person_id:personIds[1]}),finding({id:'respond',date:null,title:'Tilmeld skole-hjem-samtale',lifecycle:'persistent',person_ids:[personIds[1]],person_id:personIds[1]})];
let writes=0;
await context.route('**/api/aula-status',route=>route.fulfill({json:{connection:{status:'connected'},mappings:[],findings:rows}}));
await context.route('**/api/aula-scan',route=>{writes++;return route.abort()});
await context.route(api+'/**/aula_review',route=>{writes++;return route.abort()});
const before=(await query('select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,\'[]\')) value from public.calendar_items c')).rows[0].value;
try{
 await page.clock.setFixedTime(new Date('2026-11-17T12:00Z'));
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});await page.goto(root);await page.waitForLoadState('networkidle');await routeTo(page,'family');
  await page.locator('.aula-family-card [data-aula="review"]').click();await expect(page.locator('.aula-review-group [data-aula-finding]')).toHaveCount(2);
  await expect(page.locator('[data-aula-finding="combined"]')).toContainText(title);
  await expect(page.locator('[data-aula-finding="combined"] [data-aula="accept"]')).toHaveCount(1);
  await page.screenshot({path:fileURLToPath(new URL('review-'+width+'.png',out))});
 }
 expect(writes).toBe(0);expect(errors).toEqual([]);expect(unknown).toEqual([]);
 expect((await query('select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,\'[]\')) value from public.calendar_items c')).rows[0].value).toBe(before);
 writeFileSync(new URL('browser-results.json',out),JSON.stringify({pass:true,viewports:[1440,390],writes,calendarUnchanged:true}));
 console.log('AULA QUALITY BROWSER PASS: one complete material card, quantities, persistent response, desktop/mobile, zero writes');
}finally{await browser.close();await server.close();await db.close()}
