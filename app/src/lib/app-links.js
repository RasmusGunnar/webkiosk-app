import {t} from '../i18n/index.js'
// One model for verified HTTPS links, local development and the registered native scheme.
export const NATIVE_CALLBACK='familiekalender://auth/callback'
const TOKEN=/^[0-9a-f-]{72}$/i
export function publicBase(env={},location=globalThis.location) {
 const raw=env.VITE_PUBLIC_APP_URL
 if(raw){const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password)throw Error((t("app_links.the_public_app_url_must_use_https")));return url.origin}
 return location?.origin?.startsWith('http')&&location.origin!=='https://localhost'?location.origin:''
}
export function authCallback({native=false,base=''}={}){return native?NATIVE_CALLBACK:new URL('/auth/callback',base).href}
export function inviteLink(base,token){if(!TOKEN.test(token))throw Error((t("app_links.invalid_invitation")));return new URL('/invite',base).href+'#invite='+encodeURIComponent(token)}
export function parseAppLink(input,{base='',localOrigin=''}={}) {
 let url;try{url=new URL(input)}catch{return null}
 const native=url.protocol==='familiekalender:'
 const origins=[base,localOrigin].filter(Boolean).map(v=>new URL(v).origin)
 if(!native&&!origins.includes(url.origin))return null
 if(url.username||url.password)return null
 const path=native?'/'+url.hostname+url.pathname:url.pathname
 const hash=new URLSearchParams(url.hash.slice(1)),params=url.searchParams
 const get=key=>hash.get(key)||params.get(key)
 if(get('error')||get('error_code'))return {kind:'auth-error'}
 const token=get('invite')
 if(token&&TOKEN.test(token)&&['/','/invite','/invite/'].includes(path))return {kind:'invite',token}
 if(['/auth/callback','/','/auth/callback/'].includes(path)){
  const code=params.get('code'),access=hash.get('access_token'),refresh=hash.get('refresh_token'),type=get('type')
  if(code)return {kind:'auth',code,recovery:type==='recovery'}
  if(access&&refresh)return {kind:'auth',access,refresh,recovery:type==='recovery'}
 }
 const date=params.get('date'),item=params.get('item')
 if(path==='/calendar'&&date&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(new Date(date+'T12:00:00Z').getTime())&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date)
  return {kind:'calendar',date,item:item&&/^[0-9a-f-]{36}$/i.test(item)?item:null}
 return null
}
export async function consumeAuthLink(client,link){
 if(link.kind!=='auth')throw Error((t("app_links.invalid_sign_in_link")))
 const response=link.code?await client.auth.exchangeCodeForSession(link.code):await client.auth.setSession({access_token:link.access,refresh_token:link.refresh})
 if(response.error||!response.data?.session)throw Error((t("app_links.this_link_has_expired_or_has_already_been_used_request_a_new_link")))
 return response.data.session
}
