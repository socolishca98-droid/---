-- 2026-10-13: Web Push — подписки устройств
--
-- Зачем: уведомления внутри приложения видны, только пока оно открыто.
-- Пуши доставляют «назначен рейс», «СОС» и догрузы, когда вкладка закрыта.
-- Ключи подписки (endpoint, p256dh, auth) выдаёт браузер и должны лежать
-- рядом с учётной записью — иначе при входе с другого устройства пуши не придут.
--
-- Для баз, созданных до появления модели: применение через
--   npm run db:sql:push   (или вручную psql/sqlite3)

CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME,

    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId");
