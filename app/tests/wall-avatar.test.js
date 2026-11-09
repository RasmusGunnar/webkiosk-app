import test from 'node:test'
import assert from 'node:assert/strict'
import {WallDeviceService} from '../src/lib/wall-device.js'
import {personStack} from '../src/lib/person-avatars.js'
import {readFileSync} from 'node:fs'
const person={id:'ida',name:'Ida',color:'#b98486',avatar_path:'family/ida/avatar.png'}
const snapshot=()=>({device:{id:'display'},household:{id:'family'},people:[{...person}],items:[]})
test('Pending wall actions remain observable until success or failure, preventing update reload',async()=>{
 const action=Promise.withResolvers(),wall=new WallDeviceService({client:{rpc:()=>action.promise}})
 const pending=wall.complete({itemId:'synthetic',dueDate:'2026-11-11'})
 assert.equal(wall.activeActions,1);action.resolve({error:{message:'Synthetic failure'}})
 await assert.rejects(pending,/Synthetic failure/);assert.equal(wall.activeActions,0)
})
test('Wall reuses shared signed URL resolver with bounded cache and fresh person metadata',async()=>{
 let current=snapshot(),signs=0,last
 const client={
  rpc:()=>({abortSignal:async()=>({data:structuredClone(current)})}),
  storage:{from:bucket=>({createSignedUrls:async(paths,expiry)=>{
   assert.equal(bucket,'household-avatars');assert.equal(expiry,300);signs++
   return {data:paths.map(path=>({path,signedUrl:'https://local.test/'+signs}))}
  }})}
 }
 const wall=new WallDeviceService({client,onSnapshot:s=>last=s})
 await wall.refresh();assert.equal(last.people[0].avatar_display_url,'https://local.test/1')
 current.people[0].name='Ida updated';await wall.refresh();assert.equal(signs,1);assert.equal(last.people[0].name,'Ida updated')
 current.people[0].avatar_path='family/ida/new.png';await wall.refresh();assert.equal(signs,2)
 wall.stop();assert.equal(wall.avatarCache,null)
})
test('Revocation during photo signing cannot deliver a stale household snapshot',async()=>{
 const deferred=Promise.withResolvers();let delivered=false
 const client={rpc:()=>({abortSignal:async()=>({data:snapshot()})}),storage:{from:()=>({createSignedUrls:()=>deferred.promise})}}
 const wall=new WallDeviceService({client,onSnapshot:()=>delivered=true}),pending=wall.refresh()
 await new Promise(r=>setImmediate(r));wall.revoke();deferred.resolve({data:[{path:person.avatar_path,signedUrl:'https://local.test/photo'}]});await pending
 assert.equal(delivered,false);assert.equal(wall.device,null);assert.equal(wall.avatarCache,null)
})
test('Shared activity stack retains person colour, photo, initials and overflow without task status',()=>{
 const people=[{...person,avatar_url:'https://example.test/photo.png'},{id:'carl',name:'Carl',color:'#8e9e65'},{id:'jakob',name:'Jakob'},{id:'adult',name:'Forælder'}]
 const html=personStack({type:'Aktivitet',person_ids:people.map(p=>p.id),data:{aulaAssisted:true}},people,null)
 assert.match(html,/photo.png/);assert.match(html,/--person-color:#b98486/);assert.match(html,/aria-label="Carl"/);assert.match(html,/aria-label="Forælder"[^>]*>\+1/);assert.doesNotMatch(html,/person-status-badge|data-person-status/)
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');assert.match(main,/function renderItemAvatars\(item\)\{return personStack\(item,householdPeople,rewardState\)\}/)
})
