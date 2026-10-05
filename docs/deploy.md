# Деплой в продакшен

Кратко: приложение поднимается Docker Compose вместе с PostgreSQL, структура
базы накатывается одноразовым сервисом `db-setup`, файлы живут в томах.

## 1. Что нужно заранее

- Сервер с Docker и Docker Compose v2 (поддерживает
  `condition: service_completed_successfully`).
- Домен и HTTPS (Nginx/Caddy перед контейнером).
- Хостинг в РФ, если работаете с персональными данными (152-ФЗ).
- PostgreSQL 15 (входит в композ; можно взять managed — тогда сервис
  `postgres` из compose удалите и укажите свой `DATABASE_URL`).

## 2. Переменные окружения (.env рядом с docker-compose.yml)

```bash
# Обязательно
POSTGRES_PASSWORD=<надёжный пароль>
AUTH_SECRET=<минимум 32 символа>   # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Желательно
SENTRY_DSN=<dsn проекта Sentry>
TRAFFIC_PROVIDER=yandex            # пробки: реальный сервис, иначе оценка
YANDEX_ROUTING_API_KEY=<ключ>

# Первый администратор (сид)
ADMIN_EMAIL=admin@company.ru
ADMIN_PASSWORD=<пароль>
ADMIN_NAME=Администратор
ORGANIZATION_NAME=ООО «Ваша компания»
```

`AUTH_SECRET` и `DATABASE_URL` проверяются на старте: без них сервер не
поднимется (`lib/auth/startup.ts`), а `npm run verify:deploy` проверит всё
ещё до запуска.

## 3. Запуск

```bash
# структура базы + сборка + старт
docker compose up -d --build

# первый администратор (одноразово)
docker compose run --rm app sh -c "ADMIN_PASSWORD=<пароль> npm run seed:auth"

# логи и состояние
docker compose logs -f app
docker compose ps
```

Сервисы стартуют по порядку: `postgres` (healthcheck) → `db-setup`
(`npm run db:postgres:push`, один раз) → `app`.

Проверка живости: `GET /api/health`. Если база недоступна, ответ **503** —
контейнер становится unhealthy, и балансировщик не шлёт в него трафик.

## 4. Схема базы: SQLite в разработке, PostgreSQL в проде

Источник истины — `prisma/schema.prisma` (SQLite). Прод-схема
**генерируется** из неё, в git не коммитится:

```bash
npm run schema:postgres        # → prisma/postgres/schema.prisma
npm run db:postgres:push       # накатить структуру в пустую базу
npm run db:postgres:generate   # сгенерировать клиент под PostgreSQL
```

Отдельный каталог `prisma/postgres/` — не прихоть: Prisma ищет миграции
рядом со схемой, поэтому у PostgreSQL свой каталог миграций, и он не
конфликтует с SQLite-миграциями из `prisma/migrations`.

**Отличие прод-схемы:** в бизнес-моделях `organizationId` обязателен
(NOT NULL) — база не даст создать «ничью» строку. Nullable остаются только
`User` (заявка до выбора организации), `AuditLog` (действия владельца
платформы) и `PushSubscription` (подписка переживает вывод сотрудника).

**Миграции вместо db push** (когда данных станет много):

```bash
npm run schema:postgres
npx prisma migrate dev --name init --schema=prisma/postgres/schema.prisma   # один раз, на живой базе
npm run db:postgres:migrate                                                 # дальше в проде
```

Дальше в compose замените команду `db-setup` на `npm run db:postgres:migrate`.

## 5. Файлы и бэкапы

Фото, сканы и документы лежат **вне `public`** — в `data/uploads`, поэтому в
композе смонтирован том `loginex-uploads:/app/data/uploads`. Том
`loginex-backups` — под бэкапы.

```bash
npm run backup:db      # снимок: pg_dump -Fc для PostgreSQL, копия файла для SQLite
npm run restore:db     # восстановление (см. docs/backup-db.md)
```

Бэкап по расписанию (cron на хосте, раз в сутки в 03:00):

```cron
0 3 * * * cd /srv/loginex && docker compose run --rm app npm run backup:db >> /var/log/loginex-backup.log 2>&1
```

Ротация: `npm run backup:db -- --keep 14`.

## 6. Обновление

```bash
git pull
docker compose up -d --build      # db-setup сам накатит структуру
```

Откат: верните предыдущий коммит и пересоберите; структуру базы откатывайте
только если миграция была разрушающей (для этого и нужны бэкапы).

## 7. Без Docker (Windows/Linux, «как у разработчика»)

```bash
npm ci
npm run db:postgres:push       # или npx prisma db push — для SQLite-разработки
npm run build
npm start                      # next start -p 3000 -H 0.0.0.0
```

## 8. Смоук по ролям

Одной командой проверяется, что роли ведут себя как задумано: администратор
видит админку и может менять настройки, логист — работает, но без админки,
водитель — только в мобильном API, гость — никуда.

```bash
BASE_URL=https://loginex.example.ru \
  ADMIN_EMAIL=admin@company.ru ADMIN_PASSWORD=<пароль> \
  LOGIST_EMAIL=logist@company.ru LOGIST_PASSWORD=<пароль> \
  DRIVER_PHONE=+79990000000 DRIVER_PASSWORD=<пароль> \
  npm run smoke:roles
```

Роль без кредов пропускается (не считается ошибкой), проваленные проверки
дают код выхода 1 — удобно повесить на CI или запускать после обновления.

## 9. Чек-лист перед сдачей в эксплуатацию

- [ ] `npm run verify:deploy` — без блокирующих проблем
- [ ] HTTPS и редирект с HTTP
- [ ] `AUTH_SECRET` уникальный, минимум 32 символа, не в git
- [ ] PostgreSQL недоступен снаружи (только внутри docker-сети)
- [ ] Бэкап по расписанию настроен и **проверен восстановлением**
- [ ] Sentry подключён
- [ ] Смоук по ролям пройден: `BASE_URL=https://… ADMIN_EMAIL=… ADMIN_PASSWORD=… LOGIST_EMAIL=… LOGIST_PASSWORD=… DRIVER_PHONE=… DRIVER_PASSWORD=… npm run smoke:roles`
- [ ] Пробный период проверен: `/pricing` показывает остаток дней
