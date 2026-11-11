import {createClient} from '@supabase/supabase-js';
import {setTimeout as delay} from 'node:timers/promises';
import type {IncomingMessage,ServerResponse} from 'node:http';
import QRCode from 'qrcode';
import {AulaLoginClient,type AulaLoginOptions} from './vendor/aula-login-client.ts';
import {AulaHttpClient} from './vendor/http.ts';
import {type AulaTokens} from './vendor/aula-oauth.ts';
import {ReadProvider,collect,refreshSession,type RecordData} from './provider.ts';
import {AulaError,equalSecret,key,safeError,seal,sourceKey,unseal,uuid,type Envelope} from './security.ts';
import {validateAnalysis,ANALYSIS_ERRORS,type AnalysisSource,type AnalysisFinding,findExisting,normalizedTitle,samePlanningEvent} from './analysis.ts';
import {hostedSseProbe,openEventStream} from './hosted-probe.ts';
import {analyzeBatches} from './scan-analysis.ts';
import {diagnoseMeeBook,referenceExample} from './meebook-diagnostics.ts';
import {retainStructuredTasks} from './meebook.ts';
import {scanSources} from './scan-status.ts';
export type Request=IncomingMessage & {body?:unknown};
type RPC=(action:string,hid:string,uid:string|null,payload?:RecordData)=>Promise<any>;
type Dependencies={log?:(event:RecordData)=>void;rpc?:RPC;authorize?:(req:Request,hid:string)=>Promise<string>;login?:(opts:AulaLoginOptions)=>Promise<AulaTokens>;refresh?:typeof refreshSession;collect?:typeof collect;analyze?:(sources:AnalysisSource[],signal:AbortSignal)=>Promise<AnalysisFinding[]>;items?:(hid:string)=>Promise<RecordData[]>;timeoutMs?:number};
export function adminClient(){const url=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!k)throw new AulaError('AULA_NOT_CONFIGURED',503);return createClient(url,k,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});}
export const rpc:RPC=async(action,hid,uid,payload={})=>{
 const {data,error}=action==='diagnostic_release'?await adminClient().rpc('aula_diagnostic_release',{p_household_id:hid,p_lease:payload.lease}):await adminClient().rpc('aula_server',{p_action:action,p_household_id:hid,p_user_id:uid,p_payload:payload});
 if(error){const code=error.message.match(/\bAULA_(FORBIDDEN|BUSY|RATE_LIMIT|FLOW_EXPIRED|INVALID_IDENTITY|REAUTH_REQUIRED|LEASE_EXPIRED|UNMAPPED_PERSON)\b/)?.[0]??'AULA_STORAGE_ERROR';throw new AulaError(code,code==='AULA_FORBIDDEN'?403:code==='AULA_RATE_LIMIT'?429:409);}return data;
};
export async function authorize(req:Request,hid:string):Promise<string>{
 const header=req.headers.authorization;if(typeof header!=='string'||!header.startsWith('Bearer '))throw new AulaError('AULA_UNAUTHORIZED',401);
 const db=adminClient();const {data,error}=await db.auth.getUser(header.slice(7));
 if(error||!data.user||data.user.is_anonymous)throw new AulaError('AULA_UNAUTHORIZED',401);
 const {data:member,error:membershipError}=await db.from('household_members').select('role').eq('household_id',hid).eq('user_id',data.user.id).maybeSingle();
 if(membershipError||!member||!['owner','admin','adult'].includes(member.role))throw new AulaError('AULA_FORBIDDEN',403);return data.user.id;
}
export async function body(req:Request,maxBytes=4096):Promise<RecordData>{
 if(Number(req.headers['content-length']??0)>maxBytes)throw new AulaError('INVALID_REQUEST',413);
 let value=req.body;
 if(value===undefined){const chunks:Buffer[]=[];let size=0;for await(const part of req){const chunk=Buffer.isBuffer(part)?part:Buffer.from(part);size+=chunk.length;if(size>maxBytes)throw new AulaError('INVALID_REQUEST',413);chunks.push(chunk);}value=Buffer.concat(chunks).toString('utf8');}
 if(typeof value==='string'){if(Buffer.byteLength(value)>maxBytes)throw new AulaError('INVALID_REQUEST',413);try{value=JSON.parse(value);}catch{throw new AulaError('INVALID_REQUEST');}}
 if(!value||typeof value!=='object'||Array.isArray(value)||Buffer.byteLength(JSON.stringify(value))>maxBytes)throw new AulaError('INVALID_REQUEST');return value as RecordData;
}
function json(res:ServerResponse,status:number,value:unknown){res.statusCode=status;res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.end(JSON.stringify(value));}
async function analyze(sources:AnalysisSource[],signal:AbortSignal){
 const secret=process.env.AULA_ANALYZE_SECRET,url=process.env.SUPABASE_URL;if(!secret||secret.length<32||!url)throw new AulaError('AULA_NOT_CONFIGURED',503);
 const response=await fetch(`${url}/functions/v1/aula-analyze`,{method:'POST',headers:{'x-aula-analyze-secret':secret,'content-type':'application/json'},body:JSON.stringify({sources}),signal:AbortSignal.any([signal,AbortSignal.timeout(50_000)])});
 if(!response.ok){const data=await response.json().catch(()=>({}));throw new AulaError(ANALYSIS_ERRORS.has(data?.code)?data.code:[401,403].includes(response.status)?'AULA_ANALYSIS_AUTH_FAILED':'AULA_ANALYSIS_UNAVAILABLE',502);}return validateAnalysis(await response.json(),sources);
}
async function items(hid:string){const {data,error}=await adminClient().from('calendar_items').select('id,title,date,time,type,person_ids,location,data').eq('household_id',hid).gte('date',new Date(Date.now()-7*864e5).toISOString().slice(0,10)).limit(1000);if(error)throw new AulaError('AULA_STORAGE_ERROR',502);return data??[];}
export function makeHandlers(deps:Dependencies={}){
 const call=deps.rpc??rpc,auth=deps.authorize??authorize;
 const simple=(fn:(p:RecordData,hid:string,uid:string)=>Promise<unknown>)=>async(req:Request,res:ServerResponse)=>{
  try{if(req.method!=='POST')throw new AulaError('METHOD_NOT_ALLOWED',405);const p=await body(req),hid=uuid(p.household_id),uid=await auth(req,hid);json(res,200,await fn(p,hid,uid));}catch(e){const error=safeError(e);json(res,error.status,{code:error.code});}
 };
 const status=simple((_p,h,u)=>call('status',h,u));
 const identity=simple((p,h,u)=>call('identity_choose',h,u,{flow_id:uuid(p.flow_id),index:Number.isInteger(p.index)?p.index:0}));
 const disconnect=simple((_p,h,u)=>call('disconnect',h,u));
 const connect=async(req:Request,res:ServerResponse)=>{
  let hid='',uid='',flow='',complete=false,heartbeat:ReturnType<typeof setInterval>|undefined;const abort=new AbortController();
  const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(deps.timeoutMs??270_000)]);
  const emit=(event:string,data:unknown)=>{if(!res.destroyed&&!res.writableEnded)res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};
  const cancel=()=>{if(!complete)abort.abort(new DOMException('Cancelled','AbortError'));};req.once('aborted',cancel);res.once('close',cancel);
  try{
   if(req.method!=='POST')throw new AulaError('METHOD_NOT_ALLOWED',405);
   if(req.headers['x-aula-probe']==='sse-v1'){await hostedSseProbe(req,res,await body(req));return;}
   key('AULA_SESSION_ENCRYPTION_KEY');key('AULA_HMAC_KEY');
   const p=await body(req);hid=uuid(p.household_id);uid=await auth(req,hid);
   if(typeof p.username!=='string'||p.username.length<2||p.username.length>128||/[\r\n\x00]/.test(p.username)||p.password!==undefined)throw new AulaError('INVALID_REQUEST');
   if(!deps.login)throw new AulaError('AULA_LOGIN_BLOCKED',409);
   const username=p.username;delete p.username;req.body=undefined;
   flow=(await call('begin',hid,uid)).flow_id;
   openEventStream(res);
   emit('waiting',{flow_id:flow});heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},10_000);
   let identityLabel:string|undefined;
   const http=new AulaHttpClient({signal});
   const login=deps.login??((opts:AulaLoginOptions)=>new AulaLoginClient({http}).login(opts));
   const tokens=await login({username,method:'APP',signal,maxPollMs:240_000,
    appCallbacks:{onWaiting:()=>emit('waiting',{flow_id:flow}),onOtp:otp=>emit('otp',{otp}),onVerified:()=>emit('verified',{}),onQr:async q=>{const options={type:'svg' as const,errorCorrectionLevel:'M' as const,margin:2};const [svg1,svg2]=await Promise.all([QRCode.toString(q.qr1Json,options),QRCode.toString(q.qr2Json,options)]);emit('qr',{svg1,svg2,refreshCount:q.updateCount});}},
    selectIdentity:async options=>{
     await call('identity_wait',hid,uid,{flow_id:flow,count:options.length});emit('identity',{flow_id:flow,options:options.map(o=>({index:o.index,name:o.name.slice(0,120)}))});
     for(;;){signal.throwIfAborted();const selected=(await call('flow',hid,uid,{flow_id:flow})).selected_identity;if(selected){const option=options.find(o=>o.index===selected);if(!option)throw new AulaError('AULA_INVALID_IDENTITY');identityLabel=option.name;emit('identity-selected',{});return selected;}await delay(750,undefined,{signal});}
    }});
   signal.throwIfAborted();
   await call('finish',hid,uid,{flow_id:flow,identity_label:identityLabel,encrypted_session:seal(hid,{refresh_token:tokens.refresh_token})});
   complete=true;emit('success',{connected:true});
  }catch(e){const error=safeError(e);if(flow)await call('cancel',hid,uid,{flow_id:flow,error:error.code}).catch(()=>{});if(res.headersSent)emit('error',{code:error.code});else json(res,error.status,{code:error.code});}
  finally{complete=true;clearInterval(heartbeat);abort.abort();req.off('aborted',cancel);res.off('close',cancel);if(!res.writableEnded)res.end();}
 };
 const scan=async(req:Request,res:ServerResponse)=>{
  let hid='',uid:string|null=null,lease='',traceHash='',stage='start';const started=Date.now();const log=(name:string,counts:Record<string,number>={},code?:string)=>{if(!traceHash)return;try{(deps.log??(event=>console.info(JSON.stringify(event))))({stage:'aula.scan.'+name,counts,duration_ms:Date.now()-started,household_hash:traceHash,...(code?{code}:{})});}catch{}};const abort=new AbortController();const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(deps.timeoutMs??240_000)]);
  const cancel=()=>abort.abort();res.once('close',cancel);
  try{
   if(req.method!=='POST')throw new AulaError('METHOD_NOT_ALLOWED',405);const p=await body(req);hid=uuid(p.household_id);
   const serverSecret=req.headers['x-aula-sync-secret'];
   if(serverSecret!==undefined){if(!equalSecret(typeof serverSecret==='string'?serverSecret:undefined,process.env.AULA_SYNC_SECRET))throw new AulaError('AULA_UNAUTHORIZED',401);}else uid=await auth(req,hid);
   key('AULA_SESSION_ENCRYPTION_KEY');key('AULA_HMAC_KEY');
   traceHash=sourceKey(hid,'scan-log','household').slice(0,16);log('start');stage='refresh';
   const claim=await call('scan_claim',hid,uid);lease=claim.lease;
   const saved=unseal<{refresh_token:string}>(hid,claim.encrypted_session as Envelope);if(typeof saved.refresh_token!=='string')throw new AulaError('AULA_SESSION_INVALID',409);
   const http=new AulaHttpClient({signal}),tokens=await(deps.refresh??refreshSession)(http,saved.refresh_token);
   // Persist rotation BEFORE any subsequent reads or AI call can fail.
   await call('scan_save_session',hid,uid,{lease,encrypted_session:seal(hid,{refresh_token:tokens.refresh_token})});
   log('refresh.ok');stage='collect';
   if(p.diagnostic==='meebook-structure'){
    stage='diagnostic';await diagnoseMeeBook(new ReadProvider(tokens.access_token,http,log),log);
    await call('diagnostic_release',hid,uid,{lease});lease='';log('diagnostic.finish.ok');json(res,200,{diagnostic:'complete'});return;
   }
   const data=await(deps.collect??collect)(new ReadProvider(tokens.access_token,http,log),hid,claim.mappings,claim.last_success_at,p.full===true,new Date(),log,signal);
   stage='analysis';
   const existing=await(deps.items??items)(hid);const findings:RecordData[]=[],referenceRows:{source_key:string;person_ids:string[];date:string|null}[]=[];const seen=new Set<string>(),events:AnalysisFinding[]=[];
   const analysisStart=Date.now(),analyzed=await analyzeBatches(data.sources,deps.analyze??analyze,signal,log,Math.max(1,215_000-(Date.now()-started)));
   data.counts.ai_batches=analyzed.length;data.counts.ai_failed_batches=analyzed.filter(r=>r.error).length;data.counts.analysis_duration_ms=Date.now()-analysisStart;
   data.counts.ai_failed_sources=analyzed.filter(r=>r.error).reduce((n,r)=>n+r.batch.length,0);
   if(data.counts.ai_failed_batches)data.counts.partial=1;
   log(data.counts.ai_failed_batches?'analysis.partial':'analysis.ok',{sources:data.sources.length,batches:analyzed.length,failed_batches:data.counts.ai_failed_batches,stage_ms:data.counts.analysis_duration_ms});
   for(const {batch,results,error} of analyzed){signal.throwIfAborted();
    const retained=retainStructuredTasks(batch,results);data.counts.structured_tasks_retained=(data.counts.structured_tasks_retained??0)+retained.retained;
    data.counts.general_meebook_filtered=(data.counts.general_meebook_filtered??0)+(error?0:batch.filter(s=>s.source_kind==='meebook'&&s.structured_type==='comment'&&!retained.results.some(f=>f.source_key===s.source_key&&f.actionability!=='GENERAL_INFO'&&f.proposed_action!=='NO_ACTION'&&f.confidence!=='LOW')).length);
    for(const f of retained.results){
     if(f.proposed_action==='NO_ACTION'||f.actionability==='GENERAL_INFO'||f.confidence==='LOW')continue;
     // Old messages remain inputs for future plans, not for recreating expired reminders.
     const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Copenhagen'}).format(new Date());
     if(f.date&&f.date<today)continue;
     if(events.some(e=>samePlanningEvent(e,f)))continue;
     if(f.actionability==='ATTEND')events.push(f);
     const s=batch.find(s=>s.source_key===f.source_key)!;const people=[...f.person_ids].sort();const match=findExisting(f,people,existing);
     const identity=`${people.join(',')}:${['CALENDAR_EVENT','TRIP'].includes(f.type)?'event':f.type}:${f.date}:${f.time}:${normalizedTitle(f.title)}`;
     if(seen.has(identity))continue;seen.add(identity);
     const {evidence:_discardedEvidence,...safeFinding}=f;
     findings.push({...safeFinding,person_ids:people,person_id:people.length===1?people[0]:null,source_kind:s.source_kind,source_key:sourceKey(hid,'finding',`${s.source_key}:${people.join(',')}:${f.type}:${normalizedTitle(f.title)}`),source_updated_at:s.updated_at,proposed_action:match?'MATCH_EXISTING':f.proposed_action});
     if(s.source_kind==='meebook'&&referenceExample(s.text))referenceRows.push({source_key:findings.at(-1)!.source_key,person_ids:people,date:s.date});
     if(s.source_kind==='meebook'&&s.structured_type==='task')data.counts.structured_task_findings=(data.counts.structured_task_findings??0)+1;
     if(f.type==='HOMEWORK'||f.type==='DEADLINE')data.counts.homework_findings=(data.counts.homework_findings??0)+1;
     const category='action_'+f.actionability;data.counts[category]=(data.counts[category]??0)+1;
    }
   }
   stage='finish';const finishStart=Date.now();data.counts.scan_duration_ms=Date.now()-started;await call('scan_finish',hid,uid,{lease,children:data.children,findings,counts:data.counts,api_version:data.api_version});lease='';
   // Read-only verification of the user-supplied acceptance example. Only safe
   // counts reach logs. A diagnostic read can never turn a saved scan into failure.
   if(referenceRows.length&&!deps.rpc)try{
    const {data:stored,error}=await adminClient().from('aula_findings').select('source_key,status,date,person_ids').eq('household_id',hid).in('source_key',referenceRows.slice(0,8).map(r=>r.source_key)).abortSignal(AbortSignal.timeout(5000));
    if(error)throw new AulaError('AULA_STORAGE_ERROR');
    log('reference.review',{emitted:referenceRows.length,stored:stored?.length??0,new:stored?.filter(r=>r.status==='new').length??0,reviewed:stored?.filter(r=>['accepted','ignored'].includes(r.status)).length??0,date_matches:stored?.filter(r=>r.date&&referenceRows.some(e=>e.source_key===r.source_key&&e.date===r.date)).length??0,people_match:stored?.filter(r=>referenceRows.some(e=>e.source_key===r.source_key&&[...e.person_ids].sort().join()===Object.values(r.person_ids??[]).sort().join())).length??0});
   }catch{log('reference.verify.failed',{},'AULA_STORAGE_ERROR');}
   log('finish.ok',{...data.counts,children:data.children.length,findings:findings.length,stage_ms:Date.now()-finishStart});json(res,200,{status:data.counts.partial?'PARTIAL_SUCCESS':'SUCCESS',sources:scanSources(data.counts),counts:data.counts,findings:findings.length});
  }catch(e){const error=safeError(e);log(stage+'.failed',{},error.code);if(lease)await call('scan_fail',hid,uid,{lease,error:error.code}).catch(()=>{});json(res,error.status,{code:error.code});}
  finally{res.off('close',cancel);abort.abort();}
 };
 return {connect,identity,status,disconnect,scan};
}
