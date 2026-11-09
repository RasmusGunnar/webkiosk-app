// Learn a per-child weekly baseline in memory. No timetable or raw source persistence.
type Row=Record<string,any>;
const norm=(v:unknown)=>String(v??'').normalize('NFKC').toLocaleLowerCase('da').replace(/\s+/g,' ').trim();
const wall=(v:string)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen',dateStyle:'short',timeStyle:'short'}).format(new Date(v));
const exception=/\b(tur|udflugt|lejrskole|temadag|motionsdag|skolefest|porteføljesamtale|forældremøde|fotografering|studiedag|fridag|ferie|aflyst|aflysning|ændret|flyttet|gummistøvler|medbring|husk)\b|skole.hjem.samtale|tidli[gkt]+ fri|slutter.*kl\./iu;
export function calendarPrefilter(rows:Row[],now:Date){
 const today=wall(now.toISOString()).slice(0,10);
 const prepared=rows.filter(e=>Number.isFinite(Date.parse(e.startDateTime))&&Number.isFinite(Date.parse(e.endDateTime))).map(e=>{
  const start=wall(e.startDateTime),end=wall(e.endDateTime),date=start.slice(0,10);
  const weekday=new Date(date+'T12:00:00Z').getUTCDay(),people=(e.belongsToProfiles??[]).map(String).sort().join(',');
  return {e,date,group:`${people}|${norm(e.title)}|${weekday}`,slot:`${start.slice(11)}|${Date.parse(e.endDateTime)-Date.parse(e.startDateTime)}`,location:norm(e.primaryResource?.name??e.location?.name??e.location),end};
 });
 const groups=new Map<string,typeof prepared>();for(const p of prepared){const a=groups.get(p.group)??[];a.push(p);groups.set(p.group,a);}
 const candidates:Row[]=[];let raw=0,routine=0,changed=0;
 for(const p of prepared){if(p.date<today)continue;raw++;
  const {e}=p,peers=groups.get(p.group)!,past=peers.filter(q=>q.date<today),dates=new Set(past.map(q=>q.date));
  const status=norm(e.lesson?.lessonStatus),note=String(e.description??e.lesson?.noteToClass??'');
  const locationPeers=past.filter(q=>q.slot===p.slot&&q.location);
  const commonLocation=[...new Set(locationPeers.map(q=>q.location))].find(l=>locationPeers.filter(q=>q.location===l).length>=2);
  const changedLocation=Boolean(commonLocation&&p.location&&p.location!==commonLocation);
  const commonSlots=[...new Set(past.map(q=>q.slot))].filter(s=>past.filter(q=>q.slot===s).length>=2);
  const changedTime=dates.size>=2&&commonSlots.length>0&&!commonSlots.includes(p.slot);
  const cancelled=['cancelled','to_be_deleted'].includes(status)||e.isCancelled===true;
  const explicit=exception.test(String(e.title??'')+' '+note)||cancelled;
  const repeated=new Set(peers.filter(q=>q.slot===p.slot&&q.location===p.location).map(q=>q.date)).size>=3;
  const lesson=e.type==='lesson'||Boolean(e.lesson?.lessonId);
  if(!explicit&&!changedLocation&&!changedTime&&(lesson||repeated)){routine++;continue;}
  if(changedLocation||changedTime||cancelled)changed++;
  candidates.push({...e,description:[note,cancelled?'Undervisningen er aflyst.':'',changedLocation?'Afvigelse fra normal lokation.':'',changedTime?'Afvigelse fra normalt undervisningstidspunkt.':''].filter(Boolean).join('\n'),calendar_exception:true});
 }
 return {candidates,raw,routine,changed,baseline:prepared.filter(p=>p.date<today).length};
}
