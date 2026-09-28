import { createClient } from '@supabase/supabase-js'
import { publicSupabaseConfig } from './config.js'

let client = null
let error = ''
try {
  const { url, key } = publicSupabaseConfig(import.meta.env)
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
} catch (cause) {
  error = cause.message
}
export const supabase = client
export const configurationError = error
