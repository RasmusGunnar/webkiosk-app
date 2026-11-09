# Product backlog

## SINGLE RESPONSIVE UI – WEB / NATIVE / WALL

**ONE PRODUCT UI.** Familiekalender skal ikke udvikles som tre separate designs.
Kalenderkort, aktivitetstyper, personfarver, avatarer, icons, Aula-kildeetiketter og
domain logic skal være fælles på WEB, NATIVE APP og WALL.

- **WEB:** responsivt browserlayout.
- **NATIVE:** samme UI/designsystem i Capacitor-shell, med push, safe areas, deep
  links, lifecycle og offline/native capabilities. Native er en app-shell omkring
  samme produkt, ikke et separat designprojekt.
- **WALL:** samme kalenderkomponenter i et større/bredere responsivt layout, med
  kiosk-navigation, wake lock, ur og automatisk retur til I dag. Ingen sensitiv
  administration. Wall er en display mode, ikke et separat produkt.

Personen bestemmer farve og avatar; Aula er kun diskret provenance. Nye features
skal kontrollere både almindelig household-adgang og den begrænsede anonyme
wall-projektion. Samme person-ID'er, sortering og shared component skal give samme
foto/initialer/overflow på alle surfaces.

### Afgrænsning i Aula 1.0

Denne batch retter avatar-data, privat billedlæsning, personrækkefølge og sikre
Aula-kildeetiketter. `personAvatar()`, `personStack()` og billedfallback genbruges.
Der oprettes ingen separat wall-avatar-komponent, og reward/allowance/store-modeller
ændres ikke.

### Senere arbejde — ikke en del af denne batch

`main.js` har stadig flere renderveje: `renderCalendarItemCard`, `renderWeekItem`,
`renderDailyIntervalItem`, mobil-agenda og kommende aftaler. De bruger allerede
fælles person- og kalenderlogik, men gentager noget markup. Saml gradvist fælles
kortindhold og responsive varianter, med sammenlignelige fixtures og regressioner.
Bevar forskelle i plads, informationstæthed og touch/display-navigation. Afslut
Aula 1.0 før en større UI-arkitekturomskrivning.
