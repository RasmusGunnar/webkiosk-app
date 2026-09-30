# Opgaver, belønning og offline (Mega 3)

> Historisk Mega 3-dokumentation. Ugesymboler og weekly celebration er deprecated fra Rewards 2.1. Aktuel adfærd er beskrevet i [Rewards 2.1](rewards-2.1.md); historiske data bevares, men læses og skrives ikke i den aktive reward-oplevelse.

Implementeret og frigivet 28. september 2026. Live-projekt: `oyyqniwppytipdktzwsy`.
Releasebevis: [2026-09-28-task-offline.json](releases/2026-09-28-task-offline.json).

## Opgaver og belønning

Opgaver er fortsat calendar_items med type Opgave. Kalenderens eksisterende editor, person-ID'er, syv standardforslag, fritekst, titelhistorik og occurrence-specific done anvendes. Mobilens dagkort viser åbne opgaver først og udførte opgaver i en fold. Desktop beholder kalenderdagene.

household_people.reward_enabled backfilles til true for child og false for adult/other. En insert-trigger leverer samme default for fremtidige personer; det eksplicitte flag i personindstillinger vinder over default. Rollen ændrer ikke et allerede valgt flag.

task-rewards.js beregner hele den viste ISO-uge, også i dagvisning: hver konkret udført forekomst højst én gang, enkeltperson/multiperson/Alle, kun datoer til og med i dag. Historiske uger bevares. Symbolerne er 0=ingen, 1=🪙, 2=🪙🪙, 3=🟨, 4=🟨🟨, 5=💎, 6=💎💎, 7+=👑.

Serverens sync_calendar_mutation låser husstanden, måler før/efter og registrerer nye crossings ved 7/9/12. reward_celebrations har UNIQUE(household_id,person_id,iso_year,iso_week,threshold). Kun den request, som opretter claimet, modtager popup-data. Den anden enhed indlæser tilstanden uden popup. Undo/redo og gentagne requests fejrer ikke igen; almindelig load og allerede udførte opgaver udløser ingen historiske popup-storme. Allerede udførte opgaver, der blot flyttes, fejres ikke som nye completions.

Popup har person/avatar, Superstjerne/Hverdagshelt/Legende, antal, ISO-uge og højst seks opgavetitler med emoji. Den kan lukkes med knap, Escape, baggrund eller efter 6,5 sekunder. Konfetti har pointer-events:none og respekterer reduced-motion.

## Lokal lagring og synkronisering

IndexedDB indeholder en transaktionssikker record pr. backend + user_id + household_id med snapshot og kø. Kalender, personer, feedmetadata og celebrations caches. Feed-URL'er, importtokens, frie sync-fejltekster og signerede avatar-URL'er gemmes ikke i denne cache. Avatarens private object path/personmetadata bevares; uden net kan en privat avatar falde tilbage til initial.

Service worker caches kun appens statiske filer, aldrig API-svar, login eller private feeds. Den kræver HTTPS eller localhost og aktiveres i produktionsbuild. Statiske cacheopslag ignorerer Vary for kendte buildfiler, så CORS-forskelle ikke ødelægger offline reload.

Seneste familie vises fra cache, mens Auth afklares; dette virker også med udløbet access token under netudfald. Realtime starter først med verificeret session. Cache er lokal på den tidligere indloggede enhed, og serveradgang kræver stadig gyldig Auth/RLS.

Create/edit/delete/done gemmes varigt før kvittering i UI. Køen indeholder UUID, handling, entity/row, husstand, payload, tidspunkt og forventede row-versioner. Serieskrivninger forbliver en atomisk batch. Afhængige forventede versioner ombindes efter server-ACK. Sikre, efterfølgende done-toggles samles. Web Locks koordinerer faner; BroadcastChannel meddeler cacheændringer.

calendar_mutation_receipts giver idempotente retries, også hvis serveren skrev før forbindelsen forsvandt. Et gentaget ACK giver ingen ny celebration, og frisk servertilstand forhindrer genoplivning af efterfølgende slettede rækker. Et udestående GET kan ikke erstatte en nyere lokal write/ACK.

Ved netfejl bevares optimistisk visning og kø; RPC timeout er 12 sekunder. Ved serverafvisning rulles visningen tilbage, inklusive afhængige ændringer. Fejlen bliver i køen og kan prøves igen. Reconnect, synlig fane og periodisk retry sender køen igen.

Opdateringer/sletninger kræver den version, editoren eller køen faktisk brugte. Nyere serverdata giver konflikt. Behold min version læser aktuel serverversion og forsøger en ny eksplicit write; endnu en samtidig ændring kan stadig afvise forsøget. Brug serverversion kasserer den lokale ændring og dens afhængige efterfølgere. En konflikt blokerer efterfølgende replay, indtil familien vælger.

Realtime opdaterer snapshot og kalenderfladerne, mens lokale pending overlays bevares. Åbne editorer og dashboardheaderen erstattes ikke. Husstandsskift stopper den gamle subscription. Logout advarer ved pending arbejde og rydder alle den pågældende brugers private caches/køer på enheden; appens offentlige shell kan stadig åbnes.

Person-, avatar- og feedindstillinger kræver forbindelse. Kalender- og opgavemutationer er offline-understøttede.

## Database og live-sikkerhed

Migration: 20260928131536_task_rewards_offline_sync.sql. Additiv kolonne, to nye tabeller, private helpers og offentlig Auth-kontrolleret RPC. De nye tabeller har RLS; klienter kan læse egne tilladte data, men ikke forfalske claims eller receipts. RPC kontrollerer medlemskab og genbruger kalenderens versions-, tenant- og personvalidering.

Før rollout matchede live schema sidste versionsstyrede snapshot, og fysisk backup 1805398900 fra 2026-09-28 03:37:45 UTC var COMPLETED. Samme datafingeraftryk blev kontrolleret lige før migration, lige efter og efter live-smoke. Kalenderens 272 rækker er byte-for-byte ens i den kanoniske JSON-kontrol. Personernes reward_enabled og updated_at er tilsigtede ændringer og undtaget fra personfingeraftrykket; alle øvrige personfelter og alle øvrige eksisterende tabeller blev sammenlignet fuldt. Revisionsrækker oprettes/opdateres naturligt af backfill-triggeren.

Efter cleanup: 2 households, 2 memberships, 5 personer, 272 kalenderposter, 4 feeds, 1 Auth-bruger og 0 Storage-objekter. Ingen testclaims eller receipts er tilbage. Edge Function import-calendar-feed er fortsat aktiv version 10 med uændret SHA. Der er ingen offentlig frontend-deployment i denne opgave.

Security Advisor har ingen nye database-/Storage-fund. Den allerede kendte Auth-indstilling [leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) er fortsat deaktiveret. Performance Advisor har kun eksisterende INFO om indeksbrug og Auth-forbindelsesallokering.

## Verifikation

```powershell
npm.cmd --prefix app test
node scripts/test-database.mjs
npx.cmd --yes deno@2.9.6 task --cwd supabase/functions check
npx.cmd --yes deno@2.9.6 task --cwd supabase/functions test
npm.cmd --prefix app run dev:local
# I en anden terminal:
node app/tests/browser.mjs
node app/tests/calendar-browser.mjs
# Produktionsbuild med KUN lokal Supabase, til service-worker-tests:
node app/scripts/preview-local.mjs
node app/tests/task-offline-browser.mjs
```

56 Node-tests, 99 SQL-checks (49 foundation + 20 kalender + 30 reward/offline), 12 Edge-tests samt build og Edge-typecheck består. Browser: Mega 1-forløbet, 22 Mega 2-checks og 20 Mega 3-checks består. Testdata ryddes; SQL-fixtures rulles tilbage.

Live-smoke er eksplicit gated og opretter kun midlertidige brugere/familier. Credentials bliver i proceshukommelsen:
```powershell
node scripts/task-offline-live-smoke.mjs --allow-live-tests
node scripts/calendar-live-smoke.mjs --allow-live-tests
```

De 14 nye live-checks dækker bl.a. samtidige devices om threshold 7, 9/12, receipts, RLS, faktisk offline-replay mod live, recurrence, realtime og begge konfliktvalg. De 8 eksisterende kalender-live-checks består.

| Opgavens acceptance | Evidens |
| --- | --- |
| 1–2 Forslag/custom | Mega 2 browser #11, Mega 3 browser #4 og oprettelser |
| 3–5 Single/multi/Alle | task-offline.test.js og rewards.sql |
| 6–8 Forekomst/fremtid/uge | Node, SQL, Mega 3 browser #1/#7 |
| 9–10 Reward-defaults/valg | SQL og Mega 3 browser #3 |
| 11–15 Thresholds/idempotens/devices | SQL, browser #5–8 og 14 live-checks |
| 16 Emoji | Node-mapping og browser #5 |
| 17–18 Snapshot/offline reload | Browser #2/#10, også udløbet access token |
| 19–22 Offline CRUD/done | Browser #11, Node replay/rollback |
| 23–26 Replay/kø/fejl/coalescing | Browser #12/#13/#16 og Node |
| 27–29 Conflict/local/server | Browser #14/#15, SQL, Node og live |
| 30–31 Logout/household isolation | Browser #18/#19, SQL RLS og scope-tests |
| 32–33 Realtime/cache/editor | Browser #17 og Mega 2 #20 |
| 34 Build/typecheck | Vite production build og Deno check |

Alle 34 acceptance-punkter er PASS. Videre produktarbejde med den større mobil-/kiosk-UI hører til Mega 4.
