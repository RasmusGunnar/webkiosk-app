import {ANALYSIS_SCHEMA,ANALYSIS_INSTRUCTIONS,validateAnalysis,validateSources} from '../../../app/server/aula/analysis.ts';
type Options={secret:string;apiKey:string;model?:string;fetcher?:typeof fetch};
async function same(a:string,b:string){if(b.length<32)return false;const hash=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));const [x,y]=await Promise.all([hash(a),hash(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;}
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export function makeHandler(options:Options){return async(req:Request)=>{
 if(req.method!=='POST')return json(405,{code:'METHOD_NOT_ALLOWED'});
 if(!await same(req.headers.get('x-aula-analyze-secret')??'',options.secret))return json(401,{code:'UNAUTHORIZED'});
 try{
  if(Number(req.headers.get('content-length')??0)>100_000)return json(413,{code:'AULA_INVALID_BATCH'});
  const reader=req.body?.getReader();let text='',bytes=0;const decoder=new TextDecoder();if(reader)try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>100_000)return json(413,{code:'AULA_INVALID_BATCH'});text+=decoder.decode(value,{stream:true});}}finally{await reader.cancel();}text+=decoder.decode();
  const sources=validateSources(JSON.parse(text).sources);
  if(!options.apiKey)return json(503,{code:'AULA_ANALYSIS_UNAVAILABLE'});
  const response=await(options.fetcher??fetch)('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${options.apiKey}`,'content-type':'application/json'},signal:AbortSignal.timeout(45_000),body:JSON.stringify({model:options.model??'gpt-4.1-mini',store:false,max_output_tokens:6000,instructions:ANALYSIS_INSTRUCTIONS,input:JSON.stringify({timezone:'Europe/Copenhagen',sources}),text:{format:{type:'json_schema',name:'aula_findings',strict:true,schema:ANALYSIS_SCHEMA}}})});
  if(!response.ok)return json(502,{code:'AULA_ANALYSIS_UNAVAILABLE'});
  const data=await response.json();if(data.status==='incomplete')return json(502,{code:'AULA_ANALYSIS_INVALID'});
  const output=data.output_text??data.output?.flatMap((o:any)=>o.content??[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');
  return json(200,{findings:validateAnalysis(JSON.parse(output),sources)});
 }catch{return json(422,{code:'AULA_ANALYSIS_INVALID'});}
};}
if(import.meta.main)Deno.serve(makeHandler({secret:Deno.env.get('AULA_ANALYZE_SECRET')??'',apiKey:Deno.env.get('OPENAI_API_KEY')??'',model:Deno.env.get('AULA_ANALYSIS_MODEL')}));
