import test from 'node:test'
import assert from 'node:assert/strict'
import { selectPeople, itemPeople, itemPersonIds, itemMatchesPerson, feedPerson } from '../src/lib/people.js'
import { calendarPayload } from '../src/lib/calendar.js'
import { avatarDisplayUrl, validateAvatar, resolveAvatarUrls, savePerson, AVATAR_MAX_BYTES } from '../src/lib/avatars.js'
import { publicSupabaseConfig } from '../src/lib/config.js'
import { normalizeFeedUrl, redactFeedUrl, feedIdOf } from '../src/lib/feeds.js'
import { observeSession } from '../src/lib/auth.js'

const people = [{ id: 'id-a', name: 'New name', name_aliases: ['Old name'], color: '#123456' }, { id: 'id-b', name: 'Sibling', color: '#654321' }]
test('stable person IDs preserve rename, filter, colors and multi-person selection', () => {
  const item = { person_ids: ['id-a', 'id-b'], data: { people: ['Old name', 'Sibling'] } }
  assert.deepEqual(itemPeople(item, people), ['New name', 'Sibling'])
  assert(itemMatchesPerson(item, 'id-a', people))
  assert.deepEqual(itemPersonIds(item, people), ['id-a', 'id-b'])
  assert.equal(feedPerson({ assigned_person_id: 'id-a', assigned_person_name: 'Old name' }, people).color, '#123456')
})
test('legacy names and unresolved names survive gradual migration', () => {
  assert.deepEqual(selectPeople(['Old name', 'Unknown'], people), { personIds: ['id-a'], people: ['New name', 'Unknown'], unresolvedPeople: ['Unknown'] })
  assert.deepEqual(itemPeople({ person: 'Old name' }, people), ['New name'])
  assert.equal(feedPerson({ assigned_person_name: 'Old name' }, people).id, 'id-a')
})
test('duplicate names are never silently assigned to the wrong person', () => {
  const duplicates = [{ id: '1', name: 'Same' }, { id: '2', name: 'Same' }]
  assert.deepEqual(selectPeople(['Same'], duplicates).personIds, [])
  assert.deepEqual(selectPeople(['2'], duplicates).personIds, ['2'])
})
test('calendar adapter preserves repeat JSON and detaches imported manual edits', () => {
  const result = calendarPayload({ title: 'Edit', people: ['id-a', 'id-b'], done: true }, people, { source: 'aula', external_id: 'external', data: { repeatWeekly: true, exceptions: ['2026-01-01'], feedId: 'feed' } })
  assert.equal(result.detached_from_feed, true)
  assert.equal(result.data.detachedFromFeed, true)
  assert.deepEqual(result.person_ids, ['id-a', 'id-b'])
  assert.deepEqual(result.data.exceptions, ['2026-01-01'])
  assert.equal(result.data.feedId, 'feed')
})
test('DataURL avatar fallback and private signed URLs remain displayable', async () => {
  const fallback = 'data:image/png;base64,AA=='
  assert.equal(avatarDisplayUrl({ avatar_url: fallback }), fallback)
  assert.equal(avatarDisplayUrl({ avatar_url: 'javascript:alert(1)' }), '')
  const rows = [{ id: '1', avatar_path: 'h/p/a.png', avatar_url: fallback }]
  const failed = { storage: { from: () => ({ createSignedUrls: async () => ({ error: true }) }) } }
  assert.equal(avatarDisplayUrl((await resolveAvatarUrls(failed, rows))[0]), fallback)
})
test('avatars enforce file format and size before upload', () => {
  assert.throws(() => validateAvatar({ type: 'image/svg+xml', size: 10 }))
  assert.throws(() => validateAvatar({ type: 'image/png', size: AVATAR_MAX_BYTES + 1 }))
  assert.doesNotThrow(() => validateAvatar({ type: 'image/webp', size: 128 }))
})
test('avatar upload failure preserves existing person and database errors clean only new object', async () => {
  const operations = []
  const bucket = { upload: async path => { operations.push(['upload', path]); return {} }, remove: async paths => { operations.push(['remove', ...paths]); return {} } }
  const client = { storage: { from: () => bucket }, from: () => ({ update: values => { operations.push(['update', values]); return { eq: () => ({ eq: async () => ({ error: new Error('DB unavailable') }) }) } } }) }
  const result = await savePerson(client, 'household', { name: 'Changed' }, { existing: { id: 'person', avatar_url: 'data:image/png;base64,AA==' }, file: { type: 'image/png', size: 10 } })
  assert(result.error)
  assert.equal(operations[0][1], operations[2][1])
  assert.equal(operations[1][1].avatar_url, null)
  assert.match(operations[1][1].avatar_path, /^household\/person\//)
})
test('frontend rejects service keys and supports publishable/anon keys', () => {
  const env = { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_EXAMPLE' }
  assert.equal(publicSupabaseConfig(env).url, env.VITE_SUPABASE_URL)
  assert.throws(() => publicSupabaseConfig({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_TEST' }))
  const token = role => ['header', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'signature'].join('.')
  assert.equal(publicSupabaseConfig({ VITE_SUPABASE_URL: env.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: token('anon') }).key, token('anon'))
  assert.throws(() => publicSupabaseConfig({ VITE_SUPABASE_URL: env.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: token('service_role') }))
})
test('feed URLs mask credentials and retain legacy import field aliases', () => {
  assert.equal(normalizeFeedUrl('webcal://example.com/calendar'), 'https://example.com/calendar')
  assert.throws(() => normalizeFeedUrl('http://example.com/calendar'))
  assert.throws(() => normalizeFeedUrl('https://user:pass@example.com'))
  assert.equal(redactFeedUrl('https://example.com/private-path?feed=TEST'), 'example.com/…')
  assert.equal(feedIdOf({ data: { feedId: 'feed-id' } }), 'feed-id')
})
test('session listener defers work outside auth lock and ignores stale initial session', async () => {
  const jobs = [], delivered = []
  let callback, resolveInitial, unsubscribed = false
  const client = { auth: {
    onAuthStateChange: cb => { callback = cb; return { data: { subscription: { unsubscribe() { unsubscribed = true } } } } },
    getSession: () => new Promise(resolve => { resolveInitial = resolve }),
  } }
  const close = observeSession(client, (session, event) => delivered.push([session, event]), error => { throw error }, job => jobs.push(job))
  callback('SIGNED_OUT', null)
  assert.deepEqual(delivered, [])
  resolveInitial({ data: { session: { user: { id: 'old-user' } } } })
  await Promise.resolve()
  jobs.forEach(job => job())
  assert.deepEqual(delivered, [[null, 'SIGNED_OUT']])
  close()
  assert(unsubscribed)
})

test('calendar pagination preserves records beyond the API row cap and rejects partial results', async () => {
  const { readAllRows } = await import('../src/lib/rows.js')
  const source = Array.from({ length: 1203 }, (_, id) => ({ id }))
  const ranges = []
  const query = () => ({ range: async (start, end) => { ranges.push([start, end]); return { data: source.slice(start, end + 1) } } })
  const result = await readAllRows(query)
  assert.equal(result.data.length, 1203)
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]])
  const failed = await readAllRows(() => ({ range: async start => start ? { error: 'network failure' } : { data: source.slice(0, 500) } }))
  assert.equal(failed.error, 'network failure')
  assert.equal(failed.data, null)
  assert.equal((await readAllRows(query, () => false)).stale, true)
})
