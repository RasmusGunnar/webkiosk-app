// One document-level controller, including dialogs rendered outside #app.
export function installDialogAccessibility(){
 const visible=el=>el.getClientRects().length>0&&!el.closest('[hidden]')
 const dialogs=()=>[...document.querySelectorAll('[role=dialog][aria-modal=true]')].filter(visible).sort((a,b)=>Number(getComputedStyle(a).zIndex||0)-Number(getComputedStyle(b).zIndex||0))
 const fields=modal=>[...modal.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(visible)
 let last=null,returnId=null,returnElement=null,lastFocused=null
 const focus=event=>{if(!last&&event.target!==document.body)lastFocused=event.target}
 document.addEventListener('focusin',focus)
 const sync=()=>{
  const modal=dialogs().at(-1)||null
  if(modal!==last){
   if(modal){if(!last){returnElement=lastFocused||document.activeElement;returnId=returnElement?.id}if(!modal.contains(document.activeElement))(fields(modal).find(el=>el.tagName==='INPUT')||fields(modal)[0]||modal).focus({preventScroll:true})}
   else{(document.getElementById(returnId)|| (returnElement?.isConnected?returnElement:null)||document.querySelector('#new-calendar-button'))?.focus({preventScroll:true})}
   last=modal;document.body.classList.toggle('has-dialog',Boolean(modal))
  }
 }
 const observer=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true})
 const key=event=>{
  const modal=dialogs().at(-1);if(!modal)return
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();modal.dispatchEvent(new CustomEvent('dismiss-dialog',{bubbles:true}));return}
  if(event.key!=='Tab')return
  const list=fields(modal),first=list[0],last=list.at(-1)
  if(!first){event.preventDefault();return}
  if(event.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))){event.preventDefault();first.focus()}
 }
 const viewport=()=>{document.documentElement.style.setProperty('--visual-height',(window.visualViewport?.height||innerHeight)+'px');document.documentElement.style.setProperty('--visual-top',(window.visualViewport?.offsetTop||0)+'px')}
 document.addEventListener('keydown',key,true);window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);viewport()
 return ()=>{observer.disconnect();document.removeEventListener('focusin',focus);document.removeEventListener('keydown',key,true);window.visualViewport?.removeEventListener('resize',viewport);window.visualViewport?.removeEventListener('scroll',viewport)}
}
