import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import assert from 'node:assert/strict'
const l=localSupabase(),opts={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(l.API_URL,l.SERVICE_ROLE_KEY,opts),users=[],households=[],paths=[],checks=[]
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data}
const check=(n,v)=>{assert.ok(v,n);checks.push(n);console.log('PASS '+checks.length+': '+n)}
const make=async hid=>{const email='scan40-'+randomUUID()+'@example.test',password=randomUUID()+'Aa!1',u=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user;users.push(u.id);const c=createClient(l.API_URL,l.ANON_KEY,opts);await must(c.auth.signInWithPassword({email,password}));if(hid)await must(admin.from('household_members').insert({household_id:hid,user_id:u.id,role:'adult'}));return {c,id:u.id}}
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')
try{
 const first=await make(),hid=await must(first.c.rpc('create_household',{p_name:'Scan guardrails local'}));households.push(hid);const second=await make(hid),foreign=await make()
 const path=hid+'/'+randomUUID()+'/scan-'+first.id+'-'+randomUUID()+'.jpg';paths.push(path)
 await must(first.c.storage.from('recipe-images').upload(path,image,{contentType:'image/png'}))
 check('Private temporary upload readable by own household',!(await first.c.storage.from('recipe-images').download(path)).error)
 check('Another household cannot read originals',!!(await foreign.c.storage.from('recipe-images').download(path)).error)
 const denied=await foreign.c.functions.invoke('recipe-preview',{body:{action:'scan',household_id:hid,paths:[path]}})
 check('Actual Edge denies cross-household scan',denied.error?.context?.status===403)
 check('Denied scan did not delete another family image',!(await first.c.storage.from('recipe-images').download(path)).error)
 const result=await first.c.functions.invoke('recipe-preview',{body:{action:'scan',household_id:hid,paths:[path]}}),body=result.error?await result.error.context.json():result.data
 check('Actual Edge reports missing provider without fake result',body.error==='VISION_NOT_CONFIGURED'&&!body.recipe)
 check('Actual Edge deletes temp photo on missing-provider failure',!!(await first.c.storage.from('recipe-images').download(path)).error)
 for(let i=0;i<5;i++)check('User scan slot '+(i+2),await must(first.c.rpc('claim_recipe_scan',{p_household_id:hid})))
 check('Seventh scan denied for this user',await must(first.c.rpc('claim_recipe_scan',{p_household_id:hid}))===false)
 for(let i=0;i<6;i++)assert.equal(await must(second.c.rpc('claim_recipe_scan',{p_household_id:hid})),true)
 check('Household limit spans users',await must(second.c.rpc('claim_recipe_scan',{p_household_id:hid}))===false)
 check('Cross-household rate RPC denied',!!(await foreign.c.rpc('claim_recipe_scan',{p_household_id:hid})).error)
 const path2=hid+'/'+randomUUID()+'/scan-'+first.id+'-'+randomUUID()+'.jpg';paths.push(path2);await must(first.c.storage.from('recipe-images').upload(path2,image,{contentType:'image/png'}))
 const limited=await first.c.functions.invoke('recipe-preview',{body:{action:'scan',household_id:hid,paths:[path2]}})
 check('Actual Edge enforces rate and removes uploaded temp photo',limited.error?.context?.status===429&&!!(await first.c.storage.from('recipe-images').download(path2)).error)
 console.log('SCAN40 LOCAL API PASS '+checks.length)
}finally{if(paths.length)await admin.storage.from('recipe-images').remove(paths);for(const id of households)await must(admin.from('households').delete().eq('id',id));for(const id of users)await must(admin.auth.admin.deleteUser(id))}
