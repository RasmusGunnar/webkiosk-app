import {parse} from '@babel/parser'
// Analyze literal source nodes. Used by the migration inventory and the hardcoded-UI guard.
export const domainValues=new Set(['Alle','Aktivitet','Fritidsinteresse','Opgave','Fødselsdag','Madplan','Indkøb','Andet','Barn','Voksen','Familie','Google','Aula','ICS','DKK','EUR','SEK','NOK','GBP','USD','Europe/Copenhagen'])
export function fragments(value){
 const parts=[];const add=(start,end)=>{const s=value.slice(start,end),trim=s.trim();if(!trim||!/[\p{L}]/u.test(trim)||/[<>=]/.test(trim))return;parts.push({start:start+s.indexOf(trim),end:start+s.indexOf(trim)+trim.length,text:trim})}
 if(value.includes('<')||value.includes('>')){
  for(const m of value.matchAll(/>([^<>]*)/g))add(m.index+1,m.index+1+m[1].length)
  if(/^[\s\p{L}⭐✓+·…:!?()0-9–—−]/u.test(value)&&value.includes('<'))add(0,value.indexOf('<'))
  for(const m of value.matchAll(/(?:aria-label|placeholder|title|alt)="([^"<>]*)/g)){const start=m.index+m[0].indexOf('"')+1;add(start,start+m[1].length)}
 }else if(!/[="{}]|https?:|^[.#@]|^[A-Z_\d]+$/.test(value)&&(/^[A-ZÆØÅ]/.test(value)||/[æøåÆØÅ\s]/.test(value)))add(0,value.length)
 return parts.filter((p,i)=>!parts.some((q,j)=>j<i&&q.start<=p.start&&q.end>=p.end)).sort((a,b)=>a.start-b.start)
}
export function nodes(source){
 const result=[];const visit=(n,parent,ancestors=[])=>{
  if(!n||typeof n!=='object')return
  if(['StringLiteral','TemplateElement'].includes(n.type)&&parent?.type!=='ImportDeclaration'&&!(parent?.type==='ObjectProperty'&&parent.key===n&&!parent.computed))result.push({node:n,parent,ancestors,value:n.type==='StringLiteral'?n.value:n.value.cooked||''})
  for(const [key,v]of Object.entries(n))if(!['loc','comments','extra'].includes(key)){if(Array.isArray(v))v.forEach(x=>visit(x,n,[...ancestors,n]));else if(v&&typeof v==='object')visit(v,n,[...ancestors,n])}
 };visit(parse(source,{sourceType:'module'}));return result
}
export function isDataNode({node,parent,ancestors,value}){
 if(domainValues.has(value)||(parent?.type==='BinaryExpression'&&parent.operator!=='+')||['SwitchCase','ImportDeclaration','ExportAllDeclaration'].includes(parent?.type))return true
 if(parent?.type==='ObjectProperty'&&['title','name','type','person','role','location','category','source','placeholder'].includes(parent.key?.name||parent.key?.value)&&!value.includes(' '))return true
 if(ancestors.some(n=>n.type==='VariableDeclarator'&&/^(?:PLAN_TYPES|SHOPPING_CATEGORIES|DEFAULT_|BASE_|STANDARD_TASKS|calendarItemTypes|personRoles)/.test(n.id?.name)))return true
 if(parent?.type==='CallExpression'&&['querySelector','querySelectorAll','matches','closest','getElementById','includes','startsWith','endsWith','addEventListener','removeEventListener','setAttribute','getAttribute','dispatchEvent','icon','from','eq','select','order','rpc','get','has'].includes(parent.callee?.property?.name||parent.callee?.name))return true
 return false
}
