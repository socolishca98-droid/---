// app/owner/dev/page.tsx — кабинет разработчика (и60).
//
// Просьба владельца после закрытия жалобы №12: «всё, что брал для
// аналитики, организуй мне в кабинет разработчика». Все одиннадцать дней
// разбора жалоб аналитика велась сторонними инструментами: сырые SQL к
// AuditLog и Session, OCR скриншотов, браузерные сценарии, curl прод-сайта.
// Здесь то же самое — внутри программы:
//
//   1. Сводка: метка сборки, серверное время, аптайм, счётчики базы.
//   2. Хроника входов: журнал с РАСКРЫТЫМИ метаданными датчиков (и37/и50:
//      какие cookie приложены, жива ли сессия водителя, устройство, откуда
//      пришёл) — то, по чему читались жалобы №7–№12.
//   3. Живые сессии: кто в системе прямо сейчас (префикс id — не секрет).
//   4. Рецепты: легенда датчиков, приёмочные сценарии mini46–59,
//      прод-проверки, SQL-заготовки, OCR скриншотов.

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Activity, ArrowLeft, Cpu, Loader2, RefreshCw, Search, Terminal, Users } from "lucide-react"

import { OwnerShell } from "@/components/owner/owner-shell"
import { ACTION_LABELS, Forbidden, Panel, actionLabel, formatDateTime } from "@/components/owner/owner-ui"
import { useJsonApi } from "@/hooks/use-json-api"
import { useStaffSession } from "@/hooks/use-staff-session"

interface DevEvent {
  id: string
  createdAt: string
  action: string
  actorEmail: string | null
  actorName: string | null
  actorPhone: string | null
  org: string | null
  targetType: string
  targetEmail: string | null
  ip: string | null
  metadata: Record<string, unknown> | null
}

interface DevSession {
  who: string
  contact: string | null
  role: string
  sessionPrefix: string
  createdAt: string
  expiresAt: string
  lastSeenAt: string | null
  device: string
  ip: string | null
}

interface DevResponse {
  build: string
  serverTime: string
  uptimeSec: number
  node: string
  hours: number
  counts: {
    organizations: number
    users: number
    drivers: number
    orders: number
    liveSessions: number
  }
  sessions: DevSession[]
  events: DevEvent[]
}

/** Человеческие подписи для кодов журнала, которыми не пользуется
 *  обычный «Журнал действий» (датчики и отказы имперсации). */
const DEV_ACTION_LABELS: Record<string, string> = {
  ...ACTION_LABELS,
  impersonate_refused: "«Войти как …» — отказ",
  diag_m_layout: "Датчик: запрос кабинета /m",
  diag_m_login: "Датчик: рендер входа водителя",
  diag_login: "Датчик: рендер входа логиста",
  diag_impersonate: "Датчик: выпуск имперсации",
  diag_api_session: "Датчик: проверка сессии",
}

function devActionLabel(action: string): string {
  return DEV_ACTION_LABELS[action] ?? actionLabel(action)
}

/** Короткая подпись устройства из User-Agent (полный UA хранится в базе). */
function deviceLabel(ua: string): string {
  if (!ua) return "—"
  const parts: string[] = []
  if (/iPhone/i.test(ua)) parts.push("iPhone")
  else if (/iPad/i.test(ua)) parts.push("iPad")
  else if (/Android/i.test(ua)) parts.push("Android")
  else if (/Windows/i.test(ua)) parts.push("Windows")
  else if (/Mac OS X/i.test(ua)) parts.push("Mac")
  else if (/Linux/i.test(ua)) parts.push("Linux")
  const safari = /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|FxiOS/i.test(ua)
  if (safari) parts.push("Safari")
  else if (/CriOS|Chrome|Chromium/i.test(ua)) parts.push("Chrome")
  else if (/FxiOS|Firefox/i.test(ua)) parts.push("Firefox")
  else if (/Edg/i.test(ua)) parts.push("Edge")
  return parts.length > 0 ? parts.join(" · ") : ua.slice(0, 32)
}

/** Ключи метаданных датчиков — по-человечески. */
const META_LABELS: Record<string, string> = {
  path: "Путь",
  cookies: "Cookie при запросе",
  driverAlive: "Сессия водителя",
  build: "Метка сборки",
  dest: "Тип запроса",
  mode: "Режим",
  rsc: "RSC",
  ua: "Устройство",
  ref: "Пришёл с",
  role: "Роль",
  kind: "Вид входа",
  byPassword: "По паролю",
  reason: "Причина",
  name: "Имя",
  email: "Почта",
  phone: "Телефон",
  ses: "Сессия",
  session: "Сессия",
  driverName: "Водитель",
  staffEmail: "Из штаба",
  targetName: "Цель",
}

function metaValueText(key: string, value: unknown): string {
  if (key === "driverAlive") return value ? "жива" : "нет"
  if (key === "ua") return deviceLabel(String(value))
  if (key === "ref") {
    try {
      return new URL(String(value)).pathname
    } catch {
      return String(value)
    }
  }
  if (key === "cookies" && Array.isArray(value)) return value.join(", ")
  if (typeof value === "boolean") return value ? "да" : "нет"
  if (value === null || value === undefined || value === "") return ""
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function actorText(e: DevEvent): string {
  if (e.actorEmail) return e.actorEmail
  const parts = [e.actorName, e.actorPhone].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : e.targetType === "diagnostic" ? "датчик" : "—"
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d > 0 ? `${d} д ${h} ч` : h > 0 ? `${h} ч ${m} мин` : `${m} мин`
}

/** Приёмочные сценарии: заголовки — из самих скриптов scripts/mini*.mjs. */
const MINIS: { name: string; what: string }[] = [
  { name: "mini46", what: "Переключатели экранов входа: «Войти как водитель» ↔ «войти как логист»" },
  { name: "mini47", what: "Телефон: «Войти как водитель» открывает кабинет в той же вкладке" },
  { name: "mini50", what: "Воспроизведение жалобы №13: экран авторизации после «Войти как водитель»" },
  { name: "mini50b", what: "Последний непротестированный переход: сессия истекла в открытой вкладке" },
  { name: "mini51", what: "«Утро владельца»: штабная cookie потеряна за ночь — спасение в панель" },
  { name: "mini52", what: "«Окаменевший экран»: щит воскрешения + пульс кабинета" },
  { name: "mini53", what: "Сторож краски: детектор «экран показывает старую картину»" },
  { name: "mini54", what: "Живые часы на каждом экране тикают (снимок/призрак — стоят)" },
  { name: "mini55", what: "«Встряхивание композитора» при возврате к экрану" },
  { name: "mini56", what: "Телефон: «Войти как …» — путь через страницу-пересадку (сценарий 4)" },
  { name: "mini57", what: "Путь «Войти как …» на телефоне после и57" },
  { name: "mini58", what: "Пересадка + настоящая ссылка «Открыть кабинет» (жалоба №11)" },
  { name: "mini59", what: "Главное: /m с живой сессией — кабинет без единого поля входа (жалоба №12)" },
]

const SENSORS: { code: string; what: string; where: string }[] = [
  { code: "diag_m_layout", what: "Каждый заход на /m и /m/login: приложенные cookie, жива ли сессия водителя, метка сборки, устройство, откуда пришёл", where: "app/m/layout.tsx" },
  { code: "diag_m_login", what: "Рендер страницы входа водителя (сколько раз она реально показывалась)", where: "app/m/login/page.tsx" },
  { code: "diag_login", what: "Рендер входа логиста", where: "app/login/page.tsx" },
  { code: "diag_impersonate", what: "Выпуск имперсационной сессии — сразу после «Войти как …»", where: "app/api/admin/impersonate/route.ts" },
  { code: "diag_api_session", what: "Нештатные проверки сессии через API", where: "app/api/auth/session/route.ts" },
]

const PERIODS = [
  { id: 12, label: "12 часов" },
  { id: 24, label: "24 часа" },
  { id: 72, label: "3 дня" },
  { id: 168, label: "7 дней" },
]

const TYPES = [
  { id: "", label: "Все события" },
  { id: "logins", label: "Входы" },
  { id: "impersonation", label: "«Войти как …»" },
  { id: "diag", label: "Датчики" },
  { id: "refused", label: "Отказы" },
]

function typeMatches(type: string, action: string): boolean {
  if (type === "logins") return action === "login" || action === "logout"
  if (type === "impersonation") return action === "impersonate" || action === "impersonation_end"
  if (type === "diag") return action.startsWith("diag_")
  if (type === "refused") return action.includes("refused")
  return true
}

const selectClass =
  "h-10 rounded-lg border border-border bg-card px-3 text-[13px] text-foreground transition-colors duration-200 focus:border-primary focus:outline-none"

function Tile({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5" style={{ animation: "rise-in 420ms cubic-bezier(0.22, 1, 0.36, 1) both" }}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1.5 font-mono text-[17px] font-semibold leading-tight">{value}</div>
    </div>
  )
}

export default function OwnerDevPage() {
  const { user } = useStaffSession()
  const [hours, setHours] = useState(24)
  const [type, setType] = useState("")
  const [query, setQuery] = useState("")

  const api = useJsonApi<DevResponse>(user ? `/api/admin/dev?hours=${hours}` : null)

  const events = useMemo(() => {
    const list = api.data?.events ?? []
    const q = query.trim().toLowerCase()
    return list.filter((e) => {
      if (!typeMatches(type, e.action)) return false
      if (!q) return true
      const hay = [
        e.action,
        devActionLabel(e.action),
        actorText(e),
        e.org ?? "",
        e.targetEmail ?? "",
        e.ip ?? "",
        e.metadata ? JSON.stringify(e.metadata) : "",
      ]
        .join(" ")
        .toLowerCase()
      return hay.includes(q)
    })
  }, [api.data, type, query])

  const forbidden = Boolean(api.error && /недостаточно прав/i.test(api.error))

  return (
    <OwnerShell>
      <Link
        href="/owner"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors duration-200 hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Все компании
      </Link>

      <header className="mt-4 flex flex-col gap-1" style={{ animation: "rise-in 480ms cubic-bezier(0.22, 1, 0.36, 1) both" }}>
        <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
          <Terminal className="h-5 w-5 text-primary" /> Кабинет разработчика
        </h1>
        <p className="text-[13.5px] text-muted-foreground">
          Инструменты, которыми разбирались жалобы №7–№12: хроника входов с датчиками,
          живые сессии, приёмочные сценарии и рецепты проверок.
        </p>
      </header>

      {forbidden ? (
        <div className="mt-6">
          <Forbidden message="Недостаточно прав для этого раздела." />
        </div>
      ) : null}

      {/* ── Сводка ─────────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Tile icon={Cpu} label="Сборка" value={api.data?.build ?? "…"} />
        <Tile icon={Activity} label="Сервер" value={api.data ? formatDateTime(api.data.serverTime) : "…"} />
        <Tile icon={Activity} label="Аптайм" value={api.data ? formatUptime(api.data.uptimeSec) : "…"} />
        <Tile icon={Users} label="Живые сессии" value={api.data ? String(api.data.counts.liveSessions) : "…"} />
        <Tile icon={Users} label="Люди / водители" value={api.data ? `${api.data.counts.users} / ${api.data.counts.drivers}` : "…"} />
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Node {api.data?.node ?? "…"} · компаний: {api.data?.counts.organizations ?? "…"} · заказов:{" "}
        {api.data?.counts.orders ?? "…"}
      </p>

      {/* ── Хроника входов ─────────────────────────────────────────── */}
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={selectClass} aria-label="Период">
          {PERIODS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={selectClass} aria-label="Тип событий">
          {TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: имя, действие, путь, устройство…"
            className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => api.reload()}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3.5 text-[13px] transition-colors duration-200 hover:bg-secondary"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${api.loading ? "animate-spin" : ""}`} /> Обновить
        </button>
      </div>

      <div className="mt-4">
        <Panel title={`Хроника входов: ${events.length}${api.data ? ` из ${api.data.events.length}` : ""}`}>
          {api.loading && !api.data ? (
            <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаю хронику…
            </p>
          ) : api.error ? (
            <p className="px-4 py-6 text-center text-[13px] text-destructive">{api.error}</p>
          ) : events.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">Событий по этим фильтрам нет</p>
          ) : (
            <div className="divide-y divide-border">
              {events.map((e) => (
                <div key={e.id} className="px-4 py-3" style={{ animation: "rise-in 320ms cubic-bezier(0.22, 1, 0.36, 1) both" }}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-[12px] text-muted-foreground">{formatDateTime(e.createdAt)}</span>
                    <span className="text-[13.5px] font-medium">{devActionLabel(e.action)}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{e.action}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-muted-foreground">
                    <span>Кто: {actorText(e)}</span>
                    {e.org ? <span>Компания: {e.org}</span> : null}
                    {e.targetEmail ? <span>Над кем: {e.targetEmail}</span> : null}
                    {e.ip ? <span>IP: {e.ip}</span> : null}
                  </div>
                  {e.metadata ? (
                    <div className="mt-1.5 grid gap-x-6 gap-y-0.5 text-[12px] sm:grid-cols-2">
                      {Object.entries(e.metadata)
                        .map(([k, v]) => [k, metaValueText(k, v)] as const)
                        .filter(([, text]) => text !== "")
                        .map(([k, text]) => (
                          <div key={k} className="flex gap-2">
                            <span className="min-w-[130px] text-muted-foreground">{META_LABELS[k] ?? k}:</span>
                            <span className="font-mono break-all">{text}</span>
                          </div>
                        ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Живые сессии ───────────────────────────────────────────── */}
      <div className="mt-8">
        <Panel title={`Живые сессии: ${api.data?.sessions.length ?? 0}`}>
          {api.loading && !api.data ? (
            <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаю сессии…
            </p>
          ) : (api.data?.sessions ?? []).length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">Живых сессий нет</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[13px]">
                <thead className="border-b border-border text-[12px] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Кто</th>
                    <th className="px-4 py-2.5 font-medium">Роль</th>
                    <th className="px-4 py-2.5 font-medium">Сессия</th>
                    <th className="px-4 py-2.5 font-medium">Создана</th>
                    <th className="px-4 py-2.5 font-medium">Истекает</th>
                    <th className="px-4 py-2.5 font-medium">Был</th>
                    <th className="px-4 py-2.5 font-medium">Устройство</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(api.data?.sessions ?? []).map((s, i) => (
                    <tr key={s.sessionPrefix + i} className="transition-colors duration-200 hover:bg-secondary/40">
                      <td className="px-4 py-2.5">
                        <span className="text-foreground/90">{s.who}</span>
                        {s.contact ? <span className="block text-[11.5px] text-muted-foreground">{s.contact}</span> : null}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{s.role}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-muted-foreground">{s.sessionPrefix}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{formatDateTime(s.createdAt)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{formatDateTime(s.expiresAt)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                        {s.lastSeenAt ? formatDateTime(s.lastSeenAt) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{deviceLabel(s.device)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* ── Рецепты ────────────────────────────────────────────────── */}
      <div className="mt-8 flex flex-col gap-6 pb-10">
        <Panel title="Легенда датчиков (что и куда пишется)">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="border-b border-border text-[12px] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Код</th>
                  <th className="px-4 py-2.5 font-medium">Что фиксирует</th>
                  <th className="px-4 py-2.5 font-medium">Где живёт</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {SENSORS.map((s) => (
                  <tr key={s.code}>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px]">{s.code}</td>
                    <td className="px-4 py-2.5 text-foreground/90">{s.what}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-muted-foreground">{s.where}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 pb-3 pt-2 text-[12px] text-muted-foreground">
            Датчики поставлены на время разбора жалоб (и37/и50) и оставлены: без них журнал
            отвечает «что сделал сервер», но не «что прислал браузер». Убираются одним коммитом,
            если решите, что они больше не нужны.
          </p>
        </Panel>

        <Panel title="Приёмочные сценарии (браузерные, scripts/mini*.mjs)">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="border-b border-border text-[12px] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Сценарий</th>
                  <th className="px-4 py-2.5 font-medium">Что проверяет</th>
                  <th className="px-4 py-2.5 font-medium">Запуск</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {MINIS.map((m) => (
                  <tr key={m.name}>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px]">{m.name}</td>
                    <td className="px-4 py-2.5 text-foreground/90">{m.what}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11.5px] text-muted-foreground">
                      node scripts/{m.name}.mjs
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 pb-3 pt-2 text-[12px] text-muted-foreground">
            Гоняются против дев-сервера (BASE, по умолчанию http://localhost:3100) с живой базой.
            Пароль e2e-аккаунта — в переменных окружения E2E_EMAIL / E2E_PASSWORD.
          </p>
        </Panel>

        <Panel title="Прод-проверки руками (после каждого обновления сайта)">
          <ul className="flex flex-col gap-2 px-4 py-3 text-[13px]">
            <li>
              <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px]">curl -sI https://сайт/m</code> —
              аноним должен получить <b>307</b> на <code className="font-mono text-[12px]">/m/login</code>: форма входа
              не живёт на адресе кабинета (урок жалобы №12).
            </li>
            <li>
              <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px]">curl -s https://сайт/m/login | grep -o &quot;метка&quot;</code> —
              метка сборки на странице входа должна совпадать с последним коммитом.
            </li>
            <li>
              <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px]">curl -sI https://сайт/owner/open-account</code> —
              аноним получает <b>307</b>: страница-пересадка не открывается без штабной сессии.
            </li>
            <li>
              Деплой: статус сборки и хэш коммита — в панели хостинга (Vercel), деплой должен быть
              READY и собран из последнего коммита main.
            </li>
          </ul>
        </Panel>

        <Panel title="Чтение журнала напрямую (SQL, для разбора на машине разработчика)">
          <pre className="overflow-x-auto rounded-lg bg-secondary/60 p-3 font-mono text-[12px] leading-relaxed">{`-- последние события журнала (то, что видно в «Хронике входов»)
select "createdAt", action, "actorId", "actorEmail", metadata
from "AuditLog"
where "createdAt" > now() - interval '24 hours'
order by "createdAt" desc limit 200;

-- кто сейчас в системе
select s."createdAt", u.name, u.email, s.role, s."lastSeenAt", s."userAgent"
from "Session" s join "User" u on u.id = s."userId"
where s."expiresAt" > now() and s."revokedAt" is null
order by s."createdAt" desc;`}</pre>
          <p className="px-4 pb-3 pt-2 text-[12px] text-muted-foreground">
            Подключение — параметры базы проекта из переменных окружения; полный id сессии —
            секрет, в интерфейсе выше показываются только префиксы.
          </p>
        </Panel>

        <Panel title="Скриншоты от владельца: как читаются (OCR)">
          <ol className="flex list-decimal flex-col gap-1.5 px-8 py-3 text-[13px]">
            <li>Вырезать полосу с текстом (часы, метка сборки, баннер «Вы вошли как»).</li>
            <li>Градации серого → автоконтраст → увеличение в 3–6 раз (LANCZOS).</li>
            <li>
              <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px]">tesseract img stdout -l rus+eng --psm 4</code>{" "}
              (узкие полосы — <code className="font-mono text-[12px]">--psm 6</code>).
            </li>
            <li>Сверить часы скриншота с журналом сервера (у владельца UTC+3) — находится точный запрос.</li>
          </ol>
        </Panel>
      </div>
    </OwnerShell>
  )
}
