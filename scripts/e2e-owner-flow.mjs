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
//      встречает кнопкой возврата в панель, а не тупиком;
//   9. и35: proxy-вылеты на вход несут код причины (no_session_cookie /
//      token_rejected) и превращаются в понятные надписи;
//  10. и36: сценарий скриншота «Вы вошли как …, а я на авторизации» —
//      окаменелая полоса исчезает, гонка «нажал и ушёл назад» закрывается
//      опросом сессии, почта в поле телефона получает подсказку.
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
  // и35: заодно ловим ответ имперсонации — обе cookie обязаны ехать
  // РАЗДЕЛЬНЫМИ Set-Cookie. Склеенные в одну строку через запятую
  // браузер отбрасывает целиком — и «вход как» молча терял бы cookie.
  const impersonateResponses = []
  page.on("response", (res) => {
    try {
      if (new URL(res.url()).pathname === "/api/admin/impersonate") {
        impersonateResponses.push(res)
      }
    } catch {}
  })
  await orlovRow.locator("button", { hasText: "Войти" }).click()
  await page.waitForURL(/\/m$/, { timeout: 30000 })
  await page.waitForSelector("text=Вы вошли как", { timeout: 30000 })
  const bannerText = await page.locator("text=Вы вошли как").first().textContent()
  check("вход в водителя — сразу кабинет водителя /m", /\/m$/.test(page.url()), page.url())
  check("полоса показывает, чей аккаунт открыт", Boolean(bannerText?.includes("Орлов")), bannerText ?? "")

  const impersonateRes = impersonateResponses.find((r) => r.request().method() === "POST")
  const setCookies = impersonateRes
    ? (await impersonateRes.headersArray()).filter((h) => h.name.toLowerCase() === "set-cookie")
    : []
  const setCookieNames = setCookies.map((h) => h.value.split("=")[0])
  check(
    "обе cookie имперсонации едут раздельными Set-Cookie (не склеены)",
    setCookieNames.includes("loginex_owner_session") && setCookieNames.includes("loginex_driver_session") && setCookies.length >= 2,
    setCookieNames.join(", ") || "ответ не пойман",
  )

  // ── 5. Полоса не врёт на собственной панели ─────────────────────────────
  await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForSelector("text=Компании на платформе", { timeout: 30000 })
  await page.waitForTimeout(1200)
  const ownBanner = await page.locator("text=Вы вошли как").count()
  check("на собственной панели владельца полоса «Вы вошли как [сам себя]» не висит", ownBanner === 0, `найдено полос: ${ownBanner}`)

  // ── 5б. Страница управления: «Войти как водитель» (путь владельца из скриншотов) ──
  const orgLink = page.locator("a[href^='/owner/org/']").first()
  await orgLink.click()
  await page.waitForURL(/\/owner\/org\//, { timeout: 30000 })
  await page.waitForSelector("text=Войти как водитель", { timeout: 30000 })
  const orgPath = new URL(page.url()).pathname
  await page.locator("button", { hasText: "Войти как водитель" }).first().evaluate((el) => el.click())
  await page.waitForURL(/\/m$/, { timeout: 30000 })
  await page.waitForSelector("text=Вы вошли как", { timeout: 30000 })
  check("страница управления: «Войти как водитель» — сразу кабинет водителя", true, `${orgPath} → ${page.url()}`)
  await page.locator("button", { hasText: "Вернуться" }).first().evaluate((el) => el.click())
  await page.waitForURL("**/owner", { timeout: 30000 })

  // ── 5в. ПРОТУХШИЙ cookie имперсонации (хвост прошлых итераций) ──────────
  // Раньше impersonate не перезаписывал старый токен: полоса пропадала,
  // «Вернуться» из чужого кабинета не работал. Теперь перезаписывает.
  await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await page.waitForSelector("text=Компании на платформе", { timeout: 30000 })
  await context.addCookies([{ name: "loginex_owner_session", value: "stale-garbage-token", domain: "localhost", path: "/", httpOnly: true }])
  await page.fill("input[placeholder*='Найти человека']", "Кузнецов")
  await page.waitForSelector("text=Кузнецов Андрей Владимирович", { timeout: 30000 })
  await page.locator("li", { hasText: "Кузнецов Андрей Владимирович" }).first().locator("button", { hasText: "Войти" }).click()
  await page.waitForURL(/\/m$/, { timeout: 30000 })
  await page.waitForSelector("text=Вы вошли как", { timeout: 30000 })
  check("протухший cookie имперсонации перезаписан: полоса на месте", true, "Кузнецов")
  await page.locator("button", { hasText: "Вернуться" }).first().evaluate((el) => el.click())
  await page.waitForURL("**/owner", { timeout: 30000 })
  check("«Вернуться» работает после протухшего cookie", true, page.url())

  // ── 5г. Ошибка «входа как»: НЕ тост, а постоянный блок с причиной ───────
  // Кнопка у закрытых аккаунтов блокируется сама (и31), поэтому отказ
  // подставляем точечно — перехватываем ответ API, как будто сервер
  // отказал уже после нажатия (закрытый доступ, сбой, защита хостинга).
  await context.route("**/api/admin/impersonate", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: "Доступ закрыт: e2e проверка блока ошибки", code: "target_inactive" }),
    }),
  )
  await page.fill("input[placeholder*='Найти человека']", "Кузнецов")
  await page.waitForSelector("text=Кузнецов Андрей Владимирович", { timeout: 30000 })
  await page.locator("li", { hasText: "Кузнецов Андрей Владимирович" }).first().locator("button", { hasText: "Войти" }).click()
  const errorBlock = page.locator("[role=alert]", { hasText: "Не удалось войти в аккаунт" })
  await errorBlock.waitFor({ timeout: 30000 })
  const errorText = (await errorBlock.first().textContent()) ?? ""
  check("отказ «войти как»: постоянный блок с причиной (не тост)", /Доступ закрыт/.test(errorText), errorText.slice(0, 90))
  await errorBlock.locator("button[aria-label='Закрыть']").evaluate((el) => el.click())
  await context.unroute("**/api/admin/impersonate")
  await page.waitForTimeout(500)

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
  // и34: причина смерти сессии видна на входе — не «просто выкинуло»
  const reasonNotice = page.locator("[role=alert]", { hasText: "Сессия водителя недействительна" })
  await reasonNotice.waitFor({ timeout: 30000 })
  check("причина смерти сессии показана на входе", /завершена/.test((await reasonNotice.first().textContent()) ?? ""), (await reasonNotice.first().textContent())?.slice(0, 90) ?? "")
  const returnButton = page.locator("button", { hasText: "вернуться в панель" })
  await returnButton.waitFor({ timeout: 30000 })
  check("вход водителя встречает владельца кнопкой возврата, а не тупиком", true, await returnButton.first().textContent())

  // и35: серверная диагностика — cookie водителя в запросе ЕСТЬ (умерла
  // сессия в базе, а не cookie). Различие видит только сервер: клиент
  // httpOnly-cookie не читает.
  const diag = page.locator("[data-driver-cookie]")
  await diag.waitFor({ timeout: 30000 })
  const diagAttr = await diag.first().getAttribute("data-driver-cookie")
  const diagText = ((await diag.first().textContent()) ?? "").trim()
  check(
    "диагностика: cookie водителя на месте, умерла сессия (не cookie)",
    diagAttr === "present" && /есть в этом запросе/.test(diagText),
    diagText.slice(0, 90),
  )

  // кнопка живёт в анимирующемся 3D-мире — координатный клик мимо;
  // жмём программно, как будто человек попал точно
  await returnButton.first().evaluate((el) => el.click())
  await page.waitForURL("**/owner", { timeout: 30000 })
  check("кнопка возврата приводит на страницу разработчика", true, page.url())

  // ── 9. и35: proxy-вылет на вход больше не бывает «просто так» ───────────
  // Защита разделов (proxy) работает на подписи токена, без базы — это был
  // последний источник вылета на вход БЕЗ причины. Теперь редирект несёт код:
  // no_session_cookie (браузер cookie не прислал) или token_rejected
  // (прислал, но подпись/срок/роль не прошли) — и вход объясняет это словами.
  const anonContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
  })
  const anonPage = await anonContext.newPage()
  await anonPage.goto(`${BASE}/m`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await anonPage.waitForURL(/\/m\/login\?/, { timeout: 30000 })
  check(
    "без cookie: вылет на вход несёт код no_session_cookie",
    /reason=no_session_cookie/.test(anonPage.url()),
    anonPage.url(),
  )
  const anonNotice = anonPage.locator("[role=alert]", { hasText: "Сессия водителя недействительна" })
  await anonNotice.waitFor({ timeout: 30000 })
  check(
    "без cookie: заметка объясняет причину словами",
    /без cookie/.test((await anonNotice.first().textContent()) ?? ""),
    ((await anonNotice.first().textContent()) ?? "").slice(0, 90),
  )

  await anonContext.addCookies([
    { name: "loginex_driver_session", value: "garbage-token-e2e", domain: "localhost", path: "/", httpOnly: true },
  ])
  await anonPage.goto(`${BASE}/m`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await anonPage.waitForURL(/\/m\/login\?/, { timeout: 30000 })
  check(
    "мусорная cookie: вылет на вход несёт код token_rejected",
    /reason=token_rejected/.test(anonPage.url()),
    anonPage.url(),
  )
  const rejectNotice = anonPage.locator("[role=alert]", { hasText: "Сессия водителя недействительна" })
  await rejectNotice.waitFor({ timeout: 30000 })
  check(
    "мусорная cookie: заметка говорит, что cookie не принята",
    /не принята/.test((await rejectNotice.first().textContent()) ?? ""),
    ((await rejectNotice.first().textContent()) ?? "").slice(0, 90),
  )
  await anonContext.close()

  // ── 10. и36: сценарий со скриншота владельца — «Вы вошли как …», а он на входе ──
  // Скриншот IMG_4426: вход водителя, сверху полоса «Вы вошли как … Вернуться»,
  // в поле «Телефон» — почта владельца, ошибка «Неверный телефон или пароль».
  // Полоса — «окаменелость»: её данные замерли при клиентском уходе в /m/login.
  // Здесь воспроизводим всё целиком: живой кабинет → смерть сессии → возврат
  // на вход без перезагрузки → полоса обязана исчезнуть, причина — остаться.
  const ctxB = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
  })
  const pageB = await ctxB.newPage()
  await pageB.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await pageB.waitForSelector("[data-login-panel] input#email", { timeout: 30000 })
  await pageB.fill("#email", envValue("OWNER_EMAIL") || "owner@local.test")
  await pageB.fill("#password", envValue("OWNER_PASSWORD") || "Proverka123")
  await pageB.locator("#password").press("Enter")
  await pageB.waitForURL("**/owner", { timeout: 90000 })
  await pageB.waitForSelector("text=Компании на платформе", { timeout: 30000 })
  await pageB.fill("input[placeholder*='Найти человека']", "Иванов")
  await pageB.waitForSelector("text=Иванов Сергей Петрович", { timeout: 30000 })
  await pageB.locator("li", { hasText: "Иванов Сергей Петрович" }).first().locator("button", { hasText: "Войти" }).click()
  await pageB.waitForURL(/\/m$/, { timeout: 30000 })
  await pageB.waitForSelector("text=Вы вошли как", { timeout: 30000 })
  check("и36: вход в Иванова — кабинет с полосой (подготовка сцены)", true, await pageB.locator("text=Вы вошли как").first().textContent())

  // убиваем сессию Иванова в базе и ждём, пока истекут ОБА кэша:
  // серверный (15 с) и клиентский (60 с) — как человек, вернувшийся через минуту
  const ivanovDriver = await prisma.driver.findFirst({ where: { phone: "+79161234501" }, select: { id: true } })
  const ivanovUser = ivanovDriver
    ? await prisma.user.findFirst({ where: { driverId: ivanovDriver.id }, select: { id: true } })
    : null
  const revokedIvanov = ivanovUser
    ? await prisma.session.updateMany({
        where: { userId: ivanovUser.id, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "e2e_i36_banner_fossil" },
      })
    : null
  check("и36: сессия Иванова отозвана в базе", (revokedIvanov?.count ?? 0) > 0, `строк: ${revokedIvanov?.count ?? 0}`)
  // Ждём истечения ОБЕИХ кэшей: клиентского (60 с, module-level у хука) и
  // серверного (15 с). Клиентский переход внутри кабинета («Рейсы») монтирует
  // новый экземпляр хука — при живом кэше он показал бы устаревшего Иванова.
  await pageB.waitForTimeout(62_000)
  // программный клик: внизу страницы висит бейдж dev-режима Next.js и
  // перехватывает pointer-события над нижней навигацией
  await pageB.locator("a[href='/m/orders']").first().evaluate((el) => el.click())
  await pageB.waitForURL(/\/m\/login\?reason=/, { timeout: 30000 })
  const fossilNotice = pageB.locator("[role=alert]", { hasText: "Сессия водителя недействительна" })
  await fossilNotice.waitFor({ timeout: 30000 })
  check(
    "и36: причина на входе после тихой смерти сессии",
    /недействительна/.test((await fossilNotice.first().textContent()) ?? ""),
    ((await fossilNotice.first().textContent()) ?? "").slice(0, 80),
  )
  await pageB.waitForTimeout(800)
  const staleBanners = await pageB.locator("text=Вы вошли как").count()
  check(
    "и36: «окаменелая» полоса «Вы вошли как» на входе НЕ висит (главное со скриншота)",
    staleBanners === 0,
    `полос на входе: ${staleBanners}`,
  )
  const ownerEscape = pageB.locator("button", { hasText: "Вы владелец" })
  await ownerEscape.waitFor({ timeout: 15000 })
  check("и36: честный путь назад — кнопка владельца на месте", true, (await ownerEscape.first().textContent())?.trim() ?? "")

  // ── 10б. Спасение из гонки «нажал "Войти как" и ушёл назад» ─────────────
  // Cookie имперсонации прилетают, когда человек уже сидит на входе и никаких
  // событий (focus/pageshow) не происходит. Опрос сессии (и36) должен сам
  // увести в кабинет. Сессию Орлова выпускаем серверным вызовом — как ответ
  // имперсонации, пришедший на открытую страницу.
  const csrfJson = await (await ctxB.request.get(`${BASE}/api/auth/csrf`)).json()
  const impRes = await ctxB.request.post(`${BASE}/api/admin/impersonate`, {
    headers: { "X-CSRF-Token": csrfJson.csrfToken },
    data: { driverId: orlovDriver?.id },
  })
  check("и36: сессия Орлова выпущена поверх (как опоздавший ответ)", impRes.ok(), `HTTP ${impRes.status()}`)
  await pageB.waitForURL(/\/m$/, { timeout: 20000 })
  await pageB.waitForSelector("text=Вы вошли как", { timeout: 30000 })
  check(
    "и36: опрос сам увёл в кабинет (гонка закрыта без действий человека)",
    /Орлов/.test((await pageB.locator("text=Вы вошли как").first().textContent()) ?? ""),
    await pageB.locator("text=Вы вошли как").first().textContent(),
  )
  await ctxB.close()

  // ── 10в. Почта в поле «Телефон» — ловушка со скриншота ──────────────────
  // Браузер владельца подставляет его почту в поле телефона; раньше вход
  // отвечал «Неверный телефон или пароль». Теперь — прямая подсказка.
  // Свежий контекст без cookie: в основном контексте после 10б живёт
  // сессия Орлова, и опрос и36 уводит страницу с входа в кабинет.
  const ctxC = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_UA,
  })
  const pageC = await ctxC.newPage()
  pageC.on("pageerror", (err) => errors.push(String(err)))
  await pageC.goto(`${BASE}/m/login`, { waitUntil: "domcontentloaded", timeout: 60000 })
  await pageC.waitForSelector("#driver-phone", { timeout: 30000 })
  await pageC.fill("#driver-phone", "socolishca98@gmail.com")
  await pageC.fill("#driver-password", "Proverka123")
  await pageC.locator("#driver-password").press("Enter")
  const emailHint = pageC.locator("[role=alert]", { hasText: "по номеру телефона" })
  await emailHint.waitFor({ timeout: 15000 })
  const emailHintText = (await emailHint.first().textContent()) ?? ""
  check(
    "и36: почта в поле телефона — подсказка, а не «Неверный телефон или пароль»",
    /по номеру телефона/.test(emailHintText) && !/Неверный телефон/.test(emailHintText),
    emailHintText.slice(0, 90),
  )
  await ctxC.close()

  // ── Фон: ошибок страницы не накопилось ──────────────────────────────────
  const realErrors = errors.filter((e) => !e.includes("favicon"))
  check("ошибок страницы нет", realErrors.length === 0, realErrors.slice(0, 3).join(" | ") || "чисто")

  await context.close()
} finally {
  await prisma.$disconnect()
}

const failed = results.filter((r) => !r.ok)
console.log(`\nИТОГ: ${results.length - failed.length}/${results.length} проверок пройдено`)
// Браузер держит event loop живым: без закрытия УСПЕШНЫЙ прогон не
// завершался вовсе (висел до таймаута обёртки) — закрыть явно
await browser.close().catch(() => {})
if (failed.length > 0) process.exit(1)
