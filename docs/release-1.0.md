# Familiekalender 1.0 — release candidate
Status 2026-09-29: **BLOCKED for offentlig lancering og stores**. Implementeringen og backend er verificeret; offentlig hosting, SMTP, kontaktoplysninger og signerede enhedstests mangler.

## Identitet og destinationer
- App: Familiekalender. ID på begge platforme: `dk.rasmusgunnar.familiekalender`.
- npm: `1.0.0-rc.1`; Android versionName/iOS marketing version: `1.0.0`; versionCode/CFBundleVersion: `1`.
- Øg begge native buildnumre ved hver upload. Øg marketing version ved næste offentlig udgave. RC-label hører til Git/npm/releasenoter, ikke et ikke-numerisk Apple buildnummer.
- Backend: **oyyqniwppytipdktzwsy**, EU West (Irland), `https://oyyqniwppytipdktzwsy.supabase.co`.
- Offentlig URL: **ikke oprettet**. Ingen preview eller production er deployet.
- Foreslået Vercel-destination: projekt **familiekalender**, team **RGJCONSULT / rgjconsult**, team ID `team_McpwEDxDp1EkPpQzcBAQsD3w`, GitHub `RasmusGunnar/webkiosk-app`. Automatisk approval review afviste deployment, fordi teamdestinationen kræver udtrykkelig godkendelse. CLI er logget ud.
- Efter deployment: `PUBLIC_URL/privacy`, `PUBLIC_URL/support`, `PUBLIC_URL/delete-account`.
- Rollback-reference før Mega 5: **989f23d195a8cf55e5e979f39e3adeaa9c97e283**.

## Webdeployment — efter destinationsgodkendelse
Repoets `vercel.json` bruger repository root, `npm --prefix app ci`, `npm --prefix app run build`, output `app/dist`, SPA-rewrite og sikkerheds-/cacheheaders. Framework: Vite. **Root Directory skal være repository root**, da kommandoerne allerede peger på app. Legacy HTML er ikke entrypoint og uploades ikke i det afgrænsede CLI-deploy.

1. Log ind med `npx vercel@61.0.0 login`, og link/opret kun projektet i det godkendte team: `npx vercel@61.0.0 link --scope rgjconsult --project familiekalender`.
2. Vercel Environment Variables for Preview og Production: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (kun public/anon, aldrig service role), `VITE_NATIVE_PUSH_ENABLED=false`. Den endelige `VITE_PUBLIC_APP_URL` sættes til production origin, når det er kendt. Preview kan bruge sin egen origin til links.
3. Deploy preview: `npx vercel@61.0.0 deploy --scope rgjconsult`. Bevar previewbeskyttelse. Verificér ny app, login, privacy/support, SPA-reloads og manifest. Tilføj den præcise preview callback midlertidigt til Auth-allowlist, hvis signup/recovery skal verificeres der.
4. Når preview er grøn og destinationen er godkendt: `npx vercel@61.0.0 deploy --prod --scope rgjconsult`. Notér den faktiske URL, sæt `VITE_PUBLIC_APP_URL`, og redeploy.
5. Konfigurér production Auth nedenfor, fjern midlertidig previewcallback, og kør den offentlige smoke-test.

Ingen dummy production URL er skrevet til live Auth. Site URL står derfor stadig på `http://localhost:5173`; dette er en **konkret releaseblokering**, ikke færdig production-konfiguration.

## Auth og mails
Live er følgende verificeret: emailconfirmation aktiv, native callback `familiekalender://auth/callback` allowlisted, lokale callbacks bevaret, leaked-password protection **aktiveret**, minimum **8 tegn**, danske confirmation/recovery/invite/email-change templates **anvendt**.

Custom SMTP er **ikke konfigureret**. Supabases standardmail er begrænset til godkendte teamadresser og er ikke egnet som generel production-mail. Vælg SMTP-afsender/domæne og leverandør, verificér SPF/DKIM/DMARC, slå click tracking fra på authlinks, og angiv credentials sikkert i Supabase Dashboard → Authentication → Email → SMTP. Send en kontrolleret confirmation/recovery-test til egen mailbox bagefter. Ingen SMTP-passwords er i Git.

Når public URL er endelig:
```powershell
node scripts/prepare-production-auth.mjs https://FINAL_DOMAIN
npx supabase@2.118.0 config diff --workdir supabase/.temp/production-auth --project-ref oyyqniwppytipdktzwsy
npx supabase@2.118.0 config push --workdir supabase/.temp/production-auth --project-ref oyyqniwppytipdktzwsy
```
**Kør aldrig config push med repoets root-config**, som er lokal Docker-konfiguration. Generatoren accepterer kun en HTTPS-origin og skriver en snæver profil i ignored `.temp`. Det brugte testdomæne `release-validation.example.invalid` blev kun brugt til en read-only diff, aldrig anvendt.

`scripts/configure-auth-security.mjs --apply --templates` kan reprodu­cere passwordbeskyttelse og de danske templates via Management API med `SUPABASE_ACCESS_TOKEN` i procesmiljøet. SMTP indgår kun, hvis alle `FK_SMTP_*`-variabler er givet. Scriptet printer aldrig credentials. Se [production-auth](../supabase/deploy/production-auth/README.md).

Web beholder eksisterende authflow. Native bruger PKCE og privat code-verifier på samme installation. Cold/warm app-links behandles af App-plugin; recovery går til passwordformularen, og engangskoden kan ikke genbruges. Native PKCE er testet med rigtig lokal Auth + Mailpit, ikke på fysisk telefon.

## Native build
Brug Node **24.x**. Der findes fulde Android- og iOS/SPM-projekter i repoet.

```powershell
cd app
npm ci
npm run assets
npm run build
npx cap sync
npm run verify:native
```
`cap:android` og `cap:ios` åbner IDE'en. `cap:sync` bygger og synkroniserer begge platforme. Til release kræver `build:release` den verificerede public origin og det korrekte backendprojekt; almindelig build kan stadig bruges lokalt.

Capacitor 8.5.2 med App, Keyboard, SplashScreen, PushNotifications, Filesystem og Share. Appens mobile/kiosk mode er uafhængig af native/web/PWA platform. Native assets leveres i pakken, og web-service-worker registreres ikke i native WebView. Native debuglogging og WebView-inspektion er deaktiveret i releasekonfigurationen.

### Android på denne Windows-maskine
Projektet bruger Java 21, minSdk **24**, compile/target SDK **36**. Debug-build blev forsøgt og stoppede med:
`ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.`
Android Studio og Android SDK blev heller ikke fundet. Ingen APK/AAB er bygget eller installeret.

Installér Android Studio 2025.2.1 eller nyere med JDK 21, Android SDK Platform 36, build-tools og platform-tools. Accepter selv SDK-licenser. Eksempel efter installation på standardstier:
```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
cd C:\Dev\Familiekalender\app
npm run android:debug
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```
Tilpas stier til faktisk installation. Appen bruger ingen cleartext-backend, private file-provider, contextual notification permission og standard filvælger. Manifestets øvrige permissions skal også kontrolleres i **merged manifest** efter SDK-build. Rotation er tilladt; safe areas/keyboard skal måles på enhed. Kiosk bruger native keep-screen-on, frigives ved pause og genetableres ved resume. Android back lukker dialog, går til I dag og kan derefter minimere; kiosk forbliver i appen. Det er ikke Android Device Owner.

**Én keystoreprocedure** efter JDK-installation:
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.familiekalender-signing"
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v -keystore "$env:USERPROFILE\.familiekalender-signing\upload.jks" -alias familiekalender-upload -keyalg RSA -keysize 4096 -validity 10000
```
Vælg password i prompten og opbevar keystore/password i en sikker separat backup. Brug ikke repoet. Sæt derefter procesvariablerne `FK_KEYSTORE_PATH`, `FK_KEYSTORE_PASSWORD`, `FK_KEY_ALIAS`, `FK_KEY_PASSWORD` fra password manager, og kør `npm run android:release`. Passwords må ikke skrives i kommandohistorik eller tracked properties. AAB forventes i `android/app/build/outputs/bundle/release/app-release.aab`. Release-task fejler bevidst uden signing; den bruger aldrig debugnøglen. Aktivér Google Play App Signing og upload til Internal testing først.

### iOS på Mac
1. Installer Node 24 og Xcode **26+** med iOS 26 SDK. Hent releasecommit, kør `cd app && npm ci`, og opret lokal ignored env med public URL og Supabase public key.
2. Kør `npm run build:release && npx cap sync ios && npm run cap:ios`. Swift Package Manager bruges; CocoaPods er ikke nødvendig.
3. Vælg App target → Signing & Capabilities → dit verificerede Apple Team, automatisk signing og bundle ID `dk.rasmusgunnar.familiekalender`. Minimum iOS **15**. Projektet indeholder iPhone/iPad-orienteringer, URL scheme, App/SceneDelegate-links, native wake plugin, opaque ikon og privacy-manifest.
4. Tilføj Associated Domains først med det endelige domæne og korrekte AASA. Push-capability og APS entitlement tilføjes kun, hvis push skal aktiveres med en korrekt provisioning profile. `Push.entitlements.example` er ikke aktiv signing-konfiguration.
5. Test på iPhone/iPad: login, recovery/invite, tastatur, avatarvalg, eksportdeling, offline cold start, realtime/resume og kiosk. Ingen Xcode-build eller fysisk iOS-test er udført på Windows.
6. Product → Archive → Validate App → Distribute App → App Store Connect → TestFlight. Gennemse aggregeret privacy report, screenshots, demo-login og export-compliance. Almindelig HTTPS-kryptering er markeret; bekræft den endelige build i Apples questionnaire.

## Links, push og offline
Én linkmodel: `/auth/callback`, `/invite#invite=...`, `/calendar?date=YYYY-MM-DD&item=UUID`. Kalenderlinks vælger en dato i aktiv familie; RLS styrer adgang. Native bruger `familiekalender://auth/callback`, `familiekalender://invite#invite=...` og tilsvarende calendar path. Webinvitationer tilbyder også en eksplicit Åbn i appen-genvej. Udløbne authlinks viser en forklaring, og recovery rydder URL/state.

Universal/App Links er **ikke aktiveret** uden real Team ID/certifikatfingeraftryk. Korrekte templates og trin findes i [associations](../app/resources/associations/README.md); ingen falske AASA/assetlinks ligger i public.

Push er slukket som standard, kræver eksplicit knaptryk til tilladelse og har ingen reminder-engine. Native installationer registreres som bruger/familie/platform/version/last_seen med RLS. Tokenrefresh erstatter tokens; online logout fjerner enhedsregistrering, og OS-unregister forsøges også offline. Ved offline logout kan serverrække blive tilbage; `expires_at` gør den ugyldig for fremtidig levering efter 24 timer. En fremtidig afsender **skal** kontrollere membership, token og udløb. Ingen annoncer/analytics.

For Android push kræves projektets egne FCM-oplysninger i ignored `app/android/app/google-services.json`; iOS kræver Apple push-capability/provisioning og APNs-servercredential. Ingen FCN-konfiguration bruges. Slå først `VITE_NATIVE_PUSH_ENABLED=true` til efter provider- og enhedstest. Legacy Firebase-filer er ikke den nye pushkonfiguration.

Web-PWA har standalone manifest, ikoner og versionsbestemt app-shell-cache. En ny service worker installerer hele asset-sættet før skift; eksisterende editor genindlæses ikke automatisk. IndexedDB/queue er separat fra app-shell. Native pause stopper realtime/authrefresh, resume bruger samme kontrollerede refresh som web og bevarer editor-DOM. Kioskopsætning og PIN er lokale UX-kontroller.

## Konto, privacy og drift
Sletning findes i Konto og på `/delete-account` efter login. Edge Function verificerer JWT, samme bruger og password. For hver familie, hvor kontoen er sidste ejer, kræves særskilt bekræftelse på familiesletning; fælles familier med andre ejere bevares. Der er ikke tilføjet et ejerskabsoverførsels-UI i denne release. Børneprofiler er ikke Auth-konti.

Databasefasen er atomisk: slettejob, anonymisering, medlemskaber og autoriseret familiecascade. Shared avatars beholder filindhold og får neutral uploader-metadata. Familiens slettede avatarer fjernes via Storage API, og Auth-kontoen slettes derefter med Admin API. Ved afbrudt oprydning kan brugeren gentage sletning; internt job forsvinder med Auth-kontoen. En supportoperatør kan undersøge `account_deletion_jobs` server-side. Tabellen har ingen klientgrants/policies med adgang; Advisorens INFO om ingen policies er tilsigtet default deny. Ingen frontend service key.

Email/password-sletteflow er testet. Konti med allerede aktiveret MFA afvises sikkert og kræver bekræftet supportflow; appen tilbyder ikke MFA-tilmelding i 1.0. Dette skal håndteres, hvis MFA-konti optages i den offentlige release.

Eksport henter ét konsistent JSON-snapshot af den valgte autoriserede familie: personer, kalender/opgaver, belønning, feedmetadata og medlemskab. Private feedlinks, authdata og tokens er udeladt. Native deler en privat cachefil; den ryddes ved logout/kontosletning eller næste start/eksport efter 24 timer. En bruger-gemt kopi lever uden for appens kontrol. Kontosletning fjerner også den aktuelle kontos lokale enhedsprofil/PIN; normalt logout bevarer præferencer.

[Privacy](privacy.md), [data inventory](store-data-inventory.md) og [storemetadata](store-metadata.md) er skrevet. Før offentlig lancering skal dataansvarlig/supportkontakt, SMTP-leverandør og aftalt retention for backups/logs fastlægges. Privacy og support har tydelige TODO'er; de er ikke færdige juridiske virksomhedsoplysninger.

## Live rollout og rollback
- Verificeret fuldført fysisk backup: 2026-09-29 03:34:48 UTC, ID 1814861545.
- Preflight: ingen drift mod `live-after-product.json`.
- Migration **20260929093927_release_native_account** anvendt og registreret. `delete-account` Edge Function deployet.
- Public schema efter ændringen: `supabase/schema/live-after-release.json`.
- Originale data uændrede efter migration og live smoke: 273 calendar_items, 5 household_people, 4 feeds, 2 households, 2 memberships, 1 Auth user; øvrige fuldrække-fingeraftryk også uændrede. Testkonti/filer/familier var tilfældige isolerede fixtures og er ryddet.
- Security Advisor: 0 WARN/ERROR; kun tilsigtet INFO om den serverinterne slettekø.
- Auth templates/password/callback ændringer er snævre konfigurationsopdateringer; Site URL venter på hosting. Ingen eksisterende private feed-URLs eller credentials logges af releasekoden.

Rollback: deploy tidligere frontendcommit fra en isoleret checkout/worktree; overskriv ikke igangværende lokal udvikling. Den additive migration kan blive liggende med den gamle frontend. Deaktiver ny slettefunktion ved behov, men drop ikke tabeller eller gendan hele databasebackup som rutinerollback — det vil miste nyere brugerdata. Kontosletning er irreversibel og er ikke en feature, der kan rulles tilbage ved frontendrollback.

## Verificering
Kommandoer fra repo root:
```powershell
npm --prefix app test
node scripts/test-database.mjs
npx deno@2.9.6 task --config supabase/functions/deno.json check
npx deno@2.9.6 task --config supabase/functions/deno.json test
node scripts/release-backend-smoke.mjs
node app/tests/native-auth.mjs
npm --prefix app run verify:native
npm --prefix app run build
```
Browserfixtures kræver `node app/scripts/dev-local.mjs` på 5178, `node app/scripts/preview-local.mjs` på 5179 og lokal `supabase functions serve delete-account`. Kør derefter `app/tests/browser.mjs`, `calendar-browser.mjs`, `product-browser.mjs`, `task-offline-browser.mjs` og `release-browser.mjs` med Node. Tests bruger kun localhost; live-smoke kræver udtrykkeligt `--allow-live-tests`.

Verificeret: 76 Node-tests, 148 SQL-checks, 13 Deno-tests og Edge TypeScript-check; 76 nummererede browserchecks plus foundation-browserpakken; 27 lokale og 27 live release-backendchecks; 5 PKCE-authchecks; 11 native struktur-/assetchecks. Npm audit: 0 sårbarheder. Frontenden er JavaScript og verificeres med build/runtime-tests; den er ikke omskrevet til TypeScript. Windows agent-browser-binær blev blokeret af OS-policy; Playwright med installeret Chrome blev brugt.

### Den krævede 34-punkts matrix
PASS lokal betyder ikke, at et offentligt domæne eller fysisk native device er testet.

| # | Check | Resultat |
|---|---|---|
| 1 | Production HTTPS load | BLOCKED: Vercel-destination ikke godkendt |
| 2 | Login | PASS lokal browser + live Auth API |
| 3 | Signup | PASS lokal confirmation/browser; offentlig mail afventer SMTP |
| 4 | Recovery | PASS lokal mail/browser + native PKCE adapter |
| 5 | Invitation | PASS lokal browser + eksisterende live RPC-regler |
| 6 | Offline | PASS production-build/PWA; native device afventer |
| 7 | Kiosk | PASS web/mobile/vægstørrelser; native device afventer |
| 8 | Privacy/support | PASS lokal direkte navigation og reload; public URL afventer |
| 9 | Android build/install | BLOCKED: Java/SDK/Studio mangler |
| 10 | Android login | BLOCKED: kræver installeret build |
| 11 | Android calendar | BLOCKED: kræver installeret build |
| 12 | Android realtime | BLOCKED: kræver to aktive enheder |
| 13 | Android offline | BLOCKED: kræver installeret build/cold start |
| 14 | Android task complete | BLOCKED: kræver installeret build |
| 15 | Android celebration | BLOCKED: kræver installeret build |
| 16 | Android avatar | BLOCKED: systemfilvælger kræver enhed |
| 17 | Android deep link | Struktur og parser PASS; device BLOCKED |
| 18 | Android recovery | PKCE adapter PASS; device BLOCKED |
| 19 | Android invite | Parser/webflow PASS; device BLOCKED |
| 20 | Android back | Implementeret; device BLOCKED |
| 21 | Android resume | Lifecycle-enhedstest PASS; device BLOCKED |
| 22 | Android kiosk | Wake plugin implementeret; device BLOCKED |
| 23 | iOS Capacitor sync | PASS på Windows |
| 24 | iOS plist/capabilities | Plist/privacy PASS; signing/valgfri capabilities afventer Mac/Team |
| 25 | iOS link config | Custom scheme/SceneDelegate PASS; verified domain afventer |
| 26 | iOS icons/splash | PASS filformat/dimensioner/opaque app icon |
| 27 | RLS regression | PASS 148 SQL-checks og live adgangskontrol |
| 28 | Account deletion | PASS lokal UI/SQL/Edge og live fixtures |
| 29 | Export | PASS download, autorisation og hemmelighedsfiltrering |
| 30 | No secrets | PASS ny releasekontrol før commit; env/signing/providerfiler ignored |
| 31 | No feed URL logs | PASS importerens sikkerhedstests og ny Edge logs uden requestdata |
| 32 | Web build | PASS |
| 33 | Typecheck | PASS Edge TypeScript; frontend JavaScript build/runtime |
| 34 | Mega 1–4 regression | PASS Node, SQL og browserpakker |

## Resterende releasehandlinger
1. Godkend den konkrete Vercel-destination, og log CLI/integration ind. Gennemfør preview → HTTPS smoke → production → endelig Auth Site URL.
2. Angiv en verificeret SMTP-afsender og credentials i Supabase samt reel support-/dataansvarlig kontakt og retentionbeslutninger. Test faktisk delivery.
3. Installer Android Studio/JDK/SDK, udfør debug/device-matrix, opret uploadkeystore via proceduren ovenfor og byg signed AAB.
4. Brug Mac/Xcode med Apple Developer Team til device-matrix, signing, Archive og TestFlight.
5. Udfyld butikernes privacy/data safety, alder/målgruppe, kontakt/traderstatus, rigtige native screenshots og et isoleret reviewer-login. Kontoernes verificering og evt. påkrævet lukket test skal være afsluttet.

Push credentials og verified HTTPS App Links kan vente, når release klart bruger custom-scheme fallback og push forbliver slukket. De er ikke alene App Store-blokeringer.

## Aktuelle officielle krav
Kontrolleret 2026-09-29:
- Nye Play-apps/updates skal targete Android 16/API 36 fra 31. august 2026; projektet targeter 36. [Google target SDK](https://developer.android.com/google/play/requirements/target-sdk).
- Apple uploads kræver Xcode 26+/iOS 26 SDK fra 28. april 2026. [Apple kommende krav](https://developer.apple.com/news/upcoming-requirements/). Native minimum OS er projektets iOS 15/Android 24, ikke samme tal som build-SDK.
- Kontooprettelse kræver en kontosletningsvej i appen; Google kræver også en fungerende offentlig webvej. [Apple kontosletning](https://developer.apple.com/support/offering-account-deletion-in-your-app/), [Google kontosletning](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).
- Privacy-/Data safety-svar skal afspejle den faktiske build og SDK'er; reviewer skal kunne logge ind. Se storematerialet og de officielle links dér.
- For nye personlige Google Play-konti oprettet efter 13. november 2023 gælder lukket test med mindst 12 tilmeldte testere i 14 sammenhængende dage før ansøgning om production-adgang. Kontotype/oprettelsesdato er ukendt; kravet påstås derfor ikke allerede opfyldt. [Google testkrav](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).
