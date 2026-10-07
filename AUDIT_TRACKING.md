# Audit Log — Loginex

Started: 2026-10-06
Branch: arena/2187d18b-repo
Commit: bcf111170f0337edf727f1e985df0c25b2e5f050

## 1. SECURITY / SECRETS

### Findings:
- `.env` and `.env.local` were previously committed to git history (documented in `.gitignore` and `docs/task-1-security.md`).
- The current repository has only one visible commit (`bcf1111`), which appears grafted from upstream. The parent commit (`4fd4df74fd035d5fa16582614f4b74fd7f8d55e1`) referenced in docs is not present in this clone.
- No `.env` or `.env.local` file exists in the current working tree.
- `prisma/dev.db` is excluded by `.gitignore`.
- `.env.example` contains ONLY placeholders (`AUTH_SECRET=""`, `ATI_CLIENT_ID=""`, etc.). No production values.
- `lib/ati/secrets.ts` is an AES-256-GCM encryption module; it does not contain any hardcoded keys (uses `process.env.AUTH_SECRET`).
- No hardcoded `AUTH_SECRET`, `CRON_SECRET`, `ATI_TOKEN`, or `DATABASE_URL` production values found in any source file (checked with grep).
- `README.md` and docs contain placeholder instructions, not real secrets.
- `scripts/verify-security.mjs` exists for automated checks.

### Compromised credentials (must be considered compromised due to git history):
Based on docs/task-1-security.md and `.gitignore` notes, the following were previously in git:
- `.env` (contained `AUTH_SECRET`, `CRON_SECRET`, `ATI_CLIENT_ID`, `ATI_TOKEN`, `ADMIN_PASSWORD`, `DRIVER_DEFAULT_PASSWORD`, `DATABASE_URL`, `YANDEX_ROUTING_API_KEY`, `SENTRY_*`)
- `.env.local`
- `prisma/dev.db` (database with user data, possibly including hashed passwords and ATI tokens)
- `certificates/` (TLS certs)

### Action required (external):
- `AUTH_SECRET`: must be rotated (all active sessions become invalid).
- `CRON_SECRET`: must be rotated.
- `ATI_TOKEN` / `ATI_CLIENT_ID`: must be reissued in ATI.SU personal cabinet.
- `ADMIN_PASSWORD`: change.
- `DRIVER_DEFAULT_PASSWORD`: change.
- `YANDEX_ROUTING_API_KEY`: rotate if it was real.
- `SENTRY_AUTH_TOKEN`: rotate.
- `certificates/`: regenerate if they were production TLS certs.
- `prisma/dev.db`: database contents from history must be considered exposed; if it contained real user data, notify users/recreate.

### Current state after audit:
- `.env.example`: verified placeholders only.
- `.gitignore`: excludes `.env`, `.env.local`, `.env.*.local`, `prisma/*.db`, `public/uploads/*`, dumps.
- No real secrets found in current working tree or index.
- `lib/ati/secrets.ts` uses `process.env.AUTH_SECRET` correctly; no hardcoded fallback key.
- `app/api/ati/cron/route.ts`: `CRON_SECRET` check is fail-closed (returns 503 if missing).
- `instrumentation.ts`: server exits if `AUTH_SECRET` is missing or shorter than 32 chars.
- `.env` is NOT in current git index or objects in this clone.

Note: Because the upstream parent commit with actual `.env` content is not fully fetched in this grafted clone, I cannot display the exact secret strings. The documentation clearly states they existed. **They must be considered compromised.**

### Changes made: None (no secrets present to remove; history not rewritten per instructions).
