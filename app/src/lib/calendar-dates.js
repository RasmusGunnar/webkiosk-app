// Calendar dates are local civil dates, never UTC timestamps (including DST boundaries).
export function dateIso(date) {
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-')
}
export function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null
  const [y,m,d] = value.split('-').map(Number), date = new Date(y,m-1,d,12)
  return dateIso(date) === value ? date : null
}
export function addDays(value, amount) {
  const date = parseDate(value)
  if (!date) throw new Error('Ugyldig dato')
  date.setDate(date.getDate()+amount)
  return dateIso(date)
}
export function weekDates(value) {
  const date = parseDate(value)
  const monday = addDays(value, -((date.getDay()+6)%7))
  return Array.from({length:7},(_,i)=>addDays(monday,i))
}
export function isoWeek(value) {
  const date = parseDate(value), utc = new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()))
  utc.setUTCDate(utc.getUTCDate()+4-(utc.getUTCDay()||7))
  return { year:utc.getUTCFullYear(), week:Math.ceil((((utc-new Date(Date.UTC(utc.getUTCFullYear(),0,1)))/86400000)+1)/7) }
}
export function calendarHeading(value, mode, today=dateIso(new Date())) {
  if (mode==='day') return new Intl.DateTimeFormat('da-DK',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(parseDate(value))
  const dates=weekDates(value), start=parseDate(dates[0]), end=parseDate(dates[6]), {week}=isoWeek(value)
  const month=date=>new Intl.DateTimeFormat('da-DK',{month:'long'}).format(date)
  const range = start.getFullYear()!==end.getFullYear()
    ? start.getDate()+'. '+month(start)+' '+start.getFullYear()+' – '+end.getDate()+'. '+month(end)+' '+end.getFullYear()
    : start.getMonth()===end.getMonth() ? start.getDate()+'.–'+end.getDate()+'. '+month(end)
    : start.getDate()+'. '+month(start)+' – '+end.getDate()+'. '+month(end)
  return (dates.includes(today) ? 'Denne uge · uge ' : 'Uge ')+week+' · '+range
}
export const VIEW_KEY='familiekalender.calendar-view'
export function preferredView(storage, width) {
  try { const saved=storage.getItem(VIEW_KEY); if (['day','week'].includes(saved)) return saved } catch {}
  return width<700?'day':'week'
}
