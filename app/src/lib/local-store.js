// The transaction commits before a write is reported as safely stored.
export const DATABASE_NAME='familiekalender-offline-v1'
export class LocalStore {
  constructor(name=DATABASE_NAME) { this.name=name; this.connection=null }
  async db() {
    if(!this.connection)this.connection=new Promise((resolve,reject)=>{
      const request=indexedDB.open(this.name,1)
      request.onupgradeneeded=()=>request.result.createObjectStore('records',{keyPath:'key'})
      request.onerror=()=>{this.connection=null;reject(request.error)}
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.connection=null};resolve(db)}
      request.onblocked=()=>reject(new Error('Luk andre gamle appfaner og prøv igen.'))
    })
    return this.connection
  }
  async get(key) {
    const db=await this.db()
    return new Promise((resolve,reject)=>{const tx=db.transaction('records'),request=tx.objectStore('records').get(key)
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
  }
  async update(key,transform) {
    const db=await this.db()
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('records','readwrite'),store=tx.objectStore('records'),request=store.get(key);let result,error
      request.onsuccess=()=>{try{result=transform(request.result);if(result===undefined)store.delete(key);else store.put({...result,key})}catch(cause){error=cause;tx.abort()}}
      tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||new Error('Lokallagring mislykkedes'))
      tx.onerror=()=>{error=tx.error}
    })
  }
  put(key,value){return this.update(key,()=>value)}
  async clearUser(userId) {
    const db=await this.db()
    return new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite'),request=tx.objectStore('records').openCursor()
      request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;if(cursor.value.user_id===userId)cursor.delete();cursor.continue()}
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)})
  }
}
export const scopeKey=(userId,householdId)=>'household:'+userId+':'+householdId
export function safeFeedMetadata(feeds) {
  const keys=['id','household_id','source','name','assigned_person_id','assigned_person_name','is_active','last_sync_at','last_sync_status','last_attempt_at','last_result','last_import_count']
  return feeds.map(feed=>Object.fromEntries(keys.filter(key=>key in feed).map(key=>[key,feed[key]])))
}
export function safePeopleCache(people) {return people.map(({avatar_display_url,...person})=>person)}
