import { rewardLevel, taskEmoji } from './task-rewards.js'
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
export class CelebrationPopup {
  constructor({people,avatar}) {
    this.people=people;this.avatar=avatar;this.queue=[];this.current=null
    this.root=document.createElement('div');this.root.id='celebration-root';document.body.append(this.root)
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.current)this.close()})
  }
  add(claims){this.queue.push(...claims);if(!this.current)this.showNext()}
  reset(){clearTimeout(this.timer);this.queue=[];this.current=null;this.root.innerHTML=''}
  close(){clearTimeout(this.timer);this.current=null;this.root.innerHTML='';this.showNext()}
  showNext(){
    this.current=this.queue.shift();if(!this.current)return
    const claim=this.current,person=this.people().find(p=>p.id===claim.person_id)||{name:'Person'}
    this.root.innerHTML='<div class="celebration-backdrop" role="dialog" aria-modal="true" aria-labelledby="celebration-title">'+
      '<div class="celebration-card"><button id="celebration-close" class="icon-button" aria-label="Luk fejring">×</button>'+
      this.avatar(person,'celebration-avatar')+'<p>'+escape(person.name)+'</p><h2 id="celebration-title">'+rewardLevel(claim.threshold)+'</h2>'+
      '<p>'+claim.completed_count+' udførte opgaver · uge '+claim.iso_week+' · '+claim.iso_year+'</p><ul>'+
      claim.tasks.slice(0,6).map(title=>'<li>'+taskEmoji(title)+' '+escape(title)+'</li>').join('')+'</ul></div>'+
      '<div class="confetti" aria-hidden="true">'+Array.from({length:24},(_,i)=>'<i style="--i:'+i+';--color:'+['#f59e0b','#a78bfa','#34d399','#38bdf8'][i%4]+'"></i>').join('')+'</div></div>'
    this.root.querySelector('#celebration-close').onclick=()=>this.close()
    this.root.querySelector('.celebration-backdrop').onclick=event=>{if(event.target===event.currentTarget)this.close()}
    this.timer=setTimeout(()=>this.close(),6500)
  }
}
