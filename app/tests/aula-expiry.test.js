import test from 'node:test'
import assert from 'node:assert/strict'
import {copenhagenDate,findingExpiryDate,isAulaFindingCurrent,currentAulaFindings} from '../src/lib/aula-expiry.js'
import {actionableAulaFindings,aulaPreviews} from '../src/lib/aula-attention.js'
import {AulaUI} from '../src/lib/aula-ui.js'
import {finding} from './aula-activity.fixtures.js'

for(const [instant,today,current] of [
 ['2026-11-12T23:01:00Z','2026-11-13',true],['2026-11-13T22:59:00Z','2026-11-13',true],['2026-11-13T23:01:00Z','2026-11-14',false],
 ['2026-07-13T21:59:00Z','2026-07-13',true],['2026-07-13T22:01:00Z','2026-07-14',false],
 ['2026-03-28T23:01:00Z','2026-03-29',true],['2026-03-29T21:59:00Z','2026-03-29',true],['2026-03-29T22:01:00Z','2026-03-30',false],
 ['2026-10-24T22:01:00Z','2026-10-25',true],['2026-10-25T22:59:00Z','2026-10-25',true],['2026-10-25T23:01:00Z','2026-10-26',false]
])test('Copenhagen expiry at '+instant,()=>{
 assert.equal(copenhagenDate(new Date(instant)),today)
 const date=instant.includes('-07-')?'2026-07-13':instant.includes('-03-')?'2026-03-29':instant.includes('-10-')?'2026-10-25':'2026-11-13'
 assert.equal(isAulaFindingCurrent(finding({date}),today),current)
})
test('Multi-day includes end day; dateless never expires even with a past end_date',()=>{
 const multi=finding({date:'2026-11-13',end_date:'2026-11-15'})
 assert.equal(findingExpiryDate(multi),'2026-11-15')
 assert.equal(isAulaFindingCurrent(multi,copenhagenDate(new Date('2026-11-15T22:59Z'))),true)
 assert.equal(isAulaFindingCurrent(multi,copenhagenDate(new Date('2026-11-15T23:01Z'))),false)
 for(const end_date of [null,'2001-01-01']){const f=finding({date:null,end_date});assert.equal(findingExpiryDate(f),null);assert.equal(isAulaFindingCurrent(f,'2099-01-01'),true)}
})
test('Family, Today, previews and all review confidence groups share expiry; accepted history survives',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-14T00:01:00+01:00')})
 const rows=[...['HIGH','MEDIUM','LOW'].map(confidence=>finding({id:'past-'+confidence,date:'2026-11-13',confidence})),
 finding({id:'today',date:'2026-11-14'}),finding({id:'future',date:'2026-11-20'}),finding({id:'dateless',date:null}),
 finding({id:'multi',date:'2026-11-13',end_date:'2026-11-15'}),finding({id:'information',date:null,confidence:'LOW'}),
 ...['accepted','ignored','stale'].map(status=>finding({id:status,status,date:'2026-11-01'}))]
 const original=JSON.stringify(rows),ui=Object.create(AulaUI.prototype)
 ui.state={connection:{status:'connected'},findings:rows};ui.ensure=()=>{};ui.getContext=()=>({householdId:'test',role:'owner',people:[]})
 assert.equal(currentAulaFindings(rows).length,5);assert.equal(actionableAulaFindings(rows).length,4);assert.equal(ui.newFindings.length,5)
 assert.match(ui.familyCard(),/Se fund \(5\)/);assert.match(ui.todayCard(),/Gennemgå 4/)
 assert.ok(aulaPreviews(rows).every(f=>!f.id.startsWith('past')))
 let html;ui.shell=(_title,body)=>{html=body};ui.review()
 assert.doesNotMatch(html,/data-aula-finding="past-|data-aula-finding="ignored|data-aula-finding="stale/)
 for(const id of ['today','future','dateless','multi','information','accepted'])assert.ok(html.includes('data-aula-finding="'+id+'"'))
 assert.match(html,/class="aula-accepted"/);assert.equal(JSON.stringify(rows),original)
})
test('Visible-page tick expires a cached open review after midnight even offline/pending; drafts survive',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-13T23:59:00+01:00')})
 const ui=Object.create(AulaUI.prototype);ui.context='test';ui.syncContext=()=>{};ui.generation=1;ui.loaded=true;ui.view='review'
 ui.state={findings:[finding({id:'yesterday',date:'2026-11-13'}),finding({id:'future',date:'2026-11-20'})]}
 ui.reviewDrafts=new Map([['future',{title:'Local edit'}]]);ui.inboxDate=copenhagenDate();let renders=0,reviews=0,requests=0
 ui.onRender=()=>renders++;ui.review=()=>reviews++;ui.request=async()=>{requests++;throw Error('offline')}
 t.mock.timers.setTime(new Date('2026-11-14T00:01:00+01:00').getTime())
 ui.pending=true;await ui.refresh(true)
 assert.equal(renders,1);assert.equal(reviews,1);assert.equal(requests,0);assert.deepEqual(ui.newFindings.map(f=>f.id),['future'])
 ui.pending=false;await ui.refresh(true);assert.equal(requests,1);assert.equal(renders,1);assert.equal(reviews,1)
 assert.equal(ui.reviewDrafts.get('future').title,'Local edit');assert.equal(ui.state.findings.length,2)
})
