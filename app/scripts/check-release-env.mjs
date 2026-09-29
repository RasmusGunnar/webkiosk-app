import {loadEnv} from 'vite'
import {publicSupabaseConfig} from '../src/lib/config.js'
const env={...loadEnv('production',process.cwd(),''),...process.env}
const publicUrl=new URL(env.VITE_PUBLIC_APP_URL||'invalid:')
if(publicUrl.protocol!=='https:'||publicUrl.hostname==='localhost'||publicUrl.pathname!=='/'||publicUrl.search||publicUrl.hash||publicUrl.username||publicUrl.password)throw Error('Set VITE_PUBLIC_APP_URL to the final public HTTPS origin.')
const config=publicSupabaseConfig(env)
if(new URL(config.url).origin!=='https://oyyqniwppytipdktzwsy.supabase.co')throw Error('Release must use the verified Familiekalender backend.')
console.log('Release environment valid; public origin '+publicUrl.origin+'; no keys printed.')
