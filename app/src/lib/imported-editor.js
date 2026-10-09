import {typeLabel} from '../i18n/domain-labels.js'
import {t,userError} from '../i18n/index.js'
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
  this.root.innerHTML='<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="import-title"><section class="calendar-modal imported-editor"><header class="modal-header"><div><p class="eyebrow">'+e((t("app.imported_from")+" ")+item.source)+' · '+e(eventDisplayRange(item))+("</p><h2 id=\"import-title\">"+t("imported_editor.the_event_in_your_family")+"</h2></div><button data-import-close aria-label=\""+t("common.close")+"\">×</button></header><p class=\"source-notice\">"+t("imported_editor.changes_here_apply_only_in_familiekalender_and_do_not_change_the_original_calendar")+"</p><form class=\"stack-form\"><label for=\"import-name\">"+t("app.title")+"</label><input id=\"import-name\" name=\"title\" maxlength=\"1000\" required value=\"")+e(item.title)+("\"><fieldset class=\"import-people\"><legend>"+t("imported_editor.people_no_selection_means_everyone")+"</legend>")+people.map(p=>'<label><input type="checkbox" name="personIds" value="'+p.id+'" '+(ids.includes(p.id)?'checked':'')+'>'+e(p.name)+'</label>').join('')+("</fieldset><label for=\"import-location\">"+t("app.location")+"</label><input id=\"import-location\" name=\"location\" maxlength=\"2000\" value=\"")+e(item.location||'')+("\"><label for=\"import-note\">"+t("imported_editor.description_note")+"</label><textarea id=\"import-note\" name=\"note\" rows=\"3\" maxlength=\"10000\">")+e(item.note||'')+("</textarea><label for=\"import-type\">"+t("app.type")+"</label><select id=\"import-type\" name=\"type\">")+['Aktivitet','Fritidsinteresse'].map(type=>'<option value="'+e(type)+'" '+(item.type===type?'selected':'')+'>'+e(typeLabel(type))+'</option>').join('')+'</select><p class="hint">'+(Object.keys(item.data?.importLocalOverrides||{}).length?(t("imported_editor.locally_customised_your_changes_are_preserved_when_syncing")):(t("imported_editor.the_time_follows_the_original_calendar")))+("</p><p class=\"message\" role=\"alert\"></p><div class=\"modal-actions\"><button type=\"button\" data-import-hide class=\"danger-button\">"+t("imported_editor.remove_from_familiekalender")+"</button><button type=\"button\" data-import-close>"+t("common.cancel")+"</button><button type=\"submit\">"+t("imported_editor.save_locally")+"</button></div></form></section></div>")
  this.root.querySelectorAll('[data-import-close]').forEach(b=>b.onclick=()=>this.close())
  const form=this.root.querySelector('form'),heading=this.root.querySelector('#import-title')
  const scopeForm=document.createElement('form');scopeForm.className='import-scope-form';scopeForm.hidden=true;scopeForm.dataset.importScopeForm='';form.before(scopeForm)
  const run=async(patch,scope='occurrence',hide=false)=>{
   if(this.busy)return;if(this.getContext()!==context){this.close();return}
   this.busy=true;this.root.querySelectorAll('button,input,select,textarea').forEach(b=>b.disabled=true)
   try{await this.save(snapshot,patch,{scope,hide});if(this.getContext()===context){this.close(true);this.onSaved()}}
   catch(error){if(form.isConnected)(scopeForm.hidden?form:scopeForm).querySelector('[role=alert]').textContent=userError(error)}
   finally{this.busy=false;this.root.querySelectorAll('button,input,select,textarea').forEach(b=>b.disabled=false)}
  }
  const chooseScope=(patch,hide)=>{
   form.hidden=true;scopeForm.hidden=false
   heading.textContent=hide?(t("imported_editor.what_would_you_like_to_remove_from_familiekalender")):(t("imported_editor.where_should_the_change_apply"))
   scopeForm.innerHTML=("<p class=\"hint\">"+t("imported_editor.the_original_event_in")+" ")+e(item.source)+(" "+t("imported_editor.is_unchanged")+"</p><fieldset><legend class=\"sr-only\">"+t("imported_editor.choose_scope")+"</legend>")+
    (recurring?importedScopes:importedScopes.slice(0,1)).map((scope,i)=>'<label class="import-scope-choice"><input type="radio" name="importScope" value="'+scope.value+'" '+(hide?'data-hide-scope="'+scope.value+'"':'')+' '+(i===0?'checked':'')+'><span><strong>'+e(scope.label)+'</strong><small>'+e(hide?scope.hideHelp:scope.help)+'</small></span></label>').join('')+
    ("</fieldset><p class=\"message\" role=\"alert\"></p><div class=\"modal-actions\"><button type=\"button\" data-scope-back>"+t("imported_editor.back")+"</button><button type=\"submit\" data-scope-confirm ")+(hide?'class="danger-button"':'')+'>'+(hide?(t("imported_editor.remove_locally")):(t("imported_editor.save_locally")))+'</button></div>'
   scopeForm.querySelector('[data-scope-back]').onclick=()=>{scopeForm.hidden=true;form.hidden=false;heading.textContent=(t("imported_editor.the_event_in_your_family"));form.querySelector(hide?'[data-import-hide]':'button[type=submit]').focus()}
   scopeForm.onsubmit=event=>{event.preventDefault();void run(patch,new FormData(scopeForm).get('importScope'),hide)}
   scopeForm.querySelector('input').focus()
  }
  form.onsubmit=event=>{event.preventDefault();const data=new FormData(form),patch={};for(const key of ['title','location','note','type']){const val=String(data.get(key)||'').trim();if(val!==(snapshot[key]||''))patch[key]=val}const selected=importedPersonSelection(data.getAll('personIds'),ids,people);if(JSON.stringify([...selected].sort())!==JSON.stringify([...ids].sort()))patch.personIds=selected;if(!Object.keys(patch).length){this.close();return}if(recurring)chooseScope(patch,false);else void run(patch)}
  form.querySelector('[data-import-hide]').onclick=()=>chooseScope({},true)
 }
}
