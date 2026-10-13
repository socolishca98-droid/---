-- =============================================================================
-- Loginex. Восстановление пароля: таблица PasswordResetToken
-- =============================================================================
-- Применить к существующей базе (данные сохраняются):
--   npx prisma db push
--   npx prisma generate
--
-- Если db push недоступен — этот файл можно применить вручную, он идемпотентен:
--   npx prisma db execute --file prisma/sql/2026-10-12-password-reset.sql --schema prisma/schema.prisma
--
-- Почему отдельная таблица, а не поле в User: токен одноразовый и с сроком,
-- и его может запросить кто угодно — в User такие данные держать нельзя.
-- Хранится только хэш токена: утечка базы не даёт войти под чужими аккаунтами.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "requestIp" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
