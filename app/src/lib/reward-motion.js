import {RewardTransitions} from './reward-transitions.js'
import {currency} from './rewards-model.js'

export const reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false
const ease=t=>1-Math.pow(1-t,3)
const visible=el=>el&&el.getClientRects().length&&el.getBoundingClientRect().bottom>0&&el.getBoundingClientRect().top<innerHeight
const escaped=value=>CSS.escape(String(value))
const select=(attr,id)=>[...document.querySelectorAll(`[${attr}="${escaped(id)}"]`)]

// One lifecycle for every counter, bar, check and transient message. DOM renders
// may replace nodes; the current timeline continues instead of restarting.
export class RewardMotion {
 constructor({claimMilestone,getPerson=()=>null}){
  this.claimMilestone=claimMilestone;this.getPerson=getPerson;this.tracker=new RewardTransitions();this.effects=new Map();this.frame=null;this.scope=null;this.pendingChecks=new Set()
  this.root=document.createElement('div');this.root.id='reward-motion-root';this.root.setAttribute('aria-hidden','true');document.body.append(this.root)
  this.live=document.createElement('div');this.live.className='sr-only';this.live.setAttribute('role','status');this.live.setAttribute('aria-live','polite');this.live.setAttribute('aria-atomic','true');document.body.append(this.live)
  this.policy=matchMedia('(prefers-reduced-motion: reduce)');this.policyChange=()=>{if(this.policy.matches){for(const effect of this.effects.values())if(effect.kind==='number')effect.start=-Infinity;this.present()}}
  this.policy.addEventListener('change',this.policyChange)
 }
 reset(scope=null){if(this.frame)cancelAnimationFrame(this.frame);this.frame=null;this.effects.clear();this.pendingChecks.clear();this.root.replaceChildren();this.live.textContent='';this.tracker.reset();this.scope=scope;document.querySelectorAll('.reward-motion-check,.reward-motion-shine,.reward-motion-milestone').forEach(el=>el.classList.remove('reward-motion-check','reward-motion-shine','reward-motion-milestone'))}
 dispose(){this.reset();this.policy.removeEventListener('change',this.policyChange);this.root.remove();this.live.remove()}
 hydrate(state){if(!this.tracker.previous)this.tracker.hydrate(state)}
 observe(state){for(const event of this.tracker.observe(state))this.handle(event)}
 emit(event){document.dispatchEvent(new CustomEvent('reward-motion',{detail:{...event,scope:this.scope,reducedMotion:reducedMotion()}}))}
 handle(event){
  const pid=event.pid,name=this.getPerson(pid)?.name||'',prefix=name?name+': ':''
  this.emit(event)
  if(event.kind==='allowance'){
   this.clearChecks(pid)
   this.animateCount('allowance',pid,event.from.earned_minor,event.to.earned_minor,currency)
   this.animateCount('percent',pid,event.from.completion_percent,event.to.completion_percent,n=>new Intl.NumberFormat('da-DK',{maximumFractionDigits:1}).format(n)+' %')
   this.animateProgress('month',pid,event.from.completion_percent,event.to.completion_percent,100)
   this.announce(prefix+event.to.completion_percent+' % · '+currency(event.to.earned_minor)+' optjent')
   if(event.milestone){const scope=this.scope;void this.claimMilestone(pid,`${event.to.year}-${String(event.to.month).padStart(2,'0')}-01`).then(ok=>{if(ok&&scope===this.scope)this.showMilestone(pid,event.to.earned_minor)}).catch(()=>{})}
  }else if(event.kind==='balance')this.animateCount('stars',pid,event.from,event.to,n=>String(Math.round(n)))
  else if(event.kind==='stars'){this.clearChecks(pid);this.showTransientDelta({...event,text:(event.delta>0?'+':'')+event.delta+' ⭐',announcement:prefix+(event.delta>0?'+':'')+event.delta+' bonusstjerner'})}
  else if(event.kind==='goal'){
   this.animateCount('goal',pid,event.from,event.to,n=>String(Math.round(n)))
   this.animateProgress('goal',pid,event.from,event.to,event.max)
   if(event.unlocked)this.showTransientDelta({...event,text:'Du har nok ⭐ til '+event.title+'!',shine:true})
  }else if(event.kind==='task'){
   if(['completed','approved'].includes(event.status)&&['allowance','stars'].includes(event.mode)){this.pendingChecks.delete(event.taskId+':'+pid);this.clearChecks(pid);return}
   const pendingKey=event.taskId+':'+pid
   if(this.pendingChecks.delete(pendingKey))return
   this.taskCheck(event.taskId,event.status,pid,false)
  }else if(event.kind==='redemption')this.showTransientDelta({...event,text:event.status==='pending'?'Sendt til godkendelse':event.title+' · Klar 🎟️',shine:event.status==='approved'})
 }
 announce(text){this.live.textContent=text}
 animateCount(kind,pid,from,to,format){this.number('count:'+kind+':'+pid,()=>select('data-reward-count',kind+':'+pid),from,to,(el,n)=>{el.textContent=format(n);el.dataset.motionValue=String(n)})}
 animateProgress(kind,pid,from,to,max){this.number('progress:'+kind+':'+pid,()=>select('data-reward-progress',kind+':'+pid),Math.max(0,Math.min(max,from)),Math.max(0,Math.min(max,to)),(el,n)=>{el.max=max||1;el.value=n})}
 number(key,elements,from,to,paint){this.effects.set(key,{kind:'number',elements,from,to,paint,start:performance.now(),duration:reducedMotion()?0:600});this.schedule()}
 taskCheck(taskId,status,pid='',local=true){
  if(local)this.emit({kind:'task-check',key:'check:'+taskId+':'+pid,taskId,pid,status,local:true})
  if(local&&pid)this.pendingChecks.add(taskId+':'+pid)
  const text=status==='pending'?'Sendt til godkendelse':status==='completed'?'Udført ✓':status==='approved'?'Godkendt ✓':status==='open'?'Genåbnet':'Prøv igen'
  this.showTransientDelta({key:'check:'+taskId+':'+pid,taskId,pid,text,check:true,duration:650})
 }
 showMilestone(pid,minor){this.emit({kind:'milestone',key:'milestone:'+pid,pid});this.showTransientDelta({key:'milestone:'+pid,pid,text:'Du klarede månedens opgaver! '+currency(minor)+' optjent',milestone:true,duration:1500})}
 clearChecks(pid){for(const [key,effect] of this.effects)if(effect.check&&effect.pid===pid){effect.node?.remove();effect.anchor?.classList.remove('reward-motion-check');this.effects.delete(key)}}
 anchor(effect){
  const panels=(effect.pid?select('data-reward-person-panel',effect.pid):[]).filter(visible).sort((a,b)=>Number(!!b.closest('.reward-modal'))-Number(!!a.closest('.reward-modal')))
  const metric=effect.milestone?'.reward-month':effect.feedbackKind==='goal'?'.reward-goal':effect.feedbackKind==='stars'?'.reward-star-balance':null
  const focused=metric&&panels.map(p=>p.querySelector(metric)||p).find(visible)
  if(focused)return focused
  const candidates=[...(effect.taskId?select('data-reward-task',effect.taskId).concat(select('data-calendar-item',effect.taskId)):[]),...(effect.redemptionId?select('data-reward-redemption',effect.redemptionId):[]),...(effect.rewardId?select('data-reward-catalog-card',effect.rewardId):[]),...panels,...(effect.check?[...document.querySelectorAll('[data-completed-date]')]:[])]
  return candidates.find(visible)
 }
 showTransientDelta(event){
  const key='notice:'+event.key,existing=this.effects.get(key);if(existing?.node)existing.node.remove()
  const node=document.createElement('span');node.className='reward-delta'+(event.milestone?' is-milestone':'');node.textContent=event.text;node.dataset.motionKind=event.milestone?'milestone':event.kind||'task';this.root.append(node)
  const duration=event.duration|| (event.shine?1000:800)
  this.effects.set(key,{...event,kind:'notice',feedbackKind:event.kind||'task',node,start:performance.now(),duration});this.announce(event.announcement||event.text);this.schedule()
 }
 schedule(){if(!this.frame)this.frame=requestAnimationFrame(now=>{this.frame=null;this.tick(now);if(this.effects.size)this.schedule()})}
 present(){if(this.effects.size)this.schedule()}
 tick(now){
  let fallback=0;const offsets=new Map()
  for(const [key,effect] of this.effects){
   const elapsed=now-effect.start,t=effect.duration?Math.min(1,elapsed/effect.duration):1
   if(effect.kind==='number')for(const el of effect.elements())effect.paint(el,effect.from+(effect.to-effect.from)*ease(t))
   else{
    const anchor=this.anchor(effect),rect=anchor?.getBoundingClientRect(),node=effect.node
    node.hidden=!anchor
    const maxTop=Math.max(12,innerHeight-150-node.offsetHeight)
    node.style.left=Math.max(12,Math.min(innerWidth-node.offsetWidth-12,rect?.left??16))+'px'
    const offset=offsets.get(anchor)||0;offsets.set(anchor,offset+node.offsetHeight+6)
    node.style.top=Math.max(12,Math.min(maxTop,rect?rect.bottom+5+offset:80+fallback++*52))+'px'
    const reduce=reducedMotion();node.style.opacity=reduce?'1':String(Math.min(1,elapsed/120,(effect.duration-elapsed)/160));node.style.transform=reduce?'none':`translateY(${(1-Math.min(1,elapsed/180))*5}px)`
    const cls=effect.milestone?'reward-motion-milestone':effect.shine?'reward-motion-shine':'reward-motion-check'
    if(effect.anchor!==anchor){effect.anchor?.classList.remove(cls);effect.anchor=anchor}
    anchor?.classList.toggle(cls,!reduce)
    if(t>=1){node.remove();anchor?.classList.remove(cls)}
   }
   if(t>=1)this.effects.delete(key)
  }
 }
}
