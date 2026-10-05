import {parseRecipe} from '../_shared/recipe.ts';
import {fetchRecipeImage,validateImageBytes} from '../_shared/recipe-images.ts';
import {analyseRecipe,scanImages,visionResult} from '../_shared/recipe-vision.ts';
import {makeRecipeHandler} from '../recipe-preview/index.ts';
const assert=(v:unknown)=>{if(!v)throw Error('Assertion failed');};
const rejects=async(f:()=>unknown)=>{try{await f();}catch{return;}throw Error('Expected rejection');};
const image={mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='};
Deno.test('Recipe metadata maps image, description, yield and ISO durations; canonical only same-origin',()=>{
 const r=parseRecipe('<script type="application/ld+json">'+JSON.stringify({'@type':'Recipe',name:'Lasagne',description:'Familiens ret',image:['/food.png'],recipeYield:'5 portioner',prepTime:'PT15M',cookTime:'PT40M',recipeIngredient:['2 dåser tomater'],recipeInstructions:[{text:'Bag'}]})+'</script><link rel="canonical" href="/lasagne">','https://example.com/r?ref=x');
 assert(r.image==='https://example.com/food.png');assert(r.servings===5);assert(r.total_minutes===55);assert(r.description==='Familiens ret');assert(r.url==='https://example.com/lasagne');
 const og=parseRecipe('<title>Pasta</title><meta property="og:image" content="/pasta.jpg"><span itemprop="recipeIngredient">500 g pasta</span>','https://example.com/r');assert(og.image==='https://example.com/pasta.jpg');assert(og.ingredients[0]==='500 g pasta');
});
Deno.test('Safe image fetch validates MIME/signature/size and rejects private redirect',async()=>{
 const bytes=Uint8Array.from(atob(image.base64),c=>c.charCodeAt(0)),resolve=()=>Promise.resolve({address:'93.184.216.34',family:4});
 const good=await fetchRecipeImage('https://example.com/photo.png',{resolve,get:()=>Promise.resolve({status:200,headers:{'content-type':'image/png'},body:'',bytes})});assert(good.mime==='image/png');
 await rejects(()=>fetchRecipeImage('https://example.com/photo.png',{resolve,get:()=>Promise.resolve({status:302,headers:{location:'http://127.0.0.1/p'},body:''})}));
 await rejects(()=>validateImageBytes(new Uint8Array(5*1024*1024+1),'image/png'));await rejects(()=>validateImageBytes(bytes,'image/jpeg'));await rejects(()=>validateImageBytes(new TextEncoder().encode('<svg/>'),'image/svg+xml'));
});
Deno.test('Optional image failure still returns editable recipe with no copied cover',async()=>{
 const handler=makeRecipeHandler({authenticate:()=>Promise.resolve(true),load:()=>Promise.resolve({url:'https://example.com',html:'<title>Pasta</title><meta property="og:image" content="/x.png">'}),validateImage:()=>Promise.resolve({address:'93.184.216.34',family:4}),image:()=>{throw Error('Too large private upstream details');}});
 const response=await handler(new Request('http://local',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({url:'https://example.com'})}));const data=await response.json();assert(response.status===200);assert(data.recipe.title==='Pasta');assert(data.recipe.image_copy===null);assert(!JSON.stringify(data).includes('upstream details'));
});
Deno.test('Single and multipage scan accept only bounded real image formats',async()=>{
 assert(scanImages([image]).length===1);assert(scanImages([image,image]).length===2);await rejects(()=>scanImages([]));await rejects(()=>scanImages([image,image,image,image,image]));await rejects(()=>scanImages([{mime:'image/png',base64:'bad'}]));
});
Deno.test('Vision adapter maps structured response, preserves unknowns and requires review on incomplete text',async()=>{
 const r=visionResult({title:'Suppe',ingredients:['2 dåser tomater'],instructions:[],servings:null,incomplete:false});assert(r.incomplete);assert(r.instructions.length===0);assert(r.servings===null);assert(r.image_candidate===null);
 let body:any;const output={title:'Suppe',description:'',ingredients:['2 dåser tomater'],instructions:['Kog op.'],servings:4,prep_minutes:null,cook_minutes:20,total_minutes:20,incomplete:false,image_candidate:null};
 const result=await analyseRecipe([image,image],{env:key=>key==='OPENAI_API_KEY'?'server-test-credential':undefined,request:((_url:unknown,init:RequestInit)=>{body=JSON.parse(String(init.body));return Promise.resolve(Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(output)}]}]}));}) as typeof fetch});
 assert(result.ingredients[0]==='2 dåser tomater');assert(body.input[0].content.filter((x:any)=>x.type==='input_image').length===2);assert(body.store===false);assert(body.text.format.strict);assert(!JSON.stringify(result).includes('server-test-credential'));
});
Deno.test('Missing vision provider is a controlled server error; no fake success or leaked error',async()=>{
 await rejects(()=>analyseRecipe([image],{env:()=>undefined}));
 const handler=makeRecipeHandler({authenticate:()=>Promise.resolve(true),authorize:()=>Promise.resolve(true),vision:()=>{throw Error('VISION_NOT_CONFIGURED');}});
 const r=await handler(new Request('http://local',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({action:'scan',household_id:'fixture',images:[image]})}));const result=await r.json();assert(r.status===503);assert(result.error==='VISION_NOT_CONFIGURED');assert(!result.recipe);
 const denied=makeRecipeHandler({authenticate:()=>Promise.resolve(true),authorize:()=>Promise.resolve(false),vision:()=>{throw Error('Provider must never be called');}});
 assert((await denied(new Request('http://local',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({action:'scan',household_id:'other',images:[image]})}))).status===403);
});
