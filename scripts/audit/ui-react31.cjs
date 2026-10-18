// Точно: на какой странице всплывает React #31 (объект рейтинга как ребёнок).
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
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(500);
  await page.fill('input[name="email"], input[type="email"]', ENV.ADMIN_EMAIL);
  await page.fill('input[type="password"]', ENV.ADMIN_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2000);

  for (const p of ["/drivers", "/fleet", "/organization", "/users", "/dashboard"]) {
    const errs = [];
    const onErr = (e) => errs.push(String(e).slice(0, 260));
    page.on("pageerror", onErr);
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2200);
    const react31 = errs.filter((e) => e.includes("#31"));
    const objText = await page.evaluate(() => {
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const t = (w.currentNode.textContent || "").trim();
        if (/^\[object Object\]$/.test(t)) out.push(t);
      }
      return out.slice(0, 4);
    });
    console.log(`${p.padEnd(14)} ошибок страницы: ${errs.length} | React#31: ${react31.length} | [object Object] в DOM: ${objText.length}`);
    if (react31.length) console.log("      ", react31[0].slice(0, 250));
    page.off("pageerror", onErr);
  }
  await browser.close();
})().catch((e) => { console.error("ERR", e); process.exit(1); });
