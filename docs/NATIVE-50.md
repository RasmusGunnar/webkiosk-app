# Product Batch 5.0 — lokal implementation og konfiguration

Dato: 9. oktober 2026. Branch: `feature/native-subscription-wall`.
Udgangspunkt: `34dbbc6db2a9b621948f164391e708633576738c`.
Ingen production-migration, Auth-ændring, Edge deployment, Vercel deployment, store-konfiguration, commit eller push er udført i denne batch.

## Samme app

- Eksisterende Vite-app og Capacitor-projekter er bevaret. Begge platforme bruger **`dk.rasmusgunnar.familiekalender`**.
- Marketing version `1.0.0`, native buildnummer `1`, npm `1.0.0-rc.1` er uændrede.
- Central platformservice eksponerer `isNative`, `isIOS`, `isAndroid`, `isWeb` og bevarer tidligere API.
- Personlig enhed og parret vægskærm bruger samme kalender-, mad- og opgavevisning. Vægskærmens kalender starter i dagvisning i portrait og ugevisning i landscape. Brugerens eksplicitte visningsvalg bevares.
- Session, device mode, household og abonnement løses ved start. Abonnementsopslag er tidsbegrænsede; offline-start venter ikke på RevenueCat eller netværk.
- Eksisterende auth-, invite-, recovery- og calendar-links er bevaret. Ny engangspairing bruger `familiekalender://wall/pair#pair=OPAQUE_TOKEN`.
- QR aflæses fra kamerabilledet gennem eksisterende file-capture-princip. Recipe Scan er ikke flyttet til en anden kameraarkitektur.

## Abonnement og tillidsgrænse

Den officielle `@revenuecat/purchases-capacitor` er fastlåst til `13.7.3`. Der er ikke installeret RevenueCat UI eller en anden betalingsplatform. SDK'et indlæses først, når en konfigureret native installation skal bruge det. App User ID er Supabase Auth UUID; aldrig email, familienavn eller device ID. Identitetsskift serialiseres, og logout nulstiller SDK-kunden.

Entitlement er `family_access`; offering er `default`. Månedlige og årlige pakker, produktnavn, pris og introperiode læses fra offeringens faktiske storeprodukter. De endelige produkt-ID'er og priser er ikke opfundet i appen. Køb kræver owner/admin, en serveroprettet claim og derefter en frisk RevenueCat REST-verifikation. SDK'ets lokale CustomerInfo kan ikke skrive household-entitlement. Genopretning bruger samme claim/verifikationsvej og samme household-row.

`subscription-verify` afviser manglende/ugyldig/anonymous bruger og kontrollerer household-admin samt claim før service-role bruges. Rollen kontrolleres igen i den endelige databasefunktion, så tilbagekaldt adminadgang ikke giver en ny verifikation.

`revenuecat-webhook` har `verify_jwt=false`, kræver dedikeret Bearer-secret før body/provider/database, validerer event, og læser den aktuelle tilstand fra RevenueCats faste HTTPS API. Kundens UUID mappes gennem serverens claim eller tidligere binding. Household-id i webhook-attributter ignoreres. Event-ID giver idempotens; forsinkede REST-resultater kan ikke overskrive nyere verifikation. Transfer-events opdaterer begge identificerede UUID'er og bruger stabile, længdebegrænsede hash-ID'er. Fejl giver retry-status; der kvitteres først efter databaseopdatering. Rå receipts, kundepayloads og API credentials gemmes ikke i abonnementstabellerne.

Aktiv, trial, opsagt-men-aktiv, grace, billing issue, udløbet og pending er understøttet. Adgang beregnes også ud fra den serververificerede udløbstid. Én køberbinding kan ikke anvendes på to familier. Familien kan dele adgang uden, at hvert medlem køber eller genopretter på egen konto.

**Enforcement er OFF** i `private.subscription_config`. Ingen eksisterende familie bliver låst ude. Den centrale service styrer owner/member/wall-gating, og wall-snapshot kontrollerer serverflaget før udlevering. Almindelige familiemedlemmers eksisterende kalender-RLS er fortsat baseret på medlemskab; denne batch er ikke en generel omskrivning af alle appens data-API'er til betalingskontrol. Før senere aktivering skal den ønskede serverpolitik for premium-handlinger og offlineadgang accepteres sammen med de rigtige storeprodukter. Lokal browsergating er eksplicit reviewkonfiguration; faktisk wall-enforcement er også testet i en rollback-transaktion.

## Vægskærmens adgang

- Enheden bruger en rigtig anonymous Supabase Auth-identitet, ikke en voksens password og ikke en falsk session.
- `household_devices` er en separat, begrænset adgangsmodel. Den eksisterende `native_devices` er fortsat personlig pushregistrering.
- Pairing: 256-bit random token og 40-bit manuel reservekode, SHA-256-hashes i databasen, 10 minutters levetid, én anvendelse og transaktionslås.
- Oprettelse kræver owner/admin. Indløsning kontrollerer stadig creatorens adminadgang. Forsøg begrænses til 8 pr. anonymous identitet og 300 globalt pr. 10 minutter; Auth har desuden egne IP-grænser. Afviste forsøg tæller også.
- Anonymous identiteter kan ikke oprette en familie eller indsættes som household-medlem. De får ingen generel kalender-, feed-, medlems- eller billing-adgang.
- `wall_snapshot` leverer en eksplicit projektion af personer, kalender, opgaver, madplan og relevant belønningsstatus. Ingen rå importpayload, private feedlinks, Auth-oplysninger eller receipts. Skjulte, arkiverede og kildefjernede imports udelades.
- Opgavefuldførelse går via `complete_task_as_device`; reward-ledger og eksisterende idempotens genbruges. Admin-, godkendelses- og konfigurationshandlinger er afvist. Ingen unrestricted calendar-update.
- Familiedata gemmes ikke som offline-snapshot på den parrede skærm. Visningen kan blive i hukommelsen under et kort forbindelsesudfald. Serveradgang ophører straks ved revoke; en forbundet skærm ryddes via device-row Realtime eller næste snapshot-poll (15 sekunder). En afbrudt enhed opdager revoke, når forbindelsen kommer tilbage.
- En voksen kan liste, omdøbe og fjerne adgang. Efter revoke fjernes data fra visningen og pairing åbnes igen.
- Det eksisterende native `DeviceScreen` holder skærmen vågen; web bruger Screen Wake Lock. Wake lock frigives ved revoke, logout, modeswitch og pause. Normal personlig mobil starter ikke wake lock. Fysisk OS-adfærd skal stadig testes.

## Database og Edge — kun anvendt lokalt

Migration: `20261009094600_native_household_subscription_wall.sql`.

Nye public-tabeller: `household_subscriptions`, `subscription_purchase_claims`, `subscription_events`, `household_devices`, `device_pairing_codes`. Private tabeller: `subscription_config`, `pairing_attempts`. Nye RLS-politikker, begrænsede RPC'er, anonymous membership-guard og device Realtime-publication. Ingen eksisterende data slettes eller konverteres. Den eksisterende reward-funktions adgangsguard udvides alene for device-complete/undo/claim; admin- og membership-funktioner er uændrede.

Nye Edge Functions: `subscription-verify`, `revenuecat-webhook`; fælles kontrakt i `_shared/subscription.ts`. Begge funktioner bruger eksplicit egen godkendelse med `verify_jwt=false` og må først deployes i en senere godkendt backendopgave.

Migrationen blev udviklet med lokal SQL, testet og til sidst registreret som anvendt i **lokal** migrationshistorik. Intet er anvendt hosted.

## Lokal drift og review

Windows reserverede de gamle Supabase-porte i Hyper-V-intervallet. Projektet bruger derfor nu API **47321**, DB **47322**, Studio **47323**, Mailpit **47324**, shadow DB **47320**. Projekt-ID og eksisterende Docker-volumes er bevaret. Ingen DB-reset, seed-reset eller tab af den lokale familiekopi. Lokal anonymous Auth er aktiveret. `scripts/local-supabase.mjs` beskytter fortsat test mod hosted-target.

Review:

```powershell
npm --prefix app run dev:native-review
# http://127.0.0.1:5185 — lokal Supabase og eksplicit DEV-provider
node app/tests/native50-api.mjs
node app/tests/native50-browser.mjs
```

Browsercheck kræver, at de lokale Edge Functions serveres med `NATIVE50_MOCK_PROVIDER=true` i en **ignored** env-fil, eksempelvis `supabase/.temp/native50/edge.env`. Brug `supabase functions serve --env-file supabase/.temp/native50/edge.env` med projektets CLI. Mock accepteres kun sammen med en kendt HTTP-loopback/lokal Docker-Supabase-URL; hosted HTTPS accepterer aldrig dette flag. Ingen RevenueCat serverkey behøves til dette lokale review.

`native-review.js` indlæses kun bag Vites compile-time DEV-guard og eksplicit loopback-kontrol. Fixturepriser og entitlement-states er ikke med i productionbundlen. Browseren kalder den rigtige lokale Edge Function og database ved køb/restore; kun provider/store-kaldet er simuleret. Dette er **ikke** en rigtig Apple/Google sandboxbetaling.

Galleri: `supabase/.temp/native50/review.html`, 34 billeder samt `browser-results.json` og `api-results.json`. Output er ignored. Syntetiske lokale testfamilier og Auth-users fjernes efter test; ingen fixtures oprettes i hosted eller Familien Tandrup Jakobsen.

## Manuel RevenueCat-konfiguration — senere

1. Opret eller vælg det verificerede Familiekalender-project i RevenueCat. Opret iOS- og Android-app med det eksisterende bundle/package ID ovenfor.
2. Forbind de rigtige App Store Connect- og Google Play-apps. Upload nødvendige store/servercredentials **kun** i RevenueCats sikre konfiguration, aldrig i app, Git eller reviewfiler.
3. Opret entitlement **`family_access`**. Vælg endelige månedlige/årlige produkt-ID'er i butikkerne, importér dem til RevenueCat, og knyt begge til dette entitlement.
4. Opret offering **`default`** med monthly- og annual-package. Kontrollér lokaliseret titel/pris, periode, eventuel intro/trial og store-eligibility. Appen tager disse værdier fra SDK'et.
5. Sæt de respektive **public SDK keys** i den native buildkonfiguration: `VITE_REVENUECAT_IOS_API_KEY` og `VITE_REVENUECAT_ANDROID_API_KEY`. De er clientkeys; brug aldrig REST-secret som VITE-variabel.
6. Opret en server-side RevenueCat REST API-key med adgang til kundens abonnementstilstand. Sæt den som Supabase Edge secret **`REVENUECAT_SECRET_API_KEY`**. Der må ikke stå en faktisk key i repoet.
7. Generér en separat lang, tilfældig webhook-secret (mindst 24 tegn; anbefalet mindst 32 random bytes) og sæt **`REVENUECAT_WEBHOOK_SECRET`** på Edge. RevenueCat → Integrations → Webhooks: HTTPS-endpoint `https://oyyqniwppytipdktzwsy.supabase.co/functions/v1/revenuecat-webhook`, Authorization-header `Bearer <den særskilte secret>`. Dette endpoint er kun en kommende destination; det er ikke oprettet/deployet i denne opgave.
8. Vælg restore/transfer-politik bevidst. Den nuværende app bruger samme Supabase UUID ved geninstallation og tillader ikke at flytte samme køb til en anden familie via klienten. Undgå en automatisk cross-account transfer-politik uden separat acceptance af konsekvenserne for begge household-bindinger.
9. Test webhook uden/forkert secret, authenticated TEST, rigtigt køb, fornyelse, opsigelse, udløb, grace, restore og dobbelt event. Sandbox grants afvises som standard; brug kun `REVENUECAT_ALLOW_SANDBOX=true` i et godkendt, isoleret sandbox-backendmiljø. Lad production enforcement være OFF, indtil begge stores er verificeret.

## Manuel Apple-konfiguration — senere

- App Store Connect: brug appen med bundle ID `dk.rasmusgunnar.familiekalender`; opret en subscription group og de besluttede monthly/yearly auto-renewable produkter. Udfyld pris, lokalisering, vilkår, availability og reviewoplysninger.
- Kontrollér nødvendige aftaler, bank/skatteoplysninger, RevenueCat storeconnection og server notifications.
- Opret sandbox-testere og test geninstallation/restore, korrekt køberkonto, annulleret køb, trial-eligibility, fornyelse og opsigelse på rigtig enhed.
- På Mac: sync, åbn eksisterende Xcode-project, vælg det rigtige signing team/provisioning, og byg til iPhone/iPad. In-App Purchase capability og RevenueCat/SPM dependency er tilføjet; Swift 5 og minimum iOS 15 er bevaret.
- Gennemgå merged privacy report inkl. RevenueCat, privacy labels, endelige vilkår/support, screenshots og versions/buildnumre før en senere storeupload.
- **MAC/XCODE DEVICE BUILD REQUIRED**. Windows-sync og strukturcheck er ikke bevis for en fungerende StoreKit-build.

## Manuel Google-konfiguration — senere

- Play Console: brug pakken `dk.rasmusgunnar.familiekalender`. Opret de besluttede subscription products/base plans for måned/år; vælg priser, availability og eventuelle offers.
- Forbind Play service credentials til RevenueCat med nødvendige store-rettigheder. Disse credentials hører ikke til i Android appen eller repoet.
- Opret license testers og internal test track. Rigtige Play Billing-køb/restore skal testes fra en Play-installeret testudgave med korrekt testkonto.
- Android er min SDK 24, compile/target SDK 36, Java 21. Activity bruger nu RevenueCat-kompatibel `singleTop`; billing-dependency tilføjes af SDK'et. Eksisterende kamera/file-provider/deep links/network restrictions er bevaret.
- **DEBUG BUILD BLOCKED: JDK/Java og Android SDK findes ikke på denne computer.** Installer JDK 21 og SDK Platform 36/build-tools/platform-tools, sæt faktiske `JAVA_HOME`/`ANDROID_HOME`, og kør `npm --prefix app run android:debug`. Kontrollér merged manifest, billing permission og device-flow efter native compilation. Ingen APK/AAB eller signing-key er oprettet i denne opgave.

## Manuel Supabase-konfiguration — senere

- Efter særskilt godkendelse: anvend den additive migration og deploy de to nye Edge Functions med deres eksplicitte auth-kontrakter. Bevar Calendar Sync, cron, Vault, recipe-preview og eksisterende secrets.
- Sæt de to RevenueCat **server** secrets ovenfor i Edge Function secrets; print dem aldrig. Public SDK keys er separate clientkonfigurationer.
- **MANUAL AUTH CONFIG REQUIRED:** hosted `/auth/v1/settings` blev kun læst og viste anonymous users OFF. Aktivér Anonymous Sign-Ins i Dashboard → Authentication → Sign In / Providers, Anonymous, først efter migration og sikkerhedsacceptance. Kontrollér Auth-IP-grænser og valgt captcha/botbeskyttelse mod det faktiske tabletflow. Ingen ændring af Site URL eller Auth redirects er udført.
- Bevar enforcement OFF. Aktivér først efter store/sandboxacceptance, afklaring af serverpolitik og kontrolleret afprøvning for eksisterende familier.
- Konto-/familiesletning opsiger ikke automatisk en Apple/Google-betaling. Storeadministration, RevenueCat-retention/erasure og endelige privacy-/abonnementsvilkår skal fastlægges før offentlig salgslancering; der er ikke implementeret en skjult refund/cancel-operation.

## Testevidens og begrænsninger

- App/unit, native abonnementstilstande, identitetsskift og offline startup: grønne.
- Nye API/RLS-checks: **51 PASS**, inklusive ægte lokale Edge-afvisninger, hashing/single-use/rate-limit, cross-household-afvisning, reward-idempotens, tilbagekaldt adminrolle og server-side expiry/enforcement.
- Nye browserflows: **9 PASS**, 34 screenshots, rigtig lokal Auth/DB/Edge ved pairing og verifikation. Owner/member/wall-gating, reload, QR, rename/revoke, mobil 375/390/430 og kiosk 1024/1280/1920 samt portrait.
- Subscription/photo Edge tests og typecheck: grønne. Allowance/rewards/recipes/photo/native-auth API: grønne. Aktuel Product Batch 4-, Polish24-, multi-day-person- og offline/realtime-browserregression: grønne.
- En ekstra kørsel af den gamle `desktop-kiosk-browser.mjs` fra UX 2.3 ramte forældede krav: `.calendar-source-badge` findes ikke i den allerede godkendte kompakte ugevisning, og måltidsrækker har siden fået tilladte `.meal-add`-handlinger. Dette er ikke registreret som PASS. Appkode på de steder er uændret fra godkendt main. Testfilen er efterladt uændret; de aktuelle Polish24- og Product Batch 4-checks dækker det nuværende mobil/kioskprodukt.
- Lokale Supabase security advisors: ingen WARN/ERROR. Secret-check omfatter Git-synlige ændringer og private keys, service-role JWT, OpenAI/RevenueCat secrets samt private feeds. Bundle kontrolleres separat for mockkonfiguration og secrets.
- Capacitor sync og strukturel kontrol erstatter ikke fysisk native test: køb, restore, store-management, kamera, deep links, pause/resume, rotation og keep-awake skal verificeres på rigtig iOS/Android.

## Officielle referencer

- [RevenueCat Capacitor-installation og Android launchMode](https://www.revenuecat.com/docs/getting-started/installation/capacitor)
- [RevenueCat kundeidentitet](https://www.revenuecat.com/docs/customers/identifying-customers)
- [RevenueCat REST API v1](https://www.revenuecat.com/docs/api-v1)
- [RevenueCat webhooks](https://www.revenuecat.com/docs/integrations/webhooks)
- [Webhook eventfelter og transfers](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields)
- [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
