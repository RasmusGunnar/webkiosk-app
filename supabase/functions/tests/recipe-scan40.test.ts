import {makeRecipeHandler} from '../recipe-preview/index.ts';
import {analyseRecipe,scanImages,visionResult,visionSchema} from '../_shared/recipe-vision.ts';
const assert=(v:unknown)=>{if(!v)throw Error('Assertion failed');};
const rejects=async(fn:()=>unknown)=>{try{await fn();}catch{return;}throw Error('Expected rejection');};
const image={mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='};
const uid='10000000-0000-4000-8000-000000000001',hid='20000000-0000-4000-8000-000000000002',uuid='30000000-0000-4000-8000-000000000003';
const paths=[hid+'/'+uuid+'/scan-'+uid+'-'+uuid+'.jpg'];
const output={title:'Dansk tomatsuppe',description:null,servings:4,prep_minutes:null,cook_minutes:20,total_minutes:null,ingredients:[{raw_text:'2 dåser tomater',ingredient_name:'tomater',quantity:2,unit:'dåser',note:null}],instructions:[{position:0,text:'Kog tomaterne.'}],warnings:['Side 2 mangler slutningen.'],cover_page_index:1};
const request=(body:unknown)=>new Request('http://local',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify(body)});
Deno.test('Scan accepts one/four pages and rejects fifth, oversized dimension, invalid MIME and bytes',async()=>{
 assert(scanImages([image]).length===1);assert(scanImages(Array(4).fill(image)).length===4);
 await rejects(()=>scanImages(Array(5).fill(image)));await rejects(()=>scanImages([{...image,mime:'image/svg+xml'}]));
 const bytes=Uint8Array.from(atob(image.base64),c=>c.charCodeAt(0));new DataView(bytes.buffer).setUint32(16,2201);
 await rejects(()=>scanImages([{mime:'image/png',base64:btoa(String.fromCharCode(...bytes))}]));
 await rejects(()=>scanImages([{...image,base64:'x'.repeat(7*1024*1024+1)}]));
});
Deno.test('Structured extraction preserves raw ingredients, ordered steps, nulls, warnings and cover suggestion',()=>{
 const r=visionResult(output,2);assert(r.ingredients[0].quantity===2);assert(r.ingredients[0].raw_text==='2 dåser tomater');assert(r.instructions[0].position===0);assert(r.servings===4&&r.total_minutes===null);assert(r.warnings.length===1&&r.incomplete);assert(r.cover_page_index===1);
 assert(visionResult({...output,cover_page_index:9},2).cover_page_index===null);
 assert(visionResult({...output,instructions:[]},2).warnings.length===2);
});
Deno.test('Responses contract uses configurable model, strict schema, page order and server-only key',async()=>{
 let body:any,auth='';const second={...image,base64:image.base64+' '};
 const result=await analyseRecipe([image,second],{env:k=>k==='OPENAI_API_KEY'?'provider-contract-fixture':k==='OPENAI_RECIPE_VISION_MODEL'?'configured-vision':undefined,request:(async(_url,init)=>{
  body=JSON.parse(String(init?.body));auth=new Headers(init?.headers).get('Authorization')||'';return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]});
 }) as typeof fetch});
 assert(body.model==='configured-vision'&&body.store===false&&body.text.format.strict);assert(JSON.stringify(body.text.format.schema)===JSON.stringify(visionSchema));
 assert(body.input[0].content[1].image_url.endsWith(image.base64)&&body.input[0].content[2].image_url.endsWith(second.base64));
 assert(auth==='Bearer provider-contract-fixture');assert(!JSON.stringify(result).includes('provider-contract-fixture'));
});
for(const outcome of ['success','missing','provider','rate','invalid'] as const)Deno.test('Private temporary pages cleaned after '+outcome,async()=>{
 let calls=0,removed:string[]=[];
 const handler=makeRecipeHandler({authenticate:async()=>uid,authorize:async()=>true,rate:async()=>outcome!=='rate',
 download:async()=>outcome==='invalid'?{mime:'image/svg+xml',base64:image.base64}:image,
 cleanup:async(_a,p)=>{removed=p;},vision:async()=>{calls++;if(outcome==='missing')throw Error('VISION_NOT_CONFIGURED');if(outcome==='provider')throw Error('raw upstream secret details');return visionResult(output);}});
 const res=await handler(request({action:'scan',household_id:hid,paths})),body=await res.json();
 assert(removed[0]===paths[0]);assert(res.status===(outcome==='success'?200:outcome==='rate'?429:outcome==='invalid'?400:503));
 assert(!JSON.stringify(body).includes('upstream'));if(outcome==='rate'||outcome==='invalid')assert(calls===0);
});
Deno.test('Unauthenticated and cross-household requests denied before storage/provider access',async()=>{
 for(const auth of [false,true]){let called=false;const handler=makeRecipeHandler({authenticate:async()=>auth,authorize:async()=>false,download:async()=>{called=true;return image;}});
 const r=await handler(request({action:'scan',household_id:hid,paths}));assert(r.status===(auth?403:401));assert(!called);}
});
Deno.test('Foreign cover paths cannot be downloaded or deleted; cleanup failure is controlled',async()=>{
 let touched=false;const base={authenticate:async()=>uid,authorize:async()=>true,rate:async()=>true,vision:async()=>visionResult(output)};
 const denied=makeRecipeHandler({...base,download:async()=>{touched=true;return image;},cleanup:async()=>{touched=true;}});
 assert((await denied(request({action:'scan',household_id:hid,paths:[hid+'/'+uuid+'/permanent-cover.jpg']}))).status===400);assert(!touched);
 const failed=makeRecipeHandler({...base,download:async()=>image,cleanup:async()=>{throw Error('private storage token');}});
 const r=await failed(request({action:'scan',household_id:hid,paths}));assert(r.status===503);assert(!JSON.stringify(await r.json()).includes('token'));
});
Deno.test('Provider timeout, rate limit, missing key and no recipe never produce a fake result',async()=>{
 await rejects(()=>analyseRecipe([image],{env:()=>undefined}));
 await rejects(()=>visionResult({title:null,ingredients:[],instructions:[]}));
  for(const status of [429,503]){let code='';try{await analyseRecipe([image],{env:k=>k==='OPENAI_API_KEY'?'fixture':undefined,request:(async()=>new Response('private upstream',{status})) as typeof fetch});}catch(e){code=(e as Error).message;}assert(code===(status===429?'VISION_RATE_LIMIT':'VISION_UNAVAILABLE'));}
 let timeout='';try{await analyseRecipe([image],{env:k=>k==='OPENAI_API_KEY'?'fixture':undefined,request:(async()=>{throw new DOMException('Timed out','TimeoutError');}) as typeof fetch});}catch(e){timeout=(e as Error).message;}assert(timeout==='VISION_TIMEOUT');
});
