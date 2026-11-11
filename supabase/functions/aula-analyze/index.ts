import {analysisSchemaForSources,ANALYSIS_INSTRUCTIONS,ANALYSIS_ERRORS,analysisModelSources,validateModelAnalysis,validateSources} from '../../../app/server/aula/analysis.ts';
type Diagnostic={stage:string;counts:{sources:number;http?:number};duration_ms:number;code:string};
type Options={secret:string;apiKey:string;model?:string;fetcher?:typeof fetch;log?:(event:Diagnostic)=>void};
async function same(a:string,b:string){if(b.length<32)return false;const hash=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));const [x,y]=await Promise.all([hash(a),hash(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;}
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export function makeHandler(options:Options){return async(req:Request)=>{
 if(req.method!=='POST')return json(405,{code:'METHOD_NOT_ALLOWED'});
 if(!await same(req.headers.get('x-aula-analyze-secret')??'',options.secret))return json(401,{code:'UNAUTHORIZED'});
 const started=Date.now();let count=0;
 const fail=(status:number,code:string,http?:number)=>{(options.log??(event=>console.info(JSON.stringify(event))))({stage:'aula.scan.analysis.failed',counts:{sources:count,...(http?{http}:{})},duration_ms:Date.now()-started,code});return json(status,{code});};
 try{
  if(Number(req.headers.get('content-length')??0)>100_000)return json(413,{code:'AULA_INVALID_BATCH'});
  const reader=req.body?.getReader();let text='',bytes=0;const decoder=new TextDecoder();if(reader)try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>100_000)return json(413,{code:'AULA_INVALID_BATCH'});text+=decoder.decode(value,{stream:true});}}finally{await reader.cancel();}text+=decoder.decode();
  const sources=validateSources(JSON.parse(text).sources);
  count=sources.length;
  if(!options.apiKey)return fail(503,'AULA_ANALYSIS_AUTH_FAILED');
  const response=await(options.fetcher??fetch)('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${options.apiKey}`,'content-type':'application/json'},signal:AbortSignal.timeout(45_000),body:JSON.stringify({model:options.model??'gpt-4.1-mini',store:false,max_output_tokens:6000,instructions:ANALYSIS_INSTRUCTIONS,input:JSON.stringify({timezone:'Europe/Copenhagen',sources:analysisModelSources(sources)}),text:{format:{type:'json_schema',name:'aula_findings',strict:true,schema:analysisSchemaForSources(sources)}}})});
  if(!response.ok)return fail(502,[401,403].includes(response.status)?'AULA_ANALYSIS_AUTH_FAILED':response.status===429?'AULA_ANALYSIS_RATE_LIMIT':'AULA_ANALYSIS_UNAVAILABLE',response.status);
  const data=await response.json();if(data.status==='incomplete')return fail(502,'AULA_ANALYSIS_INCOMPLETE');
  const output=data.output_text??data.output?.flatMap((o:any)=>o.content??[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');
  return json(200,{findings:validateModelAnalysis(JSON.parse(output),sources)});
 }catch(error){const code=error instanceof Error&&ANALYSIS_ERRORS.has(error.message)?error.message:error instanceof Error&&['AbortError','TimeoutError'].includes(error.name)?'AULA_ANALYSIS_TIMEOUT':'AULA_ANALYSIS_INVALID';return fail(422,code);}
};}
if(import.meta.main)Deno.serve(makeHandler({secret:Deno.env.get('AULA_ANALYZE_SECRET')??'',apiKey:Deno.env.get('OPENAI_API_KEY')??'',model:Deno.env.get('AULA_ANALYSIS_MODEL')}));
