import {parseRecipe,recipeUrl,publicIp,fetchRecipePage,resolvePublic} from '../_shared/recipe.ts';
import {makeRecipeHandler} from '../recipe-preview/index.ts';
function assert(value:unknown):asserts value{if(!value)throw Error('Assertion failed');}
async function rejects(fn:()=>unknown){try{await fn();}catch{return;}throw Error('Expected rejection');}
Deno.test('Recipe JSON-LD graphs, ingredients, sections and HTML entities',()=>{const recipe=parseRecipe('<html><head><script type="application/ld+json">'+JSON.stringify({'@graph':[{'@type':['Thing','Recipe'],name:'Pasta &amp; grønt',image:{url:'/photo.jpg'},recipeIngredient:['100 g pasta','Tomater'],recipeInstructions:[{'@type':'HowToSection',itemListElement:[{text:'<b>Kog</b> pasta'},{text:'Spis'}]}]}]})+'</script></head></html>','https://example.com/recipe');assert(recipe.title==='Pasta & grønt');assert(recipe.ingredients.length===2);assert(recipe.instructions.join('|')==='Kog pasta|Spis');assert(recipe.image==='https://example.com/photo.jpg');});
Deno.test('Malformed JSON-LD uses OG/title fallback without inventing ingredients',()=>{const r=parseRecipe('<html><head><script type="application/ld+json">bad</script><meta property="og:title" content="Min suppe"><meta property="og:site_name" content="Madblog"></head></html>','https://example.com');assert(r.title==='Min suppe');assert(r.format==='metadata');assert(r.ingredients.length===0);assert(r.instructions.length===0);});
Deno.test('Recipe fetch rejects private, encoded IP, credentials, non-web schemes and redirects before connecting',async()=>{
 for(const url of ['http://127.0.0.1','http://2130706433','http://169.254.169.254/latest','http://10.1.2.3','http://[::1]','http://[::ffff:127.0.0.1]','file:///etc/passwd','https://a:b@example.com','https://foo.internal'])await rejects(()=>recipeUrl(url));
 for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','169.254.169.254','100.64.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','192.0.0.1'])assert(!publicIp(ip));
 assert(publicIp('93.184.216.34'));await rejects(()=>resolvePublic(new URL('https://example.com'),(()=>Promise.resolve([{address:'127.0.0.1',family:4}])) as any));
 let calls=0;await rejects(()=>fetchRecipePage('https://example.com',{resolve:()=>Promise.resolve({address:'93.184.216.34',family:4}),get:()=>{calls++;return Promise.resolve({status:302,headers:{location:'http://127.0.0.1'},body:''});}}));assert(calls===1);
 await rejects(()=>fetchRecipePage('https://example.com',{timeoutMs:10,resolve:()=>new Promise(()=>{})}));
});
Deno.test('Recipe handler requires auth, returns editable metadata and friendly redacted failure',async()=>{
 const handler=makeRecipeHandler({authenticate:()=>Promise.resolve(true),load:()=>Promise.resolve({url:'https://example.com',html:'<html><head><title>Opskrift</title></head></html>'})});
 assert((await handler(new Request('https://local',{method:'POST',body:'{}'}))).status===401);
 const r=await handler(new Request('https://local',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({url:'https://example.com'})}));assert(r.status===200);assert((await r.json()).recipe.title==='Opskrift');
 const bad=makeRecipeHandler({authenticate:()=>Promise.resolve(true),load:()=>{throw Error('private link must not escape');}});
 const failure=await bad(new Request('https://local',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({url:'https://example.com'})}));assert(failure.status===422);assert(!(await failure.text()).includes('private link'));
});

Deno.test('Pinned HTTP transport enforces IP connection, TLS hostname, chunk framing and size/truncation limits',async()=>{
 const {pinnedGet,MAX_RECIPE_BYTES}=await import('../_shared/recipe.ts');
 const fixture=(wire:string)=>{let used=false,closed=false;const conn={read:(buffer:Uint8Array)=>{if(used)return Promise.resolve(null);used=true;const bytes=new TextEncoder().encode(wire);buffer.set(bytes);return Promise.resolve(bytes.length);},write:(bytes:Uint8Array)=>Promise.resolve(bytes.length),close:()=>{closed=true;}};return {conn,closed:()=>closed};};
 const page='HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n';
 const f=fixture(page);let host='',tls='';const transport={connect:((opts:any)=>{host=opts.hostname;return Promise.resolve(f.conn);}) as any,startTls:((_conn:any,opts:any)=>{tls=opts.hostname;return Promise.resolve(f.conn);}) as any};
 const response=await pinnedGet(new URL('https://example.com/path'),{address:'93.184.216.34',family:4},new AbortController().signal,transport);assert(response.body==='Wikipedia');assert(host==='93.184.216.34');assert(tls==='example.com');assert(f.closed());
 for(const wire of ['HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: '+(MAX_RECIPE_BYTES+1)+'\r\n\r\n','HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 20\r\n\r\nshort','HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhi']){
  const bad=fixture(wire);await rejects(()=>pinnedGet(new URL('http://example.com'),{address:'93.184.216.34',family:4},new AbortController().signal,{connect:(()=>Promise.resolve(bad.conn)) as any}));assert(bad.closed());
 }
 await rejects(()=>fetchRecipePage('https://example.com',{timeoutMs:10,resolve:()=>Promise.resolve({address:'93.184.216.34',family:4}),get:()=>new Promise(()=>{})}));
});
