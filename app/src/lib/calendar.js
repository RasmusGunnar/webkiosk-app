import { selectPeople } from './people.js'
export function calendarPayload(itemData, people, existing = null) {
  const selection = selectPeople(itemData.personIds?.length ? [...itemData.personIds, ...(itemData.unresolvedPeople || [])] : itemData.people || [itemData.person], people)
  const detached = Boolean(existing && (existing.source || existing.data?.source) && (existing.external_id || existing.data?.externalKey))
  const data = { ...(existing?.data || {}), ...itemData, ...selection, person: selection.people[0], ...(detached ? { detachedFromFeed: true } : {}) }
  return {
    title: itemData.title, date: itemData.date, time: itemData.time,
    person: data.person, person_ids: selection.personIds, type: itemData.type,
    note: itemData.note, done: Boolean(itemData.done),
    location: itemData.location || null, duration_min: itemData.durationMin ?? null,
    ...(detached ? { detached_from_feed: true } : {}), data,
  }
}
