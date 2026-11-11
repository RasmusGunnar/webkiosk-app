import {safeError} from './security.ts';
export const SOURCE_STATUS={SKIPPED:0,PASS:1,PARTIAL:2,FAIL:3} as const;
export const CRITICAL_CODES=new Set(['AULA_REAUTH_REQUIRED','AULA_SESSION_INVALID','AULA_ACCESS_EXPIRED','AULA_FORBIDDEN','AULA_UNAUTHORIZED','AULA_WRITE_BLOCKED','AULA_NOT_CONFIGURED','AULA_STORAGE_ERROR','AULA_LEASE_EXPIRED','AULA_ANALYSIS_AUTH_FAILED']);
export function sourceFailure(error:unknown,signal:AbortSignal){
 signal.throwIfAborted();const safe=safeError(error);
 if(CRITICAL_CODES.has(safe.code)||(error instanceof Error&&error.message==='AUTH_DESTINATION_BLOCKED'))throw error;
 return safe.code;
}
export function scanSources(counts:Record<string,number>){return Object.fromEntries(['meebook','messages','posts','notifications','calendar'].map(name=>[name,Object.entries(SOURCE_STATUS).find(([,v])=>v===counts['source_'+name+'_status'])?.[0]??'SKIPPED']));}
