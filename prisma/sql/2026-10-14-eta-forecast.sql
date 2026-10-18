-- 2026-10-14: ETA — прогноз времени прибытия и факт по нему
--
-- Зачем: посегментный прогноз (lib/eta/forecast.ts) бесполезен, если его
-- результат нигде не сохраняется. Без сохранённого прогноза и факта нельзя
-- ни сравнить версии модели, ни посчитать MAE, ни понять, где именно
-- прогноз врёт — а значит нельзя и улучшать его на истории рейсов (ТЗ §12).
--
-- ОДНА таблица вместо десяти: прогноз и факт по одному рейсу — две колонки
-- одной строки. Исходный прогноз (initialArrivalAt) не перезаписывается при
-- пересчёте в рейсе, поэтому видно, насколько прогноз «уезжал».
--
-- Для баз, созданных до появления модели, применение через
--   npm run db:sql:push   (или вручную psql/sqlite3)
-- Идемпотентно: повторный запуск ничего не ломает.
--
-- Порядок отката — в docs/eta-migration.md (раздел «Откат»).

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

    "departureAt" DATETIME NOT NULL,
    "initialArrivalAt" DATETIME NOT NULL,
    "currentArrivalAt" DATETIME NOT NULL,
    "optimisticArrivalAt" DATETIME,
    "conservativeArrivalAt" DATETIME,

    "drivingSec" INTEGER NOT NULL DEFAULT 0,
    "stopsSec" INTEGER NOT NULL DEFAULT 0,
    "restSec" INTEGER NOT NULL DEFAULT 0,
    "totalSec" INTEGER NOT NULL DEFAULT 0,
    "distanceM" INTEGER,

    "confidenceScore" REAL NOT NULL DEFAULT 0,
    "confidenceLevel" TEXT NOT NULL DEFAULT 'low',
    "confidenceReasonsJson" TEXT,
    "segmentsJson" TEXT,
    "explanationJson" TEXT,
    "weatherJson" TEXT,
    "violationsJson" TEXT,
    "reliable" BOOLEAN NOT NULL DEFAULT 1,
    "reliabilityNote" TEXT,

    "calculatedAt" DATETIME NOT NULL,
    "recalcCount" INTEGER NOT NULL DEFAULT 0,

    -- Факт по завершении рейса
    "actualArrivalAt" DATETIME,
    "actualDrivingSec" INTEGER,
    "actualStopsSec" INTEGER,
    "delayReasonsJson" TEXT,
    "errorMinutes" REAL,
    "outlier" BOOLEAN NOT NULL DEFAULT 0,

    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
