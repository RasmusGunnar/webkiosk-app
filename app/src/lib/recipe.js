import {escape as e} from './product-ui.js'
export const lines=value=>(Array.isArray(value)?value:String(value||'').split(/\r?\n/)).map(x=>String(x).trim()).filter(Boolean)
export function safeRecipeLink(value){try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return '';return u.href}catch{return ''}}
export function recipeValues(fields,existing={}){
 const ingredients=lines(fields.ingredients??existing.ingredients),instructions=lines(fields.instructions??existing.instructions)
 if(ingredients.length>100||ingredients.some(x=>x.length>160))throw Error('Brug højst 100 ingredienser på hver højst 160 tegn.')
 if(instructions.join('\n').length>20000)throw Error('Fremgangsmåden må højst være 20.000 tegn.')
 const url=fields.recipeUrl??existing.url??'',image=fields.recipeImage??existing.image??''
 if((url&&!safeRecipeLink(url))||(image&&!safeRecipeLink(image)))throw Error('Brug et almindeligt http- eller https-link.')
 return {...existing,url:safeRecipeLink(url),image:safeRecipeLink(image),site:String(fields.recipeSite??existing.site??'').slice(0,200),ingredients,instructions}
}
export function recipeDetails(recipe={}){
 return '<div class="recipe-detail">'+(recipe.image?'<img class="recipe-image" src="'+e(safeRecipeLink(recipe.image))+'" referrerpolicy="no-referrer" alt="Opskriften" loading="lazy">':'')+(recipe.ingredients?.length?'<h3>Ingredienser</h3><ul>'+recipe.ingredients.map(x=>'<li>'+e(x)+'</li>').join(''):'')+(recipe.instructions?.length?'<h3>Fremgangsmåde</h3><ol>'+recipe.instructions.map(x=>'<li>'+e(x)+'</li>').join(''):'')+(safeRecipeLink(recipe.url)?'<a href="'+e(safeRecipeLink(recipe.url))+'" target="_blank" rel="noopener noreferrer">Se original opskrift'+(recipe.site?' · '+e(recipe.site):'')+' ↗</a>':'')+'</div>'
}
