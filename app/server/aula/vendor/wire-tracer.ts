// No trace sinks are shipped. Error strings are never returned by the API.
export function sanitizeUrl(value: string): string {
  try { return new URL(value).origin; } catch { return '[redacted]'; }
}
