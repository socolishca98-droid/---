-- 2026-10-19: архив вместо удаления (этап «сохранность данных») — SQLite (разработка)
--
-- Зачем: DELETE заказа, водителя и машины стирал оплату и всю историю каскадом
-- (OrderNegotiation onDelete: Cascade, DriverShift/SosAlert onDelete: Cascade).
-- Теперь такие объекты не удаляются, а архивируются: archivedAt прячет запись
-- из рабочих списков, карты и назначения, но бухгалтерский и платёжный экспорт
-- и итоги по деньгам архивные записи учитывают.
--
-- Только добавление nullable-полей: существующие записи остаются валидными,
-- данные не теряются, откат — DROP COLUMN (SQLite 3.35+).
--
-- SQLite не умеет ADD COLUMN IF NOT EXISTS, идемпотентность обеспечивает
-- применяющий скрипт (scripts/db-sql.mjs) или prisma db push в разработке.

ALTER TABLE "Order" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "Driver" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "Vehicle" ADD COLUMN "archivedAt" DATETIME;
