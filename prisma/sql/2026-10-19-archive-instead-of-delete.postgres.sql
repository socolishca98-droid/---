-- 2026-10-19: архив вместо удаления (этап «сохранность данных») — PostgreSQL (прод)
--
-- Зачем: DELETE заказа, водителя и машины стирал оплату и всю историю каскадом
-- (OrderNegotiation onDelete: Cascade, DriverShift/SosAlert onDelete: Cascade).
-- Теперь такие объекты не удаляются, а архивируются: archivedAt прячет запись
-- из рабочих списков, карты и назначения, но бухгалтерский и платёжный экспорт
-- и итоги по деньгам архивные записи учитывают.
--
-- Только добавление nullable-полей: существующие записи остаются валидными,
-- данные не теряются, откат — ALTER TABLE ... DROP COLUMN.
-- onDelete в схемах не меняется: архивирование заменяет удаление на уровне
-- приложения, каскады остаются как страховка для записей без истории.
--
-- Идемпотентность: IF NOT EXISTS — повторное применение безопасно.
-- Применение (прод): node scripts/db-sql.mjs 2026-10-19-archive-instead-of-delete

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
