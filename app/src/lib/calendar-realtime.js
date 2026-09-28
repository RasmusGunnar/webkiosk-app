// One household-scoped subscription. Only revision counters travel over the channel.
// Reload on subscribe/reconnect to close the initial-query/subscription gap.
export function calendarRealtime(client, refresh, status=()=>{}) {
  let householdId=null, channel=null, generation=0, timer=null, runningEpoch=null, dirty=false
  async function flush(epoch) {
    if (epoch!==generation || runningEpoch===epoch) return
    runningEpoch=epoch
    try {
      while (dirty && epoch===generation) { dirty=false; await refresh() }
    } finally { if(runningEpoch===epoch) runningEpoch=null; if(dirty && epoch===generation) schedule(epoch) }
  }
  function schedule(epoch) {
    if(epoch!==generation) return
    dirty=true; clearTimeout(timer)
    timer=setTimeout(()=>void flush(epoch).catch(()=>{if(epoch===generation)status('REFRESH_ERROR')}),120)
  }
  function stop() {
    generation++; clearTimeout(timer); dirty=false; householdId=null
    if(channel) void client.removeChannel(channel)
    channel=null
  }
  return {
    start(id) {
      if (householdId===id) return
      stop(); if(!id) return
      householdId=id; const epoch=generation
      channel=client.channel('calendar:'+id).on('postgres_changes',{
        event:'*',schema:'public',table:'calendar_revisions',filter:'household_id=eq.'+id,
      },()=>schedule(epoch)).on('system', {}, message=>{
        if(epoch!==generation || message.extension!=='postgres_changes') return
        if(message.status==='ok') { status('SUBSCRIBED'); schedule(epoch) }
        else status('CHANNEL_ERROR')
      }).subscribe(state=>{
        if(epoch!==generation) return
        status(state)
        if(state==='SUBSCRIBED') schedule(epoch)
      })
    },
    refresh(){if(householdId) schedule(generation)},
    stop,
  }
}
