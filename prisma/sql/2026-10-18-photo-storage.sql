-- 2026-10-18: байты фото в базе (драйвер хранилища db) — SQLite (разработка)
--
-- Зачем: на Vercel и любом serverless файловая система функций только для
-- чтения, поэтому прежний путь «файл в public/uploads» там не работал —
-- фото груза и чеков просто не сохранялись. Добавлен драйвер хранилища
-- STORAGE_DRIVER=db: байты лежат в той же записи Photo, ссылка, проверка
-- доступа и OCR не меняются.
--
-- Колонки nullable и добавляются без значения по умолчанию: существующие
-- записи остаются валидными, старые фото читаются с диска/S3.
--
-- SQLite не умеет ADD COLUMN IF NOT EXISTS, идемпотентность обеспечивает
-- применяющий скрипт (scripts/db-sql.mjs) или prisma db push в разработке.

ALTER TABLE "Photo" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "Photo" ADD COLUMN "bytes" BLOB;
ALTER TABLE "Photo" ADD COLUMN "mime" TEXT;
