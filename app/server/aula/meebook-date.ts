// Calendar dates only. No Date.parse on yearless provider display labels.
export function isoWeekDays(week:string):string[]{
 const match=/^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/.exec(week);if(!match)return [];
 const year=Number(match[1]),jan4=new Date(Date.UTC(year,0,4));
 const start=jan4.getTime()-(jan4.getUTCDay()||7)*864e5+864e5+(Number(match[2])-1)*7*864e5;
 if(new Date(start+3*864e5).getUTCFullYear()!==year)return [];
 return Array.from({length:7},(_,i)=>new Date(start+i*864e5).toISOString().slice(0,10));
}
export function resolvePlanDate(value:unknown,week:string):{date:string|null;order:'iso'|'day_month'|'month_day'|'named_month'|'same'|'unknown'}{
 const days=isoWeekDays(week);if(!days.length||typeof value!=='string')return {date:null,order:'unknown'};
 const label=value.trim();
 if(/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(label)){
  const explicit=label.slice(0,10);
  if(!Number.isFinite(Date.parse(explicit))||new Date(explicit).toISOString().slice(0,10)!==explicit)return {date:null,order:'unknown'};
  const date=/(Z|[+-]\d{2}:?\d{2})$/.test(label)?Number.isFinite(Date.parse(label))?new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen'}).format(new Date(label)):null:explicit;
  return {date:date&&days.includes(date)?date:null,order:'iso'};
 }
 const short=/^(\d{1,2})\s*[\/.-]\s*(\d{1,2})[\/.]?$/.exec(label);
 if(!short){
  // Recognized calendar words only; no permissive JS parsing of arbitrary text.
  const months=[['jan','januar','january'],['feb','februar','february'],['mar','marts','march'],['apr','april'],['maj','may'],['jun','juni','june'],['jul','juli','july'],['aug','august'],['sep','sept','september'],['okt','oktober','oct','october'],['nov','november'],['dec','december']];
  const weekdays=[['søn','søndag','sun','sunday'],['man','mandag','mon','monday'],['tir','tirsdag','tue','tuesday'],['ons','onsdag','wed','wednesday'],['tor','torsdag','thu','thursday'],['fre','fredag','fri','friday'],['lør','lørdag','sat','saturday']];
  const clean=label.toLowerCase().replace(/(\d+)(?:st|nd|rd|th)\b/g,'$1'),words=clean.match(/[a-zæøå]+/gu)??[],numbers=clean.match(/\d+/g)??[];
  if(numbers.some(n=>n.length>2)||/[^a-zæøå\d\s.,\/-]/u.test(clean))return {date:null,order:'unknown'};
  let month=-1,weekday=-1;for(const word of words){
   const m=months.findIndex(xs=>xs.includes(word)),w=weekdays.findIndex(xs=>xs.includes(word));
   if(m>=0){if(month>=0)return {date:null,order:'unknown'};month=m+1;}
   else if(w>=0){if(weekday>=0)return {date:null,order:'unknown'};weekday=w;}
   else if(!['d','den','the','of'].includes(word))return {date:null,order:'unknown'};
  }
  if(month>0&&numbers.length===1){const date=days.find(d=>Number(d.slice(5,7))===month&&Number(d.slice(8))===Number(numbers[0]));return {date:date&&(weekday<0||new Date(date+'T12:00:00Z').getUTCDay()===weekday)?date:null,order:'named_month'};}
  if(month<0&&weekday>=0&&numbers.length===2){const result=resolvePlanDate(numbers.join('/'),week);return result.date&&new Date(result.date+'T12:00:00Z').getUTCDay()===weekday?result:{date:null,order:'unknown'};}
  return {date:null,order:'unknown'};
 }
 const a=Number(short[1]),b=Number(short[2]);
 const dm=days.find(d=>Number(d.slice(8))===a&&Number(d.slice(5,7))===b);
 const md=days.find(d=>Number(d.slice(5,7))===a&&Number(d.slice(8))===b);
 const unique=[...new Set([dm,md].filter((d):d is string=>Boolean(d)))];
 if(unique.length!==1)return {date:null,order:'unknown'};
 return {date:unique[0],order:dm&&md?'same':dm?'day_month':'month_day'};
}
