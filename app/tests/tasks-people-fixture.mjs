// Full app UI with a loopback-only fixture bridge to real PostgreSQL/WASM RPCs.
// Auth/session + HTTP routing are test doubles; hosted Supabase and websocket
// transport are never used. See database-results.json for that coverage boundary.
import {chromium,expect} from '@playwright/test'
import {createServer} from 'vite'
import {randomUUID} from 'node:crypto'
import {mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import sharp from 'sharp'
import {db,query,actor,today,ids} from './tasks-people-db.mjs'
import {routeTo,openCreate} from './browser-actions.mjs'
const out=new URL('../../supabase/.temp/tasks-people-ux/',import.meta.url),root='http://127.0.0.1:5196',api='http://127.0.0.1:47329'
mkdirSync(out,{recursive:true})
const hid=randomUUID(),rasmus=randomUUID(),carl=randomUUID(),ordinary=randomUUID(),approval=randomUUID(),activity=randomUUID(),overflow=randomUUID()
const personIds=[rasmus,carl,...Array.from({length:3},()=>randomUUID())]
await actor(null)
await query("insert into public.households(id,name,created_by) values($1,'Familien Jensen',$2)",[hid,ids.adult])
await query("insert into public.household_members(household_id,user_id,role) values($1,$2,'owner'),($1,$3,'child') on conflict do nothing",[hid,ids.adult,ids.child])
for(const [i,name]of ['Rasmus','Carl','Ida','Jakob','Sofie'].entries())await query("insert into public.household_people(id,household_id,name,role,color,sort_order) values($1,$2,$3,$4,$5,$6)",[personIds[i],hid,name,i===0?'adult':'child',['#6b8da0','#8e9e65','#b98486','#b69562','#9484ad'][i],i])
for(const [id,title,type,persons,approvalRequired]of [[ordinary,'Tøm opvaskemaskinen','Opgave',[rasmus,carl],false],[approval,'Gør skoletasken klar','Opgave',[rasmus,carl],true],[activity,'Fodboldtræning','Fritidsinteresse',[carl,rasmus],false],[overflow,'Familiedag i skoven','Aktivitet',personIds,false]])await query("insert into public.calendar_items(id,household_id,created_by,title,type,date,time,person_ids,data) values($1,$2,$3,$4,$5,$6,'16:00',$7,$8::jsonb)",[id,hid,ids.adult,title,type,today,persons,JSON.stringify({rewardMode:'none',requiresApproval:approvalRequired})])
const env={VITE_SUPABASE_URL:api,VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_local_fixture_only'}
const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),define:Object.fromEntries(Object.entries(env).map(([k,v])=>['import.meta.env.'+k,JSON.stringify(v)])),server:{host:'127.0.0.1',port:5196,strictPort:true}});await server.listen()
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const context=await browser.newContext({locale:'da-DK',timezoneId:'Europe/Copenhagen',viewport:{width:390,height:844},hasTouch:true})
const checks=[],shots=[],errors=[],unknown=[],pass=name=>{checks.push(name);console.log('BROWSER PASS '+name)}
const user={id:ids.adult,email:'review@example.test',role:'authenticated',aud:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()}
const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture'
const session={user,access_token:token,refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer'}
await context.addInitScript(({session})=>{if(!localStorage.getItem('sb-127-auth-token'))localStorage.setItem('sb-127-auth-token',JSON.stringify(session));localStorage.setItem('familiekalender.locale','da-DK')},{session})
let serial=Promise.resolve()
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url())
 if(url.origin!==api)return ['127.0.0.1','localhost'].includes(url.hostname)?route.continue():route.abort()
 const run=async()=>{
  let data,status=200
  try{
   const uid=JSON.parse(Buffer.from(request.headers().authorization.split('.')[1],'base64url').toString()).sub
   if(![ids.adult,ids.child].includes(uid))throw Error('Unknown fixture identity')
   await actor(uid)
   if(url.pathname==='/auth/v1/user')data={...user,id:uid}
   else if(url.pathname.startsWith('/rest/v1/rpc/')){
    const name=url.pathname.split('/').pop(),body=request.postDataJSON()||{}
    if(!['get_reward_state','reward_action','subscription_access','list_household_members','list_hidden_calendar_imports','sync_calendar_mutation'].includes(name))throw Error('Unexpected RPC '+name)
    const entries=Object.entries(body);data=(await query(`select public.${name}(${entries.map(([k],i)=>{if(!/^p_[a-z_]+$/.test(k))throw Error('bad parameter');return k+'=>$'+(i+1)}).join(',')}) result`,entries.map(([,v])=>typeof v==='object'&&v!==null?JSON.stringify(v):v))).rows[0].result
   }else if(url.pathname.startsWith('/rest/v1/')){
    const table=url.pathname.split('/').pop()
    if(!['households','household_members','household_people','calendar_items','calendar_feeds','calendar_revisions','profiles','recipes','recipe_ratings','recipe_ingredients','recipe_instructions','household_invitations'].includes(table))throw Error('Unexpected table '+table)
    if(request.method()!=='GET'&&request.method()!=='HEAD')throw Error('Unexpected write '+table)
    const values=[],where=[]
    for(const [key,value]of url.searchParams){if(['select','order','limit','offset'].includes(key))continue;if(!/^[a-z_]+$/.test(key)||!value.startsWith('eq.'))throw Error('Unsupported filter '+key);values.push(value.slice(3));where.push(key+'=$'+values.length)}
    if(table==='households'){values.push(hid);where.push('id=$'+values.length)}
    const order=(url.searchParams.get('order')||'').split(',').filter(Boolean).map(part=>{const [column,direction]=part.split('.');if(!/^[a-z_]+$/.test(column)||!['asc','desc'].includes(direction))throw Error('Unsupported order');return column+' '+direction}).join(',')
    data=(await query('select to_jsonb(t) data from public.'+table+' t'+(where.length?' where '+where.join(' and '):'')+(order?' order by '+order:''),values)).rows.map(r=>r.data)
    if((request.headers().accept||'').includes('vnd.pgrst.object'))data=data[0]||null
   }else throw Error('Unexpected fixture request '+url.pathname)
  }catch(e){status=400;data={code:e.code||'FIXTURE',message:e.message};if(!e.code)unknown.push(e.message)}
  await route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*','content-range':Array.isArray(data)?`0-${Math.max(0,data.length-1)}/${data.length}`:'*'},body:JSON.stringify(data)})
 }
 const next=serial.then(run);serial=next.catch(()=>{});await next
})
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000)
const shot=async(name,label)=>{await expect(page.locator('.reward-delta')).toHaveCount(0);const taskId=/^(04|05)-/.test(name)?ordinary:/^(06|07|08|09)-/.test(name)?approval:null;if(taskId)await page.locator('[data-reward-task="'+taskId+'"]').evaluate(el=>el.scrollIntoView({block:'center'}));await page.screenshot({path:fileURLToPath(new URL(name+'.png',out)),fullPage:false});shots.push({name,label})}
const fits=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
export {db,query,actor,today,ids,out,root,api,hid,rasmus,carl,personIds,ordinary,approval,activity,overflow,server,browser,context,page,checks,shots,errors,unknown,pass,shot,fits,session,user};
export async function switchUser(uid){
 const access_token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:uid,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture';
 await page.evaluate(session=>localStorage.setItem('sb-127-auth-token',JSON.stringify(session)),{...session,access_token,user:{...user,id:uid}});await page.reload();await expect(page.locator('.product-nav')).toBeVisible();
 // The shell may use cached data immediately. Scenarios start after the new
 // identity's initial refresh, rather than racing that legitimate data update.
 await page.waitForLoadState('networkidle');
}
