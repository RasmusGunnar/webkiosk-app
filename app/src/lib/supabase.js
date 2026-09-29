import { createClient } from '@supabase/supabase-js'
import { platform } from './platform.js'
import { publicSupabaseConfig } from './config.js'

let client = null
let error = ''
let authStorageKey = ''
let cacheNamespace = ''
try {
  const { url, key } = publicSupabaseConfig(import.meta.env)
  authStorageKey = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token'
  cacheNamespace = new URL(url).origin
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, flowType: platform.native ? 'pkce' : 'implicit', detectSessionInUrl: !platform.native },
  })
} catch (cause) {
  error = cause.message
}
export const supabase = client
export const configurationError = error
export { cacheNamespace }
export function clearLocalAuth() { localStorage.removeItem(authStorageKey); localStorage.removeItem(authStorageKey+'-code-verifier') }
