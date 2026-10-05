import {readAllRows} from './rows.js'
import {recipeDraft} from './recipe-model.js'
export const RECIPE_BUCKET='recipe-images'
export const IMAGE_TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}
export function validateRecipeImage(file){if(!IMAGE_TYPES[file.type]||file.size<=0||file.size>5*1024*1024)throw Error('Vælg JPEG, PNG eller WebP på højst 5 MB.')}
export async function preparePhoto(file){
 validateRecipeImage(file)
 // Decode and re-encode: bound dimensions and strip camera EXIF/location metadata.
 const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>50000000){bitmap.close();throw Error('Billedet er for stort. Vælg en mindre version.')}
 const ratio=Math.min(1,2000/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.87));if(!blob)throw Error('Billedet kunne ikke læses.');validateRecipeImage(blob);return blob
}
export const blobImage=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({mime:blob.type,base64:String(r.result).split(',')[1]});r.onerror=reject;r.readAsDataURL(blob)})
export const imageBlob=image=>new Blob([Uint8Array.from(atob(image.base64),c=>c.charCodeAt(0))],{type:image.mime})
export class RecipeService{
 constructor({client,getContext}){Object.assign(this,{client,getContext})}
 online(){if(!navigator.onLine)throw Error('Opret forbindelse for at ændre eller importere opskrifter.')}
 async load(){const c=this.getContext();return readAllRows(()=>this.client.from('recipes').select('*,recipe_ingredients(*),recipe_instructions(*),recipe_ratings(*)').eq('household_id',c.householdId).order('id'),()=>c.key===this.getContext().key)}
 async images(recipes){
  const key=this.getContext().key
  if(this.imageCache?.key!==key)this.imageCache={key,urls:new Map(),pending:new Map()}
  const cache=this.imageCache,paths=[...new Set(recipes.map(r=>r.image_path).filter(Boolean))],now=Date.now()
  for(const [path,value] of cache.urls)if(value.expires<=now||!paths.includes(path))cache.urls.delete(path)
  const missing=paths.filter(path=>!cache.urls.has(path)&&!cache.pending.has(path))
  if(missing.length){
   // Reuse private URLs across meal cards, the library and realtime refreshes; renew before expiry.
   const request=Promise.resolve().then(()=>this.client.storage.from(RECIPE_BUCKET).createSignedUrls(missing,3600)).then(({data})=>{
    for(const row of data||[])if(row.signedUrl&&!row.error)cache.urls.set(row.path,{url:row.signedUrl,expires:now+55*60*1000})
   }).catch(()=>{}).finally(()=>missing.forEach(path=>cache.pending.delete(path)))
   missing.forEach(path=>cache.pending.set(path,request))
  }
  await Promise.all(paths.map(path=>cache.pending.get(path)))
  return recipes.map(r=>({...r,image_display_url:this.getContext().key===key?cache.urls.get(r.image_path)?.url||'':''}))
 }

 async import(body){this.online();const c=this.getContext();const {data,error}=await this.client.functions.invoke('recipe-preview',{body:{...body,household_id:c.householdId},timeout:60000});if(c.key!==this.getContext().key)throw Error('Familien er ændret. Prøv igen.');if(error){let result;try{result=await error.context.json()}catch{}throw Error(result?.message||'Opskriften kunne ikke hentes. Prøv igen eller skriv den manuelt.')}return data}
 async save(values,{existing=null,image=null,removeImage=false,id=existing?.id||crypto.randomUUID()}={}){
  this.online();const c=this.getContext();let newPath=null
  try{
   const draft=recipeDraft(values);draft.image_path=removeImage?null:existing?.image_path||null
   if(image){validateRecipeImage(image);newPath=c.householdId+'/'+id+'/'+crypto.randomUUID()+'.'+IMAGE_TYPES[image.type];const {error}=await this.client.storage.from(RECIPE_BUCKET).upload(newPath,image,{contentType:image.type,upsert:false});if(error)throw error;draft.image_path=newPath}
   if(c.key!==this.getContext().key)throw Error('Familien er ændret.')
   const {error}=await this.client.rpc('save_recipe',{p_household_id:c.householdId,p_id:id,p_recipe:draft,p_expected:existing?.updated_at||null});if(error)throw error
   if(existing?.image_path&&existing.image_path!==draft.image_path)await this.client.storage.from(RECIPE_BUCKET).remove([existing.image_path]).catch(()=>{})
   return id
  }catch(error){
   // A lost HTTP response may follow a committed save. Never remove a cover still in use.
   if(newPath){try{const result=await this.client.from('recipes').select('id').eq('image_path',newPath);if(!result.error&&result.data?.length===0)await this.client.storage.from(RECIPE_BUCKET).remove([newPath])}catch{/* uncertain outcome: retain private object */}}
   throw error
  }
 }
 async rate(recipe,personId,rating){this.online();const q=rating?this.client.from('recipe_ratings').upsert({recipe_id:recipe.id,person_id:personId,rating}):this.client.from('recipe_ratings').delete().eq('recipe_id',recipe.id).eq('person_id',personId);const {error}=await q;if(error)throw error}
 async archive(recipe){this.online();const {data,error}=await this.client.from('recipes').update({archived_at:new Date().toISOString()}).eq('id',recipe.id).eq('updated_at',recipe.updated_at).select('id');if(error)throw error;if(!data?.length)throw Error('Opskriften er ændret. Åbn den igen.')}
}
