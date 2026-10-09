import {readFileSync,readdirSync} from 'node:fs'
import {parseExpression} from '@babel/parser'
import {nodes,fragments,isDataNode} from './i18n-source.mjs'
import {engine} from '../src/i18n/index.js'
const root=new URL('../',import.meta.url),read=file=>readFileSync(new URL(file,root),'utf8'),errors=[]
const catalogs=['da-DK','en-GB'].map(locale=>{
 const source=read('src/i18n/locales/'+locale+'.json'),ast=parseExpression('('+source+')'),keys=new Set()
 for(const p of ast.properties){const key=p.key.value;if(keys.has(key))errors.push(locale+': duplicate '+key);keys.add(key);if(!p.value.value?.trim())errors.push(locale+': empty '+key)}
 return JSON.parse(source)
})
for(const key of new Set(catalogs.flatMap(Object.keys)))for(const [i,locale]of ['da-DK','en-GB'].entries())if(!(key in catalogs[i]))errors.push(locale+': missing '+key)
// Explicit non-UI literals: CSS selectors/classes, platform names, codes and developer diagnostics.
const technical=new Set(['SLET MIN KONTO','Dansk','English','Familiekalender','Homey','Sonos','Web','iPad / iPhone','Android','DeviceScreen','Enter','SHA-256','T12:00:00','T12:00:00Z','XXXXX-XXXXX','https://','https://…','Provider startup timeout','person-avatar recipe-avatar','is-empty','is-task','is-title-only','is-milestone','task-advanced full','task-quick-fields full','(max-width: 699px)','(display-mode: standalone)','(prefers-reduced-motion: reduce)','FÃ¸dselsdag'])
for(const file of ['src/main.js',...readdirSync(new URL('src/lib',root)).filter(n=>n.endsWith('.js')&&!['milestones.js','native-review.js'].includes(n)).map(n=>'src/lib/'+n)]){
 for(const node of nodes(read(file))){
  const {parent,value}=node
  if(parent?.type==='CallExpression'&&parent.callee?.name==='t'&&parent.arguments[0]===node.node&&!engine.exists(value)&&!engine.exists(value,{count:2}))errors.push(file+': missing key '+value)
  if(isDataNode(node))continue
  for(const {text}of fragments(value)){if(technical.has(text)||/^[Mm]\d.*[\dZz]$/.test(text))continue;errors.push(file+':'+node.node.loc.start.line+' hardcoded UI '+text)}
 }
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1}else console.log('I18N PASS: '+Object.keys(catalogs[0]).length+' keys; parity, duplicates, references and hardcoded UI guard')
