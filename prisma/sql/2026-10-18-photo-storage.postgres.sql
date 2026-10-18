-- 2026-10-18: байты фото в базе (драйвер хранилища db) — PostgreSQL (прод)
--
-- Зачем: на Vercel и любом serverless файловая система функций только для
-- чтения, поэтому прежний путь «файл в public/uploads» там не работал —
-- фото груза и чеков просто не сохранялись. Добавлен драйвер хранилища
-- STORAGE_DRIVER=db: байты лежат в той же записи Photo, ссылка, проверка
-- доступа и OCR не меняются.
--
-- Все три колонки nullable и добавляются без значения по умолчанию:
-- существующие записи остаются валидными, старые фото продолжают читаться
-- с диска/S3 (см. lib/storage.ts, readPhoto).
--
-- Применение (прод): node scripts/db-sql.mjs 2026-10-18-photo-storage
-- Откат: ALTER TABLE "Photo" DROP COLUMN "bytes"; (и так же "mime",
-- "storageKey"). Откат необратим — перед ним переключите драйвер на
-- local/s3, иначе фото перестанут открываться.

ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "storageKey" TEXT;
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "bytes" BYTEA;
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "mime" TEXT;
