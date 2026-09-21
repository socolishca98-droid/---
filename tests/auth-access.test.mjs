/**
 * Тесты правил доступа middleware: какой путь кому разрешён.
 * Это единственный слой, который работает в edge без БД, — поэтому его
 * поведение должно быть предсказуемым и проверенным.
 * Запуск: npm test
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { classifyRoute, normalizePathname, acceptsStaff, acceptsDriver } = require(
  "../.test-build/lib/auth/access.js"
)

function area(pathname) {
  return classifyRoute(pathname).area
}

test("публичные пути доступны без сессии", () => {
  for (const pathname of ["/", "/login", "/register", "/m/login"]) {
    assert.equal(area(pathname), "public", `${pathname} должен быть публичным`)
  }
})

test("публичные эндпоинты авторизации", () => {
  for (const pathname of [
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/logout",
    "/api/auth/session",
    "/api/health",
  ]) {
    const access = classifyRoute(pathname)
    assert.equal(access.area, "public", `${pathname} должен быть публичным`)
    assert.equal(access.isApi, true)
  }
})

test("cron ATI защищается отдельным секретом, а не сессией", () => {
  assert.equal(area("/api/ati/cron"), "secret")
})

test("страницы сотрудника — только для admin/logist", () => {
  for (const pathname of [
    "/dashboard",
    "/orders",
    "/routes",
    "/fleet",
    "/drivers",
    "/photos",
    "/payments",
    "/reports",
    "/chat",
    "/users",
    "/debug",
  ]) {
    const access = classifyRoute(pathname)
    assert.equal(access.area, "staff", `${pathname} — страница сотрудника`)
    assert.equal(access.isApi, false)
    assert.equal(access.loginPath, "/login")
  }
})

test("API логиста — только для admin/logist", () => {
  for (const pathname of [
    "/api/fleet",
    "/api/fleet/assign",
    "/api/ati/scan",
    "/api/ati/cache",
    "/api/vehicles",
    "/api/vehicles/abc123",
    "/api/drivers",
    "/api/routes",
    "/api/routes/abc123",
    "/api/routes/abc123/add-load",
    "/api/routes/calculate-eta",
    "/api/traffic/batch",
    "/api/dashboard/routes",
    "/api/photos",
    "/api/auth/users",
    "/api/auth/users/abc123",
  ]) {
    assert.equal(area(pathname), "staff", `${pathname} — штабной API`)
  }
})

test("мобильный контур — только для водителя", () => {
  for (const pathname of [
    "/m",
    "/m/orders",
    "/m/orders/abc123",
    "/m/photo",
    "/m/profile",
    "/m/chat",
    "/m/maintenance",
    "/m/notifications",
    "/m/vehicle",
    "/m/history",
    "/api/m/me",
    "/api/m/location",
    "/api/m/orders",
    "/api/m/shift",
    "/api/m/sos",
    "/api/m/photos",
    "/api/m/route/accept-load",
    "/m/route/events",
  ]) {
    const access = classifyRoute(pathname)
    assert.equal(access.area, "driver", `${pathname} — контур водителя`)
    assert.equal(access.loginPath, "/m/login")
  }
})

test("смешанные эндпоинты доступны обеим ролям, но только через guard обработчика", () => {
  for (const pathname of [
    "/api/chat",
    "/api/orders",
    "/api/orders/abc123",
    "/api/drivers/abc123",
    "/api/drivers/abc123/active-order",
    "/api/routes/abc123/complete",
    "/api/routes/abc123/events",
    "/api/m/maintenance",
  ]) {
    assert.equal(area(pathname), "any", `${pathname} — любая роль + проверка принадлежности`)
  }
})

test("журнал ТО доступен обеим ролям, остальные /api/m/* — только водителю", () => {
  assert.equal(area("/api/m/maintenance"), "any")
  assert.equal(area("/api/m/me"), "driver")
  assert.equal(area("/api/m/photos"), "driver")
})

test("служебные подпути не прячутся за шаблоном :id", () => {
  assert.equal(area("/api/drivers/locations"), "staff")
  assert.equal(area("/api/drivers/stats"), "staff")
})

test("статика и служебные пути Next.js не блокируются", () => {
  for (const pathname of [
    "/logo.png",
    "/images/truck.jpg",
    "/favicon.ico",
    "/manifest.webmanifest",
    "/fonts/inter.woff2",
    "/_next/static/chunks/main.js",
    "/_next/image?url=%2Flogo.png",
  ]) {
    assert.equal(area(pathname), "public", `${pathname} — статика`)
  }
})

test("нормализация пути: хвостовой слэш не меняет решение", () => {
  assert.equal(normalizePathname("/dashboard/"), "/dashboard")
  assert.equal(normalizePathname("/"), "/")
  assert.equal(normalizePathname(""), "/")
  assert.equal(area("/dashboard/"), "staff")
  assert.equal(area("/m/"), "driver")
  assert.equal(area("/login/"), "public")
})

test("неизвестный путь закрывается по умолчанию (fail closed)", () => {
  assert.equal(area("/какая-то-новая-страница"), "staff")
  assert.equal(area("/api/что-то-новое"), "staff")
  assert.equal(area("/api/m/новый-эндпоинт"), "driver")
})

test("acceptsStaff / acceptsDriver согласованы с областями", () => {
  assert.equal(acceptsStaff("staff"), true)
  assert.equal(acceptsStaff("any"), true)
  assert.equal(acceptsStaff("driver"), false)
  assert.equal(acceptsStaff("public"), false)

  assert.equal(acceptsDriver("driver"), true)
  assert.equal(acceptsDriver("any"), true)
  assert.equal(acceptsDriver("staff"), false)
  assert.equal(acceptsDriver("public"), false)
})

test("экраны авторизации и управления доступом (Задача 1)", () => {
  // вход и регистрация открыты
  assert.equal(area("/login"), "public")
  assert.equal(area("/register"), "public")
  assert.equal(area("/m/login"), "public")

  // публичные служебные эндпоинты авторизации
  assert.equal(area("/api/auth/login"), "public")
  assert.equal(area("/api/auth/logout"), "public")
  assert.equal(area("/api/auth/session"), "public")
  assert.equal(area("/api/auth/register"), "public")
  assert.equal(area("/api/health"), "public")

  // смена пароля доступна и сотруднику, и водителю
  assert.equal(area("/api/auth/change-password"), "any")

  // управление сотрудниками — только штаб
  assert.equal(area("/users"), "staff")
  assert.equal(area("/api/auth/users"), "staff")
  assert.equal(area("/api/auth/users/cuid123"), "staff")

  // SOS: водитель создаёт, диспетчер разбирает
  assert.equal(area("/api/m/sos"), "driver")
  assert.equal(area("/api/sos"), "staff")
})
