# Mad & opskrifter 3.0 — lokal implementering

Arbejdet ligger på `polish/calendar-meals-imports` oven på de ustagede Polish24-ændringer. Ingen commit, push, Vercel-deployment eller live Supabase-ændring. En kopi med SHA-256 af de 23 eksisterende lokale filer findes i den ignorerede mappe `supabase/.temp/recipes30/baseline-1791190846966/`.

## Model og adgang

- `recipes`, `recipe_ingredients`, `recipe_instructions` og `recipe_ratings` er permanente, familieafgrænsede data.
- `save_recipe` bruger SECURITY INVOKER, RLS, en transaktion og kontrol af den forventede version. Ingredienser og trin har eksplicit rækkefølge. Rå ingredienstekst bevares; usikker mængde-/enheds-parsing udføres ikke.
- Måltider og indkøb forbliver `calendar_items`. `data.recipe_id` har en genereret `recipe_id`-kolonne og en sammensat foreign key med household_id. Det eksisterende mutation-/offline-format kan derfor genbruges uden at erstatte kalenderens RPC.
- `data.servings_override` og den eksisterende `note` hører til måltidet. Aktuelle mastertitler vises ved opslag; noter og portionsvalg ændrer ikke masteren. Ingrediensmængder skaleres ikke automatisk.
- Ratings bruger eksisterende familiepersoner. Alle household-medlemmer kan redigere fælles madplan/persondata og vurderinger, som i den eksisterende adgangsmodel; der er ingen ny identitet eller adgangskode pr. barn.
- En favorit kræver positiv vurdering (love/like) fra mere end halvdelen af de aktive familiepersoner. Manglende vurderinger tæller ikke som positive.
- Sidst lavet og antal gange afledes fra faktiske måltider med dato til og med i dag. Fremtidige planer tælles ikke som tilberedt.
- Arkivering skjuler biblioteksopskriften; tidligere og planlagte måltider og billeder bevares. Browseren kan ikke hard-delete masteren.
- Indkøb gemmer recipe_id, eventuelt meal_id, ingredient_id og raw_text. En unik handlings-/ingrediensrelation og UI-lås beskytter mod gentagne klik.

## Import og billeder

Den eksisterende `recipe-preview` Edge Function håndterer både URL og scan.
URL: JSON-LD Recipe → strukturerede itemprop-felter → OpenGraph/titel. Importen giver et redigerbart preview med beskrivelse, portioner, tider, ingredienser og trin. Canonical link accepteres kun fra samme origin. Dubletadvarsel sammenligner canonical source URL, aldrig fuzzy titel.

HTML og billeder anvender samme DNS/IP-pinnede HTTP-transport. Kun offentlig HTTP(S), kontrollerede porte, validering ved hver redirect, højst tre redirects, timeout, MIME-kontrol og størrelsesgrænser. HTML er højst 2 MiB, billeder højst 5 MiB; JPEG/PNG/WebP-signatur kontrolleres. Et billedproblem blokerer ikke opskriften og giver ikke en browser-hotlink-fallback.

Billeder kopieres først ved brugerens gemmehandling til den private bucket `recipe-images`, under `household_id/recipe_id/random-id.ext`. Signed URLs opbevares kun i hukommelsen. Egne uploads dekodes og reenkodes i browseren til højst 2000 pixels på den længste side, uden kameraets EXIF/location-metadata. Erstattede billeder ryddes op via Storage API. Ved ukendt udfald af en gemning slettes et nyt billede kun, hvis et efterfølgende databaseopslag beviser, at ingen opskrift bruger det. Arkiverede covers beholdes af hensyn til historik; kontosletning rydder alle billeder fra bekræftet slettede households op.

Eksisterende familieeksport, privatlivstekst og kontosletning inkluderer opskrifter og billeder. Ingen ændring af auth redirects, Site URL eller auth-konfiguration.

## Fotoscan og manuel konfiguration

Der var ingen eksisterende AI-provider. `_shared/recipe-vision.ts` indeholder en lille udskiftelig adapter:
- Provider: OpenAI Responses API med strengt JSON-schema; `store:false`.
- **Manglende server-secret: `OPENAI_API_KEY`.** Den er ikke tilføjet eller udskrevet.
- Valgfri serverkonfiguration: `RECIPE_VISION_PROVIDER=openai` (default) og `RECIPE_VISION_MODEL=gpt-4.1-mini` (default).
- Ingen AI-nøgle eller modelkonfiguration i VITE-variabler/frontend.
- Op til fire ordnede fotos; maksimum 12 MiB afkodede billeder pr. scan, begrænset request-størrelse og timeout.
- Kun indloggede household-medlemmer kan anmode om scan. Det er brugeren, der starter overførslen ved at trykke Analyser.
- Manglende nøgle giver HTTP 503 med `VISION_NOT_CONFIGURED`; providerfejl giver kontrolleret fejl, aldrig fixture-success.
- Intet gemmes automatisk. Mangelfuldt resultat markeres, og brugeren retter preview før gemning. Originalfoto bruges kun som cover ved et aktivt valg. Ingen automatisk mad-crop eller genereret billede.

Live vision er **ikke** afprøvet uden secret. Browsergalleriets succesfulde analyser er eksplicit markerede testfixtures.

## Offline, realtime og kiosk

Bibliotekets tekst, ratings og opskriftsrelationer caches i den eksisterende user-/household-afgrænsede IndexedDB-snapshot. Opskriftsredigering/rating, URL-import og scan kræver onlineforbindelse; den eksisterende kalenderkø understøtter kun kalender-/reward-mutationer og udvides ikke med en parallel opskriftskø. Måltidsplanlægning og indkøb anvender fortsat kalenderkøen. Covers garanteres ikke offline; placeholderen fungerer uden billede.

Recipes, ordnede linjer og ratings opdaterer den eksisterende `calendar_revisions`-kanal. Ingen ny abonnementstype eller toast på realtime-echo. Kiosk beholder kompakt kalender og kan åbne en læsevisning uden import, kamera, redigering eller ratingkontrol.

## Lokal afprøvning

Migration: `20261005090242_recipe_library.sql`, oprettet med Supabase CLI. Den er afprøvet via psql mod den faste Docker-container `supabase_db_familiekalender`, ikke mod en connection string fra .env. Ingen reset af eksisterende data. Testdata bruger isolerede familier og slettes efter test.

- `npm --prefix app test`
- `npx --yes deno@2.9.6 task check` og `task test` i `supabase/functions`
- `node app/tests/recipes-api.mjs`
- `node app/scripts/preview-local.mjs` (bygger med kun lokal Supabase-konfiguration, port 5179)
- `node app/tests/recipes-browser.mjs`
- `node app/tests/polish-imports.mjs` og `node app/tests/polish-browser.mjs`
- `npm --prefix app run cap:sync`, `npm --prefix app run verify:native`
- `node scripts/check-release-secrets.mjs`

Review: `supabase/.temp/recipes30/review.html`. Isolerede realistiske retter med mærkede, syntetiske testpladsholdere; ingen hentede stockfotos. Testene dækker desktop, 375×667, 390×844, 430×932 og kiosk. Offline-reload bruger den eksisterende service worker fra et lokalt build, ikke Vite dev-serveren.

## Dokumentationsgrundlag

[Supabase Storage RLS](https://supabase.com/docs/guides/storage/security/access-control), [Supabase Realtime](https://supabase.com/docs/guides/realtime/postgres-changes), [OpenAI billedinput](https://developers.openai.com/api/docs/guides/images-vision), [struktureret output](https://developers.openai.com/api/docs/guides/structured-outputs).

Native kameraintegration genbruger HTML-billedvælgeren. Kamera-input bruger image/* + capture=environment, som den installerede Capacitor Android-bridge kræver. Android-manifestet angiver kun synlighed for IMAGE_CAPTURE-intent; iOS-formålstekster omfatter opskrifter. Kamera og fotovælger er ikke afprøvet på fysisk Android/iOS i denne Windows-session. [Android package visibility](https://developer.android.com/training/package-visibility/declaring).

## Billeder i Mad & indkøb

Madplanen viser private opskriftsbilleder som 48 × 48 px thumbnails ved siden af titel og måltidsmetadata. Bibliotekets covers ligger øverst med fast 3:2-format og object-fit: cover på desktop og mobil. Kort uden billede eller med en fejlet billedrequest falder tilbage til kompakte tekstkort uden en tom billedramme. Kalenderens madvisning er uændret.

Signed URLs genbruges i hukommelsen pr. session/familie, deles mellem samtidige opslag og fornyes efter 55 minutter (URL-levetid: 60 minutter). Ingen nye storage- eller databasefelter. Browserreviewet kontrollerer dekodede billeder, beskæring, 404-fallback og 375/390/430 px uden overflow; `supabase/.temp/recipes30/review.html` indeholder desktop- og mobilbilleder med mindst to billedretter i madplanen. Review bruger de eksisterende, tydeligt mærkede lokale billedfixtures.
