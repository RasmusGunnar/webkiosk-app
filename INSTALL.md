# Opsætning af Node-afhængigheder

Projektet har enkelte Node-scripts (fx `aula-sync.js` og `sonos-local-server.js`), som kræver eksterne pakker som `@supabase/supabase-js`, `node-ical` og `express`. Kommandoen `npm install` bruges til at hente disse afhængigheder ned i et lokal `node_modules`-katalog, så scriptsene kan køres uden at mangle moduler.

## Kan man undgå `npm install`?
- Ja, hvis du kun arbejder med de statiske HTML-filer eller ikke skal køre Node-scripts, kan du undvære `npm install`.
- Nej, hvis du skal køre `aula-sync.js`, Sonos-serveren eller andre Node-baserede workflows. De kræver de nævnte pakker og kan ikke køre korrekt uden et succesfuldt `npm install` (eller en tilsvarende installation via et offline mirror/bundle).

Hvis miljøet ikke har adgang til `registry.npmjs.org`, skal du enten give npm adgang til et godkendt mirror eller installere pakkerne fra et offline bundle.

## Hvor kører jeg `npm install`, hvis koden ligger på GitHub/GitHub Pages?
GitHub Pages hoster kun statiske filer, så Node-scripts skal køres et andet sted (fx lokal maskine eller Codespace). Her er en praktisk fremgangsmåde, der også virker, hvis du ikke har Node installeret lokalt:

### Mulighed A: GitHub Codespaces (ingen lokal Node påkrævet)
1. Åbn repositoryet på GitHub, klik på **Code** ▸ **Codespaces** ▸ **Create codespace on main**.
2. Når Codespace-terminalen er klar, kør:
   ```bash
   npm install
   ```
   *(Eventuelt `npm ci` hvis du ønsker låste versioner ud fra `package-lock.json`.)*
3. Kør de nødvendige scripts – eksempelvis:
   ```bash
   node aula-sync.js
   ```
4. Commit og push de ændrede filer (fx opdaterede datafiler eller HTML), som GitHub Pages skal serve.

### Mulighed B: Lokal udvikling
1. Installer Node.js (anbefalet LTS) og git.
2. Klon repoet:
   ```bash
   git clone <repo-url>
   cd <repo-navn>
   ```
3. Kør `npm install` i roden af projektet.
4. Kør de relevante scripts (fx `node aula-sync.js` eller `node sonos-local-server.js`).
5. Commit og push de filer, som GitHub Pages skal vise.

### Mulighed C: GitHub Actions (automatisk kørsel)
Hvis du vil automatisere kørsel af et script (fx `aula-sync.js`) ved pushes eller på et schedule:
1. Opret `.github/workflows/aula-sync.yml` (eller lignende) i repoet.
2. Brug et job, der kører på `ubuntu-latest` med trin ala:
   ```yaml
   - uses: actions/checkout@v4
   - uses: actions/setup-node@v4
     with:
       node-version: '20'
       cache: 'npm'
   - run: npm ci
   - run: node aula-sync.js
   ```
3. Lad workflowet committe/udgive outputtet, som GitHub Pages server.

### Hvilken mappe?
Kør `npm install` i rodmappen for repoet (samme niveau som `package.json`). Output placeres i `node_modules/`, som GitHub Pages ikke behøver – men scriptsne, du kører med de installerede pakker, kan generere eller opdatere de statiske filer, der ender på GitHub Pages.
