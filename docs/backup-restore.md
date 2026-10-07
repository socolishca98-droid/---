# Backup / Restore — Loginex (Task 10)

## Current State
- No automated backup script exists in production.
- SQLite `dev.db` is excluded from git (`.gitignore`) but not backed up automatically.
- PostgreSQL database requires external backup mechanism.

## Backup Requirements
- **Frequency**: Daily (recommended for production PostgreSQL)
- **Storage**: External storage (S3-compatible or separate server) — not same server
- **Retention**: At least 30 days
- **What to back up**:
  - PostgreSQL database (`pg_dump`)
  - `public/uploads/` (file uploads — must be backed up separately as binary files)
  - `.env` (encrypted, separate from DB backup)

## Restore Verification (Required — Not Confirmed Without External Access)

### Steps to verify restore on separate PostgreSQL DB:
1. **Create test database**:
   ```bash
   createdb -U postgres loginex_restore_test
   ```
2. **Restore backup**:
   ```bash
   psql -U postgres -d loginex_restore_test -f backups/loginex-backup-<date>.sql
   ```
3. **Verify data integrity**:
   ```sql
   SELECT 'Organization' as table_name, count(*) as count FROM "Organization"
   UNION ALL SELECT 'Order', count(*) FROM "Order"
   UNION ALL SELECT 'Driver', count(*) FROM "Driver"
   UNION ALL SELECT 'Route', count(*) FROM "Route"
   UNION ALL SELECT 'Photo', count(*) FROM "Photo";
   ```
4. **Compare with production**: Counts should match (or be close if backup was taken at different time).
5. **Check application startup**: Set `DATABASE_URL` to test DB, run `npm run dev`, verify pages load and data is present.

### What happens if production database is lost?
- **Without backup**: All orders, drivers, routes, photos, ATI cache, and user accounts are lost permanently.
- **With backup**: Restore to new PostgreSQL instance within minutes to hours (depending on database size).
- **File uploads**: Must restore `public/uploads/` separately; database backups do not include binary files.

### External Dependencies
- PostgreSQL server access required for both backup (`pg_dump`) and restore (`psql`/`pg_restore`).
- This sandbox does not have PostgreSQL installed (`No psql` confirmed). **Full restore verification is blocked without external PostgreSQL access.**

### Files Changed
- `scripts/backup/backup-postgres.sh` (prepared)
- `scripts/backup/restore-postgres.mjs` (prepared)
- `docs/backup-restore.md` (this file)
