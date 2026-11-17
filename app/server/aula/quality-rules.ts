// Pure rules shared by the scanner/analyzer. Provider text stays in memory.
import {schoolClasses} from './school-scope.ts';
import type {AnalysisFinding,AnalysisSource} from './analysis.ts';

export const QUALITY_VERSION=2;
export const localDay=(at:string|Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen'}).format(new Date(at));
const dayAdd=(day:string,n:number)=>new Date(Date.parse(day+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
const validDay=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export const words=(s:string):string[]=>s.normalize('NFKC').toLocaleLowerCase('da').match(/[\p{L}\p{N}]+/gu)??[];
const filler=new Set('husk medbring medbringe skal have tag tage tager til med og den det de en et alle børn elever barn elev på for af fra om er i at som inden før læs forbered'.split(' '));
const objects=(s:string)=>words(s).filter(w=>w.length>1&&!filler.has(w));

export function evidenceSections(text:string):string[]{
 return text.split(/\n+|(?<=[.!?;])\s+(?=[A-ZÆØÅ0-9])|\s+(?=\b(?:10|[0-9])\.\s*[A-Z]\b)|[,;]\s*(?=[A-ZÆØÅ][\p{L}'-]+\s+(?:vil|kan|skal|medbringer|tager|kommer)\b)/u).map(t=>t.trim()).filter(Boolean);
}
export type ScopeResult={people:string[];basis:'structured'|'class'|'named'|'uncertain'|'excluded';evidence:string};
export function findingScope(s:AnalysisSource,f:Pick<AnalysisFinding,'person_ids'|'title'|'evidence'>):ScopeResult{
 const possible=[...new Set(s.person_ids)].sort(),parts=evidenceSections(f.evidence),tokens=objects(f.title);
 const scores=parts.map(text=>({text,score:objects(text).filter(w=>tokens.includes(w)).length}));
 const best=Math.max(0,...scores.map(p=>p.score));
 const selected=scores.filter(p=>p.score===best).map(p=>p.text);
 const scoped=selected.join('\n')||f.evidence,classes=schoolClasses(scoped),grade=scoped.match(/\b(\d{1,2})\.?\s*årgang/iu)?.[1];
 let people=possible;
 if(s.person_scopes?.length&&(classes.length||grade)){
  // An ambiguous paragraph covering several classes is not a shared assignment.
  if(new Set(classes).size>1&&selected.length!==1)return {people:[],basis:'uncertain',evidence:scoped};
  people=people.filter(id=>{const cls=s.person_scopes!.find(p=>p.person_id===id)?.class_name.replace(/[.\s]/g,'').toLowerCase()??'';return classes.length?classes.includes(cls):cls.match(/^\d+/)?.[0]===grade;});
  if(!people.length)return {people:[],basis:'excluded',evidence:scoped};
 }
 const actor=/(?<![\p{L}])([A-ZÆØÅ][\p{L}'-]+(?:\s+og\s+[A-ZÆØÅ][\p{L}'-]+)?)\s+(?:(?:vil|kan|skal)\s+)?(?:medbringe[r]?|tage[r]?|deltage[r]?|komme[r]?)\b/gu;
 const subjects=[...scoped.matchAll(actor)].flatMap(m=>m[1].split(/\s+og\s+/)).filter(n=>!['Alle','Børn','Elever','Klassen','Familien','Vi','I'].includes(n));
 const namedScopes=s.person_scopes?.filter(p=>p.name)??[];
 if(subjects.length&&namedScopes.length){
  const named=namedScopes.filter(p=>subjects.some(n=>words(p.name!).includes(n.toLocaleLowerCase('da')))).map(p=>p.person_id);
  people=people.filter(id=>named.includes(id));
  if(!people.length)return {people:[],basis:'excluded',evidence:scoped};
  return {people,basis:'named',evidence:scoped};
 }
 if(classes.length||grade)return {people,basis:'class',evidence:scoped};
 if(s.explicit_scope||['calendar','meebook'].includes(s.source_kind))return {people,basis:'structured',evidence:scoped};
 // A family's permission to read a message is not proof that all children are
 // responsible for its action. Existing review can select a person explicitly.
 return {people:[],basis:'uncertain',evidence:scoped};
}

const months=['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
const weekdays=['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag'];
export type ResolvedDate={date:string|null;basis:'deadline'|'event'|'explicit'|'relative'|'week_plan_day'|'unknown'};
export function resolveActionDate(s:AnalysisSource,evidence:string):ResolvedDate{
 if(s.deadline&&validDay(s.deadline))return {date:s.deadline,basis:'deadline'};
 if(s.source_kind==='calendar'&&s.date&&validDay(s.date))return {date:s.date,basis:'event'};
 const anchor=s.source_timestamp_known!==false&&Number.isFinite(Date.parse(s.updated_at))?localDay(s.updated_at):null;
 const year=anchor?Number(anchor.slice(0,4)):s.date_context==='week_plan_day'&&s.date?Number(s.date.slice(0,4)):null;
 const dates=new Set<string>();
 for(const m of evidence.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g))if(validDay(m[1]))dates.add(m[1]);
 const add=(day:number,month:number,y:number|null)=>{if(!y)return;const date=[y,String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-');if(validDay(date))dates.add(date);};
 for(const m of evidence.matchAll(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?(?![\d:])/g)){
  if(/(?:kl\.?|side|s\.|opgave)\s*$/iu.test(evidence.slice(0,m.index))||/^\s*(?:liter|gram|kg|dl|ml|l)\b/iu.test(evidence.slice(m.index!+m[0].length)))continue;
  add(+m[1],+m[2],m[3]?+m[3]:year);
 }
 for(const m of evidence.toLocaleLowerCase('da').matchAll(/\b(\d{1,2})\.?\s+(januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)(?:\s+(\d{4}))?\b/g))add(+m[1],months.indexOf(m[2])+1,m[3]?+m[3]:year);
 if(dates.size===1)return {date:[...dates][0],basis:'explicit'};
 if(dates.size>1)return {date:null,basis:'unknown'};
 if(/\b(?:hver|ugentligt)\b/iu.test(evidence)&&!s.date)return {date:null,basis:'unknown'};
 if(/\bi morgen\b/iu.test(evidence))return {date:anchor?dayAdd(anchor,1):null,basis:anchor?'relative':'unknown'};
 if(/\bi dag\b/iu.test(evidence))return {date:anchor,basis:anchor?'relative':'unknown'};
 const days=[...new Set([...evidence.toLocaleLowerCase('da').matchAll(/\b(søndag|mandag|tirsdag|onsdag|torsdag|fredag|lørdag)\b/g)].map(m=>weekdays.indexOf(m[1])))];
 if(days.length){
  if(days.length!==1||!anchor)return {date:null,basis:'unknown'};
  const weekday=new Date(anchor+'T12:00Z').getUTCDay();let delta=(days[0]-weekday+7)%7;
  if(delta===0&&/\bnæste\b/iu.test(evidence))delta=7;
  return {date:dayAdd(anchor,delta),basis:'relative'};
 }
 if(s.date_context==='week_plan_day'&&s.date)return {date:s.date,basis:'week_plan_day'};
 return {date:null,basis:'unknown'};
}

export function familyAction(s:AnalysisSource,f:Pick<AnalysisFinding,'actionability'|'title'|'evidence'>):boolean{
 const text=f.evidence,kind=f.actionability;
 if(kind==='GENERAL_INFO')return false;
 if(/\b(?:havde|har haft)\b.{0,45}\b(?:god|dejlig|hyggelig)\b.{0,20}\b(?:tur|dag|uge)\b|^\s*(?:tak for|vi glæder os|perfekt\b)/iu.test(text)&&!(/\b(?:husk|medbring|tilmeld|betal|aflever)\b/iu.test(text)))return false;
 if(/\b(?:åbner hver|hver mandag|hver uge)\b/iu.test(text)&&!s.date)return false;
 const planning=/aflyst|aflysning|lukket|tidlig(?:ere)? fri|fri kl|ændret.{0,25}(?:tid|sted)|ny.{0,15}mødetid/iu.test(text);
 if(kind==='IMPORTANT_INFO')return planning;
 if(/(?:vi|der)\s+(?:arbejder|arbejdes)|starter.{0,15}(?:emne|forløb)|fortsæt(?:ter)? (?:fortælling|historie)|undervisning (?:i|om)|computerregler/iu.test(text)&&!(/\b(?:hjemme|lektier|aflever|læs|medbring|husk|tilmeld|betal)\b/iu.test(text)))return false;
 if(kind==='CHANGE')return planning||/mødetid|mød(?:e|er)?\s+(?:kl|lørdag|søndag)|sted\s+(?:lørdag|søndag)/iu.test(text);
 if(kind==='ATTEND')return s.source_kind==='calendar'||/tur|besøg|møde|fest|arrangement|klippedag|invitation|inviter|deltag|møde kl|mød kl|tjek.ind/iu.test(text+' '+s.title);
 if(kind==='BRING')return /husk|medbring|tag(?:e|er)?.{0,20}med|skal.{0,20}have|mangler|penalhus|skiftetøj|hårelastik|madpakke|drikkedunk|varmt tøj/iu.test(text);
 if(kind==='RESPOND'||kind==='PAY')return /tilmeld|svar|udfyld|formular|tag stilling|besked|betal|betaling|mobilepay/iu.test(text);
 if(kind==='PREPARE'||kind==='DO'||kind==='DEADLINE')return /læs|læse|forbered|find.{0,30}(?:tøj|material)|aflever|levering|lektie|øve?|træn|gennemfør|skriv|prøve|(?:side|s\.)\s*\d|opgav/iu.test(text);
 return false;
}
