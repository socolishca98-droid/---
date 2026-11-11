// scripts/e2e-owner-flow.mjs
//
// Живая приёмка пути владельца платформы (и33).
//
// Жалоба: «По моему логину и паролю открывалась страница разработчика,
// её мы уже увидели. На этой странице все необходимые инструменты. И именно
// с этой страницы я мог войти в ЛЮБОЙ Аккаунт любой организации. Надо
// вернуть эту функцию».
//
// Что проверяем (телефон — как у владельца, UA iPhone):
//   1. вход своим логином/паролем → страница разработчика /owner;
//   2. открытие «/» при живой сессии → снова /owner (раньше: панель
//      логиста на телефоне / кабинет на компьютере);
//   3. поиск человека в любой компании → «Войти»;
//   4. вход в водителя → СРАЗУ кабинет водителя /m + полоса «Вы вошли как»;
//   5. вход в логиста → /lm; возврат → /owner;
//   6. вход в аккаунт ДРУГОЙ организации → /lm (кросс-орг);
//   7. полоса не врёт на собственной панели владельца;
//   8. ловушка со скриншотов: водительская сессия умерла → вход водителя
//      встречает кнопкой возврата в панель, а не тупиком.
//
// Запуск: дев на 3100 уже поднят (после правок proxy.ts — рестарт!),
// затем: node scripts/e2e-owner-flow.mjs

import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = process.env.BASE_URL || "http://localhost:3100"

function envValue(key) {
  const match = readFileSync("/home/user/loginex/.env", "utf-8")
    .split("\n")
    .find((line) => line.startsWith(`${key}=`))
  return match ? match.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : ""
}

const results = []
function check(name, ok, detail = "") {
  results.push({ name, ok, detail })
  console.log(`${ok ? "OK  " : "FAIL"} | ${name} | ${detail}`)
}

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

/** Кросс-организационный демо-аккаунт: во второй компании людей нет —
 *  создаём, чтобы «войти в ЛЮБОЙ аккаунт любой организации» проверялся
 *  по-настоящему, а не по словам. Идемпотентно. */
async function ensureSecondOrgUser(prisma) {
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } })
  const homeOrgId = (
    await prisma.user.findUnique({
      where: { email: envValue("OWNER_EMAIL") || "owner@local.test" },
      select: { organizationId: true },
    })
  )?.organizationId
  const otherOrg = orgs.find((org) => org.id !== homeOrgId)
  if (!otherOrg) return null

  const existing = await prisma.user.findUnique({ where: { email: "logist@other.test" } })
  if (existing) return { userId: existing.id, orgId: otherOrg.id }

  const donor = await prisma.user.findUnique({
    where: { email: "logist@local.test" },
    select: { passwordHash: true, passwordSalt: true },
  })
  const created = await prisma.user.create({
    data: {
      email: "logist@other.test",
      name: "Соколова Мария Игоревна",
      role: "logist",
      status: "active",
      organizationId: otherOrg.id,
      passwordHash: donor?.passwordHash ?? "x",
      passwordSalt: donor?.passwordSalt ?? "x",
    },
    select: { id: true },
  })
  return { userId: created.id, orgId: otherOrg.id }
}

const browser = await chromium.launch({ args: ["--disable-gpu"] })
process.on("exit", () => {
  try { browser.close() } catch {}
})

const { PrismaClient } = (await import("@prisma/client")).default ?? {}
const prisma = new PrismaClient()

try {
  const other = await ensureSecondOrgUser(prisma)
  check("второй пользователь в другой организации готов", Boolean(other), other ? other.userId : "нет второй организации")

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 150)))

  // ── 1. Вход своим логином и паролем → страница разработчика ──────────────
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForSelector("[data-login-panel] input#email", { timeout: 30000 })
  await page.fill("#email", envValue("OWNER_EMAIL") || "owner@local.test")
  await page.fill("#password", envValue("OWNER_PASSWORD") || "Proverka123")
  // 3D-мир непрерывно анимирует панель — клик по «пляшущей» кнопке улетает
  // мимо; надёжный сабмит — Enter в поле пароля (как с клавиатуры)
  await page.locator("#password").press("Enter")
  await page.waitForURL("**/owner", { timeout: 90000 })
  await page.waitForSelector("text=Компании на платформе", { timeout: 30000 })
  check("вход владельца своим паролем открывает страницу разработчика", true, page.url())

  // ── 2. «/» при живой сессии → снова панель (и33, главный фикс) ───────────
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForURL("**/owner", { timeout: 30000 })
  check("открытие «/» при живой сессии ведёт на панель, а не в кабинет/логиста", true, page.url())

  // ── 3. Поиск человека в любой компании ───────────────────────────────────
  await page.fill(
    "input[placeholder*='Найти человека']",
    "Орлов",
  )
  await page.waitForSelector("text=Орлов Никита Андреевич", { timeout: 30000 })
  const orlovRow = page.locator("li", { hasText: "Орлов Никита Андреевич" }).first()
  await orlovRow.locator("button", { hasText: "Войти" }).waitFor({ timeout: 15000 })
  check("поиск находит водителя в любой компании, кнопка «Войти» активна", true, "Орлов Никита Андреевич")

  // ── 4. Вход в водителя → сразу кабинет водителя ─────────────────────────
  await orlovRow.locator("button", { hasText: "Войти" }).click()
  await page.waitForURL(/\/m$/, { timeout: 30000 })
  await page.waitForSelector("text=Вы вошли как", { timeout: 30000 })
  const bannerText = await page.locator("text=Вы вошли как").first().textContent()
  check("вход в водителя — сразу кабинет водителя /m", /\/m$/.test(page.url()), page.url())
  check("полоса показывает, чей аккаунт открыт", Boolean(bannerText?.includes("Орлов")), bannerText ?? "")

  // ── 5. Полоса не врёт на собственной панели ─────────────────────────────
  await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForSelector("text=Компании на платформе", { timeout: 30000 })
  await page.waitForTimeout(1200)
  const ownBanner = await page.locator("text=Вы вошли как").count()
  check("на собственной панели владельца полоса «Вы вошли как [сам себя]» не висит", ownBanner === 0, `найдено полос: ${ownBanner}`)

  // ── 6. Вход в логиста → /lm, возврат → /owner ───────────────────────────
  await page.fill("input[placeholder*='Найти человека']", "logist@local.test")
  await page.waitForSelector("text=logist@local.test", { timeout: 30000 })
  const logistRow = page.locator("li", { hasText: "logist@local.test" }).first()
  await logistRow.locator("button", { hasText: "Войти" }).click()
  await page.waitForURL(/\/lm/, { timeout: 30000 })
  check("вход в логиста — его мобильная панель /lm", /\/lm/.test(page.url()), page.url())
  await page.locator("button", { hasText: "Вернуться" }).first().click()
  await page.waitForURL("**/owner", { timeout: 30000 })
  check("«Вернуться» возвращает на страницу разработчика", true, page.url())

  // ── 7. Кросс-организация: аккаунт из ДРУГОЙ компании ────────────────────
  if (other) {
    await page.fill("input[placeholder*='Найти человека']", "Соколова")
    await page.waitForSelector("text=Соколова Мария Игоревна", { timeout: 30000 })
    const otherRow = page.locator("li", { hasText: "Соколова Мария Игоревна" }).first()
    await otherRow.locator("button", { hasText: "Войти" }).click()
    await page.waitForURL(/\/lm/, { timeout: 30000 })
    check("вход в аккаунт другой организации работает", /\/lm/.test(page.url()), page.url())
    await page.locator("button", { hasText: "Вернуться" }).first().click()
    await page.waitForURL("**/owner", { timeout: 30000 })
    check("возврат из чужой организации — на страницу разработчика", true, page.url())
  }

  // ── 8. Ловушка со скриншотов: водительская сессия умерла ────────────────
  await page.fill("input[placeholder*='Найти человека']", "Орлов")
  await page.waitForSelector("text=Орлов Никита Андреевич", { timeout: 30000 })
  const trapRow = page.locator("li", { hasText: "Орлов Никита Андреевич" }).first()
  await trapRow.locator("button", { hasText: "Войти" }).click()
  await page.waitForURL(/\/m$/, { timeout: 30000 })
  await page.waitForSelector("text=Вы вошли как", { timeout: 30000 })

  // убиваем водительскую сессию в базе — как будто её отозвали/истёк срок
  const orlovDriver = await prisma.driver.findFirst({ where: { phone: "+79161234505" }, select: { id: true } })
  const orlovUser = orlovDriver
    ? await prisma.user.findFirst({ where: { driverId: orlovDriver.id }, select: { id: true } })
    : null
  const revoked = orlovUser
    ? await prisma.session.updateMany({
        where: { userId: orlovUser.id, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "e2e_owner_flow_trap" },
      })
    : null
  check("водительская сессия отозвана в базе (симуляция смерти)", (revoked?.count ?? 0) > 0, `строк: ${revoked?.count ?? 0}`)

  // Сервер кэширует разрешённую сессию на 15 секунд (lib/auth/session.ts),
  // а открытая страница /m сама подпитывает этот кэш опросом. Уводим страницу
  // в сторону и ждём истечения кэша — как человек, вернувшийся на сайт позже.
  await page.goto("about:blank")
  await page.waitForTimeout(16000)

  await page.goto(`${BASE}/m`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForURL(/\/m\/login/, { timeout: 30000 })
  const returnButton = page.locator("button", { hasText: "вернуться в панель" })
  await returnButton.waitFor({ timeout: 30000 })
  check("вход водителя встречает владельца кнопкой возврата, а не тупиком", true, await returnButton.first().textContent())

  // кнопка живёт в анимирующемся 3D-мире — координатный клик мимо;
  // жмём программно, как будто человек попал точно
  await returnButton.first().evaluate((el) => el.click())
  await page.waitForURL("**/owner", { timeout: 30000 })
  check("кнопка возврата приводит на страницу разработчика", true, page.url())

  // ── Фон: ошибок страницы не накопилось ──────────────────────────────────
  const realErrors = errors.filter((e) => !e.includes("favicon"))
  check("ошибок страницы нет", realErrors.length === 0, realErrors.slice(0, 3).join(" | ") || "чисто")

  await context.close()
} finally {
  await prisma.$disconnect()
}

const failed = results.filter((r) => !r.ok)
console.log(`\nИТОГ: ${results.length - failed.length}/${results.length} проверок пройдено`)
if (failed.length > 0) process.exit(1)
