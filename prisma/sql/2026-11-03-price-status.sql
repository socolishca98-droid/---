-- Цена «не указана» ≠ цена «ноль», и расчётная цена ≠ подтверждённая.
--
-- Миграция ТОЛЬКО ДОБАВЛЯЕТ: две пустые колонки и две новые таблицы.
-- Существующие строки не переписываются, значения по умолчанию не меняются,
-- поэтому откат — это DROP новых объектов, данные заказов не затрагиваются.

-- 1. Заявки ATI: статус цены и исходное значение, как пришло.
ALTER TABLE "AtiCache" ADD COLUMN IF NOT EXISTS "priceStatus" TEXT;
ALTER TABLE "AtiCache" ADD COLUMN IF NOT EXISTS "priceRaw" TEXT;

-- Что уже лежит в базе: ноль и пусто — это «не указана», а не «бесплатно».
-- Заполняем только там, где статус ещё не проставлен (идемпотентно).
UPDATE "AtiCache"
   SET "priceStatus" = CASE
         WHEN "price" IS NULL OR "price" <= 0 THEN 'NEGOTIATION_REQUIRED'
         ELSE 'CONFIRMED'
       END
 WHERE "priceStatus" IS NULL;

-- 2. Заказы: статус цены.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "priceStatus" TEXT;

UPDATE "Order"
   SET "priceStatus" = CASE
         WHEN "priceNegotiable" = true THEN 'NEGOTIATION_REQUIRED'
         WHEN "price" IS NULL OR "price" <= 0 THEN 'NEGOTIATION_REQUIRED'
         ELSE 'CONFIRMED'
       END
 WHERE "priceStatus" IS NULL;

-- 3. История расчётных цен: оценка не стирается, когда цену подтвердили.
CREATE TABLE IF NOT EXISTS "PriceEstimate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "refKind" TEXT NOT NULL,
  "refId" TEXT NOT NULL,
  "fromCity" TEXT NOT NULL,
  "toCity" TEXT NOT NULL,
  "km" DOUBLE PRECISION,
  "amountRub" INTEGER NOT NULL,
  "lowRub" INTEGER,
  "highRub" INTEGER,
  "perKmRub" INTEGER,
  "confidence" TEXT NOT NULL,
  "samples" INTEGER NOT NULL,
  "sources" TEXT NOT NULL,
  "basis" TEXT NOT NULL,
  "costFloorRub" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceEstimate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PriceEstimate_organizationId_refKind_refId_idx"
  ON "PriceEstimate" ("organizationId", "refKind", "refId");
CREATE INDEX IF NOT EXISTS "PriceEstimate_organizationId_createdAt_idx"
  ON "PriceEstimate" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "PriceEstimate_fromCity_toCity_idx"
  ON "PriceEstimate" ("fromCity", "toCity");

-- 4. Результаты звонков: одна запись — один разговор, история не перезаписывается.
CREATE TABLE IF NOT EXISTS "PriceCall" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "refKind" TEXT NOT NULL,
  "refId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "amountRub" INTEGER,
  "note" TEXT,
  "contactPhone" TEXT,
  "authorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriceCall_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PriceCall_organizationId_refKind_refId_idx"
  ON "PriceCall" ("organizationId", "refKind", "refId");
CREATE INDEX IF NOT EXISTS "PriceCall_organizationId_createdAt_idx"
  ON "PriceCall" ("organizationId", "createdAt");
