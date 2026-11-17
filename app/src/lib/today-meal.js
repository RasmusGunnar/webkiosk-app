import {t} from '../i18n/index.js'
import {escape as e,icon,recipeImage} from './product-ui.js'
import {recipeId} from './recipe-model.js'

// One card family for Today on phones, desktop and the read-only wall.
export function todayMeal(meals,recipes,{wall=false}={}){
 const rows=meals.map(meal=>{const recipe=recipes.find(r=>r.id===recipeId(meal)),servings=meal.data?.servings||recipe?.servings
  const meta=[meal.time,recipe?.total_minutes?`${recipe.total_minutes} ${t('recipe.min')}`:'',servings?`${servings} ${t('recipe.servings')}`:''].filter(Boolean)
  return `<article class="today-meal-row ${recipe?.image_path?'has-image':''}">${recipe?.image_path?recipeImage(recipe,'today-meal-photo'):''}<div class="today-meal-copy"><h3>${e(meal.title||recipe?.title)}</h3>${meta.length?`<p class="today-meal-meta">${meta.map(e).join(' · ')}</p>`:''}${recipe?`<button class="today-meal-link" data-today-recipe="${e(meal.id)}">${e(t('polish.view_recipe'))} <span aria-hidden="true">→</span></button>`:''}</div></article>`
 }).join('')
 return `<section class="today-meal ${meals.length?'is-planned':''}" aria-label="${e(t('app.dinner'))}"><header>${icon('meals')}<h2>${e(t('app.dinner'))}</h2></header>${rows||`<p class="today-meal-empty">${e(t('polish.meal_empty'))}</p>`}${!wall?`<button class="today-meal-plan" data-go-route="meals">${e(t(meals.length?'app.view_this_week_s_meal_plan':'app.plan_dinner'))} <span aria-hidden="true">→</span></button>`:''}</section>`
}

// Private, small thumbnails only. The original image never travels to the Today card.
// Reuses the device's IndexedDB, with the same user/household isolation as avatars.
export class MealImages{
 constructor({client,store,getContext,base=''}){Object.assign(this,{client,store,getContext,base});this.scope='';this.generation=0;this.entries=new Map();this.pending=new Map();this.failures=new Map()}
 use(){const c=this.getContext(),scope=c.userId&&c.householdId?JSON.stringify([c.userId,c.householdId]):'';if(scope!==this.scope){this.clear();this.scope=scope}return this.scope}
 clear(){const scope=this.scope;this.generation++;this.scope='';for(const entry of this.entries.values())URL.revokeObjectURL(entry.url);this.entries.clear();this.pending.clear();this.failures.clear();if(scope)void this.store.removeWhere(r=>r.kind==='meal-image'&&r.scope===scope).catch(()=>{})}
 peek(recipe){this.use();return this.entries.get(`meal-image:${this.scope}:${recipe.id}:${recipe.image_path}`)?.url||''}
 async request(options){const {data}=await this.client.auth.getSession();if(!data.session)throw Error('RECIPE_UNAVAILABLE');const response=await fetch(`${this.base}/api/meal-recipes${options.id?'?id='+encodeURIComponent(options.id):''}`,{method:options.id?'GET':'POST',headers:{authorization:`Bearer ${data.session.access_token}`,...(!options.id?{'content-type':'application/json'}:{})},...(!options.id?{body:JSON.stringify({ids:options.ids})}:{}),signal:AbortSignal.timeout(18000),cache:'no-store',credentials:'omit'});if(!response.ok)throw Error('RECIPE_UNAVAILABLE');return response}
 async load(recipe){
  const scope=this.use(),generation=this.generation;if(!scope||!recipe.image_path)return ''
  const key=`meal-image:${scope}:${recipe.id}:${recipe.image_path}`,existing=this.entries.get(key)
  if(existing)return existing.url
  if(this.pending.has(key))return this.pending.get(key)
  if((this.failures.get(key)||0)>Date.now())return ''
  const request=(async()=>{try{
   let row=await this.store.get(key).catch(()=>null),blob=row?.scope===scope&&row.expires>Date.now()?row.blob:null
   if(!blob){const response=await this.request({id:recipe.id});blob=await response.blob()}
   if(blob.type!=='image/webp'||blob.size<=0||blob.size>384*1024||this.scope!==scope||this.generation!==generation)return ''
   const url=URL.createObjectURL(blob),image=new Image();image.src=url
   try{await image.decode()}catch{URL.revokeObjectURL(url);return ''}
   if(this.scope!==scope||this.generation!==generation){URL.revokeObjectURL(url);return ''}
   this.entries.set(key,{url,image});await this.store.put(key,{kind:'meal-image',scope,userId:this.getContext().userId,blob,expires:Date.now()+7*86400000}).catch(()=>{})
   return url
  }catch{if(this.scope===scope&&this.generation===generation)this.failures.set(key,Date.now()+60000);return ''}finally{if(this.generation===generation)this.pending.delete(key)}})();this.pending.set(key,request);return request
 }
 async bind(root,recipes){this.use();await Promise.all([...root.querySelectorAll('[data-meal-image]')].map(async img=>{const recipe=recipes.find(r=>r.id===img.dataset.mealImage);if(!recipe)return;const url=await this.load(recipe);if(img.isConnected&&url){img.src=url;img.hidden=false;img.parentElement.classList.add('is-ready')}}))}
}
