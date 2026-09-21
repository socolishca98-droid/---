-- =============================================================================
-- Loginex. Задача 2 (схема данных): таблица Route и перенос данных
-- =============================================================================
-- ВАЖНО. История миграций в prisma/migrations рассинхронизирована с базой
-- (в 20251215135350_init только 10 моделей из 17 — базу правили через db push).
-- Поэтому НЕ запускайте `prisma migrate dev`: Prisma увидит расхождение и
-- предложит сброс базы с потерей данных.
--
-- Рабочий способ применить изменения схемы (данные сохраняются):
--   npm run db:push
--   npm run db:generate
--   npm run db:migrate-task2 -- --check
--   npm run db:migrate-task2
--
-- Если db push недоступен — примените этот файл, он идемпотентен:
--   npx prisma db execute --file prisma/sql/2026-09-22-route-model.sql --schema prisma/schema.prisma
--   npm run db:migrate-task2      -- досчитает имена рейсов и кэш водителей
--
-- Что делает файл:
--   1. создаёт таблицу Route и индексы;
--   2. переносит «виртуальные» рейсы: для каждого уникального Order.routeId
--      создаёт строку Route со статусом и итогами, посчитанными по заказам;
--   3. делает Driver.phone уникальным (телефон — логин водителя);
--   4. переносит связь «водитель ↔ машина» из Vehicle.driverId в Driver.vehicleId
--      и выравнивает кэш Driver.vehiclePlate/vehicleType.
--
-- Чего файл НЕ делает (это умеет только db push): добавление FOREIGN KEY к
-- существующим таблицам Order/RouteStage/RouteEvent и удаление колонки
-- Vehicle.driverId — в SQLite это пересоздание таблицы. Раздел 6 ниже содержит
-- готовый блок пересоздания, но по умолчанию он закомментирован.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Таблица рейсов
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Route" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "driverId" TEXT,
    "vehicleId" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "totalDistance" INTEGER,
    "totalCost" INTEGER,
    "fuelExpense" INTEGER,
    "cargoWeight" INTEGER,
    "cargoVolume" REAL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "Route_status_idx" ON "Route"("status");
CREATE INDEX IF NOT EXISTS "Route_driverId_idx" ON "Route"("driverId");
CREATE INDEX IF NOT EXISTS "Route_vehicleId_idx" ON "Route"("vehicleId");
CREATE INDEX IF NOT EXISTS "Route_startedAt_idx" ON "Route"("startedAt");
CREATE INDEX IF NOT EXISTS "Route_createdAt_idx" ON "Route"("createdAt");

-- Индексы для существующих таблиц, если их ещё нет
CREATE INDEX IF NOT EXISTS "Order_routeId_idx" ON "Order"("routeId");
CREATE INDEX IF NOT EXISTS "Order_routeId_routeSequence_idx" ON "Order"("routeId", "routeSequence");
CREATE INDEX IF NOT EXISTS "Order_assignedDriverId_status_idx" ON "Order"("assignedDriverId", "status");
CREATE INDEX IF NOT EXISTS "Order_assignedVehicleId_status_idx" ON "Order"("assignedVehicleId", "status");
CREATE INDEX IF NOT EXISTS "Driver_vehicleId_idx" ON "Driver"("vehicleId");
CREATE INDEX IF NOT EXISTS "RouteStage_routeId_idx" ON "RouteStage"("routeId");
CREATE INDEX IF NOT EXISTS "RouteEvent_routeId_idx" ON "RouteEvent"("routeId");

-- -----------------------------------------------------------------------------
-- 2. Перенос «виртуальных» рейсов в таблицу Route
--    (один рейс = группа заказов с общим routeId)
-- -----------------------------------------------------------------------------
INSERT INTO "Route" (
    "id", "name", "status", "driverId", "vehicleId",
    "totalDistance", "cargoWeight", "cargoVolume",
    "createdAt", "updatedAt"
)
SELECT
    o."routeId",
    NULL,                                   -- имя досчитает npm run db:migrate-task2
    CASE
        -- все заказы отменены → рейс отменён
        WHEN SUM(CASE WHEN o."status" IN ('cancelled','rejected') THEN 0 ELSE 1 END) = 0
            THEN 'cancelled'
        -- все заказы закрыты
        WHEN SUM(CASE WHEN o."status" IN ('delivered','cancelled','rejected') THEN 0 ELSE 1 END) = 0
            THEN CASE
                WHEN SUM(CASE WHEN o."status" = 'delivered' THEN 1 ELSE 0 END) > 0
                    THEN 'completed'
                ELSE 'cancelled'
            END
        -- хотя бы одна точка в работе → рейс в пути
        WHEN SUM(CASE WHEN o."status" IN ('in_transit','loading','unloading') THEN 1 ELSE 0 END) > 0
            THEN 'in_transit'
        ELSE 'planned'
    END,
    (SELECT o2."assignedDriverId" FROM "Order" o2
      WHERE o2."routeId" = o."routeId"
      ORDER BY o2."routeSequence" ASC, o2."createdAt" ASC LIMIT 1),
    (SELECT o2."assignedVehicleId" FROM "Order" o2
      WHERE o2."routeId" = o."routeId"
      ORDER BY o2."routeSequence" ASC, o2."createdAt" ASC LIMIT 1),
    CASE WHEN SUM(COALESCE(o."distance", 0)) = 0 THEN NULL
         ELSE CAST(SUM(COALESCE(o."distance", 0)) AS INTEGER) END,
    CASE WHEN SUM(COALESCE(o."weight", 0)) = 0 THEN NULL
         ELSE CAST(SUM(COALESCE(o."weight", 0)) AS INTEGER) END,
    CASE WHEN SUM(COALESCE(o."volume", 0)) = 0 THEN NULL
         ELSE SUM(COALESCE(o."volume", 0)) END,
    COALESCE(MIN(o."createdAt"), CURRENT_TIMESTAMP),
    CURRENT_TIMESTAMP
FROM "Order" o
WHERE o."routeId" IS NOT NULL
  AND o."routeId" NOT IN (SELECT "id" FROM "Route")
GROUP BY o."routeId";

-- -----------------------------------------------------------------------------
-- 3. Телефон водителя — логин, поэтому уникальный
--    Перед применением убедитесь, что дублей нет:
--      SELECT phone, COUNT(*) c FROM Driver GROUP BY phone HAVING c > 1;
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "Driver_phone_key" ON "Driver"("phone");

-- -----------------------------------------------------------------------------
-- 4. Перенос связи «водитель ↔ машина» из Vehicle.driverId в Driver.vehicleId
--    Выполняйте, только если колонка Vehicle.driverId ещё существует.
--    Источник правды после переноса — Driver.vehicleId.
-- -----------------------------------------------------------------------------
-- UPDATE "Driver"
--    SET "vehicleId" = (
--          SELECT v."id" FROM "Vehicle" v
--           WHERE v."driverId" = "Driver"."id"
--           LIMIT 1
--        )
--  WHERE "Driver"."vehicleId" IS NULL
--    AND EXISTS (SELECT 1 FROM "Vehicle" v WHERE v."driverId" = "Driver"."id");

-- -----------------------------------------------------------------------------
-- 5. Кэш номера и типа машины у водителя приводим к данным машины
-- -----------------------------------------------------------------------------
UPDATE "Driver"
   SET "vehiclePlate" = (SELECT v."plate" FROM "Vehicle" v WHERE v."id" = "Driver"."vehicleId"),
       "vehicleType"  = (SELECT v."type"  FROM "Vehicle" v WHERE v."id" = "Driver"."vehicleId")
 WHERE "Driver"."vehicleId" IS NOT NULL
   AND (
        "Driver"."vehiclePlate" IS NOT (SELECT v."plate" FROM "Vehicle" v WHERE v."id" = "Driver"."vehicleId")
     OR "Driver"."vehicleType"  IS NOT (SELECT v."type"  FROM "Vehicle" v WHERE v."id" = "Driver"."vehicleId")
   );

UPDATE "Driver"
   SET "vehiclePlate" = NULL,
       "vehicleType"  = NULL
 WHERE "Driver"."vehicleId" IS NULL
   AND ("Driver"."vehiclePlate" IS NOT NULL OR "Driver"."vehicleType" IS NOT NULL);

-- -----------------------------------------------------------------------------
-- 6. Удаление колонки Vehicle.driverId (пересоздание таблицы)
--    SQLite не умеет DROP COLUMN в старых версиях, поэтому — пересоздание.
--    Блок закомментирован: обычно это делает `npm run db:push` сам.
--    Порядок строгий, выполняйте целиком и после резервной копии базы.
-- -----------------------------------------------------------------------------
-- PRAGMA foreign_keys = OFF;
-- CREATE TABLE "Vehicle_new" (
--     "id" TEXT NOT NULL PRIMARY KEY,
--     "plate" TEXT NOT NULL,
--     "type" TEXT NOT NULL,
--     "brand" TEXT,
--     "model" TEXT,
--     "year" INTEGER,
--     "capacity" INTEGER NOT NULL,
--     "volume" REAL,
--     "length" REAL,
--     "width" REAL,
--     "height" REAL,
--     "features" TEXT NOT NULL DEFAULT '[]',
--     "status" TEXT NOT NULL DEFAULT 'available',
--     "lastMaintenanceDate" DATETIME,
--     "nextMaintenanceDate" DATETIME,
--     "mileage" INTEGER,
--     "insuranceExpiry" DATETIME,
--     "inspectionExpiry" DATETIME,
--     "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
-- );
-- INSERT INTO "Vehicle_new" ("id","plate","type","brand","model","year","capacity","volume",
--                            "length","width","height","features","status","lastMaintenanceDate",
--                            "nextMaintenanceDate","mileage","insuranceExpiry","inspectionExpiry",
--                            "createdAt","updatedAt")
--      SELECT "id","plate","type","brand","model","year","capacity","volume",
--             "length","width","height","features","status","lastMaintenanceDate",
--             "nextMaintenanceDate","mileage","insuranceExpiry","inspectionExpiry",
--             "createdAt","updatedAt"
--        FROM "Vehicle";
-- DROP TABLE "Vehicle";
-- ALTER TABLE "Vehicle_new" RENAME TO "Vehicle";
-- CREATE UNIQUE INDEX "Vehicle_plate_key" ON "Vehicle"("plate");
-- CREATE INDEX "Vehicle_status_idx" ON "Vehicle"("status");
-- PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 7. Контроль после применения
-- -----------------------------------------------------------------------------
-- SELECT COUNT(*) AS routes FROM "Route";
-- SELECT COUNT(DISTINCT "routeId") AS route_ids FROM "Order" WHERE "routeId" IS NOT NULL;
-- -- числа должны совпадать
-- SELECT r."id", r."status", r."name", (SELECT COUNT(*) FROM "Order" o WHERE o."routeId" = r."id") AS orders
--   FROM "Route" r ORDER BY r."createdAt" DESC;
