import {escape as e} from './product-ui.js'
import {currentAgreement,periodLabel,dutyLabel,allowancePreview} from './allowance-model.js'
import {currency,parseCurrency,rewardConfig,enabled,rewardToday} from './rewards-model.js'
export function agreementSettings(ui,pid){
 if(!ui.adult)return;
 const c=ui.c,p=c.people.find(p=>p.id===pid),cfg=rewardConfig(c.state,pid),a=currentAgreement(c.state,pid),current=c.state.monthly.find(m=>m.person_id===pid);
 let duties=structuredClone(a?.duties||[]),cadence=a?.cadence||'month';
 ui.modal('Opgaver & belønning','<section class="allowance-settings"><p class="eyebrow">'+e(p.name)+'</p>'+(a?.needs_review?'<p class="allowance-review" role="status">Lommepengeaftalen skal gennemgås. Tidligere beløb og historik er bevaret.</p>':'')+
 '<form id="allowance-form" class="stack-form"><h3>Lommepengeaftale</h3><div class="allowance-amount"><label>Beløb i kroner<input name="amount" inputmode="decimal" required value="'+String((a?.amount_minor??cfg.monthly_allowance_minor)/100).replace('.',',')+'"></label><label>Periode<select name="cadence"><option value="month" '+(cadence==='month'?'selected':'')+'>Måned</option><option value="week" '+(cadence==='week'?'selected':'')+'>Uge</option></select></label></div><label><input name="paused" type="checkbox" '+(a?.paused?'checked':'')+'> Pause fra næste periode</label><h4>Faste pligter</h4><p class="hint">Pligterne giver lommepenge. Bonusjob giver kun ⭐.</p><div id="allowance-duties"></div><button type="button" id="allowance-add">+ Tilføj fast pligt</button>'+
 (!current&&(!a||a.needs_review)?'<label>Første periode<select name="start"><option value="next">Start næste periode</option><option value="today">Start i dag · fuldt beløb for resten af perioden</option></select></label>':'')+
 '<p class="allowance-next" role="status"></p><button type="submit" '+(!c.online?'disabled':'')+'>Gem aftale</button></form>'+
 (current?'<section class="allowance-current"><h4>Nuværende periode · '+e(periodLabel(current))+'</h4><p><strong>'+(current.earned_minor==null?'Afventer aftale':currency(current.earned_minor))+' / '+currency(current.allowance_minor)+'</strong> · '+current.completed_total+' / '+current.eligible_total+' pligter klaret'+(current.excused_total?' · '+current.excused_total+' fritaget':'')+'</p><p class="hint">'+current.expected_total+' oprindelige pligter. Beløb og pligter er fastlåst.</p><p class="hint">Skal en pligt udgå nu? Brug Fritag på opgaven. Ændringer i aftalen gælder næste periode.</p></section>':'')+
 '<details class="allowance-star-settings"><summary>Bonusstjerner og deltagelse</summary><form id="reward-config-form" class="stack-form" data-person="'+pid+'"><input type="hidden" name="amount" value="'+cfg.monthly_allowance_minor/100+'">'+(cfg.allowance_enabled?'<input type="hidden" name="allowance_enabled" value="on">':'')+
 [['reward_enabled','Deltager i opgaver & belønning',enabled(p)],['star_rewards_enabled','Bonusstjerner',cfg.star_rewards_enabled],['default_requires_approval','Nye bonusopgaver kræver voksengodkendelse',cfg.default_requires_approval]].map(([k,l,v])=>'<label><input type="checkbox" name="'+k+'" '+(v?'checked':'')+'> '+l+'</label>').join('')+'<button type="submit">Gem deltagelse</button></form></details></section>','allowance');
 const form=ui.root.querySelector('#allowance-form'),list=ui.root.querySelector('#allowance-duties');
 const preview=()=>{
  const f=new FormData(form),today=rewardToday(),day=new Date(today+'T12:00:00'),weekly=f.get('cadence')==='week';
  let start=current?.period_end;
  if(start){day.setTime(new Date(start+'T12:00:00').getTime());day.setDate(day.getDate()+1)}
  else if(a&&!a.needs_review&&a.effective_from>today)day.setTime(new Date(a.effective_from+'T12:00:00').getTime());
  else if(f.get('start')!=='today'){if(weekly)day.setDate(day.getDate()+((8-(day.getDay()||7))));else {day.setMonth(day.getMonth()+1,1)}}
  const label=new Intl.DateTimeFormat('da-DK',{day:'numeric',month:'long'}).format(day);
  const estimate=allowancePreview(duties,new Intl.DateTimeFormat('en-CA').format(day),f.get('cadence'));
  form.querySelector('.allowance-next').textContent=(f.has('paused')?'Aftalen sættes på pause. Ingen nye pligter oprettes. ':p.name+' får '+estimate.expected+' forventede pligter i den næste periode. ')+'Gælder fra '+label+'. '+(f.get('start')==='today'?'Kun pligter fra i dag indgår. Det fulde beløb gælder den korte første periode.':'Ændringen påvirker ikke '+p.name+'s nuværende lommepengeperiode.');
 };
 const render=()=>{
  list.innerHTML=duties.map((d,i)=>'<article class="allowance-duty" data-duty="'+i+'"><label>Pligt<input data-field="title" maxlength="160" required value="'+e(d.title)+'" placeholder="Fx Tøm opvaskemaskinen"></label><label>Hvornår<select data-field="schedule">'+[['daily','Hver dag'],['weekdays','Alle hverdage'],['selected','Udvalgte ugedage'],['weekly','Én gang om ugen']].map(([v,l])=>'<option value="'+v+'" '+(v===d.schedule?'selected':'')+'>'+l+'</option>').join('')+'</select></label><div class="allowance-weekdays" '+(d.schedule!=='selected'?'hidden':'')+'>'+['Man','Tir','Ons','Tor','Fre','Lør','Søn'].map((n,j)=>'<label><input type="checkbox" data-weekday="'+(j+1)+'" '+(d.weekdays?.includes(j+1)?'checked':'')+'><span>'+n+'</span></label>').join('')+'</div><small>'+e(dutyLabel(d))+(d.schedule==='weekly'?' · klar den, når det passer i ugens vindue':'')+'</small><label><input type="checkbox" data-field="approval" '+(d.approval?'checked':'')+'> Voksen godkender</label><button type="button" data-remove-duty="'+i+'" class="text-button">Fjern fra næste periode</button></article>').join('')||'<p class="hint">Ingen faste pligter sat op. Perioden viser 0 %.</p>';
  list.querySelectorAll('[data-field]').forEach(input=>input.onchange=()=>{const d=duties[Number(input.closest('[data-duty]').dataset.duty)];d[input.dataset.field]=input.type==='checkbox'?input.checked:input.value;if(input.dataset.field==='schedule')render()});
  list.querySelectorAll('[data-weekday]').forEach(input=>input.onchange=()=>{const d=duties[Number(input.closest('[data-duty]').dataset.duty)];d.weekdays=[...input.closest('.allowance-weekdays').querySelectorAll('input:checked')].map(x=>Number(x.dataset.weekday))});
  list.querySelectorAll('[data-remove-duty]').forEach(b=>b.onclick=()=>{duties.splice(Number(b.dataset.removeDuty),1);render();preview()});
 };
 ui.root.querySelector('#allowance-add').onclick=()=>{if(duties.length>=30)return;duties.push({title:'',schedule:'weekdays',weekdays:[1,2,3,4,5],approval:cfg.default_requires_approval});render();list.lastElementChild.querySelector('input').focus();preview()};
 form.onchange=preview;form.onsubmit=ev=>{ev.preventDefault();try{const f=new FormData(form);ui.run('allowance_save',{person_id:pid,amount_minor:parseCurrency(f.get('amount')),cadence:f.get('cadence'),duties,paused:f.has('paused'),start_today:f.get('start')==='today',expected:a?.expected||null},ev.submitter)}catch(error){ui.root.querySelector('#reward-dialog-message').textContent=error.message}};
 render();preview();
}
export function allowanceHistory(ui,pid){
 const rows=(ui.c.state.contracts||[]).filter(s=>s.closed_at&&(pid==='Alle'||s.person_id===pid)).slice(0,6);
 return rows.map(s=>'<article class="allowance-history-row"><div><strong>'+e(ui.c.people.find(p=>p.id===s.person_id)?.name)+' · '+e(periodLabel(s))+'</strong><small>'+s.completed_total+' / '+s.eligible_total+' pligter · '+(s.earned_minor==null?'Alle pligter fritaget · beløb skal aftales':currency(s.earned_minor))+'</small></div>'+
 (s.payout_status==='paid'?'<span>Udbetalt ✓</span>':s.earned_minor==null?ui.adult?'<button data-allowance-resolve="'+s.id+'" data-amount="'+s.allowance_minor+'">Aftal beløb</button>':'<span>Afventer en voksen</span>':ui.adult?ui.button('allowance_payout',{id:s.id},'Markér udbetalt',!ui.c.online):'<span>Afventer udbetaling</span>')+'</article>').join('');
}
