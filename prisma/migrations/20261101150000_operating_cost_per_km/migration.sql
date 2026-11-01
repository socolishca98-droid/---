-- Работа машины в рублях на километр: своя ставка у организации и
-- необязательное переопределение для конкретной машины.
ALTER TABLE "FleetSettings" ADD COLUMN IF NOT EXISTS "operatingCostPerKm" DOUBLE PRECISION NOT NULL DEFAULT 24;
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "operatingCostPerKm" DOUBLE PRECISION;
