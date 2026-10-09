import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import {accessState,offeringPackages,localReviewEnabled,safeManagementUrl} from '../src/lib/subscription-model.js'
import {RevenueCatProvider} from '../src/lib/subscription-provider.js'
import {pairingValue,WallDeviceService} from '../src/lib/wall-device.js'
import {platformInfo} from '../src/lib/platform.js'
import {SubscriptionAccessService} from '../src/lib/subscription-access.js'
const now=Date.parse('2026-10-09T12:00:00Z'),future=new Date(now+86400000).toISOString(),past=new Date(now-1).toISOString()
for(const status of ['active','trialing','cancelled','grace','billing_issue'])test(status+' shares verified family access until expiry',()=>{
 const row={enabled:true,entitled:true,status,period_end:future,can_purchase:false}
 assert.equal(accessState(row,{role:'child',now}).canUsePremium,true)
 assert.equal(accessState(row,{role:'child',now}).canPurchase,false)
 assert.equal(accessState({...row,period_end:past},{now}).canUsePremium,false)
})
test('No client-only state can grant entitlement; rollout is explicitly disabled',()=>{
 assert.equal(accessState({enabled:true,status:'active',period_end:future},{now}).entitled,false)
 assert.equal(accessState({enabled:false,status:'none'},{now}).canUsePremium,true)
 assert.equal(accessState({enabled:true,entitled:true,period_end:null},{now}).canUsePremium,false)
})
test('Only online owner/admin may purchase and wall never may',()=>{
 const row={can_purchase:true}
 assert.equal(accessState(row,{role:'owner'}).canPurchase,true)
 for(const role of ['child','adult','member','device'])assert.equal(accessState(row,{role}).canPurchase,false)
 assert.equal(accessState(row,{role:'admin',wall:true}).canPurchase,false)
 assert.equal(accessState(row,{role:'admin',online:false}).canPurchase,false)
})
test('Offering uses default, store product prices and periods without price assumptions',()=>{
 const p={identifier:'store-month',packageType:'MONTHLY',product:{title:'Familie',priceString:'¥700',subscriptionPeriod:'P1M',introPrice:{price:0,priceString:'¥0'}}}
 assert.equal(offeringPackages({all:{default:{availablePackages:[p]},else:{availablePackages:[]}}})[0].price,'¥700')
 assert.equal(offeringPackages({all:{default:{availablePackages:[p]}}})[0].trial,true)
 assert.deepEqual(offeringPackages({current:{availablePackages:[p]}}),[])
})
test('Review provider requires DEV, explicit opt-in and both loopback app and backend',()=>{
 const env={DEV:true,VITE_NATIVE_REVIEW:'true',VITE_SUPABASE_URL:'http://127.0.0.1:47321'},loc={hostname:'localhost'}
 assert.equal(localReviewEnabled(env,loc),true)
 assert.equal(localReviewEnabled({...env,DEV:false},loc),false)
 assert.equal(localReviewEnabled({...env,VITE_NATIVE_REVIEW:'false'},loc),false)
 assert.equal(localReviewEnabled({...env,VITE_SUPABASE_URL:'https://example.supabase.co'},loc),false)
})
test('Native platform flags are centralized',()=>{
 for(const os of ['ios','android','web']){const p=platformInfo({isNativePlatform:()=>os!=='web',getPlatform:()=>os},{});assert.equal(p.isWeb,os==='web');assert.equal(p.isIOS,os==='ios');assert.equal(p.isAndroid,os==='android')}
})
test('RevenueCat identifies UUID, resets on logout, switches account without email or anonymous purchases',async()=>{
 const calls=[],sdk={async setLogLevel(){},async configure(v){calls.push(['configure',v.appUserID])},async logIn(v){calls.push(['login',v.appUserID])},async logOut(){calls.push(['logout'])}}
 const provider=new RevenueCatProvider({sdk,device:{isNative:true,isIOS:true},env:{VITE_REVENUECAT_IOS_API_KEY:'appl_local_test_public'}})
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222'
 await provider.identify(a);await provider.identify(a);await provider.identify(null);await provider.identify(b)
 assert.deepEqual(calls,[['configure',a],['logout'],['login',b]])
 await assert.rejects(provider.identify('person@example.test'))
})
test('Pairing accepts only opaque code or registered wall deep link',()=>{
 const token='a'.repeat(64);assert.equal(pairingValue('familiekalender://wall/pair#pair='+token),token)
 assert.equal(pairingValue('AB123-CD456'),'AB123-CD456')
 for(const value of ['https://evil.test/#pair='+token,'familiekalender://auth/callback#pair='+token,'secret','<script>'])assert.throws(()=>pairingValue(value))
})
test('Revocation stops timer/subscription and erases device reference',()=>{
 let revoked=false,removed=false;const wall=new WallDeviceService({client:{removeChannel(){removed=true}},onRevoked(){revoked=true}})
 wall.device={id:'test'};wall.channel={};wall.timer=setInterval(()=>{},1000);wall.revoke()
 assert.equal(wall.device,null);assert.equal(wall.timer,null);assert.equal(removed,true);assert.equal(revoked,true)
})
test('Management URLs stay within Apple/Google subscription management',()=>{
 assert.ok(safeManagementUrl('https://apps.apple.com/account/subscriptions'))
 for(const u of ['javascript:alert(1)','https://apps.apple.com.evil.test','https://user:pass@play.google.com'])assert.equal(safeManagementUrl(u),null)
})
test('Native bundle identifier preserved; billing-compatible activity mode',()=>{
 const config=JSON.parse(readFileSync(new URL('../capacitor.config.json',import.meta.url),'utf8'))
 assert.equal(config.appId,'dk.rasmusgunnar.familiekalender')
 assert.match(readFileSync(new URL('../android/app/src/main/AndroidManifest.xml',import.meta.url),'utf8'),/android:launchMode="singleTop"/)
})
test('Late subscription response for former household cannot leak into new account',async()=>{
 const requests=[],client={rpc(){return {abortSignal(){return new Promise(resolve=>requests.push(resolve))}}}},provider={async identify(){}}
 const access=new SubscriptionAccessService({client,provider})
 const first=access.attach({userId:'first',householdId:'old',role:'owner'})
 await new Promise(resolve=>setTimeout(resolve,0))
 const second=access.attach({userId:'second',householdId:'new',role:'adult'})
 await new Promise(resolve=>setTimeout(resolve,0))
 requests[1]({data:{enabled:true,entitled:false,status:'none'}});await second
 requests[0]({data:{enabled:true,entitled:true,status:'active',period_end:new Date(Date.now()+86400000).toISOString()}});await first
 assert.equal(access.state.entitled,false);assert.equal(access.context.householdId,'new')
 await access.detach();assert.equal(access.context,null);assert.equal(access.state.entitled,false)
})
test('Offline startup does not wait for provider/auth/network and cannot buy',async()=>{
 const access=new SubscriptionAccessService({client:{rpc(){throw Error('Network called while offline')}},provider:{identify(){throw Error('Provider called while offline')}},online:()=>false})
 const result=await access.attach({userId:'cached',householdId:'family',role:'owner'})
 assert.equal(result.canPurchase,false);assert.equal(result.canUsePremium,true);assert.equal(result.entitled,false);assert.equal(result.reason,'offline')
 assert.equal((await access.refresh()).canPurchase,false)
})
