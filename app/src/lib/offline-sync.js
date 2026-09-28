import { scopeKey, safeFeedMetadata, safePeopleCache } from './local-store.js'
import { readAllRows } from './rows.js'
const emptySnapshot=()=>({items:[],people:[],feeds:[],celebrations:[]})
const token=id=>'local:'+id
export function applyBatch(rows,entry,versions=null) {
  const result=new Map(rows.map(row=>[row.id,row]))
  for(const id of entry.payload.p_delete_ids)result.delete(id)
  for(const row of entry.payload.p_upserts) {
    const existing=result.get(row.id)
    if(versions&&existing?.updated_at&&!existing.updated_at.startsWith('local:')&&existing.updated_at>versions[row.id])continue
    result.set(row.id,{...existing,...row,household_id:entry.household_id,created_by:existing?.created_by||entry.user_id,
      updated_at:versions?.[row.id]||token(entry.id)})
  }
  return [...result.values()]
}
export function coalesceToggle(previous,next) {
  if(!previous||previous.status!=='pending'||previous.action!=='toggle_done'||next.action!=='toggle_done'||previous.entity_id!==next.entity_id)return null
  const expected=new Map(previous.payload.p_expected.map(row=>[row.id,row]))
  const created=new Set(previous.payload.p_upserts.filter(row=>!expected.has(row.id)).map(row=>row.id))
  for(const row of next.payload.p_expected)if(!created.has(row.id)&&!expected.has(row.id))expected.set(row.id,row)
  const upserts=new Map(previous.payload.p_upserts.map(row=>[row.id,row]))
  for(const row of next.payload.p_upserts)upserts.set(row.id,row)
  return {...previous,payload:{...previous.payload,p_upserts:[...upserts.values()],p_expected:[...expected.values()]},queued_at:previous.queued_at}
}
export function overlaySnapshot(state) {
  let items=state.snapshot.items
  const blocked = new Set()
  for(const entry of state.queue) {
    if (entry.optimistic===false || entry.payload.p_expected.some(row=>blocked.has(row.updated_at))) blocked.add(token(entry.id))
    else items=applyBatch(items,entry)
  }
  return {...state.snapshot,items}
}
const isNetworkError=error=>!error?.code&&/fetch|network|offline|abort|timeout|load failed/i.test(error?.message||'')
export class OfflineSync {
  constructor({store,client,userId,householdId,onChange=()=>{},onCelebrations=()=>{},online=()=>navigator.onLine,lock}) {
    Object.assign(this,{store,client,userId,householdId,onChange,onCelebrations,online})
    this.writeGeneration=0
    this.key=scopeKey(userId,householdId);this.alive=true;this.state=this.empty();this.running=null;this.networkFailed=false
    this.lock=lock||((callback)=>globalThis.navigator?.locks?navigator.locks.request('sync:'+this.key,callback):callback())
    if(typeof BroadcastChannel!=='undefined'){
      this.channel=new BroadcastChannel('familiekalender-offline')
      this.channel.onmessage=event=>{if(event.data.key===this.key&&this.alive)this.reload().then(()=>this.emit(false))}
    }
  }
  empty(){return {key:this.key,user_id:this.userId,household_id:this.householdId,snapshot:emptySnapshot(),queue:[]}}
  async init(){await this.reload();this.emit();return this}
  async reload(){this.state=await this.store.get(this.key)||this.empty()}
  get view(){return overlaySnapshot(this.state)}
  emit(broadcast=true){if(!this.alive)return;this.onChange(this.view,this.state.queue,{syncing:Boolean(this.running),offline:!this.online()||this.networkFailed});if(broadcast)this.channel?.postMessage({key:this.key})}
  stop(){this.alive=false;this.channel?.close()}
  async change(transform) {
    if(!this.alive)return
    this.state=await this.store.update(this.key,current=>{if(!this.alive)return current;return transform(current||this.empty())})
    this.emit()
  }
  async snapshot(partial) {
    const clean={...partial}
    if(clean.feeds)clean.feeds=safeFeedMetadata(clean.feeds)
    if(clean.people)clean.people=safePeopleCache(clean.people)
    await this.change(state=>({...state,snapshot:{...state.snapshot,...clean},cached_at:new Date().toISOString()}))
  }
  async enqueue(payload,{action='edit',entityId=payload.p_upserts[0]?.id||payload.p_delete_ids[0]}={}) {
    if(!this.alive)return {error:new Error('Sessionen er afsluttet.')}
    const entry={id:crypto.randomUUID(),user_id:this.userId,household_id:this.householdId,action,table:'calendar_items',
      entity_id:entityId,row_id:payload.p_upserts[0]?.id||payload.p_delete_ids[0],payload,queued_at:new Date().toISOString(),status:'pending',optimistic:true}
    this.writeGeneration++
    await this.change(state=>{
      const queue=[...state.queue],last=queue.at(-1),merged=coalesceToggle(last,entry)
      if(merged){queue[queue.length-1]=merged;entry.id=merged.id}else queue.push(entry)
      return {...state,queue}
    })
    if(this.online())await this.replay()
    // An enqueue may have joined a worker just as its empty-queue read completed.
    if(this.online()&&!this.networkFailed&&this.state.queue[0]?.status==='pending')await this.replay()
    const queued=this.state.queue.find(row=>row.id===entry.id)
    return queued?.status==='conflict'||queued?.status==='error'?{error:new Error(queued.error),queued:true}:{error:null,queued:Boolean(queued)}
  }
  async replay() {
    if(!this.alive||!this.online())return
    if(this.running)return this.running
    this.networkFailed=false
    this.running=this.lock(async()=>{
      await this.reload()
      while(this.alive&&this.online()) {
        const entry=this.state.queue[0]
        if(!entry||['conflict','error'].includes(entry.status))break
        await this.change(state=>({...state,queue:state.queue.map(row=>row.id===entry.id?{...row,status:'sending'}:row)}))
        let result
        try {
          const request=this.client.rpc('sync_calendar_mutation',{p_mutation_id:entry.id,p_household_id:this.householdId,...entry.payload})
          result=await (typeof request.abortSignal==='function'?request.abortSignal(AbortSignal.timeout(12000)):request)
        }
        catch(error){result={error}}
        if(!this.alive)return
        if(result.error) {
          const network=isNetworkError(result.error)||!this.online(), conflict=result.error.message?.includes('ændret på en anden enhed')
          this.networkFailed=network
          if (!network) {
            const fresh = await readAllRows(() => this.client.from('calendar_items').select('*').eq('household_id', this.householdId).order('id'))
            if (!fresh.error && this.alive) await this.snapshot({items:fresh.data})
          }
          await this.change(state=>({...state,queue:state.queue.map(row=>row.id!==entry.id?row:{...row,status:network?'pending':conflict?'conflict':'error',
            optimistic:network,error:network?'Forbindelsen er afbrudt. Ændringen er gemt lokalt.':result.error.message})}))
          break
        }
        let currentServer = null
        if (result.data.already_applied) {
          const fresh = await readAllRows(() => this.client.from('calendar_items').select('*').eq('household_id',this.householdId).order('id'))
          if (!fresh.error) currentServer = fresh.data
        }
        this.writeGeneration++
        const versions=result.data.row_versions||{}, claims=result.data.celebrations||[]
        await this.change(state=>({
          ...state,snapshot:{...state.snapshot,items:currentServer || applyBatch(state.snapshot.items,entry,versions),
            celebrations:[...state.snapshot.celebrations,...claims.filter(c=>!state.snapshot.celebrations.some(old=>old.id===c.id))]},
          queue:state.queue.filter(row=>row.id!==entry.id).map(row=>({...row,payload:{...row.payload,p_expected:row.payload.p_expected.map(expected=>
            expected.updated_at===token(entry.id)?{...expected,updated_at:versions[expected.id]||expected.updated_at}:expected)}})),
        }))
        if(claims.length&&this.alive)this.onCelebrations(claims)
        await this.reload()
      }
    })
    this.emit()
    try{await this.running}finally{this.running=null;this.emit()}
  }
  async resolve(id,choice) {
    const entry=this.state.queue.find(row=>row.id===id)
    if(!entry)return
    if(choice==='server'){
      await this.change(state=>{
        const discarded=new Set([id])
        for(const row of state.queue)if(row.payload.p_expected.some(expected=>[...discarded].some(d=>expected.updated_at===token(d))))discarded.add(row.id)
        return {...state,queue:state.queue.filter(row=>!discarded.has(row.id))}
      })
    } else {
      const {data,error}=await readAllRows(()=>this.client.from('calendar_items').select('*').eq('household_id',this.householdId).order('id'))
      if(error)throw error
      const current=new Map(data.map(row=>[row.id,row])),newId=crypto.randomUUID()
      await this.change(state=>({...state,snapshot:{...state.snapshot,items:data},queue:state.queue.map(row=>{
        if(row.id!==id)return {...row,payload:{...row.payload,p_expected:row.payload.p_expected.map(e=>e.updated_at===token(id)?{...e,updated_at:token(newId)}:e)}}
        return {...row,id:newId,status:'pending',optimistic:true,error:null,payload:{...row.payload,
          p_expected:[...new Set([...row.payload.p_expected.map(e=>e.id),...row.payload.p_upserts.map(e=>e.id)])].filter(id=>current.has(id)).map(id=>({id,updated_at:current.get(id).updated_at})),
          p_delete_ids:row.payload.p_delete_ids.filter(id=>current.has(id))}}
      })}))
    }
    await this.replay()
  }
  async retry() {
    await this.change(state=>({...state,queue:state.queue.map(row=>row.status==='error'?{...row,status:'pending',optimistic:true}:row)}))
    await this.replay()
  }
}
