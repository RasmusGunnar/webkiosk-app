import {t,errorText} from '../i18n/index.js'
import {readAllRows} from './rows.js'
import {recipeDraft} from './recipe-model.js'
export const RECIPE_BUCKET='recipe-images'
export const IMAGE_TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}
export function validateRecipeImage(file){if(!IMAGE_TYPES[file.type]||file.size<=0||file.size>5*1024*1024)throw Error((t("recipe.choose_jpeg_png_or_webp_up_to_5_mb")))}
export async function preparePhoto(file){
 if(!IMAGE_TYPES[file.type]||file.size<=0||file.size>25*1024*1024)throw Error((t("recipe.choose_jpeg_png_or_webp_up_to_25_mb")))
 // Decode and re-encode: bound dimensions and strip camera EXIF/location metadata.
 const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});if(bitmap.width*bitmap.height>50000000){bitmap.close();throw Error((t("recipe.the_image_is_too_large_choose_a_smaller_version")))}
 const ratio=Math.min(1,2000/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.87));if(!blob)throw Error((t("recipe.the_image_could_not_be_read")));validateRecipeImage(blob);return blob
}
export const blobImage=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({mime:blob.type,base64:String(r.result).split(',')[1]});r.onerror=reject;r.readAsDataURL(blob)})
export const imageBlob=image=>new Blob([Uint8Array.from(atob(image.base64),c=>c.charCodeAt(0))],{type:image.mime})
export class RecipeService{
 constructor({client,getContext}){Object.assign(this,{client,getContext})}
 online(){if(!navigator.onLine)throw Error((t("recipe.connect_to_change_or_import_recipes")))}
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

 async import(body){this.online();const c=this.getContext();const {data,error}=await this.client.functions.invoke('recipe-preview',{body:{...body,household_id:c.householdId},timeout:60000});if(c.key!==this.getContext().key)throw Error((t("recipe.the_family_has_changed_please_try_again")));if(error){let result;try{result=await error.context.json()}catch{}throw Error(errorText(result,'recipe.the_recipe_could_not_be_fetched_try_again_or_enter_it_manually'))}return data}
 async scan(pages){
  if(!navigator.onLine)throw Error((t("recipe.recipe_scanning_requires_an_internet_connection")))
  if(!pages.length||pages.length>4)throw Error((t("recipe.choose_1_4_pages")))
  pages.forEach(validateRecipeImage);if(pages.reduce((n,p)=>n+p.size,0)>12*1024*1024)throw Error((t("recipe.the_images_total_more_than_12_mb_choose_smaller_images")))
  const c=this.getContext(),{data}=await this.client.auth.getSession(),uid=data.session?.user?.id
  if(!uid)throw Error((t("recipe.sign_in_again_to_scan")))
  const scanId=crypto.randomUUID(),paths=[],bucket=this.client.storage.from(RECIPE_BUCKET)
  try{
   for(const page of pages){
    if(c.key!==this.getContext().key)throw Error((t("recipe.the_family_has_changed")))
    const path=c.householdId+'/'+scanId+'/scan-'+uid+'-'+crypto.randomUUID()+'.jpg';paths.push(path)
    const {error}=await bucket.upload(path,page,{contentType:page.type,upsert:false});if(error)throw Error((t("recipe.the_image_could_not_be_uploaded_please_try_again")))
   }
   if(c.key!==this.getContext().key)throw Error((t("recipe.the_family_has_changed")))
   return await this.import({action:'scan',paths})
  }finally{
   // Also covers partial uploads and a lost function response. Only this attempt's paths.
   if(paths.length){let removed=false;for(let n=0;n<2&&!removed;n++){try{const {error}=await bucket.remove(paths);removed=!error}catch{}}
    if(!removed)throw Error((t("recipe.temporary_images_could_not_be_removed_try_again_when_connected")))
   }
  }
 }
 async save(values,{existing=null,image=null,removeImage=false,id=existing?.id||crypto.randomUUID()}={}){
  this.online();const c=this.getContext();let newPath=null
  try{
   const draft=recipeDraft(values);draft.image_path=removeImage?null:existing?.image_path||null
   if(image){validateRecipeImage(image);newPath=c.householdId+'/'+id+'/'+crypto.randomUUID()+'.'+IMAGE_TYPES[image.type];const {error}=await this.client.storage.from(RECIPE_BUCKET).upload(newPath,image,{contentType:image.type,upsert:false});if(error)throw error;draft.image_path=newPath}
   if(c.key!==this.getContext().key)throw Error((t("recipe.the_family_has_changed")))
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
 async archive(recipe){this.online();const {data,error}=await this.client.from('recipes').update({archived_at:new Date().toISOString()}).eq('id',recipe.id).eq('updated_at',recipe.updated_at).select('id');if(error)throw error;if(!data?.length)throw Error((t("recipe.the_recipe_has_changed_open_it_again")))}
}
