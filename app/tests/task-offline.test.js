import test from 'node:test'
import assert from 'node:assert/strict'
import { taskEmoji, rewardEnabled, weeklyProgress } from '../src/lib/task-rewards.js'
import { safeFeedMetadata, safePeopleCache, scopeKey } from '../src/lib/local-store.js'
import { OfflineSync } from '../src/lib/offline-sync.js'
const people=[{id:'ida',name:'Ida',role:'child'},{id:'carl',name:'Carl',role:'child'},{id:'adult',name:'Mor',role:'adult'},{id:'enabled',name:'Far',role:'adult',reward_enabled:true}]
const task=(id,extra={})=>({id,title:'Lektier',date:'2026-09-28',type:'Opgave',done:true,person:'Alle',person_ids:[],data:{},...extra})
test('task emoji preserves all legacy mappings and free-text fallback',()=>{
 for(const [title,emoji] of [['Skole','🎒'],['Lektier','🎒'],['Tøm tasker','🎒'],['Opvask','🍽️'],['Dæk bordet','🍽️'],['Rydde op på værelset','🧹'],['Skrald','🗑️'],['Affald','🗑️'],['Madpakke','🥪'],['Custom','✅']])assert.equal(taskEmoji(title),emoji)
})
test('participation defaults with explicit override; no weekly reward tier',()=>{
 assert.equal('symbol' in weeklyProgress([task('one')],people,'2026-09-29','2026-09-29')[0],false)
 assert.deepEqual(people.map(rewardEnabled),[true,true,false,true])
 assert.equal(rewardEnabled({role:'child',reward_enabled:false}),false)
})
test('whole-week single, multi and Alle counts ignore future, undone and other types',()=>{
 const rows=[task('single',{person_ids:['ida']}),task('multi',{person_ids:['ida','carl']}),task('all'),task('future',{date:'2026-09-30'}),task('open',{done:false}),task('event',{type:'Aktivitet'})]
 assert.deepEqual(weeklyProgress(rows,people,'2026-09-29','2026-09-29').map(p=>[p.personId,p.count,p.week]),[['ida',3,40],['carl',2,40],['enabled',1,40]])
})
test('recurring first completion and overrides count once, never leak to next week',()=>{
 const base=task('base',{data:{repeatWeekly:true,exceptions:['2026-09-28']}})
 const override=task('override',{data:{overrideOf:'base',overrideBaseId:'base',originalDate:'2026-09-28'}})
 assert.equal(weeklyProgress([base,override],people,'2026-09-28','2026-10-10')[0].count,1)
 assert.equal(weeklyProgress([base,override],people,'2026-10-05','2026-10-10')[0].count,0)
})
test('history, moved occurrences and ISO year use calendar week and stable identity',()=>{
 const rows=[task('a',{date:'2025-12-29'}),task('b',{date:'2025-12-30',data:{overrideOf:'base',originalDate:'2025-12-22'}})]
 const result=weeklyProgress(rows,people,'2026-01-01','2026-09-28')[0]
 assert.equal(result.count,2);assert.equal(result.year,2026);assert.equal(result.week,1)
})
test('cache excludes feed URLs, private messages and expiring avatar signatures',()=>{
 const result=safeFeedMetadata([{id:'f',name:'ICS',feed_url:'https://example.invalid/private',sync_message:'private URL',import_token:'private'}])
 assert.deepEqual(result,[{id:'f',name:'ICS'}])
 assert.deepEqual(safePeopleCache([{id:'p',avatar_url:'household/p.png',avatar_display_url:'signed'}]),[{id:'p',avatar_url:'household/p.png'}])
 assert.notEqual(scopeKey('a','b'),scopeKey('b','a'))
})
class Memory {
 constructor(){this.rows=new Map()}
 async get(key){return structuredClone(this.rows.get(key))}
 async update(key,fn){const value=fn(await this.get(key));this.rows.set(key,structuredClone(value));return value}
}
async function setup(t,{online=false,rpc}={}) {
 const store=new Memory();let connected=online,version=0,fail=null
 const server=new Map([['a',task('a',{done:false,updated_at:'v0'})]])
 const receipts=new Map(),calls=[]
 const client={from:()=>({select:()=>({eq:()=>({order:()=>({range:async()=>({data:[...server.values()],error:null})})})})}),
 rpc:async(name,payload)=>{
 calls.push(payload)
 if(rpc)return rpc(name,payload)
 if(fail)return {error:fail}
 if(receipts.has(payload.p_mutation_id))return {data:{...receipts.get(payload.p_mutation_id),celebrations:[]}}
 if(payload.p_expected.some(row=>server.get(row.id)?.updated_at!==row.updated_at))return {error:{code:'P0001',message:'Kalenderen er ændret på en anden enhed.'}}
 const versions={}
 for(const id of payload.p_delete_ids)server.delete(id)
 for(const row of payload.p_upserts){versions[row.id]='v'+(++version);server.set(row.id,{...row,updated_at:versions[row.id]})}
 const data={row_versions:versions,celebrations:[]};receipts.set(payload.p_mutation_id,data);return {data}
 }}
 const engine=await new OfflineSync({store,client,userId:'u',householdId:'h',online:()=>connected}).init()
 t.after(()=>engine.stop());await engine.snapshot({items:[...server.values()]})
 return {engine,store,server,calls,online:()=>connected=true,fail:value=>fail=value,client}
}
const payload=(row,version)=>({p_expected:version?[{id:row.id,updated_at:version}]:[],p_upserts:[row],p_delete_ids:[]})
test('offline create/edit/delete replay durable order with versions rebased after ACK',async t=>{
 const x=await setup(t),e=x.engine
 await e.enqueue(payload(task('new',{done:false})),{action:'create'})
 await e.enqueue(payload(task('new',{title:'Edited'}),e.view.items.find(r=>r.id==='new').updated_at))
 await e.enqueue({p_expected:[{id:'a',updated_at:'v0'}],p_upserts:[],p_delete_ids:['a']},{action:'delete'})
 assert.equal((await x.store.get(e.key)).queue.length,3)
 assert.equal(e.view.items.length,1);x.online();await e.replay()
 assert.equal(e.state.queue.length,0);assert.equal(x.server.get('new').title,'Edited');assert.equal(x.server.has('a'),false)
})
test('consecutive done toggles coalesce preserving earliest server version',async t=>{
 const x=await setup(t),e=x.engine
 await e.enqueue(payload(task('a'), 'v0'),{action:'toggle_done'})
 await e.enqueue(payload(task('a',{done:false}),e.view.items[0].updated_at),{action:'toggle_done'})
 assert.equal(e.state.queue.length,1);assert.equal(e.state.queue[0].payload.p_expected[0].updated_at,'v0')
 x.online();await e.replay();assert.equal(x.server.get('a').done,false);assert.equal(x.calls.length,1)
})
test('network failure preserves optimistic durable queue and retries',async t=>{
 const x=await setup(t,{online:true});x.fail({message:'Failed to fetch'})
 await x.engine.enqueue(payload(task('a'),'v0'))
 assert.equal(x.engine.state.queue[0].status,'pending');assert.equal(x.engine.view.items[0].done,true)
 x.fail(null);await x.engine.replay();assert.equal(x.engine.state.queue.length,0)
})
test('server rejection rolls back optimistic checkbox and retains failed mutation',async t=>{
 const x=await setup(t,{online:true});x.fail({code:'42501',message:'Denied'})
 const result=await x.engine.enqueue(payload(task('a'),'v0'))
 assert.ok(result.error);assert.equal(x.engine.view.items[0].done,false);assert.equal(x.engine.state.queue[0].status,'error')
})
for(const choice of ['local','server'])test('conflict '+choice+' preserves remote until explicit resolution',async t=>{
 const x=await setup(t),e=x.engine
 await e.enqueue(payload(task('a',{title:'Mine'}),'v0'))
 x.server.set('a',task('a',{title:'Remote',updated_at:'v99'}));x.online();await e.replay()
 assert.equal(e.state.queue[0].status,'conflict');assert.equal(e.view.items[0].title,'Remote')
 await e.resolve(e.state.queue[0].id,choice)
 assert.equal(e.state.queue.length,0);assert.equal(x.server.get('a').title,choice==='local'?'Mine':'Remote')
})
test('use server discards dependent local edits to rejected create as a chain',async t=>{
 const x=await setup(t),e=x.engine
 await e.enqueue(payload(task('new')));const first=e.state.queue[0].id
 await e.enqueue(payload(task('new',{title:'Later'}),e.view.items.find(r=>r.id==='new').updated_at))
 await e.resolve(first,'server');assert.equal(e.state.queue.length,0);assert.equal(e.view.items.length,1)
})
test('realtime snapshot respects pending local overlay without duplicate rows',async t=>{
 const x=await setup(t),e=x.engine
 await e.enqueue(payload(task('a',{title:'Local draft'}),'v0'))
 await e.snapshot({items:[task('a',{title:'Remote',updated_at:'v2'}),task('b')]})
 assert.equal(e.view.items.length,2);assert.equal(e.view.items.find(r=>r.id==='a').title,'Local draft')
})
test('stopped sync cannot recreate purged household cache after an in-flight ACK',async t=>{
 let finish;const x=await setup(t,{online:true,rpc:()=>new Promise(resolve=>finish=resolve)})
 const pending=x.engine.enqueue(payload(task('a'),'v0'));while(!finish)await new Promise(resolve=>setTimeout(resolve,1))
 x.engine.stop();x.store.rows.clear();finish({data:{row_versions:{a:'v1'},celebrations:[]}});await pending
 assert.equal(x.store.rows.size,0)
})

test('lost response followed by remote deletion uses receipt without resurrecting cached item',async t=>{
 const x=await setup(t),e=x.engine
 await e.enqueue(payload(task('a'),'v0'))
 const pending=structuredClone(e.state.queue[0]);x.online();await e.replay()
 x.server.delete('a')
 // Simulate a crash after the server committed, before IndexedDB removed its queue entry.
 await e.change(state=>({...state,queue:[pending]}))
 const original=x.client.rpc
 x.client.rpc=async(name,payload)=>{const result=await original(name,payload);return {data:{...result.data,already_applied:true}}}
 await e.replay()
 assert.equal(e.state.queue.length,0);assert.equal(e.view.items.length,0)
})

test('failed create also rolls back optimistic dependent edits until resolved',async t=>{
 const x=await setup(t),e=x.engine
 await e.enqueue(payload(task('new',{done:false})))
 await e.enqueue(payload(task('new'),e.view.items.find(r=>r.id==='new').updated_at))
 x.fail({code:'42501',message:'Denied'});x.online();await e.replay()
 assert.equal(e.state.queue.length,2);assert.equal(e.view.items.some(r=>r.id==='new'),false)
 x.fail(null);await e.retry()
 assert.equal(e.state.queue.length,0);assert.equal(x.server.get('new').done,true)
})

test('service-worker update cannot replace installed HTML with uncached newer assets',async()=>{
 const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm')
 const handlers={},cached={body:'installed-v1-html'},requests=[]
 const code=(await readFile(new URL('../src/sw-template.js',import.meta.url),'utf8')).replace('__VERSION__','fixture').replace('__PRECACHE__','["./","./index.html","./assets/v1.js"]')
 runInNewContext(code,{URL,Response,self:{registration:{scope:'https://example.invalid/app/'},location:{origin:'https://example.invalid'},addEventListener:(name,fn)=>handlers[name]=fn},
 caches:{open:async()=>({match:async()=>cached})},fetch:request=>{requests.push(request);return {body:'new-v2-html-with-uncached-assets'}}})
 let response
 handlers.fetch({request:{method:'GET',url:'https://example.invalid/app/?view=today',mode:'navigate'},respondWith:promise=>response=promise})
 assert.equal(await response,cached);assert.equal(requests.length,0)
 let intercepted=false
 handlers.fetch({request:{method:'GET',url:'https://api.example.invalid/private',mode:'cors'},respondWith:()=>intercepted=true})
 assert.equal(intercepted,false)
})
