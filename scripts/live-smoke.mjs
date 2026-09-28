import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const require = createRequire(new URL('../app/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const { chromium, expect } = require('@playwright/test')
process.chdir(fileURLToPath(new URL('../', import.meta.url)))
const project = 'oyyqniwppytipdktzwsy'
if (!process.argv.includes('--allow-live-tests')) throw new Error('Requires explicit --allow-live-tests; creates and removes isolated test records.')
mkdirSync('supabase/.temp/live-release',{recursive:true})
const reportPath = 'supabase/.temp/live-release/'+(process.argv.includes('--browser')?'live-browser-smoke':'live-smoke')+'.json'
const report = { project, startedAt: new Date().toISOString(), checks: {}, import: null, cleanup: false }
const check = (name, condition) => { if (!condition) throw new Error('FAIL: ' + name); report.checks[name] = 'PASS'; console.log('PASS: ' + name) }
const unwrap = result => { if (result.error) throw new Error('Supabase request failed: ' + result.error.message); return result.data }
const raw = spawnSync('cmd.exe', ['/d', '/s', '/c', 'npx.cmd --yes supabase@2.118.0 projects api-keys --project-ref ' + project + ' --reveal --output json'], { encoding:'utf8', stdio:['ignore','pipe','pipe'], windowsHide:true })
if (raw.status) throw new Error('Cannot load keys for authorized live acceptance')
const keys = JSON.parse(raw.stdout)
const secret = keys.find(k => k.name === 'service_role').api_key
const publicKey = keys.find(k => k.name === 'anon').api_key
const url = 'https://' + project + '.supabase.co'
const admin = createClient(url, secret, { auth: {persistSession:false, autoRefreshToken:false} })
const owner = createClient(url, publicKey, { auth: {persistSession:false, autoRefreshToken:false} })
const outsider = createClient(url, publicKey, { auth: {persistSession:false, autoRefreshToken:false} })
const temporaryItems = [], temporaryFeeds = [], temporaryObjects = []
let testUserId, testHouseholdId, browser, session
try {
  const households = unwrap(await admin.from('households').select('id,created_by').order('created_at').order('id'))
  const household = households[0]
  const users = unwrap(await admin.auth.admin.getUserById(household.created_by))
  // User-authorized existing-account test: generate a one-time session without sending mail or changing a password.
  const link = unwrap(await admin.auth.admin.generateLink({type:'magiclink',email:users.user.email}))
  session = unwrap(await owner.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'magiclink'})).session
  check('existing_user_login', session?.user.id === household.created_by)
  check('household_load', unwrap(await owner.from('households').select('id')).length === households.length)
  const people = unwrap(await owner.from('household_people').select('*').eq('household_id',household.id))
  const before = unwrap(await owner.from('calendar_items').select('id').eq('household_id',household.id).limit(1000))
  check('existing_people_load', people.length >= 2)
  check('existing_calendar_load', before.length > 0)
  const title = 'Release smoke ' + randomUUID()
  const testId = randomUUID(); temporaryItems.push(testId)
  const date = new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Copenhagen'})
  unwrap(await owner.from('calendar_items').insert({id:testId,household_id:household.id,title,date,person_ids:people.slice(0,2).map(p=>p.id),type:'Aktivitet',data:{people:people.slice(0,2).map(p=>p.name)},created_by:session.user.id}))
  check('calendar_create', unwrap(await owner.from('calendar_items').select('id').eq('id',testId)).length === 1)
  unwrap(await owner.from('calendar_items').update({title:title+' updated'}).eq('id',testId))
  const changed = unwrap(await owner.from('calendar_items').select('*').eq('id',testId).single())
  check('calendar_edit', changed.title === title+' updated')
  check('multi_person', changed.person_ids.length === 2 && changed.data.personIds.length === 2)
  const email = 'release-' + randomUUID() + '@example.invalid', password = randomUUID() + '!Aa9'
  testUserId = unwrap(await admin.auth.admin.createUser({email,password,email_confirm:true})).user.id
  unwrap(await outsider.auth.signInWithPassword({email,password}))
  check('password_login', !!unwrap(await outsider.auth.getUser()).user)
  testHouseholdId = unwrap(await outsider.rpc('create_household',{p_name:'Isolated release smoke'}))
  check('cross_household_rls',
    unwrap(await outsider.from('calendar_items').select('id').eq('household_id',household.id)).length === 0 &&
    unwrap(await outsider.from('household_people').select('id').eq('household_id',household.id)).length === 0 &&
    unwrap(await owner.from('households').select('id').eq('id',testHouseholdId)).length === 0)
  const inactive = unwrap(await owner.from('calendar_feeds').insert({household_id:household.id,name:'Release inactive smoke',source:'ics',feed_url:'https://calendar.google.com/calendar/ical/release-test/basic.ics',is_active:false}).select('id').single())
  temporaryFeeds.push(inactive.id)
  const invoke = (body, token=session.access_token) => fetch(url+'/functions/v1/import-calendar-feed',{method:'POST',headers:{apikey:publicKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)})
  const denied = await invoke({feedId:inactive.id})
  check('inactive_feed_rejected', denied.status === 409 && (await denied.json()).error === 'Feed inactive')
  const unauthenticated = await fetch(url+'/functions/v1/import-calendar-feed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({feedId:inactive.id})})
  check('edge_authentication', unauthenticated.status === 401)
  unwrap(await owner.from('calendar_feeds').update({is_active:true,feed_url:'https://blocked.invalid/release-test.ics'}).eq('id',inactive.id))
  const rejectedUrl = await invoke({feedId:inactive.id,preserveExisting:true})
  const rejectedBody = await rejectedUrl.json()
  const failedStatus = unwrap(await owner.from('calendar_feeds').select('last_sync_status,last_sync_message').eq('id',inactive.id).single())
  check('error_status_persistence',!rejectedUrl.ok && rejectedBody.error==='URL_NOT_ALLOWED' && failedStatus.last_sync_status==='error' && failedStatus.last_sync_message==='URL_NOT_ALLOWED')
  const avatarPath = household.id+'/'+people[0].id+'/'+randomUUID()+'.png'
  temporaryObjects.push(avatarPath)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64')
  unwrap(await owner.storage.from('household-avatars').upload(avatarPath,png,{contentType:'image/png'}))
  check('private_avatar_storage',!!unwrap(await owner.storage.from('household-avatars').createSignedUrl(avatarPath,60)).signedUrl && !!(await outsider.storage.from('household-avatars').download(avatarPath)).error)
  const feeds = unwrap(await owner.from('calendar_feeds').select('id,source').eq('household_id',household.id).eq('is_active',true))
  if (process.argv.includes('--import-existing')) {
  let imported = false
  for(const feed of feeds.sort((a,b)=>Number(b.source==='aula')-Number(a.source==='aula'))) {
    const response=await invoke({feedId:feed.id,preserveExisting:true}), result=await response.json()
    if(response.ok && result.success) {
      report.import={source:feed.source,...result}
      const status=unwrap(await owner.from('calendar_feeds').select('last_sync_status,last_sync_at').eq('id',feed.id).single())
      check('feed_import', result.deletedCount===0 && status.last_sync_status==='success' && !!status.last_sync_at)
      imported=true; break
    }
    console.log('Feed attempt status: '+response.status+' '+String(result.error||'IMPORT_FAILED'))
  }
  check('existing_feed_import_succeeded',imported)
  }
  const after=unwrap(await owner.from('calendar_items').select('id').eq('household_id',household.id).limit(1000))
  const afterIds=new Set(after.map(r=>r.id))
  check('existing_calendar_ids_preserved',before.every(row=>afterIds.has(row.id)))
  if(process.argv.includes('--browser')) {
    browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
    const page=await browser.newPage(), errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    const appUrl=process.env.RELEASE_APP_URL || 'http://127.0.0.1:5179'
    await page.goto(appUrl)
    await page.evaluate(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:'sb-'+project+'-auth-token',session})
    await page.reload()
    await expect(page.locator('#settings-button')).toBeVisible()
    await expect(page.locator('.person-chip')).toHaveCount(people.filter(p=>p.is_active).length+1)
    await expect(page.getByText(title+' updated',{exact:true})).toBeVisible()
    check('browser_live_calendar_and_people',true)
    const avatarImages=page.locator('.person-chip-avatar img')
    const avatarCount=await avatarImages.count()
    if(people.some(p=>p.avatar_url||p.avatar_path)) {
      check('avatars_display',avatarCount>0 && await avatarImages.evaluateAll(imgs=>imgs.every(img=>img.complete&&img.naturalWidth>0)))
    } else check('avatars_display',await page.locator('.person-chip-avatar').count()>0)
    check('person_colors',await page.locator('.person-chip').nth(1).evaluate(el=>!!el.style.borderColor))
    await page.reload()
    await expect(page.locator('#settings-button')).toBeVisible()
    await expect(page.getByText(title+' updated',{exact:true})).toBeVisible()
    check('reload_session_persistence',true)
    await page.locator('#logout-button').click()
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(password)
    await page.getByRole('button',{name:'Log ind',exact:true}).click()
    await expect(page.locator('#settings-button')).toBeVisible()
    await page.reload()
    await expect(page.locator('#settings-button')).toBeVisible()
    check('browser_password_login_persistence',true)
    await page.locator('#logout-button').click()
    await expect(page.locator('#email')).toBeVisible()
    check('browser_no_javascript_errors',errors.length===0)
  }
  unwrap(await owner.from('calendar_items').delete().eq('id',testId))
  check('calendar_delete',unwrap(await owner.from('calendar_items').select('id').eq('id',testId)).length===0)
} catch(error) {
  report.error=error.message
  process.exitCode=1
  console.error(error.message)
} finally {
  await browser?.close()
  try {
    if(temporaryObjects.length) unwrap(await admin.storage.from('household-avatars').remove(temporaryObjects))
    for(const id of temporaryItems) unwrap(await admin.from('calendar_items').delete().eq('id',id))
    for(const id of temporaryFeeds) unwrap(await admin.from('calendar_feeds').delete().eq('id',id))
    if(testHouseholdId) unwrap(await admin.from('households').delete().eq('id',testHouseholdId))
    if(testUserId) unwrap(await admin.auth.admin.deleteUser(testUserId))
    await owner.auth.signOut({scope:'local'})
    await outsider.auth.signOut({scope:'local'})
    report.cleanup=true
  } catch(error) {report.cleanupError=error.message;process.exitCode=1;console.error('Temporary test cleanup failed')}
  report.finishedAt=new Date().toISOString()
  writeFileSync(reportPath,JSON.stringify(report,null,2))
  console.log('Live test report saved; temporary data cleanup: '+report.cleanup)
}
