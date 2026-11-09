import {chromium,expect} from '@playwright/test'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {wallAvatarFixture} from './fixtures/wall-avatar.js'
import {reviewRoot} from '../scripts/aula-local.mjs'
import {routeTo} from './browser-actions.mjs'
const f=await wallAvatarFixture(),out=join(reviewRoot,'screenshots'),shots=[],checks=[],errors=[];mkdirSync(out,{recursive:true})
const browser=await chromium.launch({channel:'chrome',headless:true}),contexts=[]
const date=new Date('2026-11-11T08:30:00+01:00')
const open=async(surface,width,height)=>{
 const context=await browser.newContext({viewport:{width,height},locale:'da-DK',timezoneId:'Europe/Copenhagen',serviceWorkers:'block'});contexts.push(context)
 await context.addInitScript(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),{...(surface==='wall'?f.wallSession:f.session),expires_at:Math.floor(date.getTime()/1000)+3600})
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(url.hostname))return route.abort();if(url.pathname==='/fixture-photo-missing.png')return route.fulfill({status:404,body:'synthetic missing photo'});return route.continue()})
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);await page.clock.setFixedTime(date);await page.goto('http://127.0.0.1:5198/');await routeTo(page,'today');await page.waitForLoadState('networkidle')
 await expect(page.locator('body')).toHaveAttribute('data-mode',surface==='wall'?'kiosk':surface)
 return page
}
const card=(page,row)=>page.locator('[data-calendar-item="'+row.id+'"],[data-upcoming="'+row.id+'"]').filter({visible:true}).first()
const shot=async(page,name,title,target)=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await(target||page).screenshot({path:join(out,name+'.png'),animations:'disabled'});shots.push({name,title})}
try{
 const surfaces={mobile:await open('mobile',390,844),desktop:await open('desktop',1440,1000),wall:await open('wall',1600,1100)}
 for(const [surface,page]of Object.entries(surfaces)){
  const item=card(page,f.rows[0]);await expect(item).toContainText('Husk tuscher');await expect(item).toContainText('Aula');await expect(item.locator('.person-stack [aria-label="Ida"]')).toHaveCount(1)
  await expect.poll(()=>item.locator('.person-bubble img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true)
  expect(await item.locator('.person-bubble').evaluate(e=>e.style.getPropertyValue('--person-color'))).toBe(f.ida.color)
  await shot(page,'wall-parity-'+surface,'Samme onsdag · '+surface)
  checks.push(surface+': same accepted activity, Ida ID/colour/photo and Aula source')
 }
 const mobile=surfaces.mobile,wall=surfaces.wall
 for(const row of f.rows){const identities=async page=>card(page,row).locator('.person-stack [role="img"]').evaluateAll(nodes=>nodes.map(e=>e.getAttribute('aria-label')));expect(await identities(wall)).toEqual(await identities(mobile));expect(await identities(surfaces.desktop)).toEqual(await identities(mobile))}
 checks.push('Exact stack order and overflow identities match mobile, desktop and wall')
 expect(await wall.locator('[data-aula]').count()).toBe(0);expect(await wall.locator('.aula-family-card,.aula-today,.aula-dialog').count()).toBe(0);checks.push('Anonymous wall has no Aula administration, review, mapping or sync UI')
 const multi=card(wall,f.rows[1]);await expect(multi.locator('.person-stack .person-bubble')).toHaveCount(2);await expect(multi.locator('[aria-label="Ida"]')).toHaveCount(1);await expect(multi.locator('[aria-label="Carl"]')).toHaveCount(1);await shot(wall,'wall-parity-multiple','Wall · Ida + Carl',multi)
 const overflow=card(wall,f.rows[4]);await expect(overflow.locator('.person-overflow')).toHaveText('+1');checks.push('Wall uses shared multi-person stack and +1 overflow')
 const initials=card(wall,f.rows[2]);await expect(initials.locator('[aria-label="Jakob"]')).toBeVisible();expect(await initials.locator('img').count()).toBe(0);await shot(wall,'wall-parity-initials','Wall · initialer uden foto',initials)
 const broken=card(wall,f.rows[3]);await expect(broken.locator('.person-bubble img')).toHaveCount(0);await expect(broken.locator('[aria-label="Forælder"]')).toBeVisible();await shot(wall,'wall-parity-image-error','Wall · billedfejl viser initialer',broken);checks.push('Missing and failed photos fall back to initials through shared component')
 await shot(wall,'wall-parity-photo','Wall · privat uploadet avatarfoto',card(wall,f.rows[0]))
 await shot(mobile,'wall-parity-accepted-mobile','Accepteret Aula-aktivitet · mobile',card(mobile,f.rows[0]))
 await card(surfaces.desktop,f.rows[0]).screenshot({path:join(out,'wall-parity-accepted-desktop.png'),animations:'disabled'})
 await shot(wall,'wall-parity-accepted-wall','Accepteret Aula-aktivitet · wall',card(wall,f.rows[0]))
 expect(errors).toEqual([])
 const path=join(reviewRoot,'review.html'),old=readFileSync(path,'utf8').replace(/<!-- WALL_PARITY_START -->[\s\S]*?<!-- WALL_PARITY_END -->/,'')
 const section='<!-- WALL_PARITY_START --><header><h1>Samme aktivitet · mobil / web / wall</h1><p>Samme syntetiske familie og accepterede Aula-aktiviteter, onsdag 11. november. Rigtig lokal anonym pairing, snapshot og privat avatar-Storage. Fotoet er en syntetisk testillustration. Ingen production eller MitID-login.</p></header><section class="grid">'+shots.map(s=>`<figure><figcaption>${s.title}</figcaption><a href="screenshots/${s.name}.png"><img src="screenshots/${s.name}.png" alt="${s.title}" loading="lazy"></a></figure>`).join('')+'</section><!-- WALL_PARITY_END -->'
 writeFileSync(path,old.replace('</body>',section+'</body>'))
 // The original review intentionally omits a body closing tag.
 if(!old.includes('</body>'))writeFileSync(path,old.replace('</html>',section+'</html>'))
 writeFileSync(join(reviewRoot,'wall-avatar-browser-results.json'),JSON.stringify({status:'PASS',checks,screenshots:shots.length,runtimeErrors:errors},null,2));console.log('WALL PARITY PASS:',checks.length,'checks,',shots.length,'screenshots')
}catch(e){for(const [i,context]of contexts.entries()){const page=context.pages()[0];if(page)await page.screenshot({path:join(reviewRoot,'wall-parity-failure-'+i+'.png')})}throw e}finally{for(const c of contexts)await c.close();await browser.close();await f.cleanup()}
