// The Supabase callback stays synchronous: SDK calls are deferred outside its auth lock.
export function observeSession(client, onSession, onError, schedule = fn => setTimeout(fn, 0)) {
  let generation = 0, closed = false
  const deliver = (session, event, version) => schedule(() => {
    if (!closed && version === generation) Promise.resolve(onSession(session, event)).catch(onError)
  })
  const { data } = client.auth.onAuthStateChange((event, session) => deliver(session, event, ++generation))
  const version = generation
  client.auth.getSession().then(({ data: result, error }) => {
    if (closed || version !== generation) return
    if (error) onError(error)
    else deliver(result?.session || null, 'INITIAL_SESSION', generation)
  }).catch(onError)
  return () => { closed = true; data.subscription.unsubscribe() }
}
