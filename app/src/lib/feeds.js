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
