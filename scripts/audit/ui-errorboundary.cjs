// Полная проверка интерфейса в браузере: страница считается сломанной, если
// показан Error Boundary («Что-то сломалось») — такого не видно по HTTP-коду.
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../..");

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}
const ENV = { ...process.env, ...loadEnv() };
const BASE = ENV.AUDIT_BASE_URL || "http://localhost:3000";

const ERROR_BOUNDARY = /Что-то сломалось|Страница не открылась из-за ошибки/i;

async function session(browser, { mobile, loginPath, email, password, phone } = {}) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    userAgent: mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" : undefined,
    locale: "ru-RU",
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${loginPath}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(600);
  const pw = page.locator('input[type="password"]').first();
  const idField = phone
    ? page.locator('input[name="phone"], input[type="tel"]').first()
    : page.locator('input[name="email"], input[type="email"]').first();
  await idField.fill(phone || email);
  await pw.fill(password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2000);
  return { ctx, page };
}

async function check(page, url) {
  const errs = [];
  const on = (e) => errs.push(String(e).slice(0, 220));
  page.on("pageerror", on);
  let status = 0, note = "", kind = "VERIFIED";
  try {
    const res = await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    status = res ? res.status() : 0;
    await page.waitForTimeout(1600);
  } catch (e) {
    page.off("pageerror", on);
    return { url, status: "NOT_TESTED", note: `не открылась: ${String(e).slice(0, 120)}` };
  }
  const text = await page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "");
  const onLogin = /\/login(\?|$)/.test(page.url());
  if (ERROR_BOUNDARY.test(text)) { kind = "BROKEN"; note = "показан Error Boundary: «Что-то сломалось»"; }
  else if (onLogin) { kind = "BROKEN"; note = `редирект на ${page.url()}`; }
  else if (status >= 500) { kind = "BROKEN"; note = `HTTP ${status}`; }
  else if (errs.length) { kind = "PARTIAL"; note = `ошибка страницы: ${errs[0].slice(0, 120)}`; }
  else if (text.trim().length < 40) { kind = "PARTIAL"; note = "почти пустая страница"; }
  else { note = `HTTP ${status}, текст ${text.trim().length} симв.`; }
  page.off("pageerror", on);
  return { url, status: kind, note, pageErrors: errs.slice(0, 2), sample: text.slice(0, 200).replace(/\s+/g, " ") };
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const out = [];
  const sum = { VERIFIED: 0, PARTIAL: 0, BROKEN: 0, MISSING: 0, NOT_TESTED: 0 };
  const sign = { VERIFIED: "[OK ]", PARTIAL: "[~~ ]", BROKEN: "[XX ]", MISSING: "[-  ]", NOT_TESTED: "[?  ]" };

  // Публичные
  console.log("=== ПУБЛИЧНЫЕ ===");
  {
    const { ctx, page } = await session(browser, { loginPath: "/login", email: ENV.ADMIN_EMAIL, password: ENV.ADMIN_PASSWORD });
    for (const p of ["/login", "/register", "/forgot-password", "/reset-password", "/privacy", "/terms", "/docs"]) {
      const r = await check(page, p); sum[r.status]++; console.log(`${sign[r.status]} ${p.padEnd(20)} ${r.note}`); out.push(r);
    }
    await ctx.close();
  }

  // Сотрудник
  console.log("\n=== КАБИНЕТ СОТРУДНИКА ===");
  const staffPages = ["/dashboard", "/orders", "/routes", "/clients", "/drivers", "/fleet", "/users",
    "/organization", "/reports", "/reports/time", "/payments", "/fuel", "/maintenance", "/photos",
    "/chat", "/search", "/settings", "/audit", "/owner", "/owner/journal"];
  {
    const { ctx, page } = await session(browser, { loginPath: "/login", email: ENV.ADMIN_EMAIL, password: ENV.ADMIN_PASSWORD });
    for (const p of staffPages) {
      const r = await check(page, p); sum[r.status]++; console.log(`${sign[r.status]} ${p.padEnd(20)} ${r.note}`); out.push(r);
    }
    // маршрут: конкретный рейс из базы
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    const route = await prisma.route.findFirst({ select: { id: true } });
    const order = await prisma.order.findFirst({ select: { id: true } });
    const client = await prisma.client.findFirst({ select: { id: true } });
    const driver = await prisma.driver.findFirst({ select: { id: true } });
    if (route) { const r = await check(page, `/routes/${route.id}`); sum[r.status]++; console.log(`${sign[r.status]} ${"/routes/[id]".padEnd(20)} ${r.note}`); out.push(r); }
    if (order) { const r = await check(page, `/orders/${order.id}`); sum[r.status]++; console.log(`${sign[r.status]} ${"/orders/[id]".padEnd(20)} ${r.note}`); out.push(r); }
    if (client) { const r = await check(page, `/clients/${client.id}`); sum[r.status]++; console.log(`${sign[r.status]} ${"/clients/[id]".padEnd(20)} ${r.note}`); out.push(r); }
    if (driver) { const r = await check(page, `/drivers/${driver.id}`); sum[r.status]++; console.log(`${sign[r.status]} ${"/drivers/[id]".padEnd(20)} ${r.note}`); out.push(r); }
    if (route) { const r = await check(page, `/print/route/${route.id}`); sum[r.status]++; console.log(`${sign[r.status]} ${"/print/route/[id]".padEnd(20)} ${r.note}`); out.push(r); }
    await prisma.$disconnect().catch(() => {});
    await ctx.close();
  }

  // Логист мобильный
  console.log("\n=== МОБИЛЬНЫЙ ЛОГИСТ ===");
  const lmPages = ["/lm", "/lm/map", "/lm/routes", "/lm/orders", "/lm/orders/new", "/lm/routes/assistant",
    "/lm/users", "/lm/organization", "/lm/payments", "/lm/reports", "/lm/fuel", "/lm/photos",
    "/lm/chat", "/lm/notifications", "/lm/settings", "/lm/search", "/lm/clients", "/lm/drivers",
    "/lm/fleet", "/lm/more", "/lm/audit"];
  {
    const { ctx, page } = await session(browser, { mobile: true, loginPath: "/login", email: ENV.ADMIN_EMAIL, password: ENV.ADMIN_PASSWORD });
    for (const p of lmPages) {
      const r = await check(page, p); sum[r.status]++; console.log(`${sign[r.status]} ${p.padEnd(24)} ${r.note}`); out.push(r);
    }
    await ctx.close();
  }

  // Водитель мобильный
  console.log("\n=== МОБИЛЬНЫЙ ВОДИТЕЛЬ ===");
  {
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    const drv = await prisma.driver.findFirst({ where: { user: { isNot: null } }, select: { phone: true, user: { select: { id: true } } } });
    let temp = null;
    const staff = await session(browser, { loginPath: "/login", email: ENV.ADMIN_EMAIL, password: ENV.ADMIN_PASSWORD });
    if (drv?.user?.id) {
      const r = await staff.page.evaluate(async (id) => {
        const csrf = await (await fetch("/api/auth/csrf")).json();
        const res = await fetch(`/api/auth/users/${id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json", "x-csrf-token": csrf.csrfToken },
          body: JSON.stringify({ action: "resetPassword" }),
        });
        return res.json();
      }, drv.user.id);
      temp = r?.temporaryPassword || r?.password;
    }
    await staff.ctx.close();
    await prisma.$disconnect().catch(() => {});

    if (drv?.phone && temp) {
      const { ctx, page } = await session(browser, { mobile: true, loginPath: "/m/login", phone: drv.phone, password: temp });
      const loggedIn = !/\/m\/login(\?|$)/.test(page.url());
      out.push({ url: "/m/login", status: loggedIn ? "VERIFIED" : "BROKEN", note: loggedIn ? "водитель вошёл" : "водитель не вошёл" });
      sum[loggedIn ? "VERIFIED" : "BROKEN"]++;
      console.log(`${sign[loggedIn ? "VERIFIED" : "BROKEN"]} ${"/m/login".padEnd(24)} ${loggedIn ? "водитель вошёл" : "водитель не вошёл"}`);
      if (loggedIn) {
        for (const p of ["/m", "/m/orders", "/m/chat", "/m/profile", "/m/vehicle", "/m/notifications", "/m/nearby", "/m/photo", "/m/maintenance"]) {
          const r = await check(page, p); sum[r.status]++; console.log(`${sign[r.status]} ${p.padEnd(24)} ${r.note}`); out.push(r);
        }
      }
      await ctx.close();
    } else {
      out.push({ url: "/m/login", status: "NOT_TESTED", note: "нет телефона/пароля водителя" });
      sum.NOT_TESTED++;
      console.log(`[?  ] ${"/m/login".padEnd(24)} нет телефона/пароля водителя`);
    }
  }

  await browser.close();
  console.log("\n===== ИТОГ ПО ИНТЕРФЕЙСУ =====");
  console.log(JSON.stringify(sum));
  fs.writeFileSync(path.join(ROOT, "scripts/audit/report-ui-final.json"), JSON.stringify({ summary: sum, results: out }, null, 2));
  const bad = out.filter((r) => r.status === "BROKEN");
  console.log("\nСЛОМАННЫЕ:");
  for (const b of bad) console.log(` ${b.url} — ${b.note}`);
})().catch((e) => { console.error("ERR", e); process.exit(1); });
