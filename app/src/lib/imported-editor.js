import {escape as e} from './product-ui.js'
import {feedIdOf} from './feeds.js'
import {itemPersonIds} from './people.js'
import {sourceLabel,value} from './calendar-semantics.js'
export const canEditImported=item=>Boolean(feedIdOf(item)&&item?.data?.uid&&Object.hasOwn(item.data,'recurrenceId'))
export const visibleImports=rows=>rows.filter(row=>!row.data?.importHidden&&!row.data?.importSourceRemoved)
export class ImportedEditor{
 constructor({root,getContext,getPeople,save,onSaved}){Object.assign(this,{root,getContext,getPeople,save,onSaved});root.addEventListener('dismiss-dialog',()=>this.close())}
 get opened(){return !!this.root.firstChild}
 close(force=false){if(this.busy&&!force)return;this.root.innerHTML='';this.busy=false}
 open(item){
  const snapshot=structuredClone(item),context=this.getContext(),people=this.getPeople(),ids=itemPersonIds(snapshot,people)
  item={...item,source:sourceLabel(item),location:value(item,'location'),note:value(item,'note')};snapshot.location=item.location;snapshot.note=item.note
  const recurring=Boolean(item.data?.recurrenceId)
  this.root.innerHTML='<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="import-title"><section class="calendar-modal imported-editor"><header class="modal-header"><div><p class="eyebrow">'+e('Importeret fra '+item.source)+' · '+e(item.date)+' '+e(item.time||'')+'</p><h2 id="import-title">Aftalen i jeres familie</h2></div><button data-import-close aria-label="Luk">×</button></header><p class="source-notice">Ændringer her gælder kun i Familiekalenderen og ændrer ikke den oprindelige kalender.</p><form class="stack-form"><label for="import-name">Titel</label><input id="import-name" name="title" maxlength="1000" required value="'+e(item.title)+'"><fieldset class="import-people"><legend>Personer · ingen valgte betyder Alle</legend>'+people.map(p=>'<label><input type="checkbox" name="personIds" value="'+p.id+'" '+(ids.includes(p.id)?'checked':'')+'>'+e(p.name)+'</label>').join('')+'</fieldset><label for="import-location">Lokation</label><input id="import-location" name="location" maxlength="2000" value="'+e(item.location||'')+'"><label for="import-note">Beskrivelse / note</label><textarea id="import-note" name="note" rows="3" maxlength="10000">'+e(item.note||'')+'</textarea><label for="import-type">Type</label><select id="import-type" name="type">'+['Aktivitet','Fritidsinteresse'].map(t=>'<option '+(item.type===t?'selected':'')+'>'+t+'</option>').join('')+'</select><p class="hint">'+(Object.keys(item.data?.importLocalOverrides||{}).length?'Lokalt tilpasset · dine ændringer bevares ved synkronisering.':'Tidspunktet følger den oprindelige kalender.')+'</p><div data-import-scope hidden><h3>Fjern fra Familiekalenderen</h3><p>Kalenderen hos afsenderen ændres ikke.</p><button type="button" data-hide-scope="occurrence">' +(recurring?'Kun denne forekomst':'Fjern denne aftale')+'</button>'+(recurring?'<button type="button" data-hide-scope="series">Hele serien</button>':'')+'</div><p class="message" role="alert"></p><div class="modal-actions"><button type="button" data-import-hide class="danger-button">Fjern fra Familiekalenderen</button><button type="button" data-import-close>Annuller</button><button type="submit">Gem lokalt</button></div></form></section></div>'
  this.root.querySelectorAll('[data-import-close]').forEach(b=>b.onclick=()=>this.close())
  const form=this.root.querySelector('form'),run=async(patch,scope=null)=>{
   if(this.busy)return;if(this.getContext()!==context){this.close();return}
   this.busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true)
   try{await this.save(snapshot,patch,scope);if(this.getContext()===context){this.close(true);this.onSaved()}}
   catch(error){if(form.isConnected)form.querySelector('[role=alert]').textContent=error.message}
   finally{this.busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false)}
  }
  form.onsubmit=event=>{event.preventDefault();const data=new FormData(form),patch={};for(const key of ['title','location','note','type']){const val=String(data.get(key)||'').trim();if(val!==(snapshot[key]||''))patch[key]=val}const selected=data.getAll('personIds');if(JSON.stringify([...selected].sort())!==JSON.stringify([...ids].sort()))patch.personIds=selected;void run(patch)}
  form.querySelector('[data-import-hide]').onclick=()=>{form.querySelector('[data-import-scope]').hidden=false;form.querySelector('[data-hide-scope]').focus()}
  form.querySelectorAll('[data-hide-scope]').forEach(b=>b.onclick=()=>void run({},b.dataset.hideScope))
 }
}
