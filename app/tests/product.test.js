import test from 'node:test'
import assert from 'node:assert/strict'
import {readDevice,saveDevice,resolveMode,deviceSettings,densityFor,makePin,checkPin,WakeScreen,DeviceClock,safeShortcut} from '../src/lib/device-mode.js'
import {upcomingItems,consumeInvite,callbackUrl,invitationStatus} from '../src/lib/product-model.js'
const storage=()=>{const rows=new Map();return {getItem:key=>rows.get(key),setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)}}
test('device persistence is explicit and scoped to authenticated user and household',()=>{
 const s=storage(),device={kiosk:{userId:'u',householdId:'h'},profiles:{'u:h':{wake:true,accent:'#2563eb'}}};saveDevice(s,device)
 assert.equal(resolveMode(390,readDevice(s),'u','h'),'kiosk');assert.equal(resolveMode(1920,readDevice(s),'u','other'),'desktop')
 assert.equal(resolveMode(390,readDevice(s),'other','h'),'mobile');assert.equal(resolveMode(1024,{},undefined,undefined),'desktop')
 assert.equal(deviceSettings(device,'u','other').wake,false);assert.equal(deviceSettings(device,'u','h').wake,true)
 delete device.kiosk;assert.equal(resolveMode(390,device,'u','h'),'mobile')
})
test('PIN hashes are salted and verify without saving the raw PIN',async()=>{
 const a=await makePin('1948'),b=await makePin('1948');assert.notEqual(a.digest,b.digest);assert(!JSON.stringify(a).includes('1948'))
 assert(await checkPin('1948',a));assert(!await checkPin('1949',a));await assert.rejects(()=>makePin('abc'))
})
test('wake lock is opt-in, deduplicated, released and reacquired on visibility',async()=>{
 let requested=0,released=0,visible=true
 const lock=()=>({release:async()=>{released++},addEventListener:()=>{}})
 const wake=new WakeScreen({api:{request:async()=>{requested++;return lock()}},visible:()=>visible})
 await wake.request();assert.equal(requested,0)
 await Promise.all([wake.set(true),wake.request()]);assert.equal(requested,1)
 visible=false;await wake.visibility();assert.equal(released,1)
 visible=true;await wake.visibility();assert.equal(requested,2)
 await wake.set(false);await wake.request();assert.equal(requested,2);assert.equal(released,2)
})
test('wake lock fallback and denied requests never break the screen',async()=>{
 const missing=new WakeScreen({api:null,visible:()=>true});await missing.set(true);assert.match(missing.status,/Ikke understøttet/)
 const denied=new WakeScreen({api:{request:async()=>{throw Error('Denied')}},visible:()=>true});await denied.set(true);assert.match(denied.status,/Tryk/)
})
test('late wake request after kiosk exit is released',async()=>{
 let finish,released=0
 const wake=new WakeScreen({api:{request:()=>new Promise(resolve=>finish=resolve)},visible:()=>true})
 const pending=wake.set(true);await wake.set(false);finish({release:async()=>released++,addEventListener:()=>{}});await pending
 assert.equal(released,1);assert.equal(wake.lock,null)
})
test('midnight and ISO year rollover fire once, even if rendering ticks reentrantly',()=>{
 let time=new Date('2026-12-31T23:59:00'),days=0
 const clock=new DeviceClock({now:()=>time,onDay:()=>{days++;clock.tick()}})
 clock.tick();time=new Date('2027-01-01T00:01:00');clock.tick();clock.tick();assert.equal(days,1)
 clock.start();const timer=clock.timer;clock.start();assert.equal(clock.timer,timer);clock.stop()
})
test('kiosk idle reset respects drafts, recent interaction and mobile mode',()=>{
 let time=new Date('2026-09-29T10:00:00'),busy=false,kiosk=true,resets=0
 const clock=new DeviceClock({now:()=>time,isBusy:()=>busy,isKiosk:()=>kiosk,onIdle:()=>resets++,timeout:()=>15})
 time=new Date(+time+14*60000);clock.tick();assert.equal(resets,0)
 busy=true;time=new Date(+time+2*60000);clock.tick();assert.equal(resets,0)
 clock.touch();busy=false;clock.tick();assert.equal(resets,0)
 time=new Date(+time+16*60000);clock.tick();assert.equal(resets,1)
 kiosk=false;time=new Date(+time+16*60000);clock.tick();assert.equal(resets,1)
})
test('responsive density and shortcuts enforce supported protocols',()=>{
 assert.equal(densityFor('kiosk',1024,600),'compact');assert.equal(densityFor('kiosk',1920,1080),'comfortable')
 assert.equal(safeShortcut(''),'');assert.equal(safeShortcut('sonos://open',{sonos:true}),'sonos://open')
 for(const url of ['javascript:alert(1)','data:text/html,hi','https://name:pass@example.test'])assert.throws(()=>safeShortcut(url))
})
test('next appointments exclude past and tasks, include weekly and yearly occurrences',()=>{
 const rows=[{id:'past',title:'Past',date:'2026-09-29',time:'09:00',type:'Aktivitet',data:{}},{id:'task',date:'2026-09-29',time:'13:00',type:'Opgave',data:{}},{id:'weekly',title:'Weekly appointment',date:'2026-09-22',time:'13:00',type:'Aktivitet',data:{repeatWeekly:true}},{id:'birthday',date:'2016-09-30',type:'Fødselsdag',data:{birthYear:2016}}]
 const items=upcomingItems(rows,[],'Alle',new Date('2026-09-29T12:00:00'))
 assert.equal(items[0].date,'2026-09-29');assert.equal(items[0].title,'Weekly appointment');assert(items.some(i=>i.type==='Fødselsdag'&&i.date==='2026-09-30'))
 assert(!items.some(i=>['past','task'].includes(i.id)))
})
test('invitation token survives login in session storage and is removed from address bar',()=>{
 const s=storage(),token='11111111-1111-4111-8111-11111111111122222222-2222-4222-8222-222222222222'
 let replaced;const location={hash:'#invite='+token,origin:'http://localhost:5173',pathname:'/app/',search:''}
 assert.equal(consumeInvite(location,{replaceState:(_a,_b,url)=>replaced=url},s),token);assert(!replaced.includes(token))
 assert.equal(consumeInvite({...location,hash:''},{},s),token);assert.equal(callbackUrl(location),'http://localhost:5173/app/')
 assert.equal(invitationStatus({revoked_at:'x'}),'Tilbagekaldt')
})

test('incomplete legacy birthday rows do not break the Today overview',()=>{assert.deepEqual(upcomingItems([{id:'empty',type:'Fødselsdag',date:null,data:{}}],[]),[])})
