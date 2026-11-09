// One synthetic family for real local Auth/Storage/RPC and all three surfaces.
import {createClient} from '@supabase/supabase-js'
import {randomUUID,randomBytes} from 'node:crypto'
import sharp from 'sharp'
import {localEnvironment} from '../../scripts/aula-local.mjs'
export const fixtureDate='2026-11-11'
export const must=async query=>{const r=await query;if(r.error)throw Error(r.error.message);return r.data}
export async function wallAvatarFixture(){
 const env=localEnvironment(),options={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,options),client=createClient(env.SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,options),wall=createClient(env.SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,options),stranger=createClient(env.SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,options)
 const email='wall-parity-'+randomUUID()+'@example.invalid',password=randomUUID()+'Aa!1',user=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user
 await must(client.auth.signInWithPassword({email,password}));const hid=await must(client.rpc('create_household',{p_name:'Familien · fælles visuel test'}))
 const people=await must(client.from('household_people').insert([{name:'Ida',color:'#b98486',role:'child'},{name:'Carl',color:'#8e9e65',role:'child'},{name:'Jakob',color:'#7f95ac',role:'child'},{name:'Forælder',color:'#a78263',role:'adult'}].map(p=>({...p,household_id:hid}))).select())
 const [ida,carl,jakob,parent]=people
 const photo=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#e4d4d0"/><circle cx="80" cy="60" r="29" fill="#76535c"/><path d="M25 160v-17a55 55 0 0 1 110 0v17" fill="#76535c"/></svg>')).png().toBuffer()
 const photoPath=hid+'/'+ida.id+'/'+randomUUID()+'.png',orphanPath=hid+'/'+ida.id+'/'+randomUUID()+'.png'
 await must(client.storage.from('household-avatars').upload(photoPath,photo,{contentType:'image/png'}));await must(client.storage.from('household-avatars').upload(orphanPath,photo,{contentType:'image/png'}))
 await must(client.from('household_people').update({avatar_path:photoPath}).eq('id',ida.id));ida.avatar_path=photoPath
 carl.avatar_url='data:image/png;base64,'+photo.toString('base64');await must(client.from('household_people').update({avatar_url:carl.avatar_url}).eq('id',carl.id))
 parent.avatar_url='http://127.0.0.1:5198/fixture-photo-missing.png';await must(client.from('household_people').update({avatar_url:parent.avatar_url}).eq('id',parent.id))
 await must(admin.from('aula_connections').insert({household_id:hid,created_by:user.id,status:'disconnected',identity_label:'PRIVATE_IDENTITY_FIXTURE'}))
 const rows=[]
 for(const [title,ids,time]of [['Husk tuscher',[ida.id],'09:00'],['Skolearrangement',[ida.id,carl.id],'10:00'],['Husk gymnastiktøj',[jakob.id],'11:00'],['Forældremøde',[parent.id],'12:00'],['Fælles skoledag',people.map(p=>p.id),'13:00']]){
  const f=await must(admin.from('aula_findings').insert({household_id:hid,person_id:ids.length===1?ids[0]:null,person_ids:ids,source_kind:'message',source_key:randomBytes(32).toString('hex'),type:'REMINDER',title,date:fixtureDate,time,confidence:'HIGH',reason:'Synthetic class mapping',summary:'Synthetic school planning only',proposed_action:'CREATE_ACTIVITY'}).select().single())
  const accepted=await must(client.rpc('aula_review',{p_household_id:hid,p_finding_id:f.id,p_action:'accept',p_person_ids:ids}));rows.push(await must(client.from('calendar_items').select('*').eq('id',accepted.item_id).single()))
 }
 // Adversarial optional metadata must never appear in the display projection.
 await must(admin.from('calendar_items').update({data:{...rows[0].data,feedUrl:'PRIVATE_FEED_FIXTURE',oauthToken:'PRIVATE_TOKEN_FIXTURE',providerPayload:{secret:'PRIVATE_PAYLOAD_FIXTURE'}}}).eq('id',rows[0].id))
 const wallAuth=await must(wall.auth.signInAnonymously()),strangerAuth=await must(stranger.auth.signInAnonymously()),pairing=await must(client.rpc('create_wall_pairing',{p_household_id:hid})),paired=await must(wall.rpc('redeem_wall_pairing',{p_code:pairing.token,p_platform:'web'}))
 if(!paired.device)throw Error('LOCAL_PAIRING_FAILED')
 return {env,admin,client,wall,stranger,user,hid,people,ida,carl,jakob,parent,rows,photoPath,orphanPath,device:paired.device,session:(await client.auth.getSession()).data.session,wallSession:wallAuth.session,
  async cleanup(){await admin.storage.from('household-avatars').remove([photoPath,orphanPath]);await admin.from('households').delete().eq('id',hid);for(const id of [wallAuth.user.id,strangerAuth.user.id,user.id])await admin.auth.admin.deleteUser(id)}
 }
}
