# Aula third-party provenance

Reference: [Casperjuel/aula-mcp](https://github.com/Casperjuel/aula-mcp).

Pinned commit: `5c64e98eaba98288770650f8cafe1636facf01d2`.

License: MIT, copyright (c) 2026 CasperJuel. The complete notice is preserved in `app/server/aula/vendor/LICENSE`. See the adjacent `PROVENANCE.json` for file-level hashes and adoption details. No code from the earlier Python PoC or its response/session files is bundled.

## Adopted authentication code

Only the transitive TypeScript authentication implementation from `packages/aula-auth/src` is vendored: `aula-login-client`, `aula-oauth`, `aula-saml-flow`, `cookies`, `crypto`, `encoding`, `errors`, `html`, `mitid-client`, `mitid-flow-proof`, `mitid-poll-machine`, `mitid-types`, `mitid-urls`, `pkce`, `srp`, and `state`.

It supplies PKCE/state, the OAuth/SAML broker flow, MitID application authentication and protocol cryptography. The API wrapper invokes only `method: APP`; the product never offers code-token/password login. SRP remains a transitive dependency of the reference's MitID implementation. Authentication dependencies `cheerio` and `tough-cookie` are pinned in the npm lockfile.

Local adaptations:

- `http.ts` retains the cookie/manual-redirect interface but uses Node's fetch, abortable per-request/overall deadlines, approved HTTPS provider hosts and an 8 MiB response cap. It contains no trace or logger sink.
- `logger.ts` is a no-op interface. `wire-tracer.ts` contains only an origin-only sanitizer; file/in-memory trace collectors are not included.
- `errors.ts` replaces TypeScript parameter properties for Node 24 strip-only compatibility and does not retain auth HTML snippets.
- `provider.ts` independently implements the narrow read subset of `packages/aula-client/src/aula-client.ts` and the MeeBook GET protocol from `integrations/meebook.ts`. It preserves the MIT notice through this manifest/license. It does not import the full client, generic raw requests or any write method.

Not adopted: MCP server, CLI, setup UI/server, token/keychain stores, filesystem token export/import, wire tracing, browser automation, generic tools, presence updates, message sending/read markers, or vendor deployment instructions. The reference clone remains under ignored `supabase/.temp` solely for review.

The provider uses unofficial interfaces. The reference explicitly detects STIL bot defense and does not bypass it. Pure HTTP support does not guarantee that hosting-provider IPs can complete interactive login. Real local and later separately approved hosting acceptance remain necessary; no cloud login is claimed by mock tests.
