#!/bin/sh
# scripts/docker-entrypoint.sh — точка входа контейнера.
#
# Образ собирается с SQLite-схемой (так же, как локальная разработка),
# поэтому перед стартом на PostgreSQL нужно перегенерировать клиент Prisma
# под прод-схему: иначе приложение пойдёт в базу с SQLite-движком.
#
# Провайдер определяется по DATABASE_URL:
#   postgresql://… — генерируется prisma/postgres/schema.prisma и клиент под неё;
#   file:./…       — SQLite (отладочный запуск), схема не трогается.
#
# Сама база НЕ создаётся здесь: структуру накатывает отдельный шаг
# (docker compose: сервис db-setup → npm run db:postgres:push).

set -e

case "${DATABASE_URL:-}" in
  postgres*|postgresql*)
    echo "[entrypoint] PostgreSQL: готовим схему и клиент"
    node scripts/make-postgres-schema.mjs
    npx prisma generate --schema=./prisma/postgres/schema.prisma
    ;;
  "")
    echo "[entrypoint] ВНИМАНИЕ: DATABASE_URL не задан — приложение не запустится"
    ;;
  *)
    echo "[entrypoint] DATABASE_URL не PostgreSQL — стартуем как есть"
    ;;
esac

exec node server.js
