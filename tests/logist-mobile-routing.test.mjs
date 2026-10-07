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

test("вошедшего сотрудника без ?next= ведём по роли", () => {
  assert.equal(staffHome("logist", null), "/lm")
  assert.equal(staffHome("admin", null), "/dashboard")
  assert.equal(staffHome(undefined, null), "/dashboard")
  // явный ?next= важнее роли
  assert.equal(staffHome("logist", "/lm/orders/demo-order-7"), "/lm/orders/demo-order-7")
  // а небезопасный ?next= игнорируем
  assert.equal(staffHome("logist", "//evil.example"), "/lm")
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

test("разделы администратора переходят в свои мобильные экраны только у админа", () => {
  // у админа есть мобильные аналоги админских разделов
  assert.equal(mobileLogistTarget("/users", "admin"), "/lm/users")
  assert.equal(mobileLogistTarget("/organization", "admin"), "/lm/organization")
  assert.equal(mobileLogistTarget("/audit", "admin"), "/lm/audit")
  assert.equal(mobileLogistTarget("/settings", "admin"), "/lm/settings")
  // логиста туда не уводим: API этих разделов ему всё равно откажет,
  // а экран «только для администратора» вместо панели — плохой опыт
  assert.equal(mobileLogistTarget("/users", "logist"), null)
  assert.equal(mobileLogistTarget("/organization", "logist"), null)
  assert.equal(mobileLogistTarget("/audit", "logist"), null)
  assert.equal(mobileLogistTarget("/settings", "logist"), null)
  // без роли (не должно случаться в бою) ведём себя как логист
  assert.equal(mobileLogistTarget("/users"), null)
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
  // у раздела нет мобильного аналога — оставляем полную версию (она адаптивна)
  assert.equal(
    shouldRedirectStaffToMobile("/users", { role: "logist", userAgent: ua, wantsFull: false }),
    null,
  )
  // админские разделы логисту с телефона тоже не отдаём в мобильный контур
  assert.equal(
    shouldRedirectStaffToMobile("/organization", { role: "logist", userAgent: ua, wantsFull: false }),
    null,
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

