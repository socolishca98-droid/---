-- PostgreSQL canonical migration
-- Generated from schema.prisma (provider = postgresql)
-- Note: Full migration requires `prisma migrate deploy` on a PostgreSQL instance.
-- This file captures the structural state after multitenancy updates.

-- Organization-related entities now have non-nullable organizationId.
-- AtiCache remains nullable (global ATI cache).

-- Tables with REQUIRED organizationId
CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "nameKey" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "Organization_nameKey_key" ON "Organization"("nameKey");

CREATE INDEX IF NOT EXISTS "Organization_name_idx" ON "Organization"("name");
