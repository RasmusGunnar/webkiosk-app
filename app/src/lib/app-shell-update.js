import {t} from '../i18n/index.js'

// A live page does not navigate, so it needs an explicit update check. Reload only
// an idle display; other surfaces offer a normal, user-operated update button.
export function installShellUpdates({url,isWall=()=>false,canReload=()=>true,win=window,doc=document,nav=navigator,now=Date.now,reload=()=>win.location.reload(),checkMs=15*60_000,idleMs=120_000,tickMs=15_000}={}){
 if(!nav.serviceWorker)return ()=>{}
 let registration,pending=false,reloading=false,checking=false,lastCheck=0,lastActivity=now(),controlled=Boolean(nav.serviceWorker.controller),notice
 const idle=()=>now()-lastActivity>=idleMs
 const safe=()=>nav.onLine!==false&&!doc.hidden&&canReload()&&!doc.querySelector('[role="dialog"],.modal-backdrop')&&!doc.activeElement?.matches('input,textarea,select,[contenteditable="true"]')
 const apply=()=>{if(!pending||reloading||!safe())return false;reloading=true;reload();return true}
 const show=()=>{if(notice)return;notice=doc.createElement('aside');notice.className='shell-update-notice';notice.setAttribute('role','status');const label=doc.createElement('span'),button=doc.createElement('button');label.textContent=t('shell.update_ready');button.textContent=t('shell.update_now');button.type='button';button.onclick=()=>{if(!apply())label.textContent=t('shell.finish_first')};notice.append(label,button);doc.body.append(notice)}
 const changed=()=>{if(controlled){pending=true;show();if(isWall()&&idle())apply()}controlled=true}
 const activity=()=>{lastActivity=now()}
 const check=async()=>{
  if(!registration||checking||nav.onLine===false||doc.hidden||now()-lastCheck<checkMs)return
  checking=true;lastCheck=now();try{await registration.update()}catch{/* Keep the installed offline shell. */}finally{checking=false}
 }
 const tick=()=>{void check();if(pending&&isWall()&&idle())apply()}
 const resume=()=>{if(!doc.hidden)tick()}
 nav.serviceWorker.addEventListener('controllerchange',changed)
 for(const event of ['pointerdown','keydown','input','touchstart'])doc.addEventListener(event,activity,{passive:true})
 doc.addEventListener('visibilitychange',resume);win.addEventListener('pageshow',resume);win.addEventListener('online',resume)
 let disposed=false
 nav.serviceWorker.register(url,{updateViaCache:'none'}).then(r=>{if(disposed)return;registration=r;void check()}).catch(()=>{})
 const timer=win.setInterval(tick,tickMs)
 return ()=>{disposed=true;win.clearInterval(timer);notice?.remove();nav.serviceWorker.removeEventListener('controllerchange',changed);for(const event of ['pointerdown','keydown','input','touchstart'])doc.removeEventListener(event,activity);doc.removeEventListener('visibilitychange',resume);win.removeEventListener('pageshow',resume);win.removeEventListener('online',resume)}
}
