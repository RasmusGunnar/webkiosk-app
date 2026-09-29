# PRODUCT UX 2.1 — Compact Mobile Polish

Implementeret oven på de endnu ikke committed UX 2.0-ændringer på main. Ingen commit, push, deployment, store submission, signing eller ændring af live database. Status: afventer brugerens visuelle godkendelse.

## Mobil

- 60 px appbar med områdenavn og en lille indgang til Familie. Log ud findes i Familie → Konto. Ved flere familier findes familierskift kun på Familie; ved én familie er dropdown væk.
- Præcis fem bundpunkter: I dag, Kalender, Mad & indkøb, Opgaver og Familie. Madplan/Indkøb er interne faner; desktop beholder seks destinationer og kiosk tre.
- Personfilter findes på mobil kun i Kalender/Opgaver, som én horisontalt rullende række.
- I dag har dato og hilsen, derefter aftaler, opgaver og aftensmad. Stor hero, statistikbokse og parallelle quick-add-knapper er fjernet fra mobil.
- Én rund + FAB åbner Aktivitet, Opgave, Måltid, Indkøbsvare og Fødselsdag/mærkedag. Sidstnævnte bruger den eksisterende typevælger i editoren. Gear-FAB er fjernet på mobil. Plus-knapper på kalenderens dagkort er fjernet.
- Mobilens kalender har pile/I dag og Dag/Uge på én linje. Uge er en agenda med kompakte tomme dage og små typeikoner. Udførte opgaver foldes sammen. Noter og øvrige detaljer findes stadig i editoren.
- Dagsagenda viser aftaler, opgaver og aftensmad; den gentager ikke datoen under kalenderens navigation.
- Opgaver har et kompakt progressionskort og I dag/Denne uge/Måned. Mobilens ekstra quick-input, person-dropdown og opret-knap er fjernet; desktop beholder sit inline-input. Måned omfatter den aktuelle kalendermåned, inklusive materialiserede gentagelser.
- Madplanen er kompakt; indkøbsinput står øverst. Familie har direkte indgange til personer, invitationer, import, enhed, udseende og konto.

## Visuel gennemgang

Åbn [review-galleriet](../supabase/.temp/ux21/review.html) lokalt. Det indeholder syv skærme på hver af de tre ønskede størrelser samt action sheet, safe-area, lange titler, tastatur, offline, celebration og konto. Screenshots og testfixtures er lokale og ignored.

| Viewport | Appbar | Første aftale fra toppen | Afstand efter appbar |
| --- | --- | --- | --- |
| 375×667 | 60 px | 158 px | 98 px |
| 390×844 | 60 px | 158 px | 98 px |
| 430×932 | 60 px | 158 px | 98 px |

Målingerne bruger den medfølgende lokale fixture. Mere indhold eller synkroniseringsfejl kan kræve mere plads. Ingen samlet procentvis density-forbedring påstås på tværs af forskellige datasæt.

Chrome DevTools emulerer faktiske CSS safe-area-insets på 44 px øverst og 34 px nederst. FAB og bundnavigation overlapper ikke. Tastaturkontrollen reducerer viewport til 390×420; fysisk iOS-/Android-tastatur er ikke testet.

## Validering

- npm --prefix app test: 86/86, inklusive nye tests for måned, skudår, sommertid og gentagelsesundtagelser.
- node app/tests/mobile-compact-browser.mjs: 12/12 nye acceptance-checks og screenshots.
- Eksisterende browserpakker: kalender 22, produkt/kiosk 23, UX 2.0 21, offline/opgaver 20, release 11 samt grundflowet.
- Regressionstestenes klikveje er opdateret til Familie, opret-menu og interne madfaner; datakontroller er bevaret.
- Alle browserforløb bruger isoleret lokal Supabase. Ingen live familiedata er anvendt.

Primære ændringer: app/src/mobile.css, main.js, lib/product-ui.js og lib/calendar-dates.js. Eksisterende backend, realtime, offlinekø, rewards og native integrationer genbruges.

Afsluttende resultat: 86 unit tests, 109 nummererede browserchecks plus grundflowet bestået. Webbuild og Capacitor sync til Android/iOS bestået; native strukturkontrol 11/11. Secret-check og git diff --check bestået. Fysisk native build/runtime er ikke testet. De midlertidige lokale testservere er stoppet.
