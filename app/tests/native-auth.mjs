import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {parseAppLink,consumeAuthLink,NATIVE_CALLBACK} from '../src/lib/app-links.js'
process.chdir(fileURLToPath(new URL('../../',import.meta.url)))
const local=localSupabase(),admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}})
const email='native-auth-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1',nextPassword=randomUUID()+'!Aa1'
const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}
const client=createClient(local.API_URL,local.ANON_KEY,{auth:{flowType:'pkce',storage,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false}})
const must=async p=>{const r=await p;if(r.error)throw Error(r.error.message);return r.data}
let uid,recovery=false
const {data:listener}=client.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')recovery=true})
try{
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 await must(client.auth.resetPasswordForEmail(email,{redirectTo:NATIVE_CALLBACK}))
 let mail
 for(let attempt=0;attempt<30;attempt++){
  const inbox=await(await fetch('http://127.0.0.1:47324/api/v1/messages')).json()
  mail=inbox.messages?.find(row=>row.To?.some(to=>to.Address===email))
  if(mail)break;await new Promise(resolve=>setTimeout(resolve,250))
 }
 assert(mail,'Native recovery email received in local Mailpit')
 const contents=await(await fetch('http://127.0.0.1:47324/api/v1/message/'+mail.ID)).json()
 const verify=contents.HTML.match(/href="([^"]+)"/)[1].replaceAll('&amp;','&')
 const response=await fetch(verify,{redirect:'manual'}),redirect=response.headers.get('location')
 assert(redirect?.startsWith(NATIVE_CALLBACK+'?code='),'Supabase uses the allowlisted native callback with PKCE code')
 console.log('PASS 1: Native reset email resolves to exact custom-scheme PKCE callback')
 const link=parseAppLink(redirect)
 const session=await consumeAuthLink(client,link)
 assert.equal(session.user.id,uid);assert.equal(recovery,true)
 console.log('PASS 2: PKCE verifier exchanges code and emits PASSWORD_RECOVERY')
 const restored=createClient(local.API_URL,local.ANON_KEY,{auth:{flowType:'pkce',storage,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false}})
 assert.equal((await must(restored.auth.getSession())).session.user.id,uid)
 console.log('PASS 3: Native auth adapter persists session across client restart')
 await must(client.auth.updateUser({password:nextPassword}))
 await must(client.auth.signOut({scope:'local'}))
 await must(client.auth.signInWithPassword({email,password:nextPassword}))
 console.log('PASS 4: Native recovery session can set and log in with the new password')
 assert((await client.auth.exchangeCodeForSession(link.code)).error)
 console.log('PASS 5: Recovery code cannot be reused')
}finally{
 listener.subscription.unsubscribe();await client.auth.signOut({scope:'local'}).catch(()=>{})
 if(uid)await admin.auth.admin.deleteUser(uid)
}
