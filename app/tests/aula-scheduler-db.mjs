// Real local PostgreSQL, pg_cron and Vault. Every fixture and migration rolls back.
// Only net.http_post is replaced transactionally: no external request can escape.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const container='supabase_db_familiekalender-aula-10';
const migration=readFileSync(new URL('../../supabase/migrations/20261111155736_aula_automatic_scans.sql',import.meta.url),'utf8').replace(/^begin;|^commit;/gm,'');
const cases=readFileSync(new URL('./aula-scheduler-db.sql',import.meta.url),'utf8');
try{
 const installed=execFileSync('docker',['exec',container,'psql','-X','-U','postgres','-d','postgres','-tAc',"select to_regclass('private.aula_schedule_config') is not null"],{encoding:'utf8'}).trim()==='t';
 const output=execFileSync('docker',['exec','-i',container,'psql','-X','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-q'],{input:'begin;\nset local role postgres;\n'+(installed?'':migration)+'\nreset role;\n'+cases+'\nrollback;',encoding:'utf8',maxBuffer:1024*1024,stdio:['pipe','pipe','pipe']});
 console.log(output.trim());console.log('AULA SCHEDULER DATABASE PASS (all changes rolled back; no outbound HTTP)');
}catch(e){console.error(e.stderr?.toString()||e.message);process.exitCode=1;}
