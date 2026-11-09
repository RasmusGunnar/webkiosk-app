import {ReadProvider,textOnly,localDateTime,relevantChildren,sensitive,type Child,type Source,type RecordData} from './provider.ts';
import {AulaError,sourceKey} from './security.ts';
import {calendarPrefilter} from './calendar-filter.ts';
export function isoWeek(date:Date):string{
 const local=localDateTime(date.toISOString()).date!,d=new Date(local+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
 const week=Math.ceil(((d.getTime()-Date.UTC(d.getUTCFullYear(),0,1))/86400000+1)/7);
 return `${d.getUTCFullYear()}-W${String(week).padStart(2,'0')}`;
}
const stamp=(r:RecordData)=>r.sendDateTime??r.publishAt??r.timestamp??r.createdAt??r.updatedAt??r.updated??r.triggered;
export function sourceChunks(body:unknown):string[]{
 let remaining=textOnly(body,120001);if(remaining.length>120000)throw new AulaError('AULA_SOURCE_TOO_LARGE',422);
 const chunks:string[]=[];while(remaining.length>6000){const boundary=remaining.lastIndexOf('\n',6000),end=boundary>3000?boundary:6000;chunks.push(remaining.slice(0,end));remaining=remaining.slice(end).trimStart();}chunks.push(remaining);return chunks;
}
export async function collect(provider:ReadProvider,hid:string,mappings:RecordData[],_lastSuccess:string|null,_full=false,now=new Date(),report:(stage:string,counts:Record<string,number>,code?:string)=>void=()=>{}){
 const profiles=await provider.read('profiles.getProfilesByLogin'),ctx=await provider.read('profiles.getProfileContext',{portalrole:'guardian'});
 const guardians=(profiles?.profiles??[]).filter((p:RecordData)=>!p.portalRole||p.portalRole==='guardian');
 const institutions=ctx?.institutions??[],relations=[...(ctx?.institutionProfile?.relations??[]),...(ctx?.institutionProfiles??[]).flatMap((p:RecordData)=>p.relations??[])];
 const rawChildren=guardians.flatMap((p:RecordData)=>p.children??[]);
 const contextChildren=[...institutions.flatMap((i:RecordData)=>i.children??[]),...relations.flatMap((r:RecordData)=>r.children??[])];
 const children:Child[]=[...new Map<string,RecordData>([...rawChildren,...contextChildren].map((c:RecordData)=>[String(c.id),{...rawChildren.find((r:RecordData)=>r.id===c.id),...c}])).values()].slice(0,30).map(c=>{
  const key=sourceKey(hid,'child',String(c.id)),map=mappings.find(m=>m.provider_child_key===key),inst=institutions.find((i:RecordData)=>(i.children??[]).some((x:RecordData)=>x.id===c.id));
  return {id:String(c.id),profileId:String(c.profileId??c.id),userId:String(c.userId??''),institutionCode:String(c.institutionCode??inst?.institutionCode??''),name:textOnly(c.name,120),school:textOnly(c.institutionProfile?.institutionName??inst?.name??map?.school,200),className:textOnly(c.mainGroup?.name??c.institutionProfile?.mainGroup?.name??c.className??map?.class_name,80),groups:[],groupIds:[],key,personId:map?.person_id??null};
 });
 const counts:Record<string,number>={calendar:0,messages:0,meebook:0,posts:0,notifications:0,notification_sources:0,overview:0,sensitive_skipped:0,unavailable:0,truncated:0,lookback_days:45,actionable_version:2,threads_read:0,messages_read:0,posts_read:0,meebook_plans:0};
 report('profiles.ok',{children:children.length});
 const groups=await provider.read('groups.getGroupsByContext',{'childInstitutionProfileIds[]':children.map(c=>c.id)});
 for(const entry of Array.isArray(groups)?groups:groups?.groups??[]){
  for(const group of entry.groups??[entry])for(const c of children){
   const members=entry.childInstitutionProfileIds??entry.institutionProfileIds??[];
   if(String(entry.profileId??'')===c.profileId||members.map(String).includes(c.id)){
    const name=textOnly(group.name,80);c.groups.push(name);if(group.id!=null)c.groupIds!.push(String(group.id));
    if(/^\d{1,2}\.?\s*[a-z]$/i.test(name))c.className=name;
   }
  }
 }
 report('groups.ok',{children:children.length,classes_resolved:children.filter(c=>c.className).length});
 const sources:Source[]=[],seen=new Set<string>();
 const add=(kind:Source['source_kind'],row:RecordData,id:unknown,title:unknown,body:unknown,start?:unknown,end?:unknown)=>{
  if(sensitive(row)){counts.sensitive_skipped++;return;}
  const heading=textOnly(title,160);for(const [part,text]of sourceChunks(body).entries()){
  if(!text&&!heading)continue;
  const scope=relevantChildren(row,children,heading+'\n'+text),people=scope.children.map(c=>c.personId).filter((id):id is string=>Boolean(id));if(!people.length)continue;
  const key=sourceKey(hid,kind,part?`${id}:part:${part}`:String(id));if(seen.has(key))continue;seen.add(key);
  const s=localDateTime(start),e=localDateTime(end),ts=stamp(row),validStamp=Number.isFinite(Date.parse(ts));
  // An absent source timestamp is not replaced by today's date for relative interpretation.
  sources.push({source_key:key,source_kind:kind,title:heading,text,updated_at:validStamp?new Date(ts).toISOString():now.toISOString(),source_timestamp_known:validStamp||kind==='calendar'||kind==='meebook',person_ids:people,person_scopes:scope.children.filter(c=>c.personId).map(c=>({person_id:c.personId!,class_name:c.className})),date:s.date,time:row.allDay?null:s.time,end_date:e.date,end_time:row.allDay?null:e.time,location:textOnly(row.location?.name??row.location??row.primaryResource?.name,200),explicit_scope:scope.explicit,...(kind==='calendar'?{calendar_exception:true}:{})});
  counts[kind==='message'?'messages':kind==='post'?'posts':kind==='notification'?'notification_sources':kind]++;
  }
 };
 const cutoff=new Date(now.getTime()-45*864e5).toISOString();
 // Messages lead the candidate budget. Read old messages in active threads too.
 const seenThreads=new Set<string>();
 for(let page=0;page<12;page++){
  const batch=await provider.read('messaging.getThreads',{page:String(page),sortOn:'date',orderDirection:'desc'});const rows=batch?.threads??[];let allOld=rows.length>0;
  for(const thread of rows){
   const ts=thread.latestMessage?.sendDateTime??thread.lastMessage?.sendDateTime;
   if(!ts||!Number.isFinite(Date.parse(ts))||new Date(ts).toISOString()>=cutoff)allOld=false;else continue;
   if(seenThreads.has(String(thread.id)))continue;seenThreads.add(String(thread.id));
   if(sensitive(thread)){counts.sensitive_skipped++;continue;}
   try{for(let p=0;p<12;p++){
    const data=await provider.read('messaging.getMessagesForThread',{threadId:String(thread.id),page:String(p)});if(p===0)counts.threads_read++;
    const messages=data?.messages??[];let pageOld=messages.length>0;
    for(const m of messages){if(m.sendDateTime&&Number.isFinite(Date.parse(m.sendDateTime))&&new Date(m.sendDateTime).toISOString()<cutoff)continue;pageOld=false;counts.messages_read++;
     add('message',{...thread,...data,...m},m.id??`${thread.id}:${m.sendDateTime}`,m.subject??data.subject??thread.subject,m.text?.plain??m.text?.html??m.text);
    }
    if(!data?.moreMessagesExist||pageOld)break;if(p===11)counts.truncated++;
   }}catch(e){if(e instanceof AulaError&&e.code==='AULA_SENSITIVE_SKIPPED')counts.sensitive_skipped++;else throw e;}
  }
  if(!batch?.moreMessagesExist||allOld||!rows.length)break;if(page===11)counts.truncated++;
 }
 report('messages.ok',{sources:counts.messages,messages:counts.messages_read,threads:counts.threads_read,sensitive_skipped:counts.sensitive_skipped});
 // Match Aula's overview client: guardian institution profiles AND active children, in one call.
 const feedIds=[...new Set([...institutions.map((i:RecordData)=>String(i.institutionProfileId)),...guardians.flatMap((p:RecordData)=>p.institutionProfiles??[]).map((i:RecordData)=>String(i.id)),...children.map(c=>c.id)].filter(x=>/^\d+$/.test(x)))];
 for(let index=0;index<200;index+=10){
  const batch=await provider.read('posts.getAllPosts',{parent:'profile',index:String(index),limit:'10','institutionProfileIds[]':feedIds});const rows=batch?.posts??[];
  for(const p of rows){if(p.isExpired===true||p.isPublished===false)continue;const ts=stamp(p);if(ts&&Number.isFinite(Date.parse(ts))&&new Date(ts).toISOString()<cutoff)continue;
   counts.posts_read++;add('post',p,p.id,p.title,p.content?.html??p.content?.text??p.content);
  }
  if(rows.length<10)break;if(index===190)counts.truncated++;
 }
 counts.overview=counts.posts;report('posts.ok',{sources:counts.posts,read:counts.posts_read,overview:counts.overview});
 const ns=await provider.read('notifications.getNotificationsForActiveProfile',{'activeChildrenIds[]':children.map(c=>c.id)});const notices=Array.isArray(ns)?ns:ns?.notifications??[];counts.notifications=notices.length;
 // Notifications are pointers, not message bodies. Feed/thread reads above resolve their content.
 for(const n of notices){if(n.noteToGuardians&&(!n.responseDeadline||n.responseDeadline>=now.toISOString()))add('notification',{...n,belongsToProfiles:n.relatedChildInstitutionProfileId?[n.relatedChildInstitutionProfileId]:[]},n.notificationId,n.vacationRequestName,n.noteToGuardians,n.responseDeadline??n.startDate,n.endDate);}
 report('notifications.ok',{read:counts.notifications,sources:counts.notification_sources,post_references:notices.filter((n:RecordData)=>n.postId).length});
 const widgets=ctx?.pageConfiguration?.widgetConfigurations??[],widgetIds=widgets.map((w:RecordData)=>String(w.widget?.widgetId??w.widgetId));
 const known:Record<string,string>={'0001':'easyiq','0128':'easyiq','0142':'easyiq','0004':'meebook','0003':'meebook_other','0029':'minuddannelse','0030':'minuddannelse','0062':'systematic','0047':'tabulex','0049':'tabulex'};
 for(const id of widgetIds){const k='widget_'+(known[id]??'other');counts[k]=(counts[k]??0)+1;}report('widgets.ok',Object.fromEntries(Object.entries(counts).filter(([k])=>k.startsWith('widget_'))));
 if(widgetIds.includes('0004')){
  for(const offset of [0,7])for(const person of await provider.meebook(ctx,children,isoWeek(new Date(now.getTime()+offset*864e5)))){
   if(person.exceptionMessage)throw new AulaError('AULA_MEEBOOK_PLAN_UNAVAILABLE',502);
   const child=children.find(c=>c.userId===String(person.unilogin??'')||c.id===String(person.id??''));if(!child)continue;counts.meebook_plans++;
   for(const day of person.weekPlan??[])for(const [index,task]of (day.tasks??[]).entries())add('meebook',{belongsToProfiles:[child.id],timestamp:day.date},`${child.id}:${day.date}:${task.id??index}`,task.title??task.pill,task.content,day.date);
  }
  report('meebook.ok',{sources:counts.meebook,plans:counts.meebook_plans});
 }else report('meebook.skipped',{sources:0});
 const events=children.length?await provider.read('calendar.getEventsByProfileIdsAndResourceIds',{}, {instProfileIds:children.map(c=>Number(c.id)),resourceIds:[],start:new Date(now.getTime()-21*864e5).toISOString(),end:new Date(now.getTime()+14*864e5).toISOString()}):[];
 const filtered=calendarPrefilter(Array.isArray(events)?events:[],now);
 counts.raw_calendar=filtered.raw;counts.routine_calendar_filtered=filtered.routine;counts.calendar_exception_candidates=filtered.candidates.length;counts.calendar_baseline=filtered.baseline;
 for(const e of filtered.candidates)add('calendar',e,e.id??`${e.startDateTime}:${e.title}`,e.title,e.description,e.startDateTime,e.endDateTime);
 report('calendar.ok',{raw:filtered.raw,routine_filtered:filtered.routine,exceptions:filtered.candidates.length,baseline:filtered.baseline});
 // Do not report a partial scan as success or silently advance its cursor.
 if(sources.length>300||counts.truncated)throw new AulaError('AULA_SCAN_LIMIT',422);
 counts.ai_candidates=sources.length;
 return {children:children.map(c=>({provider_child_key:c.key,display_name:c.name,school:c.school,class_name:c.className,group_names:[...new Set(c.groups)]})),sources,counts,api_version:provider.version};
}
