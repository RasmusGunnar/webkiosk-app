# Aula: skoleinformation bliver til aktiviteter

Familiekalenderens **Opgave** er en familie-/pligtopgave med completion og eventuelle stjerner eller lommepenge. Aula-oplysninger er som udgangspunkt **Aktivitet**, også når det drejer sig om lektier, påmindelser eller afleveringsfrister.

## Kontrakt

| Intern classification | Normal proposed_action | Kalenderdestination |
| --- | --- | --- |
| HOMEWORK | CREATE_ACTIVITY | Aktivitet |
| REMINDER | CREATE_ACTIVITY | Aktivitet |
| DEADLINE | CREATE_ACTIVITY | Aktivitet |
| TRIP | CREATE_ACTIVITY | Aktivitet |
| CALENDAR_EVENT | CREATE_ACTIVITY | Aktivitet |
| GENERAL_INFO | NO_ACTION | Ingen kalenderpost |

`MATCH_EXISTING` genbruger en eksisterende **aktivitet** med samme dato, tidspunkt, titel og præcise personmængde. En eksisterende familieopgave matches aldrig. `CREATE_TASK` og `CREATE_EVENT` er ikke gyldige Aula-actions; AI-schema, servervalidering og databaseconstraint bruger kun `CREATE_ACTIVITY`, `NO_ACTION`, `MATCH_EXISTING`.

Review viser **Tilføj aktivitet** og personvælgeren fra kalenderen. Den voksne kan vælge én eller flere aktive household-personer. Manglende dato eller tom personliste blokerer accept. Serveren kontrollerer personernes household og aktivitet; barn, gæst eller fremmed household kan ikke acceptere fund.

Den interne classification ændrer ikke kalendertypen. Et fund med flere relevante personer bevares som ét fælles forslag. Efter accept indeholder `person_ids` præcis den valgte, deduplikerede personmængde. Findingens `person_id` sættes kun ved én person, ellers NULL. Kalenderens eksisterende `data.personIds`/`data.people` mirror og avatar-stack genbruges.

Kalenderens egne personfarver og avatarer bruges uændret, inklusive den eksisterende neutrale fælles farve og avatar-stack ved flere personer. Der sættes ingen Aula-farve på aktiviteten. `aulaAssisted`, `aulaSourceKind`, finding-ID og source-key er diskret kilde/proveniens. En accepteret aktivitet er ikke et eksternt, skrivebeskyttet ICS-feed.

Aula opretter ikke reward-felter, star-ledger, allowance-kontrakter eller task-occurrences. Kalenderens eksisterende reward-funktioner arbejder kun med typen `Opgave`, og afviser dermed completion af Aula-aktiviteter. Normale familieopgaver og eksisterende ICS-import ændres ikke.

## Eksempler

- »3.C skal huske tuscher onsdag« → **Husk tuscher**, onsdag, Ida, aktivitet med Idas farve og avatar, kilde Aula.
- »Matematik side 42-45 til torsdag« → **Matematik side 42-45**, torsdag, Ida, aktivitet, classification HOMEWORK.
- »Tur til Louisiana« og »Tag madpakke med« → tur-aktivitet og påmindelsesaktivitet, ikke to ture og ingen pligtopgave.

## Lokal validering

Fra `app`:

```text
node --test tests/aula-activity.test.js tests/aula-activity-visual.test.js
node tests/aula-activity-db.mjs
node tests/aula-db.mjs
node tests/aula-activity-browser.mjs
npm run typecheck
npm run build
```

Fixtures er syntetiske. DB-testene anvender de rigtige lokale migrations/RPC'er i PostgreSQL/WASM; de opretter ingen hosted data, kontakter ikke Aula og kalder ikke AI. Browserkontrollen bruger de rigtige UI-komponenter med et lokalt fixture-API. Live MitID, AI-generering og hosted realtime er ikke dokumenteret af disse tests.

Denne rettelse ligger i den endnu lokale Aula-integration og ændrer dens ikke-deployede oprettelsesmigration `20261109120555_aula_integration_10.sql`. Hvis en anden installation allerede har anvendt den oprindelige migration, kræves en særskilt forward-migration og datavurdering; en historisk migration må ikke genkøres. Der er ikke udført deployment eller automatisk konvertering af eksisterende pligtopgaver.
