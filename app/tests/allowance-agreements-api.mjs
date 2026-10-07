import {createClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {localSupabase} from '../../scripts/local-supabase.mjs'
import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const local=localSupabase(),opts={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,opts),users=[],households=[],checks=[]
const must=async q=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data}
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+checks.length+': '+name)}
const client=async(role,hid)=>{const email='batch40-'+randomUUID()+'@example.test',password=randomUUID()+'Aa!1',u=(await must(admin.auth.admin.createUser({email,password,email_confirm:true}))).user;users.push(u.id);const c=createClient(local.API_URL,local.ANON_KEY,opts);await must(c.auth.signInWithPassword({email,password}));if(hid)await must(admin.from('household_members').insert({household_id:hid,user_id:u.id,role}));return c}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const act=(c,hid,action,payload,id=randomUUID())=>c.rpc('reward_action',{p_request_id:id,p_household_id:hid,p_action:action,p_payload:payload})
const state=(c,hid)=>must(c.rpc('get_reward_state',{p_household_id:hid}))
const payload=s=>({person_id:s.person_id,item_id:s.task_id,due_date:s.due_date,occurrence_date:s.occurrence_date})
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_familiekalender','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']})
let owner,child,other,hid,people
try{
 owner=await client();hid=await must(owner.rpc('create_household',{p_name:'Batch 4 aftaletest'}));households.push(hid);child=await client('child',hid);other=await client()
 people=await must(owner.from('household_people').insert(['Jakob','Freja','Emil','Alma'].map(name=>({household_id:hid,name,role:'child',reward_enabled:true}))).select())
 const [p,w,z,next]=people
 const config=(person,cadence='month',duties=[{title:'Tøm opvaskemaskinen',schedule:'daily',approval:true}])=>({person_id:person.id,cadence,amount_minor:10000,duties,start_today:true})
 const save=async(person,values={})=>{const s=await state(owner,hid),a=s.agreements.filter(a=>a.person_id===person.id)[0];return must(act(owner,hid,'allowance_save',{...config(person),expected:a?.expected||null,...values}))}
 check('Child cannot create agreement',!!(await act(child,hid,'allowance_save',config(p))).error)
 check('Other household denied',!!(await act(other,hid,'allowance_save',config(p))).error)
 await save(p);let s=await state(owner,hid),m=s.monthly.find(m=>m.person_id===p.id),occ=s.occurrences.filter(o=>o.person_id===p.id)
 check('Monthly agreement and integer amount',m.cadence==='month'&&m.allowance_minor===10000)
 check('Start today has no retroactive obligations',occ.every(o=>o.due_date>=today)&&m.period_start===today)
 check('All future obligations frozen from day one',m.eligible_total===Number(m.period_end.slice(-2))-Number(today.slice(-2))+1&&m.completed_total===0)
 check('Full amount explicitly retained for short first period',m.allowance_minor===10000)
 const frozen=structuredClone(m),one=occ.find(o=>o.due_date===today)
 await must(act(child,hid,'complete',payload(one)))
 s=await state(owner,hid);check('Approval pending earns nothing',s.occurrences.find(o=>o.id===one.id).status==='pending'&&s.monthly.find(m=>m.person_id===p.id).earned_minor===0)
 await must(act(owner,hid,'reject',payload(one)));check('Rejected earns nothing',(await state(owner,hid)).monthly.find(m=>m.person_id===p.id).earned_minor===0)
 await must(act(child,hid,'complete',payload(one)));await must(act(owner,hid,'approve',payload(one)))
 s=await state(owner,hid);m=s.monthly.find(m=>m.person_id===p.id)
 check('Approval earns deterministic rounded amount',m.completed_total===1&&m.earned_minor===Math.round(10000/m.eligible_total))
 check('Allowance never grants stars',s.ledger.length===0&&s.occurrences.find(o=>o.id===one.id).star_value===0)
 await must(act(child,hid,'undo',payload(one)));check('Undo open period reduces earned',(await state(owner,hid)).monthly.find(m=>m.person_id===p.id).earned_minor===0)
 await must(act(owner,hid,'excuse',{...payload(one),reason:'Ferie'}));s=await state(owner,hid);m=s.monthly.find(m=>m.person_id===p.id)
 check('Excused removed from denominator with audit',m.eligible_total===frozen.eligible_total-1&&m.excused_total===1)
 await must(act(owner,hid,'unexcuse',payload(one)))
 const changed=await save(p,{amount_minor:20000,duties:[...config(p).duties,{title:'Ryd bord',schedule:'daily',approval:false}]})
 s=await state(owner,hid);m=s.monthly.find(m=>m.person_id===p.id)
 check('New duty and amount effective next period only',changed.effective_from>m.period_end&&m.allowance_minor===frozen.allowance_minor&&m.eligible_total===frozen.eligible_total)
 const latest=s.agreements.find(a=>a.person_id===p.id);check('Stale editor cannot overwrite agreement',!!(await act(owner,hid,'allowance_save',{...config(p),expected:'old'})).error)
 await Promise.all([state(child,hid),state(owner,hid),state(owner,hid)])
 check('Concurrent ensure is idempotent',(await must(owner.from('allowance_contracts').select('id').eq('person_id',p.id))).length===1)
 await save(w,{cadence:'week',duties:[{title:'Ryd værelset',schedule:'weekly',approval:false}]})
 s=await state(owner,hid);const week=s.monthly.find(m=>m.person_id===w.id),weekly=s.occurrences.find(o=>o.person_id===w.id)
 check('Weekly contract',week.cadence==='week'&&week.eligible_total===1)
 check('One obligation for flexible week window',weekly.window_end===week.period_end)
 await must(act(child,hid,'complete',payload(weekly)));check('Weekly task completed mid-window',(await state(owner,hid)).monthly.find(m=>m.person_id===w.id).earned_minor===10000)
 const claims=await Promise.all([1,2].map(()=>must(owner.rpc('claim_reward_milestone',{p_household_id:hid,p_person_id:w.id,p_month_start:week.period_start}))))
 check('Weekly 100% milestone claimed once',claims.filter(Boolean).length===1)
 await save(z,{duties:[]});check('Zero obligations neutral, not 100%',(await state(owner,hid)).monthly.find(m=>m.person_id===z.id).completion_percent===0)
 await save(next,{start_today:false});s=await state(owner,hid)
 check('First setup defaults next period',!s.monthly.some(m=>m.person_id===next.id)&&s.agreements.find(a=>a.person_id===next.id).effective_from>today)
 await must(act(owner,hid,'undo',payload(weekly)));await must(act(owner,hid,'excuse',{...payload(weekly),reason:'Syg'}));m=(await state(owner,hid)).monthly.find(m=>m.person_id===w.id)
 check('All excused requires neutral adult decision',m.neutral==='all_excused'&&m.earned_minor===null&&m.completion_percent===0)
 check('Read-only contract permissions',!!(await child.from('allowance_contracts').update({allowance_minor:999}).eq('id',week.id)).error)
 check('Other household cannot read contracts',(await must(other.from('allowance_contracts').select('id').eq('household_id',hid))).length===0)
 const bonus=await must(owner.from('calendar_items').insert({household_id:hid,created_by:users[0],title:'Vask cyklen',date:today,type:'Opgave',person_ids:[p.id],data:{rewardMode:'stars',starValue:7}}).select().single())
 await must(act(child,hid,'complete',{person_id:p.id,item_id:bonus.id,due_date:today,occurrence_date:today}))
 s=await state(owner,hid);check('Bonus stars separate from contract',s.balances.find(b=>b.person_id===p.id).balance===7&&s.monthly.find(m=>m.person_id===p.id).eligible_total===frozen.eligible_total)
 const ordinary=await must(owner.from('calendar_items').insert({household_id:hid,created_by:users[0],title:'Husk jakke',date:today,type:'Opgave',person_ids:[p.id],done:true}).select().single())
 s=await state(owner,hid);check('Ordinary task affects neither balance nor contract',s.balances.find(b=>b.person_id===p.id).balance===7&&s.monthly.find(m=>m.person_id===p.id).completed_total===0)
 // Transaction-local clock: rollover tests never change the running database clock or persist fixtures.
 const ownerId=users[0],clock=(day)=>"create or replace function private.reward_today() returns date language sql stable set search_path='' as $$select '"+day+"'::date$$;"
 const assertions=[
  "do $$ begin if (select count(*) from private.allowance_expected('2028-02-01','2028-02-29','[{\"schedule\":\"daily\"}]'))<>29 then raise exception 'Leap February';end if;",
  "if (select count(*) from private.allowance_expected('2026-03-01','2026-03-31','[{\"schedule\":\"daily\"}]'))<>31 then raise exception 'DST';end if;",
  "if (select count(*) from private.allowance_expected('2026-10-05','2026-10-11','[{\"schedule\":\"weekdays\"}]'))<>5 then raise exception 'Weekdays';end if;",
  "if (select count(*) from private.allowance_expected('2026-10-05','2026-10-11','[{\"schedule\":\"selected\",\"weekdays\":[2,5]}]'))<>2 then raise exception 'Selected days';end if;",
  "if (select count(*) from private.allowance_expected('2026-10-26','2026-11-01','[{\"schedule\":\"weekly\"}]'))<>1 then raise exception 'Week across month';end if;end $$;"
 ].join('\n')
 sql('begin;\n'+assertions+'\nrollback;')
 check('Civil schedules: daily, weekdays, selected, weekly, leap, DST, month boundary',true)
 const future=new Date(frozen.period_end+'T12:00:00');future.setDate(future.getDate()+1);const nextDay=new Intl.DateTimeFormat('en-CA').format(future)
 const claimsSQL="select set_config('request.jwt.claims','"+JSON.stringify({sub:ownerId,role:'authenticated'})+"',true);"
 const closeTest=[
 "begin;",clock(nextDay),claimsSQL,"select private.ensure_allowance_periods('"+hid+"');",
 "do $$ declare n int;begin",
 "if not exists(select 1 from public.allowance_contracts where id='"+frozen.id+"' and closed_at is not null) then raise exception 'Not closed';end if;",
 "if not exists(select 1 from public.allowance_contracts where person_id='"+p.id+"' and period_start='"+nextDay+"' and allowance_minor=20000) then raise exception 'Latest agreement missing';end if;",
 "begin update public.task_reward_occurrences set status='approved' where id='"+one.id+"';raise exception 'Locked write accepted';exception when others then if sqlerrm='Locked write accepted' then raise;end if;end;",
 "end $$;",
 "select private.allowance_action('"+hid+"','allowance_resolve','"+JSON.stringify({id:week.id,amount_minor:8000})+"');",
 "select private.allowance_action('"+hid+"','allowance_payout','"+JSON.stringify({id:week.id})+"');",
 "do $$ begin if not exists(select 1 from public.allowance_contracts where id='"+week.id+"' and payout_status='paid' and final_totals->>'earned_minor'='8000') then raise exception 'Manual payout';end if;end $$;",
 "rollback;"
 ].join('\n')
 sql(closeTest);check('Rollover freezes history, applies next contract, locks late approval, preserves manual payout',true)
 const paused=await save(p,{paused:true,expected:latest.expected})
 sql("begin;"+clock(nextDay)+claimsSQL+"select private.ensure_allowance_periods('"+hid+"');do $$ begin if exists(select 1 from public.allowance_contracts where person_id='"+p.id+"' and period_start='"+nextDay+"') then raise exception 'Pause generated period';end if;end $$;rollback;")
 check('Paused agreement stops future generation',true)
 await must(owner.from('household_people').update({is_active:false}).eq('id',w.id))
 sql("begin;"+clock(nextDay)+claimsSQL+"select private.ensure_allowance_periods('"+hid+"');do $$ begin if (select count(*) from public.allowance_contracts where person_id='"+w.id+"')<>1 then raise exception 'Archived person generated';end if;end $$;rollback;")
 check('Archived child retains history without future periods',true)
 const exports=await must(owner.rpc('export_family_data',{p_household_id:hid}))
 check('Data export includes agreements and frozen periods',exports.rewards_v2.agreements.length>0&&exports.rewards_v2.contracts.length>0)
 const legacy=await must(owner.from('household_people').insert({household_id:hid,name:'Legacy aftaletest',role:'child',reward_enabled:true}).select().single())
 await must(act(owner,hid,'config',{person_id:legacy.id,reward_enabled:true,allowance_enabled:true,monthly_allowance_minor:12000,star_rewards_enabled:true,default_requires_approval:false}))
 const oldTask=await must(owner.from('calendar_items').insert({household_id:hid,created_by:users[0],title:'Gammel fast pligt',date:today,type:'Opgave',person_ids:[legacy.id],data:{rewardMode:'allowance',repeatWeekly:true}}).select().single())
 const oldHistory=await must(admin.from('allowance_monthly_snapshots').insert({household_id:hid,person_id:legacy.id,year:2026,month:8,eligible_total:20,completed_total:19,excused_total:0,completion_percent:95,allowance_minor:12000,earned_minor:11400,payout_status:'paid'}).select().single())
 const migration=readFileSync('supabase/migrations/20261007083208_allowance_agreements.sql','utf8'),begin=migration.indexOf('do $$ declare cfg public.reward_person_config;'),end=migration.indexOf('end $$;',begin)+7
 const upgrade=migration.slice(begin,end).replace('where allowance_enabled loop',"where allowance_enabled and person_id='"+legacy.id+"' loop")
 sql('begin;'+claimsSQL+upgrade+"\ndo $$ begin if not exists(select 1 from public.allowance_agreements where person_id='"+legacy.id+"' and needs_review and amount_minor=12000 and legacy_task_ids=array['"+oldTask.id+"'::uuid]) then raise exception 'Legacy draft mapping';end if; if not exists(select 1 from public.allowance_contracts where person_id='"+legacy.id+"' and allowance_minor=12000) then raise exception 'Legacy contract missing';end if;end $$;update public.calendar_items set title='Efterfølgende redigering' where id='"+oldTask.id+"';set constraints all immediate;do $$ begin if not exists(select 1 from public.task_reward_occurrences where person_id='"+legacy.id+"' and title='Gammel fast pligt' and allowance_contract_id is not null) then raise exception 'Legacy snapshot changed';end if;if not exists(select 1 from public.allowance_monthly_snapshots where id='"+oldHistory.id+"' and payout_status='paid' and earned_minor=11400) then raise exception 'Legacy history lost';end if;end $$;rollback;")
 check('Legacy mapping retains amount, task identity, paid history and frozen expectations after edits',true)
 console.log('BATCH40 ALLOWANCE API PASS '+checks.length)
}finally{
 for(const id of households.reverse())await must(admin.from('households').delete().eq('id',id))
 for(const id of users)await must(admin.auth.admin.deleteUser(id))
 mkdirSync('supabase/.temp/product-batch40',{recursive:true});writeFileSync('supabase/.temp/product-batch40/allowance-api.json',JSON.stringify({checks,cleanup:true},null,2))
}
