import { Capacitor, registerPlugin } from '@capacitor/core'
export function platformInfo(bridge=Capacitor, env=globalThis) {
 const native=bridge.isNativePlatform(), os=native?bridge.getPlatform():'web'
 return {native,os,android:os==='android',ios:os==='ios',isNative:native,isIOS:os==='ios',isAndroid:os==='android',isWeb:!native,pwa:!native&&Boolean(env.matchMedia?.('(display-mode: standalone)').matches||env.navigator?.standalone)}
}
export const platform=platformInfo()
const DeviceScreen=registerPlugin('DeviceScreen')
export const nativeWakeApi=platform.native?{async request(){
 await DeviceScreen.setAwake({enabled:true})
 const target=new EventTarget()
 target.release=async()=>{await DeviceScreen.setAwake({enabled:false});target.dispatchEvent(new Event('release'))}
 return target
}}:undefined
