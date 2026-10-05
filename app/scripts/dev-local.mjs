import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { localSupabase } from '../../scripts/local-supabase.mjs'
process.chdir(fileURLToPath(new URL('../../', import.meta.url)))
const local = localSupabase()
const portIndex = process.argv.indexOf('--port')
const port = portIndex < 0 ? 5178 : Number(process.argv[portIndex + 1])
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local dev port.')
process.env.VITE_SUPABASE_URL = local.API_URL
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = local.PUBLISHABLE_KEY || local.ANON_KEY
process.env.VITE_SUPABASE_ANON_KEY = local.ANON_KEY
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port, strictPort: true } })
await server.listen()
console.log('Local-only Familiekalender: http://127.0.0.1:' + port)
