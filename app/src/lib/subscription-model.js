import {t,dateFormatter} from '../i18n/index.js'
export const SUBSCRIPTION = Object.freeze({entitlement:'family_access',offering:'default'})
export function accessState(row={}, {role='',wall=false,online=true,now=Date.now()}={}) {
 const enabled=row.enabled===true
 const expires=Date.parse(row.period_end||'')
 const entitled=row.entitled===true && Number.isFinite(expires) && expires>now
 const status=row.status==='none'?'none':Number.isFinite(expires)&&expires<=now?'expired':row.status||'unknown'
 return {...row,enabled,entitled,status,entitlement:SUBSCRIPTION.entitlement,
  canUsePremium:!enabled||entitled,canPurchase:!wall&&online&&['owner','admin'].includes(role)&&row.can_purchase===true,
  reason:!online?'offline':entitled?'entitled':enabled?'subscription_required':'enforcement_off',wall}
}
export function statusText(state) {
 const end=state.period_end?dateFormatter({day:'numeric',month:'long'}).format(new Date(state.period_end)):''
 return {active:(t("subscription.active_family_subscription")),trialing:(t("subscription.trial_period"))+(end?(" "+t("calendar_interval.until")+" ")+end:''),grace:(t("subscription.payment_pending_the_family_still_has_access")),cancelled:(t("subscription.cancelled_access_until")+" ")+end,billing_issue:(t("subscription.check_payment_in_your_app_store")),expired:(t("subscription.subscription_expired")),pending:(t("subscription.confirming_your_subscription")),unknown:(t("subscription.subscription_status_is_waiting_for_a_connection")),none:(t("subscription.the_family_does_not_have_an_active_subscription"))}[state.status]||(t("subscription.subscription_status_pending"))
}
export function offeringPackages(offerings) {
 const offering=offerings?.all?.[SUBSCRIPTION.offering]
 return (offering?.availablePackages||[]).filter(p=>['MONTHLY','ANNUAL'].includes(p.packageType)).map(p=>({
  id:p.identifier,package:p,period:p.packageType==='ANNUAL'?(t("subscription.yearly")):(t("subscription.monthly")),title:p.product.title,
  price:p.product.priceString,subscriptionPeriod:p.product.subscriptionPeriod,intro:p.product.introPrice||null,
  // Eligibility is decided by the store, never inferred from a previous household purchase.
  trial:p.product.introPrice?.price===0
 }))
}
export function safeManagementUrl(input) {
 try{const u=new URL(input);return u.protocol==='https:'&&['apps.apple.com','play.google.com'].includes(u.hostname)&&!u.username&&!u.password?u.href:null}catch{return null}
}
export function localReviewEnabled(env,location) {
 return env.DEV===true&&env.VITE_NATIVE_REVIEW==='true'&&['localhost','127.0.0.1'].includes(location.hostname)&&['localhost','127.0.0.1'].includes(new URL(env.VITE_SUPABASE_URL).hostname)
}
