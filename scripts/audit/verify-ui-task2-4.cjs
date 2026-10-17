// Повторная браузерная проверка страниц, которых касались задачи 2–4:
//   /routes        — toCardStatus + route-trip-dialog (подписи статуса рейса)
//   /dashboard     — RouteTripPanel (баннер «время прибытия недостоверно»)
//   /fleet, /orders — страницы, которые открывают карточки рейса и заказов
//   /m             — пульт водителя (trip-stage-panel)
// Признак дефекта — только Error Boundary: слова вроде «500» в тексте
// страницы не считаются (в аудите это давало ложные BROKEN).
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

const PAGES = [
  { url: "/routes", name: "Рейсы (диспетчер)" },
  { url: "/dashboard", name: "Пульт (карта)" },
  { url: "/fleet", name: "Автопарк" },
  { url: "/orders", name: "Заказы" },
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(400);
  await page.fill('input[name="email"], input[type="email"]', ENV.ADMIN_EMAIL);
  await page.fill('input[type="password"]', ENV.ADMIN_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2500);

  let broken = 0;
  for (const p of PAGES) {
    const before = errors.length;
    await page.goto(`${BASE}${p.url}`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(3500);
    const t = await page.evaluate(() => document.body.innerText);
    const boundary = /Что-то пошло не так|Error Boundary|Произошла ошибка/i.test(t);
    const objObj = (t.match(/\[object Object\]/g) || []).length;
    const nan = /NaN/.test(t);
    const added = errors.slice(before);
    const ok = !boundary && objObj === 0 && !nan && added.length === 0;
    if (!ok) broken += 1;
    console.log(
      `${ok ? "[OK ]" : "[XX ]"} ${p.name.padEnd(22)} boundary=${boundary ? "ЕСТЬ" : "нет"} ` +
      `[object Object]=${objObj} NaN=${nan} ошибок страницы=${added.length}` +
      (added.length ? ` | ${added[0]}` : ""),
    );
  }

  // Статусы рейса на /routes: подписи русские, без сырых in_transit/in_progress
  await page.goto(`${BASE}/routes`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(3000);
  const routesText = await page.evaluate(() => document.body.innerText);
  const raw = ["in_transit", "in_progress", "planned", "undefined"].filter((w) => routesText.includes(w));
  console.log(`${raw.length === 0 ? "[OK ]" : "[XX ]"} /routes: сырых статусов в интерфейсе — ${raw.length ? raw.join(", ") : "нет"}`);

  await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/final-routes.png") });
  console.log(`\nсломанных страниц: ${broken}`);

  // ── Пульт водителя /m: он читает тот же ETA, что и дашборд диспетчера ──
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const orgId = await (async () => {
    const r = await page.evaluate(async () => (await (await fetch("/api/organization")).json()).organization?.id);
    return r;
  })().catch(() => null);
  const driver = orgId
    ? await prisma.driver.findFirst({
        where: { organizationId: orgId, user: { isNot: null } },
        select: { id: true, name: true, phone: true, user: { select: { id: true } } },
      })
    : null;
  let temp = null;
  if (driver) {
    temp = await page.evaluate(async (id) => {
      const csrf = await (await fetch("/api/auth/csrf")).json();
      const res = await fetch(`/api/auth/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf.csrfToken },
        body: JSON.stringify({ action: "resetPassword" }),
      });
      const json = await res.json().catch(() => ({}));
      return json.temporaryPassword || json.password || null;
    }, driver.user.id).catch(() => null);
  }
  if (driver && temp) {
    // Отдельный контекст: в основном уже висит сессия админа, а /m требует
    // сессию водителя — иначе cookie смешиваются и проверка ничего не значит.
    const dctx = await browser.newContext({ viewport: { width: 430, height: 900 }, locale: "ru-RU" });
    const dpage = await dctx.newPage();
    const derrors = [];
    dpage.on("pageerror", (e) => derrors.push(String(e).slice(0, 200)));
    // Браузер дублирует 401 общей строкой «Failed to load resource …» —
    // источник уже показан обработчиком response, поэтому такие сообщения
    // не считаем: иначе один и тот же ожидаемый ответ считается дважды.
    dpage.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if (/401 \(Unauthorized\)/.test(text)) return;
      derrors.push(text.slice(0, 200));
    });
    // 401 на /api/auth/session для водителя — не дефект: у водителя нет
    // штатной сессии, и эндпоинт честно отвечает «нет доступа». Считаем
    // дефектом только остальные 401 и ошибки страницы.
    dpage.on("response", (r) => {
      if (r.status() === 401 && !/\/api\/auth\/session/.test(r.url())) derrors.push(`401 ${r.url()}`);
    });
    // Сначала уводим страницу на origin: fetch с относительным URL на
    // about:blank не работает, и вход «молча» отвечал бы нулём.
    await dpage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null);
    const mLogin = await dpage.evaluate(async ({ phone, password }) => {
      const csrf = await (await fetch("/api/auth/csrf")).json();
      const res = await fetch("/api/m/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf.csrfToken },
        body: JSON.stringify({ phone, password }),
      });
      return res.status;
    }, { phone: driver.phone, password: temp }).catch(() => 0);
    await dpage.goto(`${BASE}/m`, { waitUntil: "networkidle", timeout: 60000 }).catch(() => null);
    await dpage.waitForTimeout(4000);
    const t = await dpage.evaluate(() => document.body.innerText);
    const boundary = /Что-то пошло не так|Error Boundary|Произошла ошибка/i.test(t);
    const objObj = (t.match(/\[object Object\]/g) || []).length;
    console.log(
      `${!boundary && derrors.length === 0 && objObj === 0 ? "[OK ]" : "[XX ]"} /m (пульт водителя): ` +
      `вход ${mLogin}, boundary=${boundary ? "ЕСТЬ" : "нет"} [object Object]=${objObj} ошибок=${derrors.length}` +
      (derrors.length ? ` | ${derrors[0]}` : ""),
    );
    await dpage.screenshot({ path: path.join(ROOT, "docs/audit-screens/final-m-driver.png") });
    await dctx.close();
  } else {
    console.log("[-- ] /m: водитель с учётной записью не найден — пропуск");
  }
  await prisma.$disconnect();
  await browser.close();
})();
