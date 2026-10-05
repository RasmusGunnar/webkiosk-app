import { parseHTML } from 'npm:linkedom@0.18.12';
import ipaddr from 'npm:ipaddr.js@2.2.0';
import { lookup } from 'node:dns/promises';
type HtmlNode={textContent:string|null;remove():void;getAttribute(name:string):string|null;querySelector(selector:string):HtmlNode|null;querySelectorAll(selector:string):HtmlNode[]};
const htmlDocument=(html:string)=>(parseHTML(html) as unknown as {document:HtmlNode}).document;
export const MAX_RECIPE_BYTES = 2 * 1024 * 1024;
export function recipeUrl(input: string): URL {
 let u: URL;try { u=new URL(input); } catch { throw Error('URL_NOT_ALLOWED'); }
 const host=u.hostname.replace(/^\[|\]$/g,'').toLowerCase();
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||(u.port&&!['80','443'].includes(u.port))||!host.includes('.')||/(^|\.)(localhost|local|internal|test|invalid|home|lan)$/.test(host))throw Error('URL_NOT_ALLOWED');
 if(ipaddr.isValid(host)&&!publicIp(host))throw Error('URL_NOT_ALLOWED');
 u.hash='';return u;
}
export function publicIp(address: string): boolean {
 try {let ip=ipaddr.parse(address);if(ip.kind()==='ipv6'&&(ip as ipaddr.IPv6).isIPv4MappedAddress())ip=(ip as ipaddr.IPv6).toIPv4Address();return ip.range()==='unicast';}catch{return false;}
}
export async function resolvePublic(url: URL, resolver=lookup) {
 const addresses=await resolver(url.hostname.replace(/^\[|\]$/g,''),{all:true,verbatim:true});
 if(!addresses.length||addresses.some(a=>!publicIp(a.address)))throw Error('URL_NOT_ALLOWED');
 return addresses[0];
}
export function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{const abort=()=>reject(Error('FETCH_FAILED'));if(signal.aborted){void work.catch(()=>{});abort();return;}signal.addEventListener('abort',abort,{once:true});work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
// Pin the validated DNS result to the connection; never perform a second DNS lookup.
export async function pinnedGet(url: URL,address: {address:string;family:number},signal: AbortSignal,transport:{connect?:typeof Deno.connect;startTls?:typeof Deno.startTls;image?:boolean}={}): Promise<{status:number;headers:Record<string,string|undefined>;body:string;bytes?:Uint8Array}> {
 // Edge's Node HTTP compatibility layer does not support lookup/SNI overrides.
 // Connect to the validated IP, then verify TLS against the original hostname.
 const limit=transport.image?5*1024*1024:MAX_RECIPE_BYTES;
 let conn:Deno.Conn|undefined;
 const abort=()=>{try{conn?.close();}catch{/* already closed */}};
 signal.addEventListener('abort',abort,{once:true});
 try{
  conn=await (transport.connect||Deno.connect)({hostname:address.address,port:Number(url.port||(url.protocol==='https:'?443:80))});
  if(signal.aborted)throw Error('FETCH_FAILED');
  if(url.protocol==='https:')conn=await (transport.startTls||Deno.startTls)(conn as Deno.TcpConn,{hostname:url.hostname});
  const request=new TextEncoder().encode('GET '+url.pathname+url.search+' HTTP/1.1\r\nHost: '+url.host+'\r\nAccept: */*\r\nAccept-Encoding: identity\r\nConnection: close\r\nUser-Agent: Familiekalender recipe preview\r\n\r\n');
  for(let offset=0;offset<request.length;)offset+=await conn.write(request.subarray(offset));
  let bytes=new Uint8Array(0),headerEnd=-1,status=0,headers:Record<string,string>={};
  const buffer=new Uint8Array(16384);
  while(true){
   const count=await conn.read(buffer);if(count===null)break;
   if(bytes.length+count>limit+65536)throw Error('TOO_LARGE');
   const next=new Uint8Array(bytes.length+count);next.set(bytes);next.set(buffer.subarray(0,count),bytes.length);bytes=next;
   if(headerEnd<0){
    for(let i=0;i<bytes.length-3;i++)if(bytes[i]===13&&bytes[i+1]===10&&bytes[i+2]===13&&bytes[i+3]===10){headerEnd=i+4;break;}
    if(headerEnd<0){if(bytes.length>32768)throw Error('FETCH_FAILED');continue;}
    if(headerEnd>32768)throw Error('FETCH_FAILED');
    const head=new TextDecoder().decode(bytes.subarray(0,headerEnd)),lines=head.split('\r\n');
    status=Number(lines[0].match(/^HTTP\/1\.[01] (\d{3})/)?.[1]);
    for(const line of lines.slice(1)){const colon=line.indexOf(':');if(colon>0)headers[line.slice(0,colon).toLowerCase()]=line.slice(colon+1).trim();}
    if([301,302,303,307,308].includes(status))return {status,headers,body:''};
    if(status!==200||!(transport.image?/^image\/(jpeg|png|webp)(;|$)/i:/^(text\/html|application\/xhtml\+xml)(;|$)/i).test(headers['content-type']||''))throw Error('FETCH_FAILED');
    if(Number(headers['content-length'])>limit)throw Error('TOO_LARGE');
   }
   if(!headers['transfer-encoding']&&headers['content-length']&&bytes.length-headerEnd>=Number(headers['content-length']))break;
  }
  if(headerEnd<0)throw Error('FETCH_FAILED');
  let body=bytes.subarray(headerEnd);
  if(headers['transfer-encoding']){
   if(headers['transfer-encoding'].toLowerCase()!=='chunked')throw Error('FETCH_FAILED');
   const chunks:Uint8Array[]=[];let offset=0,total=0,finished=false;
   while(offset<body.length){let end=offset;while(end<body.length-1&&!(body[end]===13&&body[end+1]===10))end++;
    const sizeText=new TextDecoder().decode(body.subarray(offset,end)).split(';')[0];if(!/^[0-9a-f]+$/i.test(sizeText))throw Error('FETCH_FAILED');
    const size=parseInt(sizeText,16);offset=end+2;if(!size){finished=true;break;}
    if(offset+size+2>body.length||body[offset+size]!==13||body[offset+size+1]!==10)throw Error('FETCH_FAILED');
    total+=size;if(total>limit)throw Error('TOO_LARGE');chunks.push(body.subarray(offset,offset+size));offset+=size+2;
   }
   if(!finished)throw Error('FETCH_FAILED');const result=new Uint8Array(total);let pos=0;for(const chunk of chunks){result.set(chunk,pos);pos+=chunk.length;}body=result;
  }else if(headers['content-length']&&body.length!==Number(headers['content-length']))throw Error('FETCH_FAILED');
  if(body.length>limit)throw Error('TOO_LARGE');
  // Do not accept unexpected compressed payloads. Sites can use the manual fallback.
  if(headers['content-encoding']&&headers['content-encoding']!=='identity')throw Error('FETCH_FAILED');
  return {status,headers,body:transport.image?'':new TextDecoder().decode(body),bytes:body};
 }finally{signal.removeEventListener('abort',abort);abort();}
}
export async function fetchRecipePage(input:string, deps:{resolve?:typeof resolvePublic;get?:typeof pinnedGet;timeoutMs?:number}={}) {
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),deps.timeoutMs??10000);
 try {
  let url=recipeUrl(input);
  for(let i=0;i<4;i++){
   const address=await abortable((deps.resolve||resolvePublic)(url),controller.signal);
   if(controller.signal.aborted)throw Error('FETCH_FAILED');
   const response=await abortable((deps.get||pinnedGet)(url,address,controller.signal),controller.signal);
   if([301,302,303,307,308].includes(response.status)){
    if(!response.headers.location||i===3)throw Error('FETCH_FAILED');url=recipeUrl(new URL(response.headers.location,url).href);continue;
   }
   if(response.status!==200)throw Error('FETCH_FAILED');
   return {html:response.body,url:url.href};
  }throw Error('FETCH_FAILED');
 }finally{clearTimeout(timeout);}
}
export function parseRecipe(html:string,url:string) {
 const document=htmlDocument(html),clean=(v:unknown)=>{if(typeof v!=='string')return '';const doc=htmlDocument('<div>'+v+'</div>');doc.querySelectorAll('script,style').forEach(n=>n.remove());return (doc.textContent||doc.querySelector('div')?.textContent||'').trim().slice(0,10000);};
 const nodes:any[]=[];const visit=(v:any,depth=0)=>{if(depth>15||!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(x=>visit(x,depth+1));return;}if([v['@type']].flat().some(t=>t==='Recipe'||t==='https://schema.org/Recipe'))nodes.push(v);if(v['@graph'])visit(v['@graph'],depth+1);if(v.mainEntity)visit(v.mainEntity,depth+1);};
 document.querySelectorAll('script[type="application/ld+json"]').forEach(el=>{try{visit(JSON.parse(el.textContent||''));}catch{/* malformed blocks must not prevent metadata fallback */}});
 const recipe=nodes[0],meta=(key:string)=>document.querySelector('meta[property="'+key+'"],meta[name="'+key+'"]')?.getAttribute('content')||'';
 const steps=(v:any):string[]=>{if(Array.isArray(v))return v.flatMap(steps).slice(0,100);if(typeof v==='string')return v.split(/\r?\n/).map(clean).filter(Boolean);if(v?.itemListElement)return steps(v.itemListElement);return v?.text?[clean(v.text)]:[];};
 const rawImage=recipe?.image, imageValue=Array.isArray(rawImage)?rawImage[0]:rawImage;
 let image='';try{const candidate=typeof imageValue==='string'?imageValue:imageValue?.url||meta('og:image');if(candidate)image=recipeUrl(new URL(candidate,url).href).href;}catch{/* optional image */}
 const title=clean(recipe?.name||document.querySelector('[itemprop=name]')?.textContent||meta('og:title')||document.querySelector('title')?.textContent||'');
 if(!title)throw Error('NO_RECIPE');
 const minutes=(value:unknown)=>{if(typeof value!=='string')return null;const m=value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);return m?Math.ceil(Number(m[1]||0)*60+Number(m[2]||0)+Number(m[3]||0)/60)||null:null;};
 const yieldValue=[recipe?.recipeYield].flat().find(v=>typeof v==='string'||typeof v==='number'),servings=Number(String(yieldValue||'').match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',','.'))||null;
 let canonical=url;try{const href=document.querySelector('link[rel=canonical]')?.getAttribute('href');if(href){const c=recipeUrl(new URL(href,url).href);if(c.origin===new URL(url).origin)canonical=c.href;}}catch{/* untrusted canonical ignored */}
 return {title:title.slice(0,160),description:clean(recipe?.description||meta('og:description')||meta('description')).slice(0,4000),servings,prep_minutes:minutes(recipe?.prepTime),cook_minutes:minutes(recipe?.cookTime),total_minutes:minutes(recipe?.totalTime)||((minutes(recipe?.prepTime)||0)+(minutes(recipe?.cookTime)||0))||null,image,site:clean(meta('og:site_name')||new URL(url).hostname).slice(0,200),url:canonical,ingredients:Array.isArray(recipe?.recipeIngredient)?recipe.recipeIngredient.map(clean).filter(Boolean).slice(0,100):Array.from(document.querySelectorAll('[itemprop=recipeIngredient]')).map(n=>clean(n.textContent)).filter(Boolean).slice(0,100),instructions:recipe?.recipeInstructions?steps(recipe.recipeInstructions):Array.from(document.querySelectorAll('[itemprop=recipeInstructions]')).flatMap(n=>steps(n.textContent)),format:recipe?'jsonld':'metadata'};
}
