import {readFileSync} from 'node:fs'
// Management API: deliberately narrow patch; token stays in process memory.
const token=process.env.SUPABASE_ACCESS_TOKEN
if(!token)throw Error('Provide SUPABASE_ACCESS_TOKEN from your secure environment; never commit it.')
const url='https://api.supabase.com/v1/projects/oyyqniwppytipdktzwsy/config/auth'
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'}
const read=await fetch(url,{headers})
if(!read.ok)throw Error('Cannot read Auth configuration: HTTP '+read.status)
const before=await read.json()
console.log(JSON.stringify({site_url:before.site_url,custom_smtp:Boolean(before.smtp_host),leaked_password_protection:before.password_hibp_enabled}))
if(process.argv.includes('--apply')){
 const patch={password_hibp_enabled:true,password_min_length:8}
 if(process.argv.includes('--templates')){
  for(const [type,subject] of Object.entries({confirmation:'Bekræft din Familiekalender-konto',recovery:'Vælg ny adgangskode til Familiekalender',invite:'Invitation til Familiekalender',email_change:'Bekræft din nye email'})){
   const field='mailer_templates_'+type+'_content'
   if(!(field in before))throw Error('Management API template field missing: '+field)
   patch[field]=readFileSync(new URL('../supabase/templates/'+type+'.html',import.meta.url),'utf8')
   patch['mailer_subjects_'+type]=subject
  }
 }
 if(process.env.FK_SMTP_HOST){
  for(const name of ['FK_SMTP_PORT','FK_SMTP_USER','FK_SMTP_PASSWORD','FK_SMTP_FROM'])if(!process.env[name])throw Error('Missing '+name)
  const port=Number(process.env.FK_SMTP_PORT);if(![465,587,2525].includes(port))throw Error('Choose a TLS SMTP port (465, 587 or 2525).')
  Object.assign(patch,{smtp_host:process.env.FK_SMTP_HOST,smtp_port:String(port),smtp_user:process.env.FK_SMTP_USER,smtp_pass:process.env.FK_SMTP_PASSWORD,smtp_admin_email:process.env.FK_SMTP_FROM,smtp_sender_name:'Familiekalender'})
 }
 const result=await fetch(url,{method:'PATCH',headers,body:JSON.stringify(patch)})
 if(!result.ok)throw Error('Auth update failed: HTTP '+result.status)
 const after=await result.json()
 console.log(JSON.stringify({leaked_password_protection:after.password_hibp_enabled,custom_smtp:Boolean(after.smtp_host),minimum_password_length:after.password_min_length,danish_templates:process.argv.includes('--templates')&&after.mailer_subjects_confirmation==='Bekræft din Familiekalender-konto'}))
}
