import {t} from '../i18n/index.js'
import {platform} from './platform.js'
import {offeringPackages,safeManagementUrl} from './subscription-model.js'
export class RevenueCatProvider {
 constructor({sdk=null,device=platform,env=import.meta.env||{}}={}){Object.assign(this,{sdk,device,env});this.userId=null;this.configured=false;this.serial=Promise.resolve()}
 get available(){return this.device.isNative&&Boolean(this.device.isIOS?this.env.VITE_REVENUECAT_IOS_API_KEY:this.env.VITE_REVENUECAT_ANDROID_API_KEY)}
 identify(userId){
  this.serial=this.serial.catch(()=>{}).then(async()=>{
   if(!this.available){this.userId=null;return}
   if(!this.sdk)this.sdk=(await import('@revenuecat/purchases-capacitor')).Purchases
   if(this.userId===userId)return
   if(!userId){this.userId=null;if(this.configured)await this.sdk.logOut();return}
   if(!/^[0-9a-f-]{36}$/i.test(userId))throw Error((t("subscription_provider.invalid_subscription_account")))
   const apiKey=this.device.isIOS?this.env.VITE_REVENUECAT_IOS_API_KEY:this.env.VITE_REVENUECAT_ANDROID_API_KEY
   if(!apiKey.startsWith(this.device.isIOS?'appl_':'goog_'))throw Error((t("subscription_provider.revenuecat_public_sdk_key_is_missing")))
   await this.sdk.setLogLevel({level:'ERROR'})
   if(!this.configured){await this.sdk.configure({apiKey,appUserID:userId});this.configured=true}else await this.sdk.logIn({appUserID:userId})
   this.userId=userId
  });return this.serial
 }
 async offerings(){await this.serial;if(!this.available||!this.userId)return [];return offeringPackages(await this.sdk.getOfferings())}
 async purchase(entry){await this.serial;if(!this.userId)throw Error((t("subscription_provider.sign_in_again")));return this.sdk.purchasePackage({aPackage:entry.package})}
 async restore(){await this.serial;if(!this.userId)throw Error((t("subscription_provider.sign_in_again")));return this.sdk.restorePurchases()}
 async manage(){const {customerInfo}=await this.sdk.getCustomerInfo();const url=safeManagementUrl(customerInfo.managementURL);if(!url)throw Error((t("subscription_provider.open_subscriptions_in_the_app_store_where_you_made_the_purchase")));window.open(url,'_system','noopener')}
}
