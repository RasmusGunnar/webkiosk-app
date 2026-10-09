// Explicit DEV-only review server. dev-local independently enforces a loopback Supabase target.
process.env.VITE_NATIVE_REVIEW='true'
if(!process.argv.includes('--port'))process.argv.push('--port','5185')
await import('./dev-local.mjs')
