import {ready} from './performance.js'
// A small reconciliation boundary for the shared header, people and navigation.
// Content editors keep their existing render/focus lifecycle.
const markup=new WeakMap()
const key=node=>{if(node.nodeType!==1)return null;for(const attr of ['id','data-person-filter','data-product-route'])if(node.hasAttribute(attr))return attr+':'+node.getAttribute(attr);return null}
function patch(current,next){
 if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){current.replaceWith(next);return next}
 if(current.nodeType!==1){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return current}
 if(current.tagName==='IMG'&&current.getAttribute('src')!==next.getAttribute('src'))current.removeAttribute('data-avatar-loaded')
 for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name)&&attr.name!=='data-avatar-loaded')current.removeAttribute(attr.name)
 for(const attr of next.attributes)if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value)
 let cursor=current.firstChild
 for(const child of [...next.childNodes]){
  const id=key(child),match=id?[...current.childNodes].find(n=>key(n)===id):key(cursor||{})?null:cursor
  if(!match){current.insertBefore(child,cursor);continue}
  if(match!==cursor)current.insertBefore(match,cursor)
  const kept=patch(match,child);cursor=kept.nextSibling
 }
 while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next}
 return current
}
export function updateSharedElement(current,html){
 if(markup.get(current)===html)return current
 const template=document.createElement('template');template.innerHTML=html
 const next=template.content.firstElementChild
 if(!next)return current
 const kept=patch(current,next);markup.set(kept,html);return kept
}
export function renderDashboardShell(root,html,scope){
 const focused=document.activeElement,scroll=[]
 const template=document.createElement('template');template.innerHTML=html
 const next=template.content.querySelector('.app-shell'),previous=root.querySelector('.app-shell')
 if(previous?.dataset.shellScope===scope){
  for(const selector of ['.dashboard-header','.product-nav','#person-chipbar']){
   const current=previous.querySelector(selector),target=next.querySelector(selector)
   if(!current||!target)continue
   const scrollLeft=current.scrollLeft
   const kept=updateSharedElement(current,target.outerHTML);target.replaceWith(kept);scroll.push([kept,scrollLeft])
  }
 }
 next.dataset.shellScope=scope
 root.replaceChildren(template.content)
 ready('app_shell_ready')
 for(const [node,left]of scroll)node.scrollLeft=left
 if(focused?.isConnected&&root.contains(focused))focused.focus({preventScroll:true})
}
export function updateContent(target,html){
 if(markup.get(target)===html)return false
 markup.set(target,html)
 if(target.innerHTML===html)return false
 // Complex content owns browser state (form values, details, animations).
 // Replace that boundary from local state; cached avatar URLs still avoid I/O.
 target.innerHTML=html
 return true
}
