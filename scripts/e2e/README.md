# Локальный стенд без движков Prisma

Зачем: обычный `prisma generate` / `db push` требует движков с
`binaries.prisma.sh`. В закрытых окружениях (наш CI-песочница, офлайн-машина) он
недоступен, а приложение без клиента Prisma не запускается. Обходной путь —
Prisma 7 (она engine-less) + драйвер-адаптер к SQLite-файлу.

Готовое приложение после этого работает как обычно: страницы, API, отчёты.

## Рецепт (один раз на стенд)

```bash
# 1. Копия репозитория в отдельную папку — репозиторий не трогаем
rm -rf /tmp/e2e2 && mkdir -p /tmp/e2e2
git archive HEAD | tar -x -C /tmp/e2e2
cp -al node_modules /tmp/e2e2/node_modules     # или обычной копией

# 2. Prisma 7 + адаптер к файлу SQLite (libsql) — всё ставится из npm
cd /tmp/e2e2
npm install --no-audit --no-fund --save-dev prisma@7.10.0
npm install --no-audit --no-fund @prisma/client@7.10.0 @prisma/adapter-libsql@7.10.0 @libsql/client

# 3. Схема → prisma-client генератор (вместо prisma-client-js), без url в datasource
#    generator client { provider = "prisma-client"  output = "../lib/generated/prisma" }
#    datasource db    { provider = "sqlite" }
# 4. Клиент: lib/prisma.ts импортирует @/lib/generated/prisma/client
#    и создаёт PrismaClient({ adapter: new PrismaLibSql({ url: DATABASE_URL }) })
# 5. Генерация: движок подменяем заглушкой — для generate он не нужен
DATABASE_URL=file:/tmp/e2e2/prisma/dev.db PRISMA_SCHEMA_ENGINE_BINARY=/bin/true \
  ./node_modules/.bin/prisma generate

# 6. База: DDL собираем сами (db push недоступен)
python3 scripts/e2e/mkddl.py prisma/schema.prisma > /tmp/schema.sql
node mkdb.mjs /tmp/schema.sql /tmp/e2e2/prisma/dev.db

# 7. Демо-мир и запуск
BASE=http://127.0.0.1:3100 DATABASE_URL=file:/tmp/e2e2/prisma/dev.db \
  bash scripts/e2e/seed.sh
npx next dev -p 3100 -H 0.0.0.0
```

## Что где лежит

| Файл | Зачем |
| --- | --- |
| `mkddl.py` | `prisma/schema.prisma` → SQLite DDL (26 таблиц, 110 индексов) |
| `seed-cache.mjs` | 5 демо-грузов в `AtiCache` — чтобы песочнице было что искать |
| `seed.sh` | организация, автопарк, водитель с паролем, клиент, 2 заказа → `/tmp/e2e-ids.env` |

`mkdb.mjs` (применение DDL к файлу) и патчи схемы/`lib/prisma.ts` живут в копии
стенда: они меняют файлы под Prisma 7, а в репозитории остаётся обычная схема.

## Проверки после запуска

```bash
curl -s http://127.0.0.1:3100/api/health
curl -s -b /tmp/e2e-staff.txt http://127.0.0.1:3100/api/orders?limit=5
```

Демо-доступы: логист `admin@e2e.test / Passw0rd!2345`, водитель
`+79990001122 / DriverPass!2345` (вход через `/m/login`).
