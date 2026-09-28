const normalize = value => String(value || '').trim().toLocaleLowerCase('da')
export function findPerson(value, people) {
  const idMatch = people.find(person => person.id === value)
  if (idMatch) return idMatch
  const matches = people.filter(person => [person.name, ...(person.name_aliases || [])].some(name => normalize(name) === normalize(value)))
  return matches.length === 1 ? matches[0] : null
}
export function selectPeople(values, people) {
  const raw = Array.isArray(values) ? values : String(values || '').split(/[;,]/)
  if (!raw.length || raw.some(value => normalize(value) === 'alle')) return { personIds: [], people: ['Alle'], unresolvedPeople: [] }
  const ids = [], names = [], unresolved = []
  for (const value of raw) {
    if (!String(value || '').trim()) continue
    const person = findPerson(value, people)
    if (person) {
      if (!ids.includes(person.id)) { ids.push(person.id); names.push(person.name) }
    } else if (!unresolved.includes(value)) { unresolved.push(value); names.push(value) }
  }
  return { personIds: ids, people: names.length ? names : ['Alle'], unresolvedPeople: unresolved }
}
export function itemPersonIds(item, people) {
  const ids = item.person_ids?.length ? item.person_ids : item.data?.personIds || item.personIds || []
  if (ids.length) return [...new Set(ids)]
  return selectPeople(item.data?.people || item.people || item.person || item.data?.person || [], people).personIds
}
export function itemPeople(item, people) {
  const ids = item.person_ids?.length ? item.person_ids : item.data?.personIds || item.personIds || []
  if (ids.length) {
    const names = ids.map(id => people.find(person => person.id === id)?.name || 'Ukendt person')
    return [...names, ...(item.data?.unresolvedPeople || item.unresolvedPeople || [])]
  }
  return selectPeople(item.data?.people || item.people || item.person || item.data?.person || [], people).people
}
export function itemMatchesPerson(item, personId, people) {
  return personId === 'Alle' || itemPersonIds(item, people).includes(personId)
}
export function feedPerson(feed, people) {
  return findPerson(feed.assigned_person_id || feed.assigned_person_name, people)
}
