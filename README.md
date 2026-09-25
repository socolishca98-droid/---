# Loginex TMS — система управления грузоперевозками

Веб-приложение для логистической компании: заказы, рейсы, автопарк, водители,
клиенты, оплаты, документы (ТТН, путевой лист, договор-заявка), фотографии,
отчёты и мобильные экраны водителя.

**Стек:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 ·
Prisma 5 (SQLite для разработки, PostgreSQL для прода) · Auth по сессионным
cookie (HMAC-SHA256) · Vitest + node:test.

---

## 1. Что нужно на машине

| Что | Версия | Проверка |
| --- | --- | --- |
| Node.js | 22 LTS (минимум 20) | `node -v` |
| npm | 10+ (идёт с Node) | `npm -v` |
| Git | любая свежая | `git --version` |
| VS Code | любая свежая | — |

Рекомендуемые расширения VS Code: **ESLint**, **Tailwind CSS IntelliSense**,
**Prisma**, **Error Lens**. Полезные настройки — в конце файла.

## 2. Быстрый старт (5 шагов)

```bash
# 1. Забрать код
git clone https://github.com/socolishca98-droid/---.git loginex
cd loginex
git checkout arena/01a0c0e1-repo      # вся свежая работа — в этой ветке (см. §7)

# 2. Зависимости (postinstall сам вызовет prisma generate)
npm install

# 3. Настройки окружения
cp .env.example .env                  # Windows PowerShell: Copy-Item .env.example .env

# 4. Создать базу (SQLite-файл prisma/dev.db по умолчанию)
npm run db:push

# 5. Первый администратор + организация + учётки водителей
npm run seed:auth

# Запуск
npm run dev
```

Приложение: <http://localhost:3000> (вход сотрудника `/login`,
вход водителя `/m/login`). Проверка живости: <http://localhost:3000/api/health>.

### Обязательно перед первым запуском

В `.env` должны быть заполнены два ключа, иначе сервер намеренно не стартует:

```ini
DATABASE_URL="file:./dev.db"
AUTH_SECRET=""     # сгенерировать: node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
ADMIN_EMAIL="admin@loginex.local"
ADMIN_PASSWORD="ПридумайтеСложныйПароль1"
ORGANIZATION_NAME="Название вашей организации"
DRIVER_DEFAULT_PASSWORD="ПарольДляВодителей1"   # можно оставить пустым — сгенерируется
```

Полный список переменных с пояснениями — в `.env.example`. Ключевые группы:

| Переменная | Зачем |
| --- | --- |
| `DATABASE_URL` | SQLite-файл для разработки или строка подключения Postgres |
| `AUTH_SECRET` | подпись сессионных cookie; **обязателен**, минимум 32 символа |
| `AUTH_SESSION_TTL_HOURS` | срок жизни сессии (по умолчанию 12) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | первый администратор для `npm run seed:auth` |
| `ORGANIZATION_NAME` | организация-владелец данных (мультитенантность) |
| `DRIVER_DEFAULT_PASSWORD` | стартовый пароль водителей; они меняют его при входе |
| `CRON_SECRET` | доступ к планировщику сканирования ATI |
| `ATI_CLIENT_ID` / `ATI_TOKEN` | интеграция с ATI.SU (без них грузы не подтягиваются) |
| `TRAFFIC_PROVIDER` | `mock` (по умолчанию) или `yandex` + `YANDEX_ROUTING_API_KEY` |
| `SENTRY_DSN` | необязательно; без DSN мониторинг отключён |
| `OCR_LANGUAGES`, `OCR_TIMEOUT_MS`, `OCR_CACHE_DIR`, `OCR_LANG_PATH` | локальный Tesseract для распознавания чеков и накладных |

## 3. База данных

**Разработка — SQLite** (`prisma/dev.db`, файл рядом с проектом, в git не
попадает):

```bash
npm run db:push      # привести схему к prisma/schema.prisma
npm run db:generate  # пересобрать Prisma Client (если меняли схему)
npm run seed:auth    # идемпотентный сид: организация, администратор, пароли водителей
```

Вспомогательные SQL-миграции (для баз, созданных до появления новых таблиц):

```bash
npm run db:sql:auth        # пользователи, сессии
npm run db:sql:routes      # модель рейсов
npm run db:sql:requisites  # реквизиты организации и автопарка
npm run db:migrate-task2   # связи «машина → водитель»
npm run db:migrate-order-stages
npm run db:migrate-orgs
```

**Продакшн — PostgreSQL.** Полный порядок действий: `docs/postgres-migration.md`.
Кратко: `npm run schema:postgres` создаёт `prisma/schema.postgres.prisma`,
схема применяется на сервере БД, `DATABASE_URL` меняется на
`postgresql://user:password@host:5432/loginex?schema=public`. Для параллельной
записи нескольких водителей Postgres нужен обязательно (SQLite блокирует файл).

## 4. Основные команды

| Команда | Что делает |
| --- | --- |
| `npm run dev` | дев-сервер на `:3000` (Turbopack), доступен по сети |
| `npm run build` / `npm start` | прод-сборка и запуск |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | все тесты: unit + vitest + изоляция организаций (работают сразу после клонирования, Prisma Client для них не нужен) |
| `npm run test:unit` | `tests/*.test.mjs` (node:test), 258 проверок |
| `npm run test:vitest` | `__tests__/**` (vitest) |
| `npm run test:isolation` | витрина мультитенантности: 214 проверок |
| `npm run check:api` | все вызовы `/api/*` из кода существуют |
| `npm run audit:orgs` | аудит: каждый запрос к БД ограничен организацией |
| `npm run verify:security` / `verify:task2` / `verify:orgs` | проверки задач 1–2 |
| `npm run docs:api` | перегенерировать `docs/api-endpoints.json` и `openapi.yaml` |

## 5. Docker

```bash
# Postgres + приложение (AUTH_SECRET обязателен)
AUTH_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))") \
  docker compose up --build
```

Приложение поднимется на `:3000`, база — на `:5432`. Пароли и секреты
задаются в `.env` рядом с `docker-compose.yml` (см. переменные в файле).

## 6. Структура проекта

```
app/            страницы и API-роуты (App Router)
  ├ api/        REST: заказы, рейсы, автопарк, платежи, документы, отчёты…
  ├ m/          мобильные экраны водителя
  ├ dashboard/  карта и сводка
  └ print/      печатные формы (ТТН, путевой лист)
components/     интерфейс: ui/ (база), orders/, routes/, fleet/, dashboard/…
lib/            домен: auth, orders, routes, org, prisma, client-cache, ocr…
prisma/         схема и SQL-миграции
scripts/        служебные и проверочные скрипты, локальный стенд e2e
tests/          node:test-проверки
__tests__/      vitest-проверки (в т.ч. isolation/)
docs/           документация: безопасность, схема, миграция на Postgres
```

Полезная документация:

* `docs/postgres-migration.md` — переход на PostgreSQL;
* `docs/task-1-security.md` — чек-лист безопасности (что осталось включить);
* `docs/task-2-schema.md`, `docs/task-orders-process.md` — схема и процесс заказов;
* `docs/ui-tables-and-cache.md` — единый компонент таблиц и клиентский кеш;
* `scripts/e2e/README.md` — демо-стенд без движков Prisma (офлайн-машины, CI).

## 7. Ветки

* `main` — стабильная ветка.
* `arena/01a0c0e1-repo` — ветка, в которой шла вся текущая работа (61 коммит
  впереди `main`): безопасность, схема, документы, оплаты, отчёты, кеш и
  интерфейс. Забирать код для локального запуска удобнее из неё, а в `main`
  влить через Pull Request на GitHub.

## 8. Первый вход

1. Откройте <http://localhost:3000/login>.
2. Почта и пароль — из `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`), которые вы
   указали перед `npm run seed:auth`.
3. Водитель входит на <http://localhost:3000/m/login> по телефону и паролю
   (`DRIVER_DEFAULT_PASSWORD`, при первом входе система попросит сменить пароль).

Демо-данные для наполнения интерфейса можно завести вручную (автопарк →
водители → клиенты → заказы) или скриптом `scripts/e2e/seed.sh`, если у вас
есть bash-терминал (Git Bash подойдёт).

## 9. Частые проблемы

| Симптом | Причина и решение |
| --- | --- |
| Сервер не стартует, в консоли «СЕРВЕР НЕ ЗАПУЩЕН: обязательная конфигурация не задана» | не задан `AUTH_SECRET` — сгенерируйте (команда в §2) и перезапустите |
| `@prisma/client did not initialize yet` | выполните `npm run db:generate` (или `npm install` заново) |
| `prisma db push` не может скачать движки | нужен доступ в интернет к `binaries.prisma.sh`; в закрытых сетях — рецепт в `scripts/e2e/README.md` |
| Порт занят (`EADDRINUSE`) | запустите `npx next dev -p 3001`, либо закрыть процесс на `:3000` |
| Вход не пускает: 403 «нет организации» | не выполнен `npm run seed:auth` (он создаёт организацию и привязывает к ней администратора) |
| Пустые списки грузов ATI | не заданы `ATI_CLIENT_ID` / `ATI_TOKEN` — интеграция выключена, это норма для локальной разработки |
| `npm run typecheck` показывает ~62 ошибки вида «Parameter implicitly has an 'any' type» в `app/api/*` | не сгенерирован Prisma Client — типы Prisma неизвестны, поэтому колбэки транзакций без типов. Выполните `npm run db:generate` |
| Кириллица в консоли Windows выглядит кракозябрами | `chcp 65001` в cmd или используйте PowerShell 7 / Windows Terminal |

## 10. Безопасность (важно)

* `.env` в git не попадает, но файл **был закоммичен ранее** — ключи в истории
  считать скомпрометированными: смените `AUTH_SECRET`, пароли, `ATI_TOKEN`
  (токен лучше отозвать в личном кабинете ATI.SU и выпустить новый),
  `CRON_SECRET`, ключ Яндекс.Маршрутизации.
* Перед публикацией в интернет пройдите чек-лист `docs/task-1-security.md`
  (пункты 0.1–0.4, 0.6–0.8) и переведите базу на PostgreSQL.
