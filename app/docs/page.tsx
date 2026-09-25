// app/docs/page.tsx — документация API для сотрудников
//
// Раньше эта страница была подделкой: светлый лист на тёмном приложении, а
// внутри — вручную вписанный кусок спецификации, ссылки на несуществующие
// файлы (`/docs/openapi.yaml`, `/docs/swagger` — 404), пароль администратора
// открытым текстом и устаревшие счётчики тестов. Такая «документация» врёт
// сразу после первого изменения в коде.
//
// Теперь источник правды — сам код: список эндпоинтов собирает
// `npm run docs:api` (скрипт обходит app/api) в docs/api-endpoints.json, а
// страница импортирует готовый манифест. Импорт, а не чтение файлов на месте,
// — чтобы список был и в собранном образе, где исходников рядом нет.
// Тест tests/api-docs.test.mjs следит, что манифест не устарел.

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import manifest from "@/docs/api-endpoints.json"
import { groupEndpoints, type Endpoint } from "@/lib/api-docs/endpoints"

export const dynamic = "force-dynamic"

export default function DocsPage() {
  const endpoints = manifest.endpoints as Endpoint[]
  const groups = groupEndpoints(endpoints)
  const spec = manifest.openApi
  const generatedAt = new Date(manifest.generatedAt).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">API Loginex TMS</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Список собран из кода приложения: каждый пункт — существующий обработчик,
            вписывать вручную нечего. Обновлён {generatedAt}.
          </p>
        </div>

        <Card className="surface-glass">
          <CardHeader>
            <CardTitle>Машинночитаемая спецификация</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-4">
              <Link href="/api/docs" className="text-primary underline">
                /api/docs
              </Link>
              <span className="text-muted-foreground">
                {spec
                  ? `${spec.title} ${spec.version}: описано путей — ${spec.routes} (${spec.covered} из них есть в коде), методов — ${spec.methods}; в приложении эндпоинтов — ${endpoints.length}`
                  : "спецификация не найдена"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Спецификация не обязана описывать всё сразу: непокрытые эндпоинты перечислены
              ниже по фактическому коду. При расхождении верен код. Обновить список после
              правок: <code>npm run docs:api</code> (он же выполняется перед сборкой, а
              расхождение ловит <code>npm test</code>).
            </p>
          </CardContent>
        </Card>

        <Card className="surface-glass">
          <CardHeader>
            <CardTitle>Правила доступа</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Все данные ограничены организацией из сессии: <b>organizationId</b> берётся из
              подписанного токена, а не из тела запроса или параметров URL.
            </p>
            <p>
              Роли: <b>admin</b> и <b>logist</b> — кабинет, <b>driver</b> — мобильный контур{" "}
              <code>/api/m/*</code>. Автор фото, водитель рейса и принадлежность заказа
              проверяются на сервере; чужие идентификаторы не подделываются.
            </p>
            <p>
              Очередь загрузки фото в мобильном контуре (IndexedDB) шлёт файл после возвращения
              связи — фото чека не теряется на трассе.
            </p>
          </CardContent>
        </Card>

        {endpoints.length === 0 && (
          <Card className="surface-glass border-amber-500/40">
            <CardHeader>
              <CardTitle className="text-base">Список пуст</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Исходники роутов не найдены рядом с приложением (такое бывает при запуске из
              собранного бандла). Тогда смотрите спецификацию:{" "}
              <Link href="/api/docs" className="text-primary underline">
                /api/docs
              </Link>
              .
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {[...groups.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([group, list]) => (
              <Card key={group} className="surface-glass">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="font-mono text-primary">/api/{group}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {list.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {list.map((endpoint) => (
                    <div
                      key={`${endpoint.method} ${endpoint.route}`}
                      className="flex items-center gap-3 text-sm py-0.5"
                    >
                      <span
                        className={`font-mono text-[11px] w-16 shrink-0 ${
                          endpoint.method === "GET"
                            ? "text-emerald-500"
                            : endpoint.method === "DELETE"
                              ? "text-rose-500"
                              : "text-amber-500"
                        }`}
                      >
                        {endpoint.method}
                      </span>
                      <code className="font-mono text-xs text-muted-foreground break-all">
                        {endpoint.route}
                      </code>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
        </div>

        <Card className="surface-glass">
          <CardHeader>
            <CardTitle>Разработчику</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>
              <code>npm test</code> — типовые, изоляционные и юнит-тесты расчётов.
            </p>
            <p>
              <code>npm run audit:orgs</code> — проверка, что каждый бизнес-запрос ограничен
              организацией.
            </p>
            <p>
              <code>docs/prompt-next.md</code> — журнал изменений по задачам: что сделано,
              почему именно так и что осталось.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
