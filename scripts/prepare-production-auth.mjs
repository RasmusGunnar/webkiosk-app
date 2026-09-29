// Generates a narrow, reviewable CLI profile. Never writes to the live service.
import {mkdirSync,writeFileSync,copyFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
process.chdir(fileURLToPath(new URL('../',import.meta.url)))
const base=new URL(process.argv[2]||process.env.VITE_PUBLIC_APP_URL||'invalid:')
if(base.protocol!=='https:'||base.hostname==='localhost'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('Provide the FINAL public HTTPS origin, without path or credentials.')
const dir='supabase/.temp/production-auth/supabase'
mkdirSync(dir+'/templates',{recursive:true})
const redirects=[base.origin,base.origin+'/auth/callback',base.origin+'/invite','familiekalender://auth/callback',...['localhost','127.0.0.1'].flatMap(host=>[5173,5178,5179].flatMap(port=>['http://'+host+':'+port,'http://'+host+':'+port+'/**']))]
let config='# Generated narrow production Auth profile. Review diff before push.\nproject_id = "familiekalender"\n[auth]\nsite_url = '+JSON.stringify(base.origin)+'\nadditional_redirect_urls = '+JSON.stringify(redirects)+'\nminimum_password_length = 8\n[auth.email]\nenable_confirmations = true\n'
for(const [type,subject] of Object.entries({confirmation:'Bekræft din Familiekalender-konto',recovery:'Vælg ny adgangskode til Familiekalender',invite:'Invitation til Familiekalender',email_change:'Bekræft din nye email'})){
 copyFileSync('supabase/templates/'+type+'.html',dir+'/templates/'+type+'.html')
 config+='\n[auth.email.template.'+type+']\nsubject = '+JSON.stringify(subject)+'\ncontent_path = "./supabase/templates/'+type+'.html"\n'
}
writeFileSync(dir+'/config.toml',config)
console.log('Prepared '+dir+'/config.toml')
console.log('Review: npx supabase@2.118.0 config diff --workdir supabase/.temp/production-auth --project-ref oyyqniwppytipdktzwsy')
console.log('Apply after URL verification: npx supabase@2.118.0 config push --workdir supabase/.temp/production-auth --project-ref oyyqniwppytipdktzwsy')
