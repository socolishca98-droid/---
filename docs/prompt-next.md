# Prompt-Next — Self-Prompt для Loginex TMS (Arena Agent)

> **ВАЖНО ДЛЯ БУДУЩЕГО АГЕНТА:** Ты читаешь этот файл в `/home/user/---/docs/prompt-next.md`. Это твой главный источник контекста, если лимиты прошлого чата закончились. Работай строго по §9, начиная с первой невыполненной задачи. После каждой задачи обновляй статусы в этом файле, коммить и пушь в `arena/01a0ca44-repo`.

## §0 Мета
- **Репо:** `/home/user/---` (клонированный `socolishca98-droid/---`)
- **Ветка сессии:** `arena/01a0ca44-repo` (база `40622a2215247f6c7c37f090a82c4ab0c557a9a7` main)
- **Проект:** Loginex TMS — диспетчерская + мобильное приложение водителя (Next.js 16, Prisma SQLite, Tailwind, Radix)
- **Текущая дата:** 2026-09-22 (Europe/Moscow)
- **Как работать:**
  1. Всегда `cd /home/user/---`
  2. Читай этот файл полностью перед стартом
  3. Работай по §9 по порядку P0→P1→P2, не пропускай
  4. После каждой задачи: обнови статус ✅ в этом файле, `git add`, `git commit`, `git push origin arena/01a0ca44-repo`
  5. Если чувствуешь что лимиты скоро — остановись после завершения текущей задачи, но обязательно обнови файл и запушь
  6. Серверы: `npm run dev` → `0.0.0.0:3000`, preview https://{port}-{sandboxId}.e2b.app
  7. Build: `npm run build:safe` (offline-safe, игнорирует prisma generate network fail)

## §1 Контекст проекта
- **Структура:** `app/api/` — 50+ роутов, `app/` — страницы диспетчерской и `/m/` мобилка, `components/`, `lib/`, `prisma/schema.prisma`
- **Auth:** JWT HMAC-SHA256, PBKDF2 100k, cookies `loginex_token` (staff) и `loginex_driver_token` (driver), middleware/proxy защита
- **DB:** SQLite `file:./dev.db`, модели User, Driver, Vehicle, Order, Route, DriverShift, SosAlert, Notification, ChatMessage, Photo, MaintenanceLog
- **Демо:** логист `admin@loginex.ru / demo_dev_only` (из .env), водитель `+7 (916) 123-45-67` / org `АИ Логистика`

## §9 Безопасность, стабильность и готовность к продакшену

### P0 — Критические (DONE ✅) — блокировали продакшен
> Все задачи P0 выполнены в прошлом чате, build проходит. Не переделывай, только проверь что не сломалось.

- **P0-1 CVE зависимости:** Next 16.0.3→16.0.10, React 19.2.0→19.2.3 — ✅
- **P0-2 lib/prisma.ts silent mock:** убран noOp, build-resilient мок только в build фазе — ✅
- **P0-3 Хардкод секретов JWT:** `getAuthSecret()` требует env в prod, constant-time verify — ✅
- **P0-4 Middleware → Proxy:** `proxy.ts` с полной защитой API, 401 для неавторизованных — ✅
- **P0-5 Auth в API роутах:** 32 файла пропатчены `requireStaffAuth`/`requireDriverAuth`, `lib/api-auth.ts` создан — ✅
- **P0-6 Пароли:** register min 8, email regex, login защита от enumeration — ✅
- **P0-7 db-init.ts:** env пароль, рандом в prod — ✅
- **P0-8 Build offline:** `build` без `db push`, `build:safe` — ✅
- **P0-9 TS/Next config:** `noImplicitAny: false` временно, `ignoreBuildErrors: true` для P0, `proxy.ts` вместо `middleware.ts` — ✅
- **P0-10 Env:** `.env.example` обновлён, `.env` сгенерирован — ✅

**Проверка P0:** `npm run build:safe` проходит (70 страниц, Proxy), `grep -L auth` только публичные роуты.

### P1 — Важные (TODO, делай по порядку)

#### P1-1: Пофиксить implicit any и вернуть строгий build
- **Текущее:** `tsconfig.json` `noImplicitAny: false`, `next.config.mjs` `ignoreBuildErrors: true`
- **Цель:** Вернуть `noImplicitAny: true` (или убрать override, оставить `strict: true`) и `ignoreBuildErrors: false`, при этом build должен проходить.
- **Где ошибки:** `app/api/ati/sandbox/route.ts:19 item implicit any`, `dashboard/routes`, `dashboard/stats`, `drivers/locations`, `fleet/*`, `m/*`, `orders/*`, `routes/*`, `lib/ati-client.ts:663`
- **План:**
  1. `npx tsc --noEmit --skipLibCheck` — собрать список всех `implicit any`
  2. Пройтись по каждому файлу из списка, добавить явные типы: `(item: any)` или лучше конкретные интерфейсы (см. `prisma` типы, `Order`, `Driver`)
  3. Особое внимание: `app/api/drivers/locations/route.ts` — `shiftMap` теряет тип из-за отсутствия prisma client; добавить `as any` или тип `DriverShift`
  4. После фикса: `tsconfig.json` убрать `noImplicitAny: false`, `next.config.mjs` поставить `ignoreBuildErrors: false`
  5. Проверить `npm run build:safe` — должен пройти без `Skipping validation of types`
- **Acceptance:** `npx tsc --noEmit` 0 ошибок по implicit any, build проходит с `ignoreBuildErrors: false`
- **Статус:** ✅ DONE 2026-09-22 — 429 implicit any пофикшены скриптами `/tmp/fix_implicit.mjs` + ручные правки fleet route, chat, drivers-status, orders-sandbox, route-detail-photos; `tsc --noImplicitAny true` 0 ошибок; `tsconfig noImplicitAny:true`, `next.config ignoreBuildErrors:false`; `build:safe` 70 страниц OK

#### P1-2: Rate limiting для auth
- **Проблема:** `/api/auth/login` и `/api/m/login` без защиты от брутфорса
- **Цель:** Добавить in-memory rate limiter (для SQLite достаточно) — 5 попыток / 15 мин по IP+email/phone
- **План:**
  1. Создать `lib/rate-limiter.ts` — Map с `{count, firstAttempt}`, TTL
  2. В `login` роутах: `const ip = req.headers.get('x-forwarded-for') || 'unknown'`, ключ `ip:email`
  3. Если превышен — 429 с `Retry-After`
  4. Очищать старые записи
  5. Добавить заголовки `X-RateLimit-*`
- **Acceptance:** 6-й запрос за 15 мин → 429, тесты через curl
- **Статус:** ✅ DONE 2026-09-22 — `lib/rate-limiter.ts` с Map, WINDOW 15min, MAX 5, BLOCK 15min, cleanup; `getClientIp` x-forwarded-for/x-real-ip; `checkRateLimit`, `recordFailure`, `resetRateLimit`, `buildRateLimitHeaders`; интегрирован в `app/api/auth/login`, `app/api/m/login`, `app/api/auth/register`; тест `npx tsx` показал 6-й запрос 429 Retry-After 900; build 70 pages OK

#### P1-3: CSRF защита
- **Проблема:** Формы логина/регистрации без CSRF токена, хотя cookies `sameSite: lax` частично защищает
- **Цель:** Добавить double-submit cookie CSRF
- **План:**
  1. `lib/csrf.ts` — генерация токена, `setCsrfCookie`, `verifyCsrf`
  2. GET `/api/auth/csrf` — отдаёт токен
  3. В POST/PUT/PATCH/DELETE проверять `x-csrf-token` header vs cookie
  4. Обновить `login-form.tsx` и другие формы — fetch CSRF перед submit
  5. Исключить `/api/m/*` (мобилка использует Bearer) или добавить туда тоже
- **Acceptance:** POST без CSRF → 403, с валидным → 200
- **Статус:** ⏳ TODO

#### P1-4: Audit log для админских действий
- **Проблема:** `approve`, `deactivate`, `activate`, `change_role` в `/api/admin/users` не логируются
- **Цель:** Таблица `AuditLog` и запись всех админских действий
- **План:**
  1. `prisma/schema.prisma` добавить `model AuditLog { id, actorId, action, targetId, targetType, metadata, createdAt }`
  2. `lib/audit.ts` — `logAudit(actorId, action, target)`
  3. В `app/api/admin/users/route.ts` PATCH вызывать `logAudit`
  4. GET `/api/admin/audit` — список логов (только admin)
  5. UI в `/app/users/page.tsx` — показать логи
- **Acceptance:** approve юзера → запись в AuditLog, видна в API
- **Статус:** ⏳ TODO

#### P1-5: Refresh token rotation
- **Проблема:** JWT 7 дней staff, 30 дней driver — без ротации, если украден — долго валиден
- **Цель:** Короткий access (15 мин) + refresh (7/30 дней) с ротацией
- **План:**
  1. В `auth-server.ts` добавить `signRefreshJwt` и хранение refresh в БД? Для MVP — в памяти + httpOnly cookie `loginex_refresh`
  2. `/api/auth/refresh` — по refresh выдаёт новый access
  3. При logout — инвалидировать refresh
  4. Middleware проверять access, если истёк — пытаться refresh (или фронтенд сам)
  5. Обновить `auth-context.tsx` — silent refresh
- **Acceptance:** access 15 мин, после истечения refresh → новый access, старый refresh инвалидируется
- **Статус:** ⏳ TODO

#### P1-6: Zod валидация всех входов
- **Проблема:** Многие роуты делают `body as { ... }` без валидации, можно передать `null` и сломать
- **Цель:** Добавить `lib/validators.ts` с zod схемами для всех API
- **План:**
  1. Создать схемы: `loginSchema`, `registerSchema`, `createOrderSchema`, `createDriverSchema`, etc.
  2. В каждом POST/PATCH вызывать `schema.parse(body)` и возвращать 400 с деталями
  3. Начать с `auth/*`, `orders`, `drivers`, `vehicles`
  4. Добавить `zod` уже есть в deps
- **Acceptance:** невалидный body → 400 с zod errors, валидный → 200
- **Статус:** ⏳ TODO

### P2 — Улучшения (после P1)
- **P2-1:** Миграция на PostgreSQL (env `DATABASE_URL`, prisma provider)
- **P2-2:** Sentry для ошибок
- **P2-3:** Тесты для auth flows (vitest)
- **P2-4:** Документация API (OpenAPI)
- **P2-5:** Docker + CI/CD

## §10 Инструкции для агента (как не потеряться при лимитах)

1. **Перед стартом:** прочитай этот файл, проверь `git log --oneline -5`, `npm run build:safe`
2. **Работай по одной P1 задаче:** не делай всё сразу, делай P1-1 полностью, потом коммить
3. **После каждой задачи:**
   - Обнови статус в этом файле (⏳→✅ или добавь прогресс)
   - Добавь секцию `## Прогресс YYYY-MM-DD` внизу файла с описанием что сделал
   - `git add docs/prompt-next.md <изменённые файлы>`
   - `git commit -m "P1-X: ..."`
   - `git push origin arena/01a0ca44-repo`
4. **Если лимиты заканчиваются:** остановись на границе задачи, но обязательно запушь этот файл с актуальным статусом
5. **Будущий агент:** продолжит с первой ⏳ задачи в §9

## §11 Текущий прогресс
- 2026-09-22 P0 done, build passes, 60 файлов изменено, ветка запушена
- 2026-09-22 P1-1 DONE: implicit any 0, tsconfig strict true, build 70 pages
- 2026-09-22 P1-2 DONE: rate limiting lib + login/register protected, 6th → 429 OK
- Следующая задача: P1-3 CSRF защита (TODO)

### Прогресс 2026-09-22 P1-1
- Запущен `npx tsc --noEmit --skipLibCheck --noImplicitAny true` → было 429 ошибок
- `/tmp/fix_implicit.mjs` автофикс: добавил `: any` к параметрам без типа (reduce, map, filter, etc) — 429 мест
- `/tmp/fix_shift.mjs` — фикс `shiftMap` в `app/api/drivers/locations/route.ts`, `app/api/drivers/[id]/active-order/route.ts`, `app/api/dashboard/routes/route.ts` (потеря типа из-за mock prisma) — `(shiftMap as Map<string, any>)`
- `/tmp/fix_rest2.mjs` — фикс `groupedMessages`, `statusConfig`, `hiddenProposals`, `NOTE_COLORS`, `typePhotos`
- Ручные правки:
  - `app/api/fleet/route.ts:125` `reduce<Date|null>` → `(vehicleOrders as any).reduce((max: Date|null, o:any)=>...)` фикс TS2347 untyped call + TS7006
  - `components/orders/orders-sandbox.tsx:2957-2958` `collapsedProposalTypes[type]` → `(collapsedProposalTypes as any)[type]`, `(AUTOPROPOSAL_TYPE_META as any)[type]`
  - `components/orders/orders-sandbox.tsx:2971` `[type]: !prev[type]` → `[type]: !(prev as any)[type]`
  - `components/orders/orders-sandbox.tsx:3312` `NOTE_COLORS[color]` → `(NOTE_COLORS as any)[color]`
  - `app/m/chat/page.tsx` `Object.entries(groupedMessages as any).map(([dateKey, msgs]: any)=>` и `(msgs as any)[0]`
  - `components/dashboard/drivers-status.tsx` `(statusConfig as any)[driver.status]`
  - `components/routes/route-detail-photos.tsx` `(typePhotos as any).map` и `(photos as any).filter/reduce`
- Итог: `npx tsc --noEmit --skipLibCheck --noImplicitAny true` → 0 errors
- Обновлены: `tsconfig.json` `noImplicitAny:true`, `next.config.mjs` `ignoreBuildErrors:false`
- `npm run build:safe` → 70 pages, Proxy middleware, OK

### Прогресс 2026-09-22 P1-2
- Создан `lib/rate-limiter.ts`:
  - `store: Map<string, {count, firstAttempt, blockedUntil}>`
  - `WINDOW_MS=15min`, `MAX=5`, `BLOCK=15min`
  - `getClientIp(req)` — x-forwarded-for split, x-real-ip, fallback unknown
  - `checkRateLimit(key)` — проверяет blockedUntil, window expiry, count>=MAX → block
  - `recordFailure(key)` — инкремент, установка blockedUntil при >=MAX
  - `resetRateLimit(key)` — delete на успешный логин
  - `buildRateLimitHeaders(result)` — X-RateLimit-Limit/Remaining/Reset + Retry-After
  - cleanup при size>1000, prune expired, limit 2000
- Интеграция:
  - `app/api/auth/login/route.ts`: ключ `staff:${ip}:${email}`, check до проверки пароля, recordFailure на invalid email/pass/user not found, reset на успех, headers во всех ответах, 429 с сообщением
  - `app/api/m/login/route.ts`: ключ `driver:${ip}:${last10digits}`, аналогично, 404 тоже считается failure
  - `app/api/auth/register/route.ts`: ключ `register:${ip}:${email}`, защита от спама регистраций
- Тест: `npx tsx -e` симуляция 5 failures → 6-й blocked retryAfter 900, соответствует acceptance
- `npx tsc --noEmit --skipLibCheck --noImplicitAny true` → 0 errors
- `npm run build:safe` → 70 pages OK

## §12 Как запустить (для проверки)
```bash
cd /home/user/---
cat .env # должен содержать AUTH_SECRET
npm install
npm run build:safe # должен пройти 70 страниц
```

Демо:
- Логист: admin@loginex.ru / demo_dev_only
- Водитель: +7 (916) 123-45-67 / АИ Логистика
