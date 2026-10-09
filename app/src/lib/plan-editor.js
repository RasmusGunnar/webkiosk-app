import {categoryLabel} from '../i18n/domain-labels.js'
import {t,userError} from '../i18n/index.js'
import {recipeDetails} from './recipe.js'
import {escape,icon} from './product-ui.js'
import {PLAN_TYPES,SHOPPING_CATEGORIES,planValues} from './household-plans.js'
export class PlanEditor{
 constructor({root,getRows,getContext,save,remove,onSaved,fetchRecipe,saveRecipe,getRecipes=()=>[],chooseRecipe,openRecipe}){Object.assign(this,{root,getRows,getContext,save,remove,onSaved,fetchRecipe,saveRecipe,getRecipes,chooseRecipe,openRecipe});this.busy=false;root.addEventListener('dismiss-dialog',()=>this.close())}
 get opened(){return Boolean(this.root.firstChild)}
 close(force=false){if(this.busy&&!force)return;this.root.innerHTML='';this.busy=false}
 view({title,date,time,note,people,source,recipe,location}){
  this.root.innerHTML=("<div id=\"plan-modal\" class=\"modal-backdrop\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"plan-editor-title\"><section class=\"calendar-modal plan-modal ux-readonly\"><header class=\"modal-header\"><div><p class=\"eyebrow\">"+t("plan_editor.family_overview")+"</p><h2 id=\"plan-editor-title\">")+escape(title)+("</h2></div><button type=\"button\" data-plan-close aria-label=\""+t("common.close")+"\">×</button></header><p>")+escape([date,time].filter(Boolean).join(' · '))+'</p>'+(location?'<p>'+escape(location)+'</p>':'')+(people?'<p>'+escape(people)+'</p>':'')+(source?'<p class="source-label">'+escape(source)+'</p>':'')+(note?'<p class="plan-note">'+escape(note)+'</p>':'')+(recipe?recipeDetails(recipe):'')+("<p class=\"hint\">"+t("plan_editor.change_plans_from_a_phone_or_computer")+"</p><button type=\"button\" data-plan-close>"+t("common.close")+"</button></section></div>")
  this.bindClose()
 }
 bindClose(){this.root.querySelectorAll('[data-plan-close]').forEach(b=>b.onclick=()=>this.close());this.root.querySelector('.modal-backdrop').onclick=e=>{if(e.target===e.currentTarget)this.close()}}
 open(kind,{id,date}={}){
  const existing=id?structuredClone(this.getRows().find(row=>row.id===id)):null
  if(id&&!existing)return
  const context=this.getContext(),meal=kind==='meal',recipe=existing?.data?.recipe||existing?.recipe||{}
  // Only a newly fetched preview creates a library recipe. Existing legacy text stays unlinked.
  let importedRecipe=null,importId=null,savedRecipe=null
  this.root.innerHTML='<div id="plan-modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="plan-editor-title"><section class="calendar-modal plan-modal"><header class="modal-header"><div><p class="eyebrow">'+(meal?(t("plan_editor.family_meal_plan")):(t("plan_editor.family_shopping")))+'</p><h2 id="plan-editor-title">'+(existing?(t("app.edit")+" ")+(meal?t('plan_editor.meal'):t('plan_editor.item')):meal?(t("plan_editor.what_shall_we_eat")):(t("plan_editor.add_an_item")))+("</h2></div><button type=\"button\" data-plan-close aria-label=\""+t("common.close")+"\">×</button></header><form id=\"plan-form\" class=\"stack-form\"><label for=\"plan-title\">")+(meal?(t("plan_editor.meal")):(t("plan_editor.item")))+'</label><input id="plan-title" name="title" value="'+escape(existing?.title||'')+'" placeholder="'+(meal?(t("plan_editor.for_example_pasta_with_tomato_sauce")):(t("plan_editor.for_example_milk")))+'" required maxlength="160" autocomplete="off">'+(meal?("<div class=\"form-grid\"><div><label for=\"plan-date\">"+t("app.day")+"</label><input id=\"plan-date\" name=\"date\" type=\"date\" value=\"")+escape(existing?.date||date)+("\" required></div><div><label for=\"plan-time\">"+t("plan_editor.mealtime_optional")+"</label><input id=\"plan-time\" name=\"time\" type=\"time\" value=\"")+escape(existing?.time||'')+("\"></div></div><label for=\"plan-note\">"+t("plan_editor.shopping_for_this_meal_optional")+"</label><textarea id=\"plan-note\" name=\"note\" rows=\"6\" maxlength=\"4000\" placeholder=\""+t("plan_editor.one_item_per_line_for_example_10_500_g_pasta_10_tomatoes_10_basil")+"\">")+escape(existing?.note||'')+("</textarea><p class=\"hint\">"+t("plan_editor.add_these_lines_to_your_shopping_list_from_the_meal_plan")+"</p>"):("<label for=\"plan-note\">"+t("plan_editor.quantity_or_note_optional")+"</label><input id=\"plan-note\" name=\"note\" maxlength=\"4000\" value=\"")+escape(existing?.note||'')+("\" placeholder=\""+t("plan_editor.for_example_2_litres")+"\"><label for=\"plan-category\">"+t("plan_editor.category")+"</label><select id=\"plan-category\" name=\"location\">")+SHOPPING_CATEGORIES.map(c=>'<option value="'+escape(c)+'" '+((existing?.location||'Andet')===c?'selected':'')+'>'+escape(categoryLabel(c))+'</option>').join('')+'</select>')+'<p id="plan-error" class="message" role="alert"></p><div class="modal-actions">'+(existing?("<button type=\"button\" id=\"plan-delete\" class=\"danger-button\">"+t("app.delete")+" ")+(meal?t('plan_editor.meal'):t('plan_editor.item'))+'</button>':'')+("<button type=\"button\" data-plan-close>"+t("common.cancel")+"</button><button type=\"submit\">")+(meal?(t("plan_editor.save_to_meal_plan")):(t("plan_editor.save_item")))+'</button></div></form></section></div>'
  if(meal){
   const linked=this.getRecipes().find(r=>r.id===(existing?.recipe_id||existing?.data?.recipe_id)),bar=document.createElement('section');bar.className='recipe-meal-context';bar.innerHTML=linked?'<strong>'+escape(linked.title)+("</strong><button type=\"button\" data-linked-recipe>"+t("plan_editor.open_recipe")+"</button><label>"+t("plan_editor.servings_for_this_meal")+"<input name=\"servings_override\" type=\"number\" min=\"1\" max=\"10000\" step=\"0.5\" value=\"")+escape(existing.data?.servings_override||linked.servings||'')+'"></label>':("<button type=\"button\" data-choose-recipe>"+t("plan_editor.choose_from_recipe_library")+"</button>");this.root.querySelector('#plan-form').prepend(bar);bar.querySelector('[data-choose-recipe]')?.addEventListener('click',()=>this.chooseRecipe(existing?.date||date));bar.querySelector('[data-linked-recipe]')?.addEventListener('click',()=>this.openRecipe(linked.id));
   if(linked){this.root.querySelector('#plan-title').readOnly=true;this.root.querySelector('#plan-note').rows=3;this.root.querySelector('label[for=plan-note]').textContent=(t("plan_editor.note_for_this_meal"));this.root.querySelector('#plan-note').placeholder=(t("plan_editor.for_example_make_a_double_batch"));this.root.querySelector('#plan-note').nextElementSibling.textContent=(t("plan_editor.does_not_change_the_recipe_in_the_library"))}
   if(!linked){
   const fields=this.root.querySelector('#plan-form'),urlBox=document.createElement('section');urlBox.className='recipe-import';urlBox.innerHTML=("<label for=\"recipe-url\">"+t("plan_editor.import_from_url")+"</label><div><input id=\"recipe-url\" name=\"recipeUrl\" type=\"url\" placeholder=\"https://…\" value=\"")+escape(recipe.url||'')+("\"><button type=\"button\" id=\"recipe-fetch\">"+t("plan_editor.fetch_recipe")+"</button></div><p id=\"recipe-status\" role=\"status\"></p>");fields.prepend(urlBox);if(existing&&recipe.url){const preview=document.createElement('details');preview.className='recipe-saved';preview.innerHTML=("<summary>"+t("plan_editor.view_recipe")+"</summary>")+recipeDetails(recipe);urlBox.after(preview)}
   const note=fields.querySelector('#plan-note');note.value=(recipe.ingredients||existing?.note?.split('\n')||[]).join('\n');note.name='ingredients';note.maxLength=16000;note.rows=4;fields.querySelector('[for=plan-note]').textContent=(t("plan_editor.ingredients_one_per_line"))
   const extra=document.createElement('section');extra.className='recipe-fields';extra.innerHTML=("<label for=\"recipe-steps\">"+t("plan_editor.instructions_one_step_per_line")+"</label><textarea id=\"recipe-steps\" name=\"instructions\" rows=\"4\" maxlength=\"20000\">")+escape((recipe.instructions||[]).join('\n'))+("</textarea><details><summary>"+t("plan_editor.source_and_image")+"</summary><label for=\"recipe-site\">"+t("plan_editor.source_site")+"</label><input id=\"recipe-site\" name=\"recipeSite\" value=\"")+escape(recipe.site||'')+("\"><label for=\"recipe-image\">"+t("plan_editor.image_link")+"</label><input type=\"url\" id=\"recipe-image\" name=\"recipeImage\" value=\"")+escape(recipe.image||'')+'"></details>';note.after(extra)
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
   if(this.busy)return;const status=form.querySelector('#recipe-status');this.busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent=(t("plan_editor.fetching_recipe"))
   try{const r=await this.fetchRecipe(form.elements.recipeUrl.value);if(!form.isConnected||context!==this.getContext())return;importedRecipe=r;importId=crypto.randomUUID();savedRecipe=null;form.elements.title.value=r.title;form.elements.recipeUrl.value=r.url;form.elements.recipeImage.value=r.image||'';form.elements.recipeSite.value=r.site||'';form.elements.ingredients.value=(r.ingredients||[]).join('\n');form.elements.instructions.value=(r.instructions||[]).join('\n');status.textContent=r.format==='jsonld'?(t("plan_editor.recipe_fetched_edit_the_fields_before_saving")):(t("plan_editor.title_and_source_fetched_add_the_ingredients_and_instructions_yourself"))}
   catch{if(form.isConnected)status.textContent=(t("plan_editor.the_recipe_could_not_be_fetched_try_another_link_or_enter_it_manually"))}
   finally{this.busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false)}
  }
  form.onsubmit=e=>{e.preventDefault();void run(async()=>{
   const values=planValues(kind,Object.fromEntries(new FormData(form)),existing)
   if(importedRecipe){
    const preview={...importedRecipe,...values.recipe,title:values.title,image_copy:values.recipe.image===importedRecipe.image?importedRecipe.image_copy:null}
    // Persist the master and private cover before queueing a meal that references them.
    // Keep the same ID/version if the calendar save fails and the user retries.
    savedRecipe=await this.saveRecipe(preview,{id:importId,existing:savedRecipe})
    if(context!==this.getContext())return
    values.recipe_id=savedRecipe.id
    values.servings_override=importedRecipe.servings||null
    values.recipe={}
   }
   return this.save(values,existing)
  })}
  this.root.querySelector('#plan-delete')?.addEventListener('click',()=>{if(window.confirm((t("app.delete")+" ")+existing.title+'?'))void run(()=>this.remove(existing))})
 }
}
