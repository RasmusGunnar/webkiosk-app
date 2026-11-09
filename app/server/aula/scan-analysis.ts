import {validateAnalysis,type AnalysisSource,type AnalysisFinding} from './analysis.ts';
type Analyze=(sources:AnalysisSource[],signal:AbortSignal)=>Promise<AnalysisFinding[]>;
// Same batches/data limits, bounded concurrency, original order for stable dedupe.
// No partial result is saved; any failure aborts and joins all in-flight workers.
export async function analyzeBatches(sources:AnalysisSource[],analyze:Analyze,signal:AbortSignal){
 const batches=Array.from({length:Math.ceil(sources.length/12)},(_,i)=>sources.slice(i*12,i*12+12));
 const results:AnalysisFinding[][]=new Array(batches.length),abort=new AbortController();
 const childSignal=AbortSignal.any([signal,abort.signal]);let next=0,failed=false,failure:unknown;
 const worker=async()=>{try{while(next<batches.length){childSignal.throwIfAborted();const i=next++;
  results[i]=validateAnalysis({findings:await analyze(batches[i],childSignal)},batches[i]);
 }}catch(error){if(!failed){failed=true;failure=error;abort.abort();}}};
 try{await Promise.all(Array.from({length:Math.min(3,batches.length)},worker));if(failed)throw failure;signal.throwIfAborted();return batches.map((batch,i)=>({batch,results:results[i]}));}
 finally{abort.abort();}
}
