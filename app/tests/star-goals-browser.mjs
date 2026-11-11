// Visual/interaction review against the real app and existing PostgreSQL RPCs.
// All accounts, people and balances below are isolated local fixtures.
import {expect} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {rewardTemplates} from '../src/lib/stars-ui.js'
import {t} from '../src/i18n/index.js'
import {routeTo} from './browser-actions.mjs'
import {db,query,actor,today,ids,root,api,hid,carl,personIds,server,browser,page,errors,unknown,fits,switchUser} from './tasks-people-fixture.mjs'

const out=new URL('../../supabase/.temp/star-goals-ux/',import.meta.url)
mkdirSync(out,{recursive:true})
const ida=personIds[2],jakob=personIds[3],checks=[],shots=[]
const pass=name=>{checks.push(name);console.log('GOALS PASS '+name)}
const action=async(name,payload,uid=ids.adult)=>{await actor(uid);return (await query('select public.reward_action($1,$2,$3,$4::jsonb) result',[randomUUID(),hid,name,JSON.stringify(payload)])).rows[0].result}
const state=async()=>{await actor(ids.adult);return (await query('select public.get_reward_state($1) result',[hid])).rows[0].result}
const balance=async pid=>Number((await state()).balances.find(b=>b.person_id===pid)?.balance||0)
const task=async(pid,stars)=>{await actor(null);const id=randomUUID();await query("insert into public.calendar_items(id,household_id,created_by,title,type,date,person_ids,data) values($1,$2,$3,'Hjælp med aftensmaden','Opgave',$4,$5,$6::jsonb)",[id,hid,ids.adult,today,[pid],JSON.stringify({rewardMode:'stars',starValue:stars,requiresApproval:false})]);return {person_id:pid,item_id:id,due_date:today,occurrence_date:today}}
const earn=async(pid,stars)=>action('complete',await task(pid,stars))
const panel=pid=>page.locator('[data-star-person="'+pid+'"]')
const shoot=async(name,label)=>{await expect(page.locator('.reward-delta')).toHaveCount(0);await page.evaluate(()=>document.fonts.ready);await fits();await page.screenshot({path:fileURLToPath(new URL(name+'.png',out)),fullPage:false});shots.push({name,label})}
const refresh=async()=>{await page.reload();await routeTo(page,'tasks')}
const choosePerson=async pid=>{await page.locator('.star-goals [data-reward-select="'+pid+'"]').click();await expect(page.locator('.reward-dashboard [data-star-person="'+pid+'"]')).toBeVisible()}
const admin=async()=>{await routeTo(page,'tasks');await page.locator('[data-person-filter="Alle"]').click();await page.locator('[data-star-admin]').click();await expect(page.locator('.star-admin')).toBeVisible()}
let cinema,cafe,board
try{
 await actor(null);await query('update public.household_people set reward_enabled=false where id=$1',[personIds[4]])
 await action('link_person',{person_id:ida,user_id:ids.child})
 await page.goto(root);await routeTo(page,'today');await expect(page.locator('.star-goals')).toHaveCount(0);await routeTo(page,'tasks')
 await expect(page.locator('.star-goals [data-star-person]')).toHaveCount(3)
 await expect(panel(ida).locator('[data-reward-catalog=new]')).toHaveText('Opret første belønning')
 await shoot('empty-catalog-adult','Tomt katalog · voksen kan oprette første belønning')
 await switchUser(ids.child);await routeTo(page,'tasks')
 await expect(panel(ida)).toContainText('En voksen skal først oprette nogle belønninger')
 await expect(page.locator('[data-reward-catalog]')).toHaveCount(0)
 pass('Empty catalog: adult create / child explanation')

 const catalog=[]
 for(const template of rewardTemplates)catalog.push((await action('catalog',{title:t(template.key),emoji:template.emoji,star_cost:template.cost,active:true})).id)
 ;[cinema,cafe,,,board]=catalog
 await earn(ida,14);await earn(carl,17);await earn(jakob,8)
 await action('allowance_save',{person_id:ida,cadence:'week',amount_minor:10000,start_today:true,duties:[{title:'Dæk bord',schedule:'daily',approval:false}]})
 await action('goal',{person_id:carl,reward_id:cafe});await action('goal',{person_id:jakob,reward_id:board})
 await refresh();await expect(panel(ida)).toContainText('Hvad vil du spare op til?');await expect(panel(ida)).toContainText('14')
 await shoot('03-ida-no-goal','Ida · 14 stjerner · vælg belønning')
 await panel(ida).locator('[data-star-choose]').click();await expect(page.locator('.star-reward-card')).toHaveCount(rewardTemplates.length)
 await expect(page.locator('.star-reward-grid')).toContainText('Cafétur');await expect(page.locator('.star-reward-grid')).toContainText('Biograftur')
 await shoot('05-reward-picker','Vælg mål · familiens eksisterende belønningskatalog')
 await page.locator('[data-star-reward="'+cinema+'"] [data-reward-action=goal]').focus();await page.keyboard.press('Enter')
 await expect(page.locator('.reward-modal')).toHaveCount(0);await expect(panel(ida).locator('progress')).toHaveAttribute('value','14')
 await expect(panel(ida).locator('progress')).toHaveAttribute('max','25');await expect(panel(ida)).toContainText('Du mangler 11')
 expect(await balance(ida)).toBe(14);await shoot('02-ida-progress','Ida · Biograftur · 14 / 25 · 11 stjerner igen')
 const allowance=page.locator('.reward-dashboard > .reward-secondary')
 await expect(allowance).not.toHaveAttribute('open','');await allowance.locator('summary').click();await expect(allowance.locator('.reward-month')).toBeVisible();await expect(allowance).toContainText(/100\s*kr/);await allowance.locator('summary').click()
 pass('Existing allowance is accessible below the goal; agreement remains 100 DKK')
 pass('Child selects own goal using keyboard; existing balance stays 14')

 for(const width of [375,390,430]){await page.setViewportSize({width,height:844});await shoot('mobile-'+width,'Opgaver · personmål · '+width+' px');await expect(panel(ida).locator('[data-star-choose]')).toBeInViewport()}
 pass('375 / 390 / 430: no horizontal overflow and goal action reachable')
 await panel(ida).locator('[data-star-choose]').click();await page.locator('[data-star-reward="'+cafe+'"] [data-reward-action=goal]').click();await expect(panel(ida)).toContainText('Cafétur');expect(await balance(ida)).toBe(14)
 await panel(ida).locator('[data-star-choose]').click();await page.locator('[data-star-reward="'+cinema+'"] [data-reward-action=goal]').click()
 await page.locator('[data-person-filter="Alle"]').click();await expect(panel(ida).locator('[data-star-choose]')).toHaveCount(1)
 await expect(panel(carl).locator('[data-star-choose],[data-reward-redeem]')).toHaveCount(0);await expect(panel(jakob).locator('[data-star-choose]')).toHaveCount(0)
 await expect(page.locator('[data-star-admin],[data-reward-catalog],[data-star-link],[data-reward-action=redemption_approve]')).toHaveCount(0)
 // Existing Tasks routing pins linked child accounts to their own person.
 await expect(panel(carl)).toHaveCount(0);await expect(panel(ida)).toBeVisible()
 pass('Child login: own actions only; no catalog, prices, linking or approval controls')
 await switchUser(ids.adult);await routeTo(page,'tasks');await page.setViewportSize({width:375,height:844});await page.locator('[data-person-filter="Alle"]').click()
 await panel(carl).scrollIntoViewIfNeeded();await shoot('08-mobile-all','375 px · Alle · kompakte mål for de tre børn');await page.setViewportSize({width:1440,height:1000})
 await expect(page.locator('.star-goals [data-star-person]')).toHaveCount(3)
 for(const pid of [carl,ida,jakob])await expect(panel(pid).locator('[data-star-choose]')).toBeEnabled()
 await shoot('01-all-goals','Opgaver · Alle · tre personlige mål, Biograftur og Cafétur')
 await choosePerson(ida);await shoot('09-desktop','Desktop · Idas mål før dagens opgaver')
 pass('Adult: all three child goals visible without opening rewards; person goal first')

 // Earn the last two stars through the actual UI, including existing motion.
 await earn(ida,9);const bonus=await task(ida,2)
 await switchUser(ids.child);await routeTo(page,'tasks');await page.setViewportSize({width:390,height:844})
 await page.evaluate(()=>{window.rewardEvents=[];document.addEventListener('reward-motion',e=>window.rewardEvents.push(e.detail))})
 await page.locator('[data-reward-task="'+bonus.item_id+'"] [data-reward-action=complete]').click()
 await expect(page.locator('.reward-delta').filter({hasText:'+2 ⭐'})).toBeVisible()
 await expect.poll(()=>balance(ida)).toBe(25);await expect(panel(ida).locator('progress')).toHaveJSProperty('value',25)
 await expect(panel(ida)).toContainText('Du har nok stjerner til Biograftur');await expect(panel(ida).locator('[data-reward-redeem]')).toBeEnabled()
 expect(await page.evaluate(()=>window.rewardEvents.some(e=>e.kind==='goal'&&e.unlocked))).toBe(true)
 await panel(ida).evaluate(el=>el.scrollIntoView({block:'center'}));await shoot('04-goal-reached','Målet nået · 25 / 25 · indløs belønning')
 pass('Actual task completion: +2 stars, progress updates, calm goal-reached feedback')
 await panel(ida).locator('[data-reward-redeem]').click()
 await expect(page.locator('.reward-modal')).toContainText('Vil du bruge 25 ⭐ på Biograftur?')
 await shoot('06-redemption','Indløsningsønske · voksen godkender før stjerner trækkes')
 await page.locator('[data-reward-action=redeem]').click();await expect(panel(ida)).toContainText('Afventer voksen');expect(await balance(ida)).toBe(25)
 await expect(page.locator('[data-reward-action=redemption_approve]')).toHaveCount(0)
 pass('Redemption: confirmation, pending request, no debit and no child self-approval')

 await switchUser(ids.adult);await page.setViewportSize({width:1440,height:1000});await admin()
 await page.locator('.star-admin-heading').scrollIntoViewIfNeeded();await shoot('07-adult-catalog','Voksen · katalog, egne belønninger og godkendelse')
 const request=(await state()).redemptions.find(r=>r.person_id===ida&&r.status==='pending')
 await page.locator('[data-reward-redemption="'+request.id+'"] [data-reward-action=redemption_approve]').first().click()
 await expect.poll(()=>balance(ida)).toBe(0)
 pass('Existing adult approval debits exactly 25, after the request')
 await page.locator('.star-admin-heading [data-reward-catalog=new]').click();await page.locator('[data-star-template="1"]').click()
 await expect(page.locator('#reward-title')).toHaveValue('Cafétur');await expect(page.locator('[name=star_cost]')).toHaveValue('20')
 await shoot('adult-template','Voksen · eksisterende inspiration, ingen dobbelt katalog');await page.keyboard.press('Escape')

 // Existing approval consumes the goal; the child can choose it again.
 await action('goal',{person_id:ida,reward_id:cinema},ids.child)
 await earn(ida,14);const reducedBonus=await task(ida,2)
 await switchUser(ids.child);await routeTo(page,'tasks');await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'})
 await page.locator('[data-reward-task="'+reducedBonus.item_id+'"] [data-reward-action=complete]').click()
 const delta=page.locator('.reward-delta').filter({hasText:'+2 ⭐'});await expect(delta).toBeVisible();await expect(delta).toHaveCSS('transform','none')
 await expect(panel(ida).locator('progress')).toHaveJSProperty('value',16);await expect(panel(ida)).toContainText('Du mangler 9')
 await panel(ida).scrollIntoViewIfNeeded();await shoot('reduced-motion','Reduceret bevægelse · samme feedback og korrekt saldo')
 pass('Reduced motion: visible +2 feedback, no transform, updated goal and balance')

 await switchUser(ids.adult);await page.setViewportSize({width:1920,height:1080})
 await page.evaluate(({uid,hid,api})=>localStorage.setItem('familiekalender.device.v1:'+api,JSON.stringify({kiosk:{userId:uid,householdId:hid}})),{uid:ids.adult,hid,api})
 await page.reload();await expect(page.locator('body')).toHaveAttribute('data-mode','kiosk');await routeTo(page,'today')
 await expect(page.locator('.star-goals-wall [data-star-person]')).toHaveCount(3)
 await expect(page.locator('.star-goals-wall button,.star-goals-wall a,.star-goals-wall input')).toHaveCount(0)
 for(const pid of [ida,carl,jakob])await expect(panel(pid)).toBeInViewport()
 await shoot('10-wall-goals','Wall · tre read-only mål · 1920 × 1080')
 await actor(null);await query('delete from public.reward_goals where person_id=$1',[jakob]);await page.reload();await routeTo(page,'today')
 await expect(panel(jakob)).toContainText('Intet mål valgt endnu');await expect(panel(jakob).locator('button')).toHaveCount(0)
 await page.setViewportSize({width:1280,height:800});await shoot('wall-no-goal','Wall · intet mål valgt · 1280 × 800')
 pass('Wall 1920 / 1280: same model, avatar, colour and progress; no actions or admin')
 expect(errors).toEqual([]);expect(unknown).toEqual([])
}catch(error){await shoot('failure','Fejl under browsercheck').catch(()=>{});console.error('PAGE ERRORS',errors,'UNKNOWN',unknown);throw error}
finally{
 writeFileSync(new URL('results.json',out),JSON.stringify({checks,errors,unknown,coverage:'Real UI + PostgreSQL functions; isolated fixture HTTP/Auth. No production writes.'},null,2))
 writeFileSync(new URL('review.html',out),'<!doctype html><html lang="da"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Familiekalender · Stjernemål</title><style>body{margin:0;background:#f4f5ee;color:#304738;font:16px system-ui}main{max-width:1500px;margin:auto;padding:32px}h1{font-size:32px}p{max-width:900px;line-height:1.6}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:24px}figure{margin:0;background:white;padding:16px;border-radius:16px}figcaption{font-weight:650;margin-bottom:12px}img{display:block;width:100%;height:auto;border:1px solid #e4e8de;border-radius:8px}a{color:inherit}</style><main><h1>Stjernemål · Opgaver og wall</h1><p>Fælles målkort med personidentitet, saldo, fremdrift og relevante handlinger. Eksisterende belønningsmodel og godkendelsesflow. Alle viste personer og transaktioner er lokale testdata. Production-data er kun læst og kontrolleret separat.</p><p>'+checks.length+' browserchecks bestået. '+errors.length+' sidefejl.</p><div class="grid">'+shots.map(s=>'<figure><figcaption>'+s.label+'</figcaption><a href="'+s.name+'.png"><img src="'+s.name+'.png" loading="lazy"></a></figure>').join('')+'</div></main></html>')
 await browser.close();await server.close();await db.close()
}
