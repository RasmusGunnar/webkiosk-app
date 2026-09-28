# Kalendersemantik (Mega 2)

Kalenderen bruger samme responsive app på mobil og vægskærm. Mobil starter i dag, desktop i uge; et manuelt valg gemmes under `familiekalender.calendar-view`. Datoer behandles som lokale kalenderdatoer, så sommertid ikke flytter en forekomst.

## Forekomster og lagring

`calendar-semantics.js` materialiserer ugentlige serier og fødselsdage uden at oprette ekstra database-rækker. Fødselsdage bruger forekomstens år til alder, og 29. februar vises 28. februar i ikke-skudår. Fødselsdagseditoren viser basens oprindelige dato, også når man åbner en virtuel årsforekomst.

- **Kun denne:** behold base og tilføj en exception; gem en separat override, også for første forekomst. `originalDate` bevarer koblingen, hvis aftalen flyttes. Eksisterende overrides opdateres på deres eget ID.
- **Denne og frem:** afslut gammel serie dagen før valgt oprindelig forekomst. Start ny serie på skæringsdatoen. Viderefør ukendt JSON, slutdato og fremtidige exceptions; flyt tilhørsforholdet for fremtidige overrides til den nye serie. Individuelle tilpasninger og udførte opgaver bevares.
- **Hele serien:** behold oprindelig startdato og eksisterende overrides. Datofeltet låses; flyt en konkret forekomst med Kun denne. Hvis gentagelse slås fra, bevares individuelle overrides som konkrete aftaler.
- **Udført:** en gentaget opgave gemmes som en override for den valgte forekomst. En gammel bases done gælder kun basens oprindelige dag. Done-checkbox gælder den valgte forekomst, også ved et bredere editorscope.
- **Sletning:** Kun denne tilføjer exception og sletter eventuel override. Denne og frem lukker basen og fjerner senere overrides efter deres oprindelige dato. Hele serien sletter den aktuelle base og dens overrides. Efter en opdeling er gamle og nye segmenter selvstændige serier.
- **Alle hverdage:** opret mandag–fredag i den valgte uge samlet. Med ugentlig gentagelse bliver det fem ugentlige serier; ellers fem engangsaftaler.

`mutate_calendar` gemmer alle rækker i én transaktion med eksisterende RLS og validering. Forventede `updated_at`-værdier afviser gamle editorer. En lås pr. husstand serialiserer kalenderbatcher. Ved konflikt beholdes kladden, og brugeren får besked om at lukke og genåbne aftalen.

Stabile person-ID'er styrer navne og filtre. Fælles Alle-aftaler vises under alle personfiltre. Flere deltagere/fælles aftaler har neutral farve; en enkelt deltager bruger sin personfarve.

## Mærkedage og importerede aftaler

`milestones.js` indeholder legacy-listens faste, påskerelaterede og relative traditioner, inklusive mors dag. De er virtuelle og undertrykkes, hvis en bruger/importeret aftale på samme dato har samme normaliserede titel eller en kendt alias. Store bededag er tydeligt mærket traditionel. Den historiske april-fødselsdag har det præcise navn Dronning Margrethes fødselsdag. Listen er produkttraditioner, ikke en juridisk helligdagskalender.

Aula, Google og ICS vises med diskret kilde og tilknyttet person. Edge Function leverer konkrete forekomster; kilde-RRULE giver aldrig lokal ugentlig serie. Kalendereditoren er **skrivebeskyttet for importerede aftaler**, inklusive person/type/note, med besked om at redigere i kilden. Eksisterende importerede metadata bevares. Dette undgår en parallel lokal redigeringsmodel og overskrivning ved sync. Eksisterende feed-settings/import fungerer fortsat; ingen Edge Function-ændring indgår i Mega 2.

## Realtime

En ny `calendar_revisions`-række pr. husstand tæller ændringer på calendar_items, household_people og calendar_feeds. Triggers udfører revisionen i samme transaktion, også ved sletning. Kun tællere og husstands-ID publiceres, aldrig eventindhold eller private feed-URLs. RLS giver kun medlemmer adgang.

Appen har ét abonnement på den aktive husstand og genindlæser ved revision, genforbindelse, bekræftet Postgres-strøm og tilbagevenden til fanen. Gamle sessioner/forespørgsler ignoreres. Logout/husstandsskift fjerner abonnementet. Åbne editor-/settings-DOM-elementer bevares ved baggrundsopdateringer; usendte værdier bliver stående.

## Verifikation

```powershell
npm.cmd --prefix app test
node scripts/test-database.mjs
npm.cmd --prefix app run dev:local
# I en anden terminal:
node app/tests/browser.mjs
node app/tests/calendar-browser.mjs
npm.cmd --prefix app run build
```

Den lokale Supabase-stack skal have realtime aktiveret. Begge browserforløb er låst til localhost, og alle testdata ryddes. Databasefixtures rulles tilbage. Kalenderbrowserforløbet bruger to isolerede browserkontekster med dansk tidszone og fast dato.

Live-smoke er særskilt og kræver et bevidst miljøvalg:
`node scripts/calendar-live-smoke.mjs --allow-live-tests`.
Den opretter kun én midlertidig loginbruger/husstand, tester RPC/RLS/realtime og rydder sine egne fixtures. Eksisterende login/data berøres ikke. Credentials læses i hukommelsen via CLI og skrives ikke til filer.

Mega 3: offline-cache, ændringskø og konfliktoplevelse ved længere frakobling. Push og et særskilt kiosk/device-login er endnu ikke implementeret. Offentlig hosting er ikke en del af denne kalenderrelease.
