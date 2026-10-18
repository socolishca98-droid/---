// Задача A, часть 3: смена имени для других ролей — водитель (/m/profile).
// Водитель входит по телефону, имя меняется на странице профиля мобильного
// приложения. После сохранения новое имя должно быть видно в шапке мобильного
// интерфейса без перезагрузки и сохраняться после перезагрузки.
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
const TAG = `DRV-${Date.now().toString(36).toUpperCase()}`;
const NEW_NAME = `${TAG} Водителев`;

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });

  // Вход водителя по телефону
  await page.goto(`${BASE}/m/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);
  const phoneInput = await page.$('input[name="phone"], input[type="tel"], input[inputmode="tel"]');
  if (!phoneInput) {
    console.log("[XX] нет поля телефона на /m/login");
    await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/taskA-driver-login-debug.png") });
    await browser.close();
    return;
  }
  const phones = (ENV.DRIVER_PHONES || "79161234502,79161234501,79161234503,79161234504,79161234505").split(",").map((x) => x.trim()).filter(Boolean);
  await phoneInput.fill(phones[0]);
  const pwdInput = await page.$('input[type="password"]');
  if (pwdInput) await pwdInput.fill(ENV.DRIVER_DEFAULT_PASSWORD || "");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(3000);
  console.log(" после входа URL:", page.url());

  // Исходное имя
  const oldName = await page.evaluate(async () => {
    const r = await fetch("/api/auth/profile", { cache: "no-store" });
    const d = await r.json().catch(() => null);
    return d?.profile?.name || "";
  }).catch(() => "");
  console.log(` имя в профиле до изменения: «${oldName}»`);

  await page.goto(`${BASE}/m/profile`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  const before = await page.evaluate(() => document.body.innerText);
  console.log(` старое имя на странице профиля: ${before.includes(oldName) ? "ДА" : "НЕТ"}`);

  // Профиль водителя показывает данные только для чтения: форму включает
  // кнопка «Изменить» в блоке «Мои данные».
  let nameInput = await page.$('#m-profile-name, input[name="name"], input[placeholder*="мя"]');
  if (!nameInput) {
    const editBtn = await page.$('button:has-text("Изменить")');
    if (editBtn) { await editBtn.click(); await page.waitForTimeout(1200); }
    nameInput = await page.$('#m-profile-name, input[name="name"], input[placeholder*="мя"]');
  }
  if (!nameInput) {
    console.log("[XX] поле имени на /m/profile не найдено даже после «Изменить»");
    await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/taskA-driver-profile-debug.png") });
    await browser.close();
    return;
  }
  await nameInput.fill(NEW_NAME);
  const saveBtn = await page.$('button:has-text("Сохранить"), button[type="submit"]');
  if (!saveBtn) {
    console.log("[XX] кнопка сохранения на /m/profile не найдена");
    await browser.close();
    return;
  }
  await saveBtn.click();
  await page.waitForTimeout(3500);

  const afterSave = await page.evaluate(() => document.body.innerText);
  const nameShown = afterSave.includes(NEW_NAME);
  const oldGone = !afterSave.includes(oldName);
  console.log(`\n=== после сохранения ===`);
  console.log(` новое имя на странице профиля: ${nameShown ? "ДА" : "НЕТ"}`);
  console.log(` старое имя ушло: ${oldGone ? "ДА" : "НЕТ"}`);

  // Главная страница мобильного приложения: имя должно быть новым
  await page.goto(`${BASE}/m`, { waitUntil: "domcontentloaded", timeout: 45000 });
  // Экран показывает загрузчик, пока не придут данные рейса — ждём появления
  // имени или кнопок навигации, но не больше 20 с.
  let home = "";
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(2000);
    home = await page.evaluate(() => document.body.innerText);
    if (home.includes(NEW_NAME) || home.includes("Рейсы") || home.length > 200) break;
  }
  console.log(` новое имя на главной /m: ${home.includes(NEW_NAME) ? "ДА" : "НЕТ"}`);
  console.log(` старое имя на главной /m ушло: ${!home.includes(oldName) ? "ДА" : "НЕТ"}`);
  console.log(` главная /m загрузилась: ${home.length > 200 ? "ДА" : "НЕТ"} (символов: ${home.length})`);

  // Имя должно быть и в записи водителя (Driver.name), не только у пользователя
  const driverSync = await page.evaluate(async () => {
    const r = await fetch("/api/auth/profile", { cache: "no-store" });
    const d = await r.json().catch(() => null);
    return { name: d?.profile?.name ?? null, driverName: d?.profile?.driver?.name ?? null };
  }).catch(() => ({}));
  console.log(` после перезагрузки: User.name=«${driverSync.name}», Driver.name=«${driverSync.driverName}»`);

  console.log(`\n ошибок страницы: ${errors.length}${errors.length ? ` | ${errors[0]}` : ""}`);
  await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/taskA-driver-profile-name.png") });

  // Возврат исходного имени
  const restore = await page.evaluate(async (name) => {
    const csrf = await (await fetch("/api/auth/csrf")).json().catch(() => null);
    const token = csrf?.token || csrf?.csrfToken || "";
    const r = await fetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": token },
      body: JSON.stringify({ name }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, oldName);
  console.log(` возврат исходного имени: HTTP ${restore.status}`, restore.body?.success ? "OK" : JSON.stringify(restore.body).slice(0, 200));

  const ok = nameShown && oldGone && home.includes(NEW_NAME) && !home.includes(oldName)
    && home.length > 200 && driverSync.name === NEW_NAME;
  console.log(`\nИТОГ: ${ok ? "VERIFIED" : "PARTIAL/BROKEN"}`);
  await browser.close();
})();
