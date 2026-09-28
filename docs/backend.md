# Backendgrundlag for den nye Familiekalender

Den autoritative model er **supabase/migrations/**. Rodens supabase_setup.sql er kun reference for den gamle hid/uid-model og må ikke anvendes på den nye app.

## Status og projekter

- Ny app: Supabase-projekt **oyyqniwppytipdktzwsy** (Familiekalender).
- Legacy-projektet **nnfkumgdebxdegjykkwp** er et andet projekt.
- Live-kataloget blev læst 2026-09-28. Resultatet ligger i [live-before-foundation.json](../supabase/schema/live-before-foundation.json); [capture.sql](../supabase/schema/capture.sql) kan gentage inspektionen.
- Snapshot omfatter tabeldefinitioner, constraints, indexes, RLS, grants, funktioner og triggers. Det indeholder ingen personrækker, kalenderdata, Auth-brugere eller private feed-URL'er og er **ikke en backup**.
- **Backend LIVE 2026-09-28:** alle tre migrationer er anvendt og registreret. Hver migration blev kontrolleret mod både rækketal og fingerprints af alle oprindelige kolonner; eksisterende data var uændrede.
- Edge Function **version 10** er deployet og testet med den eksisterende brugers session. Email/password-login er desuden testet med en midlertidig bruger.
- Den byggede app er browser-testet mod live Supabase via lokal preview. Offentlig app-deployment afventer eksplicit hostinggodkendelse; GitHub Pages-workflowet er ikke oprettet.
- [Releasebevis](releases/2026-09-28-live.json) og [schema efter migration](../supabase/schema/live-after-foundation.json) indeholder ingen credentials, brugerdata eller private feed-URL'er.
- Supabase-backup **1805398900**, fuldført **2026-09-28 03:37 UTC**, er verificeret via CLI. Alle oprindelige app-data var ældre end backupen; PITR er ikke aktiveret. Recovery sker via Dashboard → Database → Backups. Der er ikke udført en restore på live.
- Før/efter: profiles **0/0**, households **2/2**, household_members **2/2**, household_people **5/5**, calendar_items **272/272**, calendar_feeds **4/4**. Auth-brugere er igen **1**, og Storage-objekter **0** efter testoprydning. Kun ét eksisterende feeds sync-status/tidsstempler er ændret af smoketesten.
- Regression: **11 frontendtests, 12 Edge-tests, 49 databasechecks, build, typecheck og live-browsertest PASS**. Live Security Advisor har én Auth-advarsel: leaked password protection er deaktiveret; ingen database-/Storage-advarsler.

## Model og adgang

Alle tenant-rækker tilhører household_id. Familiepersoner er selvstændige profiler; børn behøver ikke et Auth-login.

| Tabel | Rolle og vigtige felter | Adgang for login-brugere |
| --- | --- | --- |
| profiles | id = auth.users.id, display_name, avatar_url, tidsstempler | Egen profil: læse/oprette/redigere |
| households | UUID, name, created_by, created_at | Medlemmer læser; owner/admin ændrer navn |
| household_members | (household_id, user_id), role, created_at | Medlemmer læser egen familie; ændringer gennem sikre RPC'er |
| household_people | UUID, name, role, color, avatar_url, avatar_path, name_aliases, sort_order, is_active, tidsstempler | Familiemedlemmer CRUD |
| calendar_items | UUID, title, date, time, person, person_ids, type, note, done, data, created_by, tidsstempler, importfelter | Familiemedlemmer CRUD |
| calendar_feeds | UUID, source, name, feed_url, assigned_person_name, assigned_person_id, is_active, sync-status og importlås | Kun owner/admin; importstatus skrives server-side |
| household_invitations | UUID, email, role, token_hash, invited_by, expires_at, accepted_at, revoked_at | Owner/admin læser og sletter; oprettelse/accept gennem RPC |

Membership-roller: owner/admin/adult/child. Personroller: adult/child/other. Child-members har samme kalender-/personadgang som adult; personens rolle giver ikke et login eller en medlemsrolle.

RLS bruger private, stabile SECURITY DEFINER-membershiphelpers med tom search_path. De kontrollerer auth.uid() og undgår policy-recursion. UUID'er er ikke adgangsnøgler. Browseren må ikke ændre membership, household_id, kalenderens created_by eller importlås/status. Anonyme brugere har ingen adgang til familiens tabeller. Service-role anvendes alene i Edge Function og isolerede lokale tests.

Indexes dækker medlemsopslag, household/date, household/feed, person-ID-arrays, foreign keys og unik (household_id, source, external_id). Feedets person-FK inkluderer household_id. Kalenderens person-ID'er valideres i en trigger; anvendte personer skal deaktiveres frem for at blive slettet.

## Auth og membership-API

Frontend bruger Supabase Auth med vedvarende session og tokenfornyelse. Async dataindlæsning kører uden for Auth-callbackens lås, gamle sessionsvar ignoreres, og logout rydder familie-state. UI vælger den først oprettede tilgængelige familie; modellen understøtter flere memberships uden et nyt schema.

- create_household(p_name): opretter profil efter behov, familie og owner-membership i én transaktion.
- invite_household_member(p_household_id, p_email, p_role = 'adult'): owner/admin får én engangstoken. Kun owner kan invitere en admin. Token hashes før lagring, er bundet til email og udløber efter syv dage.
- accept_household_invitation(p_token): kræver login og samme **bekræftede** email som invitationen. Låser invitationen, opretter membership og forhindrer genbrug. Eksisterende membership opgraderes ikke.
- is_household_member(hid, uid) / is_household_admin(hid, uid): kompatible RPC-signaturer, som kun besvarer spørgsmål om den aktuelle bruger.

Der er endnu intet invitations-UI, email-afsendelse, invitation-deeplink, konto-sletningsflow eller administrations-UI til medlemsroller. Tokens/private invitationslinks må ikke logges. Supabase-emailbekræftelse håndteres af Auth; konfigurer produktionsdomæne og SMTP før offentlig signup.

## Kalenderkontrakt og gradvis personmigration

SQL-kolonner bruger snake_case; den eksisterende kalender-JSON beholder camelCase.

| Autoritativ kolonne | Kompatibel data-JSON |
| --- | --- |
| person_ids | personIds; people/person er navne til gamle læsere |
| source | source |
| external_id | externalId / externalKey |
| calendar_id (tekst med feed-UUID) | calendarId / feedId |
| detached_from_feed | detachedFromFeed |
| duration_min / location | durationMin / location |
| done | done |

Nye/redigerede aftaler gemmer stabile person-ID'er. Navneændringer tilføjer det gamle navn til name_aliases; entydige gamle navne kan fortsat læses. Flere personer bevares. Tvetydige navne bliver ikke automatisk knyttet til en tilfældig person. Ukendte navne bevares i unresolvedPeople ved redigering.

Feedindstillinger gemmer assigned_person_id og et kompatibelt navn. Importen slår det aktuelle navn op server-side; gamle feeds uden ID bruger entydige navne/aliases. Der foretages ingen masseomskrivning af eksisterende kalenderdata.

Kalenderindlæsning henter stabile sider på 500 rækker, så Supabase-responsens rækkeloft ikke skjuler senere aftaler.

Eksisterende JSON-felter til bl.a. repeat/series, exceptions, birthdays og milestones bevares af kalenderadapteren. Den normale kalender-/gentagelses-UI er ikke redesignet. Redigering af en importeret aftale markerer den som detached, så næste import bevarer ændringen.

## Avatarer

Migration 2 opretter den **private** bucket household-avatars og household-baserede Storage-policies. Maks. 2 MiB; image/jpeg, image/png, image/webp. Der kræves ingen separat manuel bucketoprettelse.

Nye uploads: household UUID/person UUID/random UUID.extension. Rækken gemmer avatar_path; klienten genererer signed URL'er med en times levetid og fornyer dem efter 45 minutter. Signed URL'er gemmes ikke i databasen. Eksisterende DataURL-avatarer vises fortsat og konverteres først ved nyt upload. Fejlet databaseopdatering forsøger at rydde det nye upload; gammel avatar fjernes først efter vellykket opdatering. Storage og SQL er ikke én transaktion; fejlet netværksoprydning kan efterlade en ubrugt fil.

## Import

POST import-calendar-feed med JSON {"feedId":"<UUID>"} og brugerens Bearer-token. Valgfri preserveExisting:true fravælger oprydning; standardadfærden er uændret. Klienten leverer aldrig et autoritativt household_id. Funktionen validerer brugeren med auth.getUser(), læser feedet under RLS og kontrollerer admin-rollen. verify_jwt=false bruges kun, fordi funktionen selv validerer token før nogen dataadgang; den giver ikke anonym importadgang.

Service-only RPC'er:
- begin_calendar_feed_import: kontrollerer admin/aktivt feed og tager en to-minutters lås.
- apply_calendar_feed_import: genkontrollerer identitet/aktivitet/lås og udfører upsert, oprydning og successtatus i én transaktion.
- fail_calendar_feed_import: gemmer en fast fejlkode og frigiver kun samme importlås.

Ændring af feed-konfiguration ugyldiggør en igangværende import. SQL-null/ugyldige batches og parsefejl kan ikke udløse oprydning. Oprydning er begrænset til samme household/source/feed og importperiode (30 dage tilbage, 365 frem). Detached aftaler, andre feeds og historiske aftaler uden for perioden bevares. Task-done bevares ved upsert.

Fetch kræver HTTPS (webcal konverteres), ingen URL-credentials, maks. tre validerede redirects, 15 sekunders timeout og 5 MiB data. Standard-hosts: kalenderlink.aula.dk, calendar.google.com, calendar.googleusercontent.com, outlook.office365.com, outlook.live.com. Andre ICS-udbydere kræver en bevidst serverkonfiguration i CALENDAR_FEED_ALLOWED_HOSTS: kommaseparerede **eksakte betroede hostnavne**, ingen wildcards/IP-adresser. Ingen ekstra hosts er nødvendige for de observerede live-feedudbydere.

RRULE, EXDATE og RECURRENCE-ID bevares; Copenhagen-sommertid testes uafhængigt af maskinens tidszone. Maks. 10.000 forekomster; SECONDLY/MINUTELY-regler afvises. Delvise/ugyldige ICS-filer gemmer fejlstatus og bevarer data. Et gyldigt tomt VCALENDAR må rydde feedets ikke-detached aftaler inden for perioden.

Status er syncing/pending/success/error, med last_sync_at ved succes, last_import_count og fast last_sync_message ved fejl. Ingen private URL'er eller rå netværks-/databasefejl logges eller returneres. UI viser hostnavn; den fulde URL er tilgængelig ved admin-redigering.

## Lokal opstart og tests

Afprøvet med Node 24, Supabase CLI 2.118.0, Deno 2.9.6 og Docker Desktop. Kommandoerne køres fra repoets rod. Supabase- og Deno-versionerne er fastlagt i kommandoerne; npm ci bruger app/package-lock.json.

```powershell
npm.cmd ci --prefix app
npx.cmd --yes supabase@2.118.0 start -x realtime,studio,postgres-meta,edge-runtime,logflare,vector,supavisor
npm.cmd --prefix app run dev:local
```

Den lokale app er http://127.0.0.1:5178; API 59321, Postgres 59322, testmail 59324. dev:local sætter lokale credentials **kun i processen** og ændrer ikke app/.env. Hjælperen afviser andre API-adresser. Den reducerede stack er nok til browser-/SQL-tests; Edge testes med Deno og injicerede fetch-klienter.

Ny terminal i repo-roden:

```powershell
npm.cmd --prefix app test
npm.cmd --prefix app run build
node scripts/test-database.mjs
npx.cmd --yes deno@2.9.6 task --cwd supabase/functions check
npx.cmd --yes deno@2.9.6 task --cwd supabase/functions test
node app/tests/browser.mjs
npx.cmd --yes supabase@2.118.0 db advisors --local --type security --level warn --fail-on error
```

Browsercheck bruger installeret Chrome på Windows, ellers Playwright Chromium (installer med npx playwright install chromium fra app/), eller TEST_BROWSER_PATH. Den tester rigtig lokal Auth/DB/Storage og tillader kun localhost-netværk. Syntetiske brugere/familier/uploads fjernes efter testen. SQL-tests kører i rollback-transaktioner og er låst til containeren supabase_db_familiekalender. De genanvender også migrationerne for at kontrollere idempotens. Testene må aldrig peges mod live.

app/.env.example viser de delbare variabelnavne:
- VITE_SUPABASE_URL
- VITE_SUPABASE_PUBLISHABLE_KEY (eller eksisterende VITE_SUPABASE_ANON_KEY)

Kun offentlige browserkeys må have VITE_-prefix. Servermiljøet bruger SUPABASE_URL, SUPABASE_ANON_KEY og SUPABASE_SERVICE_ROLE_KEY, som Supabase normalt leverer til Edge Functions. CALENDAR_FEED_ALLOWED_HOSTS er valgfri. .env, dependencies, build-output og Supabase .temp er ignoreret i Git.

## Release gennemført og resterende aktivering

Database og Edge Function er live. Der skal **ikke** anvendes migrationer igen for denne release. Migrationshistorikken indeholder 20260928093825, 20260928093827 og 20260928093828.

Den eksisterende offentlige kiosk ligger på https://rasmusgunnar.github.io/webkiosk-app/. Oprettelse af en ny Pages-build for /app afventer udtrykkelig hostinggodkendelse. Ingen hostingindstillinger er ændret, og ingen ny Pages-workflow er oprettet.

Auth-check: email/password og signup er aktiveret, emailbekræftelse kræves. Site URL er stadig http://localhost:3000 og redirect-listen er tom. Når appens placering er valgt, skal kun Site URL/redirects ændres til den faktiske adresse; lokale config.toml må ikke pushes samlet til live. Signup-emaillevering/SMTP er ikke testet. Password-reset-endpointet findes i Supabase Auth, men appen har endnu intet reset-UI; den del er ikke release-testet. Leaked password protection kan aktiveres under Authentication → Sign In / Providers → Email → Password security ([Supabase-vejledning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)).

### Reproducerbar live-smoketest

Kør kun efter bevidst valg af live-miljø. Scriptet er låst til projektet oyyqniwppytipdktzwsy og kræver flaget --allow-live-tests. Det læser serverkey via den eksisterende CLI-login i hukommelsen og gemmer aldrig nøgler/sessioner. Det genererer en midlertidig login-session for den eksisterende owner uden at ændre password eller sende email. Det opretter/rydder isolerede testitems, en testbruger/familie, et testfeed og et testupload.

```powershell
node scripts/live-smoke.mjs --allow-live-tests --browser
# Kun når et eksisterende feed også skal hentes:
node scripts/live-smoke.mjs --allow-live-tests --import-existing
```

Browservarianten forventer den byggede app på http://127.0.0.1:5179 eller RELEASE_APP_URL. Rapporten gemmes i Git-ignoreret supabase/.temp/live-release/. Importvarianten sender preserveExisting:true og kan opdatere/tilføje importerede aftaler, men sletter ingen eksisterende aftaler. Den gennemførte Aula-smoketest gav 0 forekomster i det aktuelle vindue og 0 sletninger. Gyldig tom import og upserts med faktiske forekomster dækkes også af SQL-/parser-tests.

### Recovery og fremtidige releases

Før en ny migration: læs live-schema, undersøg drift, verificér en aktuel backup og sammenlign relevante tællinger. Publicér matchende app og Edge Function i samme release. Brug ingen blind db push og aldrig rodens legacy-setup.

Ved behov kan schema/policies før denne release genskabes ud fra live-before-foundation.json og baseline-koden. En Git-rollback alene ændrer ikke live RLS eller RPC'er. Brug fremadrettede rettelser, eller den verificerede backup med planlagt nedetid og hensyn til senere skriverier. Storage-objekter indgår ikke i databasebackuppen; der var ingen før denne release.

Supabase/.temp/live-release/recovery/ indeholder lokalt hentet kildekode for den tidligere Edge Function version 8 og en kopi af live-konfigurationen. Den mappe er ikke committed. Version 8 må ikke sættes tilbage alene, fordi importrettighederne er ændret af den nye model.

## Afgrænsning

Dette fundament implementerer ikke realtime/offline-kø, push, kiosk/device auth, Capacitor, generelt deep-link routing, fuld kontosletning/eksport, invitationsmail eller App Store-pakning. De kan bygges videre på household-modellen. Legacy-kiosk, Apps Script og Firebase-kode er bevaret.
