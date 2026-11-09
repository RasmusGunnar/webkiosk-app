/**
 * Base error for everything the auth package throws.
 * Subclass for distinct failure modes that callers should branch on.
 */

import { sanitizeUrl } from './wire-tracer.ts';

export class AulaAuthError extends Error {
  override readonly name: string = 'AulaAuthError';
  override readonly cause: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.cause = options?.cause;
  }
}

export class RedirectLoopError extends AulaAuthError {
  override readonly name: string = 'RedirectLoopError';
  /** Sanitised — the URL we got stuck on may carry `?code=` or `?access_token=`,
   *  and this message ends up in the login log and in issue reports. */
  readonly lastUrl: string;
  readonly hops: number;
  constructor(
    hops: number,
    lastUrl: string,
  ) {
    const safeUrl = sanitizeUrl(lastUrl);
    super(`Exceeded ${hops} redirect hops; stuck at ${safeUrl}`);
    this.lastUrl = safeUrl;
    this.hops = hops;
  }
}

export class HtmlParseError extends AulaAuthError {
  override readonly name: string = 'HtmlParseError';
  readonly snippet?: string;
  constructor(
    message: string,
    snippet?: string,
  ) {
    super(message);
    // Do not retain raw authentication HTML in error objects.
    this.snippet = undefined;
  }
}
