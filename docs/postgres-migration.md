# P2-1 PostgreSQL Migration Guide

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
postgres-схема генерируется из неё и в git не коммитится:

```bash
npm run schema:postgres          # → prisma/schema.postgres.prisma (provider = postgresql)
npx prisma generate --schema=prisma/schema.postgres.prisma
```

Дальше все команды Prisma вызываются с явным `--schema=prisma/schema.postgres.prisma`.

### 4. Миграция
```bash
# Генерация клиента
npx prisma generate

# Создание миграции (если БД пустая)
npx prisma migrate dev --name init_postgres

# Для продакшена
npx prisma migrate deploy

# Опционально: сидирование данных
npx prisma db seed
# или
npm run db:init
```

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
DATABASE_URL="postgresql://..." npm run build:safe
# Должен пройти 70 страниц

# Проверка подключения
npx prisma db execute --schema=prisma/schema.prisma --stdin <<< "SELECT 1"
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
