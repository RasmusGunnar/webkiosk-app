import {platform} from './platform.js'
import {publicBase} from './app-links.js'

// Native assets are bundled at localhost/capacitor://localhost; API routes live
// on the public HTTPS app. Never send the account bearer token to a caller URL.
export function applicationApiBase({device=platform,env=import.meta.env||{},location=globalThis.location}={}){
 if(!device.native)return ''
 const base=publicBase(env,location)
 if(!base)throw Error('PUBLIC_APP_ORIGIN_REQUIRED')
 const url=new URL(base)
 if(url.protocol!=='https:'||['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('PUBLIC_APP_ORIGIN_REQUIRED')
 return url.origin
}
