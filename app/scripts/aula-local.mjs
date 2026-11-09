import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname,join} from 'node:path'
import {createClient} from '@supabase/supabase-js'
export const appRoot=fileURLToPath(new URL('../',import.meta.url))
export const reviewRoot=fileURLToPath(new URL('../../supabase/.temp/aula-integration-10/',import.meta.url))
export const stackRoot=fileURLToPath(new URL('../../supabase/.temp/aula-integration-10/local-stack/',import.meta.url))
export const npxCli=join(dirname(process.execPath),'node_modules/npm/bin/npx-cli.js')
export function localEnvironment(){
 const config=readFileSync(new URL('../../supabase/.temp/aula-integration-10/local-stack/supabase/config.toml',import.meta.url),'utf8')
 if(!config.includes('project_id = "familiekalender-aula-10"')||!config.includes('port = 49321'))throw Error('Isolated Aula stack is not configured')
 const stdout=execFileSync(process.execPath,[npxCli,'--yes','supabase@2.115.0','status','--workdir',stackRoot,'-o','json'],{cwd:appRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']})
 const local=JSON.parse(stdout)
 if(local.API_URL!=='http://127.0.0.1:49321')throw Error('Refusing non-local Supabase')
 if(process.platform!=='win32')throw Error('Use a reviewed local secret store on this platform')
 const protectedValues=execFileSync('powershell.exe',['-NoProfile','-File',fileURLToPath(new URL('./aula-local-secrets.ps1',import.meta.url)),'-StateDirectory',reviewRoot.replace(/[\\/]$/,'')],{encoding:'utf8',stdio:['ignore','pipe','pipe']})
 const values=JSON.parse(protectedValues)
 return {...values,SUPABASE_URL:local.API_URL,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,VITE_SUPABASE_URL:local.API_URL,VITE_SUPABASE_PUBLISHABLE_KEY:local.PUBLISHABLE_KEY||local.ANON_KEY,VITE_SUPABASE_ANON_KEY:local.ANON_KEY}
}
export async function localFixture(env){
 const db=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
 const email='aula-review@example.invalid'
 const users=await db.auth.admin.listUsers();if(users.error)throw Error('LOCAL_AUTH_UNAVAILABLE')
 let user=users.data.users.find(u=>u.email===email)
 if(!user){const created=await db.auth.admin.createUser({email,password:env.LOCAL_FIXTURE_PASSWORD,email_confirm:true});if(created.error)throw Error('LOCAL_FIXTURE_USER_FAILED');user=created.data.user}
 const client=createClient(env.SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
 const auth=await client.auth.signInWithPassword({email,password:env.LOCAL_FIXTURE_PASSWORD});if(auth.error)throw Error('LOCAL_FIXTURE_LOGIN_FAILED')
 let household=(await client.from('households').select('*').limit(1)).data?.[0]
 if(!household){const created=await client.rpc('create_household',{p_name:'Familien · Aula review'});if(created.error)throw Error('LOCAL_FIXTURE_HOUSEHOLD_FAILED');household=(await client.from('households').select('*').limit(1)).data?.[0]}
 if(!household)throw Error('LOCAL_FIXTURE_HOUSEHOLD_MISSING')
 let people=(await client.from('household_people').select('*').eq('household_id',household.id)).data??[]
 if(!people.length){const inserted=await client.from('household_people').insert([{name:'Forælder',role:'adult',color:'#7b8e81'},{name:'Carl',role:'child',color:'#6f8e72'},{name:'Ida',role:'child',color:'#b89077'},{name:'Jakob',role:'child',color:'#7f95ac'}].map(p=>({...p,household_id:household.id}))).select();if(inserted.error)throw Error('LOCAL_FIXTURE_PEOPLE_FAILED');people=inserted.data}
 return {db,client,household,people,session:auth.data.session,user}
}
