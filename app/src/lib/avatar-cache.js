import {resolveAvatarUrls,thumbnailAvatar,registerAvatar,forgetAvatar,AVATAR_MAX_BYTES} from './avatars.js'
import {ready} from './performance.js'
const validBlob=blob=>blob instanceof Blob&&['image/jpeg','image/png','image/webp'].includes(blob.type)&&blob.size>0&&blob.size<=AVATAR_MAX_BYTES
const identity=p=>p.avatar_path?JSON.stringify([p.id,p.avatar_path]):''
// Uses the existing device-local IndexedDB, scoped to authenticated user + household.
// Signed URLs never enter persistent storage. Original storage objects are untouched.
export class AvatarImageCache{
 constructor({store,origin,changed=()=>{},fetcher=(...args)=>globalThis.fetch(...args),decode=async url=>{const image=new Image();image.src=url;await image.decode();return image},thumbnail=thumbnailAvatar}){
  Object.assign(this,{store,origin,changed,fetcher,decode,thumbnail});this.scope='';this.generation=0;this.entries=new Map();this.pending=new Map();this.wanted=new Map();this.hydrating=new Map()
 }
 use(userId,householdId){
  const scope=userId&&householdId?JSON.stringify([userId,householdId]):''
  if(scope===this.scope)return
  this.clear();this.scope=scope;this.userId=userId;this.householdId=householdId
 }
 clear(){
  const old=this.scope;this.generation++;this.scope='';this.hydrating.clear();this.wanted.clear()
  for(const entry of this.entries.values())this.release(entry)
  this.entries.clear();this.pending.clear()
  if(old)void this.store.removeWhere(r=>r.kind==='avatar'&&r.scope===old).catch(()=>{})
 }
 release(entry){forgetAvatar(entry.url);URL.revokeObjectURL(entry.url)}
 key(p){return 'avatar:'+this.scope+':'+identity(p)}
 apply(people){return people.map(p=>({...p,avatar_display_url:p.avatar_path?this.entries.get(p.id)?.url||'':''}))}
 async install(p,blob,version){
  if(!validBlob(blob)||version!==this.generation||this.wanted.get(p.id)!==identity(p))return false
  const url=URL.createObjectURL(blob)
  try{
   const image=await this.decode(url)
   if(version!==this.generation||this.wanted.get(p.id)!==identity(p)){URL.revokeObjectURL(url);return false}
   const old=this.entries.get(p.id);this.entries.set(p.id,{identity:identity(p),url,image});registerAvatar(url)
   if(old)this.release(old)
   ready('avatar_image_ready');this.changed();return true
  }catch{URL.revokeObjectURL(url);return false}
 }
 async hydrate(people){
  if(!this.scope)return
  const version=this.generation
  this.wanted=new Map(people.map(p=>[p.id,identity(p)]))
  await Promise.all(people.filter(p=>p.avatar_path&&this.entries.get(p.id)?.identity!==identity(p)).map(async p=>{
   const key=this.key(p)
   if(this.hydrating.has(key))return this.hydrating.get(key)
   const work=(async()=>{try{const row=await this.store.get(key);if(row?.scope===this.scope)await this.install(p,row.blob,version)}catch{}})()
   this.hydrating.set(key,work);try{await work}finally{this.hydrating.delete(key)}
  }))
 }
 async refresh(client,people){
  if(!this.scope)return
  const version=this.generation,scope=this.scope,user_id=this.userId,household_id=this.householdId
  const active=new Map(people.filter(p=>p.avatar_path?.startsWith(household_id+'/'+p.id+'/')).map(p=>[p.id,p]))
  for(const [id,entry]of this.entries)if(!active.has(id)){this.release(entry);this.entries.delete(id)}
  await this.hydrate([...active.values()]);if(version!==this.generation)return
  const missing=[...active.values()].filter(p=>this.entries.get(p.id)?.identity!==identity(p)&&!this.pending.has(identity(p)))
  const pendingKeys=missing.map(identity);for(const key of pendingKeys)this.pending.set(key,true)
  try{
   const signed=await resolveAvatarUrls(client,missing)
   await Promise.all(signed.map(async p=>{
    const cacheKey='avatar:'+scope+':'+identity(p)
    try{
     const url=new URL(p.avatar_display_url);if(url.origin!==this.origin||version!==this.generation)return
     const response=await this.fetcher(url.href,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(8000)})
     if(!response.ok||Number(response.headers.get('content-length'))>AVATAR_MAX_BYTES)return
     const blob=await response.blob();if(!validBlob(blob)||version!==this.generation)return
     const thumbnail=await this.thumbnail(blob)
     if(!await this.install(p,thumbnail,version))return
     const writeId=crypto.randomUUID()
     await this.store.put(cacheKey,{kind:'avatar',scope,user_id,household_id,person_id:p.id,identity:identity(p),blob:thumbnail,writeId}).catch(()=>{})
     if(version!==this.generation){await this.store.update(cacheKey,r=>r?.writeId===writeId?undefined:r);return}
     await this.store.removeWhere(r=>r.kind==='avatar'&&r.scope===scope&&r.person_id===p.id&&r.key!==cacheKey).catch(()=>{})
    }catch{}
   }))
   if(version===this.generation)await this.store.removeWhere(r=>r.kind==='avatar'&&r.scope===scope&&!this.wanted.has(r.person_id)).catch(()=>{})
  }catch{
   // Offline/expired signing never removes the already decoded picture.
  }finally{if(version===this.generation)for(const key of pendingKeys)this.pending.delete(key)}
 }
}
