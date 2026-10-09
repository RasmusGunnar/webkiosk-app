// Dynamically imported only by a DEV build with explicit local-only review configuration.
export function reviewProvider() {
 return {available:true,userId:null,async identify(id){this.userId=id},
  async offerings(){return ['month','year'].map((id,i)=>({id,period:i?'Årligt':'Månedligt',title:'Familiekalender Familie',price:i?'499,00 kr.':'49,00 kr.',subscriptionPeriod:i?'P1Y':'P1M',trial:!i,intro:!i?{price:0,priceString:'0,00 kr.',periodNumberOfUnits:7,periodUnit:'DAY'}:null}))},
  async purchase(){},async restore(){},async manage(){}}
}
export function reviewAccess(state,role='owner') {
 const status=state==='monthly'||state==='yearly'?'active':state==='trial'?'trialing':state
 return {enabled:true,entitled:!['none','expired','pending'].includes(status),status,can_purchase:['owner','admin'].includes(role),purchaser:true,
  period_end:new Date(Date.now()+(status==='expired'?-1:30)*86400000).toISOString(),will_renew:status!=='cancelled',store:'app_store',last_verified_at:new Date().toISOString()}
}
