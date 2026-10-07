#!/usr/bin/env node
// scripts/backup/backup-postgres.sh — PostgreSQL backup (Task 10)
// Note: Requires PostgreSQL server access and pg_dump binary.

/*
Usage:
  DATABASE_URL="postgresql://..." ./scripts/backup/backup-postgres.sh [label]

Output:
  backups/loginex-backup-<date>-<label>.sql.gz
  backups/loginex-backup-<date>-<label>.json (metadata)

Requires external PostgreSQL access (not available in this sandbox).
*/

console.log(`
Loginex PostgreSQL Backup Script
===================================
This script requires:
  1. A running PostgreSQL instance
  2. pg_dump binary in PATH
  3. DATABASE_URL environment variable set

Example:
  DATABASE_URL="postgresql://loginex:changeme@localhost:5432/loginex?schema=public" \\
  ./scripts/backup/backup-postgres.sh daily
`)
