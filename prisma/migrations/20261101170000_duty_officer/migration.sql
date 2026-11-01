-- Дежурный логист: регулярный просмотр биржи в рабочих часах организации.
ALTER TABLE "FleetSettings" ADD COLUMN IF NOT EXISTS "dutyEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "FleetSettings" ADD COLUMN IF NOT EXISTS "dutyIntervalMin" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "FleetSettings" ADD COLUMN IF NOT EXISTS "dutyFromHour" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "FleetSettings" ADD COLUMN IF NOT EXISTS "dutyToHour" INTEGER NOT NULL DEFAULT 21;

CREATE TABLE IF NOT EXISTS "DutyRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "poolSize" INTEGER NOT NULL DEFAULT 0,
  "freshCount" INTEGER NOT NULL DEFAULT 0,
  "itemsCount" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  CONSTRAINT "DutyRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DutySeen" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "atiLoadId" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "priceRub" INTEGER,
  "fromCity" TEXT NOT NULL,
  "toCity" TEXT NOT NULL,
  CONSTRAINT "DutySeen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DutySeen_organizationId_atiLoadId_key" ON "DutySeen"("organizationId", "atiLoadId");
CREATE INDEX IF NOT EXISTS "DutySeen_organizationId_firstSeenAt_idx" ON "DutySeen"("organizationId", "firstSeenAt");
CREATE INDEX IF NOT EXISTS "DutyRun_organizationId_startedAt_idx" ON "DutyRun"("organizationId", "startedAt");

ALTER TABLE "DutyRun" DROP CONSTRAINT IF EXISTS "DutyRun_organizationId_fkey";
ALTER TABLE "DutyRun" ADD CONSTRAINT "DutyRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DutySeen" DROP CONSTRAINT IF EXISTS "DutySeen_organizationId_fkey";
ALTER TABLE "DutySeen" ADD CONSTRAINT "DutySeen_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
