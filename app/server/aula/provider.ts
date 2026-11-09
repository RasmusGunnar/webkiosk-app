// Read API and MeeBook protocol adapted from aula-mcp at the SHA in docs/aula-third-party.md.
// No generic API escape hatch, mark-as-read, presence or other mutation method.
import {load} from 'cheerio';
import {AulaHttpClient} from './vendor/http.ts';
import {DEFAULT_OAUTH_CONFIG,oauthUrls,parseTokenResponse,type AulaTokens} from './vendor/aula-oauth.ts';
import {AulaError} from './security.ts';
export type RecordData=Record<string,any>; // Untrusted provider boundary; normalize before storage/AI.
export type Child={profileId?:string;institutionCode?:string;groupIds?:string[];id:string;userId:string;name:string;school:string;className:string;groups:string[];key:string;personId:string|null};
export type Source={source_key:string;source_kind:'calendar'|'message'|'meebook'|'post'|'notification';title:string;text:string;updated_at:string;person_ids:string[];date:string|null;time:string|null;end_date:string|null;end_time:string|null;location:string;explicit_scope:boolean;source_timestamp_known?:boolean;person_scopes?:{person_id:string;class_name:string}[];calendar_exception?:boolean};
const READS=new Map([
 ['profiles.getProfilesByLogin','GET'],['profiles.getProfileContext','GET'],['groups.getGroupsByContext','GET'],
 ['calendar.getEventsByProfileIdsAndResourceIds','POST'],['messaging.getThreads','GET'],['messaging.getMessagesForThread','GET'],
 ['notifications.getNotificationsForActiveProfile','GET'],['posts.getAllPosts','GET'],['aulaToken.getAulaToken','GET'],
]);
export function textOnly(value:unknown,max=6000):string{if(typeof value!=='string')return '';const $=load(value);$('script,style,iframe,img').remove();$('br').replaceWith('\n');$('p,li,div').append('\n');return $.text().replace(/[^\S\n]+/g,' ').replace(/\n{3,}/g,'\n\n').trim().slice(0,max);}
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
 constructor(token:string,http:AulaHttpClient,privateReport:(stage:string,counts:Record<string,number>,code?:string)=>void=()=>{}){this.token=token;this.http=http;this.report=privateReport;}
 private report:(stage:string,counts:Record<string,number>,code?:string)=>void;
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
   if(r.status!==200||envelope.status?.code){if(method==='aulaToken.getAulaToken'){this.report('widget_token.failed',{http:r.status,envelope_code:Number(envelope.status?.code)||0},'AULA_WIDGET_TOKEN_UNAVAILABLE');throw new AulaError('AULA_WIDGET_TOKEN_UNAVAILABLE',502);}throw new AulaError('AULA_TEMPORARY_ERROR',502);}
   return envelope.data;
  }throw new AulaError('AULA_API_VERSION',502);
 }
 async meebook(ctx:RecordData,children:Child[],week:string):Promise<RecordData[]>{
  const q=new URLSearchParams({currentWeekNumber:week,userProfile:'guardian'});
  if(!/^\d{4}-W\d{2}$/.test(week)||children.some(c=>!c.userId))throw new AulaError('AULA_WIDGET_CONTEXT',502);
  for(const c of children)q.append('childFilter[]',c.userId);
  const relations=[...(ctx.institutions??[]),...(ctx.institutionProfile?.relations??[]),...(ctx.institutionProfiles??[]).flatMap((p:RecordData)=>p.relations??[])];
  for(const code of new Set([...relations.map((r:RecordData)=>r.institutionCode),...children.map(c=>c.institutionCode)].filter(Boolean).map(String)))q.append('institutionFilter[]',code);
  for(let retry=0;retry<2;retry++){
   const token=await this.read('aulaToken.getAulaToken',{widgetId:'0004'});
   if(typeof token!=='string')throw new AulaError('AULA_WIDGET_UNAVAILABLE',502);
   const r=await this.http.request(`https://app.meebook.com/aulaapi/relatedweekplan/all?${q}`,{method:'GET',headers:{authorization:`Bearer ${token}`,sessionuuid:String(ctx.userId??''),'x-version':'1.0',origin:'https://www.aula.dk',referer:'https://www.aula.dk/',accept:'application/json'}});
   this.report('meebook.response',{http:r.status});
   if(([401,403].includes(r.status)||/JWT[- ]Token expired|token has expired|unauthorized/i.test(r.body))&&retry===0)continue;
   if(r.status!==200)throw new AulaError(r.status===400?'AULA_MEEBOOK_BAD_REQUEST':'AULA_WIDGET_UNAVAILABLE',502);
   let rows:unknown;try{rows=JSON.parse(r.body);}catch{throw new AulaError('AULA_MEEBOOK_FORMAT',502);}if(!Array.isArray(rows))throw new AulaError('AULA_MEEBOOK_FORMAT',502);return rows;
  }throw new AulaError('AULA_WIDGET_UNAVAILABLE',502);
 }
}
export function relevantChildren(row:RecordData,children:Child[],text:string):{children:Child[];explicit:boolean}{
 const ids=[...(row.belongsToProfiles??[]),...(row.childIds??[]),...(row.recipientInstitutionProfileIds??[])].map((x:any)=>String(typeof x==='object'?x.id:x));
 const rawGroups=row.sharedWithGroups??row.groups??row.recipientGroups??[];
 const groups=rawGroups.map((x:any)=>String(x.name??x.groupName??x).toLocaleLowerCase('da'));
 const groupIds=rawGroups.map((x:any)=>String(x.id??x.groupId??'')).filter(Boolean);
 if(ids.length)return {children:children.filter(c=>ids.includes(c.id)),explicit:true};
 if(groups.length){const matches=children.filter(c=>c.groupIds?.some(id=>groupIds.includes(id))||c.groups.some(g=>groups.includes(g.toLocaleLowerCase('da')))||groups.includes(c.className.toLocaleLowerCase('da')));return {children:matches,explicit:true};}
 if(row.institutionCode)children=children.filter(c=>!c.institutionCode||c.institutionCode===String(row.institutionCode));
 const classes=[...text.matchAll(/\b(\d{1,2})\s*\.?\s*([a-z])(?:\b|(?=[,;]))/gi)].map(m=>`${m[1]}${m[2]}`.toLowerCase());
 if(classes.length)return {children:children.filter(c=>classes.includes(c.className.replace(/[.\s]/g,'').toLowerCase())),explicit:false};
 const grade=text.match(/\b(\d{1,2})\.?\s*årgang/i)?.[1];if(grade)return {children:children.filter(c=>c.className.match(/^\d+/)?.[0]===grade),explicit:false};
 const named=children.filter(c=>new RegExp(`\\b${c.name.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'iu').test(text));
 return {children:named.length?named:children,explicit:false};
}
export {collect} from './collection.ts';
