import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {materialize} from '../src/lib/calendar-semantics.js'
import {visibleImports} from '../src/lib/imported-editor.js'
const local=localSupabase(),admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,{auth:{persistSession:false}}),user=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}})
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.code+': '+r.error.message);return r.data}
const checks=[],pass=name=>{checks.push(name);console.log('PASS '+checks.length+': '+name)}
let uid,hid,foreign
try{
 const password=randomUUID()+'!Aa1',email='scope-'+randomUUID()+'@example.test'
 uid=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user.id
 await must(user.auth.signInWithPassword({email,password}))
 hid=(await must(admin.from('households').insert({name:'Imported scope regression',created_by:uid}).select('id').single())).id
 await must(admin.from('household_members').insert({household_id:hid,user_id:uid,role:'owner'}))
 const people=await must(admin.from('household_people').insert(['Mor','Jakob','Far'].map(name=>({household_id:hid,name}))).select('*'))
 const feeds=await must(admin.from('calendar_feeds').insert(['Google','Other'].map(name=>({household_id:hid,name,source:'google',feed_url:'https://calendar.google.com/fixture.ics',assigned_person_id:people[0].id,assigned_person_name:'Mor'}))).select('*'))
 const [feed,otherFeed]=feeds,slots=['2026-10-08T14:00:00.000Z','2026-10-15T14:00:00.000Z','2026-10-22T14:00:00.000Z']
 const make=(slot,extra={},target=feed)=>({externalKey:JSON.stringify(['google',target.id,'saxofon',slot]),payload:{title:'Saxofon',date:slot.slice(0,10),time:'16:00',note:'Kildenote',...extra,data:{uid:'saxofon',recurrenceId:slot,occurrenceDate:slot.slice(0,10),timeZone:'Europe/Copenhagen',endDate:slot.slice(0,10),endTime:'17:00',allDay:false,location:'Musikskolen',durationMin:60,...extra.data}}})
 const sync=async(rows=slots.map(s=>make(s)),target=feed,scheduled=false)=>{
  const claim=await must(admin.rpc('begin_calendar_feed_import',{p_feed_id:target.id,p_actor_id:scheduled?null:uid}))
  return must(admin.rpc('apply_calendar_feed_import',{p_feed_id:target.id,p_actor_id:claim.sync_actor_id||uid,p_token:claim.import_token,p_rows:rows,p_range_start:'2026-10-01',p_range_end:'2027-01-31',p_cleanup:false}))
 }
 const records=()=>must(admin.from('calendar_items').select('*').eq('calendar_id',feed.id).order('date'))
 const get=async slot=>(await records()).find(r=>r.data.recurrenceId===slot)
 const edit=async(slot,patch,scope='occurrence',hide=false)=>{
  const row=await get(slot)
  return must(user.rpc('edit_imported_calendar_scope',{p_id:row.id,p_expected:row.updated_at,p_patch:patch,p_scope:scope,p_hide:hide}))
 }
 const restore=key=>must(user.rpc('restore_calendar_import',{p_household_id:hid,p_feed_id:feed.id,p_uid:'saxofon',p_occurrence:key}))
 const hidden=()=>must(user.rpc('list_hidden_calendar_imports',{p_household_id:hid}))
 await sync();await sync([make(slots[1],{},otherFeed)],otherFeed)
 const originalIds=(await records()).map(r=>r.id).sort()
 await edit(slots[1],{personIds:[people[1].id]})
 assert.deepEqual((await records()).map(r=>r.person_ids),[[people[0].id],[people[1].id],[people[0].id]]);pass('Person override only this occurrence')
 await edit(slots[1],{personIds:[people[1].id]},'future')
 assert.deepEqual((await records()).map(r=>r.person_ids),[[people[0].id],[people[1].id],[people[1].id]]);pass('Person override this and forward; earlier occurrence untouched')
 const futureRule=await must(admin.from('calendar_import_overrides').select('*').eq('feed_id',feed.id).eq('rule_scope','future').single())
 assert.equal(futureRule.occurrence,'from:'+slots[1]);assert.equal(new Date(futureRule.effective_from).toISOString(),slots[1]);assert.equal(futureRule.effective_date,'2026-10-15');pass('Future boundary persists as immutable recurrence slot')
 await sync(slots.map(s=>make(s,{title:'Saxofon · kildeændring',note:'Ny kildenote',data:{location:'Ny musikskole'}})))
 assert.equal((await get(slots[2])).title,'Saxofon · kildeændring');assert.equal((await get(slots[2])).location,'Ny musikskole');assert.equal((await get(slots[2])).note,'Ny kildenote');assert.deepEqual((await get(slots[2])).person_ids,[people[1].id]);pass('Person-only future rule lets source update title/location/note')
 for(const [field,text] of [['title','Lokalt saxofonhold'],['location','Lokal sal'],['note','Husk instrumentet']]){
  await edit(slots[1],{[field]:text},'future')
  assert.equal((await get(slots[1]))[field],text);assert.equal((await get(slots[2]))[field],text);assert.notEqual((await get(slots[0]))[field],text);pass(field+' future override without changing earlier occurrence')
 }
 await edit(slots[1],{type:'Fritidsinteresse'},'future');assert.equal((await get(slots[2])).type,'Fritidsinteresse');pass('Safe type override supports future scope')
 await sync(undefined,feed,true)
 const retained=await get(slots[2]);assert.equal(retained.title,'Lokalt saxofonhold');assert.equal(retained.note,'Husk instrumentet');assert.equal(retained.location,'Lokal sal');assert.deepEqual(retained.person_ids,[people[1].id]);pass('Scheduled import path preserves each future field override')
 const late='2026-10-29T15:00:00.000Z'
 await sync([make(late)])
 assert.deepEqual((await get(late)).person_ids,[people[1].id]);assert.equal((await get(late)).note,'Husk instrumentet');pass('Occurrence first imported later inherits persistent future rules across DST')
 await edit(slots[2],{personIds:[people[2].id],note:'Enkelt note'})
 await edit(slots[1],{personIds:[people[1].id]},'future')
 assert.deepEqual((await get(slots[2])).person_ids,[people[1].id]);assert.equal((await get(slots[2])).note,'Enkelt note');pass('New future choice supersedes same field of later exceptions, keeps unrelated fields')
 await edit(slots[1],{personIds:[people[2].id]},'series')
 assert.ok((await records()).every(r=>r.person_ids[0]===people[2].id));assert.equal((await get(slots[2])).note,'Enkelt note');pass('Whole-series person rule includes history, preserves unrelated occurrence note')
 assert.deepEqual((await must(admin.from('calendar_items').select('*').eq('calendar_id',otherFeed.id).single())).person_ids,[people[0].id]);pass('Same UID in a different feed is isolated')
 await sync([make(slots[1],{date:'2026-10-06',time:'10:00',data:{endDate:'2026-10-06',endTime:'11:00'}})])
 const moved=await get(slots[1]);assert.equal(moved.note,'Husk instrumentet');assert.ok(originalIds.includes(moved.id))
 pass('Moved displayed date keeps future membership by original recurrence slot')
 await edit(slots[1],{},'occurrence',true)
 assert.equal((await get(slots[1])).data.importHidden,true);assert.equal((await get(slots[0])).data.importHidden,false);assert.equal((await get(slots[2])).data.importHidden,false);pass('Hide single affects only immutable occurrence')
 await restore(slots[1]);assert.equal((await get(slots[1])).data.importHidden,false);pass('Restore single preserves fields')
 await edit(slots[0],{},'occurrence',true)
 await edit(slots[1],{},'future',true)
 assert.equal((await get(slots[2])).data.importHidden,true);assert.equal((await get(late)).data.importHidden,true)
 const later='2026-11-05T15:00:00.000Z';await sync([make(later)],feed,true);assert.equal((await get(later)).data.importHidden,true);pass('Hide future persists and covers not-yet-imported occurrences')
 const list=await hidden();assert.equal(list.find(r=>r.scope==='future').effective_date,'2026-10-15');assert.ok(list.some(r=>r.scope==='occurrence'));pass('Hidden list distinguishes single and from-date rules')
 await restore('from:'+slots[1]);assert.equal((await get(slots[0])).data.importHidden,true);assert.equal((await get(slots[1])).data.importHidden,false);assert.equal((await get(slots[2])).note,'Enkelt note');assert.deepEqual((await get(later)).person_ids,[people[2].id]);pass('Restore from-date clears only its exclusion; older hide and all field rules survive')
 await edit(slots[1],{},'series',true);await sync([make(later)])
 assert.ok((await records()).every(r=>r.data.importHidden));pass('Whole-series hide includes history and future')
 await edit(slots[1],{},'future',true);await restore('*')
 assert.equal((await get(slots[0])).data.importHidden,true);assert.equal((await get(slots[2])).data.importHidden,true);pass('Whole-series restore preserves independent single and future exclusions')
 await restore(slots[0]);await restore('from:'+slots[1]);assert.ok((await records()).every(r=>!r.data.importHidden));pass('Independent restores return entire series without losing overrides')
 // Multi-day source change occupies one row, never fragments per date.
 await sync([make(slots[2],{data:{endDate:'2026-10-25',endTime:'11:00',durationMin:4020}})])
 await edit(slots[1],{personIds:[people[1].id]},'future');const multi=await get(slots[2])
 assert.equal(multi.end_date,'2026-10-25');assert.deepEqual(multi.person_ids,[people[1].id]);assert.equal(materialize([multi],['2026-10-24'],{milestones:false}).length,1);pass('Multi-day future override retains complete source interval')
 await edit(slots[1],{},'future',true)
 for(const date of ['2026-10-22','2026-10-23','2026-10-24','2026-10-25'])assert.equal(materialize(visibleImports([await get(slots[2])]),[date],{milestones:false}).length,0)
 await restore('from:'+slots[1]);assert.equal((await get(slots[2])).end_date,'2026-10-25');pass('Multi-day future hide/restore leaves no daily fragments')
 for(let i=0;i<5;i++)await sync()
 const rows=await records();assert.equal(new Set(rows.map(r=>r.external_id)).size,rows.length);assert.ok(originalIds.every(id=>rows.some(r=>r.id===id)));pass('Repeated imports retain IDs and zero duplicates')
 const stable=await get(slots[2]);await sync();assert.equal((await get(slots[2])).updated_at,stable.updated_at);pass('Effective rules do not cause unchanged-source realtime storms')
 await edit(slots[1],{location:'Før efterårsferien'},'future');await edit(late,{location:'Efter efterårsferien'},'future')
 await sync([make(later)],feed,true)
 assert.equal((await get(slots[2])).location,'Før efterårsferien');assert.equal((await get(later)).location,'Efter efterårsferien')
 assert.notEqual((await get(slots[0])).location,'Før efterårsferien');pass('Multiple future boundaries apply chronologically without changing earlier dates')
 const allDaySlots=['2026-10-30','2026-11-06']
 const allDayRows=allDaySlots.map(slot=>{const row=make(slot,{time:'',data:{uid:'all-day',allDay:true,endTime:null,endDate:slot==='2026-10-30'?'2026-11-01':'2026-11-08',timeZone:'America/New_York'}});row.externalKey=JSON.stringify(['google',feed.id,'all-day',slot]);return row})
 await sync(allDayRows);await edit(allDaySlots[0],{note:'Heldag fra denne fredag'},'future');await edit(allDaySlots[0],{},'future',true)
 assert.equal((await must(admin.from('calendar_import_overrides').select('effective_date').eq('feed_id',feed.id).eq('uid','all-day').single())).effective_date,'2026-10-30')
 assert.equal((await get(allDaySlots[1])).note,'Heldag fra denne fredag');assert.equal((await get(allDaySlots[1])).data.importHidden,true)
 assert.equal((await get(allDaySlots[1])).end_date,'2026-11-08');pass('Civil DATE recurrence boundary keeps date label and entire all-day span across timezones')
 const noSlot=make('single');noSlot.externalKey=JSON.stringify(['google',feed.id,'one-off','single']);Object.assign(noSlot.payload,{date:'2026-10-15',data:{uid:'one-off',recurrenceId:null,occurrenceDate:'2026-10-15'}})
 await sync([noSlot]);const single=(await records()).find(r=>r.data.uid==='one-off')
 const invalid=await user.rpc('edit_imported_calendar_scope',{p_id:single.id,p_expected:single.updated_at,p_patch:{title:'No'},p_scope:'future'});assert.equal(invalid.error?.code,'22023');pass('Future scope rejects missing recurrence identity')
 foreign=(await must(admin.auth.admin.createUser({email:'foreign-scope-'+randomUUID()+'@example.test',password,email_confirm:true}))).user
 const outsider=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}});await must(outsider.auth.signInWithPassword({email:foreign.email,password}))
 const target=await get(slots[2]),payload={p_id:target.id,p_expected:target.updated_at,p_patch:{title:'Intrusion'},p_scope:'series'}
 assert.equal((await outsider.rpc('edit_imported_calendar_scope',payload)).error?.code,'42501')
 const anonymous=createClient(local.API_URL,local.ANON_KEY,{auth:{persistSession:false}})
 assert.ok((await anonymous.rpc('edit_imported_calendar_scope',payload)).error)
 assert.ok((await user.from('calendar_import_overrides').update({hidden:true}).eq('feed_id',feed.id)).error)
 assert.ok((await outsider.rpc('restore_calendar_import',{p_household_id:hid,p_feed_id:feed.id,p_uid:'saxofon',p_occurrence:'*'})).error)
 pass('Auth/household checks and private rule-table grants prevent cross-family or anonymous mutations')
 const stale=await user.rpc('edit_imported_calendar_scope',{...payload,p_expected:'2000-01-01T00:00:00Z'});assert.equal(stale.error?.code,'40001');pass('Stale editors are rejected')
 console.log('IMPORTED SERIES API PASS '+checks.length)
}finally{if(hid)await admin.from('households').delete().eq('id',hid);if(uid)await admin.auth.admin.deleteUser(uid);if(foreign)await admin.auth.admin.deleteUser(foreign.id)}
