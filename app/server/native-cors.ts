import type {IncomingMessage,ServerResponse} from 'node:http';

// Only the bundled Capacitor origins. CORS grants no identity: each handler
// still verifies the user's JWT and current household membership.
export function nativeCors(req:IncomingMessage,res:ServerResponse):boolean{
 const origin=req.headers.origin;
 if(origin==='capacitor://localhost'||origin==='https://localhost'){
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
 }
 if(req.method!=='OPTIONS')return false;
 res.statusCode=origin==='capacitor://localhost'||origin==='https://localhost'?204:403;
 res.setHeader('Cache-Control','no-store');res.end();return true;
}
