import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {calendarPrefilter} from '../server/aula/calendar-filter.ts';
import {isoWeek,collect,sourceChunks} from '../server/aula/collection.ts';
import {ReadProvider,textOnly} from '../server/aula/provider.ts';
import {AulaHttpClient} from '../server/aula/vendor/http.ts';
import {sourceKey,seal,AulaError} from '../server/aula/security.ts';
import {validateAnalysis,samePlanningEvent,ANALYSIS_INSTRUCTIONS} from '../server/aula/analysis.ts';
import {makeHandlers} from '../server/aula/service.ts';
import {ids,source,analyzed} from './fixtures/aula.js';
process.env.AULA_HMAC_KEY=randomBytes(32).toString('base64');process.env.AULA_SESSION_ENCRYPTION_KEY=randomBytes(32).toString('base64');
const now=new Date('2026-11-09T12:00:00Z');
const lesson=(date,extra={})=>({id:date,title:'Værksted Z',type:'lesson',lesson:{lessonId:'synthetic',lessonStatus:'normal'},belongsToProfiles:[101],primaryResource:{name:'Lokale A'},startDateTime:date+'T08:00:00+01:00',endDateTime:date+'T08:45:00+01:00',...extra});
test('Routine metadata and learned weekly baseline filter lessons without depending on a subject list',()=>{
 const rows=['2026-10-26','2026-11-02','2026-11-09','2026-11-16'].map(d=>lesson(d));
 let result=calendarPrefilter(rows,now);assert.equal(result.raw,2);assert.equal(result.routine,2);assert.equal(result.candidates.length,0);
 result=calendarPrefilter(rows.map(({lesson,type,...r})=>r),now);assert.equal(result.routine,2);
 const one=calendarPrefilter([lesson('2026-11-09',{title:'Matematik'})],now);assert.equal(one.routine,1);
});
test('Exceptional events, cancellation, practical lesson notes and changes to learned time/location survive',()=>{
 const baseline=['2026-10-26','2026-11-02'].map(d=>lesson(d));
 for(const changed of [{primaryResource:{name:'Svømmehallen'}},{startDateTime:'2026-11-09T10:00:00+01:00',endDateTime:'2026-11-09T10:45:00+01:00'},{lesson:{lessonId:'synthetic',lessonStatus:'cancelled'}},{description:'Husk gummistøvler'},{title:'Tur til Louisiana'}])assert.equal(calendarPrefilter([...baseline,lesson('2026-11-09',changed)],now).candidates.length,1);
 const trip=lesson('2026-11-09',{type:'event',lesson:null,title:'Porteføljesamtale'});assert.equal(calendarPrefilter([trip],now).routine,0);
});
test('ISO week is year-qualified including Copenhagen and ISO year boundaries',()=>{
 assert.equal(isoWeek(now),'2026-W46');assert.equal(isoWeek(new Date('2027-01-01T12:00:00Z')),'2026-W53');assert.equal(isoWeek(new Date('2027-01-04T12:00:00Z')),'2027-W01');
});
test('Long newsletters retain late actionable paragraphs within bounded AI chunks',()=>{
 const late='3.C skal huske tuscher torsdag.',chunks=sourceChunks('<p>'+('Earlier text '.repeat(600))+'</p><p>'+late+'</p>');
 assert.ok(chunks.length>1);assert.ok(chunks.every(s=>s.length<=6000));assert.ok(chunks.some(s=>s.includes(late)));assert.throws(()=>sourceChunks('x'.repeat(120001)),/AULA_SOURCE_TOO_LARGE/);
});
test('MeeBook uses opaque child filters, context institutions and guardian session; expired token body retries once',async()=>{
 let widgets=0,plans=0;const calls=[];
 const http=new AulaHttpClient({fetcher:async(url,init)=>{const u=new URL(url);calls.push(u.hostname);if(u.hostname==='www.aula.dk'){widgets++;return Response.json({status:{code:0},data:'synthetic-widget-'+widgets})}
  assert.equal(u.searchParams.get('currentWeekNumber'),'2026-W46');assert.deepEqual(u.searchParams.getAll('childFilter[]'),['opaque-child']);assert.deepEqual(u.searchParams.getAll('institutionFilter[]'),['school']);assert.equal(init.headers.sessionuuid,'guardian');
  return ++plans===1?Response.json({message:'JWT-Token expired, please renew.'}):Response.json([{weekPlan:[]}]);
 }});
 const rows=await new ReadProvider('synthetic',http).meebook({userId:'guardian',institutions:[{institutionCode:'school'}]},[{userId:'opaque-child'}],'2026-W46');assert.equal(rows.length,1);assert.equal(widgets,2);assert.equal(plans,2);
 await assert.rejects(()=>new ReadProvider('synthetic',http).meebook({},[],'46'),/AULA_WIDGET_CONTEXT/);
});
const fixture=()=>{const calls=[];return {calls,api:{version:25,read:async(method,p)=>{calls.push({method,p});switch(method){
 case 'profiles.getProfilesByLogin':return {profiles:[{portalRole:'guardian',institutionProfiles:[{id:10}],children:[{id:101,profileId:201,userId:'opaque',name:'Synthetic'}]}]};
 case 'profiles.getProfileContext':return {userId:'guardian',institutions:[{institutionProfileId:10,institutionCode:'school',children:[{id:101,profileId:201,userId:'opaque'}]}],pageConfiguration:{widgetConfigurations:[{widget:{widgetId:'0004'}}]}};
 case 'groups.getGroupsByContext':return [{profileId:201,groups:[{id:30,name:'3.C'}]}];
 case 'messaging.getThreads':return {threads:[{id:'sensitive',isSensitive:true},{id:'one',latestMessage:{sendDateTime:'2026-11-08T10:00:00Z'}}]};
 case 'messaging.getMessagesForThread':return {messages:[{id:'old-future',sendDateTime:'2026-10-10T10:00:00Z',text:{html:'<p>3.C skal have varmt tøj med 12. november.</p>'}},{id:'too-old',sendDateTime:'2026-09-01T10:00:00Z',text:'ignore'}]};
 case 'posts.getAllPosts':assert.deepEqual(p['institutionProfileIds[]'],['10','101']);assert.equal(p.isUnread,undefined);return {posts:[{id:'post',title:'Ugeplan',publishAt:'2026-10-20T10:00:00Z',sharedWithGroups:[{id:30,name:'3.C'}],content:{html:'Husk tuscher torsdag'}}]};
 case 'notifications.getNotificationsForActiveProfile':return [{postId:'post'}];
 case 'calendar.getEventsByProfileIdsAndResourceIds':return [lesson('2026-11-09')];
 default:throw Error('Unexpected read');
 }},meebook:async()=>[{unilogin:'opaque',weekPlan:[{date:'2026-11-12',tasks:[{title:'Læs',content:'Læs side 42'}]}]}]}};};
test('Full 45-day history ignores old success cursor, includes overview scopes, exact source dates, groups, MeeBook, filters calendar before AI',async()=>{
 const {api,calls}=fixture();const data=await collect(api,ids.household,[{provider_child_key:sourceKey(ids.household,'child','101'),person_id:ids.ida}],'2026-11-09T10:00:00Z',false,now);
 assert.equal(data.counts.messages,1);assert.equal(data.sources.find(s=>s.source_kind==='message').updated_at,'2026-10-10T10:00:00.000Z');assert.equal(data.counts.posts,1);assert.equal(data.counts.meebook,1);assert.equal(data.counts.routine_calendar_filtered,1);assert.equal(data.counts.calendar,0);assert.equal(data.children[0].class_name,'3.C');assert.equal(data.counts.sensitive_skipped,1);assert.ok(!calls.some(c=>c.p?.threadId==='sensitive'));
});
test('MeeBook failure blocks a falsely successful scan instead of silently dropping weekplans',async()=>{
 const {api}=fixture();api.meebook=async()=>{throw new AulaError('AULA_WIDGET_UNAVAILABLE',502)};await assert.rejects(()=>collect(api,ids.household,[],null,true,now),/AULA_WIDGET_UNAVAILABLE/);
});
test('Shared source keeps only the class in the actual evidence sentence; all-year notices include the child',()=>{
 const s={...source,title:'Årgang',text:'3.A skal huske maling. 3.B skal medbringe pap. 3.C skal have tuscher med.',person_scopes:[{person_id:ids.ida,class_name:'3.C'}]};
 const rows=validateAnalysis({findings:[{...analyzed,evidence:'3.A skal huske maling.',title:'Maling'},{...analyzed,evidence:'3.C skal have tuscher med.',title:'Tuscher'}]},[s]);assert.equal(rows.length,1);assert.equal(rows[0].title,'Tuscher');
 const whole={...s,text:'Hele 3. årgang skal have pap med.'};assert.equal(validateAnalysis({findings:[{...analyzed,evidence:whole.text}]},[whole]).length,1);
 assert.throws(()=>validateAnalysis({findings:[{...analyzed,evidence:'invented'}]},[s]),/AULA_ANALYSIS_INVALID_EVIDENCE/);
});
test('Unknown timestamps cannot anchor relative dates to today; ordinary information is no action, important changes survive',()=>{
 const [unknown]=validateAnalysis({findings:[analyzed]},[{...source,source_timestamp_known:false}]);assert.equal(unknown.date,null);assert.equal(unknown.confidence,'MEDIUM');
 const [noise,important]=validateAnalysis({findings:[{...analyzed,actionability:'GENERAL_INFO'},{...analyzed,type:'GENERAL_INFO',actionability:'IMPORTANT_INFO'}]},[source]);assert.equal(noise.proposed_action,'NO_ACTION');assert.equal(important.proposed_action,'CREATE_ACTIVITY');
 for(const rule of ['DO NOT create findings for ordinary lessons','NEVER scan/server date','zero, one or several'])assert.ok(ANALYSIS_INSTRUCTIONS.includes(rule));
 assert.equal(textOnly('<p>3.A maling</p><p>3.C tuscher</p>'),'3.A maling\n3.C tuscher');
});
test('Cross-source event dedupe keeps practical bring reminders separate from the trip',()=>{
 const a={...analyzed,title:'Tur til København',actionability:'ATTEND'},b={...a,title:'Tur til København med 3.C'};assert.equal(samePlanningEvent(a,b),true);assert.equal(samePlanningEvent(a,{...b,actionability:'BRING',title:'Husk madpakke'}),false);assert.equal(samePlanningEvent(a,{...b,date:'2026-11-12'}),false);
});
test('Scan never persists evidence, general information, raw source bodies or automatic activities',async()=>{
 const calls=[],handlers=makeHandlers({log:()=>{},authorize:async()=>ids.adult,rpc:async(action,h,u,p)=>{calls.push({action,p});return action==='scan_claim'?{lease:ids.flow,encrypted_session:seal(ids.household,{refresh_token:'synthetic'}),mappings:[]}:{}},refresh:async()=>({access_token:'synthetic',refresh_token:'synthetic'}),collect:async()=>({sources:[source],children:[],counts:{},api_version:25}),items:async()=>[],analyze:async()=>[analyzed,{...analyzed,actionability:'GENERAL_INFO',title:'Tak'}]});
 const req=Object.assign(new EventEmitter(),{method:'POST',headers:{},body:{household_id:ids.household}}),res=Object.assign(new EventEmitter(),{setHeader(){},end(){}});await handlers.scan(req,res);assert.equal(res.statusCode,200);const payload=calls.find(c=>c.action==='scan_finish').p;assert.equal(payload.findings.length,1);assert.equal(payload.findings[0].evidence,undefined);assert.equal(payload.counts.action_BRING,1);assert.equal(payload.findings[0].status,undefined);assert.ok(calls.every(c=>!c.action.includes('accept')));
});
