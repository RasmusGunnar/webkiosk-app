# Verified web links — pending real signing identity
No placeholder association files are served from public/. The native fallback scheme is already configured.

Once the production domain and signing identities exist:
1. Copy the two .example files here to app/public/.well-known/ using their names without .example. Replace ALL placeholders. The Apple appID is the verified Team ID plus dk.rasmusgunnar.familiekalender. Use Google Play App Signing's SHA-256 app-signing certificate, not the upload certificate.
2. Serve them over HTTPS with JSON content type, no redirects/authentication. Check the exact production URLs after deployment.
3. Android: add an autoVerify VIEW intent-filter with DEFAULT/BROWSABLE and https scheme + exact production host to MainActivity in AndroidManifest.xml, covering /auth/callback, /invite and /calendar. Preserve the custom-scheme filter.
4. Xcode → App → Signing & Capabilities → Associated Domains: applinks:FINAL_DOMAIN. Let Xcode create the actual entitlements file and use the chosen signing Team.
5. Verify cold and warm links on signed devices. Reinstall if association caching requires it. Only then claim verified App Links / Universal Links are active.
