import {validateAnalysis,ANALYSIS_ERRORS,type AnalysisSource,type AnalysisFinding} from './analysis.ts';
import {AulaError,safeError} from './security.ts';
type Analyze=(sources:AnalysisSource[],signal:AbortSignal)=>Promise<AnalysisFinding[]>;
type Result={batch:AnalysisSource[];results:AnalysisFinding[];error?:string};
export function analysisBatches(sources:AnalysisSource[]){
 const batches:AnalysisSource[][]=[];let batch:AnalysisSource[]=[];
 for(const source of sources){
  // The Edge cap is bytes, not JS characters. Leave envelope headroom.
  if(batch.length&&(batch.length>=12||Buffer.byteLength(JSON.stringify({sources:[...batch,source]}))>95_000)){batches.push(batch);batch=[];}
  batch.push(source);
 }if(batch.length)batches.push(batch);return batches;
}
// Recover only known source/model/transport failures. Auth, unknown programming
// errors and parent cancellation still fail the scan. Validation is never relaxed.
export async function analyzeBatches(sources:AnalysisSource[],analyze:Analyze,signal:AbortSignal,report:(stage:string,counts:Record<string,number>,code?:string)=>void=()=>{},budgetMs=180_000){
 const batches=analysisBatches(sources),results:Result[]=new Array(batches.length),abort=new AbortController();
 const childSignal=AbortSignal.any([signal,abort.signal]),budget=AbortSignal.timeout(budgetMs),batchSignal=AbortSignal.any([childSignal,budget]);let next=0,failure:unknown;
 const worker=async()=>{try{while(next<batches.length){childSignal.throwIfAborted();const i=next++,batch=batches[i],start=Date.now();
  try{batchSignal.throwIfAborted();const rows=validateAnalysis({findings:await analyze(batch,batchSignal)},batch);results[i]={batch,results:rows};report('analysis.batch.ok',{batch:i+1,sources:batch.length,findings:rows.length,stage_ms:Date.now()-start});}
  catch(error){
   childSignal.throwIfAborted();
   const code=error instanceof Error&&ANALYSIS_ERRORS.has(error.message)?error.message:safeError(error).code;
   if(code==='AULA_ANALYSIS_AUTH_FAILED'||(!ANALYSIS_ERRORS.has(code)&&!code.startsWith('AULA_NETWORK_')&&code!=='AULA_TIMEOUT'))throw error;
   results[i]={batch,results:[],error:code};report('analysis.batch.failed',{batch:i+1,sources:batch.length,stage_ms:Date.now()-start},code);
  }
 }}catch(error){if(!failure){failure=error;abort.abort();}}};
 try{await Promise.all(Array.from({length:Math.min(3,batches.length)},worker));if(failure)throw failure;signal.throwIfAborted();
  if(results.length&&results.every(r=>r.error))throw new AulaError(results[0].error!,502);
  return results;
 }finally{abort.abort();}
}
