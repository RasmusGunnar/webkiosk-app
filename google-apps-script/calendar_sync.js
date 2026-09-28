/**
 * Google Calendar sync endpoint for the Webkiosk family overview.
 *
 * Deploy as a Google Apps Script web app with the Calendar advanced service enabled.
 * The script will aggregate upcoming events from the primary calendar and any
 * selected "Other calendars" on the authenticated account.
 */
const DEFAULT_PAST_DAYS = 14;
const DEFAULT_FUTURE_DAYS = 120;
const MAX_FUTURE_DAYS = 365;
const MAX_RESULTS_PER_CALENDAR = 500;
const MAX_TOTAL_RESULTS = 4000;
const MAX_CALENDAR_RESULTS = 250;

function doGet(e) {
  const params = (e && e.parameter) || {};
  const includeParam = String(params.include || '').toLowerCase();
  const includeAll = includeParam === 'all' || includeParam === 'everything';
  const requestedIds = parseIdList(params.calendar || params.calendars || params.ids);
  const onlyRequested = requestedIds.size > 0;

  const pastDays = clamp(intParam(params.pastDays, DEFAULT_PAST_DAYS), 0, 365);
  const futureDays = clamp(intParam(params.days, DEFAULT_FUTURE_DAYS), 1, MAX_FUTURE_DAYS);
  const tz = Session.getScriptTimeZone();
  const rangeStart = startOfDay(addDays(new Date(), -pastDays), tz);
  const rangeEnd = endOfDay(addDays(new Date(), futureDays), tz);

  const calendars = collectCalendars({
    includeAll: includeAll || onlyRequested,
    requestedIds,
  });

  console.log('Calendars used:', calendars.map(function (calendar) {
    return {
      id: calendar.id,
      accessRole: calendar.accessRole,
      primary: !!calendar.primary,
      selected: calendar.selected,
    };
  }));

  const events = [];
  let total = 0;
  calendars.forEach(function (calendar) {
    const fetchOpts = {
      calendar: calendar,
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      maxResults: clamp(intParam(params.maxResults, MAX_RESULTS_PER_CALENDAR), 1, MAX_RESULTS_PER_CALENDAR),
    };
    const fetched = calendar.accessRole === 'freeBusyReader'
      ? fetchFreeBusyBlocks(fetchOpts)
      : fetchCalendarEvents(fetchOpts);
    fetched.forEach(function (event) {
      if (total < MAX_TOTAL_RESULTS) {
        events.push(event);
        total += 1;
      }
    });
  });

  events.sort(function (a, b) {
    if (a.startISO && b.startISO) {
      if (a.startISO < b.startISO) return -1;
      if (a.startISO > b.startISO) return 1;
    }
    return String(a.summary || '').localeCompare(String(b.summary || ''));
  });

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      timeMin: rangeStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      calendars: calendars.map(function (calendar) {
        return {
          id: calendar.id,
          summary: calendar.summary,
          backgroundColor: calendar.backgroundColor,
          foregroundColor: calendar.foregroundColor,
          accessRole: calendar.accessRole,
          primary: !!calendar.primary,
        };
      }),
      totalEvents: events.length,
    },
    items: events,
  };

  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function collectCalendars(opts) {
  opts = opts || {};
  const requestedIds = opts.requestedIds || new Set();
  const selectedIds = new Set();
  const result = [];
  let token;
  do {
    const response = Calendar.CalendarList.list({
      maxResults: MAX_CALENDAR_RESULTS,
      pageToken: token,
      showDeleted: false,
      showHidden: true,

    });
    const items = (response && response.items) || [];
    items.forEach(function (calendar) {
      if (!calendar || !calendar.id) {
        return;
      }
      if (isUtilityCalendar(calendar.id)) {
        return;
      }
      if (!selectedIds.has(calendar.id)) {
        result.push(calendar);
        selectedIds.add(calendar.id);
      }
    });
    token = response && response.nextPageToken;
  } while (token);

  if (requestedIds.size) {
    requestedIds.forEach(function (id) {
      if (selectedIds.has(id)) {
        return;
      }
      try {
        const calendar = Calendar.CalendarList.get(id);
        if (calendar && !selectedIds.has(calendar.id)) {
          result.push(calendar);
          selectedIds.add(calendar.id);
        }
      } catch (err) {
        console.warn('Calendar lookup failed for', id, err && err.message);
      }
    });
  }

  if (!result.length) {
    try {
      const primary = Calendar.CalendarList.get('primary');
      if (primary) {
        result.push(primary);
      }
    } catch (err) {
      console.warn('Unable to resolve primary calendar', err && err.message);
    }
  }

  return result;
}

function fetchCalendarEvents(opts) {
  const calendar = opts.calendar;
  const tz = (calendar && calendar.timeZone) || Session.getScriptTimeZone();
  const events = [];
  let token;
  do {
    const response = Calendar.Events.list(calendar.id, {
      maxResults: opts.maxResults,
      pageToken: token,
      singleEvents: true,
      showDeleted: false,
      orderBy: 'startTime',
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
    });
    const items = (response && response.items) || [];
    items.forEach(function (event) {
      if (!event || event.status === 'cancelled') {
        return;
      }
      events.push(serializeEvent(event, calendar, tz));
    });
    token = response && response.nextPageToken;
  } while (token && events.length < MAX_RESULTS_PER_CALENDAR);
  return events;
}

function fetchFreeBusyBlocks(opts) {
  const calendar = opts.calendar;
  if (!calendar || !calendar.id) {
    return [];
  }
  const calendarId = calendar.id;
  const tz = (calendar && calendar.timeZone) || Session.getScriptTimeZone();
  let busyBlocks = [];
  try {
    const response = Calendar.Freebusy.query({
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
      items: [{ id: calendarId }],
    });
    busyBlocks = (((response || {}).calendars || {})[calendarId] || {}).busy || [];
  } catch (err) {
    console.warn('FreeBusy lookup failed for', calendarId, err && err.message);
    return [];
  }

  const limit = Math.min(opts.maxResults || MAX_RESULTS_PER_CALENDAR, busyBlocks.length);
  return busyBlocks.slice(0, limit).map(function (block, index) {
    const startIso = block.start || '';
    const endIso = block.end || startIso;
    const start = startIso
      ? (startIso.indexOf('T') === -1 ? { date: startIso } : { dateTime: startIso })
      : { dateTime: opts.timeMin };
    const end = endIso
      ? (endIso.indexOf('T') === -1 ? { date: endIso } : { dateTime: endIso })
      : { dateTime: opts.timeMax };
    const freeBusyEvent = {
      id: calendarId + ':' + startIso + ':' + index,
      summary: '',
      description: '',
      location: '',
      start: start,
      end: end,
      transparency: 'opaque',
      visibility: 'private',
    };
    return serializeEvent(freeBusyEvent, calendar, tz);
  });
}

function serializeEvent(event, calendar, tz) {
  const startInfo = normalizeDateInfo(event.start || {}, tz);
  const endInfo = normalizeDateInfo(event.end || {}, tz);
  const durationMin = computeDurationMinutes(startInfo, endInfo);
  return {
    id: event.id || '',
    uid: event.iCalUID || '',
    summary: event.summary || '',
    description: event.description || '',
    location: event.location || '',
    startISO: startInfo.isoString,
    endISO: endInfo.isoString,
    date: startInfo.date,
    time: startInfo.time,
    endTime: endInfo.time,
    durationMin: durationMin,
    updated: event.updated || event.created || new Date().toISOString(),
    calendarId: calendar && calendar.id,
    calendarSummary: (calendar && (calendar.summaryOverride || calendar.summary)) || '',
    calendarPrimary: !!(calendar && calendar.primary),
    calendarBackgroundColor: calendar && calendar.backgroundColor,
    calendarForegroundColor: calendar && calendar.foregroundColor,
    recurrence: event.recurrence || [],
    recurringEventId: event.recurringEventId || '',
    originalStartTime: event.originalStartTime || null,
    creator: event.creator || null,
    organizer: event.organizer || null,
    attendees: event.attendees || null,
    reminders: event.reminders || null,
    htmlLink: event.htmlLink || '',
    hangoutLink: event.hangoutLink || '',
    conferenceData: event.conferenceData || null,
    transparency: event.transparency || '',
    visibility: event.visibility || '',
    locked: !!event.locked,
    source: event.source || null,
    colorId: event.colorId || '',
  };
}

function normalizeDateInfo(entry, tz) {
  const timeZone = entry.timeZone || entry.timezone || tz;
  const isoString = entry.dateTime || entry.date || '';
  let dateValue = '';
  let timeValue = '';
  let dateObj = null;
  if (entry.dateTime) {
    dateObj = new Date(entry.dateTime);
    dateValue = Utilities.formatDate(dateObj, timeZone, 'yyyy-MM-dd');
    timeValue = Utilities.formatDate(dateObj, timeZone, 'HH:mm');
  } else if (entry.date) {
    dateObj = Utilities.parseDate(entry.date, timeZone, 'yyyy-MM-dd');
    dateValue = Utilities.formatDate(dateObj, timeZone, 'yyyy-MM-dd');
    timeValue = '';
  }
  return {
    isoString: isoString,
    date: dateValue,
    time: timeValue,
    dateObj: dateObj,
    timeZone: timeZone,
  };
}

function computeDurationMinutes(startInfo, endInfo) {
  if (!startInfo.dateObj || !endInfo.dateObj) {
    return 0;
  }
  var diffMs = endInfo.dateObj.getTime() - startInfo.dateObj.getTime();
  if (diffMs < 0) {
    return 0;
  }
  var minutes = Math.round(diffMs / 60000);
  if (minutes === 0 && !startInfo.time) {
    return 24 * 60;
  }
  return minutes;
}

function parseIdList(raw) {
  if (!raw) {
    return new Set();
  }
  if (Array.isArray(raw)) {
    return new Set(raw.filter(Boolean).map(String));
  }
  return new Set(String(raw)
    .split(/[\s,;]+/)
    .map(function (part) { return part.trim(); })
    .filter(Boolean));
}

function intParam(value, fallback) {
  var parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function clamp(num, min, max) {
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

function addDays(date, days) {
  var result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function startOfDay(date, tz) {
  var local = new Date(Utilities.formatDate(date, tz, "yyyy-MM-dd'T'00:00:00"));
  return local;
}

function endOfDay(date, tz) {
  var local = new Date(Utilities.formatDate(date, tz, "yyyy-MM-dd'T'23:59:59"));
  local.setMilliseconds(999);
  return local;
}

function isUtilityCalendar(id) {
  if (!id) {
    return true;
  }
  var lower = id.toLowerCase();
  if (lower.indexOf('#holiday@') !== -1) {
    return true;
  }
  if (lower.indexOf('#contacts@') !== -1) {
    return true;
  }
  return false;
}
