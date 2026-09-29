# PRODUCT UX 2.3 — Desktop / kiosk alignment

Lokal implementering oven på den visuelt godkendte UX 2.2. Ingen commit, push, deployment, signing eller store submission. Ingen ændringer i backend eller live database.

## Desktop

- Samme fem områder som mobil: I dag, Kalender, Mad & indkøb, Opgaver, Familie. Madplan og Indkøb har interne faner og fælles aktivt sidebar-punkt.
- Én global + Ny åbner de samme fem oprettelsesvalg som mobil. Separate quick actions, opgaveformular og per-dag måltidsknapper er fjernet. Den direkte vareindtastning med mængde/Enter og overførsel af ingredienser bevares som arbejdsgange i indkøbslisten.
- Familie er indgangen til personer, medlemmer, feeds, enhed, udseende og konto. Floating gear er kun til kiosk. Familieskift vises under Familie, og kun ved flere familier.
- Personfilter vises på I dag, Kalender og Opgaver. Kompaktere hero og statistik bringer dagens indhold op: hero cirka 118 px, dagsindhold begynder cirka 380 px fra toppen ved begge testede desktopstørrelser.
- Ugekalenderen bevarer syv kolonner på brede skærme, farver, imports, fødselsdage og udført-markering. Tomme dage viser én besked, Ingen planer; kun sektioner med indhold renderes.
- Madplan bruger kompakt dag/dato, primær ret og sekundær status samt samlet uge-navigation.

## Kiosk

Egen skærmfyldende visning med ur/dato, dagens aftaler, aftensmad, opgavestatus og eksisterende ugentlig symbolbelønning pr. aktiv person. Belønninger bruger de eksisterende opgavedata; der er ikke indført et nyt penge-/udbetalingssystem.

Bundnavigationen har I dag som hjem samt Kalender, Mad & indkøb og Opgaver på én række. Ingen sidebar, familieskift, Familie-administration eller global FAB. Settings-genvejen og PIN bevares. Madplan og indkøb er læsevisninger; opgaver kan stadig markeres udført.

Dagens testdata (to aftaler og én åben opgave), aftensmad, progression og næste aftale kan ses uden panelscroll ved 1024×600. Længere dagslister og kommende aftaler ruller inden for deres paneler; siden og navigationen forbliver faste. Syv-dages ugevisning har begrænset plads på de mindste vægskærme og bruger intern scroll ved mange aftaler.

## Mobilbaseline

app/src/mobile.css er uændret, SHA-256:
6A2556EBE076C508565D8C07FB63F9473B5DCB3206D22069ECDB86D495278065

UX 2.2-regression: PASS ved 375×667, 390×844 og 430×932. Én FAB, fem tabs, kompakt header/agenda, horisontale personchips, ingen gear/per-dag opret-knap, samlet mad/indkøb. Safe-area, keyboard viewport, offline og celebration består også.

## Visuel acceptance

Desktop 1366×768 og 1440×900: PASS. Kiosk 1024×600, 1024×768, 1280×800 og 1920×1080: PASS. Ingen horisontal sideoverflow eller overlap mellem kioskens indhold og bundnavigation.

[Review-galleri: 45 screenshots](../supabase/.temp/ux23/review.html), inklusive alle A–J-visninger. Målinger ligger i supabase/.temp/ux23/results.json. Ignorerede lokale artefakter bruger isolerede testdata. Mobilens yderligere 35 acceptance-screenshots findes i supabase/.temp/ux22/review.html.

## Verifikation

- Unit: 86/86.
- Kalender: 22/22; produkt/kiosk: 23/23; opgaver/offline: 20/20.
- UX/mad/indkøb: 21/21; releaseflows: 11/11; mobil: 14/14; desktop/kiosk alignment: 10/10.
- I alt 121 nummererede browserchecks samt foundationflow for auth, familie, avatar, personredigering, kalender, feed og logout.
- Webbuild og Capacitor sync til Android/iOS: PASS. Native struktur: 11/11.
- Secret-check og git diff --check: PASS.

Browserchecks kørte i Chrome mod isoleret lokal Supabase. Ingen fysisk Android/iOS-runtime eller native release-build er testet i denne UI-opgave. Egne lokale web-/funktionsservere er stoppet efter kontrollen. Arbejdet er ucommittet og klar til final product review.
