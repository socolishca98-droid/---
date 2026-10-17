// Этап 4 аудита: интерфейс в настоящем браузере (Chromium headless).
// Вход через форму, обход страниц, сбор: HTTP-код, ошибки страницы, ошибки
// консоли, признак «пусто/спиннер/редирект на вход». Скриншоты — доказательство.
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const BASE = process.env.AUDIT_BASE_URL || "http://localhost:3000";
const SHOTS = path.join(ROOT, "docs/audit-screens");
fs.mkdirSync(SHOTS, { recursive: true });

function loadEnv() {
  const env = {};
  const file = path.join(ROOT, ".env");
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const ENV = { ...process.env, ...loadEnv() };

// Страницы, открываемые без входа
const PUBLIC_PAGES = ["/login", "/register", "/forgot-password", "/reset-password", "/privacy", "/terms", "/docs"];

// Страницы кабинета сотрудника
const STAFF_PAGES = [
  "/dashboard", "/orders", "/routes", "/clients", "/drivers", "/fleet", "/users",
  "/organization", "/reports", "/payments", "/fuel", "/maintenance", "/photos",
  "/chat", "/search", "/settings", "/audit",
];

// Мобильный кабинет логиста
const LM_PAGES = [
  "/lm/map", "/lm/routes", "/lm/orders/new", "/lm/orders", "/lm/routes/assistant",
  "/lm/users", "/lm/organization", "/lm/payments", "/lm/reports", "/lm/fuel",
  "/lm/photos", "/lm/chat", "/lm/notifications", "/lm/settings", "/lm/search",
  "/lm/clients", "/lm/drivers", "/lm/fleet", "/lm/more", "/lm/audit",
];

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    userAgent: opts.mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : undefined,
    locale: "ru-RU",
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.consoleErrors = [];
  page.failedRequests = [];
  page.on("pageerror", (e) => page.errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") page.consoleErrors.push(m.text().slice(0, 200)); });
  page.on("requestfailed", (r) => page.failedRequests.push(`${r.url().slice(0, 120)} :: ${r.failure()?.errorText || "?"}`));
  return { ctx, page };
}

async function visit(page, url, shotName) {
  const t0 = Date.now();
  let status = 0;
  let finalUrl = url;
  try {
    const res = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    status = res ? res.status() : 0;
    finalUrl = page.url();
    // ждём, пока исчезнет спиннер первого рендера
    await page.waitForTimeout(1200);
  } catch (e) {
    return { url, status: -1, ms: Date.now() - t0, error: String(e).slice(0, 160), finalUrl };
  }
  const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 4000) : "").catch(() => "");
  const rootHtml = await page.evaluate(() => {
    const r = document.getElementById("__next") || document.body;
    return r ? r.innerHTML.length : 0;
  }).catch(() => 0);
  const shot = path.join(SHOTS, shotName.replace(/[^a-z0-9_-]/gi, "_") + ".png");
  if (process.env.AUDIT_SCREENSHOTS !== "0") await page.screenshot({ path: shot, fullPage: false }).catch(() => {});

  // Признаки неготовности интерфейса
  const isPublicTarget = url === "/login" || url === "/register" || url === "/forgot-password" ||
    url === "/reset-password" || url === "/privacy" || url === "/terms";
  const redirectedToLogin = !isPublicTarget && /\/login(\?|$)/.test(finalUrl) && !/^\/login(\?|$)/.test(url);
  const looksEmpty = rootHtml < 500;
  const hasErrorText = /(500|Внутренняя ошибка|Что-то пошло не так|Application error)/i.test(bodyText);
  const hasSpinnerOnly = /(Загрузка|Загружаем)/.test(bodyText) && bodyText.length < 120;

  return {
    url, status, ms: Date.now() - t0, finalUrl,
    htmlLength: rootHtml, textLength: bodyText.length,
    redirectedToLogin, looksEmpty, hasErrorText, hasSpinnerOnly,
    pageErrors: page.errors.slice(0, 3), consoleErrors: page.consoleErrors.slice(0, 5),
    allConsoleErrors: page.consoleErrors.slice(0, 12),
    failedRequests: page.failedRequests.slice(0, 3),
    shot: path.relative(ROOT, shot),
    sample: bodyText.slice(0, 160).replace(/\s+/g, " "),
  };
}

function verdict(r) {
  if (r.status === -1) return ["NOT_TESTED", `не открылась: ${r.error}`];
  if (r.redirectedToLogin) return ["BROKEN", `ушло на ${r.finalUrl} вместо содержимого`];
  if (r.status >= 500) return ["BROKEN", `HTTP ${r.status}`];
  if (r.hasErrorText) return ["BROKEN", "на странице текст ошибки"];
  if (r.looksEmpty) return ["BROKEN", `почти пустой DOM (${r.htmlLength} символов)`];
  if (r.pageErrors.length) return ["BROKEN", `ошибка страницы: ${r.pageErrors[0]}`];
  if (r.consoleErrors.length) return ["PARTIAL", `ошибки консоли: ${r.consoleErrors.length}`];
  if (r.status !== 200) return ["PARTIAL", `HTTP ${r.status}`];
  if (r.failedRequests.length) return ["PARTIAL", `не загрузились запросы: ${r.failedRequests.length}`];
  return ["VERIFIED", `HTTP 200, DOM ${r.htmlLength}, ${r.ms} мс`];
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const results = [];
  const summary = { VERIFIED: 0, PARTIAL: 0, BROKEN: 0, MISSING: 0, NOT_TESTED: 0 };
  const rec = (r) => {
    const [st, note] = verdict(r);
    summary[st] = (summary[st] || 0) + 1;
    const sign = { VERIFIED: "[OK ]", PARTIAL: "[~~ ]", BROKEN: "[XX ]", MISSING: "[-  ]", NOT_TESTED: "[?  ]" }[st];
    console.log(`${sign} ${r.url.padEnd(34)} ${note}`);
    results.push({ ...r, status: st, note });
  };

  // --- 1. Публичные страницы ---
  console.log("=== ПУБЛИЧНЫЕ СТРАНИЦЫ ===");
  {
    const { ctx, page } = await newPage(browser);
    for (const p of PUBLIC_PAGES) rec(await visit(page, p, "pub" + p));
    await ctx.close();
  }

  // --- 2. Вход через форму ---
  console.log("\n=== ВХОД ЧЕРЕЗ ФОРМУ ===");
  const { ctx: authCtx, page: authPage } = await newPage(browser);
  await authPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await authPage.waitForTimeout(600);
  let loginOk = false;
  try {
    await authPage.fill('input[name="email"], input[type="email"]', ENV.ADMIN_EMAIL);
    await authPage.fill('input[type="password"]', ENV.ADMIN_PASSWORD);
    await Promise.all([
      authPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
      authPage.click('button[type="submit"]'),
    ]);
    await authPage.waitForTimeout(2500);
    loginOk = !/\/login(\?|$)/.test(authPage.url());
  } catch (e) {
    console.log("  ошибка входа:", String(e).slice(0, 160));
  }
  console.log(loginOk ? `  вход выполнен, адрес: ${authPage.url()}` : `  вход НЕ выполнен, адрес: ${authPage.url()}`);
  results.push({ url: "/login (форма)", status: loginOk ? "VERIFIED" : "BROKEN", note: loginOk ? "вошёл в кабинет" : `остался на ${authPage.url()}` });
  summary[loginOk ? "VERIFIED" : "BROKEN"] += 1;

  if (loginOk) {
    console.log("\n=== КАБИНЕТ СОТРУДНИКА (desktop) ===");
    for (const p of STAFF_PAGES) rec(await visit(authPage, p, "staff" + p));

    console.log("\n=== КАБИНЕТ ВЛАДЕЛЬЦА ПЛАТФОРМЫ ===");
    for (const p of ["/owner", "/owner/journal"]) rec(await visit(authPage, p, "owner" + p));
  }

  // --- 3. Мобильный кабинет логиста ---
  console.log("\n=== МОБИЛЬНЫЙ КАБИНЕТ ЛОГИСТА ===");
  if (loginOk) {
    const { ctx: mCtx, page: mPage } = await newPage(browser, { mobile: true });
    // переносим сессию: повторный вход в мобильном контексте
    await mPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await mPage.waitForTimeout(500);
    await mPage.fill('input[name="email"], input[type="email"]', ENV.ADMIN_EMAIL);
    await mPage.fill('input[type="password"]', ENV.ADMIN_PASSWORD);
    await Promise.all([
      mPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
      mPage.click('button[type="submit"]'),
    ]);
    await mPage.waitForTimeout(2000);
    const mLogin = !/\/login(\?|$)/.test(mPage.url());
    results.push({ url: "/lm (вход)", status: mLogin ? "VERIFIED" : "BROKEN", note: mLogin ? "мобильный вход выполнен" : "мобильный вход не выполнен" });
    summary[mLogin ? "VERIFIED" : "BROKEN"] += 1;
    if (mLogin) for (const p of LM_PAGES) rec(await visit(mPage, p, "lm" + p));
    await mCtx.close();
  }

  // --- 4. Мобильный кабинет водителя ---
  console.log("\n=== МОБИЛЬНЫЙ КАБИНЕТ ВОДИТЕЛЯ ===");
  {
    const { ctx: dCtx, page: dPage } = await newPage(browser, { mobile: true });
    // Телефон водителя из базы
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    let phone = null;
    let temp = null;
    try {
      const org = (await (async () => {
        await authPage.goto(`${BASE}/api/organization`, { waitUntil: "domcontentloaded" }).catch(() => null);
        return null;
      })());
      const drv = await prisma.driver.findFirst({
        where: { user: { isNot: null } }, select: { phone: true, user: { select: { id: true } } },
      });
      phone = drv?.phone;
      if (drv?.user?.id && authPage) {
        // временный пароль через ручку админа
        const r = await authPage.evaluate(async (id) => {
          const csrf = await (await fetch("/api/auth/csrf")).json();
          const res = await fetch(`/api/auth/users/${id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json", "x-csrf-token": csrf.csrfToken },
            body: JSON.stringify({ action: "resetPassword" }),
          });
          return res.json();
        }, drv.user.id);
        temp = r?.temporaryPassword || r?.password;
      }
    } catch (e) {
      console.log("  не удалось подготовить вход водителя:", String(e).slice(0, 140));
    }

    if (phone && temp) {
      await dPage.goto(`${BASE}/m/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await dPage.waitForTimeout(600);
      const phoneField = dPage.locator('input[name="phone"], input[type="tel"]').first();
      const passField = dPage.locator('input[type="password"]').first();
      const fields = await phoneField.count() + (await passField.count());
      if (fields >= 2) {
        await phoneField.fill(phone);
        await passField.fill(temp);
        await Promise.all([
          dPage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
          dPage.click('button[type="submit"]'),
        ]);
        await dPage.waitForTimeout(2500);
      }
      const dLogin = !/\/m\/login(\?|$)/.test(dPage.url());
      results.push({ url: "/m/login (форма)", status: dLogin ? "VERIFIED" : "BROKEN", note: dLogin ? "водитель вошёл" : `водитель не вошёл (${dPage.url()})` });
      summary[dLogin ? "VERIFIED" : "BROKEN"] += 1;
      if (dLogin) {
        for (const p of ["/m", "/m/orders", "/m/chat", "/m/profile", "/m/vehicle",
                         "/m/notifications", "/m/nearby", "/m/photo", "/m/maintenance"]) {
          rec(await visit(dPage, p, "m" + p));
        }
      }
    } else {
      results.push({ url: "/m/login (форма)", status: "NOT_TESTED", note: "нет телефона или пароля водителя" });
      summary.NOT_TESTED += 1;
    }
    await prisma.$disconnect().catch(() => {});
    await dCtx.close();
  }

  await authCtx.close();
  await browser.close();

  console.log("\n===== ИТОГ ПО ИНТЕРФЕЙСУ =====");
  console.log(JSON.stringify(summary));
  fs.writeFileSync(path.join(ROOT, "scripts/audit/report-ui.json"),
    JSON.stringify({ summary, results, screenshots: SHOTS }, null, 2));
  const bad = results.filter((r) => r.status === "BROKEN");
  if (bad.length) {
    console.log("\nСЛОМАННЫЕ СТРАНИЦЫ:");
    for (const b of bad) console.log(` ${b.url} — ${b.note}`);
  }
})().catch((e) => { console.error("ERR", e); process.exit(1); });
