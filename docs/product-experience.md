# Mega 4: mobil, desktop og vægskærm

Implementeret 2026-09-29 i den eksisterende Vite-app. Ingen React-omskrivning, native wrapper eller offentlig frontend-deployment. Den levende backend er oyyqniwppytipdktzwsy.

## Enheder og navigation

device-mode.js vælger mobile under 700 px og desktop fra 700 px. Kiosk vælges eksplicit i Indstillinger → Enhed / Kiosk og er bundet til både bruger og familie. Viewport alene aktiverer aldrig kiosk. Lokale profiler er adskilt efter backend, bruger og familie.

Mobil har I dag, Kalender, Opgaver og Familie. Standard er I dag; et udtrykkeligt valgt dag-/ugeformat bevares. Mobilugen er syv lodrette dagskort. Tablet bruger to kolonner ved smalle bredder, mens kiosk altid viser alle syv dage ved siden af hinanden. På små kiosker ruller lange dagsindhold inde i deres kolonne; header og navigation bliver tilgængelige. I dag viser næste aftale og aktiviteter, fritid og opgaver. Kiosk tilføjer stort ur, dansk dato, kommende dage og kun konfigurerede genveje.

Editoren bruger fuld skærm på mobil, sticky handlinger, safe-area-insets og visualViewport. Fokus fanges i øverste dialog; Escape lukker den, og fokus returneres. Formularer overlever realtime, størrelsesændring og midnat. Gentagelser, serier, importerede readonly-aftaler, person-ID'er, task emoji, belønninger og offline-køen bruger fortsat Mega 1–3-modulerne.

## Kiosk og beskyttelse

Enheds-PIN består af 4–8 cifre og gemmes som saltet PBKDF2/SHA-256, 100.000 iterationer. Fem fejl giver en kort pause. Glemt PIN kan åbnes med kontoens adgangskode, hvorefter kiosk kan afsluttes og konfigureres igen. PIN er lokal UX-beskyttelse, ikke en sikkerhedsgrænse: en person med browserens udviklerværktøjer kan ændre lokal konfiguration. Supabase Auth, medlemskab og RLS bestemmer stadig dataadgang.

Wake Lock er fravalgt som standard, kræver aktivt tilvalg og genanmoder efter synlighed/berøring. Manglende browserstøtte eller afvisning giver en diskret status; kalenderen virker fortsat. En DeviceClock-instans opdaterer uret, næste aftale og dato uden genindlæsning. Midnat følger dagens/ugens skift. Inaktivitet er 15 minutter som standard, valgbart 10/15/20/30; aktive editorer, indstillinger, synkroniseringsvalg og fejringer afbrydes ikke.

Logout stopper realtime og offline-engine og rydder kalendercaches/Auth. Lokale enhedsindstillinger/PIN bevares udtrykkeligt til samme brugers næste login. En anden bruger overtager ikke kioskbindingen.

## Familie, personer, import og konto

Indstillinger har seks sektioner: Familie, Personer, Kalender-import, Enhed / Kiosk, Udseende, Konto. Familielisten viser Auth-medlemskaber og roller. Kalenderpersoner kan fortsat eksistere uden login. Arkivering bruger det eksisterende is_active-felt, bevarer ID og kalenderhistorik og slår opgavebelønning fra. Gendan gør personen aktiv igen; belønning kan tilvælges.

Ejer/admin kan oprette en invitation bundet til modtagerens email. UI viser det nye link én gang, giver Kopiér link og åbner brugerens emailklient via Åbn email. Appen sender ikke automatisk invitationsmail. Backend gemmer kun tokenhash, udløb og status; modtageren skal have den bekræftede email. Link kan bruges én gang, og afventende invitationer kan tilbagekaldes. Kun ejer kan invitere en administrator. Almindelige medlemmer får hverken invitationens administrations-UI eller RPC-adgang til oprettelse/tilbagekaldelse.

Feed-URL'er er maskerede i normal visning. Link afsløres kun ved udtrykkelig kopiering/redigering, er kun tilgængeligt for ejer/admin og indgår fortsat ikke i IndexedDB. Appearance indeholder fem farver, tre baggrunde og auto/kompakt/luftig tæthed pr. enhed/familie.

Login og opret konto er adskilt. Glemt adgangskode bruger resetPasswordForEmail, og PASSWORD_RECOVERY åbner en formular med gentagelse af ny adgangskode. Callback bygger på aktuel origin + pathname. Signup bruger samme callback. Konto viser email/medlemsrolle, adgangskodeskift, logout og plads til det samlede kontosletteflow.

## Backend og live-release

Migration 20260929062752_product_access er anvendt og registreret. Den tilføjer kun list_household_members og revoke_household_invitation med offentlige SECURITY INVOKER-wrappere, private SECURITY DEFINER-hjælpere, låst search_path, eksplicit Auth/medlemskontrol og grants. Ingen eksisterende rækker omskrives.

[Live-snapshot](../supabase/schema/live-after-product.json) inkluderer nu også private funktioner og deres ACL. Preflight matchede tidligere public schema. Backup 1814861545 fra 2026-09-29 03:34:48 UTC var COMPLETED. Alle eksisterende tabellers fulde rækkefingeraftryk, tællinger samt Auth/Storage-tællinger var identiske før/efter migration og efter isoleret live-smoke. De aktuelle 273 kalenderposter, 5 personer og 4 feeds er bevaret; testfixtures blev fjernet.

Live Auth havde allerede Site URL http://localhost:5173 og redirect http://localhost:5173/** ved preflight. Den eksisterende redirect er bevaret, og præcise localhost/127.0.0.1-callbacks til port 5173, 5178 og 5179 er tilføjet. Kun denne egenskab blev pushed fra den smalle profil supabase/deploy/local-auth; 12 udeklarerede serveregenskaber blev efterladt uændrede. Push aldrig rodens lokale stack-konfiguration til live. Ved endelig public URL skal profilen gennemgås/erstattes, så gamle lokale adresser ikke utilsigtet genindføres.

Security Advisor har ingen nye fund. Den eksisterende [advarsel om lækkede adgangskoder](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) er uændret. Performance viser kun eksisterende INFO om [ubrugte indeks](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) og [Auth-forbindelser](https://supabase.com/docs/guides/deployment/going-into-prod). Edge Function import-calendar-feed er stadig ACTIVE, version 10; hverken kode eller deployment er ændret i Mega 4.

## Reproducerbar verifikation

Start den isolerede stack og app som beskrevet i [backend.md](backend.md). Kommandoer fra repo-roden:

- npm.cmd --prefix app test
- node scripts/test-database.mjs
- npx.cmd --yes deno@2.9.6 task --config supabase/functions/deno.json test
- npx.cmd --yes deno@2.9.6 task --config supabase/functions/deno.json check
- node app/tests/browser.mjs
- node app/tests/calendar-browser.mjs
- node app/tests/product-browser.mjs
- node app/scripts/preview-local.mjs, og i anden terminal node app/tests/task-offline-browser.mjs
- npm.cmd --prefix app run build

Resultat: 67 Node-tests, 113 SQL-checks, 12 Edge-tests, grundflowet i browser, 22 kalenderchecks, 20 offlinechecks og 23 produktchecks. Build/typecheck er grønne. Produktchecket tester rigtig lokal recovery-mail, invitation mellem to brugere, rollebegrænsning, arkivering, privat feedvisning, enhedsindstillinger, PIN, wake-fallback, fejringer, fokusfælde, reduceret visualViewport, inaktivitet, midnat og genlogin.

Skærme: 375×667, 390×844, 430×932, 768×1024, 820×1180, 1024×600, 1024×768, 1280×800, 1920×1080, 1366×768 og 1440×900. Screenshots og detaljerede lokale resultater ligger ignoreret i supabase/.temp/mega4. Tests kører Chrome på Windows; et fysisk iOS/Android-tastatur og native lifecycle testes ved emballeringen i Mega 5.

Live-smoke kræver udtrykkeligt flag: node scripts/product-live-smoke.mjs --allow-live-tests. Scriptet er låst til projektet ovenfor, opretter egne fixturebrugere/familier, kører 16 checks og rydder op igen. Recovery testet live med et genereret link og rigtig passwordændring på en fixture; ingen rigtig familiemedlemskonto ændres, og der sendes ikke live-testmail. Credentials behandles kun i hukommelsen.

## Mega 5

Offentlig HTTPS-placering og produktions-Auth/SMTP/redirects, Capacitor/native deep links og push, kontosletning og privatlivs-/storemateriale samt fysisk iOS/Android-test og device management. Ingen af disse er nødvendige for den nu testede weboplevelse på mobil og kiosk.

Kilder til implementeringskontrakter: [Supabase recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [password Auth](https://supabase.com/docs/guides/auth/passwords) og [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).
