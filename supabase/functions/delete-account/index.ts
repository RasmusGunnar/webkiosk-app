import { createClient } from 'npm:@supabase/supabase-js@2.105.4'
import { validateDeletionInput } from './validation.ts'
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'}
const response=(status:number,data:Record<string,unknown>)=>new Response(JSON.stringify(data),{status,headers})
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers})
 if(req.method!=='POST')return response(405,{error:'Brug POST.'})
 let deletionStarted=false
 try{
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth=req.headers.get('Authorization')||''
  if(!auth.startsWith('Bearer '))return response(401,{error:'Log ind igen.'})
  if(Number(req.headers.get('Content-Length')||0)>8192)return response(413,{error:'Ugyldig forespørgsel.'})
  const body=await req.text()
  if(body.length>8192)return response(413,{error:'Ugyldig forespørgsel.'})
  const input=validateDeletionInput(JSON.parse(body))
  const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:identity,error:identityError}=await client.auth.getUser(auth.slice(7))
  if(identityError||!identity.user?.email)return response(401,{error:'Log ind igen.'})
  const user=identity.user
  if(user.factors?.some(f=>f.status==='verified'))return response(403,{error:'Bekræft multifaktor-login før kontosletning. Kontakt support.'})
  const {data:verified,error:verifyError}=await client.auth.signInWithPassword({email:user.email!,password:input.password})
  if(verifyError||verified.user?.id!==user.id)return response(403,{error:'Adgangskoden kunne ikke bekræftes.'})
  // Dispose only the short-lived reauthentication session; do not sign out other app sessions here.
  await client.auth.signOut({scope:'local'})
  const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  const started=await service.rpc('begin_account_deletion',{p_user_id:user.id,p_delete_households:input.delete_household_ids})
  if(started.error)return response(409,{error:'Kontrollér familierne igen. Som eneste ejer skal du bekræfte sletning af hver familie.'})
  deletionStarted=true
  // Database access is already removed. Storage uses its API so physical objects are removed too.
  for(let batch=0;batch<100;batch++){
   const objects=await service.rpc('account_deletion_objects',{p_user_id:user.id})
   if(objects.error)throw Error('Storage lookup failed')
   if(!objects.data?.length){
    const deleted=await service.auth.admin.deleteUser(user.id)
    if(deleted.error)throw Error('Auth deletion failed')
    return response(200,{deleted:true})
   }
   const removed=await service.storage.from('household-avatars').remove(objects.data.map((row:{name:string})=>row.name))
   if(removed.error)throw Error('Storage cleanup failed')
  }
  throw Error('Cleanup continuation required')
 }catch{
  // Never log the body, password, JWT, email, feed URLs or provider errors.
  return response(deletionStarted?503:400,{pending:deletionStarted,error:deletionStarted?'Sletningen er startet. Prøv Slet min konto igen for at færdiggøre oprydningen.':'Ugyldig forespørgsel. Bekræft adgangskode og sletning.'})
 }
})
