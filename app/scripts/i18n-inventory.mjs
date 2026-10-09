import {parse} from '@babel/parser'
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs'
import path from 'node:path'
// Source inventory only. Runtime translations use explicit semantic t() calls, never DOM replacement.
const root=path.resolve('app/src'),out=path.resolve('supabase/.temp/i18n10');mkdirSync(out,{recursive:true})
const files=[root+'/main.js',...readdirSync(root+'/lib').filter(n=>n.endsWith('.js')&&!['native-review.js'].includes(n)).map(n=>root+'/lib/'+n)]
const inventory=[]
for(const file of files){
 const source=readFileSync(file,'utf8'),tree=parse(source,{sourceType:'module'})
 const walk=(node,parent)=>{
  if(!node||typeof node!=='object')return
  if(['StringLiteral','TemplateElement'].includes(node.type)){
   const value=node.type==='StringLiteral'?node.value:node.value.cooked
   if(value&&(/[æøåÆØÅ]/.test(value)||/[A-Z][a-z]+ [a-z]+/.test(value)||/[<>]/.test(value))&&!(parent?.type==='ImportDeclaration')&&!(parent?.type==='ObjectProperty'&&parent.key===node&&!parent.computed))
    inventory.push({file:path.relative(root,file).replaceAll('\\','/'),line:node.loc.start.line,start:node.start,end:node.end,type:node.type,parent:parent?.type,value})
  }
  for(const [key,val]of Object.entries(node)){if(['loc','extra','comments'].includes(key))continue;if(Array.isArray(val))val.forEach(n=>walk(n,node));else if(val&&typeof val==='object')walk(val,node)}
 };walk(tree)
}
writeFileSync(out+'/source-inventory.json',JSON.stringify(inventory,null,2));console.log('UI source candidates: '+inventory.length+' in '+files.length+' modules')
