import { chromium, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { localSupabase } from '../../scripts/local-supabase.mjs'

process.chdir(fileURLToPath(new URL('../../', import.meta.url)))
const local = localSupabase() // Rejects every endpoint except our isolated localhost stack.
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const executablePath = process.env.TEST_BROWSER_PATH || (process.platform === 'win32' && existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined)
const browser = await chromium.launch({ executablePath, headless: true })
const email = 'foundation-' + randomUUID() + '@example.test'
const password = randomUUID() + '!Aa1'
let userId
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
  await page.goto('http://127.0.0.1:5178')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  const signup = page.waitForResponse(response => response.url().includes('/auth/v1/signup'))
  await page.getByRole('button', { name: 'Opret bruger', exact: true }).click()
  const signupBody = await (await signup).json()
  userId = signupBody.id || signupBody.user?.id
  expect(userId, 'Signup should create a user').toBeTruthy()
  await expect(page.locator('#message')).toContainText('Tjek din email')
  const confirmed = await admin.auth.admin.updateUserById(userId, { email_confirm: true })
  if (confirmed.error) throw confirmed.error
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Log ind', exact: true }).click()
  await page.locator('#household-name').fill('Foundation test family')
  await page.locator('#household-form button[type=submit]').click()
  await expect(page.locator('#settings-button')).toBeVisible()
  await page.waitForLoadState('networkidle')
  const household = await admin.from('households').select('id').eq('created_by', userId).single()
  if (household.error) throw household.error
  const hid = household.data.id
  await page.locator('#settings-button').click()
  await page.locator('#person-name').fill('Original name')
  await page.locator('#person-avatar-file').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png })
  await page.locator('#people-settings-form button[type=submit]').click()
  await expect(page.locator('.message').filter({ hasText: 'Personer gemt.' })).toBeVisible()
  await page.locator('#person-name').fill('Sibling')
  await page.locator('#people-settings-form button[type=submit]').click()
  await expect(page.locator('[data-person-row]')).toHaveCount(2)
  const rows = await admin.from('household_people').select('*').eq('household_id', hid).order('name')
  if (rows.error) throw rows.error
  const first = rows.data.find(row => row.name === 'Original name')
  const second = rows.data.find(row => row.name === 'Sibling')
  expect(first.avatar_path).toBeTruthy()
  expect(first.avatar_url).toBeNull()
  await page.locator('#settings-modal-close').click()
  await page.locator('#new-calendar-button').click()
  await page.locator('#calendar-title').fill('Foundation smoke event')
  await page.locator('#calendar-time').fill('10:00')
  await page.locator('input[name=people][value="' + first.id + '"]').check()
  await page.locator('input[name=people][value="' + second.id + '"]').check()
  await page.locator('#calendar-modal-form button[type=submit]').click()
  await expect(page.getByText('Foundation smoke event', { exact: true })).toBeVisible()
  const items = await admin.from('calendar_items').select('*').eq('household_id', hid)
  expect(items.data[0].person_ids.sort()).toEqual([first.id, second.id].sort())
  await page.locator('[data-person-filter="' + first.id + '"]').click()
  await page.locator('#settings-button').click()
  await page.locator('#person-' + first.id + '-name').fill('Renamed person')
  await page.locator('[data-save-person="' + first.id + '"]').click()
  await expect(page.locator('.message').filter({ hasText: 'Person gemt.' })).toBeVisible()
  await page.locator('#settings-modal-close').click()
  await expect(page.locator('[data-person-filter="' + first.id + '"]')).toHaveClass(/active/)
  await expect(page.locator('[data-person-filter="' + first.id + '"]')).toContainText('Renamed person')
  await expect(page.getByText('Foundation smoke event', { exact: true })).toBeVisible()
  expect(await page.locator('[data-person-filter="' + first.id + '"] img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true)
  await page.locator('#settings-button').click()
  await page.locator('#add-calendar-feed-button').click()
  await page.locator('#calendar-feed-source').selectOption('google')
  await page.locator('#calendar-feed-person').selectOption(first.id)
  await page.locator('#calendar-feed-url').fill('https://calendar.google.com/calendar/ical/TEST_ONLY/public/basic.ics')
  await page.locator('#calendar-feed-form input[name=is_active]').uncheck()
  await page.locator('#calendar-feed-form button[type=submit]').click()
  await expect(page.locator('[data-import-calendar-feed]')).toBeDisabled()
  await expect(page.locator('.calendar-feed-url')).toHaveText('calendar.google.com/…')
  const feeds = await admin.from('calendar_feeds').select('*').eq('household_id', hid)
  expect(feeds.data[0].assigned_person_id).toBe(first.id)
  await page.locator('#settings-modal-close').click()
  await page.reload()
  await expect(page.locator('#settings-button')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('#new-calendar-button')).toBeVisible()
  await page.locator('#logout-button').click()
  await expect(page.locator('#login-form')).toBeVisible()
  expect(await page.locator('[data-person-filter]').count()).toBe(0)
  expect(errors).toEqual([])
  console.log('PASS: browser signup/confirmation/login, household, person CRUD, avatar upload/display, multi-person calendar, rename/filter, feed ID/privacy, session persistence, mobile shell and logout')
} finally {
  await browser.close()
  if (userId) {
    const households = await admin.from('households').select('id').eq('created_by', userId)
    for (const household of households.data || []) {
      const people = await admin.from('household_people').select('avatar_path').eq('household_id', household.id)
      const paths = (people.data || []).map(person => person.avatar_path).filter(Boolean)
      if (paths.length) await admin.storage.from('household-avatars').remove(paths)
      await admin.from('households').delete().eq('id', household.id)
    }
    await admin.auth.admin.deleteUser(userId)
  }
}
