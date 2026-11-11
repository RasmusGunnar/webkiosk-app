import type {AnalysisFinding,AnalysisSource} from './analysis.ts';
import {evidenceOptions,normalizedTitle} from './analysis.ts';
import {sourceKey} from './security.ts';

export type ReviewIdentity={origin_source_key:string;action_key:string;source_revision:string;material_revision:string};
export type HistoryRow=Record<string,any>&{id:string;source_key:string;status:string;identity?:ReviewIdentity|null};
// Normalize source-backed action objects, never a free-form model-generated key.
// Dates and generic instruction words identify a revision, not a different action.
const noise=new Set('husk huske medbring medbringe medbringer tag tage tager have har skal skulle du i vi de det den dem en et til på fra af og eller med for som at om ind ud hjem igen alle børn barnet klassen klasse læs læse læser aflever aflevere aflevering afleveringen forbered forberede øv øve træn træne gør gøre torsdag fredag mandag tirsdag onsdag lørdag søndag tomorrow monday tuesday wednesday thursday friday saturday sunday husket husker bring remember please the a an to and on your for at is of'.split(' '));
const canonical=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('da').replace(/\u00ad/g,'').replace(/varm(?:t|e)?\s+(?:tøj|påklædning)/gu,'varm tøj').replace(/drikkeflaske(?:n)?/gu,'drikkedunk').replace(/madpakken/g,'madpakke').replace(/paprørene/g,'paprør');
export function actionWords(value:string):string[]{
 const stripped=canonical(value).replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./:]\d{1,2}\b/gu,'').replace(/\b\d{1,2}\.?\s*(?:januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\b/gu,'');
 return [...new Set((stripped.match(/[\p{L}\p{N}]+/gu)??[]).filter(w=>!noise.has(w)&&w.length>1))].sort();
}
function sourceAnchors(source:AnalysisSource){
 const parts=evidenceOptions({...source,title:source.text?'':source.title}).flatMap(e=>{
  let family='action';return e.text.split(/\s+(?:og|samt|and)\s+|[,;]\s*|\n+/iu).map(text=>{
   const kind=/\b(?:læs|læse|øv|træn|forbered|read|practice)\b/iu.test(text)?'prepare':/\b(?:aflever|aflevering|returnér|submit)\b/iu.test(text)?'submit':/\b(?:husk|medbring|tag|bring)\b/iu.test(text)?'bring':/\b(?:betal|pay)\b/iu.test(text)?'pay':/\b(?:svar|tilmeld|respond)\b/iu.test(text)?'respond':null;
   if(kind)family=kind;return {text,words:[family,...actionWords(text)]};
  });
 }).filter(a=>a.words.length>1);
 return parts.length?parts:[{text:source.text||source.title,words:actionWords(source.text||source.title)}];
}
export function atomicFindings(source:AnalysisSource,finding:AnalysisFinding):AnalysisFinding[]{
 if(source.source_kind==='calendar')return [finding];
 const words=actionWords(finding.title),evidence=canonical(finding.evidence);
 const matched=sourceAnchors(source).filter(a=>evidence.includes(canonical(a.text))&&a.words.some(w=>words.includes(w)));
 if(matched.length<2)return [finding];
 // AI may group or split the same list differently on each scan. Expand a
 // source-backed list into its independent actions before assigning identity.
 return matched.map(a=>{
  const family=a.words[0],prefix=family==='bring'?'Husk ':family==='prepare'?'Forbered ':family==='submit'?'Aflever ':'';
  const title=(/^(?:husk|medbring|læs|aflever|forbered|betal|svar)\b/iu.test(a.text.trim())?'':prefix)+a.text.trim().replace(/[.;,]+$/u,'');
  return {...finding,title:title.slice(0,160),summary:title.slice(0,500),evidence:a.text};
 });
}
function anchorFor(source:AnalysisSource,finding:Pick<AnalysisFinding,'title'|'evidence'>){
 const all=sourceAnchors(source),words=actionWords(finding.title),evidence=canonical(finding.evidence);
 const available=all.filter(a=>evidence.includes(canonical(a.text)));const candidates=available.length?available:all;
 const scored=candidates.map(a=>({a,score:a.words.filter(w=>words.includes(w)).length/Math.max(1,a.words.length)})).sort((a,b)=>b.score-a.score);
 // The title only selects an existing source span. It never becomes identity.
 // Ties keep the entire evidence: do not arbitrarily merge independent actions.
 if(scored[0]&&scored[0].score>0&&(!scored[1]||scored[0].score>scored[1].score))return scored[0].a;
 if(candidates.length===1)return candidates[0];
 return {text:finding.evidence,words:actionWords(finding.evidence)};
}
export function reviewIdentity(hid:string,source:AnalysisSource,finding:Pick<AnalysisFinding,'title'|'evidence'|'person_ids'>):ReviewIdentity{
 const origin=source.origin_source_key??source.source_key,anchor=anchorFor(source,finding),people=[...new Set(finding.person_ids)].sort();
 const hash=(kind:string,data:unknown)=>sourceKey(hid,kind,JSON.stringify(data));
 // Calendar events are one provider occurrence; their wording/type is immaterial.
 const semantic=source.source_kind==='calendar'?'event':anchor.words;
 return {origin_source_key:origin,action_key:hash('action-v1',[origin,people,semantic]),
  source_revision:hash('source-revision-v1',[canonical(source.text),source.date,source.time,source.end_date,source.end_time,canonical(source.location)]),
  material_revision:hash('material-v1',[canonical(anchor.text).replace(/\b(?:husk|medbring|remember|bring)\b/gu,'').replace(/\s+/g,' ').trim(),source.date,source.time,source.end_date,source.end_time,canonical(source.location)])};
}
// Old HMACs cannot be reversed. Bind legacy rows only by reproducing the exact
// old HMAC from a currently read source, the saved people/type/title. No fuzzy
// cross-source match and no rewriting accepted/ignored rows or calendar items.
export function bindLegacy(hid:string,sources:AnalysisSource[],history:HistoryRow[]){
 const bindings:{finding_id:string;identity:ReviewIdentity}[]=[];
 for(const row of history){if(row.identity)continue;
  const people=[...row.person_ids].sort();
  const source=sources.find(s=>s.source_kind===row.source_kind&&sourceKey(hid,'finding',`${s.source_key}:${people.join(',')}:${row.type}:${normalizedTitle(row.title)}`)===row.source_key);
  if(!source)continue;
  const identity=reviewIdentity(hid,source,{title:row.title,person_ids:people,evidence:source.text||source.title});
  row.identity=identity;bindings.push({finding_id:row.id,identity});
 }
 return bindings;
}
export function bindLegacyCandidate(hid:string,source:AnalysisSource,finding:AnalysisFinding,history:HistoryRow[]){
 const people=[...finding.person_ids].sort(),oldKey=sourceKey(hid,'finding',`${source.source_key}:${people.join(',')}:${finding.type}:${normalizedTitle(finding.title)}`);
 const row=history.find(r=>!r.identity&&r.source_key===oldKey&&r.source_kind===source.source_kind);
 if(!row)return [];
 // The legacy row may have been manually retitled/reassigned during review.
 // Reproducing its original HMAC from this candidate proves the link anyway.
 row.identity=reviewIdentity(hid,source,finding);
 return [{finding_id:row.id,identity:row.identity}];
}
