import { build, preview } from 'vite'
import { fileURLToPath } from 'node:url'
import { localSupabase } from '../../scripts/local-supabase.mjs'
process.chdir(fileURLToPath(new URL('../../',import.meta.url)))
const local=localSupabase()
process.env.VITE_SUPABASE_URL=local.API_URL
process.env.VITE_SUPABASE_PUBLISHABLE_KEY=local.PUBLISHABLE_KEY||local.ANON_KEY
process.env.VITE_SUPABASE_ANON_KEY=local.ANON_KEY
const root=fileURLToPath(new URL('../',import.meta.url))
await build({root})
if (process.argv.includes('--build-only')) process.exit(0)
await preview({root,preview:{host:'127.0.0.1',port:5179,strictPort:true}})
console.log('Local production/offline test app: http://127.0.0.1:5179')
