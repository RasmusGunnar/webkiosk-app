import test from 'node:test'
import assert from 'node:assert/strict'
import {AvatarImageCache} from '../src/lib/avatar-cache.js'
import {avatarDisplayUrl,preparedAvatar} from '../src/lib/avatars.js'
import {WakeScreen,wakeEnabled,deviceSettings,saveDevice,readDevice} from '../src/lib/device-mode.js'
import {OfflineSync} from '../src/lib/offline-sync.js'
import {emptyRewards} from '../src/lib/rewards-model.js'
import {WallDeviceService} from '../src/lib/wall-device.js'
class Memory{
 constructor(){this.rows=new Map();this.tail=Promise.resolve()}
 async get(k){return structuredClone(this.rows.get(k))}
 update(k,fn){const run=this.tail.then(()=>{const r=fn(structuredClone(this.rows.get(k)));if(r===undefined)this.rows.delete(k);else this.rows.set(k,structuredClone({...r,key:k}));return r});this.tail=run.catch(()=>{});return run}
 put(k,v){return this.update(k,()=>v)}
 async removeWhere(fn){await this.tail;for(const [k,v]of this.rows)if(fn(v))this.rows.delete(k)}
 async clearUser(id){await this.removeWhere(r=>r.user_id===id)}
}
const person=(path='h/p/one.jpg')=>({id:'p',avatar_path:path})
const tick=()=>new Promise(r=>setImmediate(r))
function avatarFixture(options={}){
 const store=options.store||new Memory();let signs=0,fetches=0,decodes=0
 const client={storage:{from:()=>({createSignedUrls:async paths=>{signs++;return {data:paths.map(path=>({path,signedUrl:'https://storage.test/'+path+'?token=ephemeral'}))}}})}}
 const cache=new AvatarImageCache({store,origin:'https://storage.test',fetcher:async()=>{fetches++;return new Response(new Blob(['synthetic'],{type:'image/jpeg'}))},decode:async()=>{decodes++;return {}},thumbnail:async b=>b,...options})
 cache.use('u','h');return {store,cache,client,counts:()=>({signs,fetches,decodes})}
}
test('avatar memory and persistent cache avoid signing, requests and decoding on ordinary updates',async()=>{
 const x=avatarFixture();await x.cache.refresh(x.client,[person()]);const url=x.cache.apply([person()])[0].avatar_display_url
 assert(preparedAvatar(url));assert.equal(avatarDisplayUrl({avatar_display_url:url}),url)
 await x.cache.refresh(x.client,[{...person(),name:'Changed metadata'}]);assert.deepEqual(x.counts(),{signs:1,fetches:1,decodes:1})
 assert(!JSON.stringify([...x.store.rows.values()]).includes('token='))
 const warm=avatarFixture({store:x.store});await warm.cache.hydrate([person()]);await warm.cache.refresh(warm.client,[person()]);assert.deepEqual(warm.counts(),{signs:0,fetches:0,decodes:1})
 warm.cache.clear();x.cache.clear();await tick();assert.equal(x.store.rows.size,0);assert(!preparedAvatar(url))
})
test('path replacement keeps decoded photo until replacement is ready, then revokes old object URL',async()=>{
 const x=avatarFixture();await x.cache.refresh(x.client,[person()]);const old=x.cache.apply([person()])[0].avatar_display_url,wait=Promise.withResolvers()
 x.cache.fetcher=()=>wait.promise;const changed=person('h/p/two.webp'),refresh=x.cache.refresh(x.client,[changed]);await tick()
 assert.equal(x.cache.apply([changed])[0].avatar_display_url,old)
 wait.resolve(new Response(new Blob(['new'],{type:'image/webp'})));await refresh
 assert.notEqual(x.cache.apply([changed])[0].avatar_display_url,old);assert(!preparedAvatar(old));assert.equal(x.store.rows.size,1)
 await x.cache.refresh(x.client,[]);assert.equal(x.cache.entries.size,0);assert.equal(x.store.rows.size,0);x.cache.clear()
})
test('logout or household switch during image download cannot repopulate private cache',async()=>{
 const wait=Promise.withResolvers(),x=avatarFixture({fetcher:()=>wait.promise}),refresh=x.cache.refresh(x.client,[person()]);await tick()
 x.cache.use('u','different');wait.resolve(new Response(new Blob(['old'],{type:'image/jpeg'})));await refresh
 assert.equal(x.store.rows.size,0);assert.equal(x.cache.entries.size,0);x.cache.clear()
})
test('failed signing, wrong origin, oversized image and hostile blob URL keep safe initials',async()=>{
 for(const fetcher of [async()=>new Response('wrong MIME'),async()=>new Response(new Blob(['a'.repeat(2097153)],{type:'image/jpeg'}))]){
  const x=avatarFixture({fetcher});await x.cache.refresh(x.client,[person()]);assert.equal(x.cache.entries.size,0);x.cache.clear()
 }
 const x=avatarFixture();x.client.storage.from=()=>({createSignedUrls:async()=>({data:[{path:person().avatar_path,signedUrl:'https://elsewhere.test/photo'}]})})
 await x.cache.refresh(x.client,[person()]);assert.equal(x.counts().fetches,0)
 await x.cache.refresh(x.client,[person('other/p/photo.jpg')]);assert.equal(x.cache.entries.size,0)
 assert.equal(avatarDisplayUrl({avatar_display_url:'blob:unregistered'}),'');x.cache.clear()
})
test('wake setting defaults wall on/mobile off and persists independently of household',()=>{
 assert.equal(wakeEnabled({},true),true);assert.equal(wakeEnabled({},false),false)
 let data;const storage={setItem:(_k,v)=>data=v,getItem:()=>data};saveDevice(storage,{wake:true});const d=readDevice(storage)
 assert.equal(deviceSettings(d,'u','h1').wake,true);assert.equal(deviceSettings(d,'other','h2').wake,true)
 assert.equal(wakeEnabled({wake:false},true),false)
})
test('system release reacquires once with bounded backoff; policy rejection waits for interaction',async()=>{
 let callback,releaseEvent,requests=0,delay;const api={request:async()=>{requests++;return {release:async()=>{},addEventListener:(_e,f)=>releaseEvent=f}}}
 const w=new WakeScreen({api,visible:()=>true,schedule:(f,ms)=>{callback=f;delay=ms;return 1},cancel:()=>{callback=null}})
 await w.set(true);await w.set(true);assert.equal(requests,1);releaseEvent();assert.equal(delay,1000);callback();await tick();assert.equal(requests,2)
 releaseEvent();assert.equal(delay,2000);api.request=async()=>{requests++;throw Error('Policy')};callback();await tick();assert.equal(w.retry,null);const before=requests
 await w.interaction();assert.equal(requests,before+1);await w.set(false);assert.equal(w.retry,null)
})
test('hidden while wake request pending releases late lock and visible reacquires without crash',async()=>{
 let visible=true,released=0;const deferred=Promise.withResolvers(),w=new WakeScreen({api:{request:()=>deferred.promise},visible:()=>visible})
 const waiting=w.set(true);visible=false;await w.visibility();deferred.resolve({release:async()=>released++,addEventListener:()=>{}});await waiting
 assert.equal(w.lock,null);assert.equal(released,1);await w.set(false)
})
const reward=(action,pid='p')=>({p_upserts:[],p_delete_ids:[],p_expected:[],reward_action:{action,payload:{item_id:'t',person_id:pid,occurrence_date:'2026-11-11',due_date:'2026-11-11'},optimistic:{origin_id:'t',requires_approval:pid==='child',reward_mode:'none'}}})
test('durable background enqueue returns before ACK; rapid reverse and multiple people keep correct final state',async t=>{
 const wait=Promise.withResolvers(),store=new Memory();let n=0,server=emptyRewards()
 const e=await new OfflineSync({store,userId:'u',householdId:'h',online:()=>true,client:{rpc:async(_name,p)=>{if(++n===1)await wait.promise;server.occurrences=server.occurrences.filter(o=>o.person_id!==p.p_payload.person_id);server.occurrences.push({...p.p_payload,origin_id:'t',status:p.p_action==='undo'?'open':p.p_payload.person_id==='child'?'pending':'completed'});return {data:{rewards:structuredClone(server)}}}}}).init();t.after(()=>e.stop())
 const first=await e.enqueue(reward('complete'),{background:true});assert(first.queued);assert.equal(e.view.rewards.occurrences[0].status,'completed');assert.equal((await store.get(e.key)).queue.length,1)
 await e.enqueue(reward('undo'),{background:true});await e.enqueue(reward('complete','child'),{background:true});assert.equal(e.view.rewards.occurrences.find(o=>o.person_id==='p').status,'open');assert.equal(e.view.rewards.occurrences.find(o=>o.person_id==='child').status,'pending')
 wait.resolve();await e.replay();await tick();assert.equal(e.state.queue.length,0);assert.equal(server.occurrences.find(o=>o.person_id==='p').status,'open');assert.equal(n,3)
})
test('background queue never reports success before local transaction commits or on local storage failure',async t=>{
 const store=new Memory(),e=await new OfflineSync({store,client:{},userId:'u',householdId:'h',online:()=>false}).init();t.after(()=>e.stop())
 store.update=async()=>{throw Error('quota')};await assert.rejects(e.enqueue(reward('complete'),{background:true}),/quota/);assert.equal(e.view.rewards.occurrences.length,0)
})
test('wall reuses durable queue through restricted RPC; ACK, rejection and revocation remain isolated',async t=>{
 const store=new Memory(),wait=Promise.withResolvers(),calls=[];let latest,denied=false
 const snapshot=()=>({device:{id:'wall'},household:{id:'h'},items:[],people:[],rewards:emptyRewards()})
 const client={rpc:(name,p)=>({abortSignal:async()=>{calls.push({name,p});if(name==='wall_snapshot')return denied?{error:{code:'42501'}}:{data:snapshot()};if(name==='complete_task_as_device')return wait.promise;throw Error('Unexpected unrestricted API')}})}
 const wall=new WallDeviceService({client,store,userId:()=> 'anonymous',onSnapshot:s=>latest=s});t.after(()=>wall.stop())
 await wall.refresh();wall.engine.online=()=>true;await wall.engine.enqueue(reward('complete'),{background:true});await tick()
 assert.equal(latest.rewards.occurrences[0].status,'completed');assert.equal(wall.activeActions,1)
 assert.equal(calls.filter(c=>c.name==='complete_task_as_device').length,1)
 const sent=calls.find(c=>c.name==='complete_task_as_device').p;assert.equal(sent.p_person_id,'p');assert.equal(sent.p_action,'complete');assert(sent.p_request_id)
 wait.resolve({data:{rewards:{...emptyRewards(),occurrences:[{origin_id:'t',person_id:'p',status:'completed'}]}}});await wall.engine.replay();await tick();assert.equal(wall.activeActions,0)
 await wall.engine.enqueue(reward('approve'),{background:true});await wall.engine.replay();assert.equal(wall.engine.state.queue[0].status,'error');assert.equal(calls.filter(c=>c.name==='complete_task_as_device').length,1)
 denied=true;await wall.refresh();await tick();assert.equal(wall.device,null);assert.equal(wall.engine,null);assert.equal(store.rows.size,0)
})
