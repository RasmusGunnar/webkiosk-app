// Adapted from aula-mcp (MIT; see LICENSE). Memory-only cookie transport.
// No HTTP verb restriction: authentication legitimately uses POST and PUT.
import { AulaCookieJar } from './cookies.ts';
import { RedirectLoopError } from './errors.ts';
import { silentLogger, type Logger } from './logger.ts';
export const DEFAULT_HEADERS = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36', 'accept-language': 'da-DK,da;q=0.9,en;q=0.8', accept: '*/*' };
export interface RequestOptions { method?: string; headers?: Record<string,string>; body?: string | Uint8Array | URLSearchParams; noDefaultHeaders?: boolean }
export interface AulaResponse { status: number; headers: Headers; body: string; url: string }
export interface FollowOptions extends RequestOptions { maxHops?: number }
export interface FollowResult { history: {url:string;status:number}[]; final: AulaResponse }
export class AulaHttpClient {
  readonly jar: AulaCookieJar;
  readonly signal: AbortSignal;
  private headers: Record<string,string>;
  private fetcher: typeof fetch;
  constructor(options: {jar?:AulaCookieJar;logger?:Logger;defaultHeaders?:Record<string,string>;signal?:AbortSignal;fetcher?:typeof fetch} = {}) {
    this.jar = options.jar ?? new AulaCookieJar({logger:silentLogger});
    this.signal = options.signal ?? AbortSignal.timeout(270_000);
    this.fetcher = options.fetcher ?? fetch;
    this.headers = {...DEFAULT_HEADERS,...options.defaultHeaders};
  }
  async request(url:string, options:RequestOptions = {}):Promise<AulaResponse> {
    this.signal.throwIfAborted();
    const target = new URL(url);
    const roots=['aula.dk','unilogin.dk','mitid.dk','nemlog-in.dk','nemlogin.dk','stil.dk','meebook.com'];
    if(target.protocol!=='https:' || target.username || target.password || (target.port && target.port!=='443') || !roots.some(d=>target.hostname===d||target.hostname.endsWith('.'+d))) throw new Error('AUTH_DESTINATION_BLOCKED');
    const headers:Record<string,string> = options.noDefaultHeaders ? {} : {...this.headers};
    for(const [k,v] of Object.entries(options.headers??{})) headers[k.toLowerCase()]=v;
    const cookies=await this.jar.cookieHeader(url); if(cookies) headers.cookie=cookies;
    if(options.body instanceof URLSearchParams) headers['content-type']??='application/x-www-form-urlencoded';
    const response=await this.fetcher(url,{method:options.method??'GET',headers,body:options.body instanceof Uint8Array?new Uint8Array(options.body):options.body,redirect:'manual',signal:AbortSignal.any([this.signal,AbortSignal.timeout(25_000)])});
    await this.jar.storeFromResponse(response.headers,url);
    const reader=response.body?.getReader(); const chunks:Uint8Array[]=[]; let size=0;
    if(reader) try { for(;;){const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>8*1024*1024)throw new Error('RESPONSE_TOO_LARGE'); chunks.push(value);} } finally {await reader.cancel().catch(()=>{});}
    return {status:response.status,headers:response.headers,body:Buffer.concat(chunks).toString('utf8'),url};
  }
  withSignal(signal:AbortSignal):AulaHttpClient{
    return new AulaHttpClient({jar:this.jar,defaultHeaders:this.headers,fetcher:this.fetcher,signal:AbortSignal.any([this.signal,signal])});
  }
  async followRedirects(url:string,options:FollowOptions={}):Promise<FollowResult>{
    const history:FollowResult['history']=[]; let current=url, next:RequestOptions=options;
    for(let n=0;n<Math.min(options.maxHops??10,20);n++){
      const final=await this.request(current,next); history.push({url:current,status:final.status});
      const location=final.headers.get('location');
      if(final.status<300||final.status>=400||!location)return {history,final};
      current=new URL(location,current).href;
      next=[307,308].includes(final.status)?next:{headers:next.headers};
    }
    throw new RedirectLoopError(20,current);
  }
}
