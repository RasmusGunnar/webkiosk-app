import {t} from '../i18n/index.js'
export function pairingValue(input) {
 const raw=String(input||'').trim()
 if(/^[0-9a-f]{64}$/.test(raw)||/^[0-9a-f]{5}-?[0-9a-f]{5}$/i.test(raw))return raw
 try{const url=new URL(raw);if(url.protocol==='familiekalender:'&&url.hostname==='wall'&&url.pathname==='/pair'){const token=new URLSearchParams(url.hash.slice(1)).get('pair');if(/^[0-9a-f]{64}$/.test(token))return token}}catch{}
 throw Error((t("wall_device.the_code_could_not_be_read_use_the_qr_code_or_short_code_from_an_adult_s_phone")))
}
export class WallDeviceService {
 constructor({client,onSnapshot=()=>{},onRevoked=()=>{},onStatus=()=>{}}){Object.assign(this,{client,onSnapshot,onRevoked,onStatus});this.device=null;this.channel=null;this.timer=null;this.pending=null;this.generation=0}
 async session(){
  const {data}=await this.client.auth.getSession()
  if(data.session&&!data.session.user.is_anonymous)throw Error((t("wall_device.sign_out_on_this_device_before_pairing_it_as_a_wall_display")))
  if(!data.session){const r=await this.client.auth.signInAnonymously();if(r.error)throw Error((t("wall_device.wall_display_sign_in_is_unavailable_an_administrator_needs_to_enable_anonymous_auth")));return r.data.session}
  return data.session
 }
 async pair(value,platform){
  const code=pairingValue(value);this.pairing=true
  try{
  if(!this.device){const current=await this.client.auth.getSession();if(current.data.session?.user.is_anonymous){const d=await this.client.from('household_devices').select('revoked_at').eq('auth_user_id',current.data.session.user.id).maybeSingle();if(d.data?.revoked_at)await this.client.auth.signOut({scope:'local'})}}
  await this.session()
  const {data,error}=await this.client.rpc('redeem_wall_pairing',{p_code:code,p_platform:platform})
  if(error)throw Error((t("wall_device.the_display_could_not_connect_please_try_again")))
  if(data.error)throw Error(data.error==='rate_limited'?(t("wall_device.too_many_attempts_wait_10_minutes")):(t("wall_device.the_code_has_expired_been_used_or_is_incorrect_create_a_new_one_on_the_phone")))
  this.device=data.device;await this.restore();return this.device
  }finally{this.pairing=false}
 }
 async restore(){
  this.stop();const version=this.generation
  await this.refresh();if(!this.device||version!==this.generation)return
  this.channel=this.client.channel('wall-access:'+this.device.id).on('postgres_changes',{event:'UPDATE',schema:'public',table:'household_devices',filter:'id=eq.'+this.device.id},payload=>{
   if(payload.new.revoked_at)this.revoke();else void this.refresh()
  }).subscribe()
  this.timer=setInterval(()=>void this.refresh(),15000)
 }
 async refresh(){
  if(this.pending)return this.pending
  const version=this.generation
  this.pending=(async()=>{
   const r=await this.client.rpc('wall_snapshot').abortSignal(AbortSignal.timeout(8000))
   if(version!==this.generation)return
   if(r.error){if(r.error.code==='42501')this.revoke();else this.onStatus((t("wall_device.reconnecting_to_the_family")));return}
   this.device=r.data.device;this.onStatus('');this.onSnapshot(r.data)
  })().finally(()=>{this.pending=null})
  return this.pending
 }
 async rename(name){const r=await this.client.rpc('manage_wall_device',{p_device_id:this.device.id,p_action:'name',p_name:name});if(r.error)throw Error((t("wall_device.the_name_could_not_be_saved")));await this.refresh()}
 async complete({itemId,dueDate,personId=null,done=true,action='complete'}){
  const r=await this.client.rpc('complete_task_as_device',{p_request_id:crypto.randomUUID(),p_item_id:itemId,p_due_date:dueDate,p_person_id:personId,p_done:done,p_action:action})
  if(r.error)throw Error((t("wall_device.the_task_could_not_be_updated")+" ")+r.error.message)
  await this.refresh();return r.data
 }
 revoke(){this.stop();this.device=null;this.onRevoked()}
 stop(){this.generation++;clearInterval(this.timer);this.timer=null;if(this.channel)void this.client.removeChannel(this.channel);this.channel=null}
}
