import {spawn} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {localEnvironment,appRoot,reviewRoot,localFixture,npxCli} from './aula-local.mjs'
const local=localEnvironment()
await localFixture(local)
const config=JSON.parse(readFileSync(join(appRoot,'vercel.json'),'utf8'))
config.devCommand='node scripts/dev-aula-vite.mjs'
mkdirSync(reviewRoot,{recursive:true});const path=join(reviewRoot,'vercel-local.json');writeFileSync(path,JSON.stringify(config,null,2))
console.log('Local Aula: http://127.0.0.1:5198 — no project linking, deployment or real login started.')
// Per-process supported opt-out: Vercel's native vlt installer requires Windows
// symlink privileges. The Node CLI uses npm without changing machine settings.
const child=spawn(process.execPath,[npxCli,'--yes','vercel@61.0.0','dev','--local','--listen','127.0.0.1:5198','--local-config',path,'--queue-port','4982','--runtime-cache-port','4983','--schedules-port','4984'],{cwd:appRoot,env:{...process.env,...local,VERCEL_CLI_USE_NATIVE_BINARY:'0',VERCEL_VC_NATIVE:'',VERCEL_NODE_EXEC_PATH:process.execPath},stdio:'inherit',windowsHide:true})
child.on('exit',code=>process.exitCode=code??1)
