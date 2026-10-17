// Приёмка задачи 1, часть 2: карточка водителя на /drivers.
// Полный цикл сброса пароля — отдельно, в verify-reset-flow.cjs.
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
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1200 }, locale: "ru-RU" })).newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(500);
  await page.fill('input[name="email"], input[type="email"]', ENV.ADMIN_EMAIL);
  await page.fill('input[type="password"]', ENV.ADMIN_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2000);

  await page.goto(`${BASE}/drivers`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(4000);
  const t = await page.evaluate(() => document.body.innerText);
  const i = t.indexOf("Кузнецов");
  console.log("=== карточка водителя с оценкой ===");
  console.log(i >= 0 ? JSON.stringify(t.slice(i, i + 300).replace(/\n/g, " | ")) : "не найден");
  console.log("балл 60 показан:", t.includes("60"));
  await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/fix1-drivers-full.png") });

  // Полный цикл сброса пароля вынесен в verify-reset-flow.cjs: там токен
  // выдаётся теми же средствами, что и lib/password-reset.ts (в схеме хранится
  // только tokenHash, поэтому «прочитать токен из базы» нельзя).
  await browser.close();
})();
