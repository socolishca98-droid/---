// scripts/migrate-sqlite-to-postgres.mjs - P2-1 helper to migrate data from SQLite to Postgres
// Usage: DATABASE_URL_SQLITE="file:./dev.db" DATABASE_URL_POSTGRES="postgresql://..." node scripts/migrate-sqlite-to-postgres.mjs

import { PrismaClient as PrismaClientSqlite } from "@prisma/client"
import fs from "fs"

const sqliteUrl = process.env.DATABASE_URL_SQLITE || "file:./dev.db"
const postgresUrl = process.env.DATABASE_URL_POSTGRES || process.env.DATABASE_URL

if (!postgresUrl || !postgresUrl.startsWith("postgresql")) {
  console.error("Set DATABASE_URL_POSTGRES to a postgresql:// URL")
  process.exit(1)
}

console.log(`[Migrate] SQLite: ${sqliteUrl}`)
console.log(`[Migrate] Postgres: ${postgresUrl.replace(/:[^:@]+@/, ":****@")}`)

// For this MVP, we use the same PrismaClient but with different datasource URL via env override
// In real migration, you'd have two generated clients from different schemas
// Here we assume schema.prisma is postgres and we manually read sqlite file via better-sqlite3 or similar
// For simplicity, we just log instructions

console.log(`
This script is a placeholder for full migration.

Full migration steps:

1. Export from SQLite using prisma:
   DATABASE_URL="${sqliteUrl}" npx prisma db pull --schema=prisma/schema.sqlite.prisma

2. Use pgloader for automatic migration:
   pgloader --type sqlite ${sqliteUrl.replace("file:", "")} ${postgresUrl}

3. Or use custom script with better-sqlite3 + pg:

   npm install better-sqlite3 pg

   Then read each table from SQLite and insert into Postgres.

For this project, tables to migrate:
- User
- Driver
- Vehicle
- Order
- Route
- DriverShift, ShiftEvent
- SosAlert
- Notification
- ChatMessage
- Photo
- MaintenanceLog
- FleetSettings
- RouteStage, RouteEvent
- AtiCache, AtiScanConfig, AtiSession, GeoCache
- AuditLog

Note: IDs are cuid, so can be copied directly.
Dates need to be converted to ISO strings.

Example with better-sqlite3 (pseudo):

import Database from 'better-sqlite3';
import pg from 'pg';
const sqlite = new Database('dev.db');
const pgClient = new pg.Client({ connectionString: postgresUrl });
await pgClient.connect();
const users = sqlite.prepare('SELECT * FROM User').all();
for (const u of users) {
  await pgClient.query('INSERT INTO \"User\" (...) VALUES (...) ON CONFLICT DO NOTHING', [...]);
}
`)

console.log("[Migrate] Done - see instructions above")
