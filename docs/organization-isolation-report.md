# Изоляция данных по организациям — пофайловый отчёт

Задача «Организации», пункты 6 и 9: пройден **каждый** API-роут проекта и каждый модуль
сервисного слоя, во все запросы бизнес-данных добавлен фильтр `organizationId`, который
берётся **только из проверенной сессии на сервере** (никогда из тела, query или
динамического сегмента URL).

Отчёт сгенерирован автоматически: `npm run audit:orgs -- --markdown`
(аудитор: `scripts/audit-org-isolation.mjs`). Живая проверка: `npm run verify:orgs`
(`scripts/verify-organizations.mjs`, опционально `--base-url http://localhost:3000`).
Функциональные тесты: `npm run test:isolation` (`__tests__/isolation/`, 50 проверок).

## Что означает каждая колонка

- **Гард доступа** — функция, которая проверяет сессию до любого запроса к данным
  (`requireStaff`, `requireDriver`, `requireAnySession`, `requireStaffAuth`, `getStaffSession`).
- **Организация из сессии** — вызывается ли `requireOrganization` / `requireStaffOrganization`
  / `requireDriverOrganization` из `lib/org` (403, если учётка не привязана к организации).
- **Бизнес-запросов** — сколько обращений к таблицам с `organizationId`
  (включая `tx.<model>` внутри `$transaction`).
- **Статус** — «изолирован» означает: каждый бизнес-запрос в файле содержит
  `scopedWhere(organizationId, …)` либо `organizationId` в `data`, либо помечен
  маркером, который аудит **проверяет** (см. ниже).

### Маркеры в коде: два вида, и «ok» подтверждается автоматически

| Маркер | Что означает | Как проверяется |
|---|---|---|
| `// org-audit: ok — <причина>` | цель уже проверена на принадлежность организации выше в этом же обработчике | аудит ищет выше по коду чтение одной записи (`findFirst`/`findUnique`) со `scopedWhere`/`scopedByOrg`/`organizationId`; не нашёл — нарушение «маркер не подтверждён» |
| `// org-audit: manual — <причина>` | запрос намеренно не скоуплен (вход по глобальному логину, запись, созданная этой же транзакцией) | автоматически подтвердить нельзя — место выводится отдельным списком ниже, чтобы его было видно |

Проверка маркера «ok» добавлена не зря: именно она поймала `PATCH /api/vehicles/[id]`,
где маркер стоял, а скоупленного чтения в обработчике не было — запрос менял чужую машину.

Дополнительно аудит ищет:

- `organizationId`, взятый из запроса (`body.organizationId`, `searchParams.get("organizationId")`,
  `organizationId: params…`) — нарушение требования «организация берётся из проверенного токена сессии»;
- **массовое присваивание** — спред переменной, похожей на тело запроса
  (`...other`, `...body`, `...rest`, `...payload`, `...updates`, `...fields`, `...params`),
  внутри `data` у `create`/`update`/`upsert`, включая вызовы `tx.<model>` внутри
  `$transaction`. Маркер «ok» от этого не спасает: он подтверждает принадлежность цели,
  но не состав полей. Правило проверено на старой версии `PATCH /api/orders/[id]` — срабатывает.

## Все роуты проекта

| Файл | Методы | Гард доступа | Организация из сессии | Бизнес-запросов | Модели | Статус |
|---|---|---|---|---|---|---|
| `app/api/admin/audit/route.ts` | GET | `getStaffSession` | да | 0 | — | изолирован |
| `app/api/ati/cache/route.ts` | GET | `requireStaffAuth` | да | 0 | — | изолирован |
| `app/api/ati/cities/route.ts` | GET | `requireStaffAuth` | да | 0 | — | изолирован |
| `app/api/ati/cron/route.ts` | GET, POST | — | нет | 0 | — | служебный (cron-секрет) |
| `app/api/ati/debug-dump/route.ts` | GET | `requireStaffAuth` | да | 0 | — | изолирован |
| `app/api/ati/debug/route.ts` | GET | `requireStaffAuth` | да | 0 | — | изолирован |
| `app/api/ati/geo/route.ts` | GET | `requireStaffAuth` | да | 0 | — | изолирован |
| `app/api/ati/import/route.ts` | POST | `requireStaffAuth` | да | 0 | — | изолирован |
| `app/api/ati/sandbox/route.ts` | GET, DELETE | `requireStaffAuth` | да | 0 | — | изолирован |
| `app/api/ati/scan/route.ts` | POST | `requireStaffAuth` | да | 0 | — | изолирован |
| `app/api/auth/change-password/route.ts` | POST | `requireAnySession` | — | 2 | `user` | общий (организация не применяется) |
| `app/api/auth/csrf/route.ts` | GET | — | — | 0 | — | общий (организация не применяется) |
| `app/api/auth/login/route.ts` | POST | — | — | 0 | — | общий (организация не применяется) |
| `app/api/auth/logout/route.ts` | POST | — | — | 0 | — | общий (организация не применяется) |
| `app/api/auth/register/route.ts` | POST | — | — | 4 | `user` | общий (организация не применяется) |
| `app/api/auth/session/route.ts` | GET, DELETE | — | — | 0 | — | общий (организация не применяется) |
| `app/api/auth/users/[id]/route.ts` | PATCH | `requireStaff` | да | 9 | `user` | изолирован |
| `app/api/auth/users/route.ts` | GET | `requireStaff` | да | 3 | `user` | изолирован |
| `app/api/chat/route.ts` | GET, POST, PATCH | `requireStaffAuth` | да | 4 | `chatMessage`, `driver` | изолирован |
| `app/api/dashboard/routes/route.ts` | GET | `requireStaffAuth` | да | 3 | `fleetSettings`, `order`, `driver` | изолирован |
| `app/api/dashboard/stats/route.ts` | GET | `requireStaffAuth` | да | 8 | `order`, `vehicle`, `driver`, `route` | изолирован |
| `app/api/docs/route.ts` | GET | — | — | 0 | — | общий (организация не применяется) |
| `app/api/drivers/[id]/active-order/route.ts` | GET | `requireStaffAuth` | да | 3 | `driver`, `order` | изолирован |
| `app/api/drivers/[id]/location/route.ts` | POST | `requireStaffAuth` | да | 1 | `driver` | изолирован |
| `app/api/drivers/[id]/route.ts` | GET, PATCH, DELETE | `requireStaff` | да | 9 | `driver`, `user` | изолирован |
| `app/api/drivers/locations/route.ts` | GET | `requireStaffAuth` | да | 7 | `driver`, `driverShift`, `order` | изолирован |
| `app/api/drivers/route.ts` | GET, POST | `requireStaff` | да | 5 | `driver`, `user` | изолирован |
| `app/api/fleet/assign/route.ts` | POST, DELETE | `requireStaff` | да | 2 | `driver`, `vehicle` | изолирован |
| `app/api/fleet/drivers/route.ts` | GET | `requireStaffAuth` | да | 4 | `driver`, `vehicle`, `driverShift`, `order` | изолирован |
| `app/api/fleet/route.ts` | GET | `requireStaff` | да | 7 | `driver`, `vehicle`, `driverShift`, `order` | изолирован |
| `app/api/fleet/settings/route.ts` | GET, POST | `requireStaffAuth` | да | 3 | `fleetSettings` | изолирован |
| `app/api/fleet/stats/route.ts` | GET | `requireStaffAuth` | да | 5 | `vehicle`, `driver`, `order` | изолирован |
| `app/api/fleet/vehicles/route.ts` | GET | `requireStaff` | да | 2 | `vehicle`, `order` | изолирован |
| `app/api/health/route.ts` | GET | — | — | 0 | — | общий (организация не применяется) |
| `app/api/m/base-route/route.ts` | POST | `requireDriver` | нет | 0 | — | изолирован |
| `app/api/m/location/route.ts` | POST | `requireDriver` | да | 3 | `order`, `driver` | изолирован |
| `app/api/m/login/route.ts` | POST | — | — | 1 | `driver` | общий (организация не применяется) |
| `app/api/m/maintenance/route.ts` | GET, POST, PATCH | `requireAnySession` | да | 12 | `driver`, `maintenanceLog`, `vehicle` | изолирован |
| `app/api/m/me/route.ts` | GET | `requireDriver` | да | 3 | `driver`, `driverShift`, `order` | изолирован |
| `app/api/m/orders/route.ts` | GET | `requireDriver` | да | 2 | `order` | изолирован |
| `app/api/m/photos/route.ts` | GET, POST, DELETE | `requireDriver` | да | 7 | `photo`, `order`, `notification` | изолирован |
| `app/api/m/route/accept-load/route.ts` | POST | `requireDriver` | да | 2 | `order` | изолирован |
| `app/api/m/shift/route.ts` | GET, POST, PATCH, DELETE | `requireDriver` | да | 8 | `order`, `driverShift`, `driver` | изолирован |
| `app/api/m/sos/route.ts` | POST | `requireDriver` | да | 5 | `driver`, `order`, `sosAlert`, `notification`, `chatMessage` | изолирован |
| `app/api/m/vehicle/route.ts` | GET, POST | `requireDriver` | да | 4 | `vehicle`, `driver` | изолирован |
| `app/api/orders/[id]/route.ts` | GET, PATCH, DELETE | `requireStaffAuth` | да | 6 | `order`, `route`, `driver`, `vehicle` | изолирован |
| `app/api/orders/route.ts` | GET, POST | `requireStaffAuth` | да | 5 | `order`, `driver`, `vehicle`, `route` | изолирован |
| `app/api/organization/invites/[id]/route.ts` | DELETE | `requireStaff` | да | 0 | — | изолирован |
| `app/api/organization/invites/route.ts` | GET, POST | `requireStaff` | да | 0 | — | изолирован |
| `app/api/organization/route.ts` | GET | `requireStaff` | да | 0 | — | изолирован |
| `app/api/payments/route.ts` | GET, PATCH, POST | `requireStaff` | да | 4 | `order` | изолирован |
| `app/api/photos/route.ts` | GET, POST | `requireStaffAuth` | да | 4 | `photo`, `driver`, `order` | изолирован |
| `app/api/routes/[routeId]/add-load/route.ts` | POST | `requireStaff` | да | 4 | `route`, `order`, `vehicle` | изолирован |
| `app/api/routes/[routeId]/complete/route.ts` | POST | `requireAnySession` | да | 5 | `route`, `order` | изолирован |
| `app/api/routes/[routeId]/events/route.ts` | GET | `requireAnySession` | да | 1 | `routeEvent` | изолирован |
| `app/api/routes/[routeId]/route.ts` | GET, PATCH, DELETE | `requireStaff` | да | 13 | `route`, `order`, `driver`, `vehicle` | изолирован |
| `app/api/routes/calculate-eta/route.ts` | POST, GET | `requireStaffAuth` | да | 0 | — | изолирован |
| `app/api/routes/route.ts` | GET, POST | `requireStaff` | да | 4 | `route`, `vehicle`, `driver` | изолирован |
| `app/api/sos/route.ts` | GET, PATCH | `requireStaff` | да | 6 | `sosAlert`, `driver`, `notification` | изолирован |
| `app/api/traffic/batch/route.ts` | POST | `requireStaffAuth` | да | 0 | — | изолирован |
| `app/api/traffic/info/route.ts` | GET | `requireStaffAuth` | да | 0 | — | изолирован |
| `app/api/vehicles/[id]/route.ts` | GET, PATCH, DELETE | `requireStaffAuth` | да | 6 | `vehicle`, `driver` | изолирован |
| `app/api/vehicles/route.ts` | GET, POST | `requireStaffAuth` | да | 3 | `vehicle` | изолирован |
| `app/m/route/events/route.ts` | POST | `requireDriver` | да | 7 | `route`, `order`, `vehicle`, `routeStage`, `routeEvent` | изолирован |

## Проверено вручную (маркер «org-audit: manual»)

| Файл | Запрос и причина |
|---|---|
| `app/api/drivers/route.ts` | строка 139: prisma.user.findFirst(…) — телефон уникален во всей базе намеренно: это проверка логина, а не данные организации |
| `app/api/routes/route.ts` | строка 287: tx.route.update(…) — рейс создан этой же транзакцией с organizationId вызывающего |
| `lib/auth/login.ts` | строка 93: user.findUnique(…) — вход: учётка ищется по глобальному логину (email/телефон), организация ещё неизвестна |
| `lib/auth/login.ts` | строка 125: user.update(…) — обновляется сама учётка входа (user.id найден выше), а не данные организации |
| `lib/auth/login.ts` | строка 180: user.update(…) — обновляется сама учётка входа (user.id найден выше), а не данные организации |

## Сервисный слой (lib/**)
Роуты ходят в базу не только напрямую: `lib/routes/service`, `lib/fleet/assignment`,
`lib/audit`, `lib/organizations`, `lib/auth/*` проверяются тем же правилом
(клиенты `prisma`, `db`, `client`, `tx`).

| Файл | Бизнес-запросов | Модели | Статус |
|---|---|---|---|
| `lib/audit.ts` | 2 | `auditLog` | изолирован |
| `lib/auth/login.ts` | 3 | `user` | изолирован |
| `lib/auth/session.ts` | 6 | `user`, `order`, `route` | изолирован |
| `lib/fleet/assignment.ts` | 14 | `driver`, `vehicle` | изолирован |
| `lib/org.ts` | 1 | `order` | изолирован |
| `lib/organizations.ts` | 7 | `fleetSettings`, `user`, `driver`, `vehicle` | изолирован |
| `lib/routes/service.ts` | 10 | `order`, `route`, `routeEvent` | изолирован |

## Общие таблицы (организация не применяется намеренно)

`GeoCache` (геокодинг) и `AtiCache` (сырая лента ATI) — общие справочные данные,
в схеме у них нет `organizationId`; это проверяет и аудит, и `verify-organizations.mjs`.

## Роуты без авторизации (освобождены намеренно)

| Файл | Почему |
|---|---|
| `app/api/auth/login/route.ts` | вход: организация ещё неизвестна, определяется по учётке |
| `app/api/auth/register/route.ts` | регистрация: создаёт организацию (сценарий А) или присоединяется по коду (сценарий Б) |
| `app/api/auth/logout/route.ts` | выход из своей сессии |
| `app/api/auth/session/route.ts` | отдаёт свою сессию, включая `organization` |
| `app/api/auth/csrf/route.ts` | выдача CSRF-токена |
| `app/api/auth/change-password/route.ts` | смена своего пароля |
| `app/api/m/login/route.ts` | вход водителя (телефон + пароль) |
| `app/api/health/route.ts` | техническая проверка доступности |
| `app/api/docs/route.ts` | открытая документация API |
| `app/api/ati/cron/route.ts` | служебный вызов по `CRON_SECRET`, бизнес-данных не трогает |

## Функциональные тесты изоляции (`npm run test:isolation`)

Статический аудит отвечает на вопрос «есть ли фильтр в запросе», но не «что вернёт роут».
Поэтому добавлен второй уровень: **настоящие обработчики роутов вызываются в тестах**
с настоящими подписанными cookie двух организаций, а слой хранения подменён in-memory
клиентом (`__tests__/__mocks__/prisma-memory.ts`, подключается `vitest.isolation.config.ts`).

Что покрыто (50 проверок):

- доступ: без cookie — 401, сотрудник без организации — 403, водительский cookie не
  открывает штабные роуты и наоборот, `organizationId` в теле запроса игнорируется;
- заказы: список, фильтр по чужому водителю, GET/PATCH/DELETE чужого id — 404 и данные
  целы, создание с чужим водителем/машиной/рейсом — 404, созданный заказ — в организации А;
  **массовое присваивание**: PATCH своего заказа с `organizationId` чужой организации — 400,
  со служебными (`id`, `createdAt`) и платёжными (`isPaid`) полями — 400, с неизвестным
  полем — 400, с чужим `routeId` — 404, а с разрешёнными полями — применяется;
- водители: список, bulk-выборка по чужим id, GET/PATCH/DELETE чужого — 404, активный
  заказ и локация чужого водителя — 404, новый водитель и его учётка — в организации А;
- машины: список, чужая машина — 404 на все методы, госномер уникален в рамках
  организации (один и тот же номер можно завести в А и в Б, но не дважды в А);
- рейсы: список, чужой рейс — 404 на GET/PATCH/DELETE/complete/add-load, события
  чужого рейса — пустой список;
- дашборд, автопарк, локации, статистика, настройки автопарка — только свои данные;
  назначение чужого водителя/машины — 404;
- чат, SOS, платежи, фотографии — списки свои, точечные изменения чужих записей — 404,
  созданные записи — в организации вызывающего;
- сотрудники, организация, инвайт-коды (создание/отзыв), журнал аудита — только свои;
- водительское приложение `/api/m/*`: профиль, заказы, машина, смена, ТО, фото,
  геолокация, SOS, приём заказа, события рейса — свои; чужой заказ/рейс/машина — 403/404;
  ссылки из тела запроса (`orderId` в SOS и в событии рейса, `vehicleId`/`stageId` в событии,
  `driverId`-исполнитель в ТО) проверяются на принадлежность организации — чужие дают 404;
- симметрия: те же списки под сессией организации Б не содержат ни одного id организации А.

Утечки ищутся «грубо»: ни один идентификатор организации Б не должен встретиться в
сериализованном JSON ответа — так ловятся и вложенные `include`/`select`.

## Что нашлось и исправлено при самопроверке

| Место | Проблема | Исправление |
|---|---|---|
| `lib/audit.ts` + 5 точек вызова | `logAudit` писал запись без `organizationId` — действия админа не попадали в скоупленный журнал | `AuditLogInput.organizationId`, запись в `data`, передача во всех вызовах; `getAuditLogs` всегда фильтрует по организации |
| `lib/auth/session.ts` (`canDriverAccessOrder`) | заказ искался без организации водителя: совпадение `assignedDriverId` давало доступ к чужому заказу | поиск через `scopedByOrg(driver.organizationId, …)` |
| `app/api/vehicles/[id]/route.ts` (PATCH) | маркер «ok» стоял, а скоупленного чтения не было — чужую машину можно было изменить | добавлен `findFirst` со `scopedWhere` → 404; DELETE тоже отвечает 404 вместо «успешно» |
| `app/api/m/sos/route.ts` | `orderId` из тела запроса писался в сигнал и уведомление без проверки — в данных организации А появлялась ссылка на заказ организации Б | заказ проверяется в организации водителя → 404, в записи идёт проверенный id |
| `app/api/orders/[id]/route.ts` (PATCH) | **массовое присваивание**: тело раскладывалось как `...other` и целиком шло в `order.update({ data })` — вместе с `organizationId`, то есть свой заказ можно было перенести в чужую организацию | явный белый список редактируемых полей; служебные и платёжные поля — 400 с указанием, что платежи меняются в `/api/payments`; неизвестные поля — 400 |
| `app/api/orders/route.ts` (POST), `app/api/orders/[id]/route.ts` (PATCH) | `routeId` из тела запроса писался в заказ без проверки — заказ организации А ссылался бы на рейс организации Б | рейс проверяется в организации вызывающего → 404 |
| `app/m/route/events/route.ts` | `orderId`, `vehicleId`, `stageId` из тела запроса писались в событие рейса без проверки — чужие id всплывали в таймлайне (`/api/routes/:id/events` отдаёт строку события целиком) | все три ссылки проверяются в организации водителя → 404 |
| `app/api/m/maintenance/route.ts` (POST) | исполнитель (`driverId`) из тела запроса писался в запись ТО без проверки, если машина была указана | водитель проверяется в организации вызывающего → 404 |
| `scripts/audit-org-isolation.mjs` | аудит смотрел только `app/**/route.ts` и верил маркеру «ok» на слово | добавлен слой `lib/**`, проверка маркеров, поиск `organizationId` из запроса, отдельный список «manual» |
| `lib/api/driver-mobile.ts`, `lib/api/fleet.ts`, `app/debug/page.tsx` | мёртвый код с 14 неизолированными запросами и страница отладки без авторизации | удалены (живой аналог — `/api/ati/debug-dump` под гардом) |

## Как повторить проверку

```bash
npm run audit:orgs             # человекочитаемый отчёт: 64 роута + 7 модулей lib/**
npm run audit:orgs -- --json   # машинный вывод { routes, lib }
npm run audit:orgs -- --markdown   # таблицы этого отчёта
npm run verify:orgs -- --no-db # схема + аудит (без базы)
npm run verify:orgs            # + две тестовые организации в базе
npm run verify:orgs -- --base-url http://localhost:3000   # то же через живой API
npm run test:isolation         # 50 функциональных проверки изоляции
npm run test                   # node:test + vitest + изоляция
```

`verify-organizations.mjs` создаёт организации «Тест-Изоляция А/Б <метка>» с полным
набором данных (сотрудник, водитель, машина, заказ, рейс, событие рейса, смена, SOS,
фото, чат, ТО, уведомление, настройки автопарка, инвайт-код), проверяет, что логист А
не видит и не может изменить/удалить данные Б, и удаляет тестовые организации
(каскадно). Флаг `--keep` оставляет их в базе.
