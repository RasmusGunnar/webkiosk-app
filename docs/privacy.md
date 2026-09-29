# Privatliv i Familiekalender

Opdateret 29. september 2026. Samme tekst som appens offentlige /privacy-side.

## Dine oplysninger

Familiekalender gemmer din email, dit konto-id og dine medlemskaber af familier. Adgangskoder behandles af Supabase Auth. Familien deler kalenderaftaler, noter, steder, opgaver, færdigmarkeringer, gentagelser, belønningshistorik, madplaner, ingredienslister og indkøb med de logins, der er medlemmer.

## Børn og familieprofiler

Personer i kalenderen er familieprofiler, ikke automatisk brugerkonti. Navn, farve, valgfrit fødselsår, avatar og opgaveindstillinger kan gemmes. Den voksne, der opretter eller inviterer til familien, skal have ret til at dele oplysningerne. Andre medlemmer kan læse og redigere fælles kalender- og persondata.

## Billeder og kalenderfeeds

Avatarer ligger i en privat Supabase Storage-bucket og vises med tidsbegrænsede links. Ældre avatarer kan være eksterne billedlinks. Google-, Aula- og andre ICS-links gemmes på backend og hentes af en Supabase Edge Function. Linkene kan give adgang til private kalendere; de vises kun for ejer/administrator og udelades fra JSON-eksporten.

## Enheden og offline

Denne enhed gemmer login-session, kalender, personer, belønninger, madplan, indkøb og ventende ændringer lokalt, så appen kan bruges offline. Del derfor kun enheden med personer, som må se familien. Log ud rydder appens lokale familiedata og ventende ændringer. Udseende og vægskærmsindstillinger, herunder en saltet PIN-hash, bevares til næste login. Systemets egne sikkerhedskopier kan have en anden levetid.

## Native enheder og push

Android/iOS registrerer et tilfældigt installations-id, konto, valgt familie, platform, appversion og senest aktive tidspunkt. Hvis push er konfigureret og du selv giver tilladelse, registreres også et APNs/FCM-token. Der er endnu ingen påmindelsesmotor. Der indsamles ikke annonce-id, præcis position, kontakter, mikrofondata eller bevægelsesdata.

## Drift og leverandører

Supabase behandler konto, database, filer og serverfunktioner; backendprojektet ligger i EU West (Irland). Vercel er den planlagte vært for webappen. Apple/Google behandler eventuelle pushregistreringer. Auth-email kræver en SMTP-leverandør, som endnu skal fastlægges. Infrastruktur kan behandle IP-adresser og driftslogs. Appen indeholder ingen annoncer eller analyse-/tracking-SDK.

## Opbevaring, eksport og sletning

Data opbevares, mens familien bruger tjenesten, indtil medlemmer sletter dem eller familien slettes. Der er ingen automatisk sletning af inaktive familier. Under Konto kan du eksportere den valgte families data som JSON og slette din konto. Familiedata bevares for øvrige ejere; dine forfatterreferencer anonymiseres. Er du eneste ejer, skal hver familie slettes særskilt som del af flowet. Børneprofiler i en bevaret familie bliver ikke slettet med dit login.

## Oprydning og kopier

Ved familiesletning fjernes kalender, madplan, indkøb, personer, feeds, medlemskaber, belønninger og avatarfiler. Konto, profil, loginmedlemskaber, invitationer og enhedsregistreringer fjernes. Hvis netværksoprydning fejler, gemmes en intern sletteopgave, som færdiggøres ved næste forsøg. Andre enheders offlinekopier kan først ryddes, når de forbinder igen eller logger ud. Leverandørers backups og sikkerhedslogs udløber efter deres aftalte retention; den præcise produktionsperiode skal fastlægges før offentlig lancering.

## Gemte eksporter

På native enheder ligger en midlertidig JSON-fil i appens private cache, mens du deler den. Appen rydder den ved logout eller kontosletning, og ved næste start/eksport når filen er over 24 timer gammel. Kopier, du selv gemmer eller deler, skal du selv slette.

## Kontakt og ansvarlig

TODO FØR OFFENTLIG LANCERING: angiv dataansvarlig, supportemail, SMTP-leverandør, behandlingsgrundlag og de aftalte retentionperioder. Henvendelser om indsigt, rettelse eller sletning skal kunne sendes til den offentliggjorte kontakt.
