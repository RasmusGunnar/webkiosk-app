// Calendar dates only. No Date.parse on yearless provider display labels.
export function isoWeekDays(week:string):string[]{
 const match=/^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/.exec(week);if(!match)return [];
 const year=Number(match[1]),jan4=new Date(Date.UTC(year,0,4));
 const start=jan4.getTime()-(jan4.getUTCDay()||7)*864e5+864e5+(Number(match[2])-1)*7*864e5;
 if(new Date(start+3*864e5).getUTCFullYear()!==year)return [];
 return Array.from({length:7},(_,i)=>new Date(start+i*864e5).toISOString().slice(0,10));
}
export function resolvePlanDate(value:unknown,week:string):{date:string|null;order:'iso'|'day_month'|'month_day'|'same'|'unknown'}{
 const days=isoWeekDays(week);if(!days.length||typeof value!=='string')return {date:null,order:'unknown'};
 const label=value.trim();
 if(/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(label)){
  const explicit=label.slice(0,10);
  if(!Number.isFinite(Date.parse(explicit))||new Date(explicit).toISOString().slice(0,10)!==explicit)return {date:null,order:'unknown'};
  const date=/(Z|[+-]\d{2}:?\d{2})$/.test(label)?Number.isFinite(Date.parse(label))?new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen'}).format(new Date(label)):null:explicit;
  return {date:date&&days.includes(date)?date:null,order:'iso'};
 }
 const short=/^(\d{1,2})[\/.-](\d{1,2})[\/.]?$/.exec(label);if(!short)return {date:null,order:'unknown'};
 const a=Number(short[1]),b=Number(short[2]);
 const dm=days.find(d=>Number(d.slice(8))===a&&Number(d.slice(5,7))===b);
 const md=days.find(d=>Number(d.slice(5,7))===a&&Number(d.slice(8))===b);
 const unique=[...new Set([dm,md].filter((d):d is string=>Boolean(d)))];
 if(unique.length!==1)return {date:null,order:'unknown'};
 return {date:unique[0],order:dm&&md?'same':dm?'day_month':'month_day'};
}
