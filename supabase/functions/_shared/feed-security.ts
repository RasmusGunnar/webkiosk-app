export class ImportFailure extends Error {
  constructor(public code: string, public status = 400) { super(code) }
}
export const MAX_FEED_BYTES = 5 * 1024 * 1024;
export const MAX_EVENTS = 10000;
export const DEFAULT_FEED_HOSTS = ["kalenderlink.aula.dk", "calendar.google.com", "calendar.googleusercontent.com", "outlook.office365.com", "outlook.live.com"];
export function allowedFeedHosts(extra = ""): string[] {
  return [...DEFAULT_FEED_HOSTS, ...extra.split(",").map(host => host.trim().toLowerCase()).filter(Boolean)];
}
export function validateFeedUrl(value: string, hosts: string[]): URL {
  let url: URL;
  try { url = new URL(String(value || "").trim().replace(/^webcal:\/\//i, "https://")); }
  catch { throw new ImportFailure("URL_NOT_ALLOWED"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      !hosts.includes(url.hostname.toLowerCase()) || url.hostname === "localhost" ||
      /^[\d.[\]:]+$/.test(url.hostname)) throw new ImportFailure("URL_NOT_ALLOWED");
  url.hash = "";
  return url;
}
export async function fetchFeedText(value: string, options: {
  fetcher?: typeof fetch; hosts?: string[]; timeoutMs?: number; maxBytes?: number
} = {}): Promise<string> {
  const fetcher = options.fetcher || fetch, hosts = options.hosts || DEFAULT_FEED_HOSTS;
  const maxBytes = options.maxBytes ?? MAX_FEED_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    let url = validateFeedUrl(value, hosts);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetcher(url, { signal: controller.signal, redirect: "manual", headers: { Accept: "text/calendar" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get("location");
        await response.body?.cancel();
        if (!next || redirects === 3) throw new ImportFailure("FETCH_FAILED", 502);
        url = validateFeedUrl(new URL(next, url).toString(), hosts);
        continue;
      }
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new ImportFailure("FETCH_FAILED", 502); }
      if (Number(response.headers.get("content-length")) > maxBytes) { await response.body.cancel(); throw new ImportFailure("IMPORT_LIMIT", 413); }
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.byteLength;
          if (length > maxBytes) { await reader.cancel(); throw new ImportFailure("IMPORT_LIMIT", 413); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const data = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      return new TextDecoder("utf-8", { fatal: true }).decode(data);
    }
    throw new ImportFailure("FETCH_FAILED", 502);
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    throw new ImportFailure("FETCH_FAILED", 502); // Never forward network errors containing private URLs.
  } finally { clearTimeout(timeout); }
}
export function validateCalendarText(text: string) {
  const value = text.trim();
  if (!/^BEGIN:VCALENDAR[\r\n]/i.test(value) || !/[\r\n]END:VCALENDAR$/i.test(value)) throw new ImportFailure("INVALID_ICS", 422);
  const begins = value.match(/^BEGIN:VEVENT\s*$/gim)?.length || 0;
  const ends = value.match(/^END:VEVENT\s*$/gim)?.length || 0;
  if (begins !== ends) throw new ImportFailure("INVALID_ICS", 422);
  if (begins > MAX_EVENTS || /FREQ=(SECONDLY|MINUTELY)(;|[\r\n])/i.test(value)) throw new ImportFailure("IMPORT_LIMIT", 413);
  return begins;
}
