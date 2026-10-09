import {t} from '../i18n/index.js'
import { platform } from './platform.js'
export async function clearNativeExports({all=false,native=platform.native}={}){
 if(!native)return
 const {Filesystem,Directory}=await import('@capacitor/filesystem')
 const {files}=await Filesystem.readdir({path:'',directory:Directory.Cache})
 for(const file of files)if(/^familiekalender-export-[0-9a-f-]{36}\.json$/.test(file.name)&&(all||file.mtime<Date.now()-86400000))
  await Filesystem.deleteFile({path:file.name,directory:Directory.Cache}).catch(()=>{})
}
export async function exportFamilyData(client,householdId,{native=platform.native}={}){
 const {data,error}=await client.rpc('export_family_data',{p_household_id:householdId})
 if(error)throw Error((t("account_data.the_export_could_not_be_downloaded_connect_and_try_again")))
 const json=JSON.stringify(data,null,2),filename='familiekalender-'+new Date().toISOString().slice(0,10)+'.json'
 if(native){
  const [{Filesystem,Directory,Encoding},{Share}]=await Promise.all([import('@capacitor/filesystem'),import('@capacitor/share')])
  await clearNativeExports({native})
  const path='familiekalender-export-'+crypto.randomUUID()+'.json'
  const written=await Filesystem.writeFile({path,data:json,directory:Directory.Cache,encoding:Encoding.UTF8})
  // Share completion may precede the receiving app reading its URI on Android.
  // Keep private cache until logout or age-based cleanup on a subsequent app start/export.
  try{await Share.share({title:(t("account_data.my_family_data")),files:[written.uri],dialogTitle:(t("account_data.save_family_data"))})}
  catch(error){await Filesystem.deleteFile({path,directory:Directory.Cache}).catch(()=>{});throw error}
 }else{
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'})),link=document.createElement('a')
  link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000)
 }
 return data
}
