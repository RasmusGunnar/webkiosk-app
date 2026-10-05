import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {localSupabase} from '../../scripts/local-supabase.mjs'
const local=localSupabase(),admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}}),user=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}})
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data}
// A fixed local Docker container, never a connection string from project env.
execFileSync('docker',['exec','-i','supabase_db_familiekalender','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:readFileSync('supabase/migrations/20261005074801_imported_calendar_overrides.sql'),stdio:['pipe','pipe','pipe']})
let uid,hid,foreign;let count=0;const pass=label=>console.log('PASS '+(++count)+': '+label)
try{
 const email='import-'+randomUUID()+'@example.test',password=randomUUID()+'!Aa1'
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 await must(user.auth.signInWithPassword({email,password}))
 hid=(await must(admin.from('households').insert({name:'Polish import fixture',created_by:uid}).select('id').single())).id
 await must(admin.from('household_members').insert({household_id:hid,user_id:uid,role:'owner'}))
 const people=await must(admin.from('household_people').insert(['Carl','Ida'].map(name=>({household_id:hid,name}))).select('id'))
 const feed=(await must(admin.from('calendar_feeds').insert({household_id:hid,name:'Test Google',source:'google',feed_url:'https://calendar.google.com/fixture.ics'}).select('*').single()))
 const occurrence='2026-10-05T14:00:00.000Z',key=o=>JSON.stringify(['google',feed.id,'weekly',o])
 const row=(o=occurrence,title='Carl spejder',date='2026-10-05')=>({externalKey:key(o),payload:{title,date,time:'16:00',note:'Source note',data:{uid:'weekly',recurrenceId:o,occurrenceDate:date,title,date,time:'16:00',type:'Aktivitet',location:'Skoven',durationMin:60}}})
 const sync=async(rows,cleanup=true)=>{const claim=await must(admin.rpc('begin_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid}));return must(admin.rpc('apply_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid,p_token:claim.import_token,p_rows:rows,p_range_start:'2026-10-01',p_range_end:'2026-11-30',p_cleanup:cleanup}))}
 const seed=(external_id,extra={})=>({household_id:hid,created_by:uid,title:'Carl spejder',date:'2026-10-05',time:'16:00',type:'Aktivitet',source:'google',calendar_id:feed.id,external_id,data:row().payload.data,...extra})
 const old=await must(admin.from('calendar_items').insert([seed('old-mutable-A'),seed('old-mutable-B'),seed(null,{source:null,calendar_id:null,data:{}})]).select('*'))
 const manual=old.find(r=>!r.source),canonical=old.filter(r=>r.source).sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))[0]
 await sync([row()],false)
 let records=await must(admin.from('calendar_items').select('*').eq('household_id',hid));assert.equal(records.length,2);assert.ok(records.some(r=>r.id===manual.id));assert.ok(records.some(r=>r.id===canonical.id));assert.equal((await must(admin.from('calendar_import_archives').select('*').eq('household_id',hid))).length,1);pass('Exact external duplicates archived, canonical UUID retained, manual lookalike untouched')
 const current=()=>must(admin.from('calendar_items').select('*').eq('id',canonical.id).single())
 let item=await current();await must(user.rpc('edit_imported_calendar_item',{p_id:item.id,p_expected:item.updated_at,p_patch:{title:'Vores spejder',personIds:people.map(p=>p.id),location:'M?d ved hallen',note:'Husk vand',type:'Fritidsinteresse'}}))
 await sync([row(occurrence,'Nyt kildenavn','2026-10-06')],false);item=await current();assert.equal(item.title,'Vores spejder');assert.equal(item.data.importSource.title,'Nyt kildenavn');assert.equal(item.date,'2026-10-06');assert.equal(item.location,'M?d ved hallen');assert.equal(item.note,'Husk vand');assert.equal(item.type,'Fritidsinteresse');assert.deepEqual([...item.person_ids].sort(),people.map(p=>p.id).sort());pass('Corrections update same UUID; local title/location/note/type and multi-person override survive sync')
 const stale=await user.rpc('edit_imported_calendar_item',{p_id:item.id,p_expected:canonical.updated_at,p_patch:{title:'Stale'}});assert.ok(stale.error);pass('Stale editor cannot overwrite newer import/local edits')
 await must(user.rpc('edit_imported_calendar_item',{p_id:item.id,p_expected:item.updated_at,p_hide_scope:'occurrence'}));await sync([],true);await sync([row()],true)
 let imported=await must(admin.from('calendar_items').select('*').eq('household_id',hid).eq('source','google'));assert.equal(imported.length,1);assert.equal(imported[0].data.importHidden,true);assert.equal(imported[0].title,'Vores spejder');pass('Occurrence exclusion and edits survive cleanup/removal/reimport')
 await must(user.rpc('edit_imported_calendar_item',{p_id:imported[0].id,p_expected:imported[0].updated_at,p_hide_scope:'series'}));await sync([row(),row('2026-10-12T14:00:00.000Z','Spejder næste uge','2026-10-12')]);imported=await must(admin.from('calendar_items').select('*').eq('household_id',hid).eq('source','google'));assert.equal(imported.length,2);assert.ok(imported.every(i=>i.data.importHidden));pass('Series exclusion hides existing and newly synced occurrences')
 const other=(await must(admin.from('calendar_feeds').insert({household_id:hid,name:'Other',source:'google',feed_url:'https://calendar.google.com/fixture.ics'}).select('*').single()))
 const otherClaim=await must(admin.rpc('begin_calendar_feed_import',{p_feed_id:other.id,p_actor_id:uid}));const otherRow=row();otherRow.externalKey=JSON.stringify(['google',other.id,'weekly',occurrence]);await must(admin.rpc('apply_calendar_feed_import',{p_feed_id:other.id,p_actor_id:uid,p_token:otherClaim.import_token,p_rows:[otherRow],p_range_start:'2026-10-01',p_range_end:'2026-11-30'}));const independent=await must(admin.from('calendar_items').select('*').eq('calendar_id',other.id).single());assert.equal(independent.data.importHidden,false);pass('Same UID in another feed stays separate and visible')
 foreign=(await must(admin.auth.admin.createUser({email:'foreign-'+randomUUID()+'@example.test',password,email_confirm:true}))).user.id
 const outsider=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}});await must(outsider.auth.signInWithPassword({email:(await must(admin.auth.admin.getUserById(foreign))).user.email,password}));assert.ok((await outsider.rpc('edit_imported_calendar_item',{p_id:independent.id,p_expected:independent.updated_at,p_patch:{title:'Forbidden'}})).error);assert.ok((await user.rpc('apply_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid,p_token:randomUUID(),p_rows:[],p_range_start:'2026-10-01',p_range_end:'2026-11-30'})).error);assert.ok((await user.from('calendar_import_overrides').select('*')).error);pass('Other households and direct browser writes cannot bypass RPC/import access controls')

 const beforeArchive=(await must(admin.from('calendar_import_archives').select('item_id').eq('household_id',hid))).length;
 const conflictData={...row().payload.data,uid:'conflicting-detached'};
 const conflicts=await must(admin.from('calendar_items').insert([seed('detached-A',{detached_from_feed:true,data:conflictData}),seed('detached-B',{detached_from_feed:true,data:conflictData})]).select('id'));
 const conflictClaim=await must(admin.rpc('begin_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid}));const collision=row();collision.externalKey=JSON.stringify(['google',feed.id,'conflicting-detached',occurrence]);collision.payload.data=conflictData;
 const rejected=await admin.rpc('apply_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid,p_token:conflictClaim.import_token,p_rows:[collision],p_range_start:'2026-10-01',p_range_end:'2026-11-30'});assert.ok(rejected.error);assert.equal((await must(admin.from('calendar_items').select('id').in('id',conflicts.map(i=>i.id)))).length,2);assert.equal((await must(admin.from('calendar_import_archives').select('item_id').eq('household_id',hid))).length,beforeArchive);pass('Conflicting detached edits abort atomically without deletion or archive changes')
 console.log('POLISH IMPORTS PASS '+count)
}finally{if(hid)await admin.from('households').delete().eq('id',hid);if(uid)await admin.auth.admin.deleteUser(uid);if(foreign)await admin.auth.admin.deleteUser(foreign)}
