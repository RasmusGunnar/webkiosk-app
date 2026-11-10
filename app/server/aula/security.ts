import {createCipheriv,createDecipheriv,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
export type Envelope={version:1;iv:string;ciphertext:string;authTag:string};
export class AulaError extends Error {
  readonly code:string; readonly status:number;
  constructor(code:string,status=400){super(code);this.code=code;this.status=status;}
}
export function key(name:string,env:NodeJS.ProcessEnv=process.env):Buffer{
  const value=env[name]; if(!value||!/^[A-Za-z0-9+/]{43}=$/.test(value))throw new AulaError('AULA_NOT_CONFIGURED',503);
  const result=Buffer.from(value,'base64');if(result.length!==32)throw new AulaError('AULA_NOT_CONFIGURED',503);return result;
}
export function seal(household:string,value:unknown,secret=key('AULA_SESSION_ENCRYPTION_KEY')):Envelope{
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',secret,iv);
  cipher.setAAD(Buffer.from(`familiekalender:aula:v1:${household}`));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return {version:1,iv:iv.toString('base64'),ciphertext:ciphertext.toString('base64'),authTag:cipher.getAuthTag().toString('base64')};
}
export function unseal<T>(household:string,value:Envelope,secret=key('AULA_SESSION_ENCRYPTION_KEY')):T{
  try{
    if(value.version!==1||typeof value.ciphertext!=='string'||value.ciphertext.length>100_000)throw 0;
    const iv=Buffer.from(value.iv,'base64'),tag=Buffer.from(value.authTag,'base64');if(iv.length!==12||tag.length!==16)throw 0;
    const cipher=createDecipheriv('aes-256-gcm',secret,iv);cipher.setAAD(Buffer.from(`familiekalender:aula:v1:${household}`));cipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.ciphertext,'base64')),cipher.final()]).toString('utf8')) as T;
  }catch{throw new AulaError('AULA_SESSION_INVALID',409);}
}
export function sourceKey(household:string,kind:string,id:string,secret=key('AULA_HMAC_KEY')):string{
  return createHmac('sha256',secret).update(JSON.stringify(['aula-v1',household,kind,id])).digest('hex');
}
export function equalSecret(provided:string|undefined,expected:string|undefined):boolean{
  if(!provided||!expected||expected.length<32)return false;
  const a=Buffer.from(provided),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
export function safeError(error:unknown):AulaError{
  if(error instanceof AulaError)return error;
  if(error instanceof Error && ['AbortError','TimeoutError'].includes(error.name))return new AulaError('AULA_TIMEOUT',504);
  if(error instanceof Error && error.name==='AulaBotDefenseError')return new AulaError('AULA_LOGIN_BLOCKED',502);
  // Node fetch hides transport failures behind TypeError. Inspect only known
  // machine codes, never messages, stack traces, URLs or arbitrary provider text.
  const transport:Record<string,string>={UND_ERR_CONNECT_TIMEOUT:'CONNECT_TIMEOUT',ENOTFOUND:'DNS',EAI_AGAIN:'DNS',ECONNRESET:'RESET',EPIPE:'RESET',UND_ERR_SOCKET:'RESET',ECONNREFUSED:'REFUSED',UND_ERR_HEADERS_TIMEOUT:'HEADERS_TIMEOUT',CERT_HAS_EXPIRED:'TLS',DEPTH_ZERO_SELF_SIGNED_CERT:'TLS',UNABLE_TO_VERIFY_LEAF_SIGNATURE:'TLS',ERR_TLS_CERT_ALTNAME_INVALID:'TLS'};
  const queue:unknown[]=[error];for(let i=0;i<queue.length&&i<12;i++){
    const e=queue[i];if(!e||typeof e!=='object')continue;const v=e as {code?:unknown;cause?:unknown;errors?:unknown};
    if(typeof v.code==='string'&&Object.hasOwn(transport,v.code))return new AulaError('AULA_NETWORK_'+transport[v.code],502);
    if(v.cause)queue.push(v.cause);if(Array.isArray(v.errors))queue.push(...v.errors.slice(0,5));
  }
  return new AulaError('AULA_TEMPORARY_ERROR',502);
}
export function uuid(value:unknown):string{
  if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new AulaError('INVALID_REQUEST'); return value;
}
