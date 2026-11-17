import test from 'node:test'
import assert from 'node:assert/strict'
import {todayMeal,MealImages} from '../src/lib/today-meal.js'
const recipe={id:'recipe',title:'Tomatsuppe',image_path:'family/recipe/image.webp',total_minutes:25,servings:4}
const meal={id:'meal',title:'Tomatsuppe',data:{recipe_id:'recipe'}}
test('Today shares recipe CTA and image states; manual and empty meals have no false recipe links',()=>{
 const linked=todayMeal([meal],[recipe],{wall:true});assert.match(linked,/data-today-recipe="meal"/);assert.match(linked,/data-meal-image="recipe"/);assert.doesNotMatch(linked,/data-go-route/)
 const noImage=todayMeal([meal],[{...recipe,image_path:null}]);assert.match(noImage,/data-today-recipe/);assert.doesNotMatch(noImage,/<figure|<img/)
 const manual=todayMeal([{id:'manual',title:'<img onerror=evil()>',data:{}}],[recipe]);assert.doesNotMatch(manual,/data-today-recipe|<img/);assert.match(manual,/&lt;img/)
 assert.match(todayMeal([],[]),/Ikke planlagt endnu/);assert.doesNotMatch(todayMeal([],[],{wall:true}),/<button|<img|<figure/)
})
test('Private meal images deduplicate, persist only blobs, and reject an old response after a session reset',async()=>{
 const previous=globalThis.Image;globalThis.Image=class{async decode(){}}
 const records=new Map(),store={get:async key=>records.get(key),put:async(key,row)=>records.set(key,row),removeWhere:async fn=>{for(const [key,row]of records)if(fn(row))records.delete(key)}}
 const context={userId:'user',householdId:'family'},cache=new MealImages({store,getContext:()=>context});let reads=0
 const response=()=>new Response(new Uint8Array([1]),{headers:{'content-type':'image/webp'}})
 try{
  cache.request=async()=>{reads++;return response()}
  const [a,b]=await Promise.all([cache.load(recipe),cache.load(recipe)]);assert.ok(a.startsWith('blob:'));assert.equal(a,b);assert.equal(reads,1);assert.equal(cache.peek(recipe),a)
  const row=[...records.values()][0];assert.ok(row.blob instanceof Blob);assert.equal(JSON.stringify(row).includes('token'),false);assert.equal(JSON.stringify(row).includes('blob:'),false)
  const warm=new MealImages({store,getContext:()=>context});warm.request=async()=>{throw Error('network not expected')};assert.ok((await warm.load(recipe)).startsWith('blob:'));warm.clear()
  cache.clear();const releases=[];cache.request=()=>new Promise(resolve=>releases.push(()=>resolve(response())))
  const old=cache.load(recipe);while(releases.length<1)await new Promise(r=>setImmediate(r));cache.clear();const fresh=cache.load(recipe);while(releases.length<2)await new Promise(r=>setImmediate(r))
  releases[0]();assert.equal(await old,'');assert.equal(cache.pending.size,1);releases[1]();assert.ok((await fresh).startsWith('blob:'))
 }finally{cache.clear();globalThis.Image=previous}
})
