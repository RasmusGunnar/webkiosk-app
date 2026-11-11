// Local browser timings only. Never include people, households, URLs or payloads.
const allowed=new Set(['app_shell_ready','cached_household_ready','people_ready','avatar_url_ready','avatar_image_ready','calendar_ready','rewards_ready','route_content_ready','task_optimistic_feedback','task_network_ack','task_final_sync','surface_render'])
const origin=globalThis.performance?.now()||0,once=new Set()
let sequence=0
export function timing(){return globalThis.performance?.now()||0}
export function measure(name,start=origin,detail={}){
 if(!allowed.has(name)||!globalThis.performance?.measure)return
 const safe=Object.fromEntries(Object.entries(detail).filter(([k,v])=>['replaced','avatar_replaced','pending'].includes(k)&&typeof v==='number'&&Number.isFinite(v)))
 try{const mark='fk:end:'+sequence++;performance.mark(mark);performance.measure('fk:'+name,{start,end:mark,detail:safe});performance.clearMarks(mark)
  const entries=performance.getEntriesByName('fk:'+name);if(entries.length>100)performance.clearMeasures('fk:'+name)
 }catch{}
}
export function ready(name){if(once.has(name))return;once.add(name);measure(name)}
export function painted(name,start){if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>measure(name,start));else measure(name,start)}
