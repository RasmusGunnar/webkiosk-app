import {localDateTime,textOnly,type RecordData} from './provider.ts';
import type {AnalysisSource,AnalysisFinding} from './analysis.ts';
import {evidenceOptions,validateAnalysis} from './analysis.ts';
import {schoolClasses} from './school-scope.ts';
import {resolvePlanDate} from './meebook-date.ts';

// Confirmed against production on 2026-11-11: task and comment, content/pill/id,
// day.date timestamps. No assignment type or dedicated deadline field observed.
export function meebookMetadata(task:RecordData,day:RecordData,week?:string){
 const structured_type:AnalysisSource['structured_type']=task.type==='task'?'task':task.type==='comment'?'comment':'unknown';
 const raw=typeof day.date==='string'&&/^\d{4}-\d{2}-\d{2}/.test(day.date)?localDateTime(day.date).date:null;
 const date=week?resolvePlanDate(day.date,week).date:raw&&Number.isFinite(Date.parse(raw))&&new Date(raw).toISOString().slice(0,10)===raw?raw:null;
 return {structured_type,subject:textOnly(task.pill,80),date_context:date?'week_plan_day' as const:'unknown' as const,date};
}
export function retainStructuredTasks(sources:AnalysisSource[],rows:AnalysisFinding[]){
 const results=[...rows];let retained=0;
 for(const s of sources){
  if(s.source_kind!=='meebook'||s.structured_type!=='task'||results.some(f=>f.source_key===s.source_key&&f.actionability!=='GENERAL_INFO'&&f.proposed_action!=='NO_ACTION'&&f.confidence!=='LOW'))continue;
  // Retain a source-backed task for human review when AI drops it. Do not invent
  // an action, widen recipients or turn a general comment into homework.
  const classes=schoolClasses(s.text),own=s.person_scopes?.map(p=>p.class_name.replace(/[.\s]/g,'').toLowerCase())??[];
  if(classes.length&&!classes.some(c=>own.includes(c)))continue;
  if(/ingen\s+(?:lektier|hjemmearbejde|opgaver)|(?:opgaven|afleveringen|lektien)\s+(?:er\s+)?aflyst/iu.test(s.text))continue;
  const options=evidenceOptions({...s,title:''});
  const evidence=(classes.length?options.find(e=>schoolClasses(e.text).some(c=>own.includes(c))):options[0])?.text;
  if(!evidence)continue;
  const actionability=/aflever|return[eé]r|afleveringsfrist/iu.test(evidence)?'DEADLINE':/læs|øv|træn|forbered/iu.test(evidence)?'PREPARE':'DO';
  const result=validateAnalysis({findings:[{source_key:s.source_key,person_ids:s.person_ids,type:actionability==='DEADLINE'?'DEADLINE':'HOMEWORK',title:evidence.replace(/\u00ad/g,'').slice(0,160),date:s.date,time:null,end_date:null,end_time:null,location:'',confidence:'MEDIUM',reason:'Ugeplanen markerer dette som en opgave. Gennemgå indhold og dato før tilføjelse.',summary:'Struktureret opgave fra Aula · Ugeplan.',proposed_action:'CREATE_ACTIVITY',actionability,evidence}]},[s]);
  results.push(...result);retained+=result.length;
 }
 return {results,retained};
}
