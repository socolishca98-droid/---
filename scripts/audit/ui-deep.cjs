// Уточнение трёх дефектов интерфейса: /organization (React #31), /clients, и массовые 401.
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  const bad = [];
  page.on("response", (r) => { if (r.status() === 401 || r.status() >= 500) bad.push(`${r.status()} ${r.url().slice(0, 130)}`); });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 400)));

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(500);
  await page.fill('input[name="email"], input[type="email"]', ENV.ADMIN_EMAIL);
  await page.fill('input[type="password"]', ENV.ADMIN_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2000);
  console.log("вошли как:", page.url());

  for (const p of ["/organization", "/clients"]) {
    bad.length = 0; pageErrors.length = 0;
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const text = await page.evaluate(() => document.body.innerText);
    const errMatch = text.match(/.{0,90}(500|Внутренняя ошибка|Что-то пошло не так|Application error|Ошибка).{0,90}/i);
    console.log(`\n### ${p}`);
    console.log("  ответы 401/5xx:", bad.length ? bad.slice(0, 6).join(" | ") : "нет");
    console.log("  ошибки страницы:", pageErrors.length ? pageErrors.slice(0, 2).join(" || ") : "нет");
    if (errMatch) console.log("  найденный текст ошибки:", JSON.stringify(errMatch[0]));
    // ищем место, где объект отрисован как ребёнок
    const objText = await page.evaluate(() => {
      const out = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      while (walk.nextNode()) {
        const t = (walk.currentNode.textContent || "").trim();
        if (/^\[object Object\]$|deliveredTotal|onTime/.test(t) && !seen.has(t)) { seen.add(t); out.push(t.slice(0, 200)); }
      }
      return out.slice(0, 5);
    });
    if (objText.length) console.log("  текст с [object Object]:", JSON.stringify(objText));
    await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/deep" + p.replace(/\//g, "_") + ".png") }).catch(() => {});
  }
  await browser.close();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
