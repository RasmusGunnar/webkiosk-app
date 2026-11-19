import { execFileSync } from 'node:child_process'
import { localEnvironment } from '../app/scripts/aula-local.mjs'
export function localSupabase() {
  // Explicit opt-in for running the same regression suite on the isolated pilot stack.
  if(['aula','release'].includes(process.env.FK_TEST_STACK)){
    const local=localEnvironment();if(local.SUPABASE_URL!=='http://127.0.0.1:'+(process.env.FK_TEST_STACK==='release'?45321:49321))throw new Error('Refusing non-local pilot stack.')
    return {DB_CONTAINER:process.env.FK_TEST_STACK==='release'?'supabase_db_familiekalender-release-10':'supabase_db_familiekalender-aula-10',MAILPIT_URL:local.SUPABASE_URL.replace(/321$/,'324'),API_URL:local.SUPABASE_URL,SERVICE_ROLE_KEY:local.SUPABASE_SERVICE_ROLE_KEY,ANON_KEY:local.VITE_SUPABASE_ANON_KEY,PUBLISHABLE_KEY:local.VITE_SUPABASE_PUBLISHABLE_KEY}
  }
  const command = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', 'npx.cmd --yes supabase@2.118.0 status -o json']]
    : ['npx', ['--yes', 'supabase@2.118.0', 'status', '-o', 'json']]
  let config
  try {
    config = JSON.parse(execFileSync(command[0], command[1], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }))
  } catch { throw new Error('Start the local Familiekalender Supabase stack first.') }
  if (config.API_URL !== 'http://127.0.0.1:47321') throw new Error('Refusing to use any database except the local Familiekalender stack.')
  return {...config,DB_CONTAINER:'supabase_db_familiekalender'}
}
