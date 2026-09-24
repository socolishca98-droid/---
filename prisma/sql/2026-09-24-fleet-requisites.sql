-- =============================================================================
-- Loginex. Задача 3, пункт 3: реквизиты организации для печатных документов
-- =============================================================================
-- Что делает файл: добавляет в FleetSettings (настройки автопарка, одна строка
-- на организацию) поля реквизитов перевозчика. Они печатаются в транспортной
-- накладной, путевом листе и договоре-заявке от имени ЭТОЙ организации —
-- у каждой компании свои, между организациями не пересекаются.
--
-- Основной путь применения (данные сохраняются, миграции не трогаем):
--   npm run db:push        -- переносит схему, включая эти поля
--   npm run db:generate
--
-- Если db push недоступен — примените этот файл один раз:
--   npx prisma db execute --file prisma/sql/2026-09-24-fleet-requisites.sql --schema prisma/schema.prisma
--
-- ВАЖНО: в SQLite у ALTER TABLE ... ADD COLUMN нет IF NOT EXISTS, поэтому
-- повторный запуск файла после db push завершится ошибкой «duplicate column
-- name». Это ожидаемо: файл нужен ровно один раз и только если db push не
-- использовался.

ALTER TABLE "FleetSettings" ADD COLUMN "legalName" TEXT;
ALTER TABLE "FleetSettings" ADD COLUMN "inn" TEXT;
ALTER TABLE "FleetSettings" ADD COLUMN "kpp" TEXT;
ALTER TABLE "FleetSettings" ADD COLUMN "ogrn" TEXT;
ALTER TABLE "FleetSettings" ADD COLUMN "legalAddress" TEXT;
ALTER TABLE "FleetSettings" ADD COLUMN "phone" TEXT;
ALTER TABLE "FleetSettings" ADD COLUMN "email" TEXT;
ALTER TABLE "FleetSettings" ADD COLUMN "bankName" TEXT;
ALTER TABLE "FleetSettings" ADD COLUMN "bankBic" TEXT;
ALTER TABLE "FleetSettings" ADD COLUMN "bankAccount" TEXT;
ALTER TABLE "FleetSettings" ADD COLUMN "signerName" TEXT;
ALTER TABLE "FleetSettings" ADD COLUMN "signerPosition" TEXT;
