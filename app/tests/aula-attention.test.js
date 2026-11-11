import test from 'node:test'
import assert from 'node:assert/strict'
import {actionableAulaFindings,aulaPreviews} from '../src/lib/aula-attention.js'
import {AulaUI} from '../src/lib/aula-ui.js'
import {setLocale} from '../src/i18n/index.js'
import {finding,ida} from './aula-activity.fixtures.js'
function inbox(findings){const ui=Object.create(AulaUI.prototype);ui.getContext=()=>({householdId:'fixture',role:'owner',people:[{id:ida,name:'Ida',color:'#b98486'}]});ui.ensure=()=>{};ui.state={connection:{status:'connected'},findings};return ui}
test('Attention excludes reviewed, stale, suppressed and informational findings; UPDATED remains reviewable',()=>{
 const rows=[finding({id:'new'}),finding({id:'updated',review_state:'UPDATED'}),finding({id:'match',proposed_action:'MATCH_EXISTING'}),
 ...['accepted','ignored','stale','suppressed'].map(status=>finding({id:status,status})),finding({id:'info',type:'GENERAL_INFO'}),finding({id:'none',proposed_action:'NO_ACTION'}),finding({id:'low',confidence:'LOW'})]
 assert.deepEqual(actionableAulaFindings(rows).map(f=>f.id),['new','updated','match'])
 const ui=inbox(rows),html=ui.todayCard()
 assert.match(html,/3 ting at gennemgå/);assert.match(html,/Gennemgå 3/)
 assert.equal(rows.filter(f=>f.status==='new'&&ui.findingCard(f).includes('data-aula="accept"')).length,3)
 assert.doesNotMatch(html,/data-aula="accept"|data-aula="ignore"|nye fund|kræver gennemgang|aula-confidence|aula-source/)
})
test('Zero actionable findings hides the whole card, even with 30 new informational findings',()=>{
 assert.equal(inbox(Array.from({length:30},()=>finding({proposed_action:'NO_ACTION'}))).todayCard(),'')
})
test('Previews prefer nearest upcoming date then deadline/reminder, without mutating source order',()=>{
 const rows=[finding({id:'past',date:'2026-11-10'}),finding({id:'unknown',date:null}),finding({id:'later',date:'2026-11-14'}),finding({id:'attend',type:'CALENDAR_EVENT',date:'2026-11-12'}),finding({id:'deadline',type:'DEADLINE',date:'2026-11-12'})]
 const original=JSON.stringify(rows)
 assert.deepEqual(aulaPreviews(rows,'2026-11-11').map(f=>f.id),['deadline','attend']);assert.equal(JSON.stringify(rows),original)
 assert.equal(actionableAulaFindings(rows).length,5)
})
test('Preview shows only identity, escaped title and known date, with one review action',()=>{
 const html=inbox([finding({title:'<script>private</script>',date:null,reason:'PRIVATE REASON',summary:'PRIVATE SUMMARY'})]).todayCard()
 assert.match(html,/aria-label="Ida"/);assert.match(html,/--person-color:#b98486/);assert.match(html,/&lt;script&gt;/)
 assert.doesNotMatch(html,/<script>|PRIVATE REASON|PRIVATE SUMMARY|Dato skal afklares|<time/)
 assert.equal((html.match(/<button/g)||[]).length,1)
})
test('Attention wording is localised in Danish and English',()=>{
 try{setLocale('en-GB');const ui=inbox([finding()]);assert.match(ui.todayCard(),/1 item to review/);ui.state.findings.push(finding());assert.match(ui.todayCard(),/2 items to review/);assert.match(ui.todayCard(),/Review 2/)}finally{setLocale('da-DK')}
})
test('A failed status read releases initial presentation loading and preserves existing connection state',async()=>{
 const ui=inbox([finding()]);ui.context='fixture';ui.generation=1;ui.syncContext=()=>{};ui.pending=false;ui.loaded=false
 const original=ui.state;let renders=0
 ui.onRender=()=>renders++;ui.request=async(endpoint,payload,signal)=>{assert.equal(endpoint,'status');assert.ok(signal instanceof AbortSignal);throw new DOMException('timeout','TimeoutError')}
 await ui.refresh();assert.equal(ui.loaded,true);assert.equal(ui.pending,false);assert.equal(ui.state,original);assert.equal(renders,1)
})
test('Background refresh updates attention only on changed data, keeps review drafts and stays quiet on failure',async()=>{
 const ui=inbox([]);ui.context='fixture';ui.generation=1;ui.syncContext=()=>{};ui.pending=false;ui.loaded=true;ui.reviewDrafts=new Map([['draft',{title:'Edited title'}]])
 let renders=0;ui.onRender=()=>renders++;ui.request=async()=>structuredClone(ui.state)
 await ui.refresh(true);assert.equal(renders,0)
 ui.request=async()=>({...ui.state,findings:[finding()],automatic:{active:true}})
 await ui.refresh(true);assert.equal(renders,1);assert.match(ui.todayCard(),/1 ting at gennemgå/);assert.match(ui.automaticMarkup(),/Aktiv/);assert.equal(ui.reviewDrafts.get('draft').title,'Edited title')
 ui.request=async()=>{throw Error('transient')};await ui.refresh(true);assert.equal(renders,1);assert.ok(!ui.errorCode);assert.equal(ui.state.findings.length,1)
 ui.state.connection.status='reauth_required';assert.match(ui.automaticMarkup(),/Ikke aktiv/)
})
test('Scan nu requests the existing incremental endpoint while explicit discovery retains full mode',async()=>{
 for(const discover of [false,true]){
  const ui=inbox([]);ui.generation=1;ui.state.mappings=[];ui.shell=()=>{};ui.refresh=async()=>{};ui.review=()=>{};ui.mapping=()=>{}
  let payload;ui.request=async(endpoint,p)=>{assert.equal(endpoint,'scan');payload=p}
  await ui.scan(discover);assert.deepEqual(payload,{full:discover});assert.equal(ui.scanning,false)
 }
})
