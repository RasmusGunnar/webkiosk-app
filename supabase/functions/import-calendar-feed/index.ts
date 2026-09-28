import { createClient } from "npm:@supabase/supabase-js@2";
import * as icalModule from "npm:node-ical@0.22.1";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = mustGetEnv("SUPABASE_URL");
    const anonKey = mustGetEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") || "";
    const body = await req.json().catch(() => ({}));
    const feedId = String(body.feedId || "").trim();

    if (!feedId) {
      return jsonResponse({ success: false, error: "Missing feedId" }, 400);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const writeClient = serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      : userClient;

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ success: false, error: userError?.message || "Not authenticated" }, 401);
    }

    const { data: feed, error: feedError } = await userClient
      .from("calendar_feeds")
      .select("*")
      .eq("id", feedId)
      .single();

    if (feedError || !feed) {
      return jsonResponse({ success: false, error: feedError?.message || "Feed not found" }, 404);
    }

    const normalizedFeed = normalizeFeed(feed as CalendarFeedRow);
    const rangeStart = startOfDay(new Date(Date.now() - LOOKBEHIND_DAYS * DAY_MS));
    const rangeEnd = endOfDay(new Date(Date.now() + LOOKAHEAD_DAYS * DAY_MS));
    const events = await fetchIcsEvents(normalizedFeed.feed_url, {
      start: rangeStart,
      end: rangeEnd,
    });
    const rows = eventsToCalendarRows(events, normalizedFeed, userData.user.id);
    const result = await syncRows(writeClient, normalizedFeed, rows);

    await updateFeedStatus(writeClient, normalizedFeed.id, {
      last_sync_status: `OK: ${rows.length} aftaler`,
      last_synced_at: new Date().toISOString(),
      last_import_count: rows.length,
      last_error: null,
    });

    return jsonResponse({
      success: true,
      feedId: normalizedFeed.id,
      importedCount: rows.length,
      insertedCount: result.insertedCount,
      updatedCount: result.updatedCount,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("import-calendar-feed failed", error);
    return jsonResponse({ success: false, error: formatError(error) }, 500);
  }
});

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

async function fetchIcsEvents(feedUrl: string, range: { start: Date; end: Date }): Promise<ParsedEvent[]> {
  const response = await fetch(feedUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch calendar feed (${response.status})`);
  }

  const text = await response.text();
  const parsed = ical.sync.parseICS(text);
  const entries = applyCalendar(parsed);

  return getEvents(entries, range);
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

function getEvents(entries: Map<string, CalendarEntry>, range: { start: Date; end: Date }): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  for (const entry of entries.values()) {
    if (entry.cancelled || !entry.base?.start) {
      continue;
    }

    const base = entry.base;
    const exclusions = new Set(entry.cancelledInstances);

    if (base.rrule) {
      const occurrences = base.rrule.between(range.start, range.end, true);
      const seenKeys = new Set<string>();

      for (const occurrenceStart of occurrences) {
        const startDate = toDate(occurrenceStart);
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
    events.push(event);
  }
}

function eventsToCalendarRows(events: ParsedEvent[], feed: CalendarFeedRow, userId: string) {
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

async function syncRows(client: any, feed: CalendarFeedRow, rows: Array<{ externalKey: string; payload: any }>) {
  const { data: existingRows, error: existingError } = await client
    .from("calendar_items")
    .select("id,source,external_id,calendar_id,data")
    .eq("household_id", feed.household_id);

  if (existingError) {
    throw existingError;
  }

  const importedRows = [];
  for (const row of existingRows || []) {
    const payload = row.data || {};
    const rowSource = String(row.source || payload.source || "").toLowerCase();
    const rowCalendarId = String(row.calendar_id || payload.calendarId || payload.feedId || "");
    if (rowCalendarId !== feed.id || rowSource !== feed.source || payload.detachedFromFeed) {
      continue;
    }
    importedRows.push(row);
  }

  const incomingKeys = new Set(rows.map((row) => row.externalKey));
  const payloads = rows.map((row) => row.payload);

  if (payloads.length) {
    const { error } = await client
      .from("calendar_items")
      .upsert(payloads, { onConflict: "household_id,source,external_id" });
    if (error) {
      throw error;
    }
  }

  const staleIds = importedRows
    .filter((row) => !incomingKeys.has(getRowExternalKey(row)))
    .map((row) => row.id)
    .filter(Boolean);

  if (staleIds.length) {
    const { error } = await client.from("calendar_items").delete().in("id", staleIds);
    if (error) {
      throw error;
    }
  }

  return {
    insertedCount: payloads.length,
    updatedCount: 0,
    deletedCount: staleIds.length,
  };
}

function getRowExternalKey(row: any): string {
  return String(row.external_id || row.data?.externalKey || row.data?.external_id || "");
}

async function updateFeedStatus(client: any, feedId: string, values: Record<string, unknown>) {
  let { error } = await client.from("calendar_feeds").update(values).eq("id", feedId);

  if (error && "last_sync_status" in values) {
    const fallbackValues: Record<string, unknown> = {
      last_sync_status: values.last_sync_status,
    };

    if ("last_synced_at" in values) {
      fallbackValues.last_synced_at = values.last_synced_at;
    }

    ({ error } = await client.from("calendar_feeds").update(fallbackValues).eq("id", feedId));
  }

  if (error && "last_sync_status" in values) {
    ({ error } = await client
      .from("calendar_feeds")
      .update({ last_sync_status: values.last_sync_status })
      .eq("id", feedId));
  }

  if (error) {
    console.warn("Could not update feed status", error.message);
  }
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
