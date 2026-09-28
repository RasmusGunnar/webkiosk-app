import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { localSupabase } from '../../scripts/local-supabase.mjs'
process.chdir(fileURLToPath(new URL('../../', import.meta.url)))
const local = localSupabase()
process.env.VITE_SUPABASE_URL = local.API_URL
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = local.PUBLISHABLE_KEY || local.ANON_KEY
process.env.VITE_SUPABASE_ANON_KEY = local.ANON_KEY
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 5178, strictPort: true } })
await server.listen()
console.log('Local-only Familiekalender: http://127.0.0.1:5178')
