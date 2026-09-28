import { createClient } from "npm:@supabase/supabase-js@2.105.4";
import * as icalModule from "npm:node-ical@0.22.1";

import { ImportFailure, fetchFeedText, allowedFeedHosts, validateCalendarText, MAX_EVENTS } from "../_shared/feed-security.ts";

const ical = (icalModule as any).default || icalModule;

const DEFAULT_TIME_ZONE = "Europe/Copenhagen";
const LOOKBEHIND_DAYS = 30;
const LOOKAHEAD_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

export function makeHandler(dependencies: {
  clientFactory?: typeof createClient;
  fetcher?: typeof fetch;
  env?: (key: string) => string | undefined;
  now?: () => Date;
} = {}) {
  const factory = dependencies.clientFactory || createClient;
  const env = dependencies.env || ((key: string) => Deno.env.get(key));
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);
    let writer: any = null, claimed: any = null;
    try {
      const authHeader = req.headers.get("Authorization") || "";
      if (!/^Bearer \S+$/i.test(authHeader)) return jsonResponse({ success: false, error: "Not authenticated" }, 401);
      const body = await req.json().catch(() => ({}));
      const feedId = String(body.feedId || "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(feedId)) return jsonResponse({ success: false, error: "Invalid feedId" }, 400);
      const url = env("SUPABASE_URL"), anon = env("SUPABASE_ANON_KEY"), service = env("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !anon || !service) throw new ImportFailure("IMPORT_FAILED", 503);
      const userClient = factory(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
      const { data: auth, error: authError } = await userClient.auth.getUser();
      if (authError || !auth?.user) return jsonResponse({ success: false, error: "Not authenticated" }, 401);
      const { data: feed, error: feedError } = await userClient.from("calendar_feeds").select("*").eq("id", feedId).single();
      if (feedError || !feed) return jsonResponse({ success: false, error: "Feed unavailable" }, 404);
      if (feed.is_active === false) return jsonResponse({ success: false, error: "Feed inactive" }, 409);
      const permission = await userClient.rpc("is_household_admin", { hid: feed.household_id, uid: auth.user.id });
      if (permission.error || permission.data !== true) return jsonResponse({ success: false, error: "Forbidden" }, 403);
      writer = factory(url, service, { auth: { persistSession: false } });
      const claim = await writer.rpc("begin_calendar_feed_import", { p_feed_id: feedId, p_actor_id: auth.user.id });
      if (claim.error || !claim.data) return jsonResponse({ success: false, error: "Feed busy or unavailable" }, 409);
      claimed = claim.data;
      const normalizedFeed = normalizeFeed(claimed as CalendarFeedRow);
      const now = dependencies.now?.() || new Date();
      const range = { start: startOfDay(new Date(now.getTime() - LOOKBEHIND_DAYS * DAY_MS)), end: endOfDay(new Date(now.getTime() + LOOKAHEAD_DAYS * DAY_MS)) };
      const text = await fetchFeedText(normalizedFeed.feed_url, {
        fetcher: dependencies.fetcher, hosts: allowedFeedHosts(env("CALENDAR_FEED_ALLOWED_HOSTS") || ""),
      });
      const events = parseIcsEvents(text, range);
      const rows = eventsToCalendarRows(events, normalizedFeed, auth.user.id);
      const result = await writer.rpc("apply_calendar_feed_import", {
        p_feed_id: claimed.id, p_actor_id: auth.user.id, p_token: claimed.import_token, p_rows: rows,
        p_range_start: formatDate(range.start, DEFAULT_TIME_ZONE), p_range_end: formatDate(range.end, DEFAULT_TIME_ZONE),
      });
      if (result.error) throw new ImportFailure("IMPORT_FAILED", 500);
      return jsonResponse({ success: true, feedId: claimed.id, ...result.data });
    } catch (error) {
      const failure = error instanceof ImportFailure ? error : new ImportFailure("IMPORT_FAILED", 500);
      if (writer && claimed) {
        const result = await writer.rpc("fail_calendar_feed_import", { p_feed_id: claimed.id, p_token: claimed.import_token, p_message: failure.code }).catch(() => ({ error: true }));
        if (result.error) return jsonResponse({ success: false, error: "IMPORT_FAILED", statusPersisted: false }, 503);
      }
      return jsonResponse({ success: false, error: failure.code }, failure.status);
    }
  };
}
if (import.meta.main) Deno.serve(makeHandler());

function normalizeFeed(feed: CalendarFeedRow): CalendarFeedRow {
  const source = String(feed.source || "ics").trim().toLowerCase();
  const normalizedSource = ["aula", "google", "ics"].includes(source) ? source : "ics";

  return {
    ...feed,
    source: normalizedSource,
    feed_url: normalizeFeedUrl(feed.feed_url),
  };
}

function normalizeFeedUrl(url: string): string {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    throw new Error("Feed URL is empty");
  }
  return trimmed.replace(/^webcal:\/\//i, "https://");
}

export function parseIcsEvents(text: string, range: { start: Date; end: Date }): ParsedEvent[] {
  const componentCount = validateCalendarText(text);
  try {
    const parsed = ical.sync.parseICS(text);
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
  const start = toDate(component.start);
  const endRaw = toDate(component.end);
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
    allDay: component.datetype === "date" || component.start?.isDate || component.start?.type === "date",
    rrule: component.rrule || null,
    exdates,
    durationMs,
    raw: component,
  };
}

function recurrenceInstant(floating: Date, timeZone: string): Date {
  // rrule's TZID output depends on the host timezone. Expand in floating wall time,
  // then resolve it explicitly so Windows development and the UTC Edge runtime agree.
  const wanted = floating.getTime();
  let instant = wanted;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const correction = wanted - wall;
    if (!correction) break;
    instant += correction;
  }
  return new Date(instant);
}

function getEvents(entries: Map<string, CalendarEntry>, range: { start: Date; end: Date }): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  for (const entry of entries.values()) {
    if (entry.cancelled || !entry.base?.start) {
      continue;
    }

    const base = entry.base;
    const exclusions = new Set(entry.cancelledInstances);

    if (base.rrule) {
      const tzid = base.rrule.origOptions?.tzid;
      const rule = tzid ? new base.rrule.constructor({ ...base.rrule.origOptions, tzid: null }) : base.rrule;
      const occurrences = rule.between(new Date(range.start.getTime() - DAY_MS), new Date(range.end.getTime() + DAY_MS), true, (_date: Date, index: number) => { if (index >= MAX_EVENTS) throw new ImportFailure("IMPORT_LIMIT", 413); return true; });
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
  const end = durationMs ? new Date(startDate.getTime() + durationMs) : null;

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
      const date = formatDate(start, event.timeZone || DEFAULT_TIME_ZONE);
      const time = event.allDay ? "" : formatTime(start, event.timeZone || DEFAULT_TIME_ZONE);
      const durationMin = end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)) : 0;
      const occurrenceDate = event.recurrenceId
        ? formatDate(new Date(event.recurrenceId), event.timeZone || DEFAULT_TIME_ZONE)
        : date;
      const externalKey = buildExternalKey(event, feed, occurrenceDate, start, end);
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
        seriesId: `${feed.source}:${event.uid}`,
      };

      return {
        externalKey,
        payload: {
          household_id: feed.household_id,
          title: data.title,
          date: data.date,
          time: data.time,
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

function buildExternalKey(
  event: ParsedEvent,
  feed: CalendarFeedRow,
  occurrenceDate: string,
  start: Date,
  end: Date | null,
): string {
  const startTime = start.toISOString();
  const endTime = end ? end.toISOString() : "";
  const titleLocationHash = stableHash(`${event.summary || ""}|${event.location || ""}`);

  return [
    feed.source,
    feed.id,
    event.uid,
    occurrenceDate,
    startTime,
    endTime,
    titleLocationHash,
  ].map(normalizeExternalKeyPart).join(":");
}

function normalizeExternalKeyPart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[:|]/g, "-");
}

function stableHash(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
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
  const effectiveEnd = end || start;
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
  return new Intl.DateTimeFormat("da-DK", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function mustGetEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch (_) {
    return "Unknown error";
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
