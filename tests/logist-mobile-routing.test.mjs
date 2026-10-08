/**
 * Тесты правил перехода между контурами сотрудника (lib/logist-mobile/routing.ts).
 *
 * Главное, что здесь защищается:
 *  - сотрудник с телефона не теряет мобильную панель (/orders → /lm/orders);
 *  - правило действует для всех штабных ролей, включая администратора;
 *  - на компьютере сотрудник видит полную версию — его никуда не уводит;
 *  - разделы без мобильного аналога остаются в полной версии;
 *  - ?full=1 — осознанный выход в полную версию, уважается;
 *  - ?next= не превращается в открытый редирект.
 *
 * Запуск: npm run test:unit
 */
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
  safeInternalPath,
  staffHome,
  isMobileDevice,
  mobileLogistTarget,
  mobileParentPath,
  shouldRedirectStaffToMobile,
} = require("../.test-build/lib/logist-mobile/routing.js")

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36"
const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

test("внутренний путь из ?next= пропускается, внешний — нет", () => {
  assert.equal(safeInternalPath("/lm/orders"), "/lm/orders")
  assert.equal(safeInternalPath("/dashboard?full=1"), "/dashboard?full=1")
  assert.equal(safeInternalPath("//evil.example"), null)
  assert.equal(safeInternalPath("https://evil.example"), null)
  assert.equal(safeInternalPath("/\\evil"), null)
  assert.equal(safeInternalPath(""), null)
  assert.equal(safeInternalPath(null), null)
})

test("вошедшего сотрудника без ?next= ведём по устройству, а не по роли", () => {
  // с телефона — мобильная панель, независимо от роли
  assert.equal(staffHome("logist", null, IPHONE), "/lm")
  assert.equal(staffHome("admin", null, IPHONE), "/lm")
  assert.equal(staffHome("admin", null, ANDROID), "/lm")
  // с компьютера — полная версия, тоже независимо от роли
  assert.equal(staffHome("logist", null, DESKTOP), "/dashboard")
  assert.equal(staffHome("admin", null, DESKTOP), "/dashboard")
  assert.equal(staffHome(undefined, null, DESKTOP), "/dashboard")
  // явный ?next= важнее устройства
  assert.equal(staffHome("logist", "/lm/orders/demo-order-7", IPHONE), "/lm/orders/demo-order-7")
  // а небезопасный ?next= игнорируем
  assert.equal(staffHome("logist", "//evil.example", IPHONE), "/lm")
})

test("телефон и планшет отличаются от компьютера", () => {
  assert.equal(isMobileDevice(IPHONE), true)
  assert.equal(isMobileDevice(ANDROID), true)
  assert.equal(isMobileDevice(DESKTOP), false)
  assert.equal(isMobileDevice(MAC), false)
  assert.equal(isMobileDevice(""), false)
  assert.equal(isMobileDevice(null), false)
})

test("мобильный аналог раздела находится, подпуть сохраняется", () => {
  assert.equal(mobileLogistTarget("/dashboard"), "/lm")
  assert.equal(mobileLogistTarget("/orders"), "/lm/orders")
  assert.equal(mobileLogistTarget("/orders/demo-order-7"), "/lm/orders/demo-order-7")
  assert.equal(mobileLogistTarget("/routes"), "/lm/routes")
  assert.equal(mobileLogistTarget("/routes/demo-route-4"), "/lm/routes/demo-route-4")
  assert.equal(mobileLogistTarget("/drivers"), "/lm/drivers")
  assert.equal(mobileLogistTarget("/clients"), "/lm/clients")
  assert.equal(mobileLogistTarget("/clients/demo-client-1"), "/lm/clients/demo-client-1")
  assert.equal(mobileLogistTarget("/payments"), "/lm/payments")
  assert.equal(mobileLogistTarget("/fleet"), "/lm/fleet")
  assert.equal(mobileLogistTarget("/chat"), "/lm/chat")
  assert.equal(mobileLogistTarget("/reports"), "/lm/reports")
  assert.equal(mobileLogistTarget("/search"), "/lm/search")
  assert.equal(mobileLogistTarget("/fuel"), "/lm/fuel")
  assert.equal(mobileLogistTarget("/photos"), "/lm/photos")
  // «/orders-history» не должен считаться разделом /orders
  assert.equal(mobileLogistTarget("/orders-history"), null)
})

test("сотрудники, организация, настройки и журнал есть в мобильной панели у обеих ролей", () => {
  for (const role of ["admin", "logist", undefined]) {
    assert.equal(mobileLogistTarget("/users", role), "/lm/users")
    assert.equal(mobileLogistTarget("/organization", role), "/lm/organization")
    assert.equal(mobileLogistTarget("/settings", role), "/lm/settings")
    // админ и логист — один профиль: журнал доступен обоим
    assert.equal(mobileLogistTarget("/audit", role), "/lm/audit")
  }
})

test("логист с телефона уходит из десктопных разделов в /lm", () => {
  const ua = IPHONE
  assert.equal(
    shouldRedirectStaffToMobile("/orders", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm/orders",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/dashboard", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/routes/demo-route-4", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm/routes/demo-route-4",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/clients", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm/clients",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/payments", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm/payments",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/maintenance", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm/fleet",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/search", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm/search",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/fuel", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm/fuel",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/photos", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm/photos",
  )
  // «Сотрудники» теперь тоже с мобильным экраном
  assert.equal(
    shouldRedirectStaffToMobile("/users", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm/users",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/audit", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm/audit",
  )
  // а разделы, доступные логисту, он получает и в мобильном виде
  assert.equal(
    shouldRedirectStaffToMobile("/users", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm/users",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/organization", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm/organization",
  )
  // журнал действий — тоже мобильный: админ и логист один профиль
  assert.equal(
    shouldRedirectStaffToMobile("/audit", { role: "logist", userAgent: ua, wantsFull: false }),
    "/lm/audit",
  )
})

test("админ с телефона попадает в мобильные экраны админских разделов", () => {
  const ua = ANDROID
  assert.equal(
    shouldRedirectStaffToMobile("/users", { role: "admin", userAgent: ua, wantsFull: false }),
    "/lm/users",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/organization", { role: "admin", userAgent: ua, wantsFull: false }),
    "/lm/organization",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/audit", { role: "admin", userAgent: ua, wantsFull: false }),
    "/lm/audit",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/settings", { role: "admin", userAgent: ua, wantsFull: false }),
    "/lm/settings",
  )
  // на компьютере админ остаётся в полной версии
  assert.equal(
    shouldRedirectStaffToMobile("/users", { role: "admin", userAgent: DESKTOP, wantsFull: false }),
    null,
  )
  // и ?full=1 уважается
  assert.equal(
    shouldRedirectStaffToMobile("/users", { role: "admin", userAgent: ua, wantsFull: true }),
    null,
  )
})

test("логист с телефона не уходит из /lm и из печати", () => {
  const options = { role: "logist", userAgent: ANDROID, wantsFull: false }
  assert.equal(shouldRedirectStaffToMobile("/lm", options), null)
  assert.equal(shouldRedirectStaffToMobile("/lm/orders", options), null)
  assert.equal(shouldRedirectStaffToMobile("/print/route/demo-route-4", options), null)
  // API не трогаем: fetch из мобильной панели должен работать
  assert.equal(shouldRedirectStaffToMobile("/api/orders", options), null)
})

test("администратора тоже уводим в мобильную панель — с телефона полная версия непригодна", () => {
  assert.equal(
    shouldRedirectStaffToMobile("/orders", { role: "admin", userAgent: IPHONE, wantsFull: false }),
    "/lm/orders",
  )
  assert.equal(
    shouldRedirectStaffToMobile("/dashboard", { role: "admin", userAgent: ANDROID, wantsFull: false }),
    "/lm",
  )
  // а на компьютере администратор работает в полной версии
  assert.equal(
    shouldRedirectStaffToMobile("/orders", { role: "admin", userAgent: DESKTOP, wantsFull: false }),
    null,
  )
  assert.equal(
    shouldRedirectStaffToMobile("/orders", { role: "logist", userAgent: DESKTOP, wantsFull: false }),
    null,
  )
  // ?full=1 — осознанный переход в полную версию даже с телефона
  assert.equal(
    shouldRedirectStaffToMobile("/dashboard", { role: "logist", userAgent: IPHONE, wantsFull: true }),
    null,
  )
})

test("стрелка «назад» ведёт по дереву разделов, а не по истории браузера", () => {
  // Подстраница → список своего раздела
  assert.equal(mobileParentPath("/lm/orders/demo-order-7"), "/lm/orders")
  assert.equal(mobileParentPath("/lm/orders/new"), "/lm/orders")
  assert.equal(mobileParentPath("/lm/routes/demo-route-4"), "/lm/routes")
  assert.equal(mobileParentPath("/lm/chat/demo-driver-1"), "/lm/chat")
  assert.equal(mobileParentPath("/lm/clients/demo-client-2"), "/lm/clients")

  // Разделы нижнего меню → «Главная»
  assert.equal(mobileParentPath("/lm/orders"), "/lm")
  assert.equal(mobileParentPath("/lm/routes"), "/lm")
  assert.equal(mobileParentPath("/lm/map"), "/lm")
  assert.equal(mobileParentPath("/lm/more"), "/lm")

  // Разделы из «Ещё» → «Ещё»
  assert.equal(mobileParentPath("/lm/drivers"), "/lm/more")
  assert.equal(mobileParentPath("/lm/users"), "/lm/more")
  assert.equal(mobileParentPath("/lm/photos"), "/lm/more")

  // Уведомления открываются колокольчиком с любого экрана → «Главная»
  assert.equal(mobileParentPath("/lm/notifications"), "/lm")

  // Разделы внутри другого раздела
  assert.equal(mobileParentPath("/lm/fuel"), "/lm/fleet")
  assert.equal(mobileParentPath("/lm/settings"), "/lm/fleet")
  assert.equal(mobileParentPath("/lm/audit"), "/lm/organization")

  // Откуда бы ни пришли (строка запроса, лишний слэш) — одно и то же место
  assert.equal(mobileParentPath("/lm/orders/42"), "/lm/orders")
  assert.equal(mobileParentPath("/lm/orders/demo-order-7?src=chat"), "/lm/orders")
  assert.equal(mobileParentPath("/lm/drivers/"), "/lm/more")

  // Неизвестный путь не ломает навигацию: уводим на «Главную»
  assert.equal(mobileParentPath(""), "/lm")
  assert.equal(mobileParentPath("/"), "/lm")
  assert.equal(mobileParentPath("/dashboard"), "/lm")
})
