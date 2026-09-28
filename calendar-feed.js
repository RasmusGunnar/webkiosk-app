'use strict';

const ical = require('node-ical');

const DEFAULT_TIME_ZONE = 'Europe/Copenhagen';
const DEFAULT_LOOKAHEAD_DAYS = Number(process.env.CALENDAR_LOOKAHEAD_DAYS || 90);
const DEFAULT_LOOKBEHIND_DAYS = Number(process.env.CALENDAR_LOOKBEHIND_DAYS || 7);

function normalizeFeedUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Ugyldig kalender-URL');
  }
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error('Tom kalender-URL');
  }
  return trimmed.replace(/^webcal:\/\//i, 'https://');
}

function hoursToMs(hours) {
  const value = Number(hours);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Opdateringsintervallet skal være et positivt tal');
  }
  return value * 60 * 60 * 1000;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.toJSDate === 'function') {
    return toDate(value.toJSDate());
  }
  if (typeof value.toDate === 'function') {
    return toDate(value.toDate());
  }
  return null;
}

function durationToMs(duration) {
  if (!duration) return 0;
  if (typeof duration.asMilliseconds === 'function') {
    return duration.asMilliseconds();
  }
  if (typeof duration.toMilliseconds === 'function') {
    return duration.toMilliseconds();
  }
  const mapping = {
    weeks: 7 * 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    minutes: 60 * 1000,
    seconds: 1000
  };
  let total = 0;
  for (const [unit, factor] of Object.entries(mapping)) {
    if (duration[unit]) {
      total += Number(duration[unit]) * factor;
    }
  }
  return total;
}

function makeKey(date) {
  return date ? date.toISOString() : null;
}

function overlapsRange(start, end, rangeStart, rangeEnd) {
  if (!start) return false;
  const effectiveEnd = end || start;
  return effectiveEnd > rangeStart && start < rangeEnd;
}

function extractComponent(component, fallbackTimeZone = DEFAULT_TIME_ZONE) {
  const start = toDate(component.start);
  const endRaw = toDate(component.end);
  const recurrenceId = toDate(component.recurrenceid);
  const durationMs = start && endRaw ? endRaw.getTime() - start.getTime() : durationToMs(component.duration);
  const end = endRaw || (start && durationMs ? new Date(start.getTime() + durationMs) : null);
  const tzCandidates = [
    component.start?.tz,
    component.start?.tzid,
    component.start?.TZID,
    component.tzid,
    component.TZID,
    fallbackTimeZone,
    DEFAULT_TIME_ZONE
  ];
  const timeZone = tzCandidates.find((value) => typeof value === 'string' && value.length) || DEFAULT_TIME_ZONE;
  const status = (component.status || '').toString().toUpperCase() || 'CONFIRMED';
  const exdates = new Set();
  if (component.exdate) {
    for (const value of Object.values(component.exdate)) {
      const date = toDate(value);
      if (date) {
        exdates.add(makeKey(date));
      }
    }
  }
  return {
    uid: component.uid,
    sequence: Number(component.sequence || 0),
    summary: component.summary || '',
    description: component.description || '',
    location: component.location || '',
    status,
    start,
    end,
    recurrenceId,
    timeZone,
    allDay: component.datetype === 'date' || component.start?.isDate || component.start?.type === 'date',
    rrule: component.rrule || null,
    exdates,
    durationMs,
    raw: component
  };
}

function cloneOccurrence(base, startDate, recurrenceId) {
  if (!startDate) return null;
  const durationMs = typeof base.durationMs === 'number' && !Number.isNaN(base.durationMs)
    ? base.durationMs
    : (base.end && base.start ? base.end.getTime() - base.start.getTime() : 0);
  const end = durationMs ? new Date(startDate.getTime() + durationMs) : (base.end ? new Date(startDate.getTime()) : null);
  return {
    ...base,
    start: new Date(startDate.getTime()),
    end: end ? new Date(end.getTime()) : null,
    recurrenceId: recurrenceId ? new Date(recurrenceId.getTime()) : new Date(startDate.getTime()),
    rrule: null,
    raw: base.raw
  };
}

class CalendarFeed {
  constructor(options) {
    const {
      feedUrl,
      refreshIntervalHours = Number(process.env.CALENDAR_REFRESH_INTERVAL_HOURS || 6),
      lookAheadDays = DEFAULT_LOOKAHEAD_DAYS,
      lookBehindDays = DEFAULT_LOOKBEHIND_DAYS,
      timeZone = DEFAULT_TIME_ZONE
    } = options || {};

    this.feedUrl = normalizeFeedUrl(feedUrl);
    this.refreshIntervalMs = hoursToMs(refreshIntervalHours);
    const aheadDays = Number(lookAheadDays);
    const behindDays = Number(lookBehindDays);
    const dayMs = 24 * 60 * 60 * 1000;
    this.lookAheadMs = (Number.isFinite(aheadDays) ? Math.max(0, aheadDays) : DEFAULT_LOOKAHEAD_DAYS) * dayMs;
    this.lookBehindMs = (Number.isFinite(behindDays) ? Math.max(0, behindDays) : DEFAULT_LOOKBEHIND_DAYS) * dayMs;
    this.timeZone = timeZone || DEFAULT_TIME_ZONE;

    this.eventsByUid = new Map();
    this.cancelledUids = new Set();

    this.etag = null;
    this.lastModified = null;
    this.lastFetchedAt = 0;
    this.lastUpdatedAt = null;
    this.lastError = null;
    this.refreshTimer = null;
    this.refreshInFlight = null;
  }

  get info() {
    return {
      feedUrl: this.feedUrl,
      refreshIntervalHours: this.refreshIntervalMs / (60 * 60 * 1000),
      lookAheadDays: this.lookAheadMs / (24 * 60 * 60 * 1000),
      lookBehindDays: this.lookBehindMs / (24 * 60 * 60 * 1000),
      lastFetchedAt: this.lastFetchedAt,
      lastUpdatedAt: this.lastUpdatedAt,
      lastError: this.lastError ? { message: this.lastError.message } : null,
      etag: this.etag,
      lastModified: this.lastModified,
      eventCount: this.eventsByUid.size,
      cancelledCount: this.cancelledUids.size
    };
  }

  setRefreshIntervalHours(hours) {
    this.refreshIntervalMs = hoursToMs(hours);
    this.#restartTimer();
  }

  setRangeDays({ lookAheadDays, lookBehindDays }) {
    if (lookAheadDays != null) {
      const value = Number(lookAheadDays);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('lookAheadDays skal være et ikke-negativt tal');
      }
      this.lookAheadMs = value * 24 * 60 * 60 * 1000;
    }
    if (lookBehindDays != null) {
      const value = Number(lookBehindDays);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('lookBehindDays skal være et ikke-negativt tal');
      }
      this.lookBehindMs = value * 24 * 60 * 60 * 1000;
    }
  }

  async start() {
    this.#restartTimer();
    await this.refresh(true);
  }

  stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async refresh(force = false) {
    const now = Date.now();
    if (!force && now - this.lastFetchedAt < this.refreshIntervalMs) {
      return;
    }
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.#fetchAndProcess()
      .catch((err) => {
        this.lastError = err;
        throw err;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  async #fetchAndProcess() {
    if (typeof fetch !== 'function') {
      throw new Error('Fetch API er ikke tilgængelig i dette miljø');
    }
    const headers = {};
    if (this.etag) {
      headers['If-None-Match'] = this.etag;
    }
    if (this.lastModified) {
      headers['If-Modified-Since'] = this.lastModified;
    }
    const response = await fetch(this.feedUrl, { headers });
    this.lastFetchedAt = Date.now();
    if (response.status === 304) {
      return;
    }
    if (!response.ok) {
      throw new Error(`Kunne ikke hente kalender (status ${response.status})`);
    }
    this.etag = response.headers.get('etag');
    this.lastModified = response.headers.get('last-modified');
    const text = await response.text();
    const parsed = ical.sync.parseICS(text);
    this.#applyCalendar(parsed);
    this.lastUpdatedAt = Date.now();
    this.lastError = null;
  }

  #applyCalendar(parsed) {
    const updates = new Map();

    for (const component of Object.values(parsed)) {
      if (!component || component.type !== 'VEVENT' || !component.uid) {
        continue;
      }
      const data = extractComponent(component, this.timeZone);
      let entry = updates.get(data.uid);
      if (!entry) {
        entry = {
          uid: data.uid,
          sequence: data.sequence,
          base: null,
          overrides: new Map(),
          cancelledInstances: new Set(),
          cancelled: false
        };
        updates.set(data.uid, entry);
      }
      if (data.sequence > entry.sequence) {
        entry.sequence = data.sequence;
        entry.base = null;
        entry.overrides.clear();
        entry.cancelledInstances.clear();
        entry.cancelled = false;
      }
      if (data.sequence < entry.sequence) {
        continue;
      }

      const recurrenceKey = data.recurrenceId ? makeKey(data.recurrenceId) : null;
      if (data.status === 'CANCELLED') {
        if (recurrenceKey) {
          entry.cancelledInstances.add(recurrenceKey);
        } else {
          entry.cancelled = true;
          entry.base = data;
        }
        continue;
      }

      if (data.recurrenceId) {
        entry.overrides.set(recurrenceKey, data);
      } else {
        entry.base = data;
        for (const ex of data.exdates) {
          entry.cancelledInstances.add(ex);
        }
        const rawRecurrences = component.recurrences || {};
        for (const [key, value] of Object.entries(rawRecurrences)) {
          const overrideData = extractComponent(value, data.timeZone);
          const overrideKey = makeKey(overrideData.recurrenceId || toDate(key));
          if (overrideData.status === 'CANCELLED') {
            if (overrideKey) {
              entry.cancelledInstances.add(overrideKey);
            }
            continue;
          }
          if (overrideKey) {
            entry.overrides.set(overrideKey, overrideData);
          }
        }
      }
    }

    for (const [uid, entry] of updates.entries()) {
      const existing = this.eventsByUid.get(uid);
      if (!existing || entry.sequence >= existing.sequence) {
        this.eventsByUid.set(uid, entry);
        if (entry.cancelled) {
          this.cancelledUids.add(uid);
        } else {
          this.cancelledUids.delete(uid);
        }
      }
    }
  }

  getEvents(options = {}) {
    const rangeStart = options.start ? new Date(options.start) : new Date(Date.now() - this.lookBehindMs);
    const rangeEnd = options.end ? new Date(options.end) : new Date(Date.now() + this.lookAheadMs);
    const includeCancelled = Boolean(options.includeCancelled);
    const events = [];

    for (const entry of this.eventsByUid.values()) {
      if (entry.cancelled) {
        if (includeCancelled) {
          const base = entry.base;
          events.push(this.#buildEvent(entry, base || null, null, true));
        }
        continue;
      }
      const base = entry.base;
      if (!base || !base.start) {
        continue;
      }
      const exclusions = new Set(entry.cancelledInstances);

      if (base.rrule) {
        const occurrences = base.rrule.between(rangeStart, rangeEnd, true);
        const seenKeys = new Set();
        for (const occurrenceStart of occurrences) {
          const key = makeKey(toDate(occurrenceStart));
          if (!key || seenKeys.has(key)) {
            continue;
          }
          seenKeys.add(key);
          if (exclusions.has(key)) {
            if (includeCancelled) {
              const cancelledComponent = entry.overrides.get(key) || cloneOccurrence(base, toDate(occurrenceStart), toDate(occurrenceStart));
              const cancelledEvent = this.#buildEvent(entry, cancelledComponent, key, true);
              if (cancelledEvent && cancelledEvent.start) {
                const startDate = new Date(cancelledEvent.start);
                const endDate = cancelledEvent.end ? new Date(cancelledEvent.end) : null;
                if (overlapsRange(startDate, endDate, rangeStart, rangeEnd)) {
                  events.push(cancelledEvent);
                }
              }
            }
            continue;
          }
          const override = entry.overrides.get(key);
          const component = override || cloneOccurrence(base, toDate(occurrenceStart), toDate(occurrenceStart));
          if (!component) {
            continue;
          }
          const event = this.#buildEvent(entry, component, key, false);
          if (!event || !event.start) {
            continue;
          }
          const startDate = new Date(event.start);
          const endDate = event.end ? new Date(event.end) : null;
          if (overlapsRange(startDate, endDate, rangeStart, rangeEnd)) {
            events.push(event);
          }
        }
        for (const [key, component] of entry.overrides.entries()) {
          if (seenKeys.has(key) || exclusions.has(key)) {
            continue;
          }
          if (!component.start) {
            continue;
          }
          const event = this.#buildEvent(entry, component, key, false);
          if (!event || !event.start) {
            continue;
          }
          const startDate = new Date(event.start);
          const endDate = event.end ? new Date(event.end) : null;
          if (overlapsRange(startDate, endDate, rangeStart, rangeEnd)) {
            events.push(event);
          }
        }
      } else {
        const event = this.#buildEvent(entry, base, null, false);
        if (!event || !event.start) {
          continue;
        }
        const startDate = new Date(event.start);
        const endDate = event.end ? new Date(event.end) : null;
        if (overlapsRange(startDate, endDate, rangeStart, rangeEnd)) {
          events.push(event);
        }
      }
    }

    events.sort((a, b) => {
      const aTime = a.start ? new Date(a.start).getTime() : 0;
      const bTime = b.start ? new Date(b.start).getTime() : 0;
      return aTime - bTime;
    });

    return events;
  }

  #buildEvent(entry, component, recurrenceKey, cancelled) {
    if (!component) {
      return {
        uid: entry.uid,
        sequence: entry.sequence,
        status: 'CANCELLED',
        cancelled: true
      };
    }
    const start = component.start ? new Date(component.start) : null;
    const end = component.end ? new Date(component.end) : null;
    const status = cancelled ? 'CANCELLED' : component.status || 'CONFIRMED';
    return {
      uid: entry.uid,
      sequence: entry.sequence,
      summary: component.summary || '',
      description: component.description || '',
      location: component.location || '',
      status,
      start: start ? start.toISOString() : null,
      end: end ? end.toISOString() : null,
      allDay: Boolean(component.allDay),
      timeZone: component.timeZone || this.timeZone,
      recurrenceId: recurrenceKey || (component.recurrenceId ? makeKey(component.recurrenceId) : null),
      cancelled: Boolean(cancelled)
    };
  }

  #restartTimer() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.refreshTimer = setInterval(() => {
      this.refresh(true).catch((err) => {
        this.lastError = err;
      });
    }, this.refreshIntervalMs);
    if (typeof this.refreshTimer.unref === 'function') {
      this.refreshTimer.unref();
    }
  }
}

module.exports = {
  CalendarFeed,
  normalizeFeedUrl
};
