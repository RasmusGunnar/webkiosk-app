import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
process.chdir(fileURLToPath(new URL('../', import.meta.url)))
const container = 'supabase_db_familiekalender'
function sql(text) {
  try {
    const output = execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
      input: text, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
    })
    return output
  } catch (error) {
    // Isolated fixtures only. Avoid printing Node's duplicate stdout/stderr dumps.
    throw new Error('Local SQL acceptance failed:\n' + error.stderr)
  }
}
// Fixed LOCAL container: never accepts an environment/database URL.
sql('select current_database();')
const migrations = readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort()
for (const file of migrations) {
  sql(readFileSync('supabase/migrations/' + file, 'utf8'))
}
console.log('PASS: all migrations reapply successfully')
const acceptance = readFileSync('supabase/tests/database/foundation.sql', 'utf8')
// Reapply with existing fixtures inside the rollback transaction too.
const upgrade = migrations.map(file => readFileSync('supabase/migrations/' + file, 'utf8')
  .replace(/^begin;\r?$/m, '').replace(/^commit;\r?$/m, '')).join('\n')
sql(acceptance.replace('-- REAPPLY_MIGRATIONS_WITH_EXISTING_DATA', () => 'set constraints all immediate;\n'+upgrade+'\nset constraints all deferred;'))
const checks = (acceptance.match(/select pg_temp\.(assert_true|expect_error)\(/g) || []).length
console.log('PASS: ' + checks + ' local PostgreSQL RLS, RPC, identities, storage and import checks')

const calendarAcceptance = readFileSync('supabase/tests/database/calendar.sql', 'utf8')
sql(calendarAcceptance)
console.log('PASS: ' + (calendarAcceptance.match(/select pg_temp\.(assert_true|expect_error)\(/g) || []).length + ' calendar atomicity, conflict and realtime RLS checks')

const rewardsAcceptance = readFileSync('supabase/tests/database/rewards.sql', 'utf8')
sql(rewardsAcceptance)
console.log('PASS: ' + (rewardsAcceptance.match(/select pg_temp\.(assert_true|expect_error)\(/g) || []).length + ' reward, receipt and offline conflict SQL checks')

const productAcceptance=readFileSync('supabase/tests/database/product.sql','utf8')
sql(productAcceptance)
console.log('PASS: '+(productAcceptance.match(/select pg_temp\.(assert_true|expect_error)\(/g)||[]).length+' product member/privacy/invitation SQL checks')

const releaseAcceptance=readFileSync('supabase/tests/database/release.sql','utf8')
sql(releaseAcceptance)
console.log('PASS: '+(releaseAcceptance.match(/select pg_temp\.(assert_true|expect_error)\(/g)||[]).length+' release deletion, export and device RLS checks')

const rewardsV2=readFileSync('supabase/tests/database/rewards-v2.sql','utf8');sql(rewardsV2);console.log('PASS: '+(rewardsV2.match(/select pg_temp\.(assert_true|expect_error)\(/g)||[]).length+' rewards V2 month, date, snapshot and security checks')

const rewards21=readFileSync('supabase/tests/database/rewards-21.sql','utf8');sql(rewards21);console.log('PASS: '+(rewards21.match(/select pg_temp\.(assert_true|expect_error)\(/g)||[]).length+' rewards 2.1 deprecation, milestone and RLS checks')
