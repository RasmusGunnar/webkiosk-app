import {platform} from './platform.js'

export function validateAulaAuthorizeUrl(value){
 const url=new URL(value)
 if(url.origin!=='https://login.aula.dk'||url.pathname!=='/simplesaml/module.php/oidc/authorize.php'||url.username||url.password||url.searchParams.get('code_challenge_method')!=='S256'||!url.searchParams.get('state'))throw Error('AULA_LOGIN_BLOCKED')
 return url.href
}
export async function openAulaBrowser(url,{native=platform.native,onClose=()=>{}}={}){
 const safe=validateAulaAuthorizeUrl(url)
 if(native){const {Browser}=await import('@capacitor/browser');const listener=await Browser.addListener('browserFinished',onClose);try{await Browser.open({url:safe});return ()=>void listener.remove()}catch(e){await listener.remove();throw e}}
 else window.location.assign(safe)
}
export async function closeAulaBrowser(){if(platform.native){const {Browser}=await import('@capacitor/browser');await Browser.close().catch(()=>{})}}
