const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'})
const isoDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
export function copenhagenDate(at=new Date()){
 const parts=Object.fromEntries(dayFormatter.formatToParts(at).map(p=>[p.type,p.value]))
 return `${parts.year}-${parts.month}-${parts.day}`
}
// An unresolved start date stays in review, even if an end date was extracted.
export const findingExpiryDate=f=>isoDate(f.date)?(isoDate(f.end_date)?f.end_date:f.date):(f.lifecycle==='immediate'&&isoDate(f.expires_on)?f.expires_on:null)
export const isAulaFindingCurrent=(f,today=copenhagenDate())=>!findingExpiryDate(f)||findingExpiryDate(f)>=today
export const currentAulaFindings=(rows,today=copenhagenDate())=>(rows||[]).filter(f=>f.status==='new'&&isAulaFindingCurrent(f,today))
