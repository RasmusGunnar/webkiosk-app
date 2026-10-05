import test from 'node:test'
import assert from 'node:assert/strict'
import {canonicalRecipeUrl,recipeDraft,recipeUsage,ratingSummary,filterRecipes} from '../src/lib/recipe-model.js'
import {calendarPayload} from '../src/lib/calendar.js'
import {planValues} from '../src/lib/household-plans.js'
test('canonical recipe URLs remove tracking but preserve meaningful query params and never merge titles',()=>{assert.equal(canonicalRecipeUrl('https://example.com/a/?utm_source=x&b=2#a'),'https://example.com/a?b=2');assert.equal(canonicalRecipeUrl('javascript:alert(1)'),'');assert.equal(canonicalRecipeUrl('https://u:p@example.com'),'');assert.notEqual(canonicalRecipeUrl('https://example.com/a?b=2'),canonicalRecipeUrl('https://example.com/a?b=3'))})
test('recipe draft preserves raw ingredient wording and ordered steps; validates required title and numeric fields',()=>{const d=recipeDraft({title:'Lasagne',ingredients:'2 dåser hakkede tomater\nSalt efter smag',instructions:'Rør.\nBag.',servings:5});assert.deepEqual(d.ingredients,['2 dåser hakkede tomater','Salt efter smag']);assert.equal(d.servings,5);assert.throws(()=>recipeDraft({title:'',ingredients:[]}));assert.throws(()=>recipeDraft({title:'Ret',servings:-1}));assert.throws(()=>recipeDraft({title:'Ret',ingredients:['x'.repeat(1001)]}))})
test('family favorite requires a true majority of current family, not just one positive rating',()=>{const people=[1,2,3,4,5].map(id=>({id}));assert.equal(ratingSummary([],people).rated,0);assert.equal(ratingSummary([{person_id:1,rating:'love'}],people).favorite,false);const ratings=[1,2,3].map(person_id=>({person_id,rating:'like'}));assert.equal(ratingSummary(ratings,people).favorite,true);assert.equal(ratingSummary([...ratings,{person_id:6,rating:'love'}],people).positive,3)})
test('usage counts actual past/current meals and excludes planned future, shopping and other recipes',()=>{const meals=[{type:'Madplan',date:'2026-10-01',data:{recipe_id:'r'}},{type:'Madplan',date:'2026-10-02',recipe_id:'r'},{type:'Madplan',date:'2026-11-01',recipe_id:'r'},{type:'Indkøb',date:'2026-10-02',recipe_id:'r'}];assert.deepEqual(recipeUsage('r',meals,'2026-10-05'),{last:'2026-10-02',count:2})})
test('library search/filter excludes archives and never invents favorite precision',()=>{const recipes=[{id:'a',title:'Lasagne',total_minutes:55},{id:'b',title:'Tacos',total_minutes:25},{id:'c',title:'Pasta',archived_at:'2026-01-01'}];assert.equal(filterRecipes(recipes,{query:'LAS'}).length,1);assert.deepEqual(filterRecipes(recipes,{filter:'quick'}).map(r=>r.id),['b'])})
test('meal edit preserves recipe relation, individual servings and note without altering master',()=>{const meal={id:'meal',title:'Lasagne',type:'Madplan',date:'2026-10-05',note:'Lav dobbelt',data:{recipe_id:'recipe',servings_override:6}};const values=planValues('meal',{title:'Lasagne',date:meal.date,note:'Til fryseren',servings_override:'7'},meal);const row=calendarPayload(values,[]);assert.equal(row.data.recipe_id,'recipe');assert.equal(row.data.servings_override,7);assert.equal(row.note,'Til fryseren');assert.equal(meal.note,'Lav dobbelt')})

test('inactive/archived people do not inflate family favorite denominator',()=>{const s=ratingSummary([{person_id:1,rating:'love'}],[{id:1},{id:2,active:false},{id:3,archived:true}]);assert.equal(s.total,1);assert.equal(s.favorite,true)})
test('lost save response never deletes an image still referenced by its recipe',async()=>{const {RecipeService}=await import('../src/lib/recipe-service.js');Object.defineProperty(navigator,'onLine',{value:true,configurable:true});let removed=0;const storage={upload:async()=>({error:null}),remove:async()=>{removed++;return {error:null}}};const service=new RecipeService({getContext:()=>({key:'fixture',householdId:'household'}),client:{storage:{from:()=>storage},rpc:async()=>({error:new Error('Lost response')}),from:()=>({select:()=>({eq:async()=>({data:[{id:'saved'}],error:null})})})}});await assert.rejects(service.save({title:'Ret',ingredients:[],instructions:[]},{id:'saved',image:new Blob(['fixture'],{type:'image/png'})}));assert.equal(removed,0)})


test('private covers reuse URLs across concurrent loads and refresh only on expiry or household change',async t=>{
 const {RecipeService}=await import('../src/lib/recipe-service.js');let now=1000,key='user:household-a',calls=[]
 t.mock.method(Date,'now',()=>now)
 const service=new RecipeService({getContext:()=>({key}),client:{storage:{from:()=>({createSignedUrls:async(paths,ttl)=>{calls.push({paths,ttl});return {data:paths.map(path=>({path,signedUrl:'https://local.test/'+calls.length+'/'+path}))}}})}}})
 const rows=[{id:'one',image_path:'a/cover.jpg'},{id:'two',image_path:'a/cover.jpg'},{id:'plain'}]
 const [first,concurrent]=await Promise.all([service.images(rows),service.images(rows)])
 assert.equal(calls.length,1);assert.deepEqual(calls[0],{paths:['a/cover.jpg'],ttl:3600});assert.equal(first[0].image_display_url,first[1].image_display_url);assert.deepEqual(first,concurrent);assert.equal(first[2].image_display_url,'')
 now+=54*60*1000;assert.deepEqual(await service.images(rows),first);assert.equal(calls.length,1)
 now+=2*60*1000;const renewed=await service.images(rows);assert.equal(calls.length,2);assert.notEqual(renewed[0].image_display_url,first[0].image_display_url)
 key='user:household-b';await service.images(rows);assert.equal(calls.length,3)
})
test('cover failures preserve recipe text, allow retry and discard a late response after switching household',async()=>{
 const {RecipeService}=await import('../src/lib/recipe-service.js');let key='user:a',fail=true,release
 const service=new RecipeService({getContext:()=>({key}),client:{storage:{from:()=>({createSignedUrls:async paths=>{if(fail)throw Error('Storage unavailable');return new Promise(resolve=>{release=()=>resolve({data:paths.map(path=>({path,signedUrl:'https://local.test/cover'}))})})}})}}})
 const rows=[{id:'recipe',title:'Lasagne',image_path:'a/cover.jpg'}]
 const fallback=await service.images(rows);assert.equal(fallback[0].title,'Lasagne');assert.equal(fallback[0].image_display_url,'')
 fail=false;const pending=service.images(rows);await Promise.resolve();key='user:b';release();assert.equal((await pending)[0].image_display_url,'')
})
