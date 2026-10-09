import { execFileSync } from 'node:child_process'
export function localSupabase() {
  const command = process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', 'npx.cmd --yes supabase@2.118.0 status -o json']]
    : ['npx', ['--yes', 'supabase@2.118.0', 'status', '-o', 'json']]
  let config
  try {
    config = JSON.parse(execFileSync(command[0], command[1], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }))
  } catch { throw new Error('Start the local Familiekalender Supabase stack first.') }
  if (config.API_URL !== 'http://127.0.0.1:47321') throw new Error('Refusing to use any database except the local Familiekalender stack.')
  return config
}
