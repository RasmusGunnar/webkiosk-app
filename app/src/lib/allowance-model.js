import {t,dateFormatter} from '../i18n/index.js'
// Allowance is a server-confirmed period contract, layered over task_reward_occurrences.
export function allowanceTasks(rows,state,dates){
 const days=[...new Set(dates)].sort();if(!days.length)return rows;
 const frozen=(state?.occurrences||[]).filter(s=>s.allowance_contract_id);
 const selected=frozen.filter(s=>s.due_date<=days.at(-1)&&(s.window_end||s.due_date)>=days[0]);
 const originals=new Set(frozen.map(s=>s.task_id+'|'+s.occurrence_date));
 return [...rows.filter(r=>!(state?.agreements||[]).some(a=>!a.needs_review&&a.effective_from<=r.date&&a.legacy_task_ids?.includes(r.baseId||r.id))&&!originals.has((r.isRepeatOccurrence?r.baseId:r.id)+'|'+(r.occurrenceDate||r.data?.originalDate||r.date))),
 ...selected.map(s=>{
  const date=days.find(d=>d>=s.due_date&&d<=(s.window_end||s.due_date));
  return {id:s.task_id,type:'Opgave',title:s.title,date,person_ids:[s.person_id],personIds:[s.person_id],people:[],done:['completed','approved'].includes(s.status),
   occurrenceDate:s.occurrence_date,data:{rewardOriginId:s.origin_id,rewardMode:'allowance',starValue:0,requiresApproval:s.requires_approval,personIds:[s.person_id],allowanceDueDate:s.due_date,allowanceContractId:s.allowance_contract_id,windowEnd:s.window_end}};
 }).filter(t=>t.date)].sort((a,b)=>a.date.localeCompare(b.date));
}
export const currentAgreement=(state,pid)=>[...(state?.agreements||[])].filter(a=>a.person_id===pid).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0]||null;
export const periodLabel=p=>p?.period_start?dateFormatter({day:'numeric',month:'short'}).format(new Date(p.period_start+'T12:00:00'))+' – '+dateFormatter({day:'numeric',month:'short'}).format(new Date(p.period_end+'T12:00:00')):(t("allowance.next_period"));
export const dutyLabel=d=>({daily:(t("allowance.every_day")),weekdays:(t("app.all_weekdays")),weekly:(t("allowance.once_a_week")),selected:(d.weekdays||[]).map(n=>['',(t("allowance.mon")),(t("allowance.tue")),(t("allowance.wed")),(t("allowance.thu")),(t("allowance.fri")),(t("allowance.sat")),(t("allowance.sun"))][n]).join(' · ')})[d.schedule]||'';

// Display-only estimate; the database still creates and freezes every real period.
export function allowancePreview(duties,start,cadence){
 const first=new Date(start+'T12:00:00Z'),end=new Date(first);if(cadence==='week')end.setUTCDate(end.getUTCDate()+7-(end.getUTCDay()||7));else end.setUTCMonth(end.getUTCMonth()+1,0)
 let expected=0;for(const day=new Date(first);day<=end;day.setUTCDate(day.getUTCDate()+1)){const weekday=day.getUTCDay()||7;for(const d of duties){if(d.schedule==='daily'||d.schedule==='weekdays'&&weekday<=5||d.schedule==='selected'&&d.weekdays?.includes(weekday)||d.schedule==='weekly'&&(day.getTime()===first.getTime()||weekday===1))expected++}}
 return {expected,period_end:end.toISOString().slice(0,10)}
}
