// Задача B, часть ошибок (B5): что видит владелец, когда API пульта падает.
//
// Ломаем ответы /api/admin/* через перехват сети и смотрим, не подменяет ли
// интерфейс ошибку пустым экраном или (тем более) успехом.

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

const results = [];
function step(name, ok, note) {
  results.push({ name, status: ok ? "VERIFIED" : "BROKEN", note });
  console.log(`${ok ? "[OK ]" : "[XX ]"} ${name} — ${note}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(600);
  await page.fill('input[name="email"], input[type="email"]', ENV.OWNER_EMAIL);
  await page.fill('input[type="password"]', ENV.OWNER_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(3000);
  step("B0 владелец вошёл", page.url().includes("/owner"), page.url());

  // ─── Сводка платформы отвечает 500 ─────────────────────────────────────
  await page.route("**/api/admin/overview*", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: "Сервер сводки недоступен" }) });
  });
  await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  const text500 = await page.evaluate(() => document.body.innerText);
  const showsError = /Сервер сводки недоступен|Ошибка 500|недоступен/i.test(text500);
  const showsDashes = (text500.match(/—/g) || []).length > 3;
  step("B5 ошибка сводки показана текстом, а не тире", showsError, showsError ? "ошибка видна" : `интерфейс показывает тире (${showsDashes ? "да" : "нет"}) и молчит`);
  const falseSuccess = text500.includes("Компаний") && !showsError && /^2$/m.test(text500);
  step("B5 ошибка не выдаётся за успех", !falseSuccess, falseSuccess ? "цифры показаны как будто всё в порядке" : "ложного успеха нет");
  await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/taskB-overview-500.png") });

  // ─── Журнал отвечает 500 ───────────────────────────────────────────────
  await page.unroute("**/api/admin/overview*");
  await page.route("**/api/admin/journal*", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: "Журнал недоступен" }) });
  });
  await page.goto(`${BASE}/owner/journal`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4500);
  const jText = await page.evaluate(() => document.body.innerText);
  const jError = /Журнал недоступен|Ошибка 500|Не удалось загрузить журнал/i.test(jText);
  const jEmpty = jText.includes("Записей по этим фильтрам нет");
  step("B5 ошибка журнала показана текстом", jError, jError ? "ошибка видна" : "ошибки не видно");
  step("B5 ошибка журнала не выдаётся за «записей нет»", !jEmpty, jEmpty ? "показано ложное пустое состояние" : "ложного пустого состояния нет");
  await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/taskB-journal-500.png") });

  // ─── Сеть отвалилась совсем ────────────────────────────────────────────
  await page.unroute("**/api/admin/journal*");
  await page.route("**/api/admin/**", async (route) => { await route.abort("failed"); });
  await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 45000 });
  // Хук делает до двух повторов с паузой — ждём, пока они закончатся.
  let nText = "";
  let netError = false;
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(2500);
    nText = await page.evaluate(() => document.body.innerText);
    netError = /Нет соединения|Проверьте интернет/i.test(nText);
    if (netError) break;
  }
  step("B5 обрыв сети показан как ошибка связи", netError, netError ? "сообщение о связи есть" : `сообщения о связи нет; экран: ${nText.slice(0, 220).replace(/\n/g, " | ")}`);
  await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/taskB-network-error.png") });
  await page.unroute("**/api/admin/**");

  // ─── Ошибка действия владельца ─────────────────────────────────────────
  await page.goto(`${BASE}/owner`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);
  await page.route("**/api/admin/accounts/*", async (route) => {
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ success: false, error: "АУДИТ: отказ сервера" }) });
  });
  const orgLink = await page.$('a[href^="/owner/org/"]');
  if (orgLink) {
    await orgLink.click();
    await page.waitForTimeout(3500);
    const revokeBtn = await page.$('button:has-text("Завершить сессии")');
    if (revokeBtn) {
      await revokeBtn.click();
      await page.waitForTimeout(3000);
      const aText = await page.evaluate(() => document.body.innerText);
      step("B5 ошибка действия владельца показана", aText.includes("АУДИТ: отказ сервера"), "сообщение об отказе на экране");
      await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/taskB-action-error.png") });
    } else {
      step("B5 кнопка действия найдена", false, "кнопки «Завершить сессии» нет");
    }
  }

  const summary = { VERIFIED: 0, BROKEN: 0 };
  for (const r of results) summary[r.status] = (summary[r.status] || 0) + 1;
  console.log("\n===== ИТОГ =====");
  console.log(JSON.stringify(summary));
  fs.writeFileSync(path.join(ROOT, "scripts/audit/report-owner-errors.json"), JSON.stringify({ summary, results }, null, 1));
  console.log("отчёт: scripts/audit/report-owner-errors.json");
  await browser.close();
})().catch((e) => {
  console.error("СЦЕНАРИЙ УПАЛ:", e);
  process.exit(1);
});
