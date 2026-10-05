# Recipes 3.0 — afgrænset lokal fejlrettelse, 5. oktober 2026

De to rapporterede flows er verificeret lokalt. Dette er **ikke** en samlet godkendelse af Recipes 3.0.

## Root cause

Den kørende standard-Vite på `http://localhost:5173` serverede `VITE_SUPABASE_URL` med en hosted Supabase-origin. Recipes 3.0 var derimod implementeret og testet i den lokale stack på `http://127.0.0.1:59321`. Port 5178 brugte allerede den korrekte lokale konfiguration. Miljøafvigelsen blev konstateret direkte i den faktisk serverede frontendkonfiguration; ingen API-nøgler blev udskrevet.

- **URL import:** Standardstarten brugte forkert backendmiljø. Den konkrete URL gav allerede før rettelsen HTTP 200 mod den lokale `recipe-preview`, med gyldig bruger-auth, JSON-LD Recipe, billede og alle opskriftsfelter. Der er ikke fundet en parser-/fetch-/billedfejl for denne URL i den lokale implementation.
- **Library:** Samme miljøafvigelse. Den præcise frontend-query med `recipe_ingredients`, `recipe_instructions` og `recipe_ratings`, household-filter, sortering og pagination gav HTTP 200 mod lokal Supabase. Alle fire tabeller findes lokalt, har aktiv RLS og authenticated SELECT-grant. De eksisterende API-tests bekræfter fungerende læsning/gemning og afvisning på tværs af familier. Schemaet fra `20261005090242_recipe_library.sql` er allerede anvendt lokalt via psql som dokumenteret i Recipes 3.0-baselinen; ingen ny migration er nødvendig.

Hosted Supabase blev hverken kontaktet, inspiceret eller ændret. Der påstås derfor ikke en bestemt hosted HTTP-/schema-fejlkode. Diagnosen er den konkret påviste frontend/backend-miljøafvigelse og de beståede kontroller af den korrekte lokale backend.

## Ændring

- `app/package.json`: `npm --prefix app run dev` bruger nu den eksisterende lokale launcher med port 5173.
- `app/scripts/dev-local.mjs`: tillader et valideret `--port`-argument. Den eksisterende `dev:local`-kommando beholder port 5178. Begge bruger `localSupabase()` og afviser andre API-origins end den lokale stack.
- Den verificerede Vite-proces på 5173 blev genstartet lokalt. Den serverede frontend peger nu på `http://127.0.0.1:59321`.
- `app/tests/recipes-real-url.mjs`: ny afgrænset regression af den rigtige URL gennem UI, Edge, Storage, save og reload. Ingen mock af importsvaret; kun isoleret lokal testfamilie, som slettes bagefter.

Ingen ændring i `.env`, opskriftsparser, DNS/IP-pinning, redirects, private-IP-beskyttelse, TLS, image-copy, frontend-cache/fallback, schema eller RLS. Ingen designændring. Den eksisterende canonical source-URL-normalisering bevarer kilden uden afsluttende slash; dette er verificeret ved gemning og ikke ændret.

## Real URL / browseracceptance

Testet URL: [Madens Verden – Pasta med kødsovs](https://madensverden.dk/pasta-med-koedsovs/).

Den uændrede servertransport gav HTTP 200 uden redirects, `text/html; charset=UTF-8`, identity encoding og chunked transfer. Valideret offentlig IP blev brugt med eksisterende TLS-hostname-verifikation. Payload var ca. 481 KB, under den eksisterende 2 MiB-grænse. Ingen user-agent-blokering observeret.

Følgende er testet via den faktiske frontend på `http://localhost:5173`:

1. Mad & indkøb åbner biblioteket uden advarsel om cached data.
2. Hent fra URL → indsæt URL → Hent opskrift.
3. Redigerbart preview: titel, billede, **14 ingredienser**, **9 trin**, **4 portioner**, **15 minutters forberedelse**, **55 minutters tilberedning**, **70 minutter i alt**.
4. Ingen opskrift oprettes i databasen før Gem.
5. Gem opretter opskrift, ordnede linjer, source URL og privat kopieret billede.
6. Fuld browser-reload henter og viser opskriften og dens gemte billede igen.
7. Gemte detaljer fungerer også ved 375 px bredde.
8. Ingen JavaScript-fejl, HTTP-fejl eller browserrequests til hosted Supabase/eksterne opskriftssider. Selve importen er server-side.

Testen var først fejlagtigt strikt omkring source URL'ens afsluttende slash. Assertionen blev rettet til den eksisterende canonical model; produktkoden blev ikke ændret for at tilpasse sig testen.

Screenshots og maskinlæsbar evidens ligger i den ignorerede mappe `supabase/.temp/recipes30-fix/`:

- [Rigtigt redigerbart preview](../supabase/.temp/recipes30-fix/real-url-preview-desktop.png)
- [Bibliotek efter reload](../supabase/.temp/recipes30-fix/library-reload-desktop.png)
- [Gemt opskrift ved 375 px](../supabase/.temp/recipes30-fix/saved-recipe-375.png)
- `diagnosis.json`, `transport-probe.json`, `real-url-browser.json`, `source-integrity.json`.

## Regression og afgrænsning

- App-tests: **131 PASS**.
- Deno Edge-tests: **25 PASS**, inklusive SSRF/private adresser, redirects, DNS/TLS-pinning, framing, størrelsesgrænser og billeder.
- Edge TypeScript-check: **PASS**.
- Eksisterende Recipes API/RLS/Storage-tests: **13 PASS**.
- Eksisterende Recipes browserregression: **14 PASS**, inklusive narrow layout, redigering, planlægning, ratings, indkøb, offline og kiosk. Denne tidligere suite bruger fortsat eksplicitte fixtures til import/vision; den nye real-URL-test ovenfor supplerer den.
- Ny real-URL-browserregression: **7 PASS**.
- Vite build med kun lokal Supabase-konfiguration: **PASS**.
- Secret-check: se `secret-check.log` i evidensmappen.

Ingen production Supabase, deployment, commit eller push. Ingen OPENAI_API_KEY er tilføjet eller nødvendig. Eksisterende lokale produktændringer er bevaret.

**REAL URL TEST = PASS**

**LIBRARY RELOAD = PASS**

**READY FOR VISUAL REVIEW = YES**

**RECIPES 3.0 APPROVED = NO**
