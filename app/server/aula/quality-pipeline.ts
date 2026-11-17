import type {AnalysisFinding,AnalysisSource} from './analysis.ts';
import {findExisting,normalizedTitle} from './analysis.ts';
import {actionWords,reviewIdentity,type HistoryRow,type ReviewIdentity} from './review-memory.ts';
import {familyAction,findingScope,localDay,resolveActionDate,words} from './quality-rules.ts';
import {sourceKey} from './security.ts';

export type Component=ReviewIdentity&{component_key:string;group_key:string};
type Fragment={source:AnalysisSource;finding:AnalysisFinding;components:Component[];group:string;event?:AnalysisSource};
export type QualityItem={finding:AnalysisFinding;source:AnalysisSource;identity:ReviewIdentity;components:Component[];lifecycle:'dated'|'immediate'|'persistent'|'unresolved';expires_on:string|null};
const peopleKey=(ids:string[])=>[...new Set(ids)].sort().join(',');
const canonical=(s:string)=>words(s).join(' ');
const topic=(s:string)=>actionWords(s).filter(w=>!['information','info','vedr','ang','klasse','klasser','tur','turen','besøg','besøget','invitation','til','aula'].includes(w)&&!/^\d+$/.test(w));
function sameTopic(a:string,b:string){
 const x=topic(a),y=topic(b);if(!x.length||!y.length)return false;
 const common=x.filter(w=>y.includes(w));
 // A distinctive venue/topic, not a generic 'trip', date or class label.
 return common.length/Math.max(x.length,y.length)>=0.85&&(common.length>=2||common.some(w=>w.length>=8));
}
function compatible(a:AnalysisFinding,b:AnalysisSource){return peopleKey(a.person_ids)===peopleKey(b.person_ids)&&(!a.date||!b.date||a.date===b.date)&&(!a.time||!b.time||a.time===b.time);}
function linkedEvent(s:AnalysisSource,f:AnalysisFinding,sources:AnalysisSource[]){
 if(!f.person_ids.length)return undefined;
 const matches=sources.filter(e=>e.source_kind==='calendar'&&e.date&&compatible(f,e)&&
  ((s.context_key&&s.context_key===e.context_key)||sameTopic(s.title,e.title))&&
  (s.source_timestamp_known===false||Math.abs(Date.parse(e.date!)-Date.parse(localDay(s.updated_at)))<=45*864e5));
 const identities=new Set(matches.map(e=>[e.date,e.time,canonical(e.title)].join(':')));
 return identities.size===1?matches[0]:undefined;
}
const family=(f:AnalysisFinding)=>['RESPOND','PAY'].includes(f.actionability)?'response':f.actionability==='BRING'?'bring':f.actionability==='ATTEND'?'attend':f.actionability.toLowerCase();
function objectText(text:string){return text.trim().replace(/^(?:husk|medbring|tag|forbered)\s+/iu,'').replace(/[.;]+$/u,'').trim();}

// These are internal memory components, never separate UI cards. A comma
// between digits is a decimal quantity. No arbitrary split of all provider text.
function components(hid:string,s:AnalysisSource,f:AnalysisFinding,group:string):Component[]{
 const pieces=['BRING','RESPOND','PAY'].includes(f.actionability)?f.evidence.split(/(?<!\d),\s*|,\s+(?!\d)|\s+(?:og|samt)\s+/iu):[f.evidence];
 const titleWords=actionWords(f.title),selected=pieces.filter(p=>actionWords(p).some(w=>titleWords.includes(w)));
 const spans=selected.length?selected:[f.evidence];
 return spans.map(evidence=>{
  const title=objectText(evidence),legacy=reviewIdentity(hid,s,{title,evidence,person_ids:f.person_ids});
  const semantic=[family(f),actionWords(evidence)],origin=s.origin_source_key??s.source_key;
  return {...legacy,component_key:sourceKey(hid,'quality-component-v1',JSON.stringify([origin,peopleKey(f.person_ids),semantic])),group_key:group,
   source_revision:sourceKey(hid,'quality-source-v1',JSON.stringify([legacy.source_revision,s.source_timestamp_known===false?null:s.updated_at])),
   material_revision:sourceKey(hid,'quality-material-v1',JSON.stringify([canonical(evidence),f.date,f.time,f.end_date,f.end_time,f.location]))};
 });
}

export function prepareReview(hid:string,sources:AnalysisSource[],rows:AnalysisFinding[],history:HistoryRow[]=[],existing:Record<string,any>[]=[],now=new Date()){
 const counts:Record<string,number>={raw_sources:sources.length,action_fragments:rows.length,wrong_person_filtered:0,uncertain_person:0,dates_resolved:0,noise_filtered:0,important_info_noise:0,exact_duplicates_suppressed:0,event_clusters:0,complementary_fragments_merged:0,cross_source_clusters:0,dated_expired:0,dateless_immediate:0,dateless_persistent:0,already_covered_suppressed:0};
 const today=localDay(now),fragments:Fragment[]=[],seen=new Map<string,Fragment>();
 const componentBindings:{finding_id:string;components:Component[]}[]=[];
 for(const input of rows){
  const s=sources.find(s=>s.source_key===input.source_key);if(!s)continue;
  const scope=findingScope(s,input);
  if(scope.basis==='excluded'){counts.wrong_person_filtered++;continue;}
  let f={...input,person_ids:scope.people,evidence:scope.evidence};
  if(scope.basis==='uncertain'){f.confidence='MEDIUM';counts.uncertain_person++;}
  let date=resolveActionDate(s,f.evidence);
  // A unique date in the source context may support a shorter evidence span.
  // Never override ambiguity in an evidence span with a different paragraph.
  if(date.basis==='unknown'&&!/\d|mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|i morgen|i dag/iu.test(f.evidence))date=resolveActionDate(s,s.title+'\n'+s.text);
  f.date=date.date;if(!f.date){f.time=null;f.end_date=null;f.end_time=null;}
  else if(s.source_kind==='calendar'){f.time=s.time;f.end_date=s.end_date;f.end_time=s.end_time;}
  else {
   const clocks=[...f.evidence.matchAll(/\b(?:kl\.?\s*(\d{1,2})(?:[.:](\d{2}))?|(\d{1,2}):(\d{2}))\b/giu)].map(m=>String(m[1]??m[3]).padStart(2,'0')+':'+(m[2]??m[4]??'00'));
   f.time=f.time&&clocks.includes(f.time)?f.time:null;f.end_time=f.end_time&&clocks.includes(f.end_time)?f.end_time:null;f.end_date=null;
  }
  if(date.date&&date.date!==input.date)counts.dates_resolved++;
  if(!familyAction(s,f)||f.proposed_action==='NO_ACTION'||f.confidence==='LOW'){
   counts.noise_filtered++;if(f.actionability==='IMPORTANT_INFO')counts.important_info_noise++;continue;
  }
  const event=linkedEvent(s,f,sources);
  if(event&&!f.date){f.date=event.date;counts.dates_resolved++;}
  if(f.date&&(f.end_date??f.date)<today){counts.dated_expired++;continue;}
  // Only a concrete event joins ATTEND and BRING. Other task families stay apart.
  const clusterFamily=event&&['BRING','ATTEND'].includes(f.actionability)?'event':family(f);
  const context=event?['event',canonical(event.title),event.date,event.time]:[(f.date?s.context_key:undefined)??s.origin_source_key??s.source_key,
   // Same source alone is insufficient: complementary actions share a sentence.
   canonical(f.evidence),f.date];
  const group=sourceKey(hid,'quality-group-v1',JSON.stringify([context,peopleKey(f.person_ids),clusterFamily]));
  const cs=components(hid,s,f,group);
  const fragment={source:s,finding:f,components:cs,group,event};
  // Exact cross-source dedupe needs proven event/context AND semantic equality.
  const exact=JSON.stringify([group,peopleKey(f.person_ids),f.date,f.time,family(f),actionWords(f.title),f.evidence.match(/\d+(?:[.,]\d+)?/g)??[]]);
  const duplicate=seen.get(exact);
  if(duplicate){duplicate.components.push(...cs);counts.exact_duplicates_suppressed++;continue;}
  seen.set(exact,fragment);fragments.push(fragment);
 }
 // Bind old reviewed components only with the same origin/revision, same
 // recipients and source-backed object coverage. No fuzzy cross-source history.
 for(const h of history){
  if(!h.identity||(!['accepted','ignored'].includes(h.status)&&!h.automatically_expired)||h.components?.length)continue;
  const oldWords=actionWords(h.title),matches=fragments.flatMap(f=>{
   if(peopleKey(h.person_ids??[])!==peopleKey(f.finding.person_ids))return [];
   const original=reviewIdentity(hid,f.source,{title:f.finding.title,evidence:f.finding.evidence,person_ids:f.finding.person_ids});
   if(h.identity!.origin_source_key!==original.origin_source_key||h.identity!.source_revision!==original.source_revision||
    (safelyDated(h.source_updated_at)&&f.source.source_timestamp_known!==false&&Date.parse(h.source_updated_at)!==Date.parse(f.source.updated_at)))return [];
   return f.components.filter(c=>{
    if(c.action_key===h.identity!.action_key)return true;
    const required=actionWords(f.finding.title);return required.length>0&&required.every(w=>oldWords.includes(w));
   });
  });
  if(matches.length)componentBindings.push({finding_id:h.id,components:matches});
 }
 const groups=new Map<string,Fragment[]>();
 for(const f of fragments){const key=f.finding.person_ids.length?f.group:f.source.source_key+':'+normalizedTitle(f.finding.title);const group=groups.get(key)??[];group.push(f);groups.set(key,group);}
 const items:QualityItem[]=[];
 for(const fs of groups.values()){
  const first=fs.find(f=>f.finding.actionability==='ATTEND')??fs[0],s=first.source;
  let allComponents=[...new Map(fs.flatMap(f=>f.components).map(c=>[c.component_key,c])).values()];
  const titles=[...new Set(fs.map(f=>f.finding.title.trim()))];
  // A genuinely new action for a HIGH-linked event may retain the already
  // reviewed material context. Same date/person alone never opens this path.
  if(first.event){
   const previous=history.filter(h=>['accepted','ignored'].includes(h.status)&&h.date===first.finding.date&&peopleKey(h.person_ids??[])===peopleKey(first.finding.person_ids)&&h.components?.some((c:Component)=>c.group_key===first.group)).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))[0];
   if(previous){
    const currentWords=actionWords(titles.join(' ')),oldWords=actionWords(previous.title);
    if(!oldWords.every(w=>currentWords.includes(w)))titles.unshift(previous.title);
    first.components.push(...previous.components.filter((c:Component)=>c.group_key===first.group));
    allComponents=[...new Map(fs.flatMap(f=>f.components).map(c=>[c.component_key,c])).values()];
   }
  }
  const combined=titles.join(' · ');
  const f={...first.finding,title:combined.length<=160?combined:first.finding.title,summary:combined.length<=500?combined:first.finding.summary};
  // Retain complete specifics rather than truncating a long action list.
  if(combined.length>500&&fs.length>1){for(const part of fs)items.push(makeItem([part],part.finding));continue;}
  if(allComponents.length>1){counts.event_clusters++;counts.complementary_fragments_merged+=fs.length-1;if(new Set(allComponents.map(c=>c.origin_source_key)).size>1)counts.cross_source_clusters++;}
  if(findExisting(f,f.person_ids,existing)){counts.already_covered_suppressed++;continue;}
  items.push(makeItem(fs,f));
  function makeItem(group:Fragment[],finding:AnalysisFinding):QualityItem{
   const cs=[...new Map(group.flatMap(f=>f.components).map(c=>[c.component_key,c])).values()],base=reviewIdentity(hid,s,finding);
   const origin=sourceKey(hid,'quality-origin-v1',group[0].group);
   const identity=cs.length===1&&group.length===1?{...base,source_revision:cs[0].source_revision,material_revision:cs[0].material_revision}:{origin_source_key:origin,action_key:sourceKey(hid,'quality-cluster-v1',JSON.stringify([group[0].group,cs.map(c=>c.component_key).sort()])),source_revision:sourceKey(hid,'quality-cluster-source-v1',JSON.stringify([...new Set(cs.map(c=>c.source_revision))].sort())),material_revision:sourceKey(hid,'quality-cluster-material-v1',JSON.stringify(cs.map(c=>[c.component_key,c.material_revision]).sort()))};
   // Short-lived only when explicitly immediate and source-dated. Persistent
   // decisions/payments, generic uncertainty and unknown timestamps never TTL.
   const persistent=group.some(g=>['RESPOND','PAY'].includes(g.finding.actionability));
   const immediate=!finding.date&&!persistent&&group.every(g=>['BRING','PREPARE'].includes(g.finding.actionability)&&g.source.source_timestamp_known!==false&&/\b(?:snarest|hurtigst muligt|hurtigst muligt|denne uge)\b/iu.test(g.finding.evidence));
   const lifecycle=finding.date?'dated':persistent?'persistent':immediate?'immediate':'unresolved';
   const expires_on=immediate?new Date(Date.parse(localDay(s.updated_at)+'T12:00Z')+14*864e5).toISOString().slice(0,10):null;
   if(lifecycle==='immediate')counts.dateless_immediate++;if(lifecycle==='persistent')counts.dateless_persistent++;
   return {finding,source:s,identity,components:cs,lifecycle,expires_on};
  }
 }
 return {items,counts,componentBindings};
}
function safelyDated(value:unknown):value is string{return typeof value==='string'&&Number.isFinite(Date.parse(value));}
