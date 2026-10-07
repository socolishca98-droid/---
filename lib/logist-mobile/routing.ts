/**
 * Правила перехода между контурами сотрудника.
 *
 * Логист работает с телефона, поэтому мобильную панель /lm нужно не только
 * иметь, но и не дать потерять: с телефона десктопные разделы (заказы, рейсы,
 * водители, дашборд) уводят в /lm-аналог, а с компьютера остаётся полная версия.
 *
 * Модуль намеренно чистый (без Next и без БД) — его проверяют юнит-тесты
 * tests/logist-mobile-routing.test.mjs.
 */

/** Префиксы разделов, у которых есть мобильный аналог. */
const SECTION_MAP: Array<[string, string]> = [
  ["/orders", "/lm/orders"],
  ["/routes", "/lm/routes"],
  ["/drivers", "/lm/drivers"],
  ["/clients", "/lm/clients"],
  ["/payments", "/lm/payments"],
  ["/fleet", "/lm/fleet"],
  ["/chat", "/lm/chat"],
  ["/reports", "/lm/reports"],
  ["/search", "/lm/search"],
  ["/fuel", "/lm/fuel"],
  ["/photos", "/lm/photos"],
]

/**
 * Разделы администратора. Логисту они всё равно недоступны (API отвечает 403),
 * поэтому уводим в мобильные аналоги только админа — иначе логист с телефона
 * попал бы на экран «только для администратора» вместо своей панели.
 */
const ADMIN_SECTION_MAP: Array<[string, string]> = [
  ["/users", "/lm/users"],
  ["/organization", "/lm/organization"],
  ["/audit", "/lm/audit"],
  ["/settings", "/lm/settings"],
]

/**
 * Разделы без мобильного аналога (расходы) остаются в полной версии: её вёрстка
 * адаптирована под телефон — сайдбар прячется, меню открывается кнопкой.
 */

/**
 * Внутренний путь из ?next= — или null, если он небезопасен.
 * Отсекаем «//host» и обратные слэши, иначе получился бы открытый редирект.
 */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value) return null
  if (!value.startsWith("/")) return null
  if (value.startsWith("//")) return null
  if (value.includes("\\")) return null
  return value
}

/**
 * Куда вести уже вошедшего сотрудника с публичной страницы (/ или /login).
 * Явный ?next= уважаем всегда; иначе логист идёт в мобильную панель,
 * администратор — в полную версию.
 */
export function staffHome(role: string | undefined, nextParam: string | null): string {
  return safeInternalPath(nextParam) ?? (role === "logist" ? "/lm" : "/dashboard")
}

/** Открыт ли сайт с телефона/планшета (по User-Agent). */
export function isMobileDevice(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  return /Android|iPhone|iPod|iPad|Windows Phone|IEMobile|Opera Mini|Mobile Safari|Mobile\b/i.test(
    userAgent,
  )
}

/**
 * Мобильный аналог десктопного раздела — или null, если аналога нет.
 * Подпуть сохраняется: /orders/abc → /lm/orders/abc.
 */
export function mobileLogistTarget(pathname: string, role?: string): string | null {
  if (pathname === "/dashboard") return "/lm"

  const tables = role === "admin" ? [SECTION_MAP, ADMIN_SECTION_MAP] : [SECTION_MAP]

  for (const table of tables) {
    for (const [from, to] of table) {
      if (pathname === from) return to
      if (pathname.startsWith(`${from}/`)) return `${to}${pathname.slice(from.length)}`
    }
  }

  return null
}

/**
 * Нужно ли увести сотрудника с этой страницы в мобильную панель.
 * Правило общее для всех штабных ролей: на телефоне полная версия непригодна
 * и логисту, и администратору. Не уводим: из /lm, из печати, из API и когда
 * человек сам попросил полную версию (?full=1 — на неё ведёт ссылка из /lm/more).
 */
export function shouldRedirectStaffToMobile(
  pathname: string,
  options: { role: string | undefined; userAgent: string | null | undefined; wantsFull: boolean },
): string | null {
  if (options.wantsFull) return null
  if (!options.role) return null
  if (pathname.startsWith("/api/")) return null
  if (pathname.startsWith("/lm")) return null
  if (pathname.startsWith("/print")) return null
  if (!isMobileDevice(options.userAgent)) return null

  if (pathname === "/maintenance") return "/lm/fleet"

  return mobileLogistTarget(pathname, options.role)
}
