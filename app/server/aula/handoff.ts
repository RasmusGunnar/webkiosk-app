import {createHash,randomBytes} from 'node:crypto';
import type {ServerResponse} from 'node:http';
import {adminClient,authorize,body,type Request} from './service.ts';
import {AulaError,key,safeError,seal,uuid} from './security.ts';
import {ReadProvider,refreshSession,type RecordData} from './provider.ts';
import {AulaHttpClient} from './vendor/http.ts';

type Call=(action:string,hid:string|null,uid:string|null,p:RecordData)=>Promise<RecordData>;
const codes:Record<string,number>={AULA_HANDOFF_INVALID:409,AULA_RATE_LIMIT:429,AULA_BUSY:409,AULA_FORBIDDEN:403};
const call:Call=async(action,hid,uid,p)=>{
 const {data,error}=action==='create'
  ?await adminClient().rpc('create_aula_handoff',{p_household_id:hid,p_user_id:uid,p_token_hash:p.token_hash})
  :await adminClient().rpc('aula_handoff_server',{p_action:action,p_household_id:hid,p_user_id:uid,p_payload:p});
 if(error)throw new AulaError(error.message.includes('AULA_FORBIDDEN')?'AULA_FORBIDDEN':'AULA_STORAGE_ERROR',error.message.includes('AULA_FORBIDDEN')?403:502);
 return data;
};
const hash=(secret:string)=>createHash('sha256').update(secret).digest('hex');
const result=(data:RecordData)=>{if(data.error)throw new AulaError(codes[data.error]?data.error:'AULA_STORAGE_ERROR',codes[data.error]??502);return data;};
function json(res:ServerResponse,status:number,data:RecordData){res.statusCode=status;res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.end(JSON.stringify(data));}

// Refresh is mandatory, followed by an authenticated read. Only the rotated
// refresh token leaves this function; neither access tokens nor profiles persist.
export async function verifySession(refresh:string,signal:AbortSignal,http=new AulaHttpClient({signal})):Promise<string>{
 const tokens=await refreshSession(http,refresh);
 try{const profiles=await new ReadProvider(tokens.access_token,http).read('profiles.getProfilesByLogin');
  if(!profiles||!Array.isArray(profiles.profiles))throw new AulaError('AULA_PROVIDER_FORMAT',502);
  return tokens.refresh_token;
 }finally{tokens.access_token='';tokens.refresh_token='';}
}
export function makeHandoffHandlers(deps:{authorize?:typeof authorize;call?:Call;verify?:typeof verifySession}={}){
 const auth=deps.authorize??authorize,rpc=deps.call??call;
 const create=async(req:Request,res:ServerResponse)=>{
  try{if(req.method!=='POST')throw new AulaError('METHOD_NOT_ALLOWED',405);
   const p=await body(req),hid=uuid(p.household_id),uid=await auth(req,hid);key('AULA_SESSION_ENCRYPTION_KEY');
   const secret=randomBytes(32).toString('base64url');
   const data=result(await rpc('create',hid,uid,{token_hash:hash(secret)}));
   json(res,200,{handoff_secret:secret,expires_at:data.expires_at});
  }catch(e){const err=safeError(e);json(res,err.status,{code:err.code});}finally{req.body=undefined;}
 };
 const accept=async(req:Request,res:ServerResponse)=>{
  let p:RecordData={},rotated='';const abort=new AbortController();
  const cancel=()=>abort.abort();req.once('aborted',cancel);res.once('close',cancel);
  const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(70_000)]);
  try{if(req.method!=='POST')throw new AulaError('METHOD_NOT_ALLOWED',405);
   // Browser origins are never consumers of refresh tokens. Native/CLI send no Origin.
   if(req.headers.origin!==undefined)throw new AulaError('AULA_FORBIDDEN',403);
   p=await body(req,16_384);req.body=undefined;
   if(Object.keys(p).some(k=>!['handoff_secret','refresh_token','identity_label'].includes(k))||
    typeof p.handoff_secret!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(p.handoff_secret)||
    typeof p.refresh_token!=='string'||p.refresh_token.length<1||p.refresh_token.length>12_000||/[\x00-\x20\x7f]/.test(p.refresh_token)||
    (p.identity_label!==undefined&&(typeof p.identity_label!=='string'||p.identity_label.length>120||/[\x00-\x1f\x7f]/.test(p.identity_label))))throw new AulaError('INVALID_REQUEST');
   key('AULA_SESSION_ENCRYPTION_KEY');
   const claim=result(await rpc('claim',null,null,{token_hash:hash(p.handoff_secret)}));delete p.handoff_secret;
   const hid=uuid(claim.household_id),uid=uuid(claim.created_by);
   rotated=await(deps.verify??verifySession)(p.refresh_token,signal);delete p.refresh_token;signal.throwIfAborted();
   const encrypted_session=seal(hid,{refresh_token:rotated});rotated='';
   result(await rpc('finish',hid,uid,{id:uuid(claim.id),claim_id:uuid(claim.claim_id),identity_label:p.identity_label,encrypted_session}));
   json(res,200,{connected:true});
  }catch(e){const err=safeError(e);json(res,err.status,{code:err.code});}
  finally{for(const k of Object.keys(p))delete p[k];rotated='';req.body=undefined;abort.abort();req.off('aborted',cancel);res.off('close',cancel);}
 };
 return {create,accept};
}
