# Отчёт: этап 1 — сохранность данных и идемпотентность

Ветка: `fix/data-integrity-archive` (от `74ecdf4`). Коммит и пуш **не делались** — ждут вашего подтверждения.
Боевая БД (Supabase) **не трогалась**. Вся проверка — в песочнице (`DATABASE_URL=file:./verify.db`) и на локальном эмуляторе PostgreSQL (PGlite, in-memory).

---

## 1. Перепроверка проблем (до исправлений)

| Проблема | Статус | Где было |
|---|---|---|
| DELETE `/api/orders/[id]` без проверки status/isPaid | **подтверждена** | `app/api/orders/[id]/route.ts` — deleteMany без условий |
| Каскады Driver→смены/SOS/фото/события, Vehicle→ТО | **подтверждены** | `schema.prisma` `onDelete: Cascade` (`:483`, `:532`, `:358`) |
| Повторное завершение рейса перезаписывало completedAt/топливо/итоги | **подтверждена** | `lib/routes/complete-route.ts`, `changeRouteStatus` |
| UI-кнопка «Удалить» | **подтверждена** | только у машины (`components/fleet/vehicle-card.tsx`) и «Уволить» у водителя; у заказов кнопки удаления из БД нет |

---

## 2. Изменённые и добавленные файлы

### Схема и миграции
- `prisma/schema.prisma` — `archivedAt DateTime?` в `Order` (:239), `Driver` (:386), `Vehicle` (:441) + doc-комментарии.
- `prisma/schema.postgres.prisma` — перегенерирован (`npm run schema:postgres`), поля на месте.
- `prisma/sql/2026-10-19-archive-instead-of-delete.sql` — SQLite-вариант (образец `2026-10-18-photo-storage`).
- `prisma/sql/2026-10-19-archive-instead-of-delete.postgres.sql` — PG-вариант.

### Новые чистые политики (в `tests/tsconfig.json` include)
- `lib/orders/archive-policy.ts` — `decideOrderDeletion`: оплачен/доставлен → `reject` (текст 409); есть история (переговоры/расходы/фото) → `archive`; иначе → `delete`. `canRestoreOrder`.
- `lib/fleet/archive-policy.ts` — `decideDriverRemoval` (shifts/shiftEvents/sosAlerts/photos/routeEvents), `decideVehicleRemoval` (maintenanceLogs/routes/orders/routeEvents/stages): любая история → `archive`, иначе `delete`.
- `lib/routes/complete-policy.ts` — `decideRouteCompletion` (completed → `noop`), `normalizeRouteStatusLoose`.
- `lib/archive/filters.ts` — `NOT_ARCHIVED`, `withNotArchived`.

### API заказа
- `app/api/orders/[id]/route.ts` — PATCH принимает `archivedAt` (нормализация строки/Date/null/true; AuditLog `order_archived`/`order_restored`); DELETE — политика + 409 с текстом + AuditLog (`order_delete_rejected`, `order_archived`, `order_deleted`); физическое удаление только для чистых.

### API водителя и машины
- `app/api/drivers/[id]/route.ts` — DELETE считает историю (`_count` по сменам/SOS/фото/событиям/этапам/рейсам + отдельный count ShiftEvent по `shift.driverId`); архив: `archivedAt`, `status:"offline"`, `vehicleId:null`, AuditLog `driver_archived`; блокировка User и отзыв сессий сохранены.
- `app/api/vehicles/[id]/route.ts` — DELETE считает историю; архив: `status:"maintenance"` + отвязка водителей, AuditLog `vehicle_archived`.

### Рейсы
- `lib/routes/complete-route.ts` — ранний no-op при `status==="completed"` (возврат до транзакции); внутри транзакции условный захват `tx.route.updateMany where status != completed`; при потере гонки (`ROUTE_ALREADY_COMPLETED`) или блокировке БД с уже завершённым рейсом — no-op с перечитом; `noop?: boolean` в результате.
- `lib/routes/service.ts` — `changeRouteStatus`: completed→completed — no-op без записи.
- `app/api/routes/[routeId]/complete/route.ts` — в ответ добавлены `noop` и сообщение «Рейс уже был завершён».

### Фильтр архивных в рабочих запросах (`archivedAt: null` / `...NOT_ARCHIVED`)
1. `app/api/orders/route.ts` — список заказов.
2. `app/api/drivers/route.ts` — список водителей.
3. `app/api/vehicles/route.ts` — список машин.
4. `app/api/fleet/vehicles/route.ts`.
5. `app/api/fleet/load/route.ts`.
6. `app/api/fleet/route.ts` — сводка автопарка.
7. `app/api/fleet/stats/route.ts`.
8. `app/api/fleet/drivers/route.ts`.
9. `app/api/m/vehicle/route.ts` — машина водителя.
10. `app/api/lm/map/route.ts` — карта логиста (машины + активные заказы).
11. `app/api/dashboard/routes/route.ts` — рейсы в работе на дашборде.
12. `app/api/orders/geo-points/route.ts` — точки заказов для карты.
13. `app/api/routes/optimizer/route.ts` — заказы в оптимизаторе рейсов.
14. `app/api/m/orders/route.ts` — заказы водителя в мобильном.

**Намеренно НЕ фильтруются** (по заданию): платежи/экспорт/бухгалтерия — архивные заказы входят в экспорт и итоги по деньгам (подтверждено приёмкой).

### Интерфейс (минимум)
- `components/fleet/vehicle-card.tsx` — пункт меню «Удалить» → «Архивировать» (иконка `Archive`), confirm-диалог переписан, тост различает «ТС архивирована»/«ТС удалена», текст ошибки при 409 показывается пользователю.
- `components/fleet/driver-card.tsx` — «Уволить» → «Архивировать».
- `app/fleet/page.tsx` — диалоги водителя и машины переписаны на архивирование.

### Тесты и инструменты
- `tests/order-archive-policy.test.mjs` (8 тестов).
- `tests/fleet-archive-policy.test.mjs` (11 тестов).
- `tests/route-complete-policy.test.mjs` (6 тестов).
- `scripts/acceptance-archive.cjs` — живой приёмочный сценарий (27 шагов), данные изолированы, уборка в конце.

---

## 3. Что теперь учитывает `archivedAt`

**Пишут:** PATCH `/api/orders/[id]` (архив/восстановление), DELETE `/api/orders/[id]`, `/api/drivers/[id]`, `/api/vehicles/[id]`.
**Читают (рабочие списки/карты/выбор):** 14 маршрутов из списка выше.
**Учитывают архивные как обычные (по требованию):** `/api/payments/export`, `/api/payments`, бухгалтерские/платёжные итоги.
**Журналируют:** `/api/admin/audit` — действия `order_archived`, `order_restored`, `order_delete_rejected`, `order_deleted`, `driver_archived`, `driver_deleted`, `vehicle_archived`, `vehicle_deleted`.

---

## 4. Тесты и результаты

### Новые unit-тесты — 25/25 (24 в наборе + 1 файл диалога)
```
tests/order-archive-policy.test.mjs    8/8   (оплачен→reject, доставлен→reject, переговоры→archive, чистый→delete…)
tests/fleet-archive-policy.test.mjs   11/11  (водитель/машина с любой историей→archive, без истории→delete)
tests/route-complete-policy.test.mjs   6/6   (completed→noop, in_transit/planned→complete)
```

### Полный прогон
| Команда | Результат |
|---|---|
| `npm run test:unit` (node --test) | **414/414 pass**, 0 fail |
| `npm run test:vitest` | **600/600 pass**, 42 файла |
| `npm run test:isolation` | **384/384 pass**, 29 файлов |
| `npx tsc --noEmit` | **чисто** |

### Живая приёмка (`scripts/acceptance-archive.cjs`, dev-сервер, SQLite) — 27/27, leftover 0
- чистый заказ → физическое удаление, повторный GET → 404;
- заказ с переговорами → архив (запись в БД, переговоры на месте, скрыт из `/api/orders`);
- **оплаченный → 409** «Заказ оплачен…» (запись жива); **доставленный → 409** (запись жива), ручный архив доставленного через PATCH работает;
- платёжный экспорт содержит и архивный оплаченный, и заархивированный доставленный заказ;
- рейс: первое завершение — 200; **повторное — no-op**, `completedAt` не изменился, топливо повторно не списано;
- **параллельное завершение (2 запроса одновременно)**: оба 200, ровно один no-op;
- водитель с рейсами → архив (скрыт из списка, рейсы сохранены); машина с историей → архив;
- AuditLog содержит `order_archived`, `order_delete_rejected`, `order_deleted`, `driver_archived`, `vehicle_archived`.

### Браузер (playwright, localhost:3000)
- `/fleet` → меню машины: **«Архивировать»** (не «Удалить»); диалог «Архивировать ТС …? Машина исчезнет из автопарка и выбора, но останется в истории рейсов и обслуживания»; после подтверждения машина исчезает из списка.
- `/fleet` → вкладка «Водители» → меню: **«Архивировать»** (не «Уволить»).
- Скриншоты: `docs/audit-screens/taskI-archive-fleet-vehicle-menu.png`, `-driver-menu.png`, `-confirm.png`, `-after.png`.

---

## 5. Миграция: только добавление nullable-полей

**SQLite** (`prisma/sql/2026-10-19-archive-instead-of-delete.sql`):
```sql
-- 2026-10-19: архив вместо удаления (этап «сохранность данных») — SQLite (разработка)
-- ... (комментарии)
ALTER TABLE "Order" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "Driver" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "Vehicle" ADD COLUMN "archivedAt" DATETIME;
```

**PostgreSQL** (`prisma/sql/2026-10-19-archive-instead-of-delete.postgres.sql`):
```sql
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
```

**Подтверждения:**
- только `ADD COLUMN`, тип nullable, без DEFAULT, без изменения `onDelete`, без `--accept-data-loss`, без удаления/переименования; откат — `DROP COLUMN`;
- SQLite: применено к копии БД (`prisma/verify.db`) через `scripts/db-sql.mjs` — «Script executed successfully», PRAGMA подтвердил `archivedAt` в Order/Driver/Vehicle;
- PostgreSQL: применено дважды на in-memory PGlite (идиомпотентность `IF NOT EXISTS`), `information_schema` — 3 nullable колонки `archivedAt`;
- боевая Supabase **не трогалась**; docker-compose Postgres в песочнице недоступен (`docker` не установлен) — проверка выполнена на PGlite-эмуляторе PG.

---

## 6. Build: причина падения — память окружения, не код

Точные тексты:
```
Creating an optimized production build ...
Killed
```
(и для webpack-варианта: `Next.js build worker exited with code: null and signal: SIGKILL`.)

**Диагностика:** сигнал SIGKILL — это OOM-killer Linux, а не ошибка компиляции; V8-heap лимит (`NODE_OPTIONS=--max-old-space-size=4096`) на процесс не повлиял, потому что в песочнице физически ~2 ГБ RAM (`MemTotal: 2030412 kB`), доступно ~1.4 ГБ. Node-процесс сборки + Turbopack-воркеры + `npm` вместе превышают лимит контейнера.

**Доказательство, что мои правки ни при чём:** те же изменения спрятаны в `git stash` (дерево = `74ecdf4` = main), `.next` удалён, запущен тот же build:
```
$ git stash push -u -m "stage1-archive-wip"
$ rm -rf .next && NODE_OPTIONS="--max-old-space-size=4096" npm run build
Creating an optimized production build ...
Killed
```
После доказательства рабочее дерево восстановлено (`git stash pop` + `git checkout stash@{0} -- <27 файлов>`), повторные прогоны: `tsc --noEmit` чисто, unit 414/414, vitest 600/600, isolation 384/384, живая приёмка 27/27 — то есть код этапа 1 целиком рабочий. Build в аудите 18-го проходил в этом же проекте — окружение песочницы уменьшило доступную память. На проде (Vercel) сборка шла обычным пайплайном (`dpl_Esu6GuUDzVwyNUjkiuR1i3878DKJ` READY) — этот этап туда не выкатывался.

---

## 7. Уникальность `Driver.phone` с архивными записями (варианты — решать вам)

Сейчас в схеме `phone String @unique` — глобально, архивные водители держат телефон.
- **A. Оставить как есть** (миграций ноль): новый водитель с телефоном архивного создасться не сможет; разблокировка — смена телефона архивной записи вручную/скриптом.
- **B. Составной уникальный `@@unique([organizationId, phone])`**: адреснуто по организации; архивные в пределах той же организации по-прежнему блокируют повтор; меняет схему (новая миграция).
- **C. Условный уникальный индекс только для неархивных** (`CREATE UNIQUE INDEX … WHERE "archivedAt" IS NULL`, PG) или частичный аналог для SQLite: самый точный смысл «телефон занят, пока водитель активен», но Prisma не умеет условные индексы declaratively — нужна ручная миграция + `$executeRaw` в схеме/скрипте.
Рекомендация: B (или C для PostgreSQL-прода). **Молча ничего не менял** — жду вашего решения.

---

## 8. Оставшиеся риски

1. **Восстановление из архива** — только через PATCH `archivedAt: null` (или прямой UPDATE): UI-кнопки «вернуть из архива» нет (по заданию интерфейс не трогаем).
2. **Архивный водитель остаётся в `User`** — вход заблокирован, сессии отозваны (проверено кодом); но запись пользователя остаётся для истории журнала.
3. **SQLite-лок**: при 4+ одновременных `complete` возможны 500 (lock timeout) — обработано как no-op только если рейс уже completed; на PostgreSQL (прод) такой конкуренции нет.
4. **Старые записи** в дашборде/картах с мягкими статусами (`in_progress`) нормализуются при чтении; данные не переписывались.
5. **`docs/api-endpoints.json`** перегенерирован сборкой (авто) — в git не закоммичен.
6. **Build в песочнице** не проходит по памяти (доказано на main); перед слиянием в main обязателен прод-прогон сборки на Vercel.

---

## 9. Итог

- Три проблемы этапа закрыты с живой проверкой (HTTP + браузер), тесты зелёные (414/600/384 + 25 новых + приёмка 27/27).
- Миграция только добавляет три nullable-поля; onDelete не менялись; Supabase не тронута.
- Коммит и пуш **не выполнялись** — жду команды.
