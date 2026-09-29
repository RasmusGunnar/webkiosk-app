import { calendarOnly } from './household-plans.js'
import { addDays, dateIso, parseDate } from './calendar-dates.js'
import { materialize, value } from './calendar-semantics.js'
import { itemMatchesPerson } from './people.js'
export function upcomingItems(rows,people,filter='Alle',now=new Date()){
 rows=calendarOnly(rows)
 const today=dateIso(now),year=now.getFullYear()
 const dates=new Set(Array.from({length:36},(_,i)=>addDays(today,i)))
 for(const row of rows){
  const date=value(row,'date');if(typeof date!=='string'||!parseDate(date))continue
  if(date>=today)dates.add(date)
  if(value(row,'type')==='Fødselsdag')for(const y of [year,year+1]){let d=y+'-'+date.slice(5);if(!parseDate(d)&&d.endsWith('02-29'))d=y+'-02-28';if(d>=today)dates.add(d)}
 }
 const time=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')
 return materialize(rows,[...dates].sort(),{milestones:false}).filter(item=>item.type!=='Opgave'&&itemMatchesPerson(item,filter,people)&&
  (item.date>today||item.date===today&&item.time&&item.time>=time)).sort((a,b)=>a.date.localeCompare(b.date)||String(a.time||'').localeCompare(String(b.time||'')))
}
export const roleLabel=role=>({owner:'Ejer',admin:'Administrator',adult:'Voksen',child:'Barn'}[role]||role)
export function invitationStatus(invite,now=new Date()){return invite.revoked_at?'Tilbagekaldt':invite.accepted_at?'Accepteret':new Date(invite.expires_at)<=now?'Udløbet':'Afventer'}
export function callbackUrl(location){return new URL(location.pathname,location.origin).href}
export function consumeInvite(location,history,storage){
 const params=new URLSearchParams(location.hash.slice(1)),token=params.get('invite')
 if(token&&/^[0-9a-f-]{72}$/i.test(token)){storage.setItem('familiekalender.pending-invite',token);history.replaceState(null,'',location.pathname+location.search)}
 return storage.getItem('familiekalender.pending-invite')||''
}
