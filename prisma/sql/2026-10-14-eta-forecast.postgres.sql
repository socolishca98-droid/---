-- 2026-10-14: ETA — прогноз времени прибытия и факт по нему
-- ВАРИАНТ ДЛЯ POSTGRESQL (Supabase / прод).
--
-- Этот файл — точная PostgreSQL-транслитерация prisma/sql/2026-10-14-eta-forecast.sql,
-- который остаётся вариантом для SQLite (разработка). Отличия только в типах:
--   DATETIME            → TIMESTAMP(3)   (тип Prisma DateTime в PostgreSQL)
--   BOOLEAN DEFAULT 1/0 → BOOLEAN DEFAULT true/false
--   REAL                → DOUBLE PRECISION (тип Prisma Float в PostgreSQL)
-- Имена колонок, порядок, nullable, default-ы, FK и индексы совпадают с
-- prisma/schema.prisma (модель EtaForecast) один в один.
--
-- Применение:
--   DATABASE_URL="postgresql://..." npm run db:sql:eta
-- (скрипт сам выберет этот файл и PostgreSQL-схему Prisma, см. scripts/db-sql.mjs)
--
-- Идемпотентно: повторный запуск ничего не ломает.
-- Откат: DROP TABLE "EtaForecast"; — колонок в других таблицах миграция не добавляет.

CREATE TABLE IF NOT EXISTS "EtaForecast" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "routeId" TEXT,
    "orderId" TEXT,
    "vehicleId" TEXT,
    "driverId" TEXT,

    "modelVersion" TEXT NOT NULL,
    "sourcesJson" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'Europe/Moscow',

    "departureAt" TIMESTAMP(3) NOT NULL,
    "initialArrivalAt" TIMESTAMP(3) NOT NULL,
    "currentArrivalAt" TIMESTAMP(3) NOT NULL,
    "optimisticArrivalAt" TIMESTAMP(3),
    "conservativeArrivalAt" TIMESTAMP(3),

    "drivingSec" INTEGER NOT NULL DEFAULT 0,
    "stopsSec" INTEGER NOT NULL DEFAULT 0,
    "restSec" INTEGER NOT NULL DEFAULT 0,
    "totalSec" INTEGER NOT NULL DEFAULT 0,
    "distanceM" INTEGER,

    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidenceLevel" TEXT NOT NULL DEFAULT 'low',
    "confidenceReasonsJson" TEXT,
    "segmentsJson" TEXT,
    "explanationJson" TEXT,
    "weatherJson" TEXT,
    "violationsJson" TEXT,
    "reliable" BOOLEAN NOT NULL DEFAULT true,
    "reliabilityNote" TEXT,

    "calculatedAt" TIMESTAMP(3) NOT NULL,
    "recalcCount" INTEGER NOT NULL DEFAULT 0,

    -- Факт по завершении рейса
    "actualArrivalAt" TIMESTAMP(3),
    "actualDrivingSec" INTEGER,
    "actualStopsSec" INTEGER,
    "delayReasonsJson" TEXT,
    "errorMinutes" DOUBLE PRECISION,
    "outlier" BOOLEAN NOT NULL DEFAULT false,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EtaForecast_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EtaForecast_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Индексы под реальные запросы:
--   метрики по организации за период  → (organizationId, calculatedAt)
--   факты по рейсу                    → (routeId)
--   сравнение версий модели           → (modelVersion)
--   выборка непроверенных прогнозов   → (organizationId, actualArrivalAt)
CREATE INDEX IF NOT EXISTS "EtaForecast_organizationId_idx" ON "EtaForecast"("organizationId");
CREATE INDEX IF NOT EXISTS "EtaForecast_routeId_idx" ON "EtaForecast"("routeId");
CREATE INDEX IF NOT EXISTS "EtaForecast_orderId_idx" ON "EtaForecast"("orderId");
CREATE INDEX IF NOT EXISTS "EtaForecast_vehicleId_idx" ON "EtaForecast"("vehicleId");
CREATE INDEX IF NOT EXISTS "EtaForecast_calculatedAt_idx" ON "EtaForecast"("calculatedAt");
CREATE INDEX IF NOT EXISTS "EtaForecast_actualArrivalAt_idx" ON "EtaForecast"("actualArrivalAt");
CREATE INDEX IF NOT EXISTS "EtaForecast_modelVersion_idx" ON "EtaForecast"("modelVersion");
CREATE INDEX IF NOT EXISTS "EtaForecast_organizationId_calculatedAt_idx" ON "EtaForecast"("organizationId", "calculatedAt");
