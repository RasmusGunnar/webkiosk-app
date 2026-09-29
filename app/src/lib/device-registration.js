export class DeviceRegistration {
 constructor({client,push,storage,platform,appVersion='1.0.0',enabled=false,onStatus=()=>{}}){
  Object.assign(this,{client,push,storage,platform,appVersion,enabled,onStatus})
  this.context=null;this.token=null;this.handles=[];this.generation=0;this.serial=Promise.resolve()
  const key='familiekalender.installation.v1'
  this.id=storage.getItem(key)||crypto.randomUUID();storage.setItem(key,this.id)
 }
 async attach(userId,householdId){
  if(!this.platform.native)return
  this.context={userId,householdId};this.generation++
  if(!this.handles.length&&this.enabled){
   this.handles.push(await this.push.addListener('registration',({value})=>{if(this.context){this.token=value;void this.save()}}))
   this.handles.push(await this.push.addListener('registrationError',()=>this.onStatus('Push kunne ikke registreres. Prøv igen senere.')))
  }
  await this.save()
 }
 async save(){
  const context=this.context,generation=this.generation,token=this.token
  if(!context)return
  // Serialize writes so refresh/household changes cannot restore an older token.
  this.serial=this.serial.catch(()=>{}).then(async()=>{
   if(generation!==this.generation)return
   const {error}=await this.client.rpc('register_device',{p_installation_id:this.id,p_household_id:context.householdId,p_platform:this.platform.os,p_app_version:this.appVersion,p_push_token:token})
   if(error)this.onStatus('Enheden er ikke registreret. Opret forbindelse og prøv igen.')
  }).catch(()=>this.onStatus('Enhedsregistrering afventer forbindelse.'))
  return this.serial
 }
 async request(){
  if(!this.enabled){this.onStatus('Push afventer opsætning af APNs/FCM.');return}
  if(!this.context)return
  let permission=await this.push.checkPermissions()
  if(permission.receive==='prompt'||permission.receive==='prompt-with-rationale')permission=await this.push.requestPermissions()
  if(permission.receive!=='granted'){this.onStatus('Notifikationer er slået fra. Tillad dem i enhedens indstillinger.');return}
  await this.push.register()
  this.onStatus('Tilladelse givet. Påmindelser er endnu ikke aktiveret.')
 }
 async resume(){
  await this.save()
  if(this.enabled&&this.context&&(await this.push.checkPermissions()).receive==='granted')await this.push.register()
 }
 async detach(){
  this.generation++;this.context=null;this.token=null
  // OS unregistration first. Server rows have a short expiry and sender must require active membership.
  if(this.enabled)try{await this.push.unregister()}catch{}
  await this.serial.catch(()=>{})
  const {error}=await this.client.rpc('unregister_device',{p_installation_id:this.id})
  for(const handle of this.handles)await handle.remove()
  this.handles=[]
  return !error
 }
}
