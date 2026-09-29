# Production Auth
Do not push the root local-stack config. The previous local-auth profile is historical, not a production profile.

Live status on 2026-09-29: leaked-password protection and the four Danish templates are enabled. Custom SMTP and the final production Site URL remain pending.

After the production HTTPS domain is final:
1. Run `node scripts/prepare-production-auth.mjs https://FINAL_DOMAIN`.
2. Review the narrow `supabase config diff` command printed by the script. Only declared fields may be applied.
3. Run the printed `config push` command, then re-run the diff. Check Site URL and exact callback allowlist in Dashboard.
4. Set SMTP through Dashboard → Authentication → Email → SMTP, or use `scripts/configure-auth-security.mjs --apply` with secure environment variables. No credentials are read from tracked files or printed.
5. Enable leaked-password protection (the linked organization is Pro) through Dashboard → Authentication → Security and Protection, or the same management script. CLI 2.118.0 does not expose this field in its configuration schema.
6. Verify confirmation and recovery emails to a controlled real mailbox after SMTP/domain verification; verify native callbacks on devices.

Templates use Supabase's `ConfirmationURL`, which validates the token before redirecting to the allowlisted web/native callback. Do not replace it with a plain SiteURL link. Household invitation links remain email-bound, single-use RPC tokens, shared by the inviter through their mail application; they are not Auth admin invitations and no outbound invitation service was added.

Environment names for the management helper: `SUPABASE_ACCESS_TOKEN`, optionally `FK_SMTP_HOST`, `FK_SMTP_PORT`, `FK_SMTP_USER`, `FK_SMTP_PASSWORD`, `FK_SMTP_FROM`. Disable provider click tracking for auth links; verify sender SPF/DKIM and DMARC.
