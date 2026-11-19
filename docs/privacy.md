# Privatliv i Familiekalender — releasegrundlag

Opdateret 19. november 2026. Den tosprogede produkttekst er i `app/src/lib/public-pages.js` og `app/src/i18n/locales/`. Offentlig URL: https://familiekalender-alpha.vercel.app/privacy.

Dette dokument beskriver implementeringen. Dataansvarlig, kontakt, behandlingsgrundlag, leverandøraftaler og konkrete backup-/logperioder mangler ejerens beslutning før offentlig lancering.

## Konto, familie og indhold

Supabase Auth behandler email, login og recovery. Familiekalender gemmer medlemskaber, roller, invitationer, familieprofiler, kalender, gentagelser, opgaver med personstatus, voksenbeslutninger, lommepengeberegninger, stjerner, mål og indløsninger. Familien deler opskrifter, billeder, ratings, madplan og indkøb. Børneprofiler er ikke automatisk brugerkonti. Lommepenge og stjerner flytter ikke penge.

Avatarer og opskriftsbilleder ligger privat i Supabase Storage og vises med tidsbegrænsede links. Ældre eksterne billedlinks kan kontakte oprindelig vært. Private kalenderfeed-URL'er bruges server-side og udelades fra familieeksporten.

## Aula og AI

Aula er valgfrit. Eksisterende forbindelser bruger en krypteret refresh-session på serveren; MitID-password gemmes ikke. Børn tilknyttes familiens profiler. Scanneren læser kalender, ikke-følsomme beskeder/opslag og understøttet MeeBook-indhold. Følsomme tråde springes over. Afgrænsede relevante tekstuddrag sendes til OpenAI til analyse. Brugeren gennemser fund, før de bliver aktiviteter; ingen automatisk accept.

Fund og beslutningshukommelse gemmes for at bevare brugerens valg og undgå genopståede forslag. Afbrydelse fjerner forbindelsens session; allerede accepterede familieaktiviteter bevares. Sletning af den voksenkonto, som ejer sessionen, tilbagekalder den tilhørende forbindelse. Andre ejeres familieindhold og børnetilknytninger bevares.

Browser-onboarding er implementeret, men deaktiveret indtil provider-godkendt OAuth-klient/callback findes. PKCE-verifier og midlertidig session er krypterede, state/completion proof gemmes som hash. Transaktioner udløber efter højst 10 minutter; fysisk oprydning sker ved næste serverkald. Dette er ikke en garanti om fysisk sletning præcis ved TTL.

Fotoscan sender kun brugerens valgte billeder til OpenAI, når brugeren vælger analyse. Resultatet gennemgås før lagring.

## Enheder, betaling og leverandører

Enheden gemmer login, familiecache og ventende ændringer for offlinefunktion. Logout rydder familiedata og køer; enhedsindstillinger bevares. Eksportfiler i native cache ryddes ved logout/sletning og næste start/eksport efter 24 timer. Selv gemte eller delte kopier skal brugeren slette.

Native registrerer installations-id, platform og senest aktiv. Push er deaktiveret i releasekonfigurationen, og ingen påmindelsesmotor tilbydes. Wall pairing bruger en særskilt begrænset anonym identitet, udløbende hashed pairingkoder og tilbagekaldelig adgang.

RevenueCat-foundation kan behandle bruger-id, butik, produkt og abonnementstilstand, når butikkerne konfigureres. Apple/Google behandler betaling; appen gemmer ikke betalingskort. Køb er endnu ikke åbnet, og subscription enforcement er OFF.

Supabase behandler Auth, database, filer og Edge Functions i EU West. Vercel er aktuel web/API-vært; Aula-scanneren kører i Frankfurt. OpenAI behandler de ovennævnte analyseinput. Ekstern Auth-email kræver en dedikeret SMTP-leverandør og valideret afsender, som endnu mangler. Infrastruktur kan behandle IP-adresser og driftsmetadata. Ingen reklamer, tracking eller analytics-SDK er tilføjet.

## Eksport, sletning og retention

Konto → Eksportér henter den valgte families data. Format 2 omfatter aktuelle kalenderfelter og voksenautoriserede Aula-fund/tilknytninger. Provider-id'er, private feed-URL'er, tokens og krypterede sessions udelades.

Konto → Slet min konto og https://familiekalender-alpha.vercel.app/delete-account starter samme bekræftede sletteflow. Andre ejeres familie bevares; eneste ejer skal eksplicit vælge sletning af sine familier. Sletning rydder tilhørende data og billeder samt adgang/sessioner efter modellens relationer. Leverandørbackup, driftslogs og offlinekopier på andre enheder kan have anden levetid.

Aktive familiedata bevares indtil relevant sletning; arkivering er ikke sletning. Ingen automatisk inaktivitetsudløb er implementeret. Konkrete leverandør-/backup-/logperioder samt juridisk grundlag skal fastlægges og offentliggøres før offentlig 1.0. Kontakt må ikke udledes af udviklerens Git-identitet.
