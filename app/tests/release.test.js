import test from 'node:test'
import assert from 'node:assert/strict'
import {parseAppLink,authCallback,inviteLink,consumeAuthLink,publicBase} from '../src/lib/app-links.js'
import {platformInfo} from '../src/lib/platform.js'
import {DeviceRegistration} from '../src/lib/device-registration.js'
import {installNativeRuntime} from '../src/lib/native-runtime.js'
const base='https://calendar.example.test',token='12345678-1234-4234-8234-123456789abc'.repeat(2)
test('same invitation model accepts HTTPS/native and rejects foreign origins and invalid tokens',()=>{
 assert.equal(parseAppLink(inviteLink(base,token),{base}).token,token)
 assert.equal(parseAppLink('familiekalender://invite#invite='+token,{base}).token,token)
 assert.equal(parseAppLink('https://evil.invalid/invite#invite='+token,{base}),null)
 assert.equal(parseAppLink(base+'/invite#invite=bad',{base}),null)
 assert.equal(parseAppLink('javascript:alert(1)',{base}),null)
})
test('callbacks use native scheme or production HTTPS and never native localhost',()=>{
 assert.equal(authCallback({native:true,base}),'familiekalender://auth/callback')
 assert.equal(authCallback({base}),base+'/auth/callback')
 assert.equal(publicBase({}, {origin:'https://localhost'}),'')
 assert.throws(()=>publicBase({VITE_PUBLIC_APP_URL:'http://prod.example'}))
})
test('calendar links reject impossible dates without throwing and accept leap days',()=>{
 assert.equal(parseAppLink(base+'/calendar?date=2026-99-01',{base}),null)
 assert.equal(parseAppLink(base+'/calendar?date=2026-02-29',{base}),null)
 assert.equal(parseAppLink(base+'/calendar?date=2028-02-29',{base}).date,'2028-02-29')
})
test('native implicit recovery and PKCE code are parsed without trusting arbitrary hosts',async()=>{
 const recovery=parseAppLink('familiekalender://auth/callback#access_token=a&refresh_token=r&type=recovery',{base})
 assert.equal(recovery.recovery,true)
 const session={user:{id:'u'}}
 const client={auth:{setSession:async value=>{assert.deepEqual(value,{access_token:'a',refresh_token:'r'});return {data:{session}}}}}
 assert.equal(await consumeAuthLink(client,recovery),session)
 assert.equal(parseAppLink(base+'/auth/callback?code=one-use',{base}).code,'one-use')
 assert.equal(parseAppLink(base+'/auth/callback#error_code=otp_expired',{base}).kind,'auth-error')
 await assert.rejects(()=>consumeAuthLink({auth:{exchangeCodeForSession:async()=>({error:true})}},{kind:'auth',code:'expired'}),/udløbet/)
})
test('platform classification is independent of product kiosk/mobile mode',()=>{
 const bridge={isNativePlatform:()=>true,getPlatform:()=>'ios'}
 assert.deepEqual(platformInfo(bridge,{}),{native:true,os:'ios',ios:true,android:false,isNative:true,isIOS:true,isAndroid:false,isWeb:false,pwa:false})
 assert.equal(platformInfo({isNativePlatform:()=>false},{matchMedia:()=>({matches:true})}).pwa,true)
})
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}}
function registration(){
 const calls=[],listeners={},pushCalls=[]
 const client={rpc:async(name,params)=>{calls.push({name,params});return {}}}
 const push={addListener:async(name,fn)=>{listeners[name]=fn;return {remove:async()=>delete listeners[name]}},checkPermissions:async()=>({receive:'prompt'}),requestPermissions:async()=>{pushCalls.push('permission');return {receive:'granted'}},register:async()=>pushCalls.push('register'),unregister:async()=>pushCalls.push('unregister')}
 const d=new DeviceRegistration({client,push,storage:storage(),platform:{native:true,os:'android'},enabled:true})
 return {d,calls,listeners,pushCalls}
}
test('device attach never asks permission; opt-in registers and token refresh replaces previous token',async()=>{
 const {d,calls,listeners,pushCalls}=registration()
 await d.attach('u','h');assert.equal(pushCalls.length,0)
 assert.equal(calls[0].params.p_push_token,null)
 await d.request();assert.deepEqual(pushCalls,['permission','register'])
 listeners.registration({value:'first'});await d.serial
 listeners.registration({value:'refreshed'});await d.serial
 assert.equal(calls.at(-1).params.p_push_token,'refreshed')
 await d.detach();assert.equal(calls.at(-1).name,'unregister_device');assert.equal(pushCalls.at(-1),'unregister')
 assert.equal(listeners.registration,undefined)
})
test('queued device writes from previous household never overwrite new context',async()=>{
 const {d,calls}=registration()
 await Promise.all([d.attach('u','h1'),d.attach('u','h2')])
 assert.equal(calls.at(-1).params.p_household_id,'h2')
 assert.equal(calls.filter(c=>c.params.p_household_id==='h1').length,0)
})
test('missing push credentials never call native permission APIs',async()=>{
 const {d,pushCalls}=registration();d.enabled=false
 await d.attach('u','h');await d.request();await d.resume();await d.detach()
 assert.equal(pushCalls.length,0)
})
test('native lifecycle coalesces duplicate state events and handles cold-start links',async()=>{
 const listeners={},links=[];let resumes=0,pauses=0
 const app={addListener:async(name,fn)=>{listeners[name]=fn;return {remove:async()=>delete listeners[name]}},getLaunchUrl:async()=>({url:'familiekalender://invite#invite=x'})}
 const dispose=await installNativeRuntime({native:true,app,onUrl:async url=>links.push(url),onResume:async()=>resumes++,onPause:async()=>pauses++,onBack:()=>{}})
 assert.equal(links.length,1)
 listeners.appStateChange({isActive:false});listeners.appStateChange({isActive:false})
 listeners.appStateChange({isActive:true});listeners.appStateChange({isActive:true})
 await Promise.resolve();assert.equal(pauses,1);assert.equal(resumes,1)
 dispose();assert.equal(Object.keys(listeners).length,0)
})
