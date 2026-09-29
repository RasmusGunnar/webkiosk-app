# Product UX 2.0

Dette beskriver UX 2.0-baselinen. Den aktuelle mobiloplevelse er efterfølgende tilpasset i [Product UX 2.1](product-ux-2-1.md) og afventer visuel godkendelse.

Implementeret lokalt på main med baseline fcfe3ba0b819b54223e974fff900b1fd434a0058. Produktprincipperne blev konkretiseret efter brugerens valg. Ingen offentlig deployment, store submission, signing, ændring af live database eller nye dependencies.

## Mobil og normal web

I dag, Kalender, Opgaver, Madplan, Indkøb og Familie er seks egentlige destinationer. Mobil bruger fast bundnavigation; tablet en smal sidemenu og desktop en fuld sidemenu. Første besøg åbner I dag. Sidst valgte destination huskes pr. bruger/familie på enheden. Kalenderens udtrykkelige dag/ugevalg bevares; kalenderen åbner som udgangspunkt dag på mobil og uge på desktop.

I dag viser dagens tal, næste aftale, hurtig oprettelse, familiens aftaler/opgaver og aftenens mad. Opgaver har et samlet fremskridt og hurtig oprettelse med personvalg; fuld editor med flere personer og gentagelser er stadig tilgængelig. Familie har profiler og tydelige indgange til medlemmer/invitationer, import, enhed og konto. Auth-medlemskaber og børneprofiler er fortsat forskellige ting.

Madplan er en navigerbar uge med opret/rediger/slet, valgfri spisetid og ingredienser (én linje pr. vare). Flere retter samme dag er tilladt. Ingredienser kan overføres samlet til indkøb; eksisterende åbne varer med samme normaliserede linjetekst springes over. Mængder er brugerens tekst, ikke automatisk opskriftsberegning. Manuelle dubletter og samtidige tilføjelser fra forskellige enheder er tilladt.

Indkøb er familiens løbende liste, uafhængig af oprettelsesdatoen. Hurtig tilføjelse, mængde/note, kategorier, redigering, afkrydsning/fortryd og eksplicit oprydning af købte varer. Handlingsfeedback er synlig øverst på skærmen, blokerer ikke tryk på indholdet og kan lukkes. Et destinationsskift rydder den tidligere statusbesked.

## Kiosk og væg

Kiosk aktiveres fortsat eksplicit og er bundet til bruger/familie. Væggen har stort ur/dato, personfilter, I dag/Uge/Opgaver, aftensmad og kommende aftaler. Indhold og navigation holder sig inden for skærmens højde. Lange lister ruller i deres egne områder. Kompakt layout til 1024×600 bruger mindre header og én kolonne i sidepanelet.

Aftaler åbner en læsevisning; oprettelse og almindelig redigering foretages fra mobil/normal web. Opgaver kan stadig krydses af, og belønninger fungerer. Administration ligger bag eksisterende PIN-beskyttede indstillinger. Ingen enterprise device-owner-funktion er tilføjet. Native wake lock, pause/resume og hardware-back bruger de eksisterende integrationer. Kioskens timeout afbryder ikke en åben læsevisning.

## Data og sikkerhed

Den eksisterende public.calendar_items-model understøtter allerede teksttyper. Nye poster bruger type Madplan eller Indkøb. Ingen SQL-migration eller ændrede policies/RPC'er er nødvendige.

| Data | Eksisterende felt |
| --- | --- |
| Ret/vare | title |
| Retdag / varens oprettelsesdag | date |
| Valgfri spisetid | time |
| Ingredienslinjer / mængde eller note | note |
| Indkøbskategori | location |
| Købt/ikke købt | done |

Posterne bruger familiens eksisterende RLS, versionskontrol, sync_calendar_mutation, mutation receipts, realtime, IndexedDB og offlinekø. De filtreres fra den almindelige kalender/næste aftale og tæller aldrig som Opgave i belønninger. Indkøb er ikke transaktioner eller betalinger.

Eksportens calendar_and_tasks indeholder også de to nye typer med alle ovenstående felter. Eksisterende familiesletning omfatter dem automatisk. Privacy og data inventory er opdateret. Logout rydder lokal familiedata. UI-kladden før Gem lever kun i hukommelsen; gemte offlineændringer er holdbare og genafspilles med den eksisterende konfliktmodel.

Ved samtidig redigering af en ret afvises en gammel version, og brugeren vælger lokal/serverversion i den eksisterende synkroniseringsdialog. Realtime bevarer en åben planeditor samt ufærdige inline-inputs og fokus. Personindstillinger låses under gemning, så efterfølgende ændringer ikke forsvinder i en endnu igangværende opdatering.

Ældre frontendversioner kender ikke de nye typer og kan vise dem som generelle aktiviteter. Brug UX 2-versionen på alle enheder, når madplan/indkøb tages i brug; rollback af frontend sletter ingen data.

## Filer og verifikation

- app/src/product.css: responsivt designsystem og særskilt kiosklayout.
- app/src/lib/product-ui.js: navigation og visning af madplan/indkøb.
- app/src/lib/household-plans.js: typer, validering, adskillelse og ingrediensoverførsel.
- app/src/lib/plan-editor.js: editor og kiosk-læsevisning.
- app/src/main.js: integration med den eksisterende kalender, realtime, offline og familie.

Tests kører udelukkende mod lokal Supabase med isolerede fixtures. Browserpakkerne bruger Chrome/Playwright (den installerede agent-browser-binær er tidligere blokeret af Windows-policy).

Kommandoer fra repo-roden:

1. npm --prefix app test
2. node app/scripts/dev-local.mjs (port 5178)
3. node app/scripts/preview-local.mjs (production/offline, port 5179)
4. node app/tests/ux-browser.mjs
5. node app/tests/calendar-browser.mjs
6. node app/tests/product-browser.mjs
7. node app/tests/task-offline-browser.mjs
8. node app/tests/browser.mjs
9. Lokal functions serve delete-account, derefter node app/tests/release-browser.mjs
10. npm --prefix app run cap:sync
11. npm --prefix app run verify:native

Screenshots/resultater ligger i ignored supabase/.temp/ux2. Mobil/tablet/desktop: 375, 390, 430, 768, 820, 1366 og 1440 px. Kiosk: 1024×600, 1024×768, 1280×800 og 1920×1080. Testene dækker også reduceret tastaturviewport, offline genindlæsning, realtime, konfliktløsning, RLS-isolation, eksport og logout.

Fysisk Android/iOS-build og enhedstest er ikke udført i UX-opgaven; build og Capacitor sync kontrollerer webressourcerne og projektintegrationen.

## Resultat af lokal verifikation

Valideret 29. september 2026:

| Kontrol | Resultat |
| --- | --- |
| Unit tests, inklusive 8 nye plantests | 84/84 bestået |
| Kalender-browser | 22/22 bestået |
| Eksisterende produktflows | 23/23 bestået |
| Opgaver, offline og belønning | 20/20 bestået |
| Release, eksport og kontosletning (lokal Edge Function) | 11/11 bestået |
| Nye UX-flows | 21/21 bestået |
| Grundflow: auth, familie, personer, avatar, feeds og logout | Bestået |
| Webbuild og Capacitor sync til Android/iOS | Bestået |
| Native projektstruktur | 11/11 bestået |
| Secret-check og git diff --check | Bestået |

I alt 97 nummererede browserchecks plus grundflowet. De nye UX-checks fandt og verificerede rettelser af statusbeskeder, der dækkede indkøbslisten, samt kioskens højde ved 1024×600. Eksisterende produktchecks fandt og verificerede låsning af personindstillinger under gemning.

Ingen commit eller push er udført som del af UX-opgaven. Genererede webressourcer, lokale fixtures og screenshots er ikke versioneret.
