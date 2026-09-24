// app/docs/page.tsx - P2-4 API docs page
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"

export const dynamic = "force-dynamic"

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Loginex TMS API Docs</h1>
        <Card>
          <CardHeader>
            <CardTitle>OpenAPI Spec</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              Полная спецификация API в формате OpenAPI 3.0. Скачайте файл или откройте через Swagger UI.
            </p>
            <div className="flex gap-4">
              <Link href="/api/docs" className="text-blue-600 underline">
                /api/docs (YAML)
              </Link>
              <Link href="/docs/swagger" className="text-blue-600 underline">
                Swagger UI (если настроен)
              </Link>
            </div>
            <div className="bg-gray-900 text-gray-100 p-4 rounded text-sm overflow-auto">
              <pre>{`openapi: 3.0.3
info:
  title: Loginex TMS API
  version: 1.0.0
servers:
  - url: http://localhost:3000

Основные эндпоинты:
- GET  /api/auth/csrf - CSRF-токен (double-submit cookie)
- POST /api/auth/login - вход сотрудника (httpOnly-cookie с подписанной сессией)
- POST /api/auth/logout - выход: отзыв сессии в БД + очистка cookie
- GET  /api/auth/session - кто сейчас вошёл (?kind=staff|driver)
- POST /api/auth/register - заявка на регистрацию (ожидает одобрения админа)
- GET  /api/auth/users - список пользователей и заявок
- PATCH /api/auth/users/[id] - одобрить / заблокировать / восстановить / сменить роль
- POST /api/m/login - вход водителя (телефон + пароль)
- GET  /api/drivers - список водителей; POST - создать (заводит логист)
- GET/POST /api/vehicles, /api/orders, /api/routes
- GET/PATCH /api/routes/[routeId], /api/routes/[routeId]/events, .../add-load, .../complete
- GET/POST /api/m/orders, /api/m/shift, /api/m/location, /api/m/sos
- GET/DELETE /api/m/photos - фото водителя; загрузка файла: POST /api/photos/upload (multipart + распознавание)
- GET/POST /api/routes/[routeId]/expenses, /api/m/expenses - расходы рейса
- GET  /api/admin/audit - журнал административных действий
- POST /api/fleet/assign - назначение машины на рейс
- GET/POST /api/chat

Security:
- Сессии в БД: подписанный httpOnly-cookie, отзыв сессии = немедленный выход
- Роли: admin | logist (кабинет), driver (мобильное приложение)
- driverId/organizationId берутся только из проверенной сессии, не из тела запроса
- Rate limiting 5/15min на входе
- CSRF double-submit cookie для изменяющих запросов к /api/*
- Zod-валидация: 400 с деталями
`}</pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Быстрый старт</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><strong>Логист:</strong> admin@loginex.ru / demo_dev_only</p>
            <p><strong>Водитель:</strong> +7 (916) 123-45-67 / АИ Логистика</p>
            <p><strong>CSRF:</strong> GET /api/auth/csrf → cookie loginex_csrf + header x-csrf-token</p>
            <p><strong>Rate limit:</strong> 6-й запрос за 15 мин → 429 Retry-After 900</p>
            <p><strong>Validation:</strong> невалидный body → 400 {`{success:false, error:"Validation failed", details:{issues}}`}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Документация</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ul className="list-disc pl-5 text-sm space-y-1">
              <li><Link href="/docs/openapi.yaml" className="text-blue-600 underline">docs/openapi.yaml</Link> — полная OpenAPI спецификация</li>
              <li>docs/postgres-migration.md — миграция на PostgreSQL</li>
              <li>docs/prompt-next.md — roadmap P0-P2</li>
              <li>__tests__/ — тесты vitest (28 passed)</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
