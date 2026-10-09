# Store metadata · da-DK / en-GB · 1.0
Internationalization drafts are in [da-DK](store-locales/da-DK.json) and [en-GB](store-locales/en-GB.json). The app name remains **Familiekalender** in both locales. These are local preparation files only; no App Store Connect or Play Console listing has been created or changed. Final legal/support information, subscription terms and native screenshots remain release tasks.
Draft for the actual release; no store listing has been submitted.

- Name: **Familiekalender**
- Apple subtitle (under 30 characters): **Familiens hverdag samlet**
- Google short description (under 80 characters): **Del kalender og opgaver i familien – på mobilen og vægskærmen.**
- Category: Productivity / Produktivitet.
- Apple keywords (under 100 characters): `familie,kalender,opgaver,ugeplan,huskeliste,fødselsdag,vægskærm`
- Support: `https://FINAL_DOMAIN/support` — requires final public URL and a working contact.
- Privacy: `https://FINAL_DOMAIN/privacy`
- Account deletion: `https://FINAL_DOMAIN/delete-account`
- Copyright: **TODO: confirm legal rights holder and year 2026**. Bundle ID is not evidence of the legal entity.
- Age: family coordination operated by adults, with optional child profiles; not advertised as a Kids Category app. Complete Apple age-rating and Google content/target-audience questionnaires from actual intended users. Do not choose a numerical age rating or exclude children merely to avoid a policy.

## Long description
Familiekalender samler familiens aftaler og opgaver i en fælles kalender.

Se dagen eller ugen, vælg en person, og opret aftaler med flere deltagere. Gentagelser og fødselsdage hjælper med at holde styr på det, der vender tilbage. Familiens opgaver kan markeres som færdige, og børneprofiler kan få en lille fejring undervejs.

Invitér andre voksne til familien med deres email. Som ejer eller administrator kan du forbinde et understøttet Google-, Aula- eller ICS-kalenderfeed.

På mobilen er kalender, I dag, opgaver og familie lette at finde. På en fælles vægskærm kan du vælge appens egen kioskvisning med ur, genveje og enheds-PIN.

Efter første login kan gemte kalenderdata bruges offline. Ventende ændringer sendes, når forbindelsen kommer tilbage. Oprettelse af konto, invitationer, import og administration kræver internet.

Du kan eksportere den valgte families data og starte kontosletning direkte i appen.

## Review login
Provide a dedicated, confirmed demo email/password through App Store Connect / Play Console's restricted review fields, never Git. Create an isolated demo household with fictional adult/child profiles and events; no private feeds or real family data. Ensure reviewers can exercise account deletion: a disposable demo owner/family can be deleted and recreated for subsequent reviews. Do not submit the real household owner's credentials. No demo account has been created or stored by this task.

Review notes should explain: email/password login, optional shared family profiles distinct from Auth users, offline requires one initial login, kiosk is a selectable in-app display mode, and push reminders are not offered in 1.0.

## Release notes
Første version af Familiekalender med delt dag-/ugekalender, personer, gentagelser, opgaver, offlineændringer og vægskærmstilstand. Indeholder eksport, privatlivsinformation og kontosletning.

## Artwork and screenshots
Temporary original icon source: `app/resources/icon.svg`. Web 512px and native 1024px output exists. Branding can be replaced through `npm run assets`.

Still needed from real native builds using fictional data:
- Google: store icon 512×512, feature graphic 1024×500 and at least two screenshots; show calendar, tasks and account controls.
- Apple: 1–10 screenshots for supported iPhone and iPad display classes. Suggested capture: iPhone 6.9-inch 1320×2868 and iPad 13-inch 2064×2752 (check accepted sizes in Connect before upload). The project supports iPad; do not omit iPad assets.
- No browser screenshot is represented here as proof of native behavior.

Current sources checked 2026-09-29: [Google artwork](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en-GB), [Apple screenshots](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
