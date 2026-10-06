export function normalizeFeedUrl(value) {
  let url
  try { url = new URL(String(value || '').trim().replace(/^webcal:\/\//i, 'https://')) } catch { throw new Error('Angiv en gyldig HTTPS-kalenderadresse.') }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) {
    throw new Error('Feed-adressen skal være en offentlig HTTPS-adresse uden loginoplysninger.')
  }
  url.hash = ''
  return url.toString()
}
export function redactFeedUrl(value) {
  try { return new URL(value).hostname + '/…' } catch { return 'Privat kalenderlink' }
}
export function feedIdOf(item) {
  return String(item.calendar_id || item.feed_id || item.calendarId || item.feedId ||
    item.data?.calendarId || item.data?.feedId || item.data?.calendar_id || item.data?.feed_id || '')
}

export function feedSyncStatus(feed,now=Date.now()) {
 if(feed.is_active===false)return 'Inaktiv · automatisk sync er sat på pause';
 if(feed.last_sync_status==='error'){
  const details={FETCH_FAILED:'Kilden svarede ikke.',INVALID_ICS:'Kilden leverede en ufuldstændig kalender.',IMPORT_LIMIT:'Kalenderen er for stor.',URL_NOT_ALLOWED:'Kalenderadressen er ikke tilladt.',IMPORT_FAILED:'Prøv Hent nu igen.'};
  return 'Kunne ikke synkronisere · '+(details[feed.last_sync_message]||'Prøv Hent nu igen.');
 }
 if(feed.last_sync_status==='syncing')return 'Synkroniserer…';
 const last=Date.parse(feed.last_sync_at),minutes=Math.max(0,Math.floor((now-last)/60000));
 if(!Number.isFinite(last))return 'Afventer første synkronisering';
 return 'Synkroniseret '+(minutes<1?'lige nu':minutes<60?'for '+minutes+' min siden':minutes<1440?'for '+Math.floor(minutes/60)+' t siden':new Date(last).toLocaleString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}));
}
