import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {emitKeypressEvents} from 'node:readline';
import {pathToFileURL} from 'node:url';
import QRCode from 'qrcode';
import {AulaLoginClient} from '../server/aula/vendor/aula-login-client.ts';
import {AulaHttpClient} from '../server/aula/vendor/http.ts';
import {safeError} from '../server/aula/security.ts';

export const TARGET='https://familiekalender-alpha.vercel.app/api/aula-handoff';
export function promptHidden(label,signal){
 if(!process.stdin.isTTY)throw new Error('TERMINAL_REQUIRED');
 process.stdout.write(label+' ');emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{
  let value='';const finish=()=>{process.stdin.off('keypress',press);signal.removeEventListener('abort',cancel);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
  const cancel=()=>{value='';finish();reject(new DOMException('Cancelled','AbortError'));};
  const press=(text,key)=>{if(key?.ctrl&&key.name==='c')return cancel();if(key?.name==='return'){const answer=value.trim();value='';finish();resolve(answer);}else if(key?.name==='backspace')value=value.slice(0,-1);else if(text&&!key?.ctrl&&!/[\x00-\x1f\x7f]/.test(text)&&value.length<256)value+=text;};
  signal.addEventListener('abort',cancel,{once:true});process.stdin.on('keypress',press);if(signal.aborted)cancel();
 });
}
export async function qrServer(){
 let state={status:'Venter på MitID …',images:[]};const path='/'+randomBytes(24).toString('hex'),nonce=randomBytes(24).toString('base64');
 const server=createServer((req,res)=>{
  const host=`127.0.0.1:${server.address().port}`;
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');res.setHeader('x-frame-options','DENY');
  res.setHeader('content-security-policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
  if(req.method!=='GET'||req.headers.host!==host||(req.headers.origin&&req.headers.origin!==`http://${host}`)||!['same-origin','none',undefined].includes(req.headers['sec-fetch-site'])){res.statusCode=403;res.end();return;}
  if(req.url===path+'/state'){res.setHeader('content-type','application/json');res.end(JSON.stringify(state));return;}
  if(req.url!==path){res.statusCode=404;res.end();return;}
  res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="da"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aula – Familiekalender</title><style>body{font:20px system-ui;max-width:600px;margin:48px auto;padding:24px;text-align:center;background:#f4f8f6;color:#183d32}img{max-width:100%;height:auto;background:white}p{line-height:1.5}</style><h1>Aula – Familiekalender</h1><p id="status">Venter på MitID …</p><img id="qr" width="300" height="300" alt="MitID QR-kode" hidden><p>Scan med MitID-appen og godkend selv. Eventuelt identitetsvalg sker i terminalen.</p><script nonce="${nonce}">let images=[],index=0;setInterval(()=>{const q=document.querySelector('#qr');q.hidden=!images.length;if(images.length)q.src=images[index++%images.length]},900);async function poll(){try{const r=await fetch(location.pathname+'/state',{cache:'no-store'});if(!r.ok)throw 0;const s=await r.json();document.querySelector('#status').textContent=s.status;images=s.images;setTimeout(poll,500)}catch{images=[];document.querySelector('#qr').hidden=true;document.querySelector('#status').textContent='Forbindelsesværktøjet er afsluttet. Se resultatet i terminalen.'}}poll()</script></html>`);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}${path}`,set(value){state=value;},async close(){state={status:'Afsluttet',images:[]};server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
function openBrowser(url){
 return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-Command',`Start-Process '${url}'`],{windowsHide:true},error=>error?reject(new Error('BROWSER_OPEN_FAILED')):resolve()));
}
// Dependency injection is for synthetic tests only, never read from environment or CLI.
export async function runConnector({prompt=promptHidden,open=openBrowser,fetcher=fetch,login,output=console.log,makeQr=qrServer}={}){
 let secret='',username='',tokens=null,identityLabel='',qr=null,opts=null;
 const abort=new AbortController(),signal=AbortSignal.any([abort.signal,AbortSignal.timeout(540_000)]);
 const interrupt=()=>abort.abort();process.once('SIGINT',interrupt);
 try{
  output('Aula – Familiekalender\n----------------------');
  secret=await prompt('Indsæt forbindelseskoden fra Familiekalender:',signal);
  if(!/^[A-Za-z0-9_-]{43}$/.test(secret))throw new Error('INVALID_CODE');
  username=await prompt('MitID bruger-ID (skjult):',signal);
  if(username.length<2||username.length>128)throw new Error('INVALID_USERNAME');
  qr=await makeQr();await open(qr.url);
  opts={username,method:'APP',signal,maxPollMs:240_000,
   appCallbacks:{onWaiting:()=>qr.set({status:'Åbn MitID-appen.',images:[]}),onOtp:otp=>qr.set({status:`MitID engangskode: ${otp}`,images:[]}),onVerified:()=>qr.set({status:'Godkendt. Afslutter forbindelsen …',images:[]}),onQr:async q=>{const images=await Promise.all([q.qr1Json,q.qr2Json].map(text=>QRCode.toDataURL(text,{margin:2,errorCorrectionLevel:'M',width:300})));qr.set({status:'Scan QR-koden med MitID-appen.',images});}},
   selectIdentity:async options=>{qr.set({status:'Vælg identitet i terminalen.',images:[]});for(const o of options)output(`${o.index}: ${String(o.name).replace(/[\x00-\x1f\x7f]/g,'').slice(0,120)}`);const index=Number(await prompt('Vælg nummer:',signal));const selected=options.find(o=>o.index===index);if(!selected)throw new Error('INVALID_IDENTITY');identityLabel=selected.name.slice(0,120);return index;}
  };
  tokens=await(login??(o=>new AulaLoginClient({http:new AulaHttpClient({signal})}).login(o)))(opts);
  username='';opts.username='';tokens.access_token='';
  const response=await fetcher(TARGET,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({handoff_secret:secret,refresh_token:tokens.refresh_token,identity_label:identityLabel}),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(80_000)])});
  secret='';tokens.refresh_token='';identityLabel='';
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.connected!==true){const allowed=['AULA_HANDOFF_INVALID','AULA_RATE_LIMIT','AULA_BUSY','AULA_REAUTH_REQUIRED','AULA_TEMPORARY_ERROR','AULA_TIMEOUT','AULA_PROVIDER_FORMAT'];output('STATUS: FAIL');output('SAFE ERROR: '+(allowed.includes(data.code)?data.code:'AULA_HANDOFF_FAILED'));output('Opret en ny forbindelseskode i Familiekalender, før du prøver igen.');return false;}
  output('STATUS: PASS');output('Aula er forbundet. Gå tilbage til Familiekalender og kontrollér forbindelsen.');return true;
 }catch(error){const local=['INVALID_CODE','INVALID_USERNAME','INVALID_IDENTITY','TERMINAL_REQUIRED','BROWSER_OPEN_FAILED'];output('STATUS: FAIL');output('SAFE ERROR: '+(local.includes(error?.message)?error.message:safeError(error).code));return false;}
 finally{secret='';username='';identityLabel='';if(opts)opts.username='';opts=null;if(tokens){tokens.refresh_token='';tokens.access_token='';}tokens=null;abort.abort();process.off('SIGINT',interrupt);await qr?.close();qr=null;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await runConnector()?0:1;
