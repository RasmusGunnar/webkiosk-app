import {t,relativeTime,formatDate} from '../i18n/index.js'
export function normalizeFeedUrl(value) {
  let url
  try { url = new URL(String(value || '').trim().replace(/^webcal:\/\//i, 'https://')) } catch { throw new Error((t("feeds.enter_a_valid_https_calendar_address"))) }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) {
    throw new Error((t("feeds.the_feed_must_be_a_public_https_address_without_credentials")))
  }
  url.hash = ''
  return url.toString()
}
export function redactFeedUrl(value) {
  try { return new URL(value).hostname + '/…' } catch { return (t("feeds.private_calendar_link")) }
}
export function feedIdOf(item) {
  return String(item.calendar_id || item.feed_id || item.calendarId || item.feedId ||
    item.data?.calendarId || item.data?.feedId || item.data?.calendar_id || item.data?.feed_id || '')
}

export function feedSyncStatus(feed,now=Date.now()) {
 if(feed.is_active===false)return (t("feeds.inactive_automatic_sync_is_paused"));
 if(feed.last_sync_status==='error'){
  const details={FETCH_FAILED:(t("feeds.the_source_did_not_respond")),INVALID_ICS:(t("feeds.the_source_returned_an_incomplete_calendar")),IMPORT_LIMIT:(t("feeds.the_calendar_is_too_large")),URL_NOT_ALLOWED:(t("feeds.this_calendar_address_is_not_allowed")),IMPORT_FAILED:(t("feeds.try_fetch_now_again"))};
  return (t("feeds.could_not_sync")+" ")+(details[feed.last_sync_message]||(t("feeds.try_fetch_now_again")));
 }
 if(feed.last_sync_status==='syncing')return (t("app.syncing"));
 const last=Date.parse(feed.last_sync_at),minutes=Math.max(0,Math.floor((now-last)/60000));
 if(!Number.isFinite(last))return (t("feeds.waiting_for_first_sync"));
 return t('feeds.synced')+' '+(minutes<60?relativeTime(-minutes,'minute'):minutes<1440?relativeTime(-Math.floor(minutes/60),'hour'):formatDate(last,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}));
}
