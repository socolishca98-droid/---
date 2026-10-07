# P2-1 PostgreSQL Migration Guide

> **Актуальный порядок действий — в [vercel-supabase.md](./vercel-supabase.md)**
> (Vercel + Supabase, пошагово). Ниже — общая механика переезда на PostgreSQL.
>
> Главное изменение: схема теперь выбирается **автоматически по `DATABASE_URL`**
> (`scripts/prisma-schema.mjs`), а `npm run build` больше не перегенерирует
> клиент под SQLite. Все команды Prisma (`db:push`, `db:generate`, `build`,
> `postinstall`) уже переведены на этот механизм.

## Текущее состояние
- Dev: SQLite `file:./dev.db` via `prisma/schema.prisma` (provider sqlite)
- Prod ready: PostgreSQL via `prisma/schema.postgres.prisma` (provider postgresql)

## Почему PostgreSQL для продакшена
- SQLite не подходит для многопользовательской нагрузки, блокировки записи
- PostgreSQL дает транзакции, конкурентность, бэкапы, репликацию

## Шаги миграции

### 1. Подготовить PostgreSQL
```bash
# Локально через Docker
docker run --name loginex-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=loginex -p 5432:5432 -d postgres:15

# Или используйте managed Postgres (Supabase, Neon, RDS)
```

### 2. Настроить env
```bash
# .env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/loginex?schema=public"
# Для продакшена используйте сильный пароль и SSL
# DATABASE_URL="postgresql://user:pass@host:5432/loginex?sslmode=require"
```

### 3. Сгенерировать PostgreSQL-схему
Единственный источник истины — `prisma/schema.prisma` (SQLite). Отдельная
postgres-схема (provider = postgresql) генерируется из неё и в git не коммитится.
Всё это делает одна команда — она сама посмотрит на протокол `DATABASE_URL`:

```bash
npm run db:generate     # → prisma/schema.postgres.prisma + клиент под PostgreSQL
node scripts/prisma-schema.mjs --print   # проверить, какая схема выбрана
```

Если `DIRECT_URL` задан (например, для Supabase), он подставляется в
сгенерированную схему как `directUrl` — Prisma возьмёт его для команд,
меняющих схему, а `DATABASE_URL` оставит для рантайма.

### 4. Миграция
История в `prisma/migrations` рассинхронизирована с реальной схемой
(в `20251215135350_init` 10 моделей из 27), поэтому источник истины — сама
схема, а применяется она через `db push`:

```bash
npm run db:check        # диагностика подключения с подсказками
npm run db:push         # привести базу к текущей схеме Prisma
npm run seed:auth       # первый администратор + организация
npm run seed:demo       # (необязательно) демо-данные
```

`prisma migrate dev/deploy` для этого проекта не применяется: он потребует
сброса базы из-за расхождения истории.

### 5. Перенос данных из SQLite (если нужно)
```bash
# Ручной перенос данных из SQLite в PostgreSQL
node scripts/migrate-sqlite-to-postgres.mjs
# Альтернатива: pgloader
```

### 6. Обновить lib/prisma.ts
Код уже готов для обоих провайдеров — `DATABASE_URL` env определяет подключение.
Логика `isBuildPhase()` позволяет билдиться без БД.

### 7. Проверить
```bash
npm run db:check        # URL + соответствие клиента схеме + живой запрос
npm run build           # сборка: клиент генерируется под ту же базу
npm run start           # прод-режим локально; /api/health должен ответить ok
```

## Docker Compose пример
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: loginex
      POSTGRES_USER: loginex
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  app:
    build: .
    environment:
      DATABASE_URL: postgresql://loginex:${POSTGRES_PASSWORD}@postgres:5432/loginex
      AUTH_SECRET: ${AUTH_SECRET}
    depends_on:
      - postgres
    ports:
      - "3000:3000"

volumes:
  pgdata:
```

## Откат
Каноническая схема всегда SQLite, поэтому откат — это просто возврат `DATABASE_URL`:

```bash
DATABASE_URL="file:./dev.db" npm run db:generate
rm -f prisma/schema.postgres.prisma
```

## Примечания
- SQLite файл `dev.db` не коммитится (в .gitignore)
- Для продакшена обязательно `AUTH_SECRET` минимум 32 символа
- Включите SSL для Postgres в проде `?sslmode=require`
- Настройте бэкапы `pg_dump`
- Мониторинг через `pg_stat_activity`
