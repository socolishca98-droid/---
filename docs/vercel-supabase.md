# Деплой на Vercel с базой Supabase

Пошаговая инструкция: как поднять Loginex на Vercel, переведя базу с SQLite на
PostgreSQL в Supabase.

---

## 0. Как устроено (чтобы не сломать)

В репозитории **две** Prisma-схемы:

| Файл | Провайдер | Когда используется |
| --- | --- | --- |
| `prisma/schema.prisma` | `sqlite` | локальная разработка (`DATABASE_URL="file:./dev.db"`) — это каноническая схема, её правят руками |
| `prisma/schema.postgres.prisma` | `postgresql` | прод/Postgres — генерируется из канонической скриптом, в git не коммитится |

Выбор схемы делает `scripts/prisma-schema.mjs` **по протоколу `DATABASE_URL`**:

```bash
node scripts/prisma-schema.mjs --print   # покажет, какая схема будет использована
```

Все команды Prisma в `package.json` (`db:push`, `db:generate`, `build`,
`postinstall`, `dev:db`) уже идут через этот скрипт — вручную ничего
переключать не нужно.

> **Почему это важно.** Раньше `npm run build` вызывал `prisma generate` без
> `--schema`, то есть всегда по SQLite-схеме. Клиент собирался под SQLite и на
> Postgres-URL падал в рантайме:
>
> ```
> Error validating datasource `db`: the URL must start with the protocol `file:`.
> ```
>
> Сборка на Vercel при этом была зелёной — ошибка вылезала только на живом сайте.
> Теперь генерация идёт по той же схеме, что и `DATABASE_URL`.

---

## 1. Создать проект в Supabase

1. [supabase.com](https://supabase.com) → **New project**.
2. Задайте имя, регион (ближе к пользователям), **Database Password** — сохраните его.
3. Дождитесь окончания провижининга (~1 минута).

## 2. Взять строки подключения

**Project Settings → Database → Connection string** — там три варианта:

| Вариант | Порт | Для чего |
| --- | --- | --- |
| **Transaction pooler** | 6543 | `DATABASE_URL` для приложения на Vercel |
| **Session pooler** | 5432 | запасной вариант для `DIRECT_URL`, работает по IPv4 |
| **Direct connection** | 5432 | `DIRECT_URL` (миграции); в новых проектах только IPv6 |

Рекомендуемый набор:

```ini
# Приложение (serverless на Vercel) → пулер
DATABASE_URL="postgresql://postgres.<ref>:<ПАРОЛЬ>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"

# Команды, меняющие схему (db:push) → прямое подключение
DIRECT_URL="postgresql://postgres.<ref>:<ПАРОЛЬ>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

Если не хотите разбираться с пулером, можно взять **Session pooler** и для
`DATABASE_URL`, и для `DIRECT_URL` — он тоже IPv4-совместимый. Разница только в
эффективности использования соединений.

> **Пароль со спецсимволами** нужно percent-кодировать: `@` → `%40`, `#` → `%23`,
> `/` → `%2F`.
>
> **IPv6.** Адрес `db.<ref>.supabase.co:5432` (Direct connection) в новых
> проектах резолвится только по IPv6. Если у вас или у CI нет IPv6 — берите
> Session pooler: он отдаёт те же данные по IPv4.

## 3. Создать таблицы и первого администратора

Выполняется **один раз, со своей машины** (Vercel здесь не нужен). В `.env`
пропишите `DATABASE_URL` (+ `DIRECT_URL`) из шага 2 и заполните
`AUTH_SECRET`, `ADMIN_*`, `ORGANIZATION_NAME` (см. `.env.example`).

```bash
npm run db:check      # 1. проверит URL, схему и подключение — с подсказками
npm run db:push       # 2. создаст все 27 таблиц в Supabase
npm run seed:auth     # 3. создаст организацию и администратора
npm run seed:demo     # 4. (необязательно) демо-данные — карта и дашборд сразу живые
```

`db:push` безопасен для пустой базы и идемпотентен. История миграций в
`prisma/migrations` устарела (там 10 моделей из 27), поэтому `prisma migrate`
для этого проекта **не используется** — только `db push`.

## 4. Задеплоить на Vercel

1. [vercel.com/new](https://vercel.com/new) → импортируйте репозиторий с GitHub.
2. Framework Preset определится как **Next.js**. Build Command и Install
   Command оставьте по умолчанию (`npm run build` / `npm install`) —
   `postinstall` сам сгенерирует Prisma-клиент под вашу базу.
3. **Settings → Environment Variables** — добавьте для **Production, Preview и
   Development**:

| Переменная | Обязательно | Значение |
| --- | --- | --- |
| `DATABASE_URL` | **да** | Transaction pooler из шага 2 |
| `DIRECT_URL` | желательно | прямое/Session pooler подключение |
| `AUTH_SECRET` | **да** | случайная строка ≥32 символов (своя для прода!) |
| `AUTH_SESSION_TTL_HOURS` | нет | срок жизни сессии, по умолчанию 12 |
| `TRAFFIC_PROVIDER` | нет | `mock` или `yandex` (+`YANDEX_ROUTING_API_KEY`) |
| `CRON_SECRET` | нет | если пользуетесь планировщиком сканирования ATI |
| `ADMIN_*`, `ORGANIZATION_NAME`, `DRIVER_DEFAULT_PASSWORD` | нет | нужны только скрипту `seed:auth`; на Vercel безвредны |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | нет | мониторинг ошибок |

`AUTH_SECRET` сгенерируйте так:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

> **Без `AUTH_SECRET` приложение намеренно не стартует**: `instrumentation.ts`
> завершает процесс, и все страницы отдают 500 (`FUNCTION_INVOCATION_FAILED` в
> логах Vercel). Прод-секрет должен отличаться от локального.
>
> Рекомендуется также указать **Node.js 22.x** в Settings → General.

4. Нажмите **Deploy**.

## 5. Проверить

```bash
# 1. Живость приложения
https://<ваш-проект>.vercel.app/api/health      → {"status":"ok",...}

# 2. Вход сотрудника
https://<ваш-проект>.vercel.app/login           → admin@… и пароль из ADMIN_PASSWORD

# 3. Мобильный вход водителя
https://<ваш-проект>.vercel.app/m/login
```

Если страницы отдают 500 — смотрите **Deployments → Functions → Logs**:
там будет человекочитаемая причина (чаще всего это `AUTH_SECRET` или
`DATABASE_URL`).

---

## Частые ошибки и что они значат

| Симптом | Причина | Решение |
| --- | --- | --- |
| `the URL must start with the protocol file:` | клиент Prisma собран под SQLite | `npm run db:generate`, затем передеплой |
| `relation "User" does not exist` / `no such table` | таблицы не созданы | `npm run db:push` (с `DIRECT_URL`) |
| Все страницы 500, в логах «СЕРВЕР НЕ ЗАПУЩЕН: обязательная конфигурация не задана» | не задан `AUTH_SECRET` | добавить переменную и передеплоить |
| `Can't reach database server`, `ENOTFOUND` | IPv6-адрес Direct connection | взять Session pooler (IPv4) |
| `db:push` виснет/падает через порт 6543 | транзакционный пулер не выполняет DDL | запускать `db:push` с `DIRECT_URL` |
| `sorry, too many clients already` | приложение ходит напрямую, без пулера | `DATABASE_URL` = Transaction pooler + `connection_limit=1` |
| Данные пропали после деплоя | Preview-окружение смотрит в другую базу | проверить env для Preview |
| `Failed to type check` на `AtiCache` | в коде сортировка по несуществующему полю | исправлено: `orderBy: { scannedAt: "desc" }` |

## Обновление схемы в будущем

Правки делаются только в `prisma/schema.prisma` (SQLite-канон), затем:

```bash
npm run db:push      # применит изменения к базе из DATABASE_URL
```

Постгрес-вариант перегенерируется автоматически при каждой сборке и каждой
команде Prisma — руками его править не нужно.

## Что НЕ запускать на Postgres

Скрипты `npm run db:sql:*` и файлы из `prisma/sql/` содержат SQLite-синтаксис —
это аварийный способ применить изменения в локальной SQLite-базе. На Supabase
их не применяйте: используйте `npm run db:push`.
