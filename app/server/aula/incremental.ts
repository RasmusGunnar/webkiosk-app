import {sourceKey} from './security.ts';
import type {Source} from './provider.ts';
import type {AnalysisSource} from './analysis.ts';
export type Checkpoint={source_key:string;revision:string};
// No message bodies are persisted. Content + interpretation context are HMACed.
// Discovery retains its bounded lookback so old future plans and edits are not lost.
export function sourceCheckpoint(hid:string,s:AnalysisSource):Checkpoint{
 const {updated_at,source_timestamp_known,...content}=s;
 return {source_key:s.source_key,revision:sourceKey(hid,'processed-source-v1',JSON.stringify({...content,person_ids:[...s.person_ids].sort(),updated_at:source_timestamp_known===false?null:updated_at}))};
}
export function incrementalSources(hid:string,sources:Source[],saved:Checkpoint[],enabled:boolean){
 const previous=new Map(saved.map(c=>[c.source_key,c.revision]));
 const candidates=sources.filter(s=>!enabled||previous.get(s.source_key)!==sourceCheckpoint(hid,s).revision);
 return {candidates,unchanged:sources.length-candidates.length};
}
