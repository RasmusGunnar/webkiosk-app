import {t,dateFormatter} from '../i18n/index.js'
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
  if (!date) throw new Error((t("calendar_dates.invalid_date")))
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
  if (mode==='day') return dateFormatter({weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(parseDate(value))
  const dates=weekDates(value), start=parseDate(dates[0]), end=parseDate(dates[6]), {week}=isoWeek(value)
  const range=dateFormatter({day:'numeric',month:'long',...(start.getFullYear()!==end.getFullYear()?{year:'numeric'}:{})}).formatRange(start,end)
  return t(dates.includes(today)?'calendar.current_week':'calendar.week',{week})+' · '+range
}
export const VIEW_KEY='familiekalender.calendar-view'
export function preferredView(storage, width) {
  try { const saved=storage.getItem(VIEW_KEY); if (['day','week'].includes(saved)) return saved } catch {}
  return width<700?'day':'week'
}

export function monthDates(value) {
  const date=parseDate(value)
  if(!date)throw new Error((t("calendar_dates.invalid_date")))
  const year=date.getFullYear(),month=date.getMonth(),count=new Date(year,month+1,0,12).getDate()
  return Array.from({length:count},(_,i)=>dateIso(new Date(year,month,i+1,12)))
}
