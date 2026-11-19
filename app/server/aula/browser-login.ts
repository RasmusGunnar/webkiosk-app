import {createHash,randomBytes} from 'node:crypto';
import type {ServerResponse} from 'node:http';
import {adminClient,authorize,body,type Request} from './service.ts';
import {AulaError,seal,unseal,uuid,safeError,type Envelope} from './security.ts';
import {AulaHttpClient} from './vendor/http.ts';
import {buildAuthorizeUrl,exchangeAuthorizationCode,DEFAULT_OAUTH_CONFIG,type AulaOAuthConfig} from './vendor/aula-oauth.ts';
import {verifySession} from './handoff.ts';
import {nativeCors} from '../native-cors.ts';

// A provider-approved client and callback are prerequisites. Never substitute
// Aula's private mobile client: its registered callback belongs to aula.dk.
export const CALLBACK='https://familiekalender-alpha.vercel.app/api/aula-browser';
export function browserOAuthConfig(env:NodeJS.ProcessEnv=process.env):AulaOAuthConfig{
 if(env.AULA_BROWSER_LOGIN_ENABLED!=='true'||!env.AULA_OAUTH_CLIENT_ID||env.AULA_OAUTH_CLIENT_ID===DEFAULT_OAUTH_CONFIG.clientId||env.AULA_OAUTH_REDIRECT_URI!==CALLBACK)throw new AulaError('AULA_BROWSER_NOT_CONFIGURED',503);
 if(!/^[A-Za-z0-9_-]{4,160}$/.test(env.AULA_OAUTH_CLIENT_ID))throw new AulaError('AULA_BROWSER_NOT_CONFIGURED',503);
 return {...DEFAULT_OAUTH_CONFIG,clientId:env.AULA_OAUTH_CLIENT_ID,redirectUri:CALLBACK};
}
type Data=Record<string,any>;
type Call=(action:string,hid:string|null,uid:string|null,p:Data)=>Promise<Data>;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const call:Call=async(action,hid,uid,p)=>{const {data,error}=await adminClient().rpc('aula_browser_server',{p_action:action,p_household_id:hid,p_user_id:uid,p_payload:p});if(error)throw new AulaError('AULA_STORAGE_ERROR',502);return data;};
function checked(data:Data){if(data.error)throw new AulaError(data.error==='AULA_RATE_LIMIT'?'AULA_RATE_LIMIT':'AULA_HANDOFF_INVALID',data.error==='AULA_RATE_LIMIT'?429:409);return data;}
function json(res:ServerResponse,status:number,data:Data){res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify(data));}
type Flow={verifier:string;clientId:string;redirectUri:string};
export function makeBrowserLogin(deps:{authorize?:typeof authorize;call?:Call;config?:()=>AulaOAuthConfig;exchange?:typeof exchangeAuthorizationCode;verify?:typeof verifySession}={}){
 const rpc=deps.call??call,auth=deps.authorize??authorize,config=deps.config??browserOAuthConfig;
 return async(req:Request,res:ServerResponse)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  if(nativeCors(req,res))return;
  try{
   const cfg=config();
   if(req.method==='POST'){
    const p=await body(req),hid=uuid(p.household_id),uid=await auth(req,hid);
    if(p.action==='finish'){if(typeof p.proof!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(p.proof))throw new AulaError('AULA_HANDOFF_INVALID',409);json(res,200,checked(await rpc('finish',hid,uid,{id:uuid(p.id),completion_hash:hash(p.proof)})));return;}
    if(p.action==='status'||p.action==='cancel'){json(res,200,checked(await rpc(p.action,hid,uid,{id:uuid(p.id)})));return;}
    if(p.action!=='start'||Object.keys(p).some(k=>!['household_id','action','native'].includes(k))||(p.native!==undefined&&typeof p.native!=='boolean'))throw new AulaError('INVALID_REQUEST');
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
    const data=checked(await rpc('start',hid,uid,{state_hash:hash(state),native:p.native===true,encrypted_flow:seal(hid,{verifier,clientId:cfg.clientId,redirectUri:cfg.redirectUri})}));
    json(res,200,{id:data.id,expires_at:data.expires_at,url:buildAuthorizeUrl({config:cfg,state,codeChallenge:createHash('sha256').update(verifier).digest('base64url')})});return;
   }
   if(req.method!=='GET')throw new AulaError('METHOD_NOT_ALLOWED',405);
   const url=new URL(req.url??'',CALLBACK),state=url.searchParams.get('state'),code=url.searchParams.get('code');
   if((req.url?.length??0)>8192||url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1||!state||!/^[A-Za-z0-9_-]{43}$/.test(state)||!code||code.length>4096||/[\x00-\x20\x7f]/.test(code)||url.searchParams.has('error'))throw new AulaError('AULA_HANDOFF_INVALID',409);
   const claimed=checked(await rpc('claim',null,null,{state_hash:hash(state)}));
   const hid=uuid(claimed.household_id),uid=uuid(claimed.created_by),flow=unseal<Flow>(hid,claimed.encrypted_flow as Envelope);
   if(flow.clientId!==cfg.clientId||flow.redirectUri!==cfg.redirectUri)throw new AulaError('AULA_HANDOFF_INVALID',409);
   const signal=AbortSignal.timeout(60_000),http=new AulaHttpClient({signal});
   const tokens=await(deps.exchange??exchangeAuthorizationCode)(http,cfg,{code,codeVerifier:flow.verifier});flow.verifier='';
   let rotated='';try{rotated=await(deps.verify??verifySession)(tokens.refresh_token,signal,http,cfg.clientId);}finally{tokens.access_token='';tokens.refresh_token='';}
   const encrypted_session=seal(hid,{refresh_token:rotated,oauth_client_id:cfg.clientId});rotated='';
   const proof=randomBytes(32).toString('base64url');
   checked(await rpc('prepare',hid,uid,{id:uuid(claimed.id),claim_id:uuid(claimed.claim_id),encrypted_session,completion_hash:hash(proof)}));
   // Provider codes/tokens never leave the server. A separate one-use completion
   // proof is delivered only in the fragment, and still requires app JWT + flow binding.
   res.statusCode=303;res.setHeader('Location',(claimed.native?'familiekalender://aula/connected#':'/#aula-connected&')+'flow='+uuid(claimed.id)+'&proof='+proof);res.end();
  }catch(e){const error=safeError(e);json(res,error.status,{code:error.code});}
  finally{req.body=undefined;}
 };
}
