import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {writeFileSync,mkdirSync} from 'node:fs'
import assert from 'node:assert/strict'
import {localSupabase} from '../../scripts/local-supabase.mjs'
const local=localSupabase(),admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}}),user=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}})
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data}
const sql=text=>execFileSync('docker',['exec','-i','supabase_db_familiekalender','psql','-X','-U','postgres','-d','postgres','-tA','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim()
const checks=[],pass=name=>{checks.push(name);console.log('PASS '+name)}
let uid,hid,outsiderId
try{
 const password=randomUUID()+'!Aa1',email='calendar-sync-'+randomUUID()+'@example.test'
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 await must(user.auth.signInWithPassword({email,password}))
 hid=(await must(admin.from('households').insert({name:'Calendar sync regression',created_by:uid}).select('id').single())).id
 await must(admin.from('household_members').insert({household_id:hid,user_id:uid,role:'owner'}))
 const people=await must(admin.from('household_people').insert(['Carl','Far'].map(name=>({household_id:hid,name}))).select('id,name'))
 const feed=(await must(admin.from('calendar_feeds').insert({household_id:hid,source:'google',name:'Sync test',feed_url:'https://calendar.google.com/fixture.ics'}).select('*').single()))
 const row=(uid='single',occurrence=null,extra={})=>({externalKey:JSON.stringify(['google',feed.id,uid,occurrence||'single']),payload:{title:'Source title',date:'2026-10-06',time:'16:00',note:'Source note',...extra,data:{uid,recurrenceId:occurrence,occurrenceDate:'2026-10-06',location:'Source location',durationMin:60,...extra.data}}})
 const claim=()=>must(admin.rpc('begin_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid}))
 const apply=(token,rows,cleanup=false)=>admin.rpc('apply_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid,p_token:token,p_rows:rows,p_range_start:'2026-10-01',p_range_end:'2026-10-31',p_cleanup:cleanup})
 const sync=async(rows,cleanup=false)=>must(apply((await claim()).import_token,rows,cleanup))
 const records=()=>must(admin.from('calendar_items').select('*').eq('calendar_id',feed.id).order('id'))
 const get=id=>must(admin.from('calendar_items').select('*').eq('id',id).single())
 const edit=async(item,patch={},scope=null)=>must(user.rpc('edit_imported_calendar_item',{p_id:item.id,p_expected:item.updated_at,p_patch:patch,p_hide_scope:scope}))
 const occurrence='2026-10-06T14:00:00.000Z',second='2026-10-13T14:00:00.000Z'
 for(let i=0;i<100;i++)await sync([row()])
 assert.equal((await records()).length,1);pass('Same non-recurring UID x100 imports = one row')
 const single=(await records())[0]
 await sync([row()]);assert.equal((await get(single.id)).updated_at,single.updated_at);pass('Unchanged source import causes no item write or realtime storm')
 for(let i=0;i<10;i++)await sync([row('weekly',occurrence),row('weekly',second,{date:'2026-10-13'})])
 assert.equal((await records()).length,3);pass('Recurring UID + immutable slot x10 = one row per occurrence')
 await sync([row('single',null,{title:'New title'})]);assert.equal((await get(single.id)).title,'New title');pass('Source title update retains UUID')
 await sync([row('single',null,{data:{location:'New source location'}})]);assert.equal((await get(single.id)).location,'New source location');pass('Source location update retains UUID')
 const recurring=(await records()).find(i=>i.data.recurrenceId===occurrence)
 await sync([row('weekly',occurrence,{date:'2026-10-07',time:'18:00'})]);assert.equal((await get(recurring.id)).date,'2026-10-07');pass('Moved recurrence updates original slot and row')
 const secondFeed=(await must(admin.from('calendar_feeds').insert({household_id:hid,source:'google',name:'Other',feed_url:'https://calendar.google.com/fixture.ics'}).select('*').single()))
 const otherClaim=await must(admin.rpc('begin_calendar_feed_import',{p_feed_id:secondFeed.id,p_actor_id:uid}))
 const otherRow=row();otherRow.externalKey=JSON.stringify(['google',secondFeed.id,'single','single'])
 await must(admin.rpc('apply_calendar_feed_import',{p_feed_id:secondFeed.id,p_actor_id:uid,p_token:otherClaim.import_token,p_rows:[otherRow],p_range_start:'2026-10-01',p_range_end:'2026-10-31'}))
 assert.equal((await must(admin.from('calendar_items').select('id').eq('calendar_id',secondFeed.id))).length,1);pass('Same UID in separate feed remains independent')
 const manual=await must(admin.from('calendar_items').insert([1,2].map(()=>({household_id:hid,title:'Source title',date:'2026-10-06',time:'16:00',type:'Aktivitet',created_by:uid}))).select('id'))
 assert.equal(manual.length,2);pass('Manual lookalikes never merge')
 const unique=await admin.from('calendar_items').insert({household_id:hid,title:'Different title',date:'2026-10-06',type:'Aktivitet',source:'google',calendar_id:feed.id,external_id:'mutable-old-key',data:{uid:'single',recurrenceId:null},created_by:uid})
 assert.equal(unique.error?.code,'23505');pass('Database existing unique index rejects same immutable identity under different external key')
 let item=await get(recurring.id)
 await edit(item,{personIds:[people[0].id]});item=await get(item.id);assert.deepEqual(item.person_ids,[people[0].id]);pass('Person ID survives database reload')
 await sync([row('weekly',occurrence,{title:'Source refresh'})]);item=await get(item.id);assert.deepEqual(item.person_ids,[people[0].id]);assert.equal(item.title,'Source refresh');pass('Person-only override survives sync without freezing title')
 await edit(item,{personIds:people.map(p=>p.id),title:'Local title',location:'Local location',note:'Local note'})
 await sync([row('weekly',occurrence,{title:'Source changed again',note:'New source note',data:{location:'Source changed place'}})])
 item=await get(item.id)
 assert.equal(item.title,'Local title');pass('Title override survives sync')
 assert.equal(item.location,'Local location');pass('Location override survives sync')
 assert.equal(item.note,'Local note');pass('Note override survives sync')
 assert.deepEqual([...item.person_ids].sort(),people.map(p=>p.id).sort());pass('Multi-person assignment survives sync')
 const overrideVersion=item.updated_at;await sync([row('weekly',occurrence,{title:'Source changed again',note:'New source note',data:{location:'Source changed place'}})]);assert.equal((await get(item.id)).updated_at,overrideVersion);pass('Unchanged source with local overrides keeps raw source and row version')
 assert.equal(item.data.importSource.title,'Source changed again');assert.equal(item.data.importSource.location,'Source changed place');pass('Source values remain separate from field-level overrides')
 await edit(item,{},'occurrence');await sync([row('weekly',occurrence),row('weekly',second,{date:'2026-10-13'})])
 item=await get(item.id);assert.equal(item.data.importHidden,true);assert.equal((await records()).find(i=>i.data.recurrenceId===second).data.importHidden,false);pass('Single occurrence exclusion survives sync')
 await edit(item,{},'series');await sync([row('weekly',occurrence),row('weekly',second,{date:'2026-10-13'}),row('weekly','2026-10-20T14:00:00.000Z',{date:'2026-10-20'})])
 assert.ok((await records()).filter(i=>i.data.uid==='weekly').every(i=>i.data.importHidden));pass('Series exclusion covers current and new occurrences')
 const hidden=await must(user.rpc('list_hidden_calendar_imports',{p_household_id:hid}));assert.equal(hidden.length,2);pass('Hidden list contains occurrence and series')
 for(const scope of ['*',occurrence])await must(user.rpc('restore_calendar_import',{p_household_id:hid,p_feed_id:feed.id,p_uid:'weekly',p_occurrence:scope}))
 assert.ok((await records()).every(i=>!i.data.importHidden));pass('Restore clears exclusions while preserving overrides')
 await sync([row()],true);assert.ok((await records()).filter(i=>i.data.uid==='weekly').every(i=>i.data.importSourceRemoved));assert.equal((await get(item.id)).note,'Local note');pass('Validated source cancellation hides rows without destroying local data')
 await sync([row('weekly',occurrence)]);assert.equal((await get(item.id)).data.importSourceRemoved,false);assert.equal((await get(item.id)).note,'Local note');pass('Reappearing source keeps original UUID and override')
 const stale=await user.rpc('edit_imported_calendar_item',{p_id:item.id,p_expected:item.updated_at,p_patch:{title:'stale'}});assert.equal(stale.error?.code,'40001');pass('Stale editor rejected')
 const previous=await records(),priorSuccess=(await must(admin.from('calendar_feeds').select('last_sync_at').eq('id',feed.id).single())).last_sync_at
 const busy=await claim(),overlap=await admin.rpc('begin_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid});assert.ok(overlap.error);pass('Concurrent manual/scheduled claim rejected by database lease')
 await must(admin.rpc('fail_calendar_feed_import',{p_feed_id:feed.id,p_token:busy.import_token,p_message:'INVALID_ICS'}))
 const failed=await must(admin.from('calendar_feeds').select('*').eq('id',feed.id).single())
 assert.equal(failed.last_sync_at,priorSuccess);assert.equal(failed.last_sync_status,'error');assert.equal(failed.last_sync_message,'INVALID_ICS');assert.ok(failed.last_attempt_at);assert.deepEqual(await records(),previous);pass('Failure records status, preserves events and last successful timestamp')
 const invalid=await claim(),bad=await apply(invalid.import_token,[row(),{externalKey:'bad',payload:{}}],true);assert.ok(bad.error);assert.deepEqual(await records(),previous);await must(admin.rpc('fail_calendar_feed_import',{p_feed_id:feed.id,p_token:invalid.import_token,p_message:'INVALID_ICS'}));pass('Partial/invalid batch rolls back and never cleans up')
 await must(admin.from('calendar_feeds').update({is_active:false}).eq('id',feed.id))
 assert.ok((await admin.rpc('begin_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid})).error)
 assert.ok(!(await must(admin.rpc('due_calendar_feeds',{p_limit:10}))).some(f=>f.id===feed.id));assert.deepEqual(await records(),previous);pass('Inactive feed excluded from cron and manual import; data kept')
 await must(admin.from('calendar_feeds').update({is_active:true}).eq('id',feed.id));await sync([row()]);pass('Reactivation permits import')
 const internal=await must(admin.rpc('begin_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:null}));assert.equal(internal.sync_actor_id,uid);await must(admin.rpc('fail_calendar_feed_import',{p_feed_id:feed.id,p_token:internal.import_token,p_message:'FETCH_FAILED'}));pass('Internal claim resolves owner without interactive session')
 assert.ok((await user.rpc('due_calendar_feeds',{p_limit:10})).error);assert.ok((await user.rpc('begin_calendar_feed_import',{p_feed_id:feed.id,p_actor_id:uid})).error);assert.ok((await user.rpc('reconcile_calendar_imports',{p_feed_id:feed.id})).error);pass('Browser cannot invoke privileged scheduler, lease or cleanup RPCs')
 const versionBefore=await must(admin.from('calendar_revisions').select('items_version').eq('household_id',hid).single())
 await sync([row('revision')]);const versionAfter=await must(admin.from('calendar_revisions').select('items_version').eq('household_id',hid).single());assert.ok(versionAfter.items_version>versionBefore.items_version);pass('Successful import emits existing realtime revision')
 // Inject historical JSON-only duplicates in one LOCAL transaction. The exclusive
 // DDL lock prevents any concurrent inserts while this test disables its trigger.
 const a=randomUUID(),b=randomUUID(),legacyData={source:'google',feedId:feed.id,uid:'legacy',recurrenceId:null,location:'Old',importLocalOverrides:{note:'Keep this note'}}
 sql("begin;alter table public.calendar_items disable trigger normalize_import_identity;insert into public.calendar_items(id,household_id,created_by,title,date,type,person_ids,data,done) values "+[a,b].map((id,i)=>"('"+id+"','"+hid+"','"+uid+"','Legacy','2026-10-06','Aktivitet',array['"+people[0].id+"']::uuid[],'"+JSON.stringify(legacyData)+"'::jsonb,"+(i===1)+")").join(',')+";set constraints all immediate;alter table public.calendar_items enable trigger normalize_import_identity;commit;")
 const repair=await must(admin.rpc('reconcile_calendar_imports',{p_feed_id:feed.id}));assert.equal(repair.archived,1)
 const legacy=(await records()).filter(i=>i.data.uid==='legacy');assert.equal(legacy.length,1);assert.equal(legacy[0].note,'Keep this note');assert.deepEqual(legacy[0].person_ids,[people[0].id]);assert.equal(legacy[0].done,true)
 assert.equal((await must(admin.from('calendar_import_archives').select('item_id').eq('household_id',hid))).length,1);pass('Explicit immutable legacy dedupe archives duplicate and preserves local note, person and done')
 outsiderId=(await must(admin.auth.admin.createUser({email:'foreign-'+randomUUID()+'@example.test',password,email_confirm:true}))).user.id
 const outsider=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}});await must(outsider.auth.signInWithPassword({email:(await must(admin.auth.admin.getUserById(outsiderId))).user.email,password}))
 assert.ok((await outsider.rpc('list_hidden_calendar_imports',{p_household_id:hid})).error)
 assert.ok((await outsider.rpc('restore_calendar_import',{p_household_id:hid,p_feed_id:feed.id,p_uid:'weekly',p_occurrence:'*'})).error)
 assert.ok((await outsider.rpc('edit_imported_calendar_item',{p_id:single.id,p_expected:(await get(single.id)).updated_at,p_patch:{title:'Intrusion'}})).error);pass('Foreign household cannot edit, list hidden or restore')
 mkdirSync('supabase/.temp/calendar-sync30',{recursive:true});writeFileSync('supabase/.temp/calendar-sync30/api-results.json',JSON.stringify({pass:true,checks},null,2))
 console.log('CALENDAR SYNC API PASS '+checks.length)
}finally{
 if(hid)await admin.from('households').delete().eq('id',hid)
 if(uid)await admin.auth.admin.deleteUser(uid)
 if(outsiderId)await admin.auth.admin.deleteUser(outsiderId)
}
