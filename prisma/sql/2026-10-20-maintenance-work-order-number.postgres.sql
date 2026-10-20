-- 2026-10-20: номер заказ-наряда в журнале ремонтов — PostgreSQL (прод, Supabase)
--
-- То же самое, что SQLite-версия: добавляется nullable workOrderNumber
-- в MaintenanceLog. Применять вручную через SQL Editor в Supabase
-- (прямое подключение 5432 из песочницы недоступно).
--
-- Идемпотентно: повторный запуск не падает.

ALTER TABLE "MaintenanceLog"
  ADD COLUMN IF NOT EXISTS "workOrderNumber" TEXT;
