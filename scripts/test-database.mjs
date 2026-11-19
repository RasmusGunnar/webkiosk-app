// Disposable database on a fixed LOCAL container. No developer database reset.
import {execFileSync} from 'node:child_process'
import {readFileSync,readdirSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
process.chdir(fileURLToPath(new URL('../',import.meta.url)))
const container='supabase_db_familiekalender-aula-10',database='release_gate_'+randomUUID().replaceAll('-','')
const docker=(args,input)=>execFileSync('docker',['exec','-i',container,...args],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],windowsHide:true,maxBuffer:12*1024*1024})
const sql=input=>docker(['psql','-X','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],input)
docker(['createdb','-U','postgres',database])
try{
 sql(readFileSync('supabase/tests/database/bootstrap-local.sql','utf8'))
 for(const name of readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')&&!n.includes('calendar_import_cron')&&!n.includes('aula_automatic_scans')).sort()){
  try{sql(readFileSync('supabase/migrations/'+name,'utf8').replaceAll('\r\n','\n'))}catch(e){throw Error('Migration '+name+': '+e.stderr)}
 }
 console.log('PASS: application migrations applied once to fresh local PostgreSQL (cron tested separately)')
 // Legacy shared-done reward SQL predates per-person status. Current reward/allowance
 // coverage lives in tasks-people-db, stars-db and allowance-agreements-api.
 for(const name of ['foundation.sql','calendar.sql','product.sql','release.sql']){
  const input=readFileSync('supabase/tests/database/'+name,'utf8')
  try{sql(input)}catch(e){throw Error(name+': '+e.stderr)}
  console.log('PASS '+name+': '+(input.match(/select pg_temp\.(assert_true|expect_error)\(/g)||[]).length+' checks')
 }
}finally{
 // Generated exact name only, never an argument or an environment variable.
 docker(['dropdb','-U','postgres',database])
}
