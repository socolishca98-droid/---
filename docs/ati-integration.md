# Интеграция с ATI.SU

Как Loginex работает с ATI.SU и почему именно так. Документация ATI:
https://ati.su/developers/ (правила использования API — там же).

## Главная идея: у каждой организации СВОЙ аккаунт ATI

ATI.SU — это биржа грузов, где у каждой компании собственный аккаунт: свои
Персональные площадки, свои подписки, свои грузы, свои лимиты и своя история.
Поэтому интеграция устроена многоарендно:

- **Loginex = интегратор.** Один на весь продукт `client_id` (+ `client_secret`
  для OAuth) выдаётся ATI по тикету и хранится в `.env` сервера.
- **Организация = пользователь интеграции.** Каждая организация подключает
  СВОЙ аккаунт ATI: её токен шифруется и хранится в таблице `AtiConnection`
  (`organizationId`, `kind: token | oauth`, `status`, `firmId`, …).
- Все запросы к ATI идут **с токеном организации**, вся выборка из кэша
  (`AtiCache`) — только в пределах `organizationId`.
- Без подключения скан и живой поиск возвращают понятную ошибку
  `ati_not_connected`, а UI показывает баннер со ссылкой на «Организация».

Никакого «общего ключа на всех» не существует: это нарушало бы и правила ATI
(токен привязан к контакту), и изоляцию данных организаций.

## Переменные окружения (серверный `.env`)

| Переменная             | Зачем                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| `ATI_CLIENT_ID`        | client_id интегратора (выдаётся ATI по тикету). Без него OAuth скрыт. |
| `ATI_CLIENT_SECRET`    | client_secret — только для обмена/обновления OAuth-токенов.           |
| `ATI_INTEGRATOR_CODE`  | Код интегратора для заголовка `User-Agent: ati_integrator_<код>` (обязательное требование ATI). |
| `APP_BASE_URL`         | Публичный адрес приложения — из него строится `redirect_uri` OAuth. Если не задан, берётся origin запроса. |
| `AUTH_SECRET`          | Уже используется приложением; из него выводится ключ AES-256-GCM для шифрования токенов (`lib/ati/secrets.ts`). |

Legacy-переменная `ATI_TOKEN` больше не используется и удалена.

`client_id`/`client_secret` получаются тикетом в поддержку ATI: ФИО и email
ответственного, название ПО, цель интеграции. Для OAuth дополнительно
согласуется `redirect_uri` (`{APP_BASE_URL}/api/ati/oauth/callback`).

## Как организация подключается

Раздел «Организация» → карточка «Подключение к ATI.SU» (видит и меняет только
администратор).

**Вариант 1 — постоянный токен (рекомендуемый, работает всегда):**

1. Админ заходит на https://ati.su/developers/tokens/ под аккаунтом своей
   компании.
2. Создаёт постоянный токен на основании `client_id` нашего продукта.
   Токен привязан к контакту: один контакт = один действующий токен.
3. Вставляет токен в карточку → «Сохранить». Токен шифруется (AES-256-GCM)
   и кладётся в `AtiConnection` с `kind: "token"`.
4. Кнопка «Проверить» делает живой запрос `/v1.0/users/me` + `/v1.0/firms/my`
   и записывает `firmId`/`firmName` организации.

**Вариант 2 — OAuth 2.0 (когда на сервере заданы `ATI_CLIENT_ID/SECRET`):**

1. «Подключить через ATI.SU» → `GET /api/ati/oauth/start` → 302 на
   `https://id.ati.su/oauth2/?client_id=…&response_type=code&redirect_uri=…`.
2. Пользователь разрешает доступ → ATI возвращает `code` на
   `GET /api/ati/oauth/callback`.
3. Callback обменивает код (`POST https://api.ati.su/oauth2/token`) на
   `access_token` (живёт ~2 часа), `refresh_token`, `firm_id`, `contact_id`.
4. Access-токен автоматически обновляется по refresh-токену за 5 минут до
   истечения (`getActiveAtiToken`).

Отключение — «Отключить» (DELETE `/api/ati/connection`): строка подключения
удаляется, кэш организации остаётся (это её данные).

## Что мы запрашиваем у ATI

Поиск грузов через официальное API возможен **только по Персональным
площадкам**, которые видны аккаунту организации:

1. `GET /v2/boards/public/boards/canView` — площадки, где аккаунт видит грузы.
2. `GET /v1.0/loads/search/byboards` — грузы на этих площадках (свои и чужие).

Дополнительно:

- `GET /v1.0/users/me`, `GET /v1.0/firms/my` — проверка подключения и данные
  фирмы (`/api/ati/connection/check`, `/api/ati/debug`).
- `GET /v1.0/firms/{firmId}/contacts` — контакты фирмы-грузовладельца при
  просмотре груза (`lib/ati/contacts.ts`).
- `POST https://api.ati.su/oauth2/token`, `GET /oauth2/info` — OAuth.

Старый путь через `loads.ati.su/webapi` (недокументированный внутренний
эндпоинт сайта) удалён: правила ATI запрещают использовать недокументированные
возможности.

Если у организации нет видимых площадок, скан честно сообщает об этом:
нужно вступить в открытую площадку (https://ati.su/boards/public), попросить
грузовладельцев добавить фирму на свою площадку или создать свою
(`POST /v2/boards/public/boards/create`) и пригласить контрагентов.

## Заголовки и лимиты (требования ATI)

Каждый запрос (`lib/ati/http.ts`) уходит с заголовками:

```
Authorization: Bearer <токен организации>
User-Agent: ati_integrator_<ATI_INTEGRATOR_CODE>
Accept: application/json
Content-Type: application/json
Accept-Encoding: gzip, deflate, br
```

- **Не более 10 запросов/сек на контакт.** При 429 — экспоненциальная
  задержка начиная со 100 мс.
- Создание грузов — до 500/сутки на контакт (лимит фирмы = контакты × 500),
  `PUT /v2/cargos/{guid}` — до 5000/сутки. Сейчас Loginex грузы не
  публикует; лимиты станут важны, если добавим публикацию/торги
  (`PUT /v1.0/loads/new/{loadId}/responses`, `POST /v1.2/orders/takeload/{id}`).

## Архитектура (где что лежит)

| Файл                                   | Роль                                                              |
| -------------------------------------- | ----------------------------------------------------------------- |
| `lib/ati/secrets.ts`                   | AES-256-GCM шифрование токенов (ключ выводится из `AUTH_SECRET`). |
| `lib/ati/http.ts`                      | База `https://api.ati.su`, заголовки ATI, разбор HTTP-ошибок.     |
| `lib/ati/connection.ts`                | `getActiveAtiToken`, сохранение/проверка/отключение, статус, OAuth-обмен и refresh. |
| `lib/ati/oauth-shared.ts`              | `appBaseUrl` для `redirect_uri`.                                  |
| `lib/ati-client.ts`                    | Сканы и ручной поиск: `scanAtiLoads`, `manualSearch`, `fetchBoardIds`, `fetchLoadsByBoards`, кэш `saveToCache`/`getAtiCache`/`getAtiStats` — всё с `organizationId`. |
| `lib/ati/contacts.ts`                  | Контакты фирмы по грузу (токен организации).                      |
| `lib/ati/scan-schedule.ts`             | Профили плановых сканов — свои у каждой организации.              |
| `app/api/ati/connection/**`            | GET статус / POST токен / DELETE отключение / POST check.         |
| `app/api/ati/oauth/**`                 | `start` (302 на ATI) и `callback` (обмен кода, редирект на `/organization?ati=…`). |
| `app/api/ati/scan`, `cache`, `cron`, `debug` | Рабочие маршруты — каждый берёт токен СВОЕЙ организации.     |
| `app/api/orders/from-cache`            | «Взять груз»: строка чужого кэша → 404, контакты — с токеном организации. |
| `components/organization/ati-connection-card.tsx` | Карточка подключения в «Организации».                   |
| `components/orders/ati-search-panel.tsx` | Баннер `ati_not_connected` + обработка кода в скане/поиске.     |
| `prisma/schema.prisma`                 | Модели `AtiConnection`, `AtiCache.organizationId` (`@@unique([organizationId, atiLoadId])`). |

## После изменения схемы

```
npx prisma db push
```

Новые поля/таблицы (`AtiConnection`, `AtiCache.organizationId`,
`User.onboardedAt`) данных не теряют; существующие строки `AtiCache` без
организации просто не попадут ни в одну выборку — их можно удалить или
пересобрать сканами после подключения.
