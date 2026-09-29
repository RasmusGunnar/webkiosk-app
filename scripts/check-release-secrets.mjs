// Scan all Git-visible text without printing secret values. Ignored env/build files stay excluded.
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
process.chdir(fileURLToPath(new URL('../',import.meta.url)))
const run=args=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']})
const files=[...new Set(run(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean))]
const changed=new Set([...run(['diff','--name-only','HEAD','-z']).split('\0'),...run(['ls-files','--others','--exclude-standard','-z']).split('\0')])
const findings=[]
for(const path of files){
 let buffer;try{buffer=readFileSync(path)}catch{continue}
 if(buffer.includes(0)||buffer.length>8*1024*1024)continue
 const text=buffer.toString('utf8')
 if(/(^|\/)\.env(?:\.|$)/.test(path)&&!path.endsWith('.env.example'))findings.push({path,kind:'env-file-tracked'})
 for(const match of text.matchAll(/(?:sb_secret_[A-Za-z0-9_-]{24,}|sbp_(?:oauth_|v0_)?[a-f0-9]{40}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g))findings.push({path,kind:'credential-pattern',line:text.slice(0,match.index).split('\n').length})
 for(const match of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)){
  try{if(JSON.parse(Buffer.from(match[0].split('.')[1],'base64url')).role==='service_role')findings.push({path,kind:'service-role-JWT',line:text.slice(0,match.index).split('\n').length})}catch{}
 }
 if(changed.has(path)){
  for(const match of text.matchAll(/https?:\/\/[^\s"'<>]+/g)){
   const value=match[0]
   if((/kalenderlink\.aula\.dk\/\?feed=.+/i.test(value)||/calendar\.google\.com\/calendar\/ical\/.*\/private-[a-f0-9]{16,}/i.test(value))&&!/TEST|example|YOUR|REPLACE|PLACEHOLDER|\\|\$\{/i.test(value))
    findings.push({path,kind:'private-feed-link',line:text.slice(0,match.index).split('\n').length})
  }
  if(/(?:password|smtp_pass|service_role_key)\s*[:=]\s*['"][^'"]{12,}['"]/i.test(text)&&!/tests\/|test\.|smoke\.|check-release-secrets/.test(path)){
   // Report candidates for review, never values; expressions/env lookups are not literals.
   const rows=text.split('\n')
   rows.forEach((line,index)=>{if(/(?:password|smtp_pass|service_role_key)\s*[:=]\s*['"][A-Za-z0-9!@#%]{12,}['"]/i.test(line)&&!/example|replace|test|placeholder/i.test(line))findings.push({path,kind:'credential-literal-review',line:index+1})})
  }
 }
}
if(findings.length){console.log(JSON.stringify(findings,null,2));process.exitCode=1}
else console.log('PASS: '+files.length+' Git-visible paths scanned; no actual service keys, private keys, private feed links or credential literals found in release changes.')
const staged=run(['diff','--cached','--name-only','-z']).split('\0').filter(Boolean)
const forbidden=staged.filter(path=>/(^|\/)(\.env(?:\..*)?|google-services\.json|GoogleService-Info\.plist|keystore\.properties|local\.properties)$|\.(jks|keystore|p12|mobileprovision)$/.test(path)&&!path.endsWith('.env.example'))
if(forbidden.length){console.log('FAIL: forbidden staged paths '+forbidden.join(', '));process.exitCode=1}
else console.log('PASS: staged paths contain no env, signing or provider credential files.')
