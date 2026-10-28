import * as icalModule from 'npm:node-ical@0.22.1';
import {ImportFailure, validateCalendarText, MAX_EVENTS} from './feed-security.ts';
const ical=(icalModule as any).default || icalModule;
const DEFAULT_TIME_ZONE='Europe/Copenhagen', DAY_MS=86400000;
const DATE_ONLY_MARKER='FAMILIEKALENDER-DATE-ONLY';
const INSTANT_MARKER='FAMILIEKALENDER-INSTANT-';
const basicDate=(v:string)=>new Date(v.slice(0,4)+'-'+v.slice(4,6)+'-'+v.slice(6,8)+'T'+v.slice(9,11)+':'+v.slice(11,13)+':'+v.slice(13,15)+'Z');

// node-ical 0.22 parses floating times and DATE values in the host timezone.
// Give floating event times the family's civil zone. Represent DATE internally
// as UTC midnight solely to preserve the calendar date on every runtime.
function prepareCalendarDates(text: string): string {
  const stack: string[] = [], lines: string[] = [];
  let dateStart = '', hasEnd = false;
  for (const line of text.replace(/\r?\n[ \t]/g,'').split(/\r?\n/)) {
    if (line.toUpperCase().startsWith('X-'+DATE_ONLY_MARKER+':')||line.toUpperCase().startsWith('X-'+INSTANT_MARKER)) continue;
    if (line==='BEGIN:VEVENT') { dateStart=''; hasEnd=false; }
    if (line==='END:VEVENT' && dateStart && !hasEnd) {
      const next=new Date(Date.UTC(Number(dateStart.slice(0,4)),Number(dateStart.slice(4,6))-1,Number(dateStart.slice(6,8))+1));
      lines.push('DTEND:'+next.toISOString().slice(0,10).replaceAll('-','')+'T000000Z');
    }
    if (line.startsWith('BEGIN:')) stack.push(line.slice(6));
    if (stack.at(-1)==='VEVENT') {
      const floatingUntil=line.startsWith('RRULE:')?line.match(/(?:[:;])UNTIL=(\d{8}T\d{6})(?:;|$)/)?.[1]:null;
      if(floatingUntil)lines.push('X-'+INSTANT_MARKER+'UNTIL:'+basicDate(floatingUntil).toISOString());
      if (/^(DTEND|DURATION)(?:;[^:]*)?:/.test(line)) hasEnd=true;
      const match=line.match(/^(DTSTART|DTEND|RECURRENCE-ID|EXDATE|RDATE)((?:;[^:]*)?):(.+)$/);
      if (match) {
        const [,property,parameters,values]=match, dates=values.split(',');
        if (dates.every(v=>/^\d{8}$/.test(v))) {
          if (property==='DTSTART') { dateStart=values; lines.push('X-'+DATE_ONLY_MARKER+':true'); }
          const remaining=parameters.replace(/;(?:VALUE|TZID)=[^;]*/gi,'');
          lines.push(property+remaining+':'+dates.map(v=>v+'T000000Z').join(','));
          continue;
        }
        if (dates.every(v=>/^\d{8}T\d{6}$/.test(v))) {
          const namedZone=parameters.match(/;TZID=("[^"]+"|[^;]+)/i)?.[1]?.replaceAll('"',''),zone=namedZone||DEFAULT_TIME_ZONE;
          if(property==='DTSTART'&&!namedZone)lines.push('X-'+INSTANT_MARKER+'FLOATING:true');
          // Keep DTSTART's original wall time for RRULE, but pin explicit values
          // to RFC 5545's first fold occurrence (node-ical picks the current offset).
          let instants: Date[] | null=null;
          try { instants=dates.map(v=>recurrenceInstant(basicDate(v),zone)); } catch { /* Let node-ical resolve supported provider-specific TZIDs. */ }
          if(instants&&['EXDATE','RDATE','RECURRENCE-ID'].includes(property)){
            lines.push(property+parameters.replace(/;TZID=("[^"]+"|[^;]+)/gi,'')+':'+instants.map(d=>d.toISOString().replaceAll('-','').replaceAll(':','').replace('.000','')).join(','));continue;
          }
          if(instants&&['DTSTART','DTEND'].includes(property))lines.push('X-'+INSTANT_MARKER+property+':'+instants[0].toISOString());
          lines.push(property+parameters+(namedZone?'':';TZID='+DEFAULT_TIME_ZONE)+':'+values);
          continue;
        }
        if(property==='DTEND'&&/^\d{8}T\d{6}Z$/.test(values))lines.push('X-'+INSTANT_MARKER+'DTEND:'+basicDate(values).toISOString());
      }
    }
    lines.push(line);
    if (line.startsWith('END:')) stack.pop();
  }
  return lines.join('\r\n');
}
type CalendarFeedRow = {
  id: string;
  household_id: string;
  source: string;
  feed_url: string;
  assigned_person_name?: string | null;
  assigned_person_id?: string | null;
  is_active?: boolean;
};

type ExtractedComponent = {
  uid: string;
  sequence: number;
  summary: string;
  description: string;
  location: string;
  status: string;
  start: Date | null;
  end: Date | null;
  recurrenceId: Date | null;
  timeZone: string;
  allDay: boolean;
  rrule: any;
  exdates: Set<string>;
  durationMs: number;
  raw: any;
};

type CalendarEntry = {
  uid: string;
  sequence: number;
  base: ExtractedComponent | null;
  overrides: Map<string, ExtractedComponent>;
  cancelledInstances: Set<string>;
  cancelled: boolean;
};

type ParsedEvent = {
  uid: string;
  sequence: number;
  summary: string;
  description: string;
  location: string;
  status: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  timeZone: string;
  recurrenceId: string | null;
  cancelled: boolean;
};

export function parseIcsEvents(text: string, range: { start: Date; end: Date }): ParsedEvent[] {
  const componentCount = validateCalendarText(text);
  try {
    // node-ical can discard a malformed component while parsing the rest. Never
    // treat that partial calendar as a complete source snapshot eligible for cleanup.
    for(const block of text.replace(/\r?\n[ \t]/g,'').split(/BEGIN:VEVENT\r?\n/i).slice(1)){
      const event=block.split(/END:VEVENT/i)[0];
      if(!/^UID:.+/m.test(event)||(!/^DTSTART(?:;[^:]*)?:.+/m.test(event)&&!/^STATUS:CANCELLED\s*$/m.test(event)))throw new ImportFailure('INVALID_ICS',422);
    }
    const parsed = ical.sync.parseICS(prepareCalendarDates(text));
    const components = Object.values(parsed).filter((component: any) => component?.type === "VEVENT") as any[];
    if (componentCount > 0 && components.length === 0) throw new ImportFailure("INVALID_ICS", 422);
    for (const component of components) {
      if (!component.uid || (!toDate(component.start) && component.status !== "CANCELLED")) throw new ImportFailure("INVALID_ICS", 422);
    }
    return getEvents(applyCalendar(parsed), range);
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    throw new ImportFailure("INVALID_ICS", 422);
  }
}

function applyCalendar(parsed: Record<string, any>): Map<string, CalendarEntry> {
  const updates = new Map<string, CalendarEntry>();

  for (const component of Object.values(parsed)) {
    if (!component || component.type !== "VEVENT" || !component.uid) {
      continue;
    }

    const data = extractComponent(component);
    let entry = updates.get(data.uid);
    if (!entry) {
      entry = {
        uid: data.uid,
        sequence: data.sequence,
        base: null,
        overrides: new Map(),
        cancelledInstances: new Set(),
        cancelled: false,
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
    if (data.status === "CANCELLED") {
      if (recurrenceKey) {
        entry.cancelledInstances.add(recurrenceKey);
      } else {
        entry.cancelled = true;
        entry.base = data;
      }
      continue;
    }

    if (data.recurrenceId) {
      if (recurrenceKey) {
        entry.overrides.set(recurrenceKey, data);
      }
      continue;
    }

    entry.base = data;
    for (const exdate of data.exdates) {
      entry.cancelledInstances.add(exdate);
    }

    const rawRecurrences = component.recurrences || {};
    for (const [key, value] of Object.entries(rawRecurrences)) {
      const overrideData = extractComponent(value);
      if(!overrideData.start && overrideData.status!=='CANCELLED')throw new ImportFailure('INVALID_ICS',422);
      const overrideKey = makeKey(overrideData.recurrenceId || toDate(key));
      if (!overrideKey) {
        continue;
      }
      if (overrideData.status === "CANCELLED") {
        entry.cancelledInstances.add(overrideKey);
      } else {
        entry.overrides.set(overrideKey, overrideData);
      }
    }
  }

  return updates;
}

function extractComponent(component: any, fallbackTimeZone = DEFAULT_TIME_ZONE): ExtractedComponent {
  const parsedStart = toDate(component.start);
  const start = toDate(component[INSTANT_MARKER+'DTSTART']) || parsedStart;
  let endRaw = toDate(component[INSTANT_MARKER+'DTEND']) || toDate(component.end);
  if(start&&parsedStart&&endRaw&&!component[INSTANT_MARKER+'DTEND'])endRaw=new Date(endRaw.getTime()+start.getTime()-parsedStart.getTime());
  const recurrenceId = toDate(component.recurrenceid);
  const durationMs = start && endRaw
    ? endRaw.getTime() - start.getTime()
    : durationToMs(component.duration);
  const end = endRaw || (start && durationMs ? new Date(start.getTime() + durationMs) : null);
  const tzCandidates = [
    component.start?.tz,
    component.start?.tzid,
    component.start?.TZID,
    component.tzid,
    component.TZID,
    fallbackTimeZone,
    DEFAULT_TIME_ZONE,
  ];
  const timeZone = tzCandidates.find((value) => typeof value === "string" && value.length) || DEFAULT_TIME_ZONE;
  const status = String(component.status || "").toUpperCase() || "CONFIRMED";
  const exdates = new Set<string>();

  if (component.exdate) {
    for (const value of Object.values(component.exdate)) {
      const date = toDate(value);
      const key = makeKey(date);
      if (key) {
        exdates.add(key);
      }
    }
  }

  return {
    uid: String(component.uid || ""),
    sequence: Number(component.sequence || 0),
    summary: component.summary || "",
    description: component.description || "",
    location: component.location || "",
    status,
    start,
    end,
    recurrenceId,
    timeZone,
    allDay: component[DATE_ONLY_MARKER] === 'true' || component.datetype === "date" || component.start?.isDate || component.start?.type === "date",
    rrule: component.rrule || null,
    exdates,
    durationMs,
    raw: component,
  };
}

const wallFormatters=new Map<string,Intl.DateTimeFormat>();
function wallTime(instant: Date, timeZone: string): Date {
  let formatter=wallFormatters.get(timeZone);
  if(!formatter){formatter=new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });wallFormatters.set(timeZone,formatter);}
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second)));
}
function recurrenceInstant(floating: Date, timeZone: string): Date {
  // Resolve both sides of a possible DST transition with IANA rules. RFC 5545:
  // use the first occurrence of an ambiguous time, and the pre-gap offset.
  const wanted=floating.getTime();
  const offsets=[...new Set([-2,0,2].map(days=>{const sample=wanted+days*DAY_MS;return wallTime(new Date(sample),timeZone).getTime()-sample;}))];
  const candidates=offsets.map(offset=>wanted-offset).sort((a,b)=>a-b);
  return new Date(candidates.find(instant=>wallTime(new Date(instant),timeZone).getTime()===wanted)??candidates.at(-1)!);
}

function getEvents(entries: Map<string, CalendarEntry>, range: { start: Date; end: Date }): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  for (const entry of entries.values()) {
    if (entry.cancelled) continue;
    if (!entry.base?.start) {
      for (const [key,component] of entry.overrides) if(!entry.cancelledInstances.has(key))pushIfInRange(events,buildEvent(entry,component,key,false),range);
      continue;
    }

    const base = entry.base;
    const exclusions = new Set(entry.cancelledInstances);

    if (base.rrule) {
      const tzid = base.rrule.origOptions?.tzid;
      const options=base.rrule.origOptions;
      const count=tzid?options.count:null;
      const until=base.raw[INSTANT_MARKER+'FLOATING']?toDate(base.raw[INSTANT_MARKER+'UNTIL']):null;
      const rule = tzid ? new base.rrule.constructor({ ...options, tzid: null, count:null, ...(options.until?{until:until||wallTime(options.until,tzid)}:{}) }) : base.rrule;
      // Include occurrences that started before the window but are still ongoing.
      const lookBehind = Math.max(DAY_MS, base.durationMs || 0) + DAY_MS;
      // RFC 5545 §3.3.10: nonexistent generated wall times do not consume COUNT.
      const validWallTime=(date:Date)=>!tzid||date.getTime()===options.dtstart.getTime()||wallTime(recurrenceInstant(date,tzid),tzid).getTime()===date.getTime();
      let counted=0;
      const occurrences = rule.between(count?new Date(options.dtstart.getTime()-1):new Date(range.start.getTime() - lookBehind), new Date(range.end.getTime() + DAY_MS), true, (date: Date, index: number) => {
        if (index >= MAX_EVENTS) throw new ImportFailure("IMPORT_LIMIT", 413);
        return !count||!validWallTime(date)||++counted<=count;
      }).filter(validWallTime);
      const seenKeys = new Set<string>();

      for (const occurrenceStart of occurrences) {
        const startDate = tzid ? recurrenceInstant(occurrenceStart, tzid) : toDate(occurrenceStart);
        const key = makeKey(startDate);
        if (!startDate || !key || seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        if (exclusions.has(key)) {
          continue;
        }

        const component = entry.overrides.get(key) || cloneOccurrence(base, startDate, startDate);
        if (component) {
          pushIfInRange(events, buildEvent(entry, component, key, false), range);
        }
      }

      for (const [key, component] of entry.overrides.entries()) {
        if (seenKeys.has(key) || exclusions.has(key)) {
          continue;
        }
        pushIfInRange(events, buildEvent(entry, component, key, false), range);
      }
      continue;
    }

    pushIfInRange(events, buildEvent(entry, base, null, false), range);
  }

  return events.sort((a, b) => new Date(a.start || 0).getTime() - new Date(b.start || 0).getTime());
}

function cloneOccurrence(base: ExtractedComponent, startDate: Date, recurrenceId: Date): ExtractedComponent | null {
  const durationMs = Number.isFinite(base.durationMs)
    ? base.durationMs
    : (base.end && base.start ? base.end.getTime() - base.start.getTime() : 0);
  let end = durationMs ? new Date(startDate.getTime() + durationMs) : null;
  if (base.allDay && base.start && base.end) {
    // DATE durations count civil days, not 24-hour blocks across a DST change.
    const days = Math.round((Date.parse(formatDate(base.end,base.timeZone)+'T12:00:00Z')-Date.parse(formatDate(base.start,base.timeZone)+'T12:00:00Z'))/DAY_MS);
    const endCivil = new Date(Date.parse(formatDate(startDate,base.timeZone)+'T00:00:00Z')+days*DAY_MS);
    end = recurrenceInstant(endCivil,base.timeZone);
  }

  return {
    ...base,
    start: new Date(startDate.getTime()),
    end,
    recurrenceId: new Date(recurrenceId.getTime()),
    rrule: null,
  };
}

function buildEvent(
  entry: CalendarEntry,
  component: ExtractedComponent,
  recurrenceKey: string | null,
  cancelled: boolean,
): ParsedEvent {
  const start = component.start ? new Date(component.start) : null;
  const end = component.end ? new Date(component.end) : null;

  return {
    uid: entry.uid,
    sequence: entry.sequence,
    summary: component.summary || "",
    description: component.description || "",
    location: component.location || "",
    status: cancelled ? "CANCELLED" : component.status || "CONFIRMED",
    start: start ? start.toISOString() : null,
    end: end ? end.toISOString() : null,
    allDay: Boolean(component.allDay),
    timeZone: component.timeZone || DEFAULT_TIME_ZONE,
    recurrenceId: recurrenceKey || (component.recurrenceId ? makeKey(component.recurrenceId) : null),
    cancelled,
  };
}

function pushIfInRange(events: ParsedEvent[], event: ParsedEvent, range: { start: Date; end: Date }) {
  if (!event.start || event.cancelled) {
    return;
  }
  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : null;
  if (overlapsRange(start, end, range.start, range.end)) {
    if (events.length >= MAX_EVENTS) throw new ImportFailure("IMPORT_LIMIT", 413);
  events.push(event);
  }
}

export function eventsToCalendarRows(events: ParsedEvent[], feed: CalendarFeedRow, userId: string) {
  const person = String(feed.assigned_person_name || "").trim() || "Alle";

  return events
    .filter((event) => event.start && !event.cancelled)
    .map((event) => {
      const start = new Date(event.start as string);
      const end = event.end ? new Date(event.end) : null;
      // Source timezone controls parsing/recurrence. Stored civil fields are
      // always displayed in Copenhagen; DATE values retain their source date.
      const displayZone=event.allDay?'UTC':DEFAULT_TIME_ZONE;
      const date = formatDate(start, displayZone);
      const time = event.allDay ? "" : formatTime(start, displayZone);
      const sourceEndDate = end ? formatDate(end, displayZone) : date;
      // RFC 5545 DATE DTEND is exclusive; convert once at the import boundary.
      const endDate = event.allDay && sourceEndDate > date
        ? new Date(Date.parse(sourceEndDate + 'T12:00:00Z') - DAY_MS).toISOString().slice(0,10) : sourceEndDate;
      const endTime = !event.allDay && end ? formatTime(end, displayZone) : null;
      const durationMin = end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)) : 0;
      const occurrenceDate = event.recurrenceId
        ? formatDate(new Date(event.recurrenceId), event.timeZone || DEFAULT_TIME_ZONE)
        : date;
      const externalKey = buildExternalKey(event, feed);
      const externalId = externalKey;
      const data = {
        title: event.summary || "(uden titel)",
        date,
        time,
        person,
        people: [person],
        personIds: feed.assigned_person_id ? [feed.assigned_person_id] : [],
        type: "Aktivitet",
        durationMin,
        endDate, endTime, allDay: event.allDay,
        sourceStart: event.start, sourceEnd: event.end, timeZone: event.timeZone || DEFAULT_TIME_ZONE, displayTimeZone: DEFAULT_TIME_ZONE,
        location: event.location || "",
        note: event.description || "",
        done: false,
        repeatWeekly: false,
        source: feed.source,
        feedId: feed.id,
        calendarId: feed.id,
        externalId,
        externalKey,
        uid: event.uid,
        occurrenceDate,
        recurrenceId: event.recurrenceId,
        seriesId: JSON.stringify([feed.source, feed.id, event.uid]),
      };

      return {
        externalKey,
        payload: {
          household_id: feed.household_id,
          title: data.title,
          date: data.date,
          time: data.time,
          end_date: data.endDate, end_time: data.endTime, all_day: data.allDay,
          person: data.person,
          person_ids: data.personIds,
          type: data.type,
          note: data.note,
          done: false,
          created_by: userId,
          source: feed.source,
          external_id: externalKey,
          calendar_id: feed.id,
          data,
        },
      };
    });
}

// Source identity must not depend on mutable event presentation or rescheduling.
export function buildExternalKey(event: Pick<ParsedEvent, 'uid' | 'recurrenceId'>, feed: Pick<CalendarFeedRow, 'id' | 'source'>): string {
  return JSON.stringify([feed.source, feed.id, event.uid, event.recurrenceId || 'single']);
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.toJSDate === "function") return toDate(value.toJSDate());
  if (typeof value.toDate === "function") return toDate(value.toDate());
  return null;
}

function durationToMs(duration: any): number {
  if (!duration) return 0;
  if (typeof duration.asMilliseconds === "function") return duration.asMilliseconds();
  if (typeof duration.toMilliseconds === "function") return duration.toMilliseconds();

  const mapping: Record<string, number> = {
    weeks: 7 * DAY_MS,
    days: DAY_MS,
    hours: 60 * 60 * 1000,
    minutes: 60 * 1000,
    seconds: 1000,
  };
  let total = 0;
  for (const [unit, factor] of Object.entries(mapping)) {
    if (duration[unit]) {
      total += Number(duration[unit]) * factor;
    }
  }
  return total;
}

function makeKey(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function overlapsRange(start: Date, end: Date | null, rangeStart: Date, rangeEnd: Date): boolean {
  const effectiveEnd = end && end > start ? end : new Date(start.getTime() + 1);
  return effectiveEnd > rangeStart && start < rangeEnd;
}

function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  return parts.find(p=>p.type==='hour')!.value+':'+parts.find(p=>p.type==='minute')!.value;
}
