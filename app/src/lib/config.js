export function publicSupabaseConfig(env) {
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('VITE_SUPABASE_URL og en public Supabase-nøgle mangler.')
  new URL(url)
  if (key.startsWith('sb_secret_')) throw new Error('Servernøgler må ikke bruges i browseren.')
  if (!key.startsWith('sb_publishable_')) {
    let claims
    try { claims = JSON.parse(atob(key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))) } catch { throw new Error('Ugyldig public Supabase-nøgle.') }
    if (claims.role !== 'anon') throw new Error('Browseren kræver en public/anon-nøgle.')
  }
  return { url, key }
}
