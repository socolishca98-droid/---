/**
 * Классификатор маршрутов: кто имеет право обращаться к пути.
 *
 * Чистая функция без побочных эффектов — используется в middleware (edge) и покрыта
 * юнит-тестами (tests/auth-access.test.mjs), поэтому правила доступа можно
 * менять осознанно, а не «на глаз».
 *
 * Важно: классификатор решает только, какой cookie требуется (сотрудника,
 * водителя, любой, либо никакой). Окончательное решение — за серверными
 * guard'ами в lib/auth/session.ts, которые дополнительно проверяют статус
 * пользователя и отзыв сессии в БД, а также права на конкретную запись.
 */

export type AccessArea =
  /** доступ без авторизации (вход, регистрация, публичные эндпоинты) */
  | "public"
  /** только сотрудник: admin или logist */
  | "staff"
  /** только водитель */
  | "driver"
  /** любая авторизованная роль; права на запись проверяет обработчик */
  | "any"
  /** защищается отдельным секретом (CRON_SECRET), а не сессией */
  | "secret"

export interface RouteAccess {
  area: AccessArea
  /** это эндпоинт /api/* — ему 401 JSON вместо редиректа */
  isApi: boolean
  /** куда отправлять неаутентифицированного пользователя-страницу */
  loginPath: string
  /** человекочитаемое объяснение решения (логи, тесты) */
  reason: string
}

const STAFF_LOGIN = "/login"
const DRIVER_LOGIN = "/m/login"

/** Точные публичные пути */
const PUBLIC_PATHS = new Set<string>([
  "/",
  "/login",
  "/register",
  "/m/login",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/logout",
  "/api/auth/session",
  // выдача CSRF-токена нужна до входа (клиентский CsrfProvider дёргает его при старте)
  "/api/auth/csrf",
  "/api/health",
])

/** Пути, защищённые собственным секретом, а не пользовательской сессией */
const SECRET_PATHS = new Set<string>(["/api/ati/cron"])

/** Служебные префиксы, которые middleware вообще не должен трогать */
const BYPASS_PREFIXES = ["/_next", "/api/auth/public"]

/** Расширения статических файлов */
const STATIC_EXTENSION =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|cjs|map|txt|json|webmanifest|woff2?|ttf|otf|pdf|mp3|wav|webm|mp4)$/i

type SegmentPattern = string[]

/** Маршруты /api, доступные любой авторизованной роли.
 *  Обработчик обязан сам проверить принадлежность данных
 *  (водитель видит только свои заказы, свой чат и свой рейс). */
const ANY_ROLE_API: { pattern: SegmentPattern; reason: string }[] = [
  { pattern: ["api", "chat"], reason: "чат используют и логист, и водитель" },
  { pattern: ["api", "orders"], reason: "водитель читает свои заказы" },
  { pattern: ["api", "orders", ":id"], reason: "водитель меняет статус своего заказа" },
  { pattern: ["api", "drivers", ":id"], reason: "водитель читает свою карточку" },
  {
    pattern: ["api", "drivers", ":id", "active-order"],
    reason: "водитель читает свой активный заказ",
  },
  {
    pattern: ["api", "routes", ":id", "complete"],
    reason: "водитель завершает свой рейс",
  },
  {
    pattern: ["api", "routes", ":id", "events"],
    reason: "водитель читает события своего рейса",
  },
  {
    pattern: ["api", "m", "maintenance"],
    reason: "журнал ТО ведут и водитель, и логист в карточке машины",
  },
  {
    pattern: ["api", "auth", "change-password"],
    reason: "пароль меняет и сотрудник, и водитель (в своём профиле)",
  },
]

/** Явно штабные подпути, которые иначе попали бы под шаблон ":id" */
const STAFF_ONLY_API: { pattern: SegmentPattern; reason: string }[] = [
  { pattern: ["api", "drivers", "locations"], reason: "карта водителей — только для логиста" },
  { pattern: ["api", "drivers", "stats"], reason: "сводка по водителям — только для логиста" },
]

function splitSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean)
}

function matchesPattern(segments: string[], pattern: SegmentPattern): boolean {
  if (segments.length !== pattern.length) return false
  for (let i = 0; i < pattern.length; i++) {
    const part = pattern[i]
    if (part === ":id") continue
    if (part !== segments[i]) return false
  }
  return true
}

function matchAny(
  segments: string[],
  list: { pattern: SegmentPattern; reason: string }[],
): string | null {
  for (const entry of list) {
    if (matchesPattern(segments, entry.pattern)) return entry.reason
  }
  return null
}

/** Приведение пути: убираем дубли и хвостовой слэш (кроме корня) */
export function normalizePathname(pathname: string): string {
  if (!pathname) return "/"
  let result = pathname
  if (result.length > 1 && result.endsWith("/")) result = result.slice(0, -1)
  return result || "/"
}

export function classifyRoute(rawPathname: string): RouteAccess {
  const pathname = normalizePathname(rawPathname)
  const isApi = pathname === "/api" || pathname.startsWith("/api/")
  const segments = splitSegments(pathname)

  const loginPath = pathname.startsWith("/m") ? DRIVER_LOGIN : STAFF_LOGIN

  // 1. Статика и служебные пути Next.js
  if (BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return { area: "public", isApi: false, loginPath, reason: "служебный путь Next.js" }
  }
  if (STATIC_EXTENSION.test(pathname)) {
    return { area: "public", isApi: false, loginPath, reason: "статический файл" }
  }

  // 2. Явно публичные пути
  if (PUBLIC_PATHS.has(pathname)) {
    return { area: "public", isApi, loginPath, reason: "публичный путь" }
  }

  // 3. Пути с собственным секретом
  if (SECRET_PATHS.has(pathname)) {
    return {
      area: "secret",
      isApi,
      loginPath,
      reason: "проверяется CRON_SECRET в обработчике",
    }
  }

  // 4. API: явные штабные исключения → «любая роль» → водительский контур → штаб
  if (isApi) {
    const staffReason = matchAny(segments, STAFF_ONLY_API)
    if (staffReason) {
      return { area: "staff", isApi: true, loginPath, reason: staffReason }
    }

    const anyReason = matchAny(segments, ANY_ROLE_API)
    if (anyReason) {
      return { area: "any", isApi: true, loginPath, reason: anyReason }
    }

    if (pathname.startsWith("/api/m/")) {
      return {
        area: "driver",
        isApi: true,
        loginPath: DRIVER_LOGIN,
        reason: "API мобильного контура водителя",
      }
    }

    return {
      area: "staff",
      isApi: true,
      loginPath,
      reason: "API логиста/администратора",
    }
  }

  // 5. Страницы мобильного контура водителя
  if (pathname === "/m" || pathname.startsWith("/m/")) {
    return {
      area: "driver",
      isApi: false,
      loginPath: DRIVER_LOGIN,
      reason: "страница мобильного контура водителя",
    }
  }

  // 6. Всё остальное — страницы сотрудника
  return { area: "staff", isApi: false, loginPath, reason: "страница сотрудника" }
}

/** Нужен ли cookie сотрудника для этого пути */
export function acceptsStaff(area: AccessArea): boolean {
  return area === "staff" || area === "any"
}

/** Нужен ли cookie водителя для этого пути */
export function acceptsDriver(area: AccessArea): boolean {
  return area === "driver" || area === "any"
}
