#!/usr/bin/env node
/**
 * Автоматическая проверка безопасности (Задача 1).
 *
 * Скрипт поднимает НЕ сервер — он стучится в уже запущенный `npm run dev`
 * и проверяет то, что в задаче 1 заявлено: доступ без входа закрыт, пароли
 * проверяются сервером, сессии отзываются, водитель не видит чужих данных,
 * а driverId из запроса игнорируется.
 *
 * Запуск (в двух терминалах):
 *   npm run dev
 *   npm run verify:security
 *
 * С флагом --driver дополнительно проверяется водительский контур.
 * Без явных --driver-phone/--driver-password скрипт сам сбросит пароль
 * одному из водителей (через штатный API логиста) и напечатает новый —
 * это меняет данные, поэтому без флага --driver блок не запускается.
 *
 * Выходной код: 0 — все проверки прошли, 1 — есть провалы.
 */

import { readFileSync, existsSync } from "node:fs"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Локальный dev-сервер работает на самоподписанном сертификате
// (npm run dev = next dev --experimental-https)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..")

// ══════════════════════════════════════════════════════════════════════════
// Аргументы и .env
// ══════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const args = {}
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue
    const [key, ...rest] = raw.slice(2).split("=")
    args[key] = rest.length ? rest.join("=") : true
  }
  return args
}

function readDotEnv(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(`
Проверка безопасности Loginex

  npm run verify:security                          базовые проверки (сотрудник)
  npm run verify:security -- --driver              + водительский контур
  npm run verify:security -- --url=https://localhost:3000
  npm run verify:security -- --email=admin@x.ru --password=...
  npm run verify:security -- --driver-phone=+79991234567 --driver-password=...
  npm run verify:security -- --keep-user           не закрывать тестовую учётку в конце

Учётка администратора и адрес берутся из .env (ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL),
если не переданы аргументами.
`)
  process.exit(0)
}

const dotenv = { ...readDotEnv(path.join(ROOT, ".env")), ...readDotEnv(path.join(ROOT, ".env.local")) }

const BASE = String(
  args.url || process.env.BASE_URL || dotenv.BASE_URL || "https://localhost:3000",
).replace(/\/$/, "")

const ADMIN_EMAIL = String(args.email || process.env.ADMIN_EMAIL || dotenv.ADMIN_EMAIL || "")
const ADMIN_PASSWORD = String(
  args.password || process.env.ADMIN_PASSWORD || dotenv.ADMIN_PASSWORD || "",
)

const WANT_DRIVER = Boolean(args.driver || args["driver-phone"])
const DRIVER_PHONE = String(args["driver-phone"] || process.env.DRIVER_PHONE || "")
const DRIVER_PASSWORD = String(args["driver-password"] || process.env.DRIVER_PASSWORD || "")
const KEEP_USER = Boolean(args["keep-user"])

function tempPassword() {
  // буквы + цифры, длина >= 8 — как требует validatePasswordStrength
  return `Vf${randomBytes(5).toString("hex")}A1`
}

// ══════════════════════════════════════════════════════════════════════════
// Мини-клиент: cookie-банка и запросы
// ══════════════════════════════════════════════════════════════════════════

class Jar {
  constructor(label) {
    this.label = label
    this.cookies = new Map()
    this.lastSetCookie = []
  }

  absorb(res) {
    const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : []
    this.lastSetCookie = raw
    for (const cookie of raw) {
      const [pair, ...attrs] = cookie.split(";")
      const eq = pair.indexOf("=")
      if (eq < 0) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      const expired =
        value === "" ||
        attrs.some((a) => /^\s*Max-Age=0\s*$/i.test(a)) ||
        attrs.some((a) => /^\s*Expires=Thu, 01 Jan 1970/i.test(a))
      if (expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
  }

  has(name) {
    return this.cookies.has(name)
  }

  attrsOf(name) {
    const cookie = this.lastSetCookie.find((c) => c.trim().startsWith(`${name}=`))
    return cookie ? cookie.toLowerCase() : ""
  }
}

const CSRF_COOKIE = "loginex_csrf"
const CSRF_HEADER = "x-csrf-token"

/** Proxy требует CSRF-токен для изменяющих запросов к /api/* (кроме мобильного контура). */
function needsCsrf(route, method) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) return false
  if (!route.startsWith("/api/")) return false
  if (route.startsWith("/api/m/")) return false
  if (route === "/api/auth/csrf") return false
  return true
}

async function ensureCsrf(jar) {
  if (jar.has(CSRF_COOKIE)) return
  const res = await fetch(`${BASE}/api/auth/csrf`, {
    headers: jar.header() ? { Cookie: jar.header() } : {},
  })
  jar.absorb(res)
}

async function req(route, { method = "GET", jar = null, body = null, redirect = "manual" } = {}) {
  const headers = { Accept: "application/json, text/plain, */*" }
  if (body !== null) headers["Content-Type"] = "application/json"

  // CSRF: токен берём из той же cookie-банки, что и отправляем (double-submit)
  if (needsCsrf(route, method)) {
    jar = jar || new Jar("csrf")
    await ensureCsrf(jar)
    headers[CSRF_HEADER] = jar.cookies.get(CSRF_COOKIE) || ""
  }

  if (jar && jar.header()) headers.Cookie = jar.header()

  let res
  try {
    res = await fetch(BASE + route, {
      method,
      headers,
      redirect,
      body: body === null ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    throw new Error(
      `сервер не отвечает на ${BASE}${route}: ${error.message}. Запустите npm run dev`,
    )
  }

  if (jar) jar.absorb(res)

  let data = null
  const text = await res.text()
  try {
    data = JSON.parse(text)
  } catch {
    data = { __html: text.slice(0, 200) }
  }

  return { status: res.status, data, location: res.headers.get("location"), headers: res.headers }
}

// ══════════════════════════════════════════════════════════════════════════
// Каркас проверок
// ══════════════════════════════════════════════════════════════════════════

const results = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function check(name, fn) {
  try {
    const note = await fn()
    results.push({ name, ok: true, note: note || "" })
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ""}`)
  } catch (error) {
    results.push({ name, ok: false, note: error.message })
    console.log(`  ✗ ${name}\n      → ${error.message}`)
  }
}

function skip(name, reason) {
  results.push({ name, ok: null, note: reason })
  console.log(`  · ${name} — пропущено: ${reason}`)
}

function group(title) {
  console.log(`\n${title}`)
}

// ══════════════════════════════════════════════════════════════════════════
// Прогон
// ══════════════════════════════════════════════════════════════════════════

console.log(`\nLoginex · проверка безопасности`)
console.log(`Адрес:  ${BASE}`)
console.log(`Админ:  ${ADMIN_EMAIL || "(не задан — нужен --email или ADMIN_EMAIL в .env)"}`)
console.log(`Водитель: ${WANT_DRIVER ? "проверяем" : "не проверяем (добавьте --driver)"}`)

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error(
    "\nНет учётных данных администратора. Задайте ADMIN_EMAIL и ADMIN_PASSWORD в .env\n" +
      "(их использует npm run seed:auth) или передайте --email/--password.\n",
  )
  process.exit(1)
}

const admin = new Jar("admin")
const testEmail = `verify-${Date.now().toString(36)}@loginex.local`
const testPassword = tempPassword()
const newPassword = tempPassword()
let testUserId = null

// ── 1. Сервер жив, публичные пути открыты ────────────────────────────────
group("1. Сервер и публичные пути")

await check("GET /api/health отвечает без авторизации", async () => {
  const res = await req("/api/health")
  assert(res.status === 200, `ожидали 200, получили ${res.status}`)
  assert(res.data?.success === true, "в ответе нет success:true")
  return `product=${res.data.product}`
})

await check("GET /login не редиректит (экран входа открыт)", async () => {
  const res = await req("/login")
  assert(res.status < 400, `страница входа недоступна: ${res.status}`)
  return `HTTP ${res.status}`
})

// ── 2. Без входа доступ закрыт ───────────────────────────────────────────
group("2. Доступ без авторизации закрыт")

for (const route of ["/api/orders", "/api/m/shift", "/api/auth/users", "/api/sos", "/api/fleet"]) {
  await check(`${route} без cookie → 401 JSON`, async () => {
    const res = await req(route)
    assert(res.status === 401, `ожидали 401, получили ${res.status}`)
    assert(res.data?.success === false, "ожидали JSON с success:false")
    return res.data.error
  })
}

for (const [route, expectedLogin] of [
  ["/dashboard", "/login"],
  ["/users", "/login"],
  ["/orders", "/login"],
  ["/m", "/m/login"],
  ["/m/orders", "/m/login"],
]) {
  await check(`страница ${route} без входа → редирект на ${expectedLogin}`, async () => {
    const res = await req(route)
    assert(
      res.status >= 300 && res.status < 400,
      `ожидали редирект (3xx), получили ${res.status}`,
    )
    assert(
      (res.location || "").startsWith(expectedLogin),
      `редирект идёт на ${res.location}, ожидали ${expectedLogin}`,
    )
    assert(
      (res.location || "").includes("next="),
      "в редиректе нет ?next= — после входа человек не вернётся на свою страницу",
    )
    return res.location
  })
}

await check("поддельный токен в cookie не принимается", async () => {
  const res = await fetch(`${BASE}/api/orders`, {
    headers: { Cookie: "loginex_staff_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.fake" },
    redirect: "manual",
  })
  assert(res.status === 401, `ожидали 401, получили ${res.status}`)
  return "HTTP 401"
})

await check("изменяющий запрос без CSRF-токена отклоняется (403)", async () => {
  const jar = new Jar("no-csrf")
  await ensureCsrf(jar)
  assert(jar.has(CSRF_COOKIE), "сервер не выдал CSRF-cookie на GET /api/auth/csrf")
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    redirect: "manual",
    body: JSON.stringify({ email: "csrf@example.com", password: "Whatever123" }),
  })
  assert(res.status === 403, `ожидали 403, получили ${res.status}`)
  const data = await res.json().catch(() => ({}))
  assert(data.code === "csrf_failed", `ожидали code=csrf_failed, получили ${JSON.stringify(data)}`)
  return "HTTP 403 csrf_failed"
})

await check("driverId в query без сессии ничего не открывает", async () => {
  const res = await req("/api/m/orders?driverId=cbc123anyid")
  assert(res.status === 401, `ожидали 401, получили ${res.status}`)
  return "HTTP 401"
})

// ── 3. Вход сотрудника ───────────────────────────────────────────────────
group("3. Вход сотрудника: пароль проверяет сервер")

await check("неверный пароль → отказ, cookie не выдаётся", async () => {
  const jar = new Jar("wrong")
  const res = await req("/api/auth/login", {
    method: "POST",
    jar,
    body: { email: ADMIN_EMAIL, password: `${ADMIN_PASSWORD}-never` },
  })
  assert(res.status === 401 || res.status === 423, `ожидали 401/423, получили ${res.status}`)
  assert(res.data?.success === false, "ожидали success:false")
  assert(!jar.has("loginex_staff_session"), "сервер всё-таки выдал сессионный cookie")
  return res.data.error
})

await check("верный пароль → сессия в httpOnly-cookie", async () => {
  const res = await req("/api/auth/login", {
    method: "POST",
    jar: admin,
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  assert(res.status === 200, `ожидали 200, получили ${res.status}: ${JSON.stringify(res.data)}`)
  assert(res.data?.success === true, "нет success:true")
  assert(["admin", "logist"].includes(res.data?.user?.role), `странная роль: ${res.data?.user?.role}`)
  assert(admin.has("loginex_staff_session"), "нет cookie loginex_staff_session")
  const attrs = admin.attrsOf("loginex_staff_session")
  assert(attrs.includes("httponly"), "cookie без HttpOnly — доступен скриптам из браузера")
  assert(attrs.includes("samesite"), "cookie без SameSite")
  assert(!res.data.user.passwordHash && !res.data.user.passwordSalt, "в ответе виден хэш пароля!")
  return `${res.data.user.name} · ${res.data.user.role} · ${attrs.split(";").slice(1).join(";").trim()}`
})

await check("с сессией штабной API открывается", async () => {
  const res = await req("/api/orders", { jar: admin })
  assert(res.status === 200, `ожидали 200, получили ${res.status}`)
  assert(res.data?.success === true, "нет success:true")
  return "HTTP 200"
})

await check("GET /api/auth/session возвращает того же пользователя", async () => {
  const res = await req("/api/auth/session", { jar: admin })
  assert(res.status === 200, `ожидали 200, получили ${res.status}`)
  assert(res.data?.session?.user?.id, "в сессии нет user.id")
  return res.data.session.user.name
})

await check("список пользователей с реальной пагинацией", async () => {
  const res = await req("/api/auth/users?page=1&pageSize=5", { jar: admin })
  assert(res.status === 200, `ожидали 200, получили ${res.status}`)
  assert(Array.isArray(res.data?.users), "нет массива users")
  assert(res.data.users.length <= 5, `pageSize не соблюдён: пришло ${res.data.users.length}`)
  assert(typeof res.data?.pagination?.total === "number", "нет pagination.total")
  assert(typeof res.data?.pendingCount === "number", "нет pendingCount")
  const leaked = res.data.users.find((u) => u.passwordHash || u.passwordSalt)
  assert(!leaked, "в списке пользователей отдаётся хэш пароля!")
  return `всего ${res.data.pagination.total}, ожидают одобрения ${res.data.pendingCount}`
})

await check("водительский API сотруднику недоступен (и наоборот наоборот)", async () => {
  // /api/m/orders — только для водителя; у сотрудника своей карточки Driver нет
  const res = await req("/api/m/orders", { jar: admin })
  assert(res.status === 403 || res.status === 401, `ожидали 401/403, получили ${res.status}`)
  return `HTTP ${res.status}`
})

// ── 4. Регистрация → одобрение → закрытие доступа → восстановление ───────
group("4. Заявка на доступ и управление им (/users)")

await check("саморегистрация создаёт заявку в статусе pending", async () => {
  const res = await req("/api/auth/register", {
    method: "POST",
    body: { name: "Проверочный Сотрудник", email: testEmail, password: testPassword },
  })
  assert(res.status === 200 || res.status === 201, `ожидали 200/201, получили ${res.status}`)
  assert(res.data?.success === true, JSON.stringify(res.data))
  if (res.data.bootstrapped) {
    return "внимание: в базе не было пользователей — сработал аварийный авто-админ"
  }
  assert(res.data.status === "pending", `ожидали status=pending, получили ${res.data.status}`)
  return `${testEmail} · ${res.data.status}`
})

await check("неодобренная заявка войти не может", async () => {
  const res = await req("/api/auth/login", {
    method: "POST",
    jar: new Jar("pending"),
    body: { email: testEmail, password: testPassword },
  })
  assert(res.status >= 400 && res.status < 500, `ожидали 4xx, получили ${res.status}`)
  return res.data?.error
})

await check("логист находит заявку в списке и одобряет её", async () => {
  const list = await req(`/api/auth/users?status=pending&pageSize=100`, { jar: admin })
  assert(list.status === 200, `список заявок: ${list.status}`)
  const found = (list.data?.users || []).find((u) => u.email === testEmail)
  assert(found, "заявка не найдена в /api/auth/users?status=pending")
  testUserId = found.id

  const res = await req(`/api/auth/users/${testUserId}`, {
    method: "PATCH",
    jar: admin,
    body: { action: "approve" },
  })
  assert(res.status === 200, `одобрение: ${res.status} ${JSON.stringify(res.data)}`)
  assert(res.data?.success === true, JSON.stringify(res.data))
  return res.data.message
})

const approved = new Jar("approved")

await check("после одобрения вход разрешён", async () => {
  const res = await req("/api/auth/login", {
    method: "POST",
    jar: approved,
    body: { email: testEmail, password: testPassword },
  })
  assert(res.status === 200, `ожидали 200, получили ${res.status}: ${JSON.stringify(res.data)}`)
  assert(approved.has("loginex_staff_session"), "нет сессионного cookie")
  return res.data.user?.name
})

await check("закрытие доступа немедленно рвёт активную сессию", async () => {
  const before = await req("/api/orders", { jar: approved })
  assert(before.status === 200, `до закрытия доступа ожидали 200, получили ${before.status}`)

  const res = await req(`/api/auth/users/${testUserId}`, {
    method: "PATCH",
    jar: admin,
    body: { action: "suspend", reason: "Проверка: увольнение" },
  })
  assert(res.status === 200, `закрытие доступа: ${res.status}`)

  const after = await req("/api/orders", { jar: approved })
  assert(after.status === 401, `сессия не отозвана: тот же cookie даёт ${after.status}`)
  return "старый cookie больше не работает"
})

await check("с закрытым доступом войти нельзя", async () => {
  const res = await req("/api/auth/login", {
    method: "POST",
    jar: new Jar("suspended"),
    body: { email: testEmail, password: testPassword },
  })
  assert(res.status >= 400 && res.status < 500, `ожидали 4xx, получили ${res.status}`)
  return res.data?.error
})

await check("доступ восстанавливается (увольнение обратимо)", async () => {
  const res = await req(`/api/auth/users/${testUserId}`, {
    method: "PATCH",
    jar: admin,
    body: { action: "restore" },
  })
  assert(res.status === 200, `восстановление: ${res.status}`)

  const login = await req("/api/auth/login", {
    method: "POST",
    jar: approved,
    body: { email: testEmail, password: testPassword },
  })
  assert(login.status === 200, `после восстановления вход не работает: ${login.status}`)
  return res.data?.message
})

await check("запись в базе остаётся (ничего не удаляется)", async () => {
  const res = await req(`/api/auth/users?status=all&pageSize=100`, { jar: admin })
  const found = (res.data?.users || []).find((u) => u.id === testUserId)
  assert(found, "пользователь исчез из списка")
  assert(!found.passwordHash, "в списке виден хэш пароля")
  return `${found.name} · ${found.status}`
})

// ── 5. Сброс пароля, смена пароля, блокировка сессий ─────────────────────
group("5. Пароли: сброс, обязательная смена, отзыв остальных сессий")

let resetPasswordValue = null

await check("сброс пароля логистом возвращает временный пароль", async () => {
  const res = await req(`/api/auth/users/${testUserId}`, {
    method: "PATCH",
    jar: admin,
    body: { action: "resetPassword" },
  })
  assert(res.status === 200, `сброс пароля: ${res.status}`)
  assert(res.data?.temporaryPassword, "в ответе нет temporaryPassword")
  resetPasswordValue = res.data.temporaryPassword
  return `${resetPasswordValue} (показывается один раз)`
})

await check("старый пароль после сброса не работает", async () => {
  const res = await req("/api/auth/login", {
    method: "POST",
    jar: new Jar("old"),
    body: { email: testEmail, password: testPassword },
  })
  assert(res.status >= 400 && res.status < 500, `ожидали 4xx, получили ${res.status}`)
  return res.data?.error
})

const afterReset = new Jar("afterReset")

await check("вход по временному паролю требует его сменить", async () => {
  const res = await req("/api/auth/login", {
    method: "POST",
    jar: afterReset,
    body: { email: testEmail, password: resetPasswordValue },
  })
  assert(res.status === 200, `ожидали 200, получили ${res.status}: ${JSON.stringify(res.data)}`)
  assert(
    res.data?.user?.mustChangePassword === true,
    "mustChangePassword не выставлен — временный пароль останется навсегда",
  )
  return "mustChangePassword = true"
})

await check("смена пароля гасит остальные сессии", async () => {
  const res = await req("/api/auth/change-password", {
    method: "POST",
    jar: afterReset,
    body: { currentPassword: resetPasswordValue, newPassword },
  })
  assert(res.status === 200, `смена пароля: ${res.status} ${JSON.stringify(res.data)}`)
  assert(res.data?.success === true, JSON.stringify(res.data))

  const old = await req("/api/orders", { jar: approved })
  assert(old.status === 401, `другая сессия того же пользователя жива: ${old.status}`)
  return "сессия из другой вкладки отозвана"
})

await check("временный пароль больше не действует, новый — действует", async () => {
  const bad = await req("/api/auth/login", {
    method: "POST",
    jar: new Jar("tmp"),
    body: { email: testEmail, password: resetPasswordValue },
  })
  assert(bad.status >= 400 && bad.status < 500, `временный пароль всё ещё работает: ${bad.status}`)

  const good = await req("/api/auth/login", {
    method: "POST",
    jar: new Jar("new"),
    body: { email: testEmail, password: newPassword },
  })
  assert(good.status === 200, `новый пароль не сработал: ${good.status}`)
  assert(good.data?.user?.mustChangePassword === false, "флаг смены пароля не снят")
  return "новый пароль работает, mustChangePassword = false"
})

await check("слабый пароль отклоняется", async () => {
  const res = await req("/api/auth/change-password", {
    method: "POST",
    jar: afterReset,
    body: { currentPassword: newPassword, newPassword: "123" },
  })
  assert(res.status === 400, `ожидали 400, получили ${res.status}`)
  return res.data?.error
})

// ── 6. Выход ─────────────────────────────────────────────────────────────
group("6. Выход отзывает сессию на сервере")

await check("POST /api/auth/logout → сессия мертва, cookie удалён", async () => {
  // Заходим заново, чтобы проверять выход на заведомо живой сессии
  const fresh = await req("/api/auth/login", {
    method: "POST",
    jar: afterReset,
    body: { email: testEmail, password: newPassword },
  })
  assert(fresh.status === 200, `не удалось войти для проверки выхода: ${fresh.status}`)
  assert(afterReset.has("loginex_staff_session"), "cookie не выдан")

  const res = await req("/api/auth/logout", { method: "POST", jar: afterReset })
  assert(res.status === 200, `выход: ${res.status}`)
  assert(!afterReset.has("loginex_staff_session"), "cookie не удалён")

  const after = await req("/api/orders", { jar: afterReset })
  assert(after.status === 401, `после выхода API отвечает ${after.status}`)
  return "HTTP 401 после выхода"
})

// ── 7. Водительский контур ───────────────────────────────────────────────
group("7. Водитель: свои данные и игнорирование driverId из запроса")

const driver = new Jar("driver")
const newDriverPassword = tempPassword()
let driverId = null
let driverName = null
let driverPhone = DRIVER_PHONE
let driverPasswordUsed = DRIVER_PASSWORD

if (!WANT_DRIVER) {
  skip("проверки водителя", "запустите с флагом --driver")
} else {
  if (!DRIVER_PHONE || !DRIVER_PASSWORD) {
    await check("берём водителя из базы и сбрасываем ему пароль", async () => {
      const list = await req("/api/auth/users?status=active&pageSize=200", { jar: admin })
      assert(list.status === 200, `список пользователей: ${list.status}`)
      const candidate = (list.data?.users || []).find((u) => u.role === "driver" && u.phone)
      assert(candidate, "в базе нет ни одного активного водителя с телефоном")
      const res = await req(`/api/auth/users/${candidate.id}`, {
        method: "PATCH",
        jar: admin,
        body: { action: "resetPassword" },
      })
      assert(res.data?.temporaryPassword, "не удалось сбросить пароль водителю")
      driverId = candidate.driverId
      driverName = candidate.name
      driverPhone = candidate.phone
      driverPasswordUsed = res.data.temporaryPassword
      console.log(
        `      ⚠ Водителю «${candidate.name}» (${candidate.phone}) сброшен пароль.\n` +
          `        Временный пароль: ${driverPasswordUsed}\n` +
          `        Скрипт сменит его на ${newDriverPassword} и оставит его действующим.`,
      )
      return `${candidate.name} · ${candidate.phone}`
    })
  }

  await check("вход водителя по телефону и паролю", async () => {
    const phone = driverPhone
    const password = driverPasswordUsed
    assert(phone && password, "нет телефона/пароля водителя")
    const res = await req("/api/m/login", {
      method: "POST",
      jar: driver,
      body: { phone, password },
    })
    assert(res.status === 200, `ожидали 200, получили ${res.status}: ${JSON.stringify(res.data)}`)
    assert(driver.has("loginex_driver_session"), "нет cookie loginex_driver_session")
    assert(driver.attrsOf("loginex_driver_session").includes("httponly"), "cookie без HttpOnly")
    driverId = res.data.driver.id
    driverName = res.data.driver.name
    return `${driverName} · ${res.data.driver.phone}`
  })

  if (!DRIVER_PASSWORD && driverPasswordUsed !== newDriverPassword) {
    await check("водитель меняет временный пароль на постоянный", async () => {
      const res = await req("/api/auth/change-password", {
        method: "POST",
        jar: driver,
        body: { currentPassword: driverPasswordUsed, newPassword: newDriverPassword },
      })
      assert(res.status === 200, `смена пароля: ${res.status} ${JSON.stringify(res.data)}`)
      driverPasswordUsed = newDriverPassword
      console.log(`      Новый пароль водителя: ${newDriverPassword}`)

      const again = await req("/api/m/login", {
        method: "POST",
        jar: driver,
        body: { phone: driverPhone, password: newDriverPassword },
      })
      assert(again.status === 200, `после смены пароля вход сломался: ${again.status}`)
      return "пароль сменён, вход работает"
    })
  }

  await check("GET /api/m/me отдаёт свои данные из сессии", async () => {
    const res = await req("/api/m/me", { jar: driver })
    assert(res.status === 200, `ожидали 200, получили ${res.status}`)
    assert(res.data?.driver?.id === driverId, "id водителя не совпал с сессионным")
    return res.data.driver.name
  })

  let foreignOrderId = null
  let foreignDriverId = null

  await check("подстановка чужого driverId в query игнорируется", async () => {
    const own = await req("/api/m/orders", { jar: driver })
    assert(own.status === 200, `свой список: ${own.status}`)

    const staffList = await req("/api/orders", { jar: admin })
    const orders = staffList.data?.orders || []
    const foreign = orders.find((o) => o.assignedDriverId && o.assignedDriverId !== driverId)
    foreignOrderId = foreign?.id || null
    foreignDriverId = foreign?.assignedDriverId || null

    const spoof = await req(`/api/m/orders?driverId=${foreignDriverId || "cbc000fake"}`, {
      jar: driver,
    })
    assert(spoof.status === 200, `ожидали 200, получили ${spoof.status}`)

    const ownIds = new Set((own.data?.orders || []).map((o) => o.id))
    const spoofIds = (spoof.data?.orders || []).map((o) => o.id)
    const leaked = spoofIds.filter((id) => !ownIds.has(id))
    assert(leaked.length === 0, `водитель получил чужие заказы: ${leaked.join(", ")}`)
    const notMine = (spoof.data?.orders || []).filter(
      (o) => o.assignedDriverId && o.assignedDriverId !== driverId,
    )
    assert(notMine.length === 0, `в ответе заказы чужого водителя: ${notMine.length} шт.`)
    return `своих заказов ${ownIds.size}, чужих не выдано`
  })

  if (!foreignOrderId) {
    skip("чужой заказ по id → 403", "в базе нет заказа, назначенного другому водителю")
    skip("водитель не может менять чужой заказ", "нет чужого заказа для проверки")
    skip("водитель не может переназначить заказ на себя", "нет чужого заказа для проверки")
  } else {
    await check("чужой заказ по id → 403", async () => {
      const res = await req(`/api/orders/${foreignOrderId}`, { jar: driver })
      assert(res.status === 403, `ожидали 403, получили ${res.status}`)
      return res.data?.error
    })

    await check("водитель не может менять чужой заказ", async () => {
      const res = await req(`/api/orders/${foreignOrderId}`, {
        method: "PATCH",
        jar: driver,
        body: { status: "delivered" },
      })
      assert(res.status === 403, `ожидали 403, получили ${res.status}`)
      return res.data?.error
    })

    await check("водитель не может переназначить заказ на себя", async () => {
      const res = await req(`/api/orders/${foreignOrderId}`, {
        method: "PATCH",
        jar: driver,
        body: { assignedDriverId: driverId },
      })
      assert(res.status === 403, `ожидали 403, получили ${res.status}`)
      return res.data?.error
    })
  }

  await check("штабные разделы водителю закрыты", async () => {
    const failures = []
    for (const route of ["/api/auth/users", "/api/sos", "/api/fleet", "/api/photos"]) {
      const res = await req(route, { jar: driver })
      if (res.status !== 401 && res.status !== 403) failures.push(`${route} → ${res.status}`)
    }
    assert(failures.length === 0, `открылось: ${failures.join(", ")}`)
    return "401/403 на всех"
  })

  await check("страница /users водителю недоступна", async () => {
    const res = await req("/users", { jar: driver })
    assert(res.status >= 300 && res.status < 400, `ожидали редирект, получили ${res.status}`)
    assert((res.location || "").startsWith("/m/login"), `редирект на ${res.location}`)
    return res.location
  })

  await check("чат: отправитель берётся из сессии, а не из тела запроса", async () => {
    const list = await req("/api/chat", { jar: driver })
    assert(list.status === 200, `список сообщений: ${list.status}`)
    const foreign = (list.data?.messages || []).filter(
      (m) => m.senderId !== driverId && m.recipientId !== driverId,
    )
    assert(foreign.length === 0, `видна чужая переписка: ${foreign.length} сообщений`)

    const res = await req("/api/chat", {
      method: "POST",
      jar: driver,
      body: {
        senderId: foreignDriverId || "cbc000fake",
        senderRole: "logist",
        senderName: "Проверочный взлом",
        recipientId: foreignDriverId || driverId,
        content: "Проверка безопасности: подделка отправителя",
        type: "text",
      },
    })
    assert(res.status === 200 || res.status === 201, `отправка: ${res.status} ${JSON.stringify(res.data)}`)
    const message = res.data?.message
    assert(message, "в ответе нет созданного сообщения")
    assert(message.senderId === driverId, `senderId подделан: ${message.senderId}`)
    assert(message.senderRole === "driver", `senderRole подделан: ${message.senderRole}`)
    assert(message.senderName === driverName, `senderName подделан: ${message.senderName}`)
    return `сообщение ${message.id} подписано «${message.senderName}»`
  })

  await check("SOS: автор определяется сервером, диспетчер видит сигнал", async () => {
    const created = await req("/api/m/sos", {
      method: "POST",
      jar: driver,
      body: {
        driverId: foreignDriverId || "cbc000fake", // подделка — должна игнорироваться
        type: "other",
        latitude: 57.6261,
        longitude: 39.8845,
        message: "Проверочный сигнал (скрипт verify:security)",
      },
    })
    assert(created.status === 200 || created.status === 201, `SOS: ${created.status} ${JSON.stringify(created.data)}`)
    const sosId = created.data?.sosId
    assert(sosId, "в ответе нет sosId")

    const queue = await req("/api/sos?status=active&pageSize=100", { jar: admin })
    assert(queue.status === 200, `список SOS у диспетчера: ${queue.status}`)
    const found = (queue.data?.alerts || []).find((a) => a.id === sosId)
    assert(found, "диспетчер не видит созданный сигнал")
    assert(found.driverId === driverId, `SOS записан на чужого водителя: ${found.driverId}`)
    assert(found.driver?.name === driverName, "в списке SOS нет имени водителя")
    assert(typeof found.typeLabel === "string" && found.typeLabel.length > 0, "нет typeLabel")
    assert(typeof queue.data?.pagination?.total === "number", "нет пагинации")

    const closed = await req("/api/sos", {
      method: "PATCH",
      jar: admin,
      body: { sosId, status: "false_alarm", resolution: "Проверочный сигнал скрипта" },
    })
    assert(closed.status === 200, `обработка SOS: ${closed.status} ${JSON.stringify(closed.data)}`)
    return `${found.typeLabel} · автор ${found.driver?.name} · закрыт как ложный`
  })

  await check("водительский выход работает так же", async () => {
    const res = await req("/api/auth/logout", { method: "POST", jar: driver })
    assert(res.status === 200, `выход: ${res.status}`)
    const after = await req("/api/m/me", { jar: driver })
    assert(after.status === 401, `после выхода /api/m/me отвечает ${after.status}`)
    return "HTTP 401 после выхода"
  })
}

// ── 8. Уборка ────────────────────────────────────────────────────────────
group("8. Уборка")

if (KEEP_USER) {
  skip(`тестовая учётка ${testEmail}`, "--keep-user: оставляю активной")
} else {
  await check("тестовая учётка закрыта и помечена", async () => {
    const list = await req("/api/auth/users?status=all&pageSize=200", { jar: admin })
    const found = (list.data?.users || []).find((u) => u.email === testEmail)
    if (!found) return "учётка не найдена (и не нужна)"
    const res = await req(`/api/auth/users/${found.id}`, {
      method: "PATCH",
      jar: admin,
      body: { action: "suspend", reason: "Тестовая учётка скрипта verify:security" },
    })
    assert(res.status === 200, `не удалось закрыть тестовую учётку: ${res.status}`)
    return `${testEmail} — доступ закрыт, запись осталась в базе`
  })
}

await check("администратор выходит", async () => {
  const res = await req("/api/auth/logout", { method: "POST", jar: admin })
  assert(res.status === 200, `выход: ${res.status}`)
  return "сессия отозвана"
})

// ══════════════════════════════════════════════════════════════════════════
// Итог
// ══════════════════════════════════════════════════════════════════════════

const passed = results.filter((r) => r.ok === true).length
const failed = results.filter((r) => r.ok === false)
const skipped = results.filter((r) => r.ok === null).length

console.log("\n" + "─".repeat(64))
console.log(`Проверок пройдено: ${passed} · провалено: ${failed.length} · пропущено: ${skipped}`)

if (failed.length) {
  console.log("\nПровалы:")
  for (const item of failed) console.log(`  ✗ ${item.name}\n      → ${item.note}`)
  console.log(
    "\nЧто смотреть: запущен ли npm run dev, задан ли AUTH_SECRET в .env,\n" +
      "применена ли схема (npm run db:push), создан ли админ (npm run seed:auth).\n",
  )
  process.exit(1)
}

console.log("\nДоступ закрыт там, где должен быть закрыт. Задача 1 проверена.\n")
process.exit(0)
