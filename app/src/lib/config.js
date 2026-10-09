import {t} from '../i18n/index.js'
export function publicSupabaseConfig(env) {
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error((t("config.the_supabase_url_and_a_public_supabase_key_are_missing")))
  new URL(url)
  if (key.startsWith('sb_secret_')) throw new Error((t("config.server_keys_must_not_be_used_in_the_browser")))
  if (!key.startsWith('sb_publishable_')) {
    let claims
    try { claims = JSON.parse(atob(key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))) } catch { throw new Error((t("config.invalid_public_supabase_key"))) }
    if (claims.role !== 'anon') throw new Error((t("config.the_browser_requires_a_public_anonymous_key")))
  }
  return { url, key }
}
