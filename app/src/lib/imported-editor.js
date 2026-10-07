import {escape as e} from './product-ui.js'
import {eventDisplayRange} from './calendar-interval.js'
import {importedScopes,importedPersonSelection} from './imported-scopes.js'
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
  this.root.innerHTML='<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="import-title"><section class="calendar-modal imported-editor"><header class="modal-header"><div><p class="eyebrow">'+e('Importeret fra '+item.source)+' · '+e(eventDisplayRange(item))+'</p><h2 id="import-title">Aftalen i jeres familie</h2></div><button data-import-close aria-label="Luk">×</button></header><p class="source-notice">Ændringer her gælder kun i Familiekalenderen og ændrer ikke den oprindelige kalender.</p><form class="stack-form"><label for="import-name">Titel</label><input id="import-name" name="title" maxlength="1000" required value="'+e(item.title)+'"><fieldset class="import-people"><legend>Personer · ingen valgte betyder Alle</legend>'+people.map(p=>'<label><input type="checkbox" name="personIds" value="'+p.id+'" '+(ids.includes(p.id)?'checked':'')+'>'+e(p.name)+'</label>').join('')+'</fieldset><label for="import-location">Lokation</label><input id="import-location" name="location" maxlength="2000" value="'+e(item.location||'')+'"><label for="import-note">Beskrivelse / note</label><textarea id="import-note" name="note" rows="3" maxlength="10000">'+e(item.note||'')+'</textarea><label for="import-type">Type</label><select id="import-type" name="type">'+['Aktivitet','Fritidsinteresse'].map(t=>'<option '+(item.type===t?'selected':'')+'>'+t+'</option>').join('')+'</select><p class="hint">'+(Object.keys(item.data?.importLocalOverrides||{}).length?'Lokalt tilpasset · dine ændringer bevares ved synkronisering.':'Tidspunktet følger den oprindelige kalender.')+'</p><p class="message" role="alert"></p><div class="modal-actions"><button type="button" data-import-hide class="danger-button">Fjern fra Familiekalenderen</button><button type="button" data-import-close>Annuller</button><button type="submit">Gem lokalt</button></div></form></section></div>'
  this.root.querySelectorAll('[data-import-close]').forEach(b=>b.onclick=()=>this.close())
  const form=this.root.querySelector('form'),heading=this.root.querySelector('#import-title')
  const scopeForm=document.createElement('form');scopeForm.className='import-scope-form';scopeForm.hidden=true;scopeForm.dataset.importScopeForm='';form.before(scopeForm)
  const run=async(patch,scope='occurrence',hide=false)=>{
   if(this.busy)return;if(this.getContext()!==context){this.close();return}
   this.busy=true;this.root.querySelectorAll('button,input,select,textarea').forEach(b=>b.disabled=true)
   try{await this.save(snapshot,patch,{scope,hide});if(this.getContext()===context){this.close(true);this.onSaved()}}
   catch(error){if(form.isConnected)(scopeForm.hidden?form:scopeForm).querySelector('[role=alert]').textContent=error.message}
   finally{this.busy=false;this.root.querySelectorAll('button,input,select,textarea').forEach(b=>b.disabled=false)}
  }
  const chooseScope=(patch,hide)=>{
   form.hidden=true;scopeForm.hidden=false
   heading.textContent=hide?'Hvad vil du fjerne fra Familiekalenderen?':'Hvor skal ændringen gælde?'
   scopeForm.innerHTML='<p class="hint">Den oprindelige aftale i '+e(item.source)+' ændres ikke.</p><fieldset><legend class="sr-only">Vælg omfang</legend>'+
    (recurring?importedScopes:importedScopes.slice(0,1)).map((scope,i)=>'<label class="import-scope-choice"><input type="radio" name="importScope" value="'+scope.value+'" '+(hide?'data-hide-scope="'+scope.value+'"':'')+' '+(i===0?'checked':'')+'><span><strong>'+e(scope.label)+'</strong><small>'+e(hide?scope.hideHelp:scope.help)+'</small></span></label>').join('')+
    '</fieldset><p class="message" role="alert"></p><div class="modal-actions"><button type="button" data-scope-back>Tilbage</button><button type="submit" data-scope-confirm '+(hide?'class="danger-button"':'')+'>'+(hide?'Fjern lokalt':'Gem lokalt')+'</button></div>'
   scopeForm.querySelector('[data-scope-back]').onclick=()=>{scopeForm.hidden=true;form.hidden=false;heading.textContent='Aftalen i jeres familie';form.querySelector(hide?'[data-import-hide]':'button[type=submit]').focus()}
   scopeForm.onsubmit=event=>{event.preventDefault();void run(patch,new FormData(scopeForm).get('importScope'),hide)}
   scopeForm.querySelector('input').focus()
  }
  form.onsubmit=event=>{event.preventDefault();const data=new FormData(form),patch={};for(const key of ['title','location','note','type']){const val=String(data.get(key)||'').trim();if(val!==(snapshot[key]||''))patch[key]=val}const selected=importedPersonSelection(data.getAll('personIds'),ids,people);if(JSON.stringify([...selected].sort())!==JSON.stringify([...ids].sort()))patch.personIds=selected;if(!Object.keys(patch).length){this.close();return}if(recurring)chooseScope(patch,false);else void run(patch)}
  form.querySelector('[data-import-hide]').onclick=()=>chooseScope({},true)
 }
}
