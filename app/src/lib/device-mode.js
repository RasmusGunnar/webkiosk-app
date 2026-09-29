export const DEVICE_KEY='familiekalender.device.v1'
export const defaults={wake:false,inactivity:15,accent:'#0f172a',tone:'cloud',density:'auto',shortcuts:{homey:'',sonos:'',custom:'',label:''}}
export function readDevice(storage,key=DEVICE_KEY){try{return JSON.parse(storage.getItem(key))||{}}catch{return {}}}
export function saveDevice(storage,value,key=DEVICE_KEY){storage.setItem(key,JSON.stringify(value));return value}
export function deviceSettings(device,userId,householdId){return {...defaults,...device.profiles?.[userId+':'+householdId],shortcuts:{...defaults.shortcuts,...device.profiles?.[userId+':'+householdId]?.shortcuts}}}
export function resolveMode(width,device,userId,householdId){return userId&&householdId&&device.kiosk?.userId===userId&&device.kiosk?.householdId===householdId?'kiosk':width<700?'mobile':'desktop'}
export function densityFor(mode,width,height,choice='auto'){return choice==='auto'?(mode==='kiosk'&&(width<1300||height<800)?'compact':'comfortable'):choice}
export function safeShortcut(input,{sonos=false}={}){
 const value=String(input||'').trim();if(!value)return ''
 let url;try{url=new URL(value)}catch{throw Error('Skriv et gyldigt link med https://.')}
 if(!['https:','http:',...(sonos?['sonos:','sonos-2:']:[])].includes(url.protocol)||url.username||url.password)throw Error('Linket skal være HTTP/HTTPS eller et Sonos-app-link uden indlejret login.')
 return url.href
}
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')
async function derive(pin,salt){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits'])
 return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256)))
}
export async function makePin(pin){if(!/^\d{4,8}$/.test(pin))throw Error('Vælg en PIN på 4–8 cifre.');const salt=hex(crypto.getRandomValues(new Uint8Array(16)));return {salt,digest:await derive(pin,salt)}}
export async function checkPin(pin,stored){return Boolean(stored?.salt&&stored?.digest&&await derive(pin,stored.salt)===stored.digest)}
export class WakeScreen{
 constructor({api=globalThis.navigator?.wakeLock,visible=()=>!document.hidden,onStatus=()=>{}}={}){Object.assign(this,{api,visible,onStatus});this.enabled=false;this.lock=null;this.pending=null;this.generation=0;this.status=api?'Fra':'Ikke understøttet i denne browser'}
 async set(enabled){this.enabled=enabled;this.generation++;if(!enabled){await this.lock?.release();this.lock=null;this.setStatus('Fra')}else await this.request()}
 setStatus(value){this.status=value;this.onStatus(value)}
 async request(){
  if(!this.enabled||!this.visible()||this.lock||this.pending)return
  if(!this.api){this.setStatus('Ikke understøttet i denne browser');return}
  const generation=this.generation
  this.pending=(async()=>{try{
   const lock=await this.api.request('screen')
   if(!this.enabled||generation!==this.generation){await lock.release();return}
   this.lock=lock;this.setStatus('Skærmen holdes vågen')
   lock.addEventListener('release',()=>{if(this.lock===lock){this.lock=null;this.setStatus(this.enabled?'Afventer aktiv skærm':'Fra')}})
  }catch{this.setStatus('Tryk på skærmen for at holde den vågen')}finally{this.pending=null}})()
  await this.pending
 }
 async visibility(){if(this.visible())await this.request();else if(this.lock){await this.lock.release();this.lock=null}}
}
export class DeviceClock{
 constructor({now=()=>new Date(),onTick=()=>{},onDay=()=>{},onIdle=()=>{},isKiosk=()=>false,isBusy=()=>false,timeout=()=>15}={}){
  Object.assign(this,{now,onTick,onDay,onIdle,isKiosk,isBusy,timeout});this.day='';this.lastInput=now().getTime();this.timer=null
 }
 touch(){this.lastInput=this.now().getTime()}
 tick(){
  const now=this.now(),day=[now.getFullYear(),now.getMonth(),now.getDate()].join('-')
  this.onTick(now)
  const changed=this.day&&day!==this.day;this.day=day
  if(changed)this.onDay(now)
  if(this.isKiosk()&&!this.isBusy()&&now.getTime()-this.lastInput>=this.timeout()*60000){this.touch();this.onIdle(now)}
 }
 start(){if(this.timer)return;this.tick();this.timer=setInterval(()=>this.tick(),1000)}
 stop(){clearInterval(this.timer);this.timer=null}
}
