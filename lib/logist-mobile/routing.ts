/**
 * Правила перехода между контурами сотрудника.
 *
 * Администратор и логист — один профиль: правила ниже смотрят только на
 * устройство, не на роль. С телефона сотрудник работает в мобильной панели /lm
 * (десктопные разделы уводят в /lm-аналог), с компьютера — в полной версии.
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
  // «Сотрудники», «Организация», «Настройки» и «Журнал» — тоже мобильные:
  // у админа и логиста один профиль (решение владельца), значит и набор
  // разделов одинаковый, и права на действия проверяет API, а не меню.
  ["/audit", "/lm/audit"],
  ["/users", "/lm/users"],
  ["/organization", "/lm/organization"],
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
export function staffHome(
  role: string | undefined,
  nextParam: string | null,
  userAgent?: string | null,
): string {
  void role
  const explicit = safeInternalPath(nextParam)
  if (explicit) return explicit
  // Роль не влияет: с телефона — мобильная панель, с компьютера — полная версия
  return isMobileDevice(userAgent) ? "/lm" : "/dashboard"
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
export function mobileLogistTarget(pathname: string): string | null {
  if (pathname === "/dashboard") return "/lm"

  for (const [from, to] of SECTION_MAP) {
    if (pathname === from) return to
    if (pathname.startsWith(`${from}/`)) return `${to}${pathname.slice(from.length)}`
  }

  return null
}

/** Разделы нижнего меню: это первый уровень, стрелки «назад» у них нет. */
const TAB_SECTIONS = new Set(["/lm/orders", "/lm/routes", "/lm/map", "/lm/more"])

/**
 * Экраны, которые открываются не из «Ещё», а изнутри другого раздела:
 * «Топливо» и «Настройки» — со страницы «Автопарк», «Журнал действий» —
 * со страницы «Организация».
 */
const SECTION_PARENTS: Record<string, string> = {
  "/lm/fuel": "/lm/fleet",
  "/lm/settings": "/lm/fleet",
  "/lm/audit": "/lm/organization",
  // Уведомления открываются колокольчиком с любого экрана: возврат — «Главная»,
  // а не «Ещё», иначе после колокольчика мы бы каждый раз попадали в профиль.
  "/lm/notifications": "/lm",
}

/**
 * Куда ведёт стрелка «назад» — для одного экрана всегда одно и то же место.
 *
 * Раньше кнопка вызывала router.back(). В установленном на телефон приложении
 * истории может не быть вовсе (запуск с домашнего экрана, переход по ссылке из
 * уведомления) — тогда стрелка уводила из приложения или в случайное место.
 * Теперь у каждого экрана ровно один родитель, и он не зависит от истории:
 *
 *   подстраница раздела (/lm/orders/42)  → список раздела (/lm/orders)
 *   раздел из нижнего меню (/lm/orders)  → «Главная» (/lm)
 *   раздел изнутри другого (/lm/fuel)    → «Автопарк» (/lm/fleet)
 *   остальной раздел (/lm/drivers)       → «Ещё» (/lm/more)
 *
 * Единственное исключение — уведомления: их открывают колокольчиком с любого
 * экрана, поэтому возврат с них всегда на «Главную».
 */
export function mobileParentPath(pathname: string): string {
  const clean = (pathname ?? "").split("?")[0].split("#")[0].replace(/\/+$/, "")
  const segments = clean.split("/").filter(Boolean)

  if (segments[0] !== "lm" || segments.length <= 1) return "/lm"

  const section = `/lm/${segments[1]}`

  // Подстраница раздела: из карточки заказа — в список заказов, и так везде
  if (segments.length > 2) return section

  const nested = SECTION_PARENTS[section]
  if (nested) return nested

  return TAB_SECTIONS.has(section) ? "/lm" : "/lm/more"
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

  return mobileLogistTarget(pathname)
}
