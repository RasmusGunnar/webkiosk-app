import {t} from '../i18n/index.js'
import {accessState} from './subscription-model.js'
export class SubscriptionAccessService {
 constructor({client,provider,onChange=()=>{},online=()=>globalThis.navigator?.onLine!==false}){Object.assign(this,{client,provider,onChange,online});this.generation=0;this.context=null;this.state=accessState();this.busy=false}
 async attach({userId,householdId,role,wall=false}) {
  const key=userId+':'+householdId
  if(this.context?.key!==key){this.generation++;this.state=accessState();this.context={key,userId,householdId,role,wall}}
  if(!this.online())return this.apply(this.state)
  let timer
  try{await Promise.race([this.provider.identify(wall?null:userId),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Provider startup timeout')),6000)})])}catch{}finally{clearTimeout(timer)}
  return this.refresh()
 }
 async detach(){this.generation++;this.context=null;this.state=accessState();await this.provider.identify(null).catch(()=>{})}
 apply(row){this.state=accessState(row,{role:this.context?.role,wall:this.context?.wall,online:this.online()});this.onChange(this.state);return this.state}
 async refresh(){
  const context=this.context,version=this.generation;if(!context)return this.state
  if(!this.online())return this.apply(this.state)
  let timer,result
  try{result=await Promise.race([
   this.client.rpc('subscription_access',{p_household_id:context.householdId}).abortSignal(AbortSignal.timeout(6500)),
   new Promise(resolve=>{timer=setTimeout(()=>resolve({error:true}),7000)})
  ])}catch{result={error:true}}finally{clearTimeout(timer)}
  if(version!==this.generation)return this.state
  if(result.error){
   // Keep only a previously verified, unexpired entitlement for this session/household on transient failure.
   const row=this.state.last_verified_at?this.state:{enabled:false,status:'unknown'}
   return this.apply({...row,reason:'unavailable'})
  }
  return this.apply(result.data)
 }
 async transact(entry,restore=false){
  if(this.busy)throw Error((t("subscription_access.wait_for_the_current_confirmation")))
  await this.refresh()
  if(!this.state.canPurchase||!this.provider.available)throw Error((t("subscription_access.an_adult_manages_subscriptions_in_the_familiekalender_app")))
  this.busy=true
  const version=this.generation,context=this.context
  try {
   const claim=await this.client.rpc('create_subscription_claim',{p_household_id:context.householdId})
   if(claim.error)throw Error(claim.error.message)
   if(version!==this.generation)throw Error((t("subscription_access.the_account_has_changed_please_try_again")))
   if(restore)await this.provider.restore();else await this.provider.purchase(entry)
   if(version!==this.generation)throw Error((t("subscription_access.the_account_has_changed_please_try_again")))
   const response=await this.client.functions.invoke('subscription-verify',{body:{household_id:context.householdId,claim_id:claim.data}})
   if(response.error)throw Error((t("subscription_access.your_purchase_is_awaiting_server_confirmation_try_restore_purchases_shortly_do_not_buy_again")))
   if(version===this.generation)this.apply(response.data.access)
   return this.state
  }finally{this.busy=false}
 }
 purchase(entry){return this.transact(entry,false)}
 restore(){return this.transact(null,true)}
}
