# Aula production pilot

The owner authorized production rollout on 9 November 2026 without staging.
Target: Supabase `oyyqniwppytipdktzwsy`; Vercel `familiekalender`, project
`prj_DSYiWQOb2d6wJXYa9VGGeTswyVSI`, RGJCONSULT team
`team_McpwEDxDp1EkPpQzcBAQsD3w`; alias
`https://familiekalender-alpha.vercel.app/`.

## Release order and rollback

1. Record schema versions and counts only in ignored local preflight JSON.
2. Run tests and audit the exact staged files. Exclude all `.env*` changes,
   private content, credentials, PoC/session output and review artifacts.
3. Commit/push the feature and merge latest main without rebasing. Temporarily
   skip automatic Git builds during the release so a push cannot activate an
   application before its database and secrets are ready. Restore the previous
   setting before the explicit production deployment.
4. Apply only `20261109120555_aula_integration_10.sql` and
   `20261109134623_wall_avatar_projection.sql` when missing. Never rerun old files.
5. Create independent 32-byte random encryption/HMAC keys and strong sync/analyzer
   secrets in memory; send them directly to platform stores, production scope only.
   Preserve the existing OpenAI key and existing Supabase service role.
6. Deploy only `aula-analyze`, verify its secret/contract, deploy the exact main SHA,
   verify Node routes, authenticated SSE transport and existing application screens.
7. Stop before real MitID. Connection, mapping, scanning and finding acceptance are
   deliberate adult actions. Scanning alone never creates calendar activities.

The previous healthy deployment ID is recorded in the local preflight snapshot.
If frontend/API release fails, roll the alias back to that deployment. Leave the
additive tables and secrets in place; do not drop tables or delete user findings.
Do not rotate encryption/HMAC keys after connections exist without a separate
re-encryption/reconnect plan. Neither migration deletes or disables legacy feeds.

## Verification boundaries

Production checks use schema/counts and synthetic data only. The 275-second SSE
probe verifies hosting and transport without contacting Aula/MitID. Actual cloud
provider compatibility and real-school extraction remain the user's first login
and subsequent review, not a claim made by the transport probe. Never log request
bodies, authorization headers, session values, usernames, QR data or raw messages.

The physical wall may still run the previous shell. Close the Familiekalender web
app completely and reopen it once; thereafter the new update checks take over.
RevenueCat enforcement remains off. No store submission or plan change is included.
