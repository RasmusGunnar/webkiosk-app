import {recipeDetails} from './recipe.js'
import {escape,icon} from './product-ui.js'
import {PLAN_TYPES,SHOPPING_CATEGORIES,planValues} from './household-plans.js'
export class PlanEditor{
 constructor({root,getRows,getContext,save,remove,onSaved,fetchRecipe,getRecipes=()=>[],chooseRecipe,openRecipe}){Object.assign(this,{root,getRows,getContext,save,remove,onSaved,fetchRecipe,getRecipes,chooseRecipe,openRecipe});this.busy=false;root.addEventListener('dismiss-dialog',()=>this.close())}
 get opened(){return Boolean(this.root.firstChild)}
 close(force=false){if(this.busy&&!force)return;this.root.innerHTML='';this.busy=false}
 view({title,date,time,note,people,source,recipe,location}){
  this.root.innerHTML='<div id="plan-modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="plan-editor-title"><section class="calendar-modal plan-modal ux-readonly"><header class="modal-header"><div><p class="eyebrow">Familiens overblik</p><h2 id="plan-editor-title">'+escape(title)+'</h2></div><button type="button" data-plan-close aria-label="Luk">×</button></header><p>'+escape([date,time].filter(Boolean).join(' · '))+'</p>'+(location?'<p>'+escape(location)+'</p>':'')+(people?'<p>'+escape(people)+'</p>':'')+(source?'<p class="source-label">'+escape(source)+'</p>':'')+(note?'<p class="plan-note">'+escape(note)+'</p>':'')+(recipe?recipeDetails(recipe):'')+'<p class="hint">Planer ændres fra mobil eller computer.</p><button type="button" data-plan-close>Luk</button></section></div>'
  this.bindClose()
 }
 bindClose(){this.root.querySelectorAll('[data-plan-close]').forEach(b=>b.onclick=()=>this.close());this.root.querySelector('.modal-backdrop').onclick=e=>{if(e.target===e.currentTarget)this.close()}}
 open(kind,{id,date}={}){
  const existing=id?structuredClone(this.getRows().find(row=>row.id===id)):null
  if(id&&!existing)return
  const context=this.getContext(),meal=kind==='meal',recipe=existing?.data?.recipe||existing?.recipe||{}
  this.root.innerHTML='<div id="plan-modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="plan-editor-title"><section class="calendar-modal plan-modal"><header class="modal-header"><div><p class="eyebrow">'+(meal?'Familiens madplan':'Familiens indkøb')+'</p><h2 id="plan-editor-title">'+(existing?'Rediger '+(meal?'ret':'vare'):meal?'Hvad skal vi spise?':'Tilføj en vare')+'</h2></div><button type="button" data-plan-close aria-label="Luk">×</button></header><form id="plan-form" class="stack-form"><label for="plan-title">'+(meal?'Ret':'Vare')+'</label><input id="plan-title" name="title" value="'+escape(existing?.title||'')+'" placeholder="'+(meal?'Fx pasta med tomatsauce':'Fx mælk')+'" required maxlength="160" autocomplete="off">'+(meal?'<div class="form-grid"><div><label for="plan-date">Dag</label><input id="plan-date" name="date" type="date" value="'+escape(existing?.date||date)+'" required></div><div><label for="plan-time">Spisetid · valgfri</label><input id="plan-time" name="time" type="time" value="'+escape(existing?.time||'')+'"></div></div><label for="plan-note">Indkøb til retten · valgfrit</label><textarea id="plan-note" name="note" rows="6" maxlength="4000" placeholder="Én vare pr. linje, fx&#10;500 g pasta&#10;Tomater&#10;Basilikum">'+escape(existing?.note||'')+'</textarea><p class="hint">Fra madplanen kan du føje disse linjer til indkøbslisten.</p>':'<label for="plan-note">Mængde eller note · valgfri</label><input id="plan-note" name="note" maxlength="4000" value="'+escape(existing?.note||'')+'" placeholder="Fx 2 liter"><label for="plan-category">Kategori</label><select id="plan-category" name="location">'+SHOPPING_CATEGORIES.map(c=>'<option '+((existing?.location||'Andet')===c?'selected':'')+'>'+escape(c)+'</option>').join('')+'</select>')+'<p id="plan-error" class="message" role="alert"></p><div class="modal-actions">'+(existing?'<button type="button" id="plan-delete" class="danger-button">Slet '+(meal?'ret':'vare')+'</button>':'')+'<button type="button" data-plan-close>Annuller</button><button type="submit">'+(meal?'Gem i madplan':'Gem vare')+'</button></div></form></section></div>'
  if(meal){
   const linked=this.getRecipes().find(r=>r.id===(existing?.recipe_id||existing?.data?.recipe_id)),bar=document.createElement('section');bar.className='recipe-meal-context';bar.innerHTML=linked?'<strong>'+escape(linked.title)+'</strong><button type="button" data-linked-recipe>Åbn opskrift</button><label>Portioner til dette måltid<input name="servings_override" type="number" min="1" max="10000" step="0.5" value="'+escape(existing.data?.servings_override||linked.servings||'')+'"></label>':'<button type="button" data-choose-recipe>Vælg fra opskriftsbiblioteket</button>';this.root.querySelector('#plan-form').prepend(bar);bar.querySelector('[data-choose-recipe]')?.addEventListener('click',()=>this.chooseRecipe(existing?.date||date));bar.querySelector('[data-linked-recipe]')?.addEventListener('click',()=>this.openRecipe(linked.id));
   if(linked){this.root.querySelector('#plan-title').readOnly=true;this.root.querySelector('#plan-note').rows=3;this.root.querySelector('label[for=plan-note]').textContent='Note til dette måltid';this.root.querySelector('#plan-note').placeholder='Fx lav dobbelt portion';this.root.querySelector('#plan-note').nextElementSibling.textContent='Ændrer ikke opskriften i biblioteket.'}
   if(!linked){
   const fields=this.root.querySelector('#plan-form'),urlBox=document.createElement('section');urlBox.className='recipe-import';urlBox.innerHTML='<label for="recipe-url">Importér fra URL</label><div><input id="recipe-url" name="recipeUrl" type="url" placeholder="https://…" value="'+escape(recipe.url||'')+'"><button type="button" id="recipe-fetch">Hent opskrift</button></div><p id="recipe-status" role="status"></p>';fields.prepend(urlBox);if(existing&&recipe.url){const preview=document.createElement('details');preview.className='recipe-saved';preview.innerHTML='<summary>Se opskriften</summary>'+recipeDetails(recipe);urlBox.after(preview)}
   const note=fields.querySelector('#plan-note');note.value=(recipe.ingredients||existing?.note?.split('\n')||[]).join('\n');note.name='ingredients';note.maxLength=16000;note.rows=4;fields.querySelector('[for=plan-note]').textContent='Ingredienser · én pr. linje'
   const extra=document.createElement('section');extra.className='recipe-fields';extra.innerHTML='<label for="recipe-steps">Fremgangsmåde · ét trin pr. linje</label><textarea id="recipe-steps" name="instructions" rows="4" maxlength="20000">'+escape((recipe.instructions||[]).join('\n'))+'</textarea><details><summary>Kilde og billede</summary><label for="recipe-site">Kilde/site</label><input id="recipe-site" name="recipeSite" value="'+escape(recipe.site||'')+'"><label for="recipe-image">Billedlink</label><input type="url" id="recipe-image" name="recipeImage" value="'+escape(recipe.image||'')+'"></details>';note.after(extra)
   }
  }
  this.bindClose()
  const form=this.root.querySelector('form'),error=this.root.querySelector('#plan-error')
  const run=async action=>{
   if(this.busy)return
   if(context!==this.getContext()){this.close();return}
   this.busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true)
   try{const result=await action();if(context!==this.getContext())return;if(result?.error)throw result.error;this.close(true);this.onSaved()}
   catch(e){if(error.isConnected)error.textContent=e.message}
   finally{if(form.isConnected)this.busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false)}
  }
  if(form.querySelector('#recipe-fetch'))form.querySelector('#recipe-fetch').onclick=async()=>{
   if(this.busy)return;const status=form.querySelector('#recipe-status');this.busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Henter opskrift…'
   try{const r=await this.fetchRecipe(form.elements.recipeUrl.value);if(!form.isConnected||context!==this.getContext())return;form.elements.title.value=r.title;form.elements.recipeUrl.value=r.url;form.elements.recipeImage.value=r.image||'';form.elements.recipeSite.value=r.site||'';form.elements.ingredients.value=(r.ingredients||[]).join('\n');form.elements.instructions.value=(r.instructions||[]).join('\n');status.textContent=r.format==='jsonld'?'Opskrift hentet. Du kan rette felterne inden du gemmer.':'Titel og kilde hentet. Tilføj selv ingredienser og fremgangsmåde.'}
   catch{if(form.isConnected)status.textContent='Opskriften kunne ikke hentes. Prøv et andet link, eller skriv den manuelt.'}
   finally{this.busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false)}
  }
  form.onsubmit=e=>{e.preventDefault();void run(()=>this.save(planValues(kind,Object.fromEntries(new FormData(form)),existing),existing))}
  this.root.querySelector('#plan-delete')?.addEventListener('click',()=>{if(window.confirm('Slet '+existing.title+'?'))void run(()=>this.remove(existing))})
 }
}
