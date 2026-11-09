// Read API and MeeBook protocol adapted from aula-mcp at the SHA in docs/aula-third-party.md.
// No generic API escape hatch, mark-as-read, presence or other mutation method.
import {load} from 'cheerio';
import {AulaHttpClient} from './vendor/http.ts';
import {DEFAULT_OAUTH_CONFIG,oauthUrls,parseTokenResponse,type AulaTokens} from './vendor/aula-oauth.ts';
import {AulaError,sourceKey,safeError} from './security.ts';
export type RecordData=Record<string,any>; // Untrusted provider boundary; normalize before storage/AI.
export type Child={id:string;userId:string;name:string;school:string;className:string;groups:string[];key:string;personId:string|null};
export type Source={source_key:string;source_kind:'calendar'|'message'|'meebook'|'post'|'notification';title:string;text:string;updated_at:string;person_ids:string[];date:string|null;time:string|null;end_date:string|null;end_time:string|null;location:string;explicit_scope:boolean};
const READS=new Map([
 ['profiles.getProfilesByLogin','GET'],['profiles.getProfileContext','GET'],['groups.getGroupsByContext','GET'],
 ['calendar.getEventsByProfileIdsAndResourceIds','POST'],['messaging.getThreads','GET'],['messaging.getMessagesForThread','GET'],
 ['notifications.getNotificationsForActiveProfile','GET'],['posts.getAllPosts','GET'],['aulaToken.getAulaToken','GET'],
]);
export function textOnly(value:unknown,max=6000):string{if(typeof value!=='string')return '';const $=load(value);$('script,style,iframe,img').remove();return $.text().replace(/\s+/g,' ').trim().slice(0,max);}
export function localDateTime(value:unknown):{date:string|null;time:string|null}{
 if(typeof value!=='string')return {date:null,time:null};
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return {date:value,time:null};
 if(!Number.isFinite(Date.parse(value)))return {date:null,time:null};
 // Floating Aula wall time is Copenhagen wall time, never the server timezone.
 if(!/(Z|[+-]\d{2}:?\d{2})$/i.test(value))return {date:value.slice(0,10),time:value.slice(11,16)};
 const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
 return {date:parts.slice(0,10),time:parts.slice(11,16)};
}
export function sensitive(row:RecordData):boolean{return row.sensitive===true||row.isSensitive===true||row.sensitivity==='SENSITIVE'||row.isSensitiveThread===true;}
export async function refreshSession(http:AulaHttpClient,refresh:string):Promise<AulaTokens>{
 const r=await http.request(oauthUrls.token(DEFAULT_OAUTH_CONFIG),{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:DEFAULT_OAUTH_CONFIG.clientId,refresh_token:refresh})});
 let data:RecordData={};try{data=JSON.parse(r.body);}catch{}
 if(data.error==='invalid_grant'||data.error==='invalid_token')throw new AulaError('AULA_REAUTH_REQUIRED',409);
 if(r.status!==200)throw new AulaError('AULA_TEMPORARY_ERROR',502);
 try{return parseTokenResponse(r.body,refresh);}catch{throw new AulaError('AULA_PROVIDER_FORMAT',502);}
}
export class ReadProvider {
 version=24; private token:string; private http:AulaHttpClient;
 constructor(token:string,http:AulaHttpClient){this.token=token;this.http=http;}
 async read(method:string,query:Record<string,string|string[]>={},body?:RecordData):Promise<any>{
  const verb=READS.get(method);if(!verb||(body!==undefined)!==(verb==='POST'))throw new AulaError('AULA_WRITE_BLOCKED',403);
  if(Object.keys(query).some(k=>['method','access_token'].includes(k)))throw new AulaError('AULA_WRITE_BLOCKED',403);
  for(;this.version<=30;this.version++){
   const params=new URLSearchParams({method,access_token:this.token});for(const [k,v] of Object.entries(query))for(const x of Array.isArray(v)?v:[v])params.append(k,x);
   const url=`https://www.aula.dk/api/v${this.version}/?${params}`;
   const csrf=verb==='POST'?await this.http.jar.getCookieValue(url,'Csrfp-Token'):null;
   const r=await this.http.request(url,{method:verb,headers:{accept:'application/json',...(body?{'content-type':'application/json'}:{}),...(csrf?{'csrfp-token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
   if(r.status===410)continue;
   let envelope:RecordData={};try{envelope=JSON.parse(r.body);}catch{throw new AulaError('AULA_PROVIDER_FORMAT',502);}
   if(method==='messaging.getMessagesForThread'&&(r.status===403||envelope.status?.code===403))throw new AulaError('AULA_SENSITIVE_SKIPPED');
   if(r.status===401)throw new AulaError('AULA_ACCESS_EXPIRED',409);
   if(r.status!==200||envelope.status?.code)throw new AulaError('AULA_TEMPORARY_ERROR',502);
   return envelope.data;
  }throw new AulaError('AULA_API_VERSION',502);
 }
 async meebook(ctx:RecordData,children:Child[],week:string):Promise<RecordData[]>{
  const q=new URLSearchParams({currentWeekNumber:week,userProfile:'guardian'});
  for(const c of children)if(c.userId)q.append('childFilter[]',c.userId);
  const relations=[...(ctx.institutionProfile?.relations??[]),...(ctx.institutionProfiles??[]).flatMap((p:RecordData)=>p.relations??[])];
  for(const code of new Set(relations.map((r:RecordData)=>String(r.institutionCode))))q.append('institutionFilter[]',String(code));
  for(let retry=0;retry<2;retry++){
   const token=await this.read('aulaToken.getAulaToken',{widgetId:'0004'});
   if(typeof token!=='string')throw new AulaError('AULA_WIDGET_UNAVAILABLE',502);
   const r=await this.http.request(`https://app.meebook.com/aulaapi/relatedweekplan/all?${q}`,{method:'GET',headers:{authorization:`Bearer ${token}`,sessionuuid:String(ctx.userId??''),'x-version':'1.0',origin:'https://www.aula.dk',referer:'https://www.aula.dk/',accept:'application/json'}});
   if([401,403].includes(r.status)&&retry===0)continue;
   if(r.status!==200)throw new AulaError('AULA_WIDGET_UNAVAILABLE',502);
   const rows=JSON.parse(r.body);if(!Array.isArray(rows))throw new AulaError('AULA_PROVIDER_FORMAT',502);return rows;
  }throw new AulaError('AULA_WIDGET_UNAVAILABLE',502);
 }
}
export function relevantChildren(row:RecordData,children:Child[],text:string):{children:Child[];explicit:boolean}{
 const ids=[...(row.belongsToProfiles??[]),...(row.childIds??[]),...(row.recipientInstitutionProfileIds??[])].map((x:any)=>String(typeof x==='object'?x.id:x));
 const groups=(row.groups??row.recipientGroups??[]).map((x:any)=>String(x.name??x).toLocaleLowerCase('da'));
 if(ids.length)return {children:children.filter(c=>ids.includes(c.id)),explicit:true};
 if(groups.length)return {children:children.filter(c=>c.groups.some(g=>groups.includes(g.toLocaleLowerCase('da')))||groups.includes(c.className.toLocaleLowerCase('da'))),explicit:true};
 const classes=[...text.matchAll(/\b(\d{1,2})\s*\.?\s*([a-d])(?:\b|(?=[,;]))/gi)].map(m=>`${m[1]}.${m[2]}`.toLowerCase());
 if(classes.length)return {children:children.filter(c=>classes.includes(c.className.replace(/\s/g,'').toLowerCase())),explicit:false};
 const grade=text.match(/\b(\d{1,2})\.?\s*årgang/i)?.[1];if(grade)return {children:children.filter(c=>c.className.match(/^\d+/)?.[0]===grade),explicit:false};
 const named=children.filter(c=>new RegExp(`\\b${c.name.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'iu').test(text));
 return {children:named.length?named:children,explicit:false};
}
function isoWeek(date:Date):string{const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));return String(Math.ceil((((d.getTime()-Date.UTC(d.getUTCFullYear(),0,1))/86400000)+1)/7));}
export async function collect(provider:ReadProvider,hid:string,mappings:RecordData[],lastSuccess:string|null,full=false,now=new Date(),report:(stage:string,counts:Record<string,number>,code?:string)=>void=()=>{}){
 const profiles=await provider.read('profiles.getProfilesByLogin');
 const ctx=await provider.read('profiles.getProfileContext',{portalrole:'guardian'});
 const rawChildren=(profiles?.profiles??[]).filter((p:RecordData)=>!p.portalRole||p.portalRole==='guardian').flatMap((p:RecordData)=>p.children??[]);
 const relations=[...(ctx?.institutionProfile?.relations??[]),...(ctx?.institutionProfiles??[]).flatMap((p:RecordData)=>p.relations??[])];
 const children:Child[]=[...new Map<string,RecordData>([...rawChildren,...relations.flatMap((r:RecordData)=>r.children??[])].map((c:RecordData)=>[String(c.id),c])).values()].slice(0,30).map((c:RecordData)=>{
  const key=sourceKey(hid,'child',String(c.id)),map=mappings.find(m=>m.provider_child_key===key);
  return {id:String(c.id),userId:String(c.userId??''),name:textOnly(c.name,120),school:textOnly(c.institutionProfile?.institutionName??relations.find((r:RecordData)=>r.children?.some((x:RecordData)=>x.id===c.id))?.institutionName,200),className:textOnly(c.mainGroup?.name??c.className,80),groups:[],key,personId:map?.person_id??null};
 });
 const counts:Record<string,number>={calendar:0,messages:0,meebook:0,posts:0,notifications:0,sensitive_skipped:0,unavailable:0,truncated:0};
 report('profiles.ok',{children:children.length});
 const groups=await provider.read('groups.getGroupsByContext',{'childInstitutionProfileIds[]':children.map(c=>c.id)});
 for(const group of Array.isArray(groups)?groups:groups?.groups??[]){for(const c of children){const members=group.childInstitutionProfileIds??group.institutionProfileIds??[];if(members.map(String).includes(c.id)){const name=textOnly(group.name,80);c.groups.push(name);if(/^\d{1,2}\.?\s*[a-z]$/i.test(name))c.className=name;}}}
 report('groups.ok',{children:children.length});
 const sources:Source[]=[];
 const add=(kind:Source['source_kind'],row:RecordData,id:unknown,title:unknown,body:unknown,start?:unknown,end?:unknown)=>{
  if(sensitive(row)){counts.sensitive_skipped++;return;}
  const text=textOnly(body),heading=textOnly(title,160);const scope=relevantChildren(row,children,heading+' '+text);
  const people=scope.children.map(c=>c.personId).filter((id):id is string=>Boolean(id));if(!people.length)return;
  const s=localDateTime(start),e=localDateTime(end);const stamp=row.updatedAt??row.updated??row.sendDateTime??row.timestamp??row.publishAt??now.toISOString();
  sources.push({source_key:sourceKey(hid,kind,String(id)),source_kind:kind,title:heading,text,updated_at:Number.isFinite(Date.parse(stamp))?new Date(stamp).toISOString():now.toISOString(),person_ids:people,date:s.date,time:row.allDay?null:s.time,end_date:e.date,end_time:row.allDay?null:e.time,location:textOnly(row.location?.name??row.location??row.primaryResource?.name,200),explicit_scope:scope.explicit});counts[kind==='message'?'messages':kind==='post'?'posts':kind==='notification'?'notifications':kind]++;
 };
 const start=new Date(now.getTime()-2*864e5),end=new Date(now.getTime()+14*864e5);
 const events=children.length?await provider.read('calendar.getEventsByProfileIdsAndResourceIds',{}, {instProfileIds:children.map(c=>Number(c.id)),resourceIds:[],start:start.toISOString(),end:end.toISOString()}):[];
 if((events?.length??0)>300)counts.truncated+=events.length-300;
 for(const e of (events??[]).slice(0,300))add('calendar',e,e.id??`${e.startDateTime}:${e.title}`,e.title,e.description,e.startDateTime,e.endDateTime);
 report('calendar.ok',{events:events?.length??0,sources:counts.calendar});
 const cutoff=new Date(Math.max(now.getTime()-14*864e5,!full&&lastSuccess?Date.parse(lastSuccess)-864e5:0)).toISOString();
 for(let page=0;page<3;page++){
  const batch=await provider.read('messaging.getThreads',{page:String(page),sortOn:'date',orderDirection:'desc'});let old=false;
  for(const thread of batch?.threads??[]){
   if(sensitive(thread)){counts.sensitive_skipped++;continue;}
   const stamp=thread.latestMessage?.sendDateTime??thread.lastMessage?.sendDateTime;if(stamp&&new Date(stamp).toISOString()<cutoff){old=true;continue;}
   try{for(let p=0;p<3;p++){
    const data=await provider.read('messaging.getMessagesForThread',{threadId:String(thread.id),page:String(p)});
    for(const m of data?.messages??[]){if(m.sendDateTime&&new Date(m.sendDateTime).toISOString()<cutoff)continue;add('message',{...thread,...m},m.id??`${thread.id}:${m.sendDateTime}`,m.subject??data.subject??thread.subject,m.text?.plain??m.text?.html??m.text);}
    if(!data?.moreMessagesExist)break;if(p===2)counts.truncated++;
   }}catch(e){if(e instanceof AulaError&&e.code==='AULA_SENSITIVE_SKIPPED'){counts.sensitive_skipped++;}else throw e;}
  }
  if(!batch?.moreMessagesExist||old)break;if(page===2)counts.truncated++;
 }
 report('messages.ok',{sources:counts.messages,sensitive_skipped:counts.sensitive_skipped});
 const optional=async(name:string,fn:()=>Promise<void>)=>{try{await fn();report(name+'.ok',{sources:counts[name]??0});}catch(e){report(name+'.failed',{},safeError(e).code);if(e instanceof AulaError&&e.code==='AULA_ACCESS_EXPIRED')throw e;counts.unavailable++;}};
 await optional('posts',async()=>{const posts=await provider.read('posts.getAllPosts',{parent:'profile',index:'0',limit:'50',isUnread:'false','institutionProfileIds[]':children.map(c=>c.id)});for(const p of posts?.posts??[])if((p.publishAt??p.timestamp??cutoff)>=cutoff)add('post',p,p.id,p.title,p.content?.html);});
 await optional('notifications',async()=>{const ns=await provider.read('notifications.getNotificationsForActiveProfile');counts.notifications=(Array.isArray(ns)?ns:ns?.notifications??[]).length;});
 const widgets=ctx?.pageConfiguration?.widgetConfigurations??[];
 if(widgets.some((w:RecordData)=>(w.widget?.widgetId??w.widgetId)==='0004'))await optional('meebook',async()=>{
  for(const offset of [0,7])for(const person of await provider.meebook(ctx,children,isoWeek(new Date(now.getTime()+offset*864e5)))){
   const child=children.find(c=>c.userId===String(person.unilogin??'')||c.id===String(person.id??''));if(!child)continue;
   for(const day of person.weekPlan??[])for(const task of day.tasks??[])add('meebook',{belongsToProfiles:[child.id]},task.id??`${child.id}:${day.date}:${task.title??task.type}:${task.pill??''}`,task.title??task.pill,task.content,day.date);
  }
 });
 else report('meebook.skipped',{sources:0});
 if(sources.length>300)counts.truncated+=sources.length-300;
 return {children:children.map(c=>({provider_child_key:c.key,display_name:c.name,school:c.school,class_name:c.className,group_names:c.groups})),sources:sources.slice(0,300),counts,api_version:provider.version};
}
