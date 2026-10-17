// Приёмка задачи 1: /drivers и /reset-password в браузере после правок.
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

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 220)));

  const boundary = (t) => /Что-то сломалось/.test(t);
  const objectCount = () => page.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n = 0;
    while (w.nextNode()) if ((w.currentNode.textContent || "").trim() === "[object Object]") n++;
    return n;
  });

  // --- 1. /reset-password без входа ---
  errs.length = 0;
  await page.goto(`${BASE}/reset-password`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2200);
  let t = await page.evaluate(() => document.body.innerText);
  console.log("=== /reset-password (без входа) ===");
  console.log(" Error Boundary :", boundary(t) ? "ДА — СЛОМАНО" : "НЕТ");
  console.log(" текст          :", JSON.stringify(t.slice(0, 170).replace(/\n/g, " | ")));
  console.log(" ошибок страницы:", errs.length, errs.slice(0, 1).join(""));

  // --- 2. вход через форму ---
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(500);
  await page.fill('input[name="email"], input[type="email"]', ENV.ADMIN_EMAIL);
  await page.fill('input[type="password"]', ENV.ADMIN_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2500);
  console.log("\n=== вход ===");
  console.log(" адрес после входа:", page.url(), /\/login(\?|$)/.test(page.url()) ? "— НЕ ВОШЛИ" : "— вошли");

  // --- 3. /drivers ---
  errs.length = 0;
  await page.goto(`${BASE}/drivers`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(3800);
  t = await page.evaluate(() => document.body.innerText);
  console.log("\n=== /drivers (после входа) ===");
  console.log(" Error Boundary :", boundary(t) ? "ДА — СЛОМАНО" : "НЕТ");
  console.log(" [object Object]:", await objectCount());
  console.log(" NaN            :", t.includes("NaN"));
  console.log(" ошибок страницы:", errs.length, errs.slice(0, 1).join(""));
  console.log(" водители видны :", /Иванов|Кузнецов|Орлов/.test(t));
  const grades = t.match(/[0-9]{1,3}\s*·\s*(отлично|хорошо|удовлетворительно|требует внимания)/g);
  console.log(" оценки с грейдом:", grades ? grades.slice(0, 5).join(" | ") : "не найдены");
  const avg = t.match(/Средний рейтинг[^\n]*/);
  console.log(" средний рейтинг:", avg ? JSON.stringify(avg[0].slice(0, 70)) : "не найден");
  await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/fix1-drivers.png") });

  // --- 4. /reset-password после входа ---
  errs.length = 0;
  await page.goto(`${BASE}/reset-password`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  t = await page.evaluate(() => document.body.innerText);
  console.log("\n=== /reset-password (после входа) ===");
  console.log(" Error Boundary :", boundary(t) ? "ДА — СЛОМАНО" : "НЕТ");
  console.log(" текст          :", JSON.stringify(t.slice(0, 170).replace(/\n/g, " | ")));
  console.log(" есть поля      :", await page.locator('input[type="password"]').count());
  await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/fix1-reset.png") });

  // --- 5. живой контракт API для сверки ---
  const api = await page.evaluate(async () => (await fetch("/api/drivers?limit=200")).json());
  const shapes = new Set((api.drivers || []).map((d) => (d.rating === null ? "null" : typeof d.rating)));
  console.log("\n=== контракт /api/drivers ===");
  console.log(" форма rating в ответе:", [...shapes].join(", "));
  const withRating = (api.drivers || []).filter((d) => d.rating);
  console.log(" водителей с оценкой:", withRating.length, "из", (api.drivers || []).length);
  if (withRating[0]) console.log(" пример:", JSON.stringify(withRating[0].rating));

  await browser.close();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
