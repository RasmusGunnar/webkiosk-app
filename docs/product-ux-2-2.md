# PRODUCT UX 2.2 — Final Mobile Visual Polish

Afgrænset visuel opfølgning på det reviewede UX 2.1. Ingen nye funktioner, ændringer af arkitektur, backend eller live database. Ingen commit eller push.

## Visuelle ændringer

- Kun symbol og områdenavn i mobilheader; Familie nås via bundnavigationen.
- Personchips: én touch-scrollrække, skjult scrollbar og 16 px plads til højre. En diskret fade vises kun, mens der er mere indhold til højre, og forsvinder ved sidste chip. Scrollposition og personvalg bevares.
- Aftensmad uden klokkeslæt: kompakt, varmt kort med label og titel på samme række. Tomme dagssektioner og tomt madkort udelades. Afstand omkring udførte opgaver er reduceret.
- Agenda: 16 px opgaveemoji, justeret lodret placering og ens divider/spacing. Gentagelsesmetadata bruger diskrete 10 px badges med normal skriftvægt.
- Kalender og madplan: grupperede pile/centreret handling, ens 40 px kontrolhøjde. Dag/Uge hører visuelt til kalenderens headergruppe. Madplan/Indkøb-fanerne bevares.
- Måltidsrækker: kompakt dag/dato til venstre, primær titel og sekundær status/tid. Ingredienshandlingen er bevaret.
- Ingen opgaver: lavt progressionsfelt uden 0 %-ring; tom besked tæt på periodevælgeren. Eksisterende progression og celebration bevares.
- Fem bundpunkter med centrerede labels og ens 21 px ikoner. Én 52 px + FAB, ens placering og safe-area-afstand. Ekstra bundplads og scroll-margin lader sidste kalenderindhold rulle frit over FAB'en.

## Visuel acceptance

375×667, 390×844 og 430×932: PASS. Der er målt chipafstand ved fuldt vandret scroll, control heights, labelbredder/centrering, sidste kalenderdags position efter scroll og aftensmadens placering over FAB'en på den lille skærm. Ingen horisontal sideoverflow. Safe-area med 44 px øverst og 34 px nederst kontrolleres i Chrome.

[Review-galleri med 35 screenshots](../supabase/.temp/ux22/review.html). Billeder og resultater ligger i ignored supabase/.temp/ux22 og bruger kun lokale testdata.

## Tests

Unit tests: 86/86. Visuel/mobil acceptance: 14/14. Eksisterende regression: kalender 22, produkt/kiosk 23, UX 2.0 21, offline/opgaver 20 samt grundflow. Alle bruger isoleret lokal Supabase.

Afsluttende kontroller: release-browser 11/11, i alt 111 nummererede browserchecks plus grundflow. Webbuild og Capacitor sync til Android/iOS bestået. Native struktur 11/11; fysisk native build/runtime er ikke testet. Secret-check og git diff --check bestået. Arbejdet er stoppet til anden visuelle gennemgang; ingen commit, push, deployment eller signing.
