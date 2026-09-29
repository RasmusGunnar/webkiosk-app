import { App } from '@capacitor/app'
import { platform } from './platform.js'
// Calls the same reconnect path as web, never remounts an editor on resume.
export async function installNativeRuntime({onUrl,onResume,onPause,onBack,app=App,native=platform.native}){
 if(!native)return ()=>{}
 const handles=[],add=async(name,fn)=>handles.push(await app.addListener(name,fn))
 let active=true,resuming=null
 await add('appUrlOpen',({url})=>void onUrl(url))
 await add('appStateChange',({isActive})=>{
  if(isActive===active)return
  active=isActive
  if(!active){void onPause();return}
  if(!resuming)resuming=Promise.resolve(onResume()).catch(()=>{}).finally(()=>{resuming=null})
 })
 if(platform.android)await add('backButton',()=>onBack())
 const launch=await app.getLaunchUrl()
 if(launch?.url)await onUrl(launch.url)
 return ()=>handles.forEach(handle=>void handle.remove())
}
