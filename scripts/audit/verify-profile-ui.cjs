// Задача A, часть 2: новое имя должно появиться в интерфейсе, а не только в API.
// Проверяем в браузере: шапка, меню пользователя, приветствие, профиль водителя.
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
const TAG = `UI-${Date.now().toString(36).toUpperCase()}`;
const NEW_NAME = `${TAG} Пользователь`;

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url().slice(0, 120)}`); });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(400);
  await page.fill('input[name="email"], input[type="email"]', ENV.ADMIN_EMAIL);
  await page.fill('input[type="password"]', ENV.ADMIN_PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2500);

  // На дашборде открывается приветственный диалог («Добро пожаловать в
  // Loginex»): он перехватывает клики по шапке. Закрываем кнопкой, затем
  // Escape на случай оставшегося оверлея.
  const dlgButtons = await page.$$('[role="dialog"] button');
  if (dlgButtons.length) {
    await dlgButtons[dlgButtons.length - 1].click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);

  /** Открывает меню пользователя в шапке и возвращает true, если оно открылось. */
  const openUserMenu = async () => {
    const trigger = await page.evaluateHandle(() => {
      const header = document.querySelector("header.surface-glass") || document.querySelector("header");
      if (!header) return null;
      const btns = [...header.querySelectorAll("button")];
      return btns[btns.length - 1] || null;
    });
    if (!trigger) return false;
    await (trigger.asElement()).click().catch(() => {});
    await page.waitForTimeout(1200);
    const count = await page.evaluate(
      () => document.querySelectorAll('[role="menu"] [role="menuitem"], [data-slot="dropdown-menu-item"]').length,
    );
    return count > 0;
  };

  const before = await page.evaluate(() => document.body.innerText);
  // Исходное имя берём из самого профиля (GET /api/auth/profile)
  const oldName = await page.evaluate(async () => {
    const r = await fetch("/api/auth/profile", { cache: "no-store" });
    const d = await r.json().catch(() => null);
    return d?.profile?.name || "";
  });
  console.log(`=== до изменения ===\n имя в профиле: «${oldName}»`);
  console.log(` имя видно в шапке: ${before.includes(oldName) ? "ДА" : "НЕТ"}`);

  // Открываем меню пользователя в шапке: триггер — последняя кнопка шапки
  // (у неё текст «ИА / Иван Админов / Администратор …»).
  const menuOpened = await openUserMenu();
  const profileItem = await page.$('text=Мой профиль');
  if (!menuOpened || !profileItem) {
    console.log(`[XX] меню пользователя открылось: ${menuOpened}, пункт «Мой профиль» найден: ${!!profileItem}`);
    const diag = await page.evaluate(() => ({
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      openDialogs: [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.getAttribute("data-state") === "open").length,
      menus: document.querySelectorAll('[role="menu"]').length,
      headerBtns: [...(document.querySelector("header")?.querySelectorAll("button") || [])].map((b) => (b.innerText || "").slice(0, 30).replace(/\n/g, " / ")),
    }));
    console.log("диагностика:", JSON.stringify(diag));
    await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/taskA-menu-debug.png") });
    await browser.close();
    return;
  }
  await profileItem.click();
  await page.waitForTimeout(1500);

  // Ищем поле имени и кнопку сохранения
  const nameInput = await page.$('#profile-name, input[name="name"], input[placeholder*="мя"]');
  if (!nameInput) {
    console.log("[XX] поле имени в меню пользователя не найдено");
    console.log("меню:", (await page.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\n/g, " | "));
    await browser.close();
    return;
  }
  await nameInput.fill(NEW_NAME);
  const saveBtn = await page.$('button[type="submit"]');
  await saveBtn.click();
  await page.waitForTimeout(3000);

  // Имя должно обновиться БЕЗ перезагрузки страницы (пункт 7 требования)
  const afterSave = await page.evaluate(() => document.body.innerText);
  const nameShown = afterSave.includes(NEW_NAME);
  const oldGone = !afterSave.includes(oldName);
  console.log(`\n=== после сохранения ===`);
  console.log(` новое имя в интерфейсе: ${nameShown ? "ДА" : "НЕТ"}`);
  console.log(` старое имя ушло: ${oldGone ? "ДА" : "НЕТ"}`);
  const stillOld = [];
  for (const place of ["header", "aside", '[role="menu"]']) {
    const t = await page.evaluate((sel) => (document.querySelector(sel)?.innerText || ""), place).catch(() => "");
    if (t.includes(oldName)) stillOld.push(place);
  }
  if (stillOld.length) console.log(` ВНИМАНИЕ: старое имя осталось в ${stillOld.join(", ")}`);

  // Перезагрузка: имя должно сохраниться
  await page.reload({ waitUntil: "networkidle", timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(3000);
  const afterReload = await page.evaluate(() => document.body.innerText);
  const afterReloadShown = afterReload.includes(NEW_NAME);
  console.log(` новое имя после перезагрузки: ${afterReloadShown ? "ДА" : "НЕТ"}`);

  // Открываем меню снова — имя в форме профиля
  await openUserMenu();
  const item2 = await page.$('text=Мой профиль');
  if (item2) await item2.click();
  await page.waitForTimeout(1500);
  const menuName = await page.$('#profile-name, input[name="name"], input[placeholder*="мя"]');
  const menuValue = menuName ? await menuName.inputValue() : null;
  console.log(` имя в форме профиля: «${menuValue}»`);

  console.log(`\n ошибок страницы: ${errors.length}${errors.length ? ` | ${errors[0]}` : ""}`);
  await page.screenshot({ path: path.join(ROOT, "docs/audit-screens/taskA-profile-name.png") });

  // Возврат исходного имени через API
  const res = await page.evaluate(async (name) => {
    const csrf = await (await fetch("/api/auth/csrf")).json();
    const r = await fetch("/api/auth/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrf.csrfToken },
      body: JSON.stringify({ name }),
    });
    return r.status;
  }, oldName || "Иван Админов");
  console.log(` возврат исходного имени: HTTP ${res}`);

  await browser.close();
  const ok = nameShown && oldGone && afterReloadShown && menuValue === NEW_NAME;
  console.log(`\nИТОГ: ${ok ? "VERIFIED" : "PARTIAL/BROKEN — имя не обновляется согласованно"}`);
})();
