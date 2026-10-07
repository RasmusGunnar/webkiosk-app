// Both manual and scheduled imports use this core and the same database lease.
import { ImportFailure, fetchFeedText, allowedFeedHosts } from './feed-security.ts';
import { parseIcsEvents, eventsToCalendarRows } from './calendar-parser.ts';

export async function importCalendarFeed(writer: any, feedId: string, actorId: string | null, options: {
  fetcher?: typeof fetch; env?: (key: string) => string | undefined; now?: () => Date; cleanup?: boolean;
} = {}) {
  const claim = await writer.rpc('begin_calendar_feed_import', { p_feed_id: feedId, p_actor_id: actorId });
  if (claim.error || !claim.data) throw new ImportFailure('FEED_BUSY_OR_INACTIVE', 409);
  const feed = claim.data;
  try {
    const now = options.now?.() || new Date(), day = 86400000;
    const start = new Date(now.getTime() - 30 * day), end = new Date(now.getTime() + 365 * day);
    start.setUTCHours(0, 0, 0, 0); end.setUTCHours(23, 59, 59, 999);
    const date = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const text = await fetchFeedText(feed.feed_url, { fetcher: options.fetcher, hosts: allowedFeedHosts(options.env?.('CALENDAR_FEED_ALLOWED_HOSTS') || '') });
    const events = parseIcsEvents(text, { start, end });
    const rows = eventsToCalendarRows(events, feed, actorId || feed.sync_actor_id)
      .filter(row => row.payload.data.endDate >= date(start) && row.payload.date <= date(end));
    const result = await writer.rpc('apply_calendar_feed_import', {
      p_feed_id: feed.id, p_actor_id: actorId || feed.sync_actor_id, p_token: feed.import_token,
      p_rows: rows, p_range_start: date(start), p_range_end: date(end), p_cleanup: options.cleanup !== false,
    });
    if (result.error) throw new ImportFailure('IMPORT_FAILED', 500);
    return { success: true, feedId: feed.id, ...result.data };
  } catch (error) {
    const failure = error instanceof ImportFailure ? error : new ImportFailure('IMPORT_FAILED', 500);
    const result = await Promise.resolve(writer.rpc('fail_calendar_feed_import', { p_feed_id: feed.id, p_token: feed.import_token, p_message: failure.code })).catch(() => ({ error: true }));
    if (result.error) throw new ImportFailure('STATUS_NOT_SAVED', 503);
    throw failure;
  }
}
