import {chromium,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {localSupabase} from '../../scripts/local-supabase.mjs';
import {openCreate,openSettings,routeTo} from './browser-actions.mjs';
const local=localSupabase();if(local.API_URL!=='http://127.0.0.1:45321')throw Error('Fresh release stack required');
const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),out=new URL('../../supabase/.temp/release-1.0/',import.meta.url),root='http://127.0.0.1:5198';
mkdirSync(out,{recursive:true});const users=[],households=[],checks=[],errors=[],contexts=[];
const must=async p=>{const r=await p;if(r.error)throw Error(r.error.message);return r.data},pass=x=>{checks.push(x);console.log('PASS',x)};
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=async()=>{const c=await browser.newContext({viewport:{width:390,height:844},locale:'da-DK',timezoneId:'Europe/Copenhagen',acceptDownloads:true});contexts.push(c);await c.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());const p=await c.newPage();p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));return p};
const mail=async email=>{let m;await expect.poll(async()=>{const all=await(await fetch(local.MAILPIT_URL+'/api/v1/messages')).json();m=all.messages?.find(r=>r.To?.some(t=>t.Address===email));return !!m},{timeout:20000}).toBe(true);const contents=await(await fetch(local.MAILPIT_URL+'/api/v1/message/'+m.ID)).json();return contents.HTML.match(/href="([^"]+)"/)[1].replaceAll('&amp;','&')};
const signup=async(p,email,password,path=root)=>{await p.goto(path);await p.locator('[data-auth-screen=signup]').click();await p.locator('#email').fill(email);await p.locator('#password').fill(password);const response=p.waitForResponse(r=>r.url().includes('/auth/v1/signup'));await p.locator('#login-form [type=submit]').click();const r=await(await response).json(),id=r.id||r.user?.id;expect(id).toBeTruthy();users.push(id);await p.goto(await mail(email));await expect.poll(async()=>!!(await must(admin.auth.admin.getUserById(id))).user.email_confirmed_at).toBe(true);return id};
const clientFor=async p=>{const session=await p.evaluate(()=>JSON.parse(localStorage.getItem('sb-127-auth-token')));expect(session?.access_token).toBeTruthy();const c=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});await must(c.auth.setSession(session));return c};
let owner;
try{
 owner=await page();const email='release-new-'+randomUUID()+'@example.test',password=randomUUID()+'Aa!1';
 const uid=await signup(owner,email,password);await expect(owner.locator('#household-form')).toBeVisible();pass('Fresh signup and actual Mailpit confirmation link create a verified session');
 await owner.locator('#household-name').fill('Release synthetic family');await owner.locator('#household-form [type=submit]').click();await expect(owner.locator('.product-nav')).toBeVisible();
 const hid=(await must(admin.from('households').select('id').eq('created_by',uid).single())).id;households.push(hid);pass('Fresh household created through UI');
 await openSettings(owner);await owner.locator('#person-name').fill('Synthetic child');await owner.locator('#people-settings-form [type=submit]').click();
 await expect.poll(async()=>(await must(admin.from('household_people').select('id').eq('household_id',hid))).length).toBe(1);
 const person=(await must(admin.from('household_people').select('id').eq('household_id',hid).single())).id;
 await owner.keyboard.press('Escape');await routeTo(owner,'calendar');await openCreate(owner);await owner.locator('#calendar-title').fill('First family activity');await owner.locator('[name=people][value="'+person+'"]').check();await owner.locator('#calendar-modal-form [type=submit]').click();
 await expect.poll(async()=>(await must(admin.from('calendar_items').select('id').eq('household_id',hid).eq('title','First family activity'))).length).toBe(1);pass('First person and calendar activity saved through UI');
 await openCreate(owner,'Opgave');await owner.locator('#calendar-title').fill('First person task');await owner.locator('[name=people][value="'+person+'"]').check();await owner.locator('#calendar-modal-form [type=submit]').click();
 let task;await expect.poll(async()=>{task=(await must(admin.from('calendar_items').select('id').eq('household_id',hid).eq('title','First person task')))[0];return !!task}).toBe(true);
 await routeTo(owner,'tasks');await owner.locator('[data-reward-task="'+task.id+'"] [data-reward-action=complete]').first().click();
 await expect.poll(async()=>(await must(admin.from('task_reward_occurrences').select('status').eq('task_id',task.id).eq('person_id',person)))[0]?.status).toBe('completed');pass('First task completes through current per-person RPC');
 const client=await clientFor(owner);const invitedEmail='release-invite-'+randomUUID()+'@example.test';await openSettings(owner,'family');await owner.locator('#invite-email').fill(invitedEmail);await owner.locator('#invite-form [type=submit]').click();
 const link=owner.locator('#invite-result input');await expect(link).toBeVisible();const inviteUrl=await link.inputValue();const invited=await page();await signup(invited,invitedEmail,randomUUID()+'Aa!1',inviteUrl);await expect(invited.locator('#accept-invite')).toBeVisible();await invited.locator('#accept-invite').click();await expect(invited.locator('.product-nav')).toBeVisible();
 expect((await must(admin.from('household_members').select('user_id').eq('household_id',hid))).length).toBe(2);pass('Email-bound invitation survives signup/confirmation and joins correct family');
 const wall=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const anonymous=(await must(wall.auth.signInAnonymously())).user;users.push(anonymous.id);const pairing=await must(client.rpc('create_wall_pairing',{p_household_id:hid}));await must(wall.rpc('redeem_wall_pairing',{p_code:pairing.token,p_platform:'web'}));const view=await must(wall.rpc('wall_snapshot'));expect(view.household.id).toBe(hid);expect(view.items.some(i=>i.title==='First family activity')).toBe(true);pass('Fresh family pairs an isolated anonymous wall; snapshot shows only own activity');
 await owner.keyboard.press('Escape');await openSettings(owner,'account');const download=owner.waitForEvent('download');await owner.locator('#export-family').click();const file=await download,json=JSON.parse(readFileSync(await file.path(),'utf8'));expect(json.household.id).toBe(hid);expect(JSON.stringify(json)).not.toContain('refresh_token');pass('Account export downloads own family data without session credentials');
 await owner.screenshot({path:new URL('fresh-account.png',out).pathname.replace(/^\/([A-Z]:)/,'$1')});
 await owner.locator('#account-logout').click();await owner.locator('[data-auth-screen=reset]').click();await owner.locator('#email').fill(email);await owner.locator('#reset-form [type=submit]').click();await expect(owner.locator('#message')).toContainText('sendt');await owner.goto(await mail(email));await expect(owner.locator('#recovery-form')).toBeVisible();const changed=randomUUID()+'Bb!2';await owner.locator('#new-password').fill(changed);await owner.locator('#repeat-password').fill(changed);await owner.locator('#recovery-form [type=submit]').click();await expect(owner.locator('.product-nav')).toBeVisible();pass('Actual recovery email updates password and restores app session');
 await openSettings(owner,'account');await owner.locator('#start-delete-account').click();await owner.locator('#delete-password').fill(changed);await owner.locator('#delete-confirmation').fill('SLET MIN KONTO');await owner.locator('[name=delete-household]').check();await owner.locator('#delete-account-form [type=submit]').click();await expect(owner.locator('#login-form')).toBeVisible();expect((await admin.auth.admin.getUserById(uid)).error).toBeTruthy();expect((await must(admin.from('households').select('id').eq('id',hid))).length).toBe(0);pass('Explicit last-owner account deletion removes fresh family and login');
 expect(errors).toEqual([]);console.log('NEW USER ACCEPTANCE PASS',checks.length);
}catch(e){if(owner)await owner.screenshot({path:new URL('fresh-account-failure.png',out).pathname.replace(/^\/([A-Z]:)/,'$1')}).catch(()=>{});throw e}
finally{
 for(const hid of households)await must(admin.from('households').delete().eq('id',hid));
 for(const id of users){const r=await admin.auth.admin.deleteUser(id);if(r.error&&!/not found/i.test(r.error.message))throw r.error;}
 writeFileSync(new URL('new-user-results.json',out),JSON.stringify({checks,errors,scope:'local real Auth/PostgREST/Edge; Mailpit delivery only; synthetic accounts removed'},null,2));
 for(const c of contexts)await c.close();await browser.close();
}
