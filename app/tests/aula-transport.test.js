import test from 'node:test';
import assert from 'node:assert/strict';
import {safeError} from '../server/aula/security.ts';
import {ReadProvider} from '../server/aula/provider.ts';
import {AulaHttpClient} from '../server/aula/vendor/http.ts';
const failure=code=>new TypeError('fetch failed https://example.invalid/?secret=never-log',{cause:Object.assign(new Error('secret cookie and private address'),{code})});
test('Transport diagnostics retain only finite safe codes, never exception content',()=>{
 for(const [code,result]of [['UND_ERR_CONNECT_TIMEOUT','CONNECT_TIMEOUT'],['ENOTFOUND','DNS'],['ECONNRESET','RESET'],['ERR_TLS_CERT_ALTNAME_INVALID','TLS']])assert.equal(safeError(failure(code)).code,'AULA_NETWORK_'+result);
 const aggregate=new TypeError('private',{cause:new AggregateError([failure('ECONNREFUSED')])});assert.equal(safeError(aggregate).code,'AULA_NETWORK_REFUSED');
 for(const value of [failure('secret'),new Error('AULA_NETWORK_DNS?secret'),new Error('private')])assert.equal(safeError(value).code,'AULA_TEMPORARY_ERROR');
});
test('Production diagnostics distinguish Aula widget-token transport from MeeBook HTTP transport without credentials',async()=>{
 for(const broken of ['token','fetch']){
  const logs=[],http=new AulaHttpClient({fetcher:async(url)=>{const isToken=new URL(url).hostname==='www.aula.dk';if(isToken===(broken==='token'))throw failure('UND_ERR_CONNECT_TIMEOUT');return Response.json({data:'synthetic-widget-secret',status:{code:0}});}});
  const provider=new ReadProvider('synthetic-aula-secret',http,(stage,counts,code)=>logs.push({stage,counts,code}));
  await assert.rejects(()=>provider.meebook({userId:'private-guardian',institutions:[{institutionCode:'private-school'}]},[{userId:'private-child'}],'2026-W46'));
  assert.ok(logs.some(l=>l.stage==='meebook.'+broken+'.failed'&&l.code==='AULA_NETWORK_CONNECT_TIMEOUT'));
  const output=JSON.stringify(logs);for(const secret of ['synthetic-widget-secret','synthetic-aula-secret','private-child','private-guardian','private-school','https','cookie'])assert.ok(!output.includes(secret));
 }
});
