# Изоляция данных по организациям — пофайловый отчёт

Задача «Организации», пункты 6 и 9: пройден **каждый** API-роут проекта, во все запросы
бизнес-данных добавлен фильтр `organizationId`, который берётся **только из проверенной
сессии на сервере** (никогда из тела или query запроса).

Отчёт сгенерирован автоматически: `npm run audit:orgs -- --markdown > /tmp/table.md`
(аудитор: `scripts/audit-org-isolation.mjs`). Проверка вживую: `npm run verify:orgs`
(`scripts/verify-organizations.mjs`, опционально `--base-url http://localhost:3000`).

## Что означает каждая колонка

- **Гард доступа** — функция, которая проверяет сессию до любого запроса к данным
  (`requireStaff`, `requireDriver`, `requireAnySession`, `requireStaffAuth`, `getStaffSession`).
- **Организация из сессии** — вызывается ли `requireOrganization` / `requireStaffOrganization`
  / `requireDriverOrganization` из `lib/org` (403, если учётка не привязана к организации).
- **Бизнес-запросов** — сколько обращений к таблицам с `organizationId`
  (включая `tx.<model>` внутри `$transaction`).
- **Статус** — «изолирован» означает: каждый бизнес-запрос в файле содержит
  `scopedWhere(organizationId, …)` либо `organizationId` в `data`, либо помечен
  комментарием `// org-audit: ok — <причина>` (запрос идёт по id, уже проверенному
  на принадлежность организации).

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
| `app/api/m/sos/route.ts` | POST | `requireDriver` | да | 5 | `driver`, `sosAlert`, `notification`, `chatMessage`, `order` | изолирован |
| `app/api/m/vehicle/route.ts` | GET, POST | `requireDriver` | да | 4 | `vehicle`, `driver` | изолирован |
| `app/api/orders/[id]/route.ts` | GET, PATCH, DELETE | `requireStaffAuth` | да | 5 | `order`, `driver`, `vehicle` | изолирован |
| `app/api/orders/route.ts` | GET, POST | `requireStaffAuth` | да | 4 | `order`, `driver`, `vehicle` | изолирован |
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
| `app/api/vehicles/[id]/route.ts` | GET, PATCH, DELETE | `requireStaffAuth` | да | 4 | `vehicle`, `driver` | изолирован |
| `app/api/vehicles/route.ts` | GET, POST | `requireStaffAuth` | да | 3 | `vehicle` | изолирован |
| `app/m/route/events/route.ts` | POST | `requireDriver` | да | 4 | `route`, `order`, `routeEvent` | изолирован |

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

## Как повторить проверку

```bash
npm run audit:orgs            # человекочитаемый отчёт по 64 роутам
npm run audit:orgs -- --json  # машинный вывод
npm run verify:orgs           # схема + аудит + две тестовые организации в базе
npm run verify:orgs -- --base-url http://localhost:3000   # то же через живой API
```

`verify-organizations.mjs` создаёт организации «Тест-Изоляция А/Б <метка>» с полным
набором данных (сотрудник, водитель, машина, заказ, рейс, событие рейса, смена, SOS,
фото, чат, ТО, уведомление, настройки автопарка, инвайт-код), проверяет, что логист А
не видит и не может изменить/удалить данные Б, и удаляет тестовые организации
(каскадно). Флаг `--keep` оставляет их в базе.
