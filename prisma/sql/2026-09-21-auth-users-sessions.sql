-- =============================================================================
-- Loginex. Задача 1 (безопасность): таблицы User и Session
-- =============================================================================
-- ВАЖНО. История миграций в prisma/migrations рассинхронизирована с базой
-- (в 20251215135350_init только 10 моделей из 17 — базу правили через db push).
-- Поэтому НЕ запускайте `prisma migrate dev`: Prisma увидит расхождение и
-- предложит сброс базы с потерей данных.
--
-- Рабочий способ применить изменения схемы (данные сохраняются):
--   npx prisma db push
--   npx prisma generate
--
-- Если db push недоступен — этот файл можно применить вручную, он идемпотентен:
--   npx prisma db execute --file prisma/sql/2026-09-21-auth-users-sessions.sql --schema prisma/schema.prisma
-- =============================================================================

-- Таблица учётных записей (администратор, логист, водитель)
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordSalt" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'logist',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "driverId" TEXT,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "suspendedAt" DATETIME,
    "suspendReason" TEXT,
    "restoredAt" DATETIME,
    "restoredById" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" DATETIME,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Таблица серверных сессий (id = jti токена из httpOnly-cookie)
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "revokeReason" TEXT,
    "lastSeenAt" DATETIME,
    "userAgent" TEXT,
    "ip" TEXT,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_key" ON "User"("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "User_driverId_key" ON "User"("driverId");
CREATE INDEX IF NOT EXISTS "User_status_idx" ON "User"("status");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
CREATE INDEX IF NOT EXISTS "User_role_status_idx" ON "User"("role", "status");
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX IF NOT EXISTS "Session_revokedAt_idx" ON "Session"("revokedAt");
